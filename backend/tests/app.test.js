/* ==========================================================================
   Season 3 POS — backend API tests
   Runs against an in-memory MongoDB (mongodb-memory-server).
   ========================================================================== */

process.env.JWT_SECRET = 'test-secret';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

let mongod;
let app;
let adminToken;
let cashierToken;

async function login(username, password) {
    const res = await request(app).post('/api/login').send({ username, password });
    return { status: res.status, token: res.body.token, role: res.body.role };
}

async function waitForMongo() {
    if (mongoose.connection.readyState === 1) return;
    await new Promise(resolve => mongoose.connection.once('connected', resolve));
}

// The default admin is seeded asynchronously on connect — poll until it exists.
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

    // The default admin (admin/admin123) is seeded automatically on connect;
    // a 409 means it already exists — either way the account is available.
    const adminLogin = await login('admin', 'admin123');
    adminToken = adminLogin.token;
    expect(adminLogin.status).toBe(200);

    // Create a cashier account for role-based tests.
    const userRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'tester', password: 'tester123', role: 'Cashier' });
    expect([201, 409]).toContain(userRes.status);

    const cashierLogin = await login('tester', 'tester123');
    cashierToken = cashierLogin.token;
    expect(cashierLogin.status).toBe(200);
}, 120000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}, 120000);

async function createProduct(name, price, stock) {
    const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, price, stock, category: 'Test' });
    expect([201, 200]).toContain(res.status);
    return res.body;
}

async function getProduct(name) {
    const res = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${adminToken}`);
    return (res.body || []).find(p => p.name === name);
}

describe('Auth', () => {
    test('rejects invalid credentials', async () => {
        const res = await request(app).post('/api/login').send({ username: 'admin', password: 'wrong' });
        expect(res.status).toBe(401);
    });

    test('GET /api/orders without a token → 401', async () => {
        const res = await request(app).get('/api/orders');
        expect(res.status).toBe(401);
    });

    test('cashier cannot hard-delete an order (admin only) → 403', async () => {
        const res = await request(app)
            .delete('/api/orders/000000000000000000000000')
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(res.status).toBe(403);
    });
});

describe('Orders & stock', () => {
    test('placing an order deducts menu stock', async () => {
        await createProduct('TestPancit', 120, 5);

        const orderRes = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                customer: 'Unit Test',
                cashier: 'tester',
                paymentMethod: 'Cash',
                items: [{ name: 'TestPancit', quantity: 2, price: 120 }],
                total: 240,
                tendered: 500,
                change: 260
            });
        expect(orderRes.status).toBe(201);

        const product = await getProduct('TestPancit');
        expect(Number(product.stock)).toBe(3);
        expect(orderRes.body.status).toBe('Completed');
        expect(orderRes.body.tendered).toBe(500);
        expect(orderRes.body.change).toBe(260);
    });

    test('order exceeding stock → 409 and no stock change', async () => {
        await createProduct('TestSisig', 150, 2);

        const before = await getProduct('TestSisig');
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestSisig', quantity: 99, price: 150 }]
            });
        expect(res.status).toBe(409);

        const after = await getProduct('TestSisig');
        expect(Number(after.stock)).toBe(Number(before.stock));
    });

    test('retried order with the same clientOrderId is not duplicated or re-deducted', async () => {
        await createProduct('TestLumpia', 60, 4);

        const first = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                clientOrderId: 'offline-retry-001',
                items: [{ name: 'TestLumpia', quantity: 2, price: 60 }],
                total: 120
            });
        expect(first.status).toBe(201);
        expect(Number((await getProduct('TestLumpia')).stock)).toBe(2);

        const retry = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                clientOrderId: 'offline-retry-001',
                items: [{ name: 'TestLumpia', quantity: 2, price: 60 }],
                total: 120
            });
        expect(retry.status).toBe(200);
        expect(String(retry.body._id)).toBe(String(first.body._id));
        expect(Number((await getProduct('TestLumpia')).stock)).toBe(2);
    });

    test('orders without clientOrderId are never deduplicated', async () => {
        await createProduct('TestTuron', 45, 6);

        const one = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestTuron', quantity: 1, price: 45 }]
            });
        const two = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestTuron', quantity: 1, price: 45 }]
            });
        expect(one.status).toBe(201);
        expect(two.status).toBe(201);
        expect(String(one.body._id)).not.toBe(String(two.body._id));
        expect(Number((await getProduct('TestTuron')).stock)).toBe(4);
    });
});

describe('Waste & stock', () => {
    test('logging waste decrements menu stock', async () => {
        await createProduct('TestKape', 90, 10);

        const res = await request(app)
            .post('/api/waste')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ productName: 'TestKape', quantity: 3, price: 90, reason: 'Unit Test' });
        expect(res.status).toBe(201);

        const product = await getProduct('TestKape');
        expect(Number(product.stock)).toBe(7);
    });
});

describe('Order void', () => {
    test('voiding restores stock, rejects double-void, needs auth', async () => {
        await createProduct('TestHaloHalo', 95, 4);

        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                paymentMethod: 'Cash',
                items: [{ name: 'TestHaloHalo', quantity: 4, price: 95 }],
                total: 380
            });
        expect(created.status).toBe(201);
        const orderId = created.body._id;
        expect(Number((await getProduct('TestHaloHalo')).stock)).toBe(0);

        const voidRes = await request(app)
            .patch(`/api/orders/${orderId}/void`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ reason: 'Customer changed mind' });
        expect(voidRes.status).toBe(200);
        expect(voidRes.body.status).toBe('Voided');
        expect(voidRes.body.voidReason).toBe('Customer changed mind');
        expect(Number((await getProduct('TestHaloHalo')).stock)).toBe(4);

        const doubleVoid = await request(app)
            .patch(`/api/orders/${orderId}/void`)
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(doubleVoid.status).toBe(409);

        const noAuth = await request(app)
            .patch(`/api/orders/${orderId}/void`)
            .send({ reason: 'no token' });
        expect(noAuth.status).toBe(401);
    });
});

describe('Security hardening', () => {
    test('password change rejects <8 characters → 400', async () => {
        const res = await request(app)
            .put('/api/auth/password')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ currentPassword: 'admin123', newPassword: 'short' });
        expect(res.status).toBe(400);
    });

    test('user create rejects <8 character passwords → 400', async () => {
        const res = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'weakuser', password: 'tiny', role: 'Cashier' });
        expect(res.status).toBe(400);
    });

    test('user password reset rejects <8 characters → 400', async () => {
        const created = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'pwresetuser', password: 'strongpass1', role: 'Cashier' });
        expect(created.status).toBe(201);

        const res = await request(app)
            .put(`/api/users/${created.body._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ password: 'tiny' });
        expect(res.status).toBe(400);
    });

    test('oversized JSON body → 413', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({ padding: 'x'.repeat(300000) });
        expect(res.status).toBe(413);
    });

    test('product route still accepts a large image payload', async () => {
        const res = await request(app)
            .post('/api/products')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'BigImageDish', category: 'Test', price: 50, image: `data:image/png;base64,${'A'.repeat(200000)}` });
        expect(res.status).toBe(201);
    });

    test('no CORS header on API responses', async () => {
        const res = await request(app)
            .get('/api/health')
            .set('Origin', 'https://evil.example');
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
});