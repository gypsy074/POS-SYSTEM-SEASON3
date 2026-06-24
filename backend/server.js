const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// Middleware Engine Configuration
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Strict Database Connection Token Processing
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error('❌ FATAL: MONGO_URI is not defined in .env file. Server cannot start.');
    process.exit(1);
}

mongoose.connection.on('connected', () => {
    const dbName = mongoose.connection.db?.databaseName || 'unknown';
    console.log(`✅ Connected to MongoDB Atlas — Database: "${dbName}"`);
});

mongoose.connection.on('error', err => {
    console.error('❌ Database Connection Error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: true
}).catch(err => {
    console.error('❌ Initial MongoDB Connection Failed:', err.message);
    console.error('   → Check your MONGO_URI in .env and ensure your IP is whitelisted in Atlas.');
});

/* ==========================================================================
   1. DATABASE DATA MODELS & STRUCUTURAL SCHEMAS
   ========================================================================== */

// --- Order System Schema Configuration ---
const orderItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, required: true, min: 0, default: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    customer: { type: String, default: "Walk-in Customer" },
    tableNo: { type: String, default: "" },
    mode: { type: String, enum: ["Dine In", "To Go", "Online Order"], default: "Dine In" },
    date: { type: Date, default: Date.now },
    receiptId: { type: String, default: () => String(Date.now()).slice(-8) },
    items: { type: [orderItemSchema], default: [] },
    total: { type: Number, default: 0, min: 0 }
});
const Order = mongoose.model('Order', orderSchema);

// --- Menu Management Schema Configuration ---
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    status: { type: String, default: "Available" },
    image: { type: String, default: "" },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const Product = mongoose.model('Product', productSchema);

// --- Crew User Account Schema Configuration ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['Admin', 'Cashier'], default: 'Admin' },
    status: { type: String, default: 'Active' },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const User = mongoose.model('User', userSchema);

// --- Stock Supply Inventory Schema Configuration ---
const inventorySchema = new mongoose.Schema({
    productName: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    status: { type: String, default: 'Available' },
    date: { type: String, default: () => new Date().toLocaleDateString() }
});
const InventoryItem = mongoose.model('InventoryItem', inventorySchema);

/* ==========================================================================
   2. UTILITY INTERCEPTORS & VALIDATION ENGINES
   ========================================================================== */
function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function normalizeOrderPayload(input) {
    const items = Array.isArray(input.items)
        ? input.items.map(item => ({
            name: String(item.name || "Item").trim(),
            quantity: Number(item.quantity) || 1,
            price: Number(item.price) || 0
        }))
        : [];

    return {
        customer: String(input.customer || "Walk-in Customer").trim() || "Walk-in Customer",
        tableNo: String(input.tableNo || "").trim(),
        mode: ["Dine In", "To Go", "Online Order"].includes(input.mode) ? input.mode : "Dine In",
        receiptId: String(input.receiptId || String(Date.now()).slice(-8)),
        date: input.date ? new Date(input.date) : new Date(),
        items,
        total: Number(input.total) || items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    };
}

/* ==========================================================================
   3. REST API ENDPOINT NETWORKS
   ========================================================================== */
app.get('/', (req, res) => { res.redirect('/login.html'); });
app.get('/CASHIER', (req, res) => { res.redirect('/CASHIER/pos.html'); });
app.get('/CASHIER/', (req, res) => { res.redirect('/CASHIER/pos.html'); });

// ---------------------- AUTHENTICATION LOGIN ENDPOINT ----------------------
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }
        const user = await User.findOne({ username: username.trim() });
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        if (user.status !== 'Active') {
            return res.status(403).json({ error: 'Your account is inactive. Please contact an administrator.' });
        }
        res.json({
            success: true,
            role: user.role,
            username: user.username
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/health', (req, res) => {
    res.json({ ok: true, mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ---------------------- ORDER ENDPOINTS (CASHIER / ADMIN) ----------------------
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ _id: -1 });
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const payload = normalizeOrderPayload(req.body);
        if (!Array.isArray(payload.items) || !payload.items.length) {
            return res.status(400).json({ error: 'Order must include at least one item.' });
        }
        const newOrder = new Order(payload);
        res.status(201).json(await newOrder.save());
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------- MENU PRODUCT ENDPOINTS (CRUD) ----------------------
app.get('/api/products', async (req, res) => {
    try { res.json(await Product.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/categories', async (req, res) => {
    try { res.json(await Product.distinct('category')); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
    try {
        const newProduct = new Product(req.body);
        res.status(201).json(await newProduct.save());
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Product not found' });
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: 'Product successfully scrubbed from database' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- USER ACCOUNTS MANAGEMENT (CRUD) ----------------------
app.get('/api/users', async (req, res) => {
    try { res.json(await User.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', async (req, res) => {
    try {
        const newUser = new User(req.body);
        res.status(201).json(await newUser.save());
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
        const updated = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'User profile not found' });
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'User account deactivated and erased' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------- INVENTORY SUBSYSTEM ENDPOINTS (CRUD) ----------------------
app.get('/api/inventory', async (req, res) => {
    try { res.json(await InventoryItem.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory', async (req, res) => {
    try {
        const newItem = new InventoryItem(req.body);
        res.status(201).json(await newItem.save());
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/inventory/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory token id' });
        const updated = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Inventory stock line item not found' });
        res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid inventory id' });
        await InventoryItem.findByIdAndDelete(req.params.id);
        res.json({ message: 'Inventory asset profile cleared from active system records' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Initialise Service Execution Host Thread Loop
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Master Back-End Live and Running Cleanly on Port ${PORT}`));