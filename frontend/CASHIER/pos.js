

const API_BASE_URL = getApiBaseUrl();

let allProducts = [];
let activeCategory = "All";
let cart = [];
let selectedMode = "Dine In";
let selectedPayment = "cash";
let currentOrderId = generateOrderId();

document.addEventListener("DOMContentLoaded", () => {
    guardCashierPage();
    setupOfflineSupport();
    setupCashierControls();
    setupWasteLogForm();
    setupCashierProfile();
    loadCashierMenu();
    loadCashierHistory();
    updateDateLabel();
    updateSwipeSummary();
    renderOrderId();
    setupQuickTenderChips();
    setupCalculatorModal();
    setupKeyboardShortcuts();
    updateCalculatorVisibility();
    updateChangeCalculator();
});

function getApiBaseUrl() {
    // file:// (opened directly from disk, no server) → the local dev backend.
    if (window.location.protocol === "file:") {
        return "http://localhost:3000";
    }
    // Served by the backend itself (local dev on :3000 or a live deploy) —
    // always use the same origin so the cashier works on any host.
    return window.location.origin;
}

function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem("posToken") || "";
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    return fetch(`${API_BASE_URL}${path}`, { ...options, headers }).then(response => {
        if (response.status === 401) {
            localStorage.removeItem("posToken");
            localStorage.removeItem("posUser");
            window.location.href = "../login.html";
        }
        return response;
    });
}

// Page guard: opening the POS without a valid session → back to login.
// When offline, a previously logged-in cashier is still let in so orders
// can be taken and queued for later sync.
async function guardCashierPage() {
    try {
        const response = await apiFetch("/api/auth/me");
        if (!response.ok) {
            window.location.href = "../login.html";
            return;
        }
        const data = await response.json();
        if (data.role !== "Cashier") {
            window.location.href = "../ADMIN/admin.html";
        }
    } catch (err) {
        const token = localStorage.getItem("posToken");
        if (!token) {
            window.location.href = "../login.html";
        }
    }
}

/* ==========================================================================
   PWA offline support — order queue + auto-sync
   Orders that fail to reach the server are stored in localStorage and
   pushed once the connection returns. Each queued order carries a
   clientOrderId so the backend never saves it twice.
   ========================================================================== */

const OFFLINE_QUEUE_KEY = "posOfflineOrders";

function getOfflineQueue() {
    try {
        const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveOfflineQueue(queue) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch {
        // Storage full — keep the last 10 orders, drop the oldest.
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-10)));
    }
}

function queueOfflineOrder(payload) {
    const queue = getOfflineQueue();
    const existingIndex = queue.findIndex(order => order.clientOrderId === payload.clientOrderId);
    if (existingIndex >= 0) {
        queue[existingIndex] = payload; // keep the latest copy of the same order
    } else {
        queue.push(payload);
    }
    saveOfflineQueue(queue);
}

async function flushOfflineOrders() {
    if (!navigator.onLine) {
        return;
    }
    const queue = getOfflineQueue();
    if (!queue.length) {
        return;
    }

    let synced = 0;
    const remaining = [];

    for (const payload of queue) {
        try {
            const response = await apiFetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                synced += 1;
            } else {
                remaining.push(payload);
            }
        } catch (err) {
            // Still offline or the server is unreachable — retry next time.
            remaining.push(payload);
        }
    }

    saveOfflineQueue(remaining);
    updateOfflineBanner();

    if (synced > 0) {
        playSound("success");
        loadCashierHistory();
        showSyncBanner(synced);
    }
}

function getOfflineQueueCount() {
    return getOfflineQueue().length;
}

function updateOfflineBanner() {
    const banner = document.getElementById("offlineBanner");
    if (!banner) {
        return;
    }
    const text = document.getElementById("offlineBannerText");
    const queued = getOfflineQueueCount();

    if (navigator.onLine) {
        banner.style.display = "none";
        return;
    }

    banner.classList.add("offline");
    banner.style.display = "flex";
    if (text) {
        text.textContent = queued > 0
            ? `You're offline — ${queued} order${queued === 1 ? "" : "s"} saved and waiting to sync.`
            : "You're offline — orders will be saved and synced automatically.";
    }
}

// Green confirmation strip shown briefly after queued orders finish syncing.
let syncBannerTimer = null;
function showSyncBanner(count) {
    const banner = document.getElementById("offlineBanner");
    const text = document.getElementById("offlineBannerText");
    if (!banner) {
        return;
    }
    banner.classList.remove("offline");
    banner.style.display = "flex";
    if (text) {
        text.textContent = `${count} offline order${count === 1 ? "" : "s"} synced ✓`;
    }
    clearTimeout(syncBannerTimer);
    syncBannerTimer = setTimeout(() => {
        banner.style.display = "none";
    }, 4000);
}

function setupOfflineSupport() {
    // Service worker powers the app shell cache so the POS opens offline.
    if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
        navigator.serviceWorker.register("sw.js").catch(err => {
            console.error("❌ Service worker registration failed:", err);
        });
    }

    window.addEventListener("online", () => {
        updateOfflineBanner();
        flushOfflineOrders();
    });
    window.addEventListener("offline", () => {
        playSound("error");
        updateOfflineBanner();
    });

    updateOfflineBanner();
    // Recovered orders from a previous session sync as soon as we're online.
    flushOfflineOrders();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/* ==========================================================================
   Sound feedback engine — browser-generated tones (no audio files needed)
   ========================================================================== */

let posAudioContext = null;
let soundEnabled = localStorage.getItem("posSoundOn") !== "off";

function getAudioContext() {
    if (!posAudioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
            posAudioContext = new Ctx();
        }
    }
    return posAudioContext;
}

function tone(freq, duration, volume = 0.18, type = "sine", delay = 0) {
    const ctx = getAudioContext();
    if (!ctx) {
        return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = ctx.currentTime + delay;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
}

function playSound(name) {
    if (!soundEnabled) {
        return;
    }
    const ctx = getAudioContext();
    if (!ctx) {
        return;
    }
    if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
    }

    switch (name) {
        case "add":     tone(880, 0.08, 0.18, "triangle"); break;
        case "qty":     tone(620, 0.05, 0.12, "sine"); break;
        case "remove":  tone(440, 0.07, 0.15, "triangle"); break;
        case "cancel":  tone(330, 0.12, 0.15, "sine"); tone(220, 0.18, 0.15, "sine", 0.1); break;
        case "swipe":   tone(500, 0.12, 0.15, "sine"); tone(900, 0.12, 0.15, "sine", 0.08); break;
        case "success": tone(660, 0.12, 0.2, "triangle"); tone(880, 0.22, 0.2, "triangle", 0.12); break;
        case "error":   tone(180, 0.3, 0.22, "sawtooth"); break;
        case "ping":    tone(1200, 0.08, 0.1, "sine"); break;
        default: break;
    }
}

function setSoundEnabled(on) {
    soundEnabled = on;
    localStorage.setItem("posSoundOn", on ? "on" : "off");
    const btn = document.getElementById("soundToggleBtn");
    if (btn) {
        btn.classList.toggle("muted", !on);
        btn.title = on ? "Mute sounds" : "Unmute sounds";
        const icon = btn.querySelector("i");
        if (icon) {
            icon.className = `fa-solid ${on ? "fa-volume-high" : "fa-volume-xmark"}`;
        }
    }
    if (on) {
        playSound("ping");
    }
}

/**
 * Generates a random order ID like #A3F9K2
 */
function generateOrderId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "#";
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

function renderOrderId() {
    const el = document.getElementById("currentOrderId");
    if (el) el.textContent = currentOrderId;
}

