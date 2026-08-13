const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dns = require('dns');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Prefer IPv4 — Atlas `mongodb+srv` lookups can hang on Windows Node when
// an AAAA record is awaited first (getaddrinfo EAI_AGAIN / timeouts).
dns.setDefaultResultOrder('ipv4first');

const app = express();

// JWT signing secret — set JWT_SECRET in .env for production use.
const JWT_SECRET = process.env.JWT_SECRET || 'season3-pos-dev-secret';
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET not set in .env — using a development secret. Set it before going live.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// Middleware Engine Configuration
const corsOrigin = process.env.CORS_ORIGIN === '*'
    ? true
    : process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
        : true;

app.use(cors({ origin: corsOrigin }));
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Realtime visit logging — prints who accesses the POS to the terminal
// (and streams to Render dashboard logs in production). Noise filtered:
// static assets, favicon and the /api/health probe are skipped.
app.use((req, res, next) => {
    res.on('finish', () => {
        if (process.env.NODE_ENV === 'test') return;
        const url = req.originalUrl;
        if (/\/ADMIN\/(css|js|assets)|favicon|^\/api\/health/.test(url)) return;
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        console.log(`👁 ${new Date().toLocaleTimeString()} ${res.statusCode} ${req.method} ${url} · ${ip} · ${(req.get('user-agent') || '').slice(0, 60)}`);
    });
    next();
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Brute-force guard for the login endpoint — 10 attempts per 15 min per IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

// Strict Database Connection Token Processing
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error('❌ FATAL: MONGO_URI is not defined in .env file. Server cannot start.');
    process.exit(1);
}

mongoose.connection.on('connected', () => {
    const dbName = mongoose.connection.db?.databaseName || 'unknown';
    console.log(`✓ [MongoDB] Connected to MongoDB Atlas — Database: "${dbName}"`);
});

mongoose.connection.on('error', err => {
    console.error(`✗ [MongoDB] Database Connection Error:`, err.message);
});

mongoose.connection.on('disconnected', () => {
    console.warn(`✗ [MongoDB] Disconnected. Attempting to reconnect...`);
});

mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: true
}).catch(err => {
    console.error(`✗ [MongoDB] Initial Connection Failed:`, err.message);
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
    // Idempotency key for offline sync retries — must be unique per order.
    clientOrderId: { type: String, trim: true }
});
orderSchema.index({ clientOrderId: 1 }, { unique: true, sparse: true });
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
const Product = mongoose.model('Product', productSchema);

// --- Crew User Account Schema Configuration ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['Admin', 'Cashier'], default: 'Admin' },
    status: { type: String, default: 'Active' },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const User = mongoose.model('User', userSchema);

// --- Stock Supply Inventory Schema Configuration ---
const inventorySchema = new mongoose.Schema({
    productName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    status: { type: String, default: 'Available' },
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
const AuditLog = mongoose.model('AuditLog', logSchema);

/* ==========================================================================
   2. UTILITY INTERCEPTORS & VALIDATION ENGINES
   ========================================================================== */

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
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
        cashier: String(input.cashier || "Pranselen").trim() || "Pranselen",
        quantity,
        price,
        totalCost: Number((quantity * price).toFixed(2)),
        reason: String(input.reason || "Other").trim() || "Other",
        note: String(input.note || "").trim().slice(0, 300),
        date: input.date ? new Date(input.date) : new Date()
    };
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

    const payload = {
        customer: String(input.customer || "Walk-in Customer").trim() || "Walk-in Customer",
        cashier: String(input.cashier || "Pranselen").trim() || "Pranselen",
        tableNo: String(input.tableNo || "").trim(),
        mode: ["Dine In", "To Go", "Online Order"].includes(input.mode) ? input.mode : "Dine In",
        paymentMethod: normalizePaymentMethod(input.paymentMethod),
        receiptId: String(input.receiptId || String(Date.now()).slice(-8)),
        date: input.date ? new Date(input.date) : new Date(),
        items,
        total: Number.isFinite(Number(input.total)) && Number(input.total) > 0
            ? Number(input.total)
            : computedTotal,
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
    }).catch(err => console.error('❌ Audit log write failed:', err.message));
}

