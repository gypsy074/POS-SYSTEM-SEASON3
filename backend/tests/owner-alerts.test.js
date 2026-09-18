/* ==========================================================================
   Season 3 POS — Owner email alerts tests
   Settings API (auth, validation, round-trip), SMTP-guarded test email,
   low-stock dedup on order placement, and the daily summary email.
   ========================================================================== */

process.env.JWT_SECRET = 'test-secret';
// Pretend SMTP is configured so the real pipeline (email.js) runs; the
// transporter is replaced with a fake below.
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'test@test.local';
process.env.SMTP_PASS = 'test-pass';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const { setTransporterForTests } = require('../email');

let mongod;
let app;
let adminToken;
let cashierToken;
let fakeMailer;

async function login(username, password) {
    const res = await request(app).post('/api/login').send({ username, password });
    return { status: res.status, token: res.body.token, role: res.body.role };
}

async function waitForMongo() {
    if (mongoose.connection.readyState === 1) return;
    await new Promise(resolve => mongoose.connection.once('connected', resolve));
}

async function waitForSeed() {
    for (let i = 0; i < 50; i++) {
        try {
            const count = await mongoose.connection.db.collection('users').countDocuments();
            if (count > 0) return;
        } catch (err) { /* collection may not exist yet */ }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri('pos_test');
    app = require('../server');
    await waitForMongo();
    await waitForSeed();

    const adminLogin = await login('admin', 'admin123');
    adminToken = adminLogin.token;
    expect(adminLogin.status).toBe(200);

    const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'alertsCashier', password: 'tester123', role: 'Cashier' });
    expect([201, 409]).toContain(userRes.status);
    const cashierLogin = await login('alertsCashier', 'tester123');
    cashierToken = cashierLogin.token;
    expect(cashierLogin.status).toBe(200);

    fakeMailer = { sendMail: jest.fn().mockResolvedValue({}) };
    setTransporterForTests(fakeMailer);
}, 120000);

afterAll(async () => {
    setTransporterForTests(null);
    // --runInBand shares one process across test files — never leak the
    // pretend-SMTP env into app/insights tests (they must stay email-free).
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}, 120000);

async function putSettings(body) {
    return request(app)
        .put('/api/settings/owner-alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
}

// The low-stock hook is fire-and-forget by design (it must not slow down
// order placement), so tests poll for the fake mailer instead of asserting
// synchronously.
async function waitForMails(count) {
    for (let i = 0; i < 50; i++) {
        if (fakeMailer.sendMail.mock.calls.length >= count) return;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out waiting for ${count} emails (got ${fakeMailer.sendMail.mock.calls.length})`);
}

describe('owner-alerts settings API', () => {
    test('requires admin auth', async () => {
        const anon = await request(app).get('/api/settings/owner-alerts');
        expect(anon.status).toBe(401);
        const cashier = await request(app)
            .get('/api/settings/owner-alerts')
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(cashier.status).toBe(403);
    });

    test('defaults exist and expose smtpConfigured', async () => {
        const res = await request(app)
            .get('/api/settings/owner-alerts')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.recipients).toEqual([]);
        expect(res.body.lowStockEnabled).toBe(true);
        expect(res.body.dailySummaryEnabled).toBe(true);
        expect(res.body.dailySummaryHour).toBe(20);
        expect(res.body.smtpConfigured).toBe(true);
    });

    test('validates recipients, hour and count', async () => {
        expect((await putSettings({ recipients: [] })).status).toBe(400);
        expect((await putSettings({ recipients: ['not-an-email'] })).status).toBe(400);
        const many = Array.from({ length: 6 }, (_, i) => `o${i}@x.com`);
        expect((await putSettings({ recipients: many })).status).toBe(400);
        expect((await putSettings({ recipients: ['a@b.com'], dailySummaryHour: 24 })).status).toBe(400);
        expect((await putSettings({ recipients: ['a@b.com'], dailySummaryHour: 2.5 })).status).toBe(400);
    });

    test('saves and round-trips the settings', async () => {
        const res = await putSettings({
            recipients: ['owner@cafe.com', 'manager@cafe.com'],
            lowStockEnabled: false,
            dailySummaryEnabled: true,
            dailySummaryHour: 7
        });
        expect(res.status).toBe(200);
        expect(res.body.recipients).toEqual(['owner@cafe.com', 'manager@cafe.com']);
        expect(res.body.lowStockEnabled).toBe(false);
        expect(res.body.dailySummaryHour).toBe(7);

        const fetched = await request(app)
            .get('/api/settings/owner-alerts')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(fetched.body.dailySummaryHour).toBe(7);
        expect(fetched.body.lowStockEnabled).toBe(false);
    });
});

describe('test email endpoint', () => {
    test('sends a test email to the first recipient', async () => {
        fakeMailer.sendMail.mockClear();
        const res = await request(app)
            .post('/api/settings/owner-alerts/test')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(fakeMailer.sendMail).toHaveBeenCalledTimes(1);
        expect(fakeMailer.sendMail.mock.calls[0][0].to).toBe('owner@cafe.com');
    });
});

describe('low-stock email on order placement', () => {
    async function createProduct(name, stock, threshold) {
        const res = await request(app)
            .post('/api/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name, price: 100, stock, category: 'Test', lowStockThreshold: threshold });
        expect([201, 200]).toContain(res.status);
    }

    test('sends once per item per day, then dedupes', async () => {
        await createProduct('AlertCoffee', 5, 10);   // already below threshold
        await putSettings({ recipients: ['owner@cafe.com'], lowStockEnabled: true });
        fakeMailer.sendMail.mockClear();

        const place = (qty) => request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ cashier: 'admin', items: [{ name: 'AlertCoffee', quantity: qty, price: 100 }] });

        expect((await place(1)).status).toBe(201);
        await waitForMails(1);
        expect(fakeMailer.sendMail).toHaveBeenCalledTimes(1);
        const first = fakeMailer.sendMail.mock.calls[0][0];
        expect(first.to).toContain('owner@cafe.com');
        expect(first.subject).toContain('AlertCoffee');

        // A second order the same day must NOT send another email.
        expect((await place(1)).status).toBe(201);
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(fakeMailer.sendMail).toHaveBeenCalledTimes(1);
    });

    test('skips entirely when low-stock alerts are disabled', async () => {
        await createProduct('AlertMilkTea', 3, 10);
        await putSettings({ recipients: ['owner@cafe.com'], lowStockEnabled: false });
        fakeMailer.sendMail.mockClear();

        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ cashier: 'admin', items: [{ name: 'AlertMilkTea', quantity: 1, price: 100 }] });
        expect(res.status).toBe(201);
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(fakeMailer.sendMail).not.toHaveBeenCalled();

        await putSettings({ recipients: ['owner@cafe.com'], lowStockEnabled: true });
    });
});

describe('daily sales summary email', () => {
    test('sends one summary per day with today’s revenue', async () => {
        await putSettings({ recipients: ['owner@cafe.com'], dailySummaryEnabled: true, dailySummaryHour: 20 });
        const { trySendDailySummary } = app._ownerAlerts;
        fakeMailer.sendMail.mockClear();

        await trySendDailySummary();
        expect(fakeMailer.sendMail).toHaveBeenCalledTimes(1);
        const mail = fakeMailer.sendMail.mock.calls[0][0];
        expect(mail.subject).toContain('Daily Sales Summary');
        expect(mail.to).toContain('owner@cafe.com');
        expect(mail.html).toContain('Orders today');

        // Idempotent — running again the same day sends nothing.
        await trySendDailySummary();
        expect(fakeMailer.sendMail).toHaveBeenCalledTimes(1);
    });
});