function updateDateLabel() {
    const dateDisplay = document.getElementById("currentDate");
    if (!dateDisplay) {
        return;
    }

    dateDisplay.textContent = new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric"
    });
}

function setupCashierControls() {
    const categoryContainer = document.getElementById("categoryTabsContainer");
    const searchInput = document.getElementById("searchInput");
    const notificationTrigger = document.querySelector(".notification-trigger");
    const cancelOrderBtn = document.getElementById("cancelOrderBtn");
    const swipeTrack = document.getElementById("swipeTrack");
    const modeButtons = document.querySelectorAll(".mode-btn");
    const backButtons = document.querySelectorAll(".circular-back-btn");

    // ── Sound toggle ──
    const soundToggleBtn = document.getElementById("soundToggleBtn");
    if (soundToggleBtn) {
        setSoundEnabled(localStorage.getItem("posSoundOn") !== "off");
        soundToggleBtn.addEventListener("click", () => {
            setSoundEnabled(!soundEnabled);
        });
    }

    // ── Order history panel ──
    const historyTrigger = document.getElementById("historyTrigger");
    const historyCloseBtn = document.getElementById("historyCloseBtn");
    const historyBackdrop = document.getElementById("historyBackdrop");
    const historySearchInput = document.getElementById("historySearchInput");

    if (historyTrigger) {
        historyTrigger.addEventListener("click", () => {
            setHistoryPanelOpen(!document.getElementById("historyPanel")?.classList.contains("open"));
        });
    }
    if (historyCloseBtn) {
        historyCloseBtn.addEventListener("click", () => setHistoryPanelOpen(false));
    }
    if (historyBackdrop) {
        historyBackdrop.addEventListener("click", () => setHistoryPanelOpen(false));
    }
    if (historySearchInput) {
        historySearchInput.addEventListener("input", event => {
            historySearchTerm = event.target.value;
            renderCashierHistory();
        });
    }
    setInterval(loadCashierHistory, 30000);

    if (categoryContainer) {
        categoryContainer.addEventListener("click", event => {
            const tab = event.target.closest(".tab-item[data-category]");
            if (!tab) {
                return;
            }

            displayCategoryItems(tab.dataset.category);
        });
    }

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            displayCategoryItems(activeCategory, searchInput.value);
        });
    }


    if (notificationTrigger) {
        notificationTrigger.addEventListener("click", event => {
            event.stopPropagation();
            const dropdown = document.getElementById("notificationDropdown");
            if (dropdown) {
                const wasOpen = dropdown.classList.contains("show");
                dropdown.classList.toggle("show");
                if (!wasOpen) {
                    dismissSeenNotifications();
                }
            }
        });
    }

    // Close the notification dropdown when clicking anywhere outside it.
    document.addEventListener("click", event => {
        const dropdown = document.getElementById("notificationDropdown");
        if (!dropdown || !dropdown.classList.contains("show")) {
            return;
        }
        if (dropdown.contains(event.target) || event.target.closest(".notification-wrap")) {
            return;
        }
        dropdown.classList.remove("show");
    });

    if (cancelOrderBtn) {
        cancelOrderBtn.addEventListener("click", cancelOrder);
    }

    const paymentRadios = document.querySelectorAll('input[name="payment"]');
    paymentRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            selectedPayment = radio.value;
            updateSwipeSummary();
            updateCalculatorVisibility();
            updateChangeCalculator();
        });
    });

    if (swipeTrack) {
        setupSwipeSubmit();
    }

    modeButtons.forEach(button => {
        button.addEventListener("click", () => {
            selectedMode = button.dataset.mode;
            modeButtons.forEach(item => item.classList.remove("active"));
            button.classList.add("active");
        });
    });

    if (backButtons[0]) {
        backButtons[0].addEventListener("click", () => {
            document.getElementById("categoryTabsContainer")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    if (backButtons[1]) {
        backButtons[1].addEventListener("click", cancelOrder);
    }
}

async function loadCashierMenu() {
    await refreshCashierProducts();
    // Keep the menu + stock alerts live while the page is open.
    setInterval(refreshCashierProducts, 20000);
}

async function refreshCashierProducts() {
    try {
        const response = await apiFetch("/api/products");
        if (!response.ok) {
            throw new Error("Failed to fetch cashier menu");
        }

        allProducts = await response.json();
        const searchInput = document.getElementById("searchInput");
        renderCategoryTabs();
        displayCategoryItems(activeCategory, searchInput ? searchInput.value : "");
        syncCashierNotifications();
        buildWasteProductSearch();
    } catch (err) {
        console.error("❌ Failed to refresh cashier menu:", err);
    }
}

/* ==========================================================================
   Cashier notifications — low stock / out of stock / newly added items
   ========================================================================== */

let cashierNotificationState = {
    seenIds: new Set(),
    initialized: false,
    lastLowStockCount: 0
};

function restoreSeenProductIds() {
    try {
        const raw = sessionStorage.getItem("posSeenProductIds");
        const list = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(list) ? list : []);
    } catch {
        return new Set();
    }
}

function saveSeenProductIds() {
    try {
        sessionStorage.setItem("posSeenProductIds", JSON.stringify([...cashierNotificationState.seenIds]));
    } catch {
        // ignore
    }
}

function syncCashierNotifications() {
    const state = cashierNotificationState;
    const seenIds = state.initialized ? state.seenIds : restoreSeenProductIds();
    const currentIds = new Set(allProducts.map(product => product._id));

    const lowStockItems = allProducts.filter(product => productIsLowStock(product) || productIsSoldOut(product));
    const newItems = [];

    if (state.initialized) {
        allProducts.forEach(product => {
            if (!seenIds.has(product._id) && !productIsSoldOut(product)) {
                newItems.push(product);
            }
        });
    }

    state.seenIds = new Set(currentIds);
    state.initialized = true;
    saveSeenProductIds();

    renderCashierNotificationPanel(lowStockItems, newItems);
    updateCashierNotificationBadge(lowStockItems.length + newItems.length);
}

function renderCashierNotificationPanel(lowStockItems, newItems) {
    const panel = document.getElementById("notificationDropdown");
    if (!panel) {
        return;
    }

    const entries = [];

    newItems.forEach(product => {
        entries.push({
            cls: "notification-item-success",
            icon: "fa-circle-plus",
            title: `New item — ${product.name}`,
            sub: `${product.category || "Uncategorized"} · ₱${Number(product.price || 0).toFixed(2)}`
        });
    });

    lowStockItems.forEach(product => {
        if (newItems.some(newItem => newItem._id === product._id)) {
            return; // already shown as a new item
        }
        const soldOut = productIsSoldOut(product);
        entries.push({
            cls: soldOut ? "notification-item-danger" : "notification-item-warning",
            icon: soldOut ? "fa-box-open" : "fa-triangle-exclamation",
            title: `${soldOut ? "Out of stock" : "Low stock"} — ${product.name}`,
            sub: `${productStock(product)} left · threshold ${Number(product.lowStockThreshold ?? 10)}`
        });
    });

    panel.innerHTML = entries.length
        ? entries.map(entry => `
            <div class="notification-item ${entry.cls}">
                <i class="fa-solid ${entry.icon}"></i>
                <div>
                    <strong>${escapeHtml(entry.title)}</strong>
                    <span>${escapeHtml(entry.sub)}</span>
                </div>
            </div>
        `).join("")
        : `<div class="notification-item">
                <i class="fa-solid fa-circle-check"></i>
                <div>
                    <strong>All clear</strong>
                    <span>No low-stock alerts right now</span>
                </div>
            </div>`;
}

function updateCashierNotificationBadge(count) {
    const badge = document.getElementById("notificationBadge");
    if (!badge) {
        return;
    }

    if (count > 0) {
        badge.textContent = count;
        badge.style.display = "flex";
        if (count > cashierNotificationState.lastLowStockCount) {
            playSound("ping");
            badge.classList.remove("badge-pop");
            void badge.offsetWidth; // restart the pop animation
            badge.classList.add("badge-pop");
            const bell = document.querySelector(".notification-trigger i");
            if (bell) {
                bell.classList.remove("bell-shake");
                void bell.offsetWidth;
                bell.classList.add("bell-shake");
            }
        }
    } else {
        badge.style.display = "none";
    }

    cashierNotificationState.lastLowStockCount = count;
}

function dismissSeenNotifications() {
    // Mark current products as seen so "new item" alerts don't repeat.
    cashierNotificationState.seenIds = new Set(allProducts.map(product => product._id));
    saveSeenProductIds();

    // Re-render immediately so the panel + badge reflect only real alerts.
    const lowStockItems = allProducts.filter(product => productIsLowStock(product) || productIsSoldOut(product));
    renderCashierNotificationPanel(lowStockItems, []);
    updateCashierNotificationBadge(lowStockItems.length);
}

/* ==========================================================================
   Cashier order history — this cashier's own orders (view-only)
   ========================================================================== */

let cashierOrders = [];
let historySearchTerm = "";

async function loadCashierHistory() {
    try {
        const response = await apiFetch("/api/orders");
        if (!response.ok) {
            return;
        }
        const orders = await response.json();
        const myName = getCashierName().toLowerCase();
        cashierOrders = (Array.isArray(orders) ? orders : [])
            .filter(order => String(order.cashier || "").toLowerCase() === myName);
        renderCashierHistory();
    } catch (err) {
        console.error("❌ Failed to load order history:", err);
    }
}

function renderCashierHistory() {
    const list = document.getElementById("historyOrderList");
    const statsCount = document.getElementById("historyTodayCount");
    const statsRevenue = document.getElementById("historyTodayRevenue");
    if (!list) {
        return;
    }

    const today = new Date();
    const todayOrders = cashierOrders.filter(order => {
        const d = new Date(order.date);
        return d.getFullYear() === today.getFullYear()
            && d.getMonth() === today.getMonth()
            && d.getDate() === today.getDate();
    });
    const todayRevenue = todayOrders.reduce(
        (sum, order) => (order.status === "Voided" ? sum : sum + Number(order.total || 0)),
        0
    );

    if (statsCount) statsCount.textContent = todayOrders.length;
    if (statsRevenue) statsRevenue.textContent = `₱${todayRevenue.toFixed(2)}`;

    const term = historySearchTerm.trim().toLowerCase();
    const filtered = cashierOrders.filter(order =>
        !term
        || String(order.receiptId || "").toLowerCase().includes(term)
        || String(order.customer || "").toLowerCase().includes(term)
    );

    list.innerHTML = filtered.length
        ? filtered.slice(0, 50).map(order => {
            const isVoided = order.status === "Voided";
            return `
            <button type="button" class="history-order-item${isVoided ? " voided" : ""}" data-order-id="${escapeHtml(order._id)}">
                <div class="history-order-main">
                    <strong>${escapeHtml(order.receiptId)}</strong>
                    <span>${escapeHtml(order.customer)} · ${escapeHtml(order.mode || "Dine In")}</span>
                    ${isVoided ? `<span class="history-void-badge">VOIDED</span>` : ""}
                </div>
                <div class="history-order-side">
                    <strong>₱${Number(order.total || 0).toFixed(2)}</strong>
                    <span>${new Date(order.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
            </button>
        `;
        }).join("")
        : `<div class="history-empty">${term ? "No orders match your search." : "No orders yet. Orders you place will appear here."}</div>`;

    list.querySelectorAll("[data-order-id]").forEach(btn => {
        btn.addEventListener("click", () => showCashierOrderDetail(btn.dataset.orderId));
    });
}

function showCashierOrderDetail(orderId) {
    const order = cashierOrders.find(o => o._id === orderId);
    const detail = document.getElementById("historyDetail");
    if (!order || !detail) {
        return;
    }

    const isVoided = order.status === "Voided";

    detail.innerHTML = `
        <div class="history-detail-head">
            <strong>${escapeHtml(order.receiptId)}</strong>
            <span>${new Date(order.date).toLocaleString()}</span>
        </div>
        <div class="pos-modal-summary">
            <div class="row"><span>Customer</span><strong>${escapeHtml(order.customer)}</strong></div>
            <div class="row"><span>Mode</span><strong>${escapeHtml(order.mode || "Dine In")}</strong></div>
            <div class="row"><span>Payment</span><strong>${escapeHtml(order.paymentMethod || "Cash")}</strong></div>
            <div class="row"><span>Status</span><strong>${isVoided ? `<span class="history-void-badge">VOIDED</span>` : "Completed"}</strong></div>
            ${isVoided && order.voidedBy ? `<div class="row"><span>Voided by</span><strong>${escapeHtml(order.voidedBy)}</strong></div>` : ""}
            ${isVoided && order.voidedAt ? `<div class="row"><span>Voided at</span><strong>${new Date(order.voidedAt).toLocaleString()}</strong></div>` : ""}
            ${isVoided && order.voidReason ? `<div class="row"><span>Reason</span><strong>${escapeHtml(order.voidReason)}</strong></div>` : ""}
            ${order.tableNo ? `<div class="row"><span>Table</span><strong>${escapeHtml(order.tableNo)}</strong></div>` : ""}
        </div>
        <div class="history-items">
            ${(order.items || []).map(item => `
                <div class="pos-modal-item-row">
                    <span>${escapeHtml(item.name)} × ${item.quantity}</span>
                    <strong>₱${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</strong>
                </div>
            `).join("")}
        </div>
        <div class="pos-modal-total"><span>Total</span><span>₱${Number(order.total || 0).toFixed(2)}</span></div>
        <div class="history-detail-actions">
            <button type="button" class="pos-modal-btn pos-modal-btn-secondary" id="historyPrintBtn">Print</button>
            ${!isVoided ? `<button type="button" class="pos-modal-btn pos-modal-btn-danger" id="historyVoidBtn">Void Order</button>` : ""}
            <button type="button" class="pos-modal-btn pos-modal-btn-secondary" id="historyDetailBackBtn">Back to list</button>
        </div>`;

    const printBtn = document.getElementById("historyPrintBtn");
    if (printBtn) printBtn.addEventListener("click", () => printReceipt(order));

    const voidBtn = document.getElementById("historyVoidBtn");
    if (voidBtn) voidBtn.addEventListener("click", () => requestOrderVoid(order._id));

    document.getElementById("historyDetailBackBtn").addEventListener("click", () => {
        detail.classList.remove("show");
    });

    detail.classList.add("show");
}

function requestOrderVoid(orderId) {
    const order = cashierOrders.find(o => o._id === orderId);
    if (!order || order.status === "Voided") {
        return;
    }

    showPosConfirm({
        title: "Void Order",
        icon: "fa-ban",
        iconClass: "danger",
        primaryLabel: "Void Order",
        bodyHtml: `
            <p class="pos-modal-note">Voiding <strong>#${escapeHtml(order.receiptId)}</strong> (₱${Number(order.total || 0).toFixed(2)}). Menu stock will be restored. This cannot be undone.</p>
            <label class="pos-modal-field">
                <span>Reason (optional)</span>
                <textarea id="voidReasonInput" rows="3" placeholder="e.g. Customer changed their mind..."></textarea>
            </label>`
    }).then(confirmed => {
        if (!confirmed) return;
        const input = document.getElementById("voidReasonInput");
        fetchVoidOrder(orderId, input ? input.value : "");
    });
}

async function fetchVoidOrder(orderId, reason) {
    try {
        const response = await apiFetch(`/api/orders/${orderId}/void`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Failed to void the order.");
        }
        playSound("success");
        const detail = document.getElementById("historyDetail");
        if (detail) detail.classList.remove("show");
        showPosAlert({
            title: "Order Voided",
            icon: "fa-ban",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-note">The order was voided and menu stock was restored.</p>`
        });
        loadCashierHistory();
    } catch (err) {
        playSound("error");
        showPosAlert({
            title: "Void Failed",
            icon: "fa-circle-exclamation",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-note">${escapeHtml(err.message)}</p>`
        });
    }
}

function setHistoryPanelOpen(open) {
    const panel = document.getElementById("historyPanel");
    const backdrop = document.getElementById("historyBackdrop");
    if (panel) panel.classList.toggle("open", open);
    if (backdrop) backdrop.classList.toggle("show", open);
    if (open) {
        loadCashierHistory();
    }
}

function renderCategoryTabs() {
    const tabContainer = document.getElementById("categoryTabsContainer");
    if (!tabContainer) {
        return;
    }

    const categories = [...new Set(allProducts.map(product => product.category))].filter(Boolean);
    const displayTabs = ["All", ...categories];

    tabContainer.innerHTML = displayTabs.length
        ? displayTabs.map(category => {
            const count = category === "All"
                ? allProducts.length
                : allProducts.filter(product => product.category === category).length;
            return `
                <div class="tab-item ${category === activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
                    <h3>${escapeHtml(category)}</h3>
                    <p>${count} items</p>
                </div>
            `;
        }).join("")
        : `<div class="tab-item active"><h3>No categories yet</h3><p>Add menu items in the admin panel</p></div>`;
}

function productStock(product) {
    return Number(product && product.stock);
}

function productIsSoldOut(product) {
    return !product || productStock(product) <= 0;
}

function productIsLowStock(product) {
    return !productIsSoldOut(product) && productStock(product) <= Number(product.lowStockThreshold ?? 10);
}

function displayCategoryItems(category, searchTerm = "") {
    activeCategory = category;
    renderCategoryTabs();

    const grid = document.getElementById("menuGrid");
    if (!grid) {
        return;
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const products = allProducts.filter(product => {
        const matchesCategory = category === "All" || !category || product.category === category;
        const matchesSearch = !normalizedSearch
            || product.name.toLowerCase().includes(normalizedSearch)
            || (product.category || "").toLowerCase().includes(normalizedSearch)
            || (product.status || "").toLowerCase().includes(normalizedSearch);

        return matchesCategory && matchesSearch;
    });

    grid.innerHTML = products.length
        ? products.map(product => {
            const soldOut = productIsSoldOut(product);
            const lowStock = productIsLowStock(product);
            return `
            <article class="food-card ${soldOut ? "sold-out-card" : ""}">
                <img src="${escapeHtml(product.image || createPlaceholderImage(product.name))}" alt="${escapeHtml(product.name)}">
                <div class="food-info">
                    <h4>${escapeHtml(product.name)}</h4>
                    <div class="price-box">
                        <span>₱${Number(product.price || 0).toFixed(2)}</span>
                        <button type="button" class="add-circle" data-product-id="${product._id}" ${soldOut ? "disabled" : ""}>
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                    ${soldOut
                        ? '<div class="sold-out-overlay"><span>OUT OF STOCK</span></div>'
                        : lowStock
                            ? `<div class="low-stock-badge">Only ${productStock(product)} left</div>`
                            : ""}
                </div>
            </article>
        `;
        }).join("")
        : `<div class="food-card"><div class="food-info"><h4>No items found</h4><p>Try a different category or search term.</p></div></div>`;

    grid.querySelectorAll("[data-product-id]").forEach(button => {
        button.addEventListener("click", event => {
            event.stopPropagation();
            addToCart(button.dataset.productId);
        });
    });
}

function createPlaceholderImage(label) {
    const safeLabel = escapeHtml(label || "Menu Item");
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
            <defs>
                <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stop-color="#f0d5c0"/>
                    <stop offset="100%" stop-color="#a67c52"/>
                </linearGradient>
            </defs>
            <rect width="600" height="400" rx="40" fill="url(#g)"/>
            <circle cx="480" cy="90" r="64" fill="rgba(255,255,255,0.2)"/>
            <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="34" font-weight="700">${safeLabel}</text>
        </svg>
    `)}`;
}

function addToCart(productId) {
    const product = allProducts.find(item => item._id === productId);
    if (!product) {
        return;
    }

    const available = productStock(product);
    if (available <= 0) {
        showPosAlert({
            title: "Out of Stock",
            icon: "fa-circle-exclamation",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-note">${escapeHtml(product.name)} is out of stock.</p>`
        });
        return;
    }

    const existingItem = cart.find(item => item._id === productId);
    const currentQty = existingItem ? existingItem.quantity : 0;
    if (currentQty >= available) {
        showPosAlert({
            title: "Stock Limit Reached",
            icon: "fa-circle-exclamation",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-note">Only ${available} left in stock for ${escapeHtml(product.name)}.</p>`
        });
        return;
    }

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }

    playSound("add");
    renderCart();

    // Long carts hide newly added items below the fold — keep them visible.
    const cartContainer = document.getElementById("cartContainer");
    if (cartContainer) {
        cartContainer.scrollTop = cartContainer.scrollHeight;
    }
}

function renderCart() {
    const cartContainer = document.getElementById("cartContainer");
    const totalPrice = document.getElementById("totalPrice");

    if (!cartContainer || !totalPrice) {
        return;
    }

    cartContainer.innerHTML = cart.length
        ? cart.map((item, index) => `
            <div class="cart-row">
                <img class="cart-item-img" src="${escapeHtml(item.image || createPlaceholderImage(item.name))}" alt="${escapeHtml(item.name)}">
                <div class="cart-row-details">
                    <h5>${escapeHtml(item.name)}</h5>
                    <p>₱${Number(item.price || 0).toFixed(2)}</p>
                </div>
                <div class="qty-control-pill">
                    <button type="button" class="qty-btn" data-cart-action="decrease" data-cart-index="${index}">-</button>
                    <span class="qty-number">${item.quantity}</span>
                    <button type="button" class="qty-btn" data-cart-action="increase" data-cart-index="${index}">+</button>
                </div>
                <button type="button" class="remove-item-btn" data-cart-action="remove" data-cart-index="${index}">Remove</button>
            </div>
        `).join("")
        : `<div class="cart-row"><div class="cart-row-details"><h5>Your cart is empty</h5><p>Tap a menu item to add it here.</p></div></div>`;

    cartContainer.querySelectorAll("[data-cart-action]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.cartIndex);
            const action = button.dataset.cartAction;

            if (action === "increase") changeQuantity(index, 1);
            if (action === "decrease") changeQuantity(index, -1);
            if (action === "remove") removeCartItem(index);
        });
    });

    const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
    totalPrice.textContent = `₱${total.toFixed(2)}`;
    updateSwipeSummary();
    updateChangeCalculator();
}

