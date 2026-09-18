/* ==========================================================================
   Season 3 POS — AI insights tests
   Pure-function tests for backend/ai-insights.js plus endpoint auth checks.
   ========================================================================== */

process.env.JWT_SECRET = 'test-secret';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const {
    computeInsights,
    forecastRevenue,
    computeRestock,
    computeWasteInsights
} = require('../ai-insights');

const DAY_MS = 86400000;

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

function daysAgo(n, hour = 12) {
    const d = new Date(Date.now() - n * DAY_MS);
    d.setHours(hour, 0, 0, 0);
    return d;
}

function makeOrder(total, nDaysAgo, extra = {}) {
    return {
        date: daysAgo(nDaysAgo),
        status: 'Completed',
        total,
        items: [],
        ...extra
    };
}

describe('forecastRevenue', () => {
    test('returns null when there is not enough data', () => {
        expect(forecastRevenue({}, 1)).toBeNull();
    });

    test('forecasts a plausible value with a sane band', () => {
        const daily = {};
        for (let i = 0; i < 28; i++) {
            const d = new Date(Date.now() - i * DAY_MS);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            daily[k] = 1000 + (i % 5) * 100;
        }
        const f = forecastRevenue(daily, 4);
        expect(f).not.toBeNull();
        expect(f.forecast).toBeGreaterThan(0);
        expect(f.low).toBeLessThanOrEqual(f.forecast);
        expect(f.high).toBeGreaterThanOrEqual(f.forecast);
    });
});

describe('computeRestock', () => {
    test('flags an item running out within 3 days and suggests an order', () => {
        const sold = { 'Chicken Rice': 70 };  // 5/day over 14 days
        const wasted = {};
        const products = [{ name: 'Chicken Rice', stock: 10, lowStockThreshold: 10 }];
        const out = computeRestock(sold, wasted, products, {});
        expect(out.length).toBe(1);
        expect(out[0].name).toBe('Chicken Rice');
        expect(out[0].daysLeft).toBeLessThan(3);
        expect(out[0].suggestedOrder).toBeGreaterThan(0);
    });

    test('ignores items with healthy stock', () => {
        const sold = { 'Chicken Rice': 14 }; // 1/day
        const products = [{ name: 'Chicken Rice', stock: 100, lowStockThreshold: 10 }];
        expect(computeRestock(sold, {}, products, {})).toEqual([]);
    });
});

describe('computeWasteInsights', () => {
    test('flags items whose waste exceeds 15% of sales', () => {
        const sold = { 'Fried Chicken': 20 };
        const wasted = { 'Fried Chicken': 10 }; // 50% ratio
        const docs = [{ productName: 'Fried Chicken', category: 'Cs & Fs', quantity: 10, totalCost: 200, date: new Date() }];
        const out = computeWasteInsights(sold, wasted, docs);
        expect(out.items.length).toBe(1);
        expect(out.items[0].name).toBe('Fried Chicken');
        expect(out.items[0].ratio).toBe(0.5);
        expect(out.categories[0].category).toBe('Cs & Fs');
        expect(out.categories[0].cost).toBe(200);
    });

    test('reports every wasted item with its ratio so the dashboard can flag heavy waste', () => {
        const out = computeWasteInsights({ A: 100 }, { A: 2 }, []);
        expect(out.items.length).toBe(1);
        expect(out.items[0].name).toBe('A');
        expect(out.items[0].ratio).toBe(0.02);
    });

    test('flags waste with zero sales as 100%, not Infinity', () => {
        const out = computeWasteInsights({}, { 'No Sales Item': 5 }, []);
        expect(out.items.length).toBe(1);
        expect(out.items[0].ratio).toBe(1);
    });
});

describe('computeInsights', () => {
    test('produces the full shape with empty data', () => {
        const r = computeInsights({ orders: [], products: [], inventory: [], waste: [] });
        expect(r.forecast).toBeNull();
        expect(r.topItems).toEqual([]);
        expect(r.restock).toEqual([]);
        expect(Array.isArray(r.anomalies)).toBe(true);
        expect(r.meta.hasData).toBe(false);
    });

    test('forecasts and detects anomalies from synthetic orders', () => {
        const orders = [];
        // 28 days of healthy revenue + one recent crash day.
        for (let i = 1; i <= 28; i++) orders.push(makeOrder(1000 + (i % 4) * 50, i));
        orders.push(makeOrder(150, 1));  // crash yesterday
        orders.push(makeOrder(3000, 2, { status: 'Voided' }));
        orders.push(makeOrder(600, 3, { status: 'Voided' }));
        orders.push(makeOrder(550, 4, { status: 'Voided' }));

        const products = [
            { name: 'Chicken Rice', stock: 5, lowStockThreshold: 10 }
        ];
        const inventory = [];
        const waste = [{ productName: 'Chicken Rice', category: 'Cs & Fs', quantity: 20, totalCost: 1700, date: new Date() }];

        const r = computeInsights({ orders, products, inventory, waste });
        expect(r.forecast).not.toBeNull();
        expect(r.meta.hasData).toBe(true);
        expect(Array.isArray(r.restock)).toBe(true);
        expect(r.anomalies.some(a => a.type === 'revenue-drop')).toBe(true);
    });
});

describe('GET /api/insights endpoint', () => {
    test('rejects anonymous requests → 401', async () => {
        const res = await request(app).get('/api/insights');
        expect(res.status).toBe(401);
    });

    test('rejects cashier role → 403', async () => {
        const res = await request(app)
            .get('/api/insights')
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(res.status).toBe(403);
    });

    test('allows admin and returns the insights shape', async () => {
        const res = await request(app)
            .get('/api/insights')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.forecast).not.toBe('undefined');
        expect(Array.isArray(res.body.restock)).toBe(true);
        expect(Array.isArray(res.body.anomalies)).toBe(true);
        expect(typeof res.body.meta.generatedAt).toBe('string');
    });
});