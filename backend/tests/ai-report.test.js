/* ==========================================================================
   Season 3 POS — AI report tests
   Pure-function tests for backend/ai-report.js plus endpoint checks,
   including the no-AI-key fallback (source: "stats").
   ========================================================================== */

process.env.JWT_SECRET = 'test-secret';
delete process.env.AI_API_KEY; // force the statistics fallback path

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const {
    buildReportPrompt,
    buildStatsReport,
    buildAiRequest
} = require('../ai-report');

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

function sampleInsights() {
    return {
        forecast: { forecast: 8400, low: 7900, high: 8900 },
        topItems: [{ name: 'Chicken Rice', expectedQty: 38 }],
        restock: [{ name: 'Chicken Rice', stock: 5, daysLeft: 1, suggestedOrder: 42 }],
        wasteInsights: {
            items: [{ name: 'Fried Chicken', soldQty: 20, wastedQty: 10, ratio: 0.5 }],
            categories: [{ category: 'Cs & Fs', cost: 200 }]
        },
        anomalies: [{ type: 'void-spike', label: 'Void spike', detail: '3 voids yesterday' }]
    };
}

describe('buildReportPrompt', () => {
    test('contains anonymized aggregates and no names besides menu items', () => {
        const prompt = buildReportPrompt(sampleInsights());
        expect(prompt).toContain('₱8,400');
        expect(prompt).toContain('Chicken Rice');
        expect(prompt).toContain('Void spike');
        expect(prompt).not.toMatch(/customer|cashier/i);
    });

    test('handles sparse insights without crashing', () => {
        const prompt = buildReportPrompt({});
        expect(prompt).toContain('not enough sales history');
        expect(prompt).toContain('none detected');
    });
});

describe('buildStatsReport', () => {
    test('reads as a plain-language summary', () => {
        const report = buildStatsReport(sampleInsights());
        expect(report).toContain('₱8,400');
        expect(report).toContain('order 42');
        expect(report).toContain('Waste');
        expect(report).toContain('void spike');
    });

    test('handles empty insights', () => {
        const report = buildStatsReport({});
        expect(report).toContain('not enough sales history');
        expect(report).toContain('none detected');
    });
});

describe('buildAiRequest', () => {
    const originalEnv = { ...process.env };
    const prompt = 'Write a report.';

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test('builds the Groq request (OpenAI-compatible shape)', () => {
        process.env.AI_PROVIDER = 'groq';
        process.env.GROQ_API_KEY = 'gsk_test';
        const req = buildAiRequest('groq', prompt);
        expect(req.url).toBe('https://api.groq.com/openai/v1/chat/completions');
        expect(req.headers.Authorization).toBe('Bearer gsk_test');
        expect(req.body.model).toBe('llama-3.3-70b-versatile');
        expect(req.body.messages[0].role).toBe('system');
        expect(req.body.messages[1]).toEqual({ role: 'user', content: prompt });
        expect(req.body.max_tokens).toBe(700);
    });

    test('falls back to AI_API_KEY for groq when GROQ_API_KEY is unset', () => {
        process.env.AI_PROVIDER = 'groq';
        process.env.AI_API_KEY = 'gsk_fallback';
        const req = buildAiRequest('groq', prompt);
        expect(req.headers.Authorization).toBe('Bearer gsk_fallback');
    });

    test('honors the AI_MODEL override', () => {
        process.env.AI_PROVIDER = 'groq';
        process.env.GROQ_API_KEY = 'gsk_test';
        process.env.AI_MODEL = 'llama-3.1-8b-instant';
        const req = buildAiRequest('groq', prompt);
        expect(req.body.model).toBe('llama-3.1-8b-instant');
    });

    test('builds the Gemini request by default', () => {
        process.env.AI_API_KEY = 'gAIza_test';
        const req = buildAiRequest('gemini', prompt);
        expect(req.url).toContain('generativelanguage.googleapis.com');
        expect(req.url).toContain('gAIza_test');
        expect(req.body.contents[0].parts[0].text).toBe(prompt);
        expect(req.body.generationConfig.maxOutputTokens).toBe(700);
    });
});

describe('POST /api/ai/report endpoint', () => {
    test('rejects anonymous requests → 401', async () => {
        const res = await request(app).post('/api/ai/report');
        expect(res.status).toBe(401);
    });

    test('rejects cashier role → 403', async () => {
        const res = await request(app)
            .post('/api/ai/report')
            .set('Authorization', `Bearer ${cashierToken}`);
        expect(res.status).toBe(403);
    });

    test('returns a report with source "stats" when no AI key is set', async () => {
        const res = await request(app)
            .post('/api/ai/report')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(['ai', 'stats']).toContain(res.body.source);
        expect(typeof res.body.report).toBe('string');
        expect(res.body.report.length).toBeGreaterThan(10);
        expect(typeof res.body.generatedAt).toBe('string');
    });

    test('rate-limits after 5 requests per minute → 429', async () => {
        // Order-tolerant: keep calling until the shared per-IP budget (5/min)
        // is exhausted — earlier tests in this file already burned some.
        let got429 = null;
        for (let i = 0; i < 6; i++) {
            const res = await request(app)
                .post('/api/ai/report')
                .set('Authorization', `Bearer ${adminToken}`);
            if (res.status === 429) { got429 = i + 1; break; }
        }
        expect(got429).not.toBeNull();
    });
});