function setupSwipeSubmit() {
    const swipeTrack = document.getElementById("swipeTrack");
    const swipeThumb = document.getElementById("swipeThumb");
    if (!swipeTrack || !swipeThumb) return;

    let dragging = false;
    let startX = 0;
    let thumbStartOffset = 0;
    let currentOffset = 0;
    let suppressClick = false;

    // Thumb sits at left:5px; keep a 5px margin on the right too.
    const maxTravel = () => swipeTrack.clientWidth - swipeThumb.offsetWidth - 10;

    function setThumbOffset(offset) {
        currentOffset = Math.max(0, Math.min(maxTravel(), offset));
        swipeThumb.style.transform = `translateX(${currentOffset}px)`;
    }

    function resetThumb() {
        currentOffset = 0;
        swipeThumb.style.transform = "translateX(0px)";
    }

    async function processSubmit() {
        swipeTrack.classList.add("processing");
        playSound("swipe");
        try {
            await submitOrder();
        } finally {
            setTimeout(() => swipeTrack.classList.remove("processing"), 400);
        }
    }

    function beginDrag(clientX) {
        if (swipeTrack.classList.contains("processing")) return;
        if (!cart.length) {
            showPosAlert({
                title: "Empty Cart",
                icon: "fa-basket-shopping",
                iconClass: "info",
                bodyHtml: '<p class="pos-modal-note">Add at least one item before placing an order.</p>'
            });
            return;
        }
        dragging = true;
        suppressClick = true;
        startX = clientX;
        thumbStartOffset = currentOffset;
        swipeThumb.classList.add("dragging");
    }

    function moveDrag(clientX) {
        if (!dragging) return;
        setThumbOffset(thumbStartOffset + (clientX - startX));
    }

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        swipeThumb.classList.remove("dragging");

        const travel = maxTravel();
        const released = travel > 0 && currentOffset >= travel * 0.85;
        resetThumb();

        if (released) {
            // Guard against the synthetic click that follows mouse/touch up.
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 600);
            processSubmit();
        }
    }

    const handleThumbClick = () => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        processSubmit();
    };

    // Mouse drag
    swipeThumb.addEventListener("mousedown", event => {
        event.preventDefault();
        beginDrag(event.clientX);
    });
    document.addEventListener("mousemove", event => moveDrag(event.clientX));
    document.addEventListener("mouseup", () => endDrag());

    // Touch drag (touchscreens)
    swipeThumb.addEventListener("touchstart", event => {
        event.preventDefault();
        beginDrag(event.touches[0].clientX);
    }, { passive: false });
    document.addEventListener("touchmove", event => {
        if (dragging) {
            event.preventDefault();
            moveDrag(event.touches[0].clientX);
        }
    }, { passive: false });
    document.addEventListener("touchend", () => endDrag());

    // Fallbacks: a tap on the thumb or anywhere on the track also places the order.
    swipeThumb.addEventListener("click", event => {
        event.stopPropagation();
        handleThumbClick();
    });
    swipeTrack.addEventListener("click", () => {
        if (suppressClick) return;
        if (!cart.length) {
            showPosAlert({
                title: "Empty Cart",
                icon: "fa-basket-shopping",
                iconClass: "info",
                bodyHtml: '<p class="pos-modal-note">Add at least one item before placing an order.</p>'
            });
            return;
        }
        processSubmit();
    });
}

