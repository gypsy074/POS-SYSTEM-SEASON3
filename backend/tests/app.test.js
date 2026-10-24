/* ==========================================================================
   Season 3 POS — backend API tests
   Runs against an in-memory MongoDB (mongodb-memory-server).
   ========================================================================== */

process.env.JWT_SECRET = 'test-secret';
process.env.SEED_ADMIN_PASSWORD = 'admin123';

const { spawnSync } = require('child_process');
const path = require('path');
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

async function createProduct(name, price, stock, category = 'Test') {
    const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, price, stock, category });
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
    test('production server refuses to start without an explicit JWT secret', () => {
        const env = { ...process.env, NODE_ENV: 'production', JWT_SECRET: ' ' };
        delete env.RENDER;
        delete env.MONGO_URI;
        const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
            cwd: path.join(__dirname, '..'),
            env,
            encoding: 'utf8',
            timeout: 10000
        });

        expect(result.status).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toContain('JWT_SECRET must be configured');
    });

    test('password reset rejects command-line passwords without echoing them', () => {
        const sentinel = 'do-not-print-this-password';
        const scriptPath = path.join(__dirname, '..', 'scripts', 'reset-admin-password.js');
        const result = spawnSync(process.execPath, [scriptPath, 'admin', sentinel], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, MONGO_URI: '' },
            encoding: 'utf8',
            timeout: 10000
        });
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).toContain('Do not pass passwords as command-line arguments');
        expect(output).not.toContain(sentinel);
    });

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