function signToken(user) {
    return jwt.sign(
        { id: user._id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * authRequired(roles) — protects endpoints.
 * - No token        → 401
 * - Invalid token   → 401
 * - Wrong role      → 403
 * Attaches req.user = { id, username, role } from the verified token.
 */
function authRequired(roles) {
    const allowed = roles ? new Set(roles) : null;
    return (req, res, next) => {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
        if (!token) {
            return res.status(401).json({ error: 'Authentication required. Please log in.' });
        }
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            if (allowed && !allowed.has(payload.role)) {
                return res.status(403).json({ error: 'Access denied for your account role.' });
            }
            req.user = payload;
            next();
        } catch (err) {
            return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
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

        res.json({
            success: true,
            role: user.role,
            username: user.username,
            token: signToken(user)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Who am I? — used by the frontend to validate a stored session on page load.
app.get('/api/auth/me', authRequired(), (req, res) => {
    res.json({ success: true, username: req.user.username, role: req.user.role });
});

app.get('/api/health', (req, res) => {
    res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ---------------------- ORDER ENDPOINTS (CASHIER / ADMIN) ----------------------
app.get('/api/orders', authRequired(), async (req, res) => {
    try {
        const orders = await Order.find().sort({ _id: -1 });
        res.json(orders);
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

        // 0) Idempotency guard — a retried offline order must not double-save.
        if (payload.clientOrderId) {
            const existing = await Order.findOne({ clientOrderId: payload.clientOrderId });
            if (existing) {
                return res.json(existing);
            }
        }

        // 1) Verify stock for every item before touching anything.
        const shortages = [];
        for (const item of payload.items) {
            const product = await Product.findOne({ name: item.name }).select('stock status');
            if (!product) continue; // item not tracked in the menu → allow
            if ((Number(product.stock) || 0) < item.quantity) {
                shortages.push({ name: item.name, available: Number(product.stock) || 0, requested: item.quantity });
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
        }
        await Product.updateMany(
            { name: { $in: payload.items.map(i => i.name) }, stock: { $lte: 0 } },
            { status: "Out of Stock" }
        );

        res.status(201).json(newOrder);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/orders/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });
        await Order.findByIdAndDelete(req.params.id);
        writeLog('order.delete', req.user.username, req.params.id, `Order ${req.params.id} hard-deleted`);
        res.json({ message: 'Order successfully deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Soft-void an order (Cashier or Admin). The order stays in history for
// transparency, is excluded from revenue, and menu stock is restored.
app.patch('/api/orders/:id/void', authRequired(), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });

        const order = await Order.findById(req.params.id);
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
        }
        await Product.updateMany(
            { name: { $in: (order.items || []).map(i => i.name) }, stock: { $gt: 0 } },
            { status: "Available" }
        );

        order.status = "Voided";
        order.voidedBy = req.user.username || "";
        order.voidedAt = new Date();
        order.voidReason = String(req.body.reason || "").trim().slice(0, 300);

        const savedOrder = await order.save();
        writeLog('order.void', req.user.username, String(order._id),
            `Order #${savedOrder.receiptId} voided (₱${savedOrder.total.toFixed(2)})${savedOrder.voidReason ? ' — ' + savedOrder.voidReason : ''}`);

        res.json(savedOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- MENU PRODUCT ENDPOINTS (CRUD) ----------------------
app.get('/api/products', authRequired(), async (req, res) => {
    try { res.json(await Product.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/categories', authRequired(), async (req, res) => {
    try { res.json(await Product.distinct('category')); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', authRequired(['Admin']), async (req, res) => {
    try {
        const { name, category, price, status, image, stock, lowStockThreshold } = req.body || {};
        if (!name || !category || !Number.isFinite(Number(price))) {
            return res.status(400).json({ error: 'Product name, category, and a valid price are required.' });
        }
        const newProduct = new Product({
            name: String(name).trim(),
            category: String(category).trim(),
            price: Number(price),
            status: status || 'Available',
            image: image || '',
            stock: Number.isFinite(Number(stock)) ? Math.max(0, Number(stock)) : 999,
            lowStockThreshold: Number.isFinite(Number(lowStockThreshold)) ? Math.max(0, Number(lowStockThreshold)) : 10
        });
        res.status(201).json(await newProduct.save());
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
        // Restock fixes a sold-out item; running out marks it sold out.
        if (update.stock !== undefined && update.status === undefined) {
            update.status = update.stock > 0 ? 'Available' : 'Out of Stock';
        }
        const updated = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!updated) return res.status(404).json({ error: 'Product not found' });
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/products/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: 'Product successfully scrubbed from database' });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

        const existing = await User.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'User profile not found' });

        const update = { ...req.body };
        if (update.username) update.username = String(update.username).trim().toLowerCase();

        if (update.role && !['Admin', 'Cashier'].includes(update.role)) {
            return res.status(400).json({ error: 'Role must be Admin or Cashier.' });
        }

        // Only re-hash when the password actually changed.
        if (update.password && update.password !== existing.password) {
            update.password = await bcrypt.hash(String(update.password), 10);
        } else {
            delete update.password;
        }

        const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
        writeLog('user.update', req.user.username, String(updated._id), `Updated account "${updated.username}"`);
        res.json(sanitizeUser(updated));
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/users/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
        const deleted = await User.findByIdAndDelete(req.params.id);
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
        const { productName, category, price, stock, status } = req.body || {};
        if (!productName || !category || !Number.isFinite(Number(price)) || !Number.isFinite(Number(stock))) {
            return res.status(400).json({ error: 'Product name, category, price, and stock are required.' });
        }
        const newItem = new InventoryItem({
            productName: String(productName).trim(),
            category: String(category).trim(),
            price: Number(price),
            stock: Number(stock),
            status: status || 'Available'
        });
        res.status(201).json(await newItem.save());
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/inventory/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory token id' });
        const update = { ...req.body };
        if (update.price !== undefined && !Number.isFinite(Number(update.price))) {
            return res.status(400).json({ error: 'Price must be a valid number.' });
        }
        if (update.stock !== undefined && !Number.isFinite(Number(update.stock))) {
            return res.status(400).json({ error: 'Stock must be a valid number.' });
        }
        const updated = await InventoryItem.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!updated) return res.status(404).json({ error: 'Inventory stock line item not found' });
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/inventory/:id', authRequired(['Admin']), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory id' });
        await InventoryItem.findByIdAndDelete(req.params.id);
        res.json({ message: 'Inventory asset profile cleared from active system records' });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        // Wasted food leaves the inventory — deduct stock when the item is on the menu.
        await Product.updateOne(
            { name: payload.productName },
            { $inc: { stock: -payload.quantity } }
        );
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
        await WasteItem.findByIdAndDelete(req.params.id);
        res.json({ message: 'Waste entry removed' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- AUDIT LOG ENDPOINT ----------------------
app.get('/api/audit', authRequired(['Admin']), async (req, res) => {
    try {
        const filter = {};
        const { from, to, limit } = req.query;
        if (from) {
            const fromDate = new Date(from);
            if (!isNaN(fromDate)) filter.date = { ...(filter.date || {}), $gte: fromDate };
        }
        if (to) {
            const toDate = new Date(to);
            if (!isNaN(toDate)) filter.date = { ...(filter.date || {}), $lte: toDate };
        }
        const max = Math.min(Math.max(Number(limit) || 500, 1), 5000);
        const logs = await AuditLog.find(filter).sort({ date: -1 }).limit(max);
        res.json(logs);
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
            const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
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
    });
}

// Quick smoke check of the production deployment — non-blocking, never crashes.
function checkRenderStatus() {
    const renderUrl = process.env.RENDER_URL || "https://season3-pos.onrender.com";
    const started = Date.now();
    fetch(`${renderUrl}/api/health`, { signal: AbortSignal.timeout(10000) })
        .then(res => {
            console.log(`${res.ok ? "✓" : "✗"} [Render] POS link ${renderUrl} is ${res.ok ? "ONLINE" : "OFFLINE"} (HTTP ${res.status}, ${Date.now() - started}ms)`);
        })
        .catch(err => {
            console.log(`✗ [Render] POS link ${renderUrl} is OFFLINE (${err.code || "timeout"}) — free tier may be waking (30-60s)`);
        });
}

// Seed once the DB is ready (covers the case where connection finishes after listen)
mongoose.connection.once('connected', () => {
    seedDefaultAdmin();
    cleanupLegacyOrderFields();
    console.log('🔄 Startup cleanup + admin seeding check complete.');
});

module.exports = app;