function updateSwipeSummary() {
    const swipeText = document.getElementById("swipeText");
    const swipeTrack = document.getElementById("swipeTrack");
    const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
    if (swipeText) {
        swipeText.textContent = cart.length
            ? `Swipe to Place Order (${selectedPayment.toUpperCase()}) ₱${total.toFixed(2)}`
            : `Add items to begin your order`;
    }
    if (swipeTrack) {
        swipeTrack.classList.toggle("ready", cart.length > 0);
    }
}

/* ==========================================================================
   Cash change calculator — amount received, change, quick tender, keypad
   ========================================================================== */

const CHANGE_DENOMINATIONS = [1000, 500, 200, 100, 50, 20];
let tenderedAmount = 0;

function updateCalculatorVisibility() {
    const bar = document.getElementById("cashCalcBar");
    if (bar) {
        bar.classList.toggle("hidden", selectedPayment !== "cash");
    }
}

function updateChangeCalculator() {
    const input = document.getElementById("amountTenderedInput");
    const changeEl = document.getElementById("changeAmount");
    const breakdownEl = document.getElementById("changeBreakdown");
    const swipeTrack = document.getElementById("swipeTrack");
    const receivedChip = document.getElementById("cashReceivedChip");
    const changeChip = document.getElementById("cashChangeChip");
    if (!changeEl) {
        return;
    }

    const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
    const tendered = input ? parseFloat(input.value) || 0 : 0;
    tenderedAmount = tendered;
    const change = tendered - total;

    changeEl.textContent = `₱${Math.max(0, change).toFixed(2)}`;
    changeEl.classList.toggle("insufficient", change < 0);

    if (receivedChip) receivedChip.textContent = `₱${tendered.toFixed(2)}`;
    if (changeChip) {
        changeChip.textContent = `₱${Math.max(0, change).toFixed(2)}`;
        changeChip.classList.toggle("insufficient", change < 0);
    }

    if (breakdownEl && change > 0) {
        const parts = calculateChangeBreakdown(change);
        breakdownEl.innerHTML = parts.length
            ? parts.map(part => `<span class="breakdown-chip">₱${part.denom} × ${part.count}</span>`).join("")
            : "";
    } else if (breakdownEl) {
        breakdownEl.innerHTML = "";
    }

    if (swipeTrack) {
        const short = selectedPayment === "cash" && tendered > 0 && change < 0;
        swipeTrack.classList.toggle("insufficient-cash", short);
        if (short) {
            swipeTrack.classList.remove("ready");
        }
    }
}