describe('Session authorization changes', () => {
    test('same account can list both active sign-ins and identify its own session', async () => {
        const created = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'multi-session-test', password: 'tester123', role: 'Cashier' });
        expect(created.status).toBe(201);

        const firstLogin = await login('multi-session-test', 'tester123');
        const secondLogin = await login('multi-session-test', 'tester123');
        expect(firstLogin.status).toBe(200);
        expect(secondLogin.status).toBe(200);

        const sessions = await request(app)
            .get('/api/auth/sessions')
            .set('Authorization', `Bearer ${firstLogin.token}`);
        expect(sessions.status).toBe(200);
        expect(sessions.headers['cache-control']).toContain('no-store');
        expect(sessions.body.sessions).toHaveLength(2);
        expect(sessions.body.sessions.filter(session => session.isCurrent)).toHaveLength(1);
        expect(sessions.body.sessions.every(session => session.jti)).toBe(true);
    });

    test('changing a user role invalidates their existing token', async () => {
        const created = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'session-role-test', password: 'tester123', role: 'Cashier' });
        expect(created.status).toBe(201);

        const userLogin = await login('session-role-test', 'tester123');
        expect(userLogin.status).toBe(200);

        const updated = await request(app)
            .put(`/api/users/${created.body._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ role: 'Manager' });
        expect(updated.status).toBe(200);

        const oldSession = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${userLogin.token}`);
        expect(oldSession.status).toBe(401);

        const newLogin = await login('session-role-test', 'tester123');
        expect(newLogin.status).toBe(200);
        expect(newLogin.role).toBe('Manager');
    });

    test('deleting a user revokes their active session immediately', async () => {
        const created = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'session-revoke-test', password: 'tester123', role: 'Cashier' });
        expect(created.status).toBe(201);

        const userLogin = await login('session-revoke-test', 'tester123');
        expect(userLogin.status).toBe(200);
        const beforeDelete = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${userLogin.token}`);
        expect(beforeDelete.status).toBe(200);

        const deleted = await request(app)
            .delete(`/api/users/${created.body._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleted.status).toBe(200);

        const afterDelete = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${userLogin.token}`);
        expect(afterDelete.status).toBe(401);
    });

    test('cashier manager-override failures are rate-limited', async () => {
        await createProduct('TestOverrideThrottle', 40, 2);
        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ items: [{ name: 'TestOverrideThrottle', quantity: 1, price: 40 }], total: 40 });
        expect(created.status).toBe(201);

        const clientIp = '203.0.113.42';
        for (let attempt = 0; attempt < 10; attempt++) {
            const denied = await request(app)
                .patch(`/api/orders/${created.body._id}/void`)
                .set('Authorization', `Bearer ${cashierToken}`)
                .set('X-Forwarded-For', clientIp)
                .send({ managerOverridePin: 'wrong-pin' });
            expect(denied.status).toBe(403);
        }
        const limited = await request(app)
            .patch(`/api/orders/${created.body._id}/void`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .set('X-Forwarded-For', clientIp)
            .send({ managerOverridePin: 'wrong-pin' });
        expect(limited.status).toBe(429);
    }, 30000);
});

describe('Audit log export paging', () => {
    test('date-bounded pages include target IDs and do not repeat entries', async () => {
        const uniqueSuffix = Date.now();
        const from = '2099-01-01';
        const to = '2099-01-01';
        const fixtureDate = new Date(2099, 0, 1, 12);
        await mongoose.connection.db.collection('auditlogs').insertMany([0, 1, 2].map(index => ({
            action: 'user.create',
            actor: 'admin',
            targetId: `audit-target-${uniqueSuffix}-${index}`,
            detail: `Audit paging fixture ${index}`,
            date: new Date(fixtureDate.getTime() + index)
        })));

        const query = `action=user.create&from=${encodeURIComponent(from)}&to=${to}&limit=2&sort=asc`;
        const first = await request(app)
            .get(`/api/audit?${query}&skip=0`)
            .set('Authorization', `Bearer ${adminToken}`);
        const second = await request(app)
            .get(`/api/audit?${query}&skip=2`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body).toHaveLength(2);
        expect(second.body).toHaveLength(1);
        const targetIds = [...first.body, ...second.body].map(entry => entry.targetId);
        expect(new Set(targetIds).size).toBe(3);
        expect(targetIds).toEqual(expect.arrayContaining([0, 1, 2].map(index => `audit-target-${uniqueSuffix}-${index}`)));
    });
});

describe('Orders & stock', () => {
    test('cashier identity is server-controlled and order history is isolated', async () => {
        const userRes = await request(app)
            .post('/api/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ username: 'othercashier', password: 'tester123', role: 'Cashier' });
        expect([201, 409]).toContain(userRes.status);
        const otherLogin = await login('othercashier', 'tester123');
        expect(otherLogin.status).toBe(200);

        await createProduct('TestIdentityDish', 75, 3);
        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'othercashier',
                items: [{ name: 'TestIdentityDish', quantity: 1, price: 75 }],
                total: 75
            });
        expect(created.status).toBe(201);
        expect(created.body.cashier).toBe('tester');

        const otherOrders = await request(app)
            .get('/api/orders')
            .set('Authorization', `Bearer ${otherLogin.token}`);
        expect(otherOrders.status).toBe(200);
        expect(otherOrders.body.some(order => String(order._id) === String(created.body._id))).toBe(false);

        const adminOrders = await request(app)
            .get('/api/orders')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(adminOrders.status).toBe(200);
        expect(adminOrders.body.some(order => String(order._id) === String(created.body._id))).toBe(true);
    });

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

    test('gcash orders persist a numeric reference number', async () => {
        await createProduct('TestGcashItem', 110, 4);

        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                paymentMethod: 'G-Cash',
                referenceNo: '123456',
                items: [{ name: 'TestGcashItem', quantity: 1, price: 110 }],
                total: 110
            });

        expect(res.status).toBe(201);
        expect(res.body.referenceNo).toBe('123456');
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
    test('cashier cannot void another cashier order', async () => {
        const otherLogin = await login('othercashier', 'tester123');
        expect(otherLogin.status).toBe(200);
        await createProduct('TestOwnershipDish', 85, 2);

        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ items: [{ name: 'TestOwnershipDish', quantity: 1, price: 85 }], total: 85 });
        expect(created.status).toBe(201);

        const voidRes = await request(app)
            .patch(`/api/orders/${created.body._id}/void`)
            .set('Authorization', `Bearer ${otherLogin.token}`)
            .send({ managerOverridePin: 'admin123' });
        expect(voidRes.status).toBe(403);
        expect((await getProduct('TestOwnershipDish')).stock).toBe(1);
    });

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
            .send({ reason: 'Customer changed mind', managerOverridePin: 'admin123' });
        expect(voidRes.status).toBe(200);
        expect(voidRes.body.status).toBe('Voided');
        expect(voidRes.body.voidReason).toBe('Customer changed mind');
        expect(Number((await getProduct('TestHaloHalo')).stock)).toBe(4);

        const doubleVoid = await request(app)
            .patch(`/api/orders/${orderId}/void`)
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ managerOverridePin: 'admin123' });
        expect(doubleVoid.status).toBe(409);

        const noAuth = await request(app)
            .patch(`/api/orders/${orderId}/void`)
            .send({ reason: 'no token' });
        expect(noAuth.status).toBe(401);
    });
});

describe('Order delete guard', () => {
    test('admin cannot hard-delete a paid (non-voided) order → 409', async () => {
        await createProduct('TestDeleteGuard', 80, 3);

        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestDeleteGuard', quantity: 1, price: 80 }],
                total: 80
            });
        expect(created.status).toBe(201);

        const del = await request(app)
            .delete(`/api/orders/${created.body._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(del.status).toBe(409);

        const stillThere = await request(app)
            .get('/api/orders?limit=5000')
            .set('Authorization', `Bearer ${adminToken}`);
        expect((stillThere.body || []).some(o => String(o._id) === String(created.body._id))).toBe(true);
    });

    test('admin cannot hard-delete an already-voided order → 409 and record remains', async () => {
        await createProduct('TestDeleteVoided', 70, 3);

        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestDeleteVoided', quantity: 1, price: 70 }],
                total: 70
            });
        expect(created.status).toBe(201);

        const voidRes = await request(app)
            .patch(`/api/orders/${created.body._id}/void`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(voidRes.status).toBe(200);

        const del = await request(app)
            .delete(`/api/orders/${created.body._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(del.status).toBe(409);

        const stillThere = await request(app)
            .get('/api/orders?limit=5000')
            .set('Authorization', `Bearer ${adminToken}`);
        expect((stillThere.body || []).some(o => String(o._id) === String(created.body._id))).toBe(true);
    });

    test('refunded order cannot be voided again or restore stock twice', async () => {
        await createProduct('TestRefundThenVoid', 45, 3);

        const created = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestRefundThenVoid', quantity: 1, price: 45 }],
                total: 45
            });
        expect(created.status).toBe(201);
        expect(Number((await getProduct('TestRefundThenVoid')).stock)).toBe(2);

        const refund = await request(app)
            .post(`/api/orders/${created.body._id}/refund`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(refund.status).toBe(200);
        expect(Number((await getProduct('TestRefundThenVoid')).stock)).toBe(3);

        const voidRes = await request(app)
            .patch(`/api/orders/${created.body._id}/void`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(voidRes.status).toBe(409);
        expect(Number((await getProduct('TestRefundThenVoid')).stock)).toBe(3);
    });
});

describe('Orders fetch bounds', () => {
    test('?limit= caps the number of orders returned', async () => {
        await createProduct('TestCapper', 30, 20);
        for (let i = 0; i < 3; i++) {
            await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${cashierToken}`)
                .send({ cashier: 'tester', items: [{ name: 'TestCapper', quantity: 1, price: 30 }] });
        }

        const res = await request(app)
            .get('/api/orders?limit=2')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeLessThanOrEqual(2);
    });

    test('?skip returns the next page without repeating order IDs', async () => {
        await createProduct('TestOrderPaging', 30, 20);
        for (let i = 0; i < 3; i++) {
            await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${cashierToken}`)
                .send({ cashier: 'tester', items: [{ name: 'TestOrderPaging', quantity: 1, price: 30 }] });
        }

        const first = await request(app)
            .get('/api/orders?limit=2&skip=0')
            .set('Authorization', `Bearer ${adminToken}`);
        const second = await request(app)
            .get('/api/orders?limit=2&skip=2')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body).toHaveLength(2);
        expect(second.body).toHaveLength(2);
        expect(first.body.map(order => String(order._id))).not.toEqual(second.body.map(order => String(order._id)));
    });

    test('out-of-range params are ignored (no 500, no filtering)', async () => {
        const res = await request(app)
            .get('/api/orders?days=9999&limit=-5')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
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

    test('CORS header follows the configured CORS_ORIGIN policy', async () => {
        const res = await request(app)
            .get('/api/health')
            .set('Origin', 'https://evil.example');
        expect(res.status).toBe(200);
        const allowed = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
        const header = res.headers['access-control-allow-origin'];
        if (allowed.includes('*')) {
            expect(header).toBe('*'); // local dev opts into open CORS
        } else if (allowed.length === 0) {
            expect(header).toBeUndefined(); // no CORS by default (e.g. live deploy)
        } else {
            expect(allowed).toContain(header); // explicit origin list
        }
    });
});

// Regression suite for the string-_id bug (older data rebuilt from raw JSON
// backups stores _id as plain strings; mongoose's findById casts to ObjectId
// and silently misses them — every _id lookup must match both forms).
describe('Category management', () => {
    test('creates a category, rejects duplicates', async () => {
        const created = await request(app)
            .post('/api/categories')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Cat-Test-A' });
        expect(created.status).toBe(201);

        const dup = await request(app)
            .post('/api/categories')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'cat-test-a' }); // case-insensitive
        expect(dup.status).toBe(409);
    });

    test('cashier cannot create a category → 403', async () => {
        const res = await request(app)
            .post('/api/categories')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({ name: 'Nope' });
        expect(res.status).toBe(403);
    });

    test('renaming a category reassigns its products', async () => {
        const product = await createProduct('CatTestDrink', 40, 5);
        await request(app)
            .put(`/api/products/${product._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ category: 'Cat-Test-A' });

        const renamed = await request(app)
            .put('/api/categories/Cat-Test-A')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Cat-Test-B' });
        expect(renamed.status).toBe(200);

        const updated = await getProduct('CatTestDrink');
        expect(updated.category).toBe('Cat-Test-B');
    });

    test('deleting a category with products is blocked with a count', async () => {
        const res = await request(app)
            .delete('/api/categories/Cat-Test-B')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(409);
        expect(String(res.body.error)).toMatch(/1 product\(s\) still use it/);
    });

    test('deleting an empty category succeeds', async () => {
        const product = await getProduct('CatTestDrink');
        const res = await request(app)
            .delete('/api/categories/Cat-Test-B')
            .set('Authorization', `Bearer ${adminToken}`);
        // Still blocked — the product is still there; move it first.
        expect(res.status).toBe(409);
        await request(app)
            .put(`/api/products/${product._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ category: 'Test' });
        const gone = await request(app)
            .delete('/api/categories/Cat-Test-B')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(gone.status).toBe(200);
    });
});

describe('Senior discount', () => {
    test('Senior order: drinks receive 20% discount and amounts are server-computed', async () => {
        await createProduct('TestSeniorDrink', 100, 3, 'Drinks');
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestSeniorDrink', quantity: 2, price: 100 }],
                total: 9999, // must be ignored — server recomputes
                discountType: 'Senior',
                discountId: 'SC-123456789',
                discountName: 'Lola Maria'
            });
        expect(res.status).toBe(201);
        expect(Number(res.body.subtotal)).toBe(200);
        expect(Number(res.body.discountAmount)).toBe(40);
        expect(Number(res.body.total)).toBe(160);
        expect(res.body.discountType).toBe('Senior');
        expect(res.body.discountId).toBe('SC-123456789');
    });

    test('Senior discount without SC/PWD ID or name → 400', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestSeniorDrink', quantity: 1, price: 100 }],
                discountType: 'Senior',
                discountName: 'Lola Maria'
            });
        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/SC\/PWD ID/);
    });

    test('unknown discount type → 400', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestSeniorDrink', quantity: 1, price: 100 }],
                discountType: 'PWD'
            });
        expect(res.status).toBe(400);
    });

    test('Senior discount does not apply to meals', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${cashierToken}`)
            .send({
                cashier: 'tester',
                items: [{ name: 'TestSeniorMeal', quantity: 1, price: 100 }],
                total: 123,
                discountType: 'Senior',
                discountId: 'SC-MEAL',
                discountName: 'Lola Maria'
            });
        expect(res.status).toBe(201);
        expect(Number(res.body.total)).toBe(100);
        expect(Number(res.body.discountAmount)).toBe(0);
        expect(res.body.discountType).toBe('Senior');
    });
});

