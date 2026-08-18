// The canteen runs on Philippine time. Render containers default to UTC, so
// without this the server-side "today" groupings (insights, forecast, anomaly
// days) drift 8 hours away from what the dashboard shows in Manila.
process.env.TZ = 'Asia/Manila';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const dns = require('dns');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Prefer IPv4 — Atlas `mongodb+srv` lookups can hang on Windows Node when
// an AAAA record is awaited first (getaddrinfo EAI_AGAIN / timeouts).
dns.setDefaultResultOrder('ipv4first');

const app = express();

// Render sits behind a proxy — express-rate-limit validates X-Forwarded-For
// and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR (intermittent 500s) unless
// the app trusts the proxy hop.
app.set('trust proxy', 1);

// JWT signing secret — never run on Render with the public dev fallback.
// Render services always set RENDER=true, so a missing JWT_SECRET there is
// a fatal misconfiguration, not a local convenience.
const JWT_SECRET = process.env.JWT_SECRET || (process.env.RENDER ? null : 'season3-pos-dev-secret');
if (!JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET is not set on this Render service.');
    console.error('   Add it under Render → Environment (e.g. from "node -e ' + "'console.log(require('crypto').randomBytes(32).toString('hex')))" + '" ), then redeploy.');
    process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// Middleware Engine Configuration
// The frontend is served same-origin by this Express app, so CORS is not
// needed at all — default to no cross-origin access. Override via the
// CORS_ORIGIN env var (comma-separated list) if a real client ever needs it.
const rawCorsOrigin = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
// The cors package only treats a plain '*' as the wildcard — a '*' inside an
// array is compared literally and never matches. Normalize it up front.
const corsOrigin = rawCorsOrigin.length === 0
    ? false
    : (rawCorsOrigin.includes('*') ? '*' : rawCorsOrigin);

app.use(cors({ origin: corsOrigin }));
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
// gzip all JSON + static responses — the orders payload alone is 5-10x
// smaller on the wire with it.
app.use(compression());
// Tight global body limit — product routes opt into a larger payload
// (image data-URLs) via a path-dispatched parser, everything else keeps
// the default ~100kb cap.
app.use((req, res, next) => {
    if (req.path.startsWith('/api/products')) {
        express.json({ limit: '10mb' })(req, res, next);
    } else {
        express.json()(req, res, next);
    }
});
app.use(express.urlencoded({ extended: true }));

// Realtime visit logging — prints who accesses the POS to the terminal
// (and streams to Render dashboard logs in production). Only meaningful
// traffic is logged: page loads, non-GET actions and 5xx errors — the
// frontend's 20-30s data polls, /api/health, static assets and bot 404s
// are skipped so the log stays readable.
app.use((req, res, next) => {
    res.on('finish', () => {
        if (process.env.NODE_ENV === 'test') return;
        const url = req.originalUrl;
        const isPageLoad = url === '/' || /\.html$/.test(url);
        const isAction = req.method !== 'GET';
        const isError = res.statusCode >= 500;
        if (!isPageLoad && !isAction && !isError) return;
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        console.log(`👁 ${new Date().toLocaleTimeString()} ${res.statusCode} ${req.method} ${url} · ${ip} · ${(req.get('user-agent') || '').slice(0, 60)}`);
    });
    next();
});

app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    // HTML must always revalidate so every device picks up new script versions.
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// Brute-force guard for the login endpoint — 10 failed attempts per 15 min
// per IP. Successful logins never consume the budget, so legitimate staff
// logging in often (or automated tests) can't lock everyone out.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

// Valid bcrypt hash of a random throwaway string — burned once when a login
// hits an unknown username so timing doesn't leak account existence.
const DUMMY_BCRYPT_HASH = '$2b$10$ar11.Gs8ucHBPvwSbx/DIOCAxZ4jmsGIqh6Zi/oI0in4E9nLBeVs.';

// Strict Database Connection Token Processing
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error('❌ FATAL: MONGO_URI is not defined in .env file. Server cannot start.');
    process.exit(1);
}

mongoose.connection.on('connected', () => {
    const dbName = mongoose.connection.db?.databaseName || 'unknown';
    console.log(`✅ [MongoDB] Connected to MongoDB Atlas — Database: "${dbName}"`);
});

mongoose.connection.on('error', err => {
    console.error(`❌ [MongoDB] Database Connection Error:`, err.message);
});

mongoose.connection.on('disconnected', () => {
    console.warn(`❌ [MongoDB] Disconnected. Attempting to reconnect...`);
});

mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: true
}).catch(err => {
    console.error(`❌ [MongoDB] Initial Connection Failed:`, err.message);
    console.error('   → Check your MONGO_URI in .env and ensure your IP is whitelisted in Atlas.');
});

/* ==========================================================================
   1. DATABASE DATA MODELS & STRUCUTURAL SCHEMAS
   ========================================================================== */

// --- Order System Schema Configuration ---
const orderItemSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, required: true, min: 0, default: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    customer: { type: String, default: "Walk-in Customer", trim: true },
    cashier: { type: String, default: "Pranselen", trim: true },
    tableNo: { type: String, default: "" },
    mode: { type: String, enum: ["Dine In", "To Go", "Online Order"], default: "Dine In" },
    paymentMethod: { type: String, enum: ["Cash", "G-Cash"], default: "Cash" },
    status: { type: String, enum: ["Completed", "Voided"], default: "Completed" },
    voidedBy: { type: String, default: "" },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    receiptId: { type: String, default: () => String(Date.now()).slice(-8) },
    items: { type: [orderItemSchema], default: [] },
total: { type: Number, default: 0, min: 0 },
    tendered: { type: Number, default: 0, min: 0 },
    change: { type: Number, default: 0, min: 0 },
    // Senior/PWD discount — server computes the amounts, never trusts the
    // client total when a discount is present. discountId is the SC/PWD ID.
    discountType: { type: String, enum: ["", "Senior"], default: "" },
    discountRate: { type: Number, default: 0, min: 0, max: 0.2 },
    discountAmount: { type: Number, default: 0, min: 0 },
    discountId: { type: String, default: "", trim: true },
    discountName: { type: String, default: "", trim: true },
    subtotal: { type: Number, default: 0, min: 0 },
    // Idempotency key for offline sync retries — must be unique per order.
    clientOrderId: { type: String, trim: true }
});
orderSchema.index({ clientOrderId: 1 }, { unique: true, sparse: true });
// Insights queries orders by date range — keep the scan on an index.
orderSchema.index({ date: 1 });
const Order = mongoose.model('Order', orderSchema);

// --- Menu Management Schema Configuration ---
const productSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    status: { type: String, default: "Available" },
    image: { type: String, default: "" },
    stock: { type: Number, default: 999, min: 0 },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
productSchema.index({ stock: 1 });
const Product = mongoose.model('Product', productSchema);

// --- Crew User Account Schema Configuration ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['Admin', 'Cashier'], default: 'Admin' },
    status: { type: String, default: 'Active' },
    lastActiveAt: { type: Date, default: null },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const User = mongoose.model('User', userSchema);

// --- Active Session Schema Configuration ---
// One row per issued JWT — the `revoked` flag lets us kill a token instantly
// instead of waiting for its 8h expiry, and powers the "new sign-in" banner
// and "log out other sessions" feature. Expired rows auto-delete via TTL.
const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "", trim: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false }
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Session = mongoose.model('Session', sessionSchema);