function calculateChangeBreakdown(amount) {
    const parts = [];
    let remaining = Math.round(Number(amount || 0) * 100);
    for (const denom of CHANGE_DENOMINATIONS) {
        const cents = denom * 100;
        if (remaining >= cents) {
            const count = Math.floor(remaining / cents);
            remaining -= count * cents;
            parts.push({ denom, count });
        }
    }
    return parts;
}

function calcPress(key) {
    const input = document.getElementById("amountTenderedInput");
    if (!input) {
        return;
    }
    let value = input.value || "";
    if (key === "clear") {
        value = "";
    } else if (key === "backspace") {
        value = value.slice(0, -1);
    } else if (key === ".") {
        if (!value.includes(".")) value = value === "" ? "0." : value + ".";
    } else if (value.includes(".")) {
        const decimals = value.split(".")[1] || "";
        if (decimals.length < 2) value += key;
    } else {
        value += key;
    }
    input.value = value;
    playSound("qty");
    updateChangeCalculator();
}

function setupQuickTenderChips() {
    document.querySelectorAll(".tender-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const input = document.getElementById("amountTenderedInput");
            if (!input) {
                return;
            }
            if (chip.dataset.amount === "exact") {
                const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
                input.value = total > 0 ? total.toFixed(2) : "";
            } else {
                input.value = chip.dataset.amount;
            }
            playSound("qty");
            updateChangeCalculator();
        });
    });
}

