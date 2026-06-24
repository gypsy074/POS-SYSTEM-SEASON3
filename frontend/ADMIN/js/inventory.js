/* ==========================================================================
   inventory.js — Stock & supply inventory module
   Handles: CRUD for inventory items.
   ========================================================================== */

// ── Setup ──────────────────────────────────────────────────────────────────

function setupInventoryTableSelection() {
    const inventoryTableBody = document.getElementById("inventoryTableBody");
    if (!inventoryTableBody) return;

    inventoryTableBody.addEventListener("click", event => {
        const row = event.target.closest("tr[data-inventory-id]");
        if (!row) return;

        const inventory = allInventory.find(item => item._id === row.dataset.inventoryId);
        if (inventory) selectInventoryRow(inventory);
    });
}

function setupInventoryActionButtons() {
    const addInvBtn    = document.getElementById("addInvBtn");
    const updateInvBtn = document.getElementById("updateInvBtn");
    const removeInvBtn = document.getElementById("removeInvBtn");
    const clearInvBtn  = document.getElementById("clearInvBtn");

    if (addInvBtn)    addInvBtn.addEventListener("click", addInventoryItem);
    if (updateInvBtn) updateInvBtn.addEventListener("click", updateInventoryItem);
    if (removeInvBtn) removeInvBtn.addEventListener("click", deleteInventoryItem);
    if (clearInvBtn)  clearInvBtn.addEventListener("click", clearInventoryForm);
}

// ── Row Selection ──────────────────────────────────────────────────────────

function selectInventoryRow(item) {
    selectedInventoryId = item._id;

    const nameInput     = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput    = document.getElementById("invPrice");
    const stockInput    = document.getElementById("invStock");
    const statusInput   = document.getElementById("invStatus");

    if (nameInput)     nameInput.value     = item.productName || "";
    if (categoryInput) categoryInput.value = item.category    || "Coffee";
    if (priceInput)    priceInput.value    = item.price       ?? "";
    if (stockInput)    stockInput.value    = item.stock       ?? "";
    if (statusInput)   statusInput.value   = item.status      || "Available";
}

// ── Form Reset ─────────────────────────────────────────────────────────────

function clearInventoryForm() {
    selectedInventoryId = null;

    const nameInput     = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput    = document.getElementById("invPrice");
    const stockInput    = document.getElementById("invStock");
    const statusInput   = document.getElementById("invStatus");

    if (nameInput)     nameInput.value     = "";
    if (categoryInput) categoryInput.value = "Coffee";
    if (priceInput)    priceInput.value    = "";
    if (stockInput)    stockInput.value    = "";
    if (statusInput)   statusInput.value   = "Available";
}

// ── Payload Builder ────────────────────────────────────────────────────────

function getInventoryPayload() {
    const nameInput     = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput    = document.getElementById("invPrice");
    const stockInput    = document.getElementById("invStock");
    const statusInput   = document.getElementById("invStatus");

    const productName = nameInput     ? nameInput.value.trim()      : "";
    const category    = categoryInput ? categoryInput.value         : "";
    const price       = priceInput    ? Number(priceInput.value)    : NaN;
    const stock       = stockInput    ? Number(stockInput.value)    : NaN;
    const status      = statusInput   ? statusInput.value           : "Available";

    if (!productName || !Number.isFinite(price) || !Number.isFinite(stock)) {
        alert("Please complete inventory product name, price, and stock before saving.");
        return null;
    }

    return {
        productName,
        category,
        price,
        stock,
        status,
        date: new Date().toLocaleDateString()
    };
}

// ── CRUD Operations ────────────────────────────────────────────────────────

async function addInventoryItem() {
    const payload = getInventoryPayload();
    if (!payload) return;

    try {
        const response = await apiFetch("/api/inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("✅ Inventory item added successfully!");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to create inventory item.");
    } catch (err) {
        console.error("❌ Inventory creation pipeline error:", err);
        alert("Failed to save inventory item to database server.");
    }
}

async function updateInventoryItem() {
    if (!selectedInventoryId) {
        alert("Please select an inventory row from the table first before updating.");
        return;
    }

    const payload = getInventoryPayload();
    if (!payload) return;

    try {
        const response = await apiFetch(`/api/inventory/${selectedInventoryId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("✅ Inventory item updated successfully!");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to update inventory item.");
    } catch (err) {
        console.error("❌ Inventory update pipeline error:", err);
        alert("Failed to update inventory item.");
    }
}

async function deleteInventoryItem() {
    if (!selectedInventoryId) {
        alert("Please select an inventory row from the table first to delete.");
        return;
    }

    if (!confirm("Are you sure you want to delete this inventory item?")) return;

    try {
        const response = await apiFetch(`/api/inventory/${selectedInventoryId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            alert("🗑️ Inventory item deleted successfully.");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to delete inventory item.");
    } catch (err) {
        console.error("❌ Inventory deletion pipeline error:", err);
        alert("Failed to delete inventory item.");
    }
}

// ── Data Loader & Renderer ─────────────────────────────────────────────────

async function loadLiveInventoryData() {
    try {
        const response = await apiFetch("/api/inventory");
        if (!response.ok) throw new Error("Failed to fetch inventory list");

        const items = await response.json();
        allInventory = items;
        renderInventoryTable(items);
    } catch (err) {
        console.error("❌ Inventory data load error:", err);
    }
}

function renderInventoryTable(items) {
    const tbody = document.getElementById("inventoryTableBody");
    if (!tbody) return;

    tbody.innerHTML = items.map(item => `
        <tr data-inventory-id="${item._id}">
            <td>${escapeHtml(item.productName)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>₱${Number(item.price).toFixed(2)}</td>
            <td>${escapeHtml(String(item.stock))}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.date)}</td>
        </tr>
    `).join("");
}