describe('String _id compatibility', () => {
    const STRING_ID = '6a7b094a51820109b91dc302';

    async function insertRaw(collection, doc) {
        await mongoose.connection.db.collection(collection).insertOne(doc);
    }

    test('product with a string _id is updated and deleted by id', async () => {
        await insertRaw('products', {
            _id: STRING_ID,
            name: 'String-Id Product',
            category: 'Test',
            price: 50,
            stock: 10,
            lowStockThreshold: 5,
            status: 'Available'
        });

        const listed = await request(app)
            .get('/api/products')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(listed.status).toBe(200);
        expect(listed.body.some(p => String(p._id) === STRING_ID)).toBe(true);

        const updated = await request(app)
            .put(`/api/products/${STRING_ID}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ price: 75 });
        expect(updated.status).toBe(200);
        expect(Number(updated.body.price)).toBe(75);

        const deleted = await request(app)
            .delete(`/api/products/${STRING_ID}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleted.status).toBe(200);
    });

    test('waste entry with a string _id is deleted by id (the original bug)', async () => {
        await insertRaw('wasteitems', {
            _id: STRING_ID,
            productName: 'String-Id Waste',
            category: 'Test',
            cashier: 'tester',
            quantity: 1,
            price: 10,
            totalCost: 10,
            reason: 'string-id regression',
            date: new Date()
        });

        const del = await request(app)
            .delete(`/api/waste/${STRING_ID}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(del.status).toBe(200);

        const after = await request(app)
            .get('/api/waste')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(after.body.some(w => String(w._id) === STRING_ID)).toBe(false);
    });

    test('order with a string _id is fetched and voided; deleting preserves it', async () => {
        await insertRaw('orders', {
            _id: STRING_ID,
            customer: 'String-Id Customer',
            cashier: 'tester',
            mode: 'Dine In',
            paymentMethod: 'Cash',
            status: 'Completed',
            date: new Date(),
            receiptId: 'STRIDTEST',
            items: [{ name: 'Anything', quantity: 1, price: 10 }],
            total: 10,
            tendered: 10,
            change: 0
        });

        const listed = await request(app)
            .get('/api/orders')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(listed.status).toBe(200);
        expect(listed.body.some(o => String(o._id) === STRING_ID)).toBe(true);

        const voided = await request(app)
            .patch(`/api/orders/${STRING_ID}/void`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(voided.status).toBe(200);
        expect(voided.body.status).toBe('Voided');

        const deleted = await request(app)
            .delete(`/api/orders/${STRING_ID}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(deleted.status).toBe(409);

        const afterDelete = await request(app)
            .get('/api/orders')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(afterDelete.body.some(order => String(order._id) === STRING_ID)).toBe(true);
    });
});