function setupCalculatorModal() {
    const overlay = document.getElementById("calcModalOverlay");
    const openBtn = document.getElementById("calcOpenBtn");
    const closeBtn = document.getElementById("calcModalCloseBtn");
    const doneBtn = document.getElementById("calcDoneBtn");
    const keypad = document.getElementById("calcKeypad");
    if (!overlay || !openBtn) {
        return;
    }

    function openModal() {
        overlay.classList.add("show");
        const input = document.getElementById("amountTenderedInput");
        if (input) {
            input.focus();
            input.select();
        }
        updateChangeCalculator();
        playSound("qty");
    }

    function closeModal() {
        overlay.classList.remove("show");
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (doneBtn) {
        doneBtn.addEventListener("click", () => {
            playSound("qty");
            closeModal();
        });
    }
    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay.classList.contains("show")) {
            closeModal();
        }
    });

    if (keypad) {
        keypad.querySelectorAll("[data-calc-key]").forEach(key => {
            key.addEventListener("click", () => calcPress(key.dataset.calcKey));
        });
    }
}

function resetChangeCalculator() {
    const input = document.getElementById("amountTenderedInput");
    if (input) input.value = "";
    tenderedAmount = 0;
    updateChangeCalculator();
}

function changeQuantity(index, delta) {
    const item = cart[index];
    if (!item) {
        return;
    }

    const product = allProducts.find(p => p._id === item._id);
    const available = product ? productStock(product) : Infinity;

    if (delta > 0 && item.quantity >= available) {
        showPosAlert({
            title: "Stock Limit Reached",
            icon: "fa-circle-exclamation",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-note">Only ${available} left in stock for ${escapeHtml(item.name)}.</p>`
        });
        return;
    }

    item.quantity += delta;

    if (item.quantity <= 0) {
        cart.splice(index, 1);
    }

    playSound("qty");
    renderCart();
}

function removeCartItem(index) {
    cart.splice(index, 1);
    playSound("remove");
    renderCart();
}

async function submitOrder() {
    if (!cart.length) {
        showPosAlert({
            title: "Empty Cart",
            icon: "fa-basket-shopping",
            iconClass: "info",
            bodyHtml: '<p class="pos-modal-note">Add at least one item before placing an order.</p>'
        });
        return;
    }

    // Cash guard: the amount received must cover the total.
    if (selectedPayment === "cash") {
        const orderTotal = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
        if (tenderedAmount < orderTotal) {
            playSound("error");
            await showPosAlert({
                title: "Insufficient cash",
                icon: "fa-hand-holding-dollar",
                iconClass: "danger",
                bodyHtml: `<p class="pos-modal-error-text">Amount received (₱${tenderedAmount.toFixed(2)}) is less than the total (₱${orderTotal.toFixed(2)}).\nTap "Exact" or enter the customer's cash first.</p>`,
                buttonLabel: "OK"
            });
            return;
        }
    }

    const customerInput = document.getElementById("customerNameInput");
    const tableInput = document.getElementById("tableNoInput");
    const customer = customerInput ? customerInput.value.trim() : "Walk-in Customer";
    const tableNo = tableInput ? tableInput.value.trim() : "";

    // Idempotency key: unique per order, stable across sync retries so the
    // backend never saves the same order twice.
    const clientOrderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const payload = {
        customer: customer || "Walk-in Customer",
        cashier: getCashierName(),
        tableNo,
        mode: selectedMode,
        paymentMethod: selectedPayment,
        receiptId: currentOrderId,
        clientOrderId,
        date: new Date().toISOString(),
        items: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price || 0)
        })),
        total: cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0),
        tendered: selectedPayment === "cash" ? tenderedAmount : 0,
        change: selectedPayment === "cash"
            ? Math.max(0, tenderedAmount - cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0))
            : 0
    };

    try {
        // Review step: catch mistakes BEFORE the order is placed.
        const confirmed = await showPosConfirm({
            title: "Review your order",
            icon: "fa-receipt",
            bodyHtml: `
                <div class="pos-modal-items">
                    ${payload.items.map(item => `
                        <div class="pos-modal-item-row">
                            <span>${escapeHtml(item.name)} × ${item.quantity}</span>
                            <strong>₱${(Number(item.price) * item.quantity).toFixed(2)}</strong>
                        </div>
                    `).join("")}
                </div>
                <div class="pos-modal-summary">
                    <div class="row"><span>Mode</span><strong>${escapeHtml(selectedMode)}</strong></div>
                    <div class="row"><span>Payment</span><strong>${selectedPayment.toUpperCase()}</strong></div>
                    <div class="row"><span>Cashier</span><strong>${escapeHtml(getCashierName())}</strong></div>
                    <div class="pos-modal-total"><span>Total</span><span>₱${Number(payload.total).toFixed(2)}</span></div>
                </div>`,
            primaryLabel: "Place Order",
            secondaryLabel: "Cancel"
        });
        if (!confirmed) return;

        const response = await apiFetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            throw new Error(errorPayload?.error || "Failed to place order");
        }

        const createdOrder = await response.json();
        playSound("success");

        const changeGiven = selectedPayment === "cash"
            ? `<div class="row"><span>Change</span><strong>₱${Number(createdOrder.change ?? Math.max(0, tenderedAmount - Number(payload.total))).toFixed(2)}</strong></div>`
            : "";

        await showPosAlert({
            title: "Order placed!",
            icon: "fa-circle-check",
            iconClass: "success",
            bodyHtml: `
                <div class="pos-modal-success-icon"><i class="fa-solid fa-circle-check"></i></div>
                <div class="pos-modal-receipt-card">
                    <div class="receipt-id">${escapeHtml(createdOrder.receiptId || currentOrderId)}</div>
                    <div class="row"><span>Customer</span><strong>${escapeHtml(payload.customer)}</strong></div>
                    <div class="row"><span>Payment</span><strong>${selectedPayment.toUpperCase()}</strong></div>
                    <div class="row"><span>Total</span><strong>₱${Number(payload.total).toFixed(2)}</strong></div>
                    ${changeGiven}
                </div>
                <button type="button" class="pos-modal-btn pos-modal-btn-secondary" id="printReceiptBtn">Print receipt</button>`,
            buttonLabel: "Done",
            afterDom: body => {
                const printBtn = body.querySelector("#printReceiptBtn");
                if (printBtn) printBtn.addEventListener("click", () => printReceipt(createdOrder));
            }
        });

        cancelOrder(true);
        loadCashierHistory();
        flushOfflineOrders(); // a pending queue may clear now that we're online
    } catch (err) {
        // Network failure (offline / server unreachable) → keep the order
        // locally and sync it automatically once the connection returns.
        if (!navigator.onLine || err instanceof TypeError) {
            queueOfflineOrder(payload);
            updateOfflineBanner();
            playSound("success");
            await showPosAlert({
                title: "Order saved offline",
                icon: "fa-cloud-arrow-down",
                iconClass: "warning",
                bodyHtml: `
                    <div class="pos-modal-success-icon" style="color: var(--pos-warn, #f59e0b);"><i class="fa-solid fa-cloud-arrow-down"></i></div>
                    <p class="pos-modal-note">The connection is down, so this order (${escapeHtml(payload.receiptId)} — ₱${Number(payload.total).toFixed(2)}) was saved on this device.<br><br>It will be sent to the server automatically when the connection returns.</p>`,
                buttonLabel: "OK"
            });
            cancelOrder(true);
            loadCashierHistory();
            return;
        }

        console.error("❌ Failed to submit order:", err);
        playSound("error");
        await showPosAlert({
            title: "Order failed",
            icon: "fa-circle-xmark",
            iconClass: "danger",
            bodyHtml: `<p class="pos-modal-error-text">${escapeHtml(err.message)}</p>`,
            buttonLabel: "OK"
        });
    }
}

/* ==========================================================================
   Digital receipt — prints via the browser dialog (Save as PDF / share).
   No thermal printer required.
   ========================================================================== */