// --- Stock Supply Inventory Schema Configuration ---
const inventorySchema = new mongoose.Schema({
    productName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    status: { type: String, default: 'Available' },
    menuProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
    unitsPerSale: { type: Number, default: 1, min: 0 },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const InventoryItem = mongoose.model('InventoryItem', inventorySchema);

// --- Food Waste Schema Configuration ---
const wasteSchema = new mongoose.Schema({
    productName: { type: String, required: true, trim: true },
    category: { type: String, default: "Uncategorized", trim: true },
    cashier: { type: String, default: "Pranselen", trim: true },
    quantity: { type: Number, required: true, min: 0.001 },
    price: { type: Number, default: 0, min: 0 },
    totalCost: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: "Other", trim: true },
    note: { type: String, default: "", trim: true },
    date: { type: Date, default: Date.now }
});
const WasteItem = mongoose.model('WasteItem', wasteSchema);

// --- Audit Log Schema Configuration ---
const logSchema = new mongoose.Schema({
    action: { type: String, required: true, trim: true },
    actor: { type: String, default: "", trim: true },
    targetId: { type: String, default: "", trim: true },
    detail: { type: String, default: "", trim: true },
    date: { type: Date, default: Date.now }
});
logSchema.index({ action: 1, date: -1 });
const AuditLog = mongoose.model('AuditLog', logSchema);

// Categories are first-class (reserved names persist even before any product
// uses them), but the source of truth for what the café actually offers is
// still the products — GET /api/categories returns the union of both.
const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true }
});
categorySchema.index({ name: 1 });
const Category = mongoose.model('Category', categorySchema);

// Owner email alerts — a single document holding recipient emails, alert
// toggles, and the dedup state (per-item low-stock and per-day summary).
const ownerAlertSettingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'owner-alerts' },
    recipients: { type: [String], default: [] },
    lowStockEnabled: { type: Boolean, default: true },
    dailySummaryEnabled: { type: Boolean, default: true },
    dailySummaryHour: { type: Number, default: 20, min: 0, max: 23 },
    lastDailySentDate: { type: String, default: '' },
    lowStockLastSent: { type: Map, of: String, default: {} }
});
const OwnerAlertSettings = mongoose.model('OwnerAlertSettings', ownerAlertSettingsSchema);

/* ==========================================================================
   2. UTILITY INTERCEPTORS & VALIDATION ENGINES
   ========================================================================== */

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

// Matches a document by id whether the stored _id is a plain string (older
// data rebuilt from raw JSON backups) or a proper ObjectId (new writes).
// A $expr/$toString comparison is used because mongoose casts regular
// { _id: ... } filters to the schema's ObjectId type, silently missing the
// string form — while $expr values are never cast. So every _id lookup goes
// through this filter instead.
function idMatchFilter(rawId) {
    const str = String(rawId || '');
    return { $expr: { $eq: [{ $toString: '$_id' }, str] } };
}

function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[abxy]\$/.test(value);
}

function normalizePaymentMethod(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'gcash' || normalized === 'g-cash') return 'G-Cash';
    if (normalized === 'cash') return 'Cash';
    return 'Cash';
}

function normalizeWastePayload(input) {
    const quantity = Math.max(0.001, Number(input.quantity) || 0);
    const price    = Math.max(0, Number(input.price) || 0);
    return {
        productName: String(input.productName || "").trim() || "Unknown Item",
        category: String(input.category || "Uncategorized").trim() || "Uncategorized",
cashier: String(input.cashier || "").trim(),
        quantity,
        price,
        totalCost: Number((quantity * price).toFixed(2)),
        reason: String(input.reason || "Other").trim() || "Other",
        note: String(input.note || "").trim().slice(0, 300),
        date: input.date ? new Date(input.date) : new Date()
    };
}

// Inventory items may be linked to a menu product — the linked product's
// data (name, category, price, stock, threshold) is inherited on save
// unless the form explicitly overrides a field. `existing` backs up any
// field neither the form nor the product provides (partial PUTs).
function inventoryFromPayload(input, product, existing) {
    const src = product || existing || {};
    const pickNum = function (field) {
        if (Number.isFinite(Number(input[field]))) return Math.max(0, Number(input[field]));
        if (Number.isFinite(Number(src[field]))) return Math.max(0, Number(src[field]));
        return undefined;
    };
    return {
        productName: String(input.productName || src.productName || src.name || "").trim() || "Unknown Item",
        category: String(input.category || src.category || "").trim() || "Uncategorized",
        price: pickNum("price"),
        stock: pickNum("stock"),
        status: input.status || src.status || 'Available',
        lowStockThreshold: pickNum("lowStockThreshold"),
        unitsPerSale: Number.isFinite(Number(input.unitsPerSale))
            ? Math.max(0, Number(input.unitsPerSale))
            : (Number.isFinite(Number(src.unitsPerSale)) ? Math.max(0, Number(src.unitsPerSale)) : 1),
        menuProductId: input.menuProductId === undefined
            ? (src.menuProductId || (product ? product._id : null) || null)
            : (input.menuProductId ? input.menuProductId : null)
    };
}

// Ingredient tracking: every sale or waste of a menu product moves its
// linked supply items by `quantity × unitsPerSale` — forward on sales and
// waste, backward on voids. Sold-out flags follow the ledger, mirroring the
// menu flow. Returns the linked items (callers use this for verification).
async function shiftLinkedSupplies(productName, quantity, sign) {
    const product = await Product.findOne({ name: productName }).select('_id');
    if (!product) return [];
    const supplies = await InventoryItem.find({ menuProductId: product._id });
    if (!supplies.length) return [];
    const ops = supplies.map(item => {
        const delta = quantity * Math.max(0, Number(item.unitsPerSale) || 0) * sign;
        return delta === 0 ? null : InventoryItem.updateOne(
            { _id: item._id },
            { $inc: { stock: delta } }
        );
    }).filter(Boolean);
    await Promise.all(ops);
    await InventoryItem.updateMany(
        { menuProductId: product._id, stock: { $lte: 0 } },
        { status: "Sold Out" }
    );
    await InventoryItem.updateMany(
        { menuProductId: product._id, stock: { $gt: 0 } },
        { status: "Available" }
    );
    return supplies;
}

function normalizeOrderPayload(input) {
    const items = Array.isArray(input.items)
        ? input.items.map(item => ({
            name: String(item.name || "Item").trim(),
            quantity: Math.max(1, Number(item.quantity) || 1),
            price: Math.max(0, Number(item.price) || 0)
        }))
        : [];

const computedTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const round2 = n => Math.round(n * 100) / 100;

    const rawDiscountType = String(input.discountType || "").trim();
    if (rawDiscountType && rawDiscountType !== "Senior") {
        throw new Error('Unknown discount type. Supported: "Senior".');
    }
    const discountType = rawDiscountType === "Senior" ? "Senior" : "";
    const payloadExtra = {};
    let discountRate = 0;
    let discountAmount = 0;
    let subtotal = computedTotal;
    let total = Number.isFinite(Number(input.total)) && Number(input.total) > 0
        ? Number(input.total)
        : computedTotal;

    if (discountType === "Senior") {
        discountRate = 0.2;
        subtotal = computedTotal;
        discountAmount = round2(subtotal * discountRate);
        total = round2(subtotal - discountAmount);
        const discountId = String(input.discountId || "").trim();
        const discountName = String(input.discountName || "").trim();
        if (!discountId || !discountName) {
            throw new Error('The Senior discount requires the SC/PWD ID and the customer name.');
        }
        if (discountId.length > 40 || discountName.length > 80) {
            throw new Error('The SC/PWD ID or customer name is too long.');
        }
        payloadExtra.discountId = discountId;
        payloadExtra.discountName = discountName;
    }

    const payload = {
        customer: String(input.customer || "Walk-in Customer").trim() || "Walk-in Customer",
        cashier: String(input.cashier || "").trim(),
        tableNo: String(input.tableNo || "").trim(),
        mode: ["Dine In", "To Go", "Online Order"].includes(input.mode) ? input.mode : "Dine In",
        paymentMethod: normalizePaymentMethod(input.paymentMethod),
        receiptId: String(input.receiptId || String(Date.now()).slice(-8)),
        date: input.date ? new Date(input.date) : new Date(),
        items,
        total,
        subtotal,
        discountType,
        discountRate,
        discountAmount,
        discountId: payloadExtra.discountId || "",
        discountName: payloadExtra.discountName || "",
        tendered: Math.max(0, Number(input.tendered) || 0),
        change: Math.max(0, Number(input.change) || 0)
    };

    const clientOrderId = String(input.clientOrderId || "").trim().slice(0, 100);
    if (clientOrderId) {
        payload.clientOrderId = clientOrderId;
    }

    return payload;
}

