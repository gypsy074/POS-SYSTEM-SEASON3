

const API_BASE_URL = getApiBaseUrl();

let allProducts = [];
let activeCategory = "All";
let cart = [];
let selectedMode = "Dine In";
let selectedPayment = "cash";
let currentOrderId = generateOrderId();

document.addEventListener("DOMContentLoaded", () => {
    setupCashierControls();
    loadCashierMenu();
    updateDateLabel();
    updateSwipeSummary();
    renderOrderId();
});

function getApiBaseUrl() {
    if (window.location.protocol === "file:") {
        return "http://localhost:3000";
    }

    if (window.location.port === "3000") {
        return window.location.origin;
    }

    return "http://localhost:3000";
}

function apiFetch(path, options) {
    return fetch(`${API_BASE_URL}${path}`, options);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
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
        notificationTrigger.addEventListener("click", () => {
            alert(`Cart items: ${cart.reduce((sum, item) => sum + item.quantity, 0)}`);
        });
    }

    if (cancelOrderBtn) {
        cancelOrderBtn.addEventListener("click", cancelOrder);
    }

    const paymentRadios = document.querySelectorAll('input[name="payment"]');
    paymentRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            selectedPayment = radio.value;
            updateSwipeSummary();
        });
    });

    if (swipeTrack) {
        swipeTrack.addEventListener("click", async () => {
            if (!cart.length) {
                alert("Add at least one item before placing an order.");
                return;
            }

            swipeTrack.classList.add("processing");
            await submitOrder();
            setTimeout(() => swipeTrack.classList.remove("processing"), 400);
        });
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
    try {
        const response = await apiFetch("/api/products");
        if (!response.ok) {
            throw new Error("Failed to fetch cashier menu");
        }

        allProducts = await response.json();
        renderCategoryTabs();
        displayCategoryItems("All");
    } catch (err) {
        console.error("❌ Failed to load cashier menu:", err);
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
        ? products.map(product => `
            <article class="food-card ${product.status === "Out of Stock" ? "sold-out-card" : ""}">
                <img src="${escapeHtml(product.image || createPlaceholderImage(product.name))}" alt="${escapeHtml(product.name)}">
                <div class="food-info">
                    <h4>${escapeHtml(product.name)}</h4>
                    <div class="price-box">
                        <span>₱${Number(product.price || 0).toFixed(2)}</span>
                        <button type="button" class="add-circle" data-product-id="${product._id}" ${product.status === "Out of Stock" ? "disabled" : ""}>
                            <i class="fa-solid fa-plus"></i>
                        </button>
                    </div>
                </div>
                ${product.status === "Out of Stock" ? '<div class="sold-out-overlay"><span>OUT OF STOCK</span></div>' : ""}
            </article>
        `).join("")
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

    const existingItem = cart.find(item => item._id === productId);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ ...product, quantity: 1 });
    }

    renderCart();
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
}

function updateSwipeSummary() {
    const swipeText = document.getElementById("swipeText");
    const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0);
    if (swipeText) {
        swipeText.textContent = cart.length
            ? `Swipe to Place Order (${selectedPayment.toUpperCase()}) ₱${total.toFixed(2)}`
            : `Add items to begin your order`;
    }
}

function changeQuantity(index, delta) {
    const item = cart[index];
    if (!item) {
        return;
    }

    item.quantity += delta;

    if (item.quantity <= 0) {
        cart.splice(index, 1);
    }

    renderCart();
}

function removeCartItem(index) {
    cart.splice(index, 1);
    renderCart();
}

async function submitOrder() {
    if (!cart.length) {
        alert("Add at least one item before placing an order.");
        return;
    }

    const customerInput = document.getElementById("customerNameInput");
    const tableInput = document.getElementById("tableNoInput");
    const customer = customerInput ? customerInput.value.trim() : "Walk-in Customer";
    const tableNo = tableInput ? tableInput.value.trim() : "";

    const payload = {
        customer: customer || "Walk-in Customer",
        tableNo,
        mode: selectedMode,
        paymentMethod: selectedPayment,
        receiptId: currentOrderId,
        date: new Date().toISOString(),
        items: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price || 0)
        })),
        total: cart.reduce((sum, item) => sum + (Number(item.price || 0) * item.quantity), 0)
    };

    try {
        const response = await apiFetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error("Failed to place order");
        }

        alert("Order placed successfully.");
        cancelOrder();
    } catch (err) {
        console.error("❌ Failed to submit order:", err);
        alert("Failed to place the order.");
    }
}

function cancelOrder() {
    cart = [];
    currentOrderId = generateOrderId(); // fresh ID for next order
    renderOrderId();
    renderCart();
}