function printReceipt(order) {
    if (!order) return;
    let host = document.getElementById("printReceiptHost");
    if (!host) {
        host = document.createElement("div");
        host.id = "printReceiptHost";
        document.body.appendChild(host);
    }

    const items = (order.items || []).map(item => `
        <div class="print-line"><span>${escapeHtml(item.name)} × ${item.quantity}</span><span>₱${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</span></div>
    `).join("");

    host.innerHTML = `
        <div class="print-receipt">
            <div class="print-head">
                <img src="../assets/logo.png" alt="logo">
                <strong class="print-shop">Season 3 Kitchen &amp; Cafe</strong>
                <span>${new Date(order.date || Date.now()).toLocaleString()}</span>
            </div>
            <div class="print-meta">
                <div><span>Receipt</span><strong>${escapeHtml(order.receiptId || "")}</strong></div>
                <div><span>Cashier</span><strong>${escapeHtml(order.cashier || "")}</strong></div>
                <div><span>Customer</span><strong>${escapeHtml(order.customer || "Walk-in Customer")}</strong></div>
                <div><span>Mode</span><strong>${escapeHtml(order.mode || "Dine In")}</strong></div>
                <div><span>Payment</span><strong>${escapeHtml(order.paymentMethod || "Cash")}</strong></div>
            </div>
            <div class="print-items">${items}</div>
            <div class="print-total">
                <div><span>Total</span><strong>₱${Number(order.total || 0).toFixed(2)}</strong></div>
                ${String(order.paymentMethod || "").toLowerCase().includes("cash") ? `
                <div><span>Tendered</span><strong>₱${Number(order.tendered ?? 0).toFixed(2)}</strong></div>
                <div><span>Change</span><strong>₱${Number(order.change ?? 0).toFixed(2)}</strong></div>` : ""}
            </div>
            <div class="print-foot">Thank you for your order!<br>Please come again.</div>
        </div>`;

    window.print();
}

/* ==========================================================================
   Keyboard shortcuts — Enter = exact cash (cash mode), Esc = close overlays
   ========================================================================== */

function setupKeyboardShortcuts() {
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            const calcOverlay = document.getElementById("calcModalOverlay");
            if (calcOverlay && calcOverlay.classList.contains("show")) {
                calcOverlay.classList.remove("show");
                event.preventDefault();
                return;
            }
            const posOverlay = document.getElementById("posModalOverlay");
            if (posOverlay && posOverlay.classList.contains("show")) {
                posOverlay.classList.remove("show");
                event.preventDefault();
                return;
            }
            const historyPanel = document.getElementById("historyPanel");
            if (historyPanel && historyPanel.classList.contains("open")) {
                setHistoryPanelOpen(false);
                event.preventDefault();
                return;
            }
            const dropdown = document.getElementById("cashierDropdown");
            if (dropdown && dropdown.classList.contains("show")) {
                dropdown.classList.remove("show");
                event.preventDefault();
            }
            return;
        }

        if (event.key === "Enter" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
            && selectedPayment === "cash") {
            const activeTag = document.activeElement && document.activeElement.tagName;
            if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
                return;
            }
            if (document.querySelector(".pos-modal-overlay.show") || document.querySelector(".calc-modal-overlay.show")) {
                return;
            }
            event.preventDefault();
            const input = document.getElementById("amountTenderedInput");
            if (input) {
                const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
                input.value = total > 0 ? total.toFixed(2) : "";
                playSound("qty");
                updateChangeCalculator();
            }
        }
    });
}

// ── Themed modal helpers (confirmation + alert) ────────────────────────────

function showPosConfirm({ title, icon = "fa-receipt", iconClass = "", bodyHtml, primaryLabel = "Confirm", secondaryLabel = "Cancel" }) {
    return new Promise(resolve => {
        const overlay = document.getElementById("posModalOverlay");
        const iconEl = document.getElementById("posModalIcon");
        const titleEl = document.getElementById("posModalTitle");
        const body = document.getElementById("posModalBody");
        const actions = document.getElementById("posModalActions");
        if (!overlay || !body || !actions) { resolve(true); return; }

        iconEl.className = `pos-modal-icon ${iconClass}`;
        iconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        titleEl.textContent = title;
        body.innerHTML = bodyHtml;
        actions.innerHTML = `
            <button type="button" class="pos-modal-btn pos-modal-btn-secondary" data-modal-action="cancel">${escapeHtml(secondaryLabel)}</button>
            <button type="button" class="pos-modal-btn pos-modal-btn-primary" data-modal-action="confirm">${escapeHtml(primaryLabel)}</button>`;

        actions.querySelector('[data-modal-action="cancel"]').addEventListener("click", () => {
            overlay.classList.remove("show");
            resolve(false);
        });
        actions.querySelector('[data-modal-action="confirm"]').addEventListener("click", () => {
            overlay.classList.remove("show");
            resolve(true);
        });

        overlay.classList.add("show");
    });
}

function showPosAlert({ title, icon = "fa-circle-check", iconClass = "success", bodyHtml, buttonLabel = "OK", afterDom } = {}) {
    return new Promise(resolve => {
        const overlay = document.getElementById("posModalOverlay");
        const iconEl = document.getElementById("posModalIcon");
        const titleEl = document.getElementById("posModalTitle");
        const body = document.getElementById("posModalBody");
        const actions = document.getElementById("posModalActions");
        if (!overlay || !body || !actions) { resolve(); return; }

        iconEl.className = `pos-modal-icon ${iconClass}`;
        iconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        titleEl.textContent = title;
        body.innerHTML = bodyHtml;
        actions.innerHTML = `
            <button type="button" class="pos-modal-btn pos-modal-btn-primary" data-modal-action="ok">${escapeHtml(buttonLabel)}</button>`;

        actions.querySelector('[data-modal-action="ok"]').addEventListener("click", () => {
            overlay.classList.remove("show");
            resolve();
        });

        overlay.classList.add("show");
        if (typeof afterDom === "function") afterDom(body);
    });
}

function cancelOrder(silent = false) {
    if (cart.length && !silent) {
        playSound("cancel");
    }
    cart = [];
    currentOrderId = generateOrderId(); // fresh ID for next order
    renderOrderId();
    renderCart();
    resetChangeCalculator();
}

function getCashierName() {
    const saved = JSON.parse(localStorage.getItem("posUser") || "null");
    return (saved && saved.username) || "Pranselen";
}

// ── Waste Food Logging ────────────────────────────────────────────────────

async function logWasteItems(items, reason) {
    let logged = 0;
    for (const item of items || []) {
        try {
            const response = await apiFetch("/api/waste", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productName: item.name,
                    cashier: getCashierName(),
                    quantity: item.quantity,
                    price: Number(item.price || 0),
                    reason
                })
            });
            if (response.ok) logged++;
        } catch (err) {
            console.error("❌ Waste log failed:", err);
        }
    }
    if (logged > 0) {
        showPosAlert({
            title: "Waste Logged",
            icon: "fa-circle-check",
            iconClass: "success",
            bodyHtml: `<p class="pos-modal-note">${logged} item(s) logged as food waste.</p>`
        });
    }
}

// ── Waste product search combobox ─────────────────────────────────────────

let wasteSelectedProductId = null;
let wasteActiveIndex = 0;

function buildWasteProductSearch() {
    renderWasteProductDropdown(document.getElementById("wasteProductName")?.value || "");
}

function openWasteDropdown() {
    const dropdown = document.getElementById("wasteProductDropdown");
    if (!dropdown) {
        return;
    }
    wasteActiveIndex = 0;
    renderWasteProductDropdown(document.getElementById("wasteProductName")?.value || "");
    dropdown.style.display = "block";
}