function sanitizeUser(user) {
    const { password, ...safe } = user.toObject ? user.toObject() : user;
    return safe;
}

function writeLog(action, actor = "", targetId = "", detail = "") {
    return AuditLog.create({
        action,
        actor: String(actor || "").slice(0, 100),
        targetId: String(targetId || ""),
        detail: String(detail || "").slice(0, 500)
    }).catch(() => {});
}

// Throttled "last seen" tracker — at most one DB write per user per 60s,
// so background polling from open tabs never floods the database.
const activityThrottle = new Map();
function touchUserActivity(userId) {
    if (!userId) return;
    const key = String(userId);
    const now = Date.now();
    if (now - (activityThrottle.get(key) || 0) < 60 * 1000) return;
    activityThrottle.set(key, now);
    User.updateOne(idMatchFilter(userId), { $set: { lastActiveAt: new Date() } }).catch(() => {});
}

function signToken(user) {
    return jwt.sign(
        { id: user._id, username: user.username, role: user.role, jti: crypto.randomUUID() },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

// Session expiry in Date form — mirrors the JWT's expiresIn string (e.g. '8h')
// so the Session row dies at the same moment the token does.
function jwtExpiresAt() {
    const units = { s: 1, m: 60, h: 3600, d: 86400 };
    const match = String(JWT_EXPIRES_IN).trim().match(/^(\d+)([smhd])$/);
    const seconds = match ? Number(match[1]) * (units[match[2]] || 1) : 8 * 3600;
    return new Date(Date.now() + seconds * 1000);
}

/**
 * authRequired(roles) — protects endpoints.
 * - No token        → 401
 * - Invalid token   → 401
 * - Revoked session → 401 (token killed via "log out other devices")
 * - Wrong role      → 403
 * Attaches req.user = { id, username, role } from the verified token and
 * req.session = the matching Session row.
 */
function authRequired(roles) {
    const allowed = roles ? new Set(roles) : null;
    return async (req, res, next) => {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
        if (!token) {
            return res.status(401).json({ error: 'Authentication required. Please log in.' });
        }
        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
        }
        if (allowed && !allowed.has(payload.role)) {
            return res.status(403).json({ error: 'Access denied for your account role.' });
        }
        try {
            const session = await Session.findOne({ jti: payload.jti });
            if (!session || session.revoked) {
                return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
            }
            req.user = payload;
            req.session = session;
            touchUserActivity(payload.id);
            next();
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    };
}

// One-time migration: strip legacy wrong-order fields from stored orders.
// Uses the raw driver collection — Mongoose strict mode strips $unset paths
// that no longer exist in the schema, which would make this a silent no-op.
async function cleanupLegacyOrderFields() {
    try {
        const result = await Order.collection.updateMany({}, {
            $unset: { flagged: "", flaggedAt: "", flaggedReason: "", resolved: "", resolvedAt: "" }
        });
        if (result.modifiedCount > 0) {
            console.log(`🧹 Cleaned legacy wrong-order fields from ${result.modifiedCount} order(s).`);
        }
    } catch (err) {
        console.error('❌ Legacy order field cleanup failed:', err.message);
    }
}

// One-time migration: give legacy menu products real stock/threshold values.
// Products created before the stock feature have no stored stock field —
// mongoose only shows the schema default on read, so raw $inc would create
// a stock of -1. Store explicit defaults, then clamp any negatives to 0.
async function cleanupLegacyProductStock() {
    try {
        const missing = await Product.updateMany(
            { stock: { $exists: false } },
            { $set: { stock: 999, lowStockThreshold: 10 } }
        );
        if (missing.modifiedCount > 0) {
            console.log(`📦 Backfilled stock/threshold for ${missing.modifiedCount} legacy product(s).`);
        }
        const clamped = await Product.updateMany(
            { stock: { $lt: 0 } },
            { $set: { stock: 0, status: "Out of Stock" } }
        );
        if (clamped.modifiedCount > 0) {
            console.log(`🔻 Clamped ${clamped.modifiedCount} product(s) with negative stock to 0.`);
        }
    } catch (err) {
        console.error('❌ Legacy product stock cleanup failed:', err.message);
    }
}

/* ==========================================================================
   3. REST API ENDPOINT NETWORKS
   ========================================================================== */
app.get('/', (req, res) => { res.redirect('/login.html'); });
app.get('/CASHIER', (req, res) => { res.redirect('/CASHIER/pos.html'); });
app.get('/CASHIER/', (req, res) => { res.redirect('/CASHIER/pos.html'); });
app.get('/ADMIN', (req, res) => { res.redirect('/ADMIN/admin.html'); });
app.get('/ADMIN/', (req, res) => { res.redirect('/ADMIN/admin.html'); });

// ---------------------- AUTHENTICATION LOGIN ENDPOINT ----------------------
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const user = await User.findOne({ username: String(username).trim().toLowerCase() });
        if (!user) {
            // Burn a bcrypt round so unknown usernames answer in the same
            // time as a real password check — otherwise the response time
            // reveals which usernames exist.
            await bcrypt.compare(String(password), DUMMY_BCRYPT_HASH);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        // Backward-compatible check: hashed (bcrypt) or legacy plain text.
        let passwordMatches;
        if (isBcryptHash(user.password)) {
            passwordMatches = await bcrypt.compare(password, user.password);
        } else {
            passwordMatches = user.password === password;
            // Upgrade legacy plain-text password to a bcrypt hash on successful login.
            if (passwordMatches) {
                user.password = await bcrypt.hash(password, 10);
                await user.save();
            }
        }

        if (!passwordMatches) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (user.status !== 'Active') {
            return res.status(403).json({ error: 'Your account is inactive. Please contact an administrator.' });
        }

        // Record the login + first activity (fire-and-forget, never blocks the response)
        writeLog('user.login', user.username, '', 'Successful login');
        touchUserActivity(user._id);

        // Register this login as an active session so it can be listed and revoked.
        const token = signToken(user);
        const payload = jwt.decode(token);
        await Session.create({
            userId: user._id,
            jti: payload.jti,
            ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
            userAgent: (req.get('user-agent') || '').slice(0, 200),
            expiresAt: jwtExpiresAt()
        });

        res.json({
            success: true,
            role: user.role,
            username: user.username,
            token
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Who am I? — used by the frontend to validate a stored session on page load.
app.get('/api/auth/me', authRequired(), (req, res) => {
    res.json({
        success: true,
        username: req.user.username,
        role: req.user.role,
        session: { jti: req.session.jti, createdAt: req.session.createdAt }
    });
});

// Log out — kills the current session server-side so the token dies instantly.
app.post('/api/logout', authRequired(), async (req, res) => {
    try {
        await Session.updateOne({ jti: req.session.jti }, { $set: { revoked: true } });
        writeLog('user.logout', req.user.username, '', 'Logged out');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Active sessions for the current user — powers "my devices" + new-sign-in banner.
app.get('/api/auth/sessions', authRequired(), async (req, res) => {
    try {
        const sessions = await Session.find({ userId: req.user.id, revoked: false }).sort({ createdAt: -1 }).limit(20);
        res.json({
            success: true,
            sessions: sessions.map(s => ({
                jti: s.jti,
                ip: s.ip,
                userAgent: s.userAgent,
                createdAt: s.createdAt,
                isCurrent: s.jti === req.session.jti
            }))
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kill every other session (e.g. after noticing a suspicious sign-in).
app.post('/api/auth/sessions/revoke-others', authRequired(), async (req, res) => {
    try {
        const result = await Session.updateMany(
            { userId: req.user.id, jti: { $ne: req.session.jti }, revoked: false },
            { $set: { revoked: true } }
        );
        if (result.modifiedCount > 0) {
            writeLog('session.revoke', req.user.username, '', `Logged out ${result.modifiedCount} other session(s)`);
        }
        res.json({ success: true, revoked: result.modifiedCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Kill one specific session (the current one is protected from this route).
app.delete('/api/auth/sessions/:jti', authRequired(), async (req, res) => {
    try {
        if (!req.params.jti || req.params.jti === req.session.jti) {
            return res.status(400).json({ error: 'Cannot log out the current session this way.' });
        }
        const result = await Session.updateOne(
            { userId: req.user.id, jti: req.params.jti },
            { $set: { revoked: true } }
        );
        writeLog('session.revoke', req.user.username, String(req.params.jti).slice(0, 24), 'Logged out one session');
        res.json({ success: true, matched: result.matchedCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Self-service password change — verifies the current password, then revokes
// every other session so a stolen-account intruder is kicked out instantly.
app.put('/api/auth/password', authRequired(), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required.' });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters.' });
        }
        const user = await User.findOne(idMatchFilter(req.user.id));
        if (!user) return res.status(404).json({ error: 'User not found' });

        let passwordMatches;
        if (isBcryptHash(user.password)) {
            passwordMatches = await bcrypt.compare(String(currentPassword), user.password);
        } else {
            passwordMatches = user.password === String(currentPassword);
        }
        if (!passwordMatches) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        user.password = await bcrypt.hash(String(newPassword), 10);
        await user.save();

        const revoked = await Session.updateMany(
            { userId: user._id, jti: { $ne: req.session.jti }, revoked: false },
            { $set: { revoked: true } }
        );
        writeLog('user.password', req.user.username, String(user._id),
            `Password changed — ${revoked.modifiedCount} other session(s) logged out`);
        res.json({ success: true, revoked: revoked.modifiedCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/health', (req, res) => {
    res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ---------------------- ORDER ENDPOINTS (CASHIER / ADMIN) ----------------------
app.get('/api/orders', authRequired(), async (req, res) => {
    try {
        // Optional bounded fetch: ?days=90&limit=5000 keeps the dashboard fast
        // as the canteen grows; omitted params keep the original full-fetch
        // behavior for any other caller.
        const query = {};
        const days = parseInt(req.query.days, 10);
        if (Number.isInteger(days) && days > 0 && days <= 365) {
            query.date = { $gte: new Date(Date.now() - days * 86400000) };
        }
        let find = Order.find(query).sort({ _id: -1 });
        const limit = parseInt(req.query.limit, 10);
        if (Number.isInteger(limit) && limit > 0 && limit <= 5000) {
            find = find.limit(limit);
        }
        res.json(await find);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Place an order. Validates and deducts menu stock atomically per item —
// the whole order is rejected if any item exceeds the available stock.
// Idempotent: a clientOrderId that was already saved returns the existing
// order instead of creating a duplicate (offline-queue retries).
app.post('/api/orders', authRequired(), async (req, res) => {
    try {
const payload = normalizeOrderPayload(req.body);
        if (!Array.isArray(payload.items) || !payload.items.length) {
            return res.status(400).json({ error: 'Order must include at least one item.' });
        }
        // The cashier is whoever is authenticated — never a client default.
        if (!payload.cashier) payload.cashier = req.user.username;

        // 0) Idempotency guard — a retried offline order must not double-save.
        if (payload.clientOrderId) {
            const existing = await Order.findOne({ clientOrderId: payload.clientOrderId });
            if (existing) {
                return res.json(existing);
            }
        }

        // 1) Verify stock for every item before touching anything — menu
        //    stock first, then the linked supply ledger (ingredients).
        const shortages = [];
        for (const item of payload.items) {
            const product = await Product.findOne({ name: item.name }).select('stock status');
            if (!product) continue; // item not tracked in the menu → allow
            if ((Number(product.stock) || 0) < item.quantity) {
                shortages.push({ name: item.name, available: Number(product.stock) || 0, requested: item.quantity });
            }
            const supplies = await InventoryItem.find({ menuProductId: product._id });
            for (const supply of supplies) {
                const needed = item.quantity * Math.max(0, Number(supply.unitsPerSale) || 0);
                if (needed > 0 && (Number(supply.stock) || 0) < needed) {
                    shortages.push({
                        name: `${item.name} (needs ${supply.productName})`,
                        available: Number(supply.stock) || 0,
                        requested: needed
                    });
                }
            }
        }
        if (shortages.length) {
            const detail = shortages
                .map(s => `• ${s.name} — only ${s.available} left (needed ${s.requested})`)
                .join('\n');
            return res.status(409).json({ error: `Not enough stock to complete this order:\n${detail}` });
        }

        // 2) Save the order first. If a concurrent retry won the race, the
        //    unique clientOrderId index rejects this insert before any stock
        //    is touched — return the winner instead.
        let newOrder = new Order(payload);
        try {
            newOrder = await newOrder.save();
        } catch (err) {
            if (payload.clientOrderId && err.code === 11000) {
                const existing = await Order.findOne({ clientOrderId: payload.clientOrderId });
                if (existing) {
                    return res.json(existing);
                }
            }
            throw err;
        }

// 3) Deduct stock, then auto-flag sold-out items.
        for (const item of payload.items) {
            await Product.updateOne(
                { name: item.name },
                { $inc: { stock: -item.quantity } }
            );
            // Ingredient tracking — the sale consumes the linked supplies too.
            await shiftLinkedSupplies(item.name, item.quantity, -1);
        }
        await Product.updateMany(
            { name: { $in: payload.items.map(i => i.name) }, stock: { $lte: 0 } },
            { status: "Out of Stock" }
        );

        // 4) Fire-and-forget owner alert when an item drops below its
        //    threshold (deduped to one email per item per day).
        for (const item of payload.items) {
            const product = await Product.findOne({ name: item.name }).select('name stock lowStockThreshold');
            if (product && Number(product.stock) < Number(product.lowStockThreshold)) {
                trySendLowStockAlert(product).catch(err => console.error('❌ Low-stock email failed:', err.message));
            }
        }

        res.status(201).json(newOrder);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/orders/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });

const order = await Order.findOne(idMatchFilter(req.params.id));
        if (!order) return res.status(404).json({ error: 'Order not found' });

        // Paid orders must be voided first: hard-deleting them would silently
        // rewrite yesterday's revenue, charts, insights, and CSV exports.
        // Voiding keeps the row visible (status: Voided) and excludes it from
        // stats — the transparent way to remove an order from the numbers.
        if (order.status !== 'Voided') {
            return res.status(409).json({ error: 'Void the order first. Deleting a paid order would corrupt sales history.' });
        }

        await Order.findOneAndDelete(idMatchFilter(req.params.id));
        writeLog('order.delete', req.user.username, req.params.id, `Order ${req.params.id} hard-deleted (was voided)`);
        res.json({ message: 'Order successfully deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Soft-void an order (Cashier or Admin). The order stays in history for
// transparency, is excluded from revenue, and menu stock is restored.
app.patch('/api/orders/:id/void', authRequired(), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });

const order = await Order.findOne(idMatchFilter(req.params.id));
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status === "Voided") {
            return res.status(409).json({ error: 'Order is already voided.' });
        }

        // Restore menu stock for every item, then clear sold-out flags.
        for (const item of order.items || []) {
            await Product.updateOne(
                { name: item.name },
                { $inc: { stock: item.quantity } }
            );
            // Ingredient tracking — voiding returns the linked supplies too.
            await shiftLinkedSupplies(item.name, item.quantity, 1);
        }
        await Product.updateMany(
            { name: { $in: (order.items || []).map(i => i.name) }, stock: { $gt: 0 } },
            { status: "Available" }
        );

order.status = "Voided";
        order.voidedBy = req.user.username || "";
        order.voidedAt = new Date();
        order.voidReason = String((req.body && req.body.reason) || "").trim().slice(0, 300);

        // updateOne via the casting-proof filter instead of order.save() —
        // save() rebuilds the filter from the doc's _id and mongoose casts it
        // to ObjectId, which silently misses string _ids (older data).
        await Order.updateOne(
            idMatchFilter(order._id),
            { $set: { status: order.status, voidedBy: order.voidedBy, voidedAt: order.voidedAt, voidReason: order.voidReason } }
        );
        writeLog('order.void', req.user.username, String(order._id),
            `Order #${order.receiptId} voided (₱${order.total.toFixed(2)})${order.voidReason ? ' — ' + order.voidReason : ''}`);

        res.json(order);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- MENU PRODUCT ENDPOINTS (CRUD) ----------------------
app.get('/api/products', authRequired(), async (req, res) => {
    try { res.json(await Product.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/categories', authRequired(), async (req, res) => {
    try { res.json(await Product.distinct('category')); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- CATEGORY MANAGEMENT (CRUD) ----------------------
// Categories are managed as reserved names (Category collection) and stay
// linked to the products that use them. Renaming reassigns every product;
// deleting is blocked while products still use the category.

function normalizeCategoryName(raw) {
    return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function categoryExistsFilter(name) {
    return { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
}

app.get('/api/categories', authRequired(['Admin']), async (req, res) => {
    try {
        const reserved = await Category.find({}).sort({ name: 1 }).lean();
        const used = await Product.distinct('category');
        const names = new Set(reserved.map(c => c.name));
        used.forEach(name => { if (name) names.add(name); });
        res.json([...names].sort((a, b) => a.localeCompare(b)));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', authRequired(['Admin']), async (req, res) => {
    try {
        const name = normalizeCategoryName(req.body && req.body.name);
        if (!name) return res.status(400).json({ error: 'Category name is required.' });
        const clash = await Category.findOne({ name: categoryExistsFilter(name) });
        if (clash) return res.status(409).json({ error: `Category "${name}" already exists.` });
        const productClash = await Product.findOne({ category: categoryExistsFilter(name) }).select('category');
        if (productClash) return res.status(409).json({ error: `Category "${name}" already exists.` });
        await Category.create({ name });
        writeLog('category.create', req.user.username, name, `Created category "${name}"`);
        res.status(201).json({ name });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/categories/:name', authRequired(['Admin']), async (req, res) => {
    try {
        const oldName = decodeURIComponent(req.params.name);
        const newName = normalizeCategoryName(req.body && req.body.name);
        if (!newName) return res.status(400).json({ error: 'New category name is required.' });
        if (oldName === newName) {
            return res.json({ name: newName, count: await Product.countDocuments({ category: oldName }) });
        }
        const clash = await Category.findOne({ name: categoryExistsFilter(newName) });
        if (clash && clash.name.toLowerCase() !== oldName.toLowerCase()) {
            return res.status(409).json({ error: `Category "${newName}" already exists.` });
        }
        const productClash = await Product.findOne({ category: categoryExistsFilter(newName) }).select('category');
        if (productClash && productClash.category.toLowerCase() !== oldName.toLowerCase()) {
            return res.status(409).json({ error: `Category "${newName}" already exists.` });
        }
        await Category.updateMany({ name: categoryExistsFilter(oldName) }, { $set: { name: newName } });
        const result = await Product.updateMany({ category: oldName }, { $set: { category: newName } });
        writeLog('category.rename', req.user.username, oldName, `Renamed category "${oldName}" → "${newName}" (${result.modifiedCount} product(s))`);
        res.json({ name: newName, count: result.modifiedCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:name', authRequired(['Admin']), async (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);
        const inUse = await Product.countDocuments({ category: name });
        if (inUse > 0) {
            return res.status(409).json({ error: `Cannot delete "${name}" — ${inUse} product(s) still use it. Move them to another category first.` });
        }
        await Category.deleteMany({ name });
        writeLog('category.delete', req.user.username, name, `Deleted empty category "${name}"`);
        res.json({ message: `Category "${name}" deleted` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', authRequired(['Admin']), async (req, res) => {
    try {
        const { name, category, price, status, image, stock, lowStockThreshold } = req.body || {};
        if (!name || !category || !Number.isFinite(Number(price))) {
            return res.status(400).json({ error: 'Product name, category, and a valid price are required.' });
        }
        const hasStatus = typeof status === "string" && String(status).trim().length > 0;
        const stockNum = Number.isFinite(Number(stock)) ? Math.max(0, Number(stock)) : 999;
        const newProduct = new Product({
            name: String(name).trim(),
            category: String(category).trim(),
            price: Number(price),
            status: hasStatus ? status : (stockNum > 0 ? 'Available' : 'Out of Stock'),
            image: image || '',
            stock: stockNum,
            lowStockThreshold: Number.isFinite(Number(lowStockThreshold)) ? Math.max(0, Number(lowStockThreshold)) : 10
        });
        const savedProduct = await newProduct.save();
        writeLog('product.create', req.user.username, String(savedProduct._id),
            `Added product "${savedProduct.name}" — ₱${savedProduct.price.toFixed(2)}, stock ${savedProduct.stock}, threshold ${savedProduct.lowStockThreshold}`);
        res.status(201).json(savedProduct);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/products/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const update = { ...req.body };
        if (update.price !== undefined) {
            if (!Number.isFinite(Number(update.price))) {
                return res.status(400).json({ error: 'Price must be a valid number.' });
            }
            update.price = Number(update.price);
        }
        if (update.stock !== undefined) {
            if (!Number.isFinite(Number(update.stock))) {
                return res.status(400).json({ error: 'Stock must be a valid number.' });
            }
            update.stock = Math.max(0, Number(update.stock));
        }
        if (update.lowStockThreshold !== undefined) {
            if (!Number.isFinite(Number(update.lowStockThreshold))) {
                return res.status(400).json({ error: 'Low stock threshold must be a valid number.' });
            }
            update.lowStockThreshold = Math.max(0, Number(update.lowStockThreshold));
        }
        // Running out always marks the item sold out — even when the form
        // sends a status. Restocking revives it unless the form explicitly
        // keeps it hidden on "Out of Stock" hold.
const existing = await Product.findOne(idMatchFilter(req.params.id));
        if (update.stock !== undefined) {
            if (update.stock <= 0) {
                update.status = 'Out of Stock';
            } else if (update.status === undefined) {
                update.status = 'Available';
            }
        }
        const updated = await Product.findOneAndUpdate(idMatchFilter(req.params.id), update, { new: true });
        if (!updated) return res.status(404).json({ error: 'Product not found' });
        if (existing) {
            const bits = [];
            if (update.stock !== undefined) bits.push('stock ' + existing.stock + ' → ' + update.stock);
            if (update.lowStockThreshold !== undefined) bits.push('threshold ' + existing.lowStockThreshold + ' → ' + update.lowStockThreshold);
            if (update.price !== undefined) bits.push('price ₱' + existing.price.toFixed(2) + ' → ₱' + Number(update.price).toFixed(2));
            if (update.status !== undefined && update.status !== existing.status) bits.push('status ' + existing.status + ' → ' + update.status);
            writeLog('product.update', req.user.username, req.params.id,
                'Updated "' + updated.name + '"' + (bits.length ? ' — ' + bits.join(', ') : ''));
        }
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/products/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
const deleted = await Product.findOneAndDelete(idMatchFilter(req.params.id));
        writeLog('product.delete', req.user.username, req.params.id,
            deleted ? `Deleted product "${deleted.name}"` : `Delete attempt on missing product ${req.params.id}`);
        res.json({ message: 'Product successfully scrubbed from database' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restock a menu product — bumps the stock count, revives a sold-out item,
// and leaves an audit trail. Used by the admin menu table and the AI
// insights restock suggestions.
app.post('/api/products/:id/restock', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const quantity = Number(req.body && req.body.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Restock quantity must be a number above zero.' });
        }
        const reason = String((req.body && req.body.reason) || "").trim().slice(0, 100) || "Manual restock";
const product = await Product.findOne(idMatchFilter(req.params.id));
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const updated = await Product.findOneAndUpdate(
            idMatchFilter(req.params.id),
            { $inc: { stock: quantity }, status: "Available" },
            { new: true }
        );
        writeLog('product.restock', req.user.username, req.params.id,
            `Restocked "${updated.name}" +${quantity} (${reason}) — now ${updated.stock}`);
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------- USER ACCOUNTS MANAGEMENT (CRUD) ----------------------
app.get('/api/users', authRequired(['Admin']), async (req, res) => {
    try {
        const users = await User.find({});
        res.json(users.map(sanitizeUser));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', authRequired(['Admin']), async (req, res) => {
    try {
        const { username, password, role, status } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }
        if (String(password).length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }
        if (!['Admin', 'Cashier'].includes(role)) {
            return res.status(400).json({ error: 'Role must be Admin or Cashier.' });
        }

        const exists = await User.findOne({ username: String(username).trim().toLowerCase() });
        if (exists) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);
        const newUser = new User({
            username: String(username).trim().toLowerCase(),
            password: hashedPassword,
            role,
            status: status || 'Active'
        });
        const saved = await newUser.save();
        writeLog('user.create', req.user.username, String(saved._id), `Created ${role} account "${saved.username}"`);
        res.status(201).json(sanitizeUser(saved));
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/users/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

const existing = await User.findOne(idMatchFilter(req.params.id));
        if (!existing) return res.status(404).json({ error: 'User profile not found' });

        const update = { ...req.body };
        if (update.username) update.username = String(update.username).trim().toLowerCase();

        if (update.role && !['Admin', 'Cashier'].includes(update.role)) {
            return res.status(400).json({ error: 'Role must be Admin or Cashier.' });
        }

        // Only re-hash when the password actually changed.
        if (update.password && update.password !== existing.password) {
            if (String(update.password).length < 8) {
                return res.status(400).json({ error: 'Password must be at least 8 characters.' });
            }
            update.password = await bcrypt.hash(String(update.password), 10);
        } else {
            delete update.password;
        }

        const updated = await User.findOneAndUpdate(idMatchFilter(req.params.id), update, { new: true });

        // Password was reset — kill every session so the old password
        // stops working everywhere immediately.
        if (update.password) {
            const revoked = await Session.updateMany(
                { userId: updated._id, revoked: false },
                { $set: { revoked: true } }
            );
            writeLog('user.update', req.user.username, String(updated._id),
                `Reset password for "${updated.username}" — ${revoked.modifiedCount} session(s) revoked`);
        } else {
            writeLog('user.update', req.user.username, String(updated._id), `Updated account "${updated.username}"`);
        }
        res.json(sanitizeUser(updated));
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/users/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
const deleted = await User.findOneAndDelete(idMatchFilter(req.params.id));
        writeLog('user.delete', req.user.username, req.params.id,
            deleted ? `Deleted account "${deleted.username}"` : `Delete attempt on missing account ${req.params.id}`);
        res.json({ message: 'User account deactivated and erased' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- INVENTORY SUBSYSTEM ENDPOINTS (CRUD) ----------------------
app.get('/api/inventory', authRequired(['Admin']), async (req, res) => {
    try { res.json(await InventoryItem.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory', authRequired(['Admin']), async (req, res) => {
    try {
        const input = { ...req.body };
        let product = null;
        if (input.menuProductId && isValidObjectId(input.menuProductId)) {
            product = await Product.findOne(idMatchFilter(input.menuProductId));
        }
        const payload = inventoryFromPayload(input, product, {});
        if (!payload.productName || !Number.isFinite(payload.price) || !Number.isFinite(payload.stock)) {
            return res.status(400).json({ error: 'Product name, category, price, and stock are required.' });
        }
        if (input.status === undefined) {
            payload.status = payload.stock > 0 ? 'Available' : 'Sold Out';
        }
        const saved = await new InventoryItem(payload).save();
        writeLog('inventory.create', req.user.username, String(saved._id),
            `Added inventory "${saved.productName}" × ${saved.stock}` +
            (saved.menuProductId ? ' (linked to menu product)' : ''));
        res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/inventory/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory token id' });
const existing = await InventoryItem.findOne(idMatchFilter(req.params.id));
        if (!existing) return res.status(404).json({ error: 'Inventory stock line item not found' });
        const input = { ...req.body };
        let product = null;
        if (input.menuProductId && isValidObjectId(input.menuProductId)) {
            product = await Product.findOne(idMatchFilter(input.menuProductId));
        }
        const update = inventoryFromPayload(input, product, existing);
        // Auto-sync status from stock unless the form chose one explicitly.
        if (input.status === undefined) {
            update.status = update.stock > 0 ? 'Available' : 'Sold Out';
        }
        const updated = await InventoryItem.findOneAndUpdate(idMatchFilter(req.params.id), { $set: update }, { new: true });
        const bits = [];
        if (existing.stock !== updated.stock) bits.push('stock ' + existing.stock + ' → ' + updated.stock);
        if (Number(existing.lowStockThreshold || 0) !== Number(updated.lowStockThreshold || 0)) bits.push('threshold ' + existing.lowStockThreshold + ' → ' + updated.lowStockThreshold);
        if (existing.status !== updated.status) bits.push('status ' + existing.status + ' → ' + updated.status);
        writeLog('inventory.update', req.user.username, String(updated._id),
            `Updated inventory "${updated.productName}"` + (bits.length ? ' — ' + bits.join(', ') : ''));
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/inventory/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory id' });
const deleted = await InventoryItem.findOneAndDelete(idMatchFilter(req.params.id));
        writeLog('inventory.delete', req.user.username, req.params.id,
            deleted ? `Deleted inventory "${deleted.productName}"` : `Delete attempt on missing inventory ${req.params.id}`);
        res.json({ message: 'Inventory asset profile cleared from active system records' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Restock a standalone supply item — same contract as the product restock.
app.post('/api/inventory/:id/restock', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory id' });
        const quantity = Number(req.body && req.body.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Restock quantity must be a number above zero.' });
        }
        const reason = String((req.body && req.body.reason) || "").trim().slice(0, 100) || "Manual restock";
const item = await InventoryItem.findOne(idMatchFilter(req.params.id));
        if (!item) return res.status(404).json({ error: 'Inventory item not found' });
        const updated = await InventoryItem.findOneAndUpdate(
            idMatchFilter(req.params.id),
            { $inc: { stock: quantity }, status: "Available" },
            { new: true }
        );
        writeLog('inventory.restock', req.user.username, req.params.id,
            `Restocked "${updated.productName}" +${quantity} (${reason}) — now ${updated.stock}`);
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------- FOOD WASTE ENDPOINTS (CRUD) ----------------------
app.get('/api/waste', authRequired(), async (req, res) => {
    try { res.json(await WasteItem.find({}).sort({ _id: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/waste', authRequired(), async (req, res) => {
    try {
const payload = normalizeWastePayload(req.body);
        if (!payload.productName || !Number.isFinite(payload.quantity) || payload.quantity <= 0) {
            return res.status(400).json({ error: 'Product name and a quantity above zero are required.' });
        }
        // The cashier is whoever is authenticated — never a client default.
        if (!payload.cashier) payload.cashier = req.user.username;
        // Wasted food leaves the inventory — deduct stock when the item is on the menu.
        await Product.updateOne(
            { name: payload.productName },
            { $inc: { stock: -payload.quantity } }
        );
        // Ingredient tracking — the waste consumes the linked supplies too.
        await shiftLinkedSupplies(payload.productName, payload.quantity, -1);
        // Auto-flag sold-out items, mirroring the order flow.
        await Product.updateMany(
            { name: payload.productName, stock: { $lte: 0 } },
            { status: "Out of Stock" }
        );
        const newWaste = new WasteItem(payload);
        const savedWaste = await newWaste.save();
        writeLog('waste.create', req.user.username, String(savedWaste._id),
            `Logged waste "${savedWaste.productName}" × ${savedWaste.quantity} (₱${savedWaste.totalCost.toFixed(2)})`);
        res.status(201).json(savedWaste);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/waste/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid waste id' });
        const deleted = await WasteItem.findOneAndDelete(idMatchFilter(req.params.id));
        writeLog('waste.delete', req.user.username, req.params.id,
            deleted
                ? `Removed waste entry "${deleted.productName}" × ${deleted.quantity} (₱${Number(deleted.totalCost || 0).toFixed(2)})`
                : `DELETE matched nothing (id: ${req.params.id})`);
        if (!deleted) return res.status(404).json({ error: 'Waste entry not found' });
        res.json({ message: 'Waste entry removed' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- AUDIT LOG ENDPOINT ----------------------
app.get('/api/audit', authRequired(['Admin']), async (req, res) => {
    try {
        const filter = {};
        const { from, to, limit, action } = req.query;
        if (from) {
            const fromDate = new Date(from);
            if (!isNaN(fromDate)) filter.date = { ...(filter.date || {}), $gte: fromDate };
        }
        if (to) {
            const toDate = new Date(to);
            if (!isNaN(toDate)) filter.date = { ...(filter.date || {}), $lte: toDate };
        }
        if (action) filter.action = action;
        const max = Math.min(Math.max(Number(limit) || 500, 1), 5000);
        const logs = await AuditLog.find(filter).sort({ date: -1 }).limit(max);
        res.json(logs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- AI INSIGHTS ENDPOINT (ADMIN) ----------------------
// In-house statistical forecasts & alerts — computed from the last 30 days of
// orders/products/inventory/waste. Result is cached for 5 minutes.
const { computeInsights } = require('./ai-insights');
const { buildReportPrompt, buildStatsReport, fetchAiReport } = require('./ai-report');
let insightsCache = { data: null, at: 0 };
const INSIGHTS_TTL_MS = 5 * 60 * 1000;

async function getInsights() {
    if (insightsCache.data && Date.now() - insightsCache.at < INSIGHTS_TTL_MS) {
        return insightsCache.data;
    }
    const since = new Date(Date.now() - 30 * 86400000);
    const [orders, products, inventory, waste] = await Promise.all([
        Order.find({ date: { $gte: since } }).lean(),
        Product.find().lean(),
        InventoryItem.find().lean(),
        WasteItem.find({ date: { $gte: since } }).lean()
    ]);
    const data = computeInsights({ orders, products, inventory, waste });
    insightsCache = { data, at: Date.now() };
    return data;
}

app.get('/api/insights', authRequired(['Admin']), async (req, res) => {
    try {
        res.json(await getInsights());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Optional LLM weekly report (free Gemini tier). Falls back to a statistics
// summary when AI_API_KEY is missing or the API call fails — never errors.
// Rate-limited per IP so a stuck script can't burn the free AI quota.
const aiReportLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many report requests. Try again in a minute.' }
});
app.post('/api/ai/report', aiReportLimiter, authRequired(['Admin']), async (req, res) => {
    try {
        const data = await getInsights();
        const report = await fetchAiReport(buildReportPrompt(data));
        res.json({
            report: report || buildStatsReport(data),
            source: report ? 'ai' : 'stats',
            generatedAt: new Date().toISOString()
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- OWNER EMAIL ALERTS ----------------------
// Real-time low-stock emails (on order placement) and a daily sales
// summary. Sending uses nodemailer + SMTP env vars (backend/email.js).
const { isEmailConfigured, sendAlertMail } = require('./email');

function manilaDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getOwnerAlertSettings() {
    let doc = await OwnerAlertSettings.findById('owner-alerts');
    if (!doc) {
        doc = new OwnerAlertSettings({ _id: 'owner-alerts' });
        await doc.save();
    }
    return doc;
}

function escapeHtmlEmail(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Fire-and-forget low-stock email, deduped to one email per item per day.
async function trySendLowStockAlert(product) {
    if (!isEmailConfigured()) return;
    const settings = await getOwnerAlertSettings();
    if (!settings.lowStockEnabled || !settings.recipients.length) return;
    const today = manilaDateStr();
    if (settings.lowStockLastSent.get(product.name) === today) return;

    const stock = Number(product.stock) || 0;
    const threshold = Number(product.lowStockThreshold) || 0;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#8b5e3c">Low Stock Alert</h2>
            <p><strong>${escapeHtmlEmail(product.name)}</strong> is down to
            <strong style="color:#c0392b">${stock}</strong> (threshold ${threshold}).</p>
            <p>Restock soon or it will run out of the menu.</p>
        </div>`;
    const result = await sendAlertMail({
        to: settings.recipients.join(', '),
        subject: `Low stock: ${product.name} (${stock} left)`,
        html
    });
    if (result.ok) {
        settings.lowStockLastSent.set(product.name, today);
        await settings.save();
    }
}

// Builds the daily summary email from today's orders (Manila time).
async function buildDailySummaryEmail() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [orders, products] = await Promise.all([
        Order.find({ date: { $gte: startOfDay } }).lean(),
        Product.find().lean()
    ]);
    const completed = orders.filter(o => o.status !== 'Voided');
    const total = completed.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const paymentSplit = {};
    completed.forEach(o => {
        const key = o.paymentMethod || 'Cash';
        paymentSplit[key] = (paymentSplit[key] || 0) + 1;
    });
    const itemCounts = {};
    completed.forEach(o => (o.items || []).forEach(i => {
        itemCounts[i.name] = (itemCounts[i.name] || 0) + (Number(i.quantity) || 0);
    }));
    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const lowStock = products
        .filter(p => Number(p.stock) < Number(p.lowStockThreshold))
        .sort((a, b) => Number(a.stock) - Number(b.stock));

    const rows = (list) => list.length
        ? list.map(([name, qty]) => `<tr><td>${escapeHtmlEmail(name)}</td><td>${qty}</td></tr>`).join('')
        : '<tr><td colspan="2" style="color:#888">No sales today.</td></tr>';
    const lowRows = lowStock.length
        ? lowStock.map(p => `<tr><td>${escapeHtmlEmail(p.name)}</td><td style="color:#c0392b">${Number(p.stock) || 0} / ${Number(p.lowStockThreshold) || 0}</td></tr>`).join('')
        : '<tr><td colspan="2" style="color:#888">All items healthy.</td></tr>';

    return {
        subject: `Daily Sales Summary — ${manilaDateStr()}`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
            <h2 style="color:#8b5e3c">☕ Daily Sales Summary</h2>
            <p style="color:#888">${manilaDateStr()} · Season 3 POS</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:6px 0;color:#666">Orders today</td><td style="text-align:right;font-weight:bold">${completed.length}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Total revenue</td><td style="text-align:right;font-weight:bold">₱${total.toFixed(2)}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Payment split</td><td style="text-align:right">${Object.entries(paymentSplit).map(([k, v]) => `${escapeHtmlEmail(k)}: ${v}`).join(' · ')}</td></tr>
            </table>
            <h3 style="color:#8b5e3c;margin-top:20px">Top items</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr style="border-bottom:1px solid #eee"><th align="left">Item</th><th align="right">Qty</th></tr>
                ${rows(topItems)}
            </table>
            <h3 style="color:#8b5e3c;margin-top:20px">Low stock</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr style="border-bottom:1px solid #eee"><th align="left">Item</th><th align="right">Stock / Threshold</th></tr>
                ${lowRows}
            </table>
        </div>`
    };
}

// One daily email per day; safe to call repeatedly (idempotent). Runs the
// catch-up at startup too, so a sleeping Render instance still delivers.
async function trySendDailySummary() {
    if (!isEmailConfigured()) return;
    const settings = await getOwnerAlertSettings();
    if (!settings.dailySummaryEnabled || !settings.recipients.length) return;
    const today = manilaDateStr();
    if (settings.lastDailySentDate === today) return;

    const email = await buildDailySummaryEmail();
    const result = await sendAlertMail({ to: settings.recipients.join(', '), ...email });
    if (result.ok) {
        settings.lastDailySentDate = today;
        await settings.save();
    }
}

app.get('/api/settings/owner-alerts', authRequired(['Admin']), async (req, res) => {
    try {
        const s = await getOwnerAlertSettings();
        res.json({
            recipients: s.recipients,
            lowStockEnabled: s.lowStockEnabled,
            dailySummaryEnabled: s.dailySummaryEnabled,
            dailySummaryHour: s.dailySummaryHour,
            smtpConfigured: isEmailConfigured()
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.put('/api/settings/owner-alerts', authRequired(['Admin']), async (req, res) => {
    try {
        const { recipients, lowStockEnabled, dailySummaryEnabled, dailySummaryHour } = req.body || {};
        if (!Array.isArray(recipients) || !recipients.length) {
            return res.status(400).json({ error: 'Add at least one recipient email address.' });
        }
        if (recipients.length > 5) {
            return res.status(400).json({ error: 'Maximum of 5 recipient emails.' });
        }
        const cleaned = recipients.map(e => String(e).trim()).filter(Boolean);
        if (cleaned.some(e => !EMAIL_RE.test(e))) {
            return res.status(400).json({ error: 'One or more recipient emails are invalid.' });
        }
        const hour = dailySummaryHour === undefined ? 20 : Number(dailySummaryHour);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return res.status(400).json({ error: 'Daily summary hour must be an integer from 0 to 23.' });
        }
        const s = await getOwnerAlertSettings();
        s.recipients = [...new Set(cleaned)];
        s.lowStockEnabled = lowStockEnabled === undefined ? true : Boolean(lowStockEnabled);
        s.dailySummaryEnabled = dailySummaryEnabled === undefined ? true : Boolean(dailySummaryEnabled);
        s.dailySummaryHour = hour;
        await s.save();
        res.json({
            recipients: s.recipients,
            lowStockEnabled: s.lowStockEnabled,
            dailySummaryEnabled: s.dailySummaryEnabled,
            dailySummaryHour: s.dailySummaryHour,
            smtpConfigured: isEmailConfigured()
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const testEmailLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many test emails. Try again in a minute.' }
});
app.post('/api/settings/owner-alerts/test', testEmailLimiter, authRequired(['Admin']), async (req, res) => {
    try {
        const s = await getOwnerAlertSettings();
        if (!s.recipients.length) {
            return res.status(400).json({ error: 'Save a recipient email first.' });
        }
        if (!isEmailConfigured()) {
            return res.status(400).json({ error: 'Email sending is not configured. Add SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY + EMAIL_FROM) to the server environment.' });
        }
        const result = await sendAlertMail({
            to: s.recipients[0],
            subject: 'Test email — Owner Alerts',
            html: '<p>If you can read this, owner alert emails are working.</p>'
        });
        if (result.ok) return res.json({ ok: true });
        res.status(502).json({ error: `Email failed: ${result.error}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- SEED DEFAULT ADMIN ----------------------
// Creates a default admin account on first boot when no users exist.
// Override credentials with SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD in .env
async function seedDefaultAdmin() {
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            const username = (process.env.SEED_ADMIN_USERNAME || 'admin').trim().toLowerCase();
            // Never ship the well-known default password in production — a
            // random one is generated and printed to the logs once instead.
            const password = process.env.SEED_ADMIN_PASSWORD
                || (process.env.RENDER ? require('crypto').randomBytes(8).toString('hex') : 'admin123');
            const hashed = await bcrypt.hash(password, 10);
            await User.create({ username, password: hashed, role: 'Admin', status: 'Active' });
            console.log(`👤 Seeded default Admin account → username: "${username}", password: "${password}"`);
            console.log('   ⚠️  Change this password in the Admin → Add Users panel immediately.');
        }
    } catch (err) {
        console.error('❌ Default admin seeding failed:', err.message);
    }
}

// ---------------------- 404 & ERROR HANDLERS ----------------------
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
    // Body-parser caps payloads with a typed error — answer 413, not 500.
    if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({ error: 'Request body too large.' });
    }
    console.error('❌ Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// Initialise Service Execution Host Thread Loop
// Guarded so tests can import the app without binding a port.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Master Back-End Live and Running Cleanly on Port ${PORT}`);
        mongoose.connection.readyState === 1 && seedDefaultAdmin();
        checkRenderStatus();
        // Owner-alert daily summary: immediate catch-up (covers a sleeping
        // free-tier instance) + a 60s tick that fires when the hour hits.
        trySendDailySummary().catch(() => {});
        setInterval(() => { trySendDailySummary().catch(() => {}); }, 60000);
    });
}

// Quick smoke check of the production deployment — non-blocking, never crashes.
function checkRenderStatus() {
    const renderUrl = process.env.RENDER_URL || "https://season3-pos.onrender.com";
    const started = Date.now();
    fetch(`${renderUrl}/api/health`, { signal: AbortSignal.timeout(10000) })
        .then(res => {
            console.log(`${res.ok ? "✅" : "❌"} [Render] POS link ${renderUrl} is ${res.ok ? "ONLINE" : "OFFLINE"} (HTTP ${res.status}, ${Date.now() - started}ms)`);
        })
        .catch(err => {
            console.log(`❌ [Render] POS link ${renderUrl} is OFFLINE (${err.code || "timeout"}) — free tier may be waking (30-60s)`);
        });
}

// Seed once the DB is ready (covers the case where connection finishes after listen)
mongoose.connection.once('connected', () => {
    seedDefaultAdmin();
    cleanupLegacyOrderFields();
    console.log('🔄 Startup cleanup + admin seeding check complete.');
});

module.exports = app;
// Test hooks — expose the alert pipeline so jest can drive it with a fake
// mailer and a memory DB (see tests/owner-alerts.test.js).
app._ownerAlerts = { trySendDailySummary, trySendLowStockAlert, getOwnerAlertSettings, buildDailySummaryEmail };