function renderWasteProductDropdown(searchTerm) {
    const dropdown = document.getElementById("wasteProductDropdown");
    if (!dropdown) {
        return;
    }

    const term = (searchTerm || "").trim().toLowerCase();
    const matches = (allProducts || []).filter(product =>
        !term
        || product.name.toLowerCase().includes(term)
        || (product.category || "").toLowerCase().includes(term)
    );

    dropdown.innerHTML = matches.length
        ? matches.map((product, index) => `
            <button type="button" class="waste-product-option ${index === 0 ? "selected" : ""}" data-product-id="${escapeHtml(product._id)}">
                <span class="wpo-name">${escapeHtml(product.name)}</span>
                <span class="wpo-meta">${escapeHtml(product.category || "Uncategorized")} · ₱${Number(product.price || 0).toFixed(2)}</span>
            </button>
        `).join("")
        : `<div class="waste-product-option waste-product-empty">No items found</div>`;

    dropdown.querySelectorAll("[data-product-id]").forEach(option => {
        option.addEventListener("click", () => selectWasteProduct(option.dataset.productId));
    });
}

function moveWasteHighlight(delta) {
    const dropdown = document.getElementById("wasteProductDropdown");
    if (!dropdown) {
        return;
    }
    const options = [...dropdown.querySelectorAll("[data-product-id]")];
    if (!options.length) {
        return;
    }
    wasteActiveIndex = Math.max(0, Math.min(options.length - 1, wasteActiveIndex + delta));
    options.forEach((option, index) => option.classList.toggle("selected", index === wasteActiveIndex));
    options[wasteActiveIndex].scrollIntoView({ block: "nearest" });
}

function selectWasteProduct(productId) {
    const product = allProducts.find(p => p._id === productId);
    const nameInput = document.getElementById("wasteProductName");
    const priceInput = document.getElementById("wastePrice");
    const dropdown = document.getElementById("wasteProductDropdown");
    if (!product) {
        return;
    }

    if (nameInput) nameInput.value = product.name;
    if (priceInput) priceInput.value = Number(product.price || 0).toFixed(2);
    wasteSelectedProductId = productId;
    if (dropdown) dropdown.style.display = "none";
    playSound("qty");
}

function setupWasteLogForm() {
    const form = document.getElementById("wasteLogForm");
    const toggleBtn = document.getElementById("logWasteBtn");
    const saveBtn = document.getElementById("wasteSaveBtn");
    const cancelBtn = document.getElementById("wasteCancelBtn");

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            if (form) form.style.display = form.style.display === "none" ? "block" : "none";
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            if (form) form.style.display = "none";
        });
    }

    // ── Product search combobox (rebuilt every time the menu refreshes) ──
    buildWasteProductSearch();

    const nameInput = document.getElementById("wasteProductName");
    if (nameInput) {
        nameInput.addEventListener("focus", openWasteDropdown);
        nameInput.addEventListener("input", () => {
            wasteSelectedProductId = null;
            openWasteDropdown();
        });
        nameInput.addEventListener("keydown", event => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                moveWasteHighlight(1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveWasteHighlight(-1);
            } else if (event.key === "Enter") {
                const dropdown = document.getElementById("wasteProductDropdown");
                const selected = dropdown
                    ? dropdown.querySelector(".waste-product-option.selected[data-product-id]")
                    : null;
                if (selected) {
                    event.preventDefault();
                    selectWasteProduct(selected.dataset.productId);
                }
            } else if (event.key === "Escape") {
                const dropdown = document.getElementById("wasteProductDropdown");
                if (dropdown) dropdown.style.display = "none";
            }
        });
    }

    // Close the dropdown when clicking anywhere outside it.
    document.addEventListener("click", event => {
        const dropdown = document.getElementById("wasteProductDropdown");
        if (dropdown && dropdown.style.display !== "none" && !event.target.closest(".waste-product-search")) {
            dropdown.style.display = "none";
        }
    });

    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const name = document.getElementById("wasteProductName");
            const qtyInput = document.getElementById("wasteQty");
            const priceInput = document.getElementById("wastePrice");
            const reasonSelect = document.getElementById("wasteReason");

            const productName = (name ? name.value : "").trim();
            const quantity = Number(qtyInput ? qtyInput.value : 0);
            const price = Number(priceInput ? priceInput.value : 0);

            if (!productName) {
                showPosAlert({
                    title: "Missing Product Name",
                    icon: "fa-circle-info",
                    iconClass: "info",
                    bodyHtml: '<p class="pos-modal-note">Enter the product name.</p>'
                });
                return;
            }
            if (!(quantity > 0)) {
                showPosAlert({
                    title: "Invalid Quantity",
                    icon: "fa-circle-info",
                    iconClass: "info",
                    bodyHtml: '<p class="pos-modal-note">Enter a quantity above zero.</p>'
                });
                return;
            }

            try {
                const response = await apiFetch("/api/waste", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productName,
                        cashier: getCashierName(),
                        quantity,
                        price,
                        reason: reasonSelect ? reasonSelect.value : "Other"
                    })
                });
                if (!response.ok) throw new Error("Failed to log waste");
                showPosAlert({
                    title: "Waste Logged",
                    icon: "fa-circle-check",
                    iconClass: "success",
                    bodyHtml: '<p class="pos-modal-note">Waste logged successfully.</p>'
                });
                if (form) form.style.display = "none";
                if (name) name.value = "";
                if (qtyInput) qtyInput.value = "";
                if (priceInput) priceInput.value = "";
            } catch (err) {
                console.error("❌ Waste save failed:", err);
                showPosAlert({
                    title: "Log Failed",
                    icon: "fa-circle-exclamation",
                    iconClass: "danger",
                    bodyHtml: '<p class="pos-modal-note">Failed to log the waste.</p>'
                });
            }
        });
    }
}

// ── Cashier Profile ───────────────────────────────────────────────────────

function setupCashierProfile() {
    const badge = document.getElementById("cashierProfile");
    const wrap = document.getElementById("cashierProfileWrap");
    const dropdown = document.getElementById("cashierDropdown");
    const logoutBtn = document.getElementById("cashierLogoutBtn");
    if (!badge || !wrap) return;

    const saved = JSON.parse(localStorage.getItem("posUser") || "null");
    const username = (saved && saved.username) || "Pranselen";
    const role = (saved && saved.role) || "Cashier";
    const initials = username.slice(0, 2).toUpperCase();

    const nameEl = document.getElementById("cashierName");
    const roleEl = document.getElementById("cashierRole");
    if (nameEl) nameEl.textContent = username;
    if (roleEl) roleEl.textContent = role;
    badge.querySelectorAll(".user-avatar").forEach(el => el.textContent = initials);
    const dropAvatar = document.getElementById("cashierDropdownAvatar");
    if (dropAvatar) dropAvatar.textContent = initials;
    if (dropdown) {
        const dropName = dropdown.querySelector("strong");
        const dropRole = dropdown.querySelector("span");
        if (dropName) dropName.textContent = username;
        if (dropRole) dropRole.textContent = role;
    }

    badge.addEventListener("click", event => {
        event.stopPropagation();
        wrap.classList.toggle("open");
        if (dropdown) dropdown.classList.toggle("show");
    });

    document.addEventListener("click", event => {
        if (dropdown && dropdown.classList.contains("show") && !wrap.contains(event.target)) {
            wrap.classList.remove("open");
            dropdown.classList.remove("show");
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("posToken");
            localStorage.removeItem("posUser");
            window.location.href = "../login.html";
        });
    }
}