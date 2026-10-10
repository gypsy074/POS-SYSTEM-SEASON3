/* ==========================================================================
   inventory.js — Stock & supply inventory module
   Handles: CRUD for inventory items, linking to menu products (inherit
   name/category/price/stock/threshold on save), low-stock highlighting,
   search + category/status filters, and summary stat chips.
   ========================================================================== */

// ── Filter state ───────────────────────────────────────────────────────────

let inventorySearch = "";
let inventoryFilterCategory = "";
let inventoryFilterStatus = "";

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

    updateInventoryButtonStates(false);
}

function setupInventoryFilters() {
    const searchInput  = document.getElementById("invSearch");
    const categorySel  = document.getElementById("invFilterCategory");
    const statusSel    = document.getElementById("invFilterStatus");

    if (searchInput) searchInput.addEventListener("input", () => {
        inventorySearch = searchInput.value.trim().toLowerCase();
        renderInventoryTable(allInventory);
    });
    if (categorySel) categorySel.addEventListener("change", () => {
        inventoryFilterCategory = categorySel.value;
        renderInventoryTable(allInventory);
    });
    if (statusSel) statusSel.addEventListener("change", () => {
        inventoryFilterStatus = statusSel.value;
        renderInventoryTable(allInventory);
    });
    setupInventoryLinkPicker();
}

function setupInventoryLinkPicker() {
    const trigger = document.getElementById("invLinkProductButton");
    const dialog = document.getElementById("invProductPickerDialog");
    const search = document.getElementById("invProductPickerSearch");
    const options = document.getElementById("invProductPickerOptions");
    const standalone = document.getElementById("invProductPickerStandalone");
    const closeButton = document.getElementById("invProductPickerClose");

    if (!trigger || !dialog || !search || !options || !standalone || !closeButton) return;

    trigger.addEventListener("click", () => {
        search.value = "";
        renderInventoryProductPickerOptions();
        dialog.showModal();
        trigger.setAttribute("aria-expanded", "true");
        search.focus();
    });
    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
    });
    search.addEventListener("input", renderInventoryProductPickerOptions);
    standalone.addEventListener("click", () => {
        const linkSelect = document.getElementById("invLinkedProduct");
        if (linkSelect) linkSelect.value = "";
        updateInventoryLinkTrigger();
        dialog.close();
        onInventoryLinkChange();
    });
    options.addEventListener("click", event => {
        const option = event.target.closest("button[data-product-id]");
        if (!option) return;

        const linkSelect = document.getElementById("invLinkedProduct");
        if (linkSelect) linkSelect.value = option.dataset.productId;
        updateInventoryLinkTrigger();
        dialog.close();
        onInventoryLinkChange();
    });
}

// The picker lists menu products alphabetically so a supply item can attach
// to one and inherit its data on save. Refreshes whenever inventory loads.
function populateInventoryLinkSelect() {
    renderInventoryProductPickerOptions();
    updateInventoryLinkTrigger();
}

function renderInventoryProductPickerOptions() {
    const options = document.getElementById("invProductPickerOptions");
    const empty = document.getElementById("invProductPickerEmpty");
    const search = document.getElementById("invProductPickerSearch");
    const linkSelect = document.getElementById("invLinkedProduct");
    const standalone = document.getElementById("invProductPickerStandalone");
    if (!options || !empty || !search || !linkSelect || !standalone) return;

    const query = search.value.trim().toLocaleLowerCase();
    const products = [...allProducts]
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
        .filter(product => String(product.name || "").toLocaleLowerCase().includes(query));

    options.replaceChildren();
    products.forEach(product => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "inv-product-picker-option";
        option.setAttribute("aria-pressed", String(product._id === linkSelect.value));
        option.dataset.productId = product._id;
        option.textContent = product.name || "(Unnamed product)";
        options.appendChild(option);
    });

    empty.hidden = products.length > 0;
    standalone.setAttribute("aria-pressed", String(!linkSelect.value));
}

function updateInventoryLinkTrigger() {
    const linkSelect = document.getElementById("invLinkedProduct");
    const trigger = document.getElementById("invLinkProductButton");
    if (!linkSelect || !trigger) return;

    const product = allProducts.find(item => item._id === linkSelect.value);
    trigger.textContent = !linkSelect.value
        ? "— None (standalone supply) —"
        : product ? (product.name || "(Unnamed product)") : "Linked product unavailable";
}

// Picking a linked menu product autofills the form from its data — tweak
// any field afterwards, the explicit values win on save.
function onInventoryLinkChange() {
    const sel = document.getElementById("invLinkedProduct");
    if (!sel) return;
    const product = allProducts.find(p => p._id === sel.value);
    if (!product) return;

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };
    set("invProdName", product.name || "");
    set("invCategory", product.category || "");
    set("invPrice", product.price ?? "");
    set("invStock", product.stock ?? "");
    set("invThreshold", product.lowStockThreshold ?? 10);
    set("invStatus", product.status || "Available");
}

// ── Button State Control ───────────────────────────────────────────────────

function updateInventoryButtonStates(hasSelection) {
    const addBtn    = document.getElementById("addInvBtn");
    const updateBtn = document.getElementById("updateInvBtn");
    const removeBtn = document.getElementById("removeInvBtn");

    if (addBtn) {
        addBtn.disabled = hasSelection;
        addBtn.style.opacity = hasSelection ? "0.4" : "1";
        addBtn.style.cursor  = hasSelection ? "not-allowed" : "pointer";
    }
    if (updateBtn) updateBtn.disabled = !hasSelection;
    if (removeBtn) removeBtn.disabled = !hasSelection;
}

// ── Row Selection ──────────────────────────────────────────────────────────

function selectInventoryRow(item) {
    selectedInventoryId = item._id;

    const linkSelect   = document.getElementById("invLinkedProduct");
    const nameInput    = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput   = document.getElementById("invPrice");
    const stockInput   = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput  = document.getElementById("invStatus");

    if (linkSelect)    linkSelect.value     = item.menuProductId || "";
    updateInventoryLinkTrigger();
    if (nameInput)     nameInput.value      = item.productName || "";
    if (categoryInput) categoryInput.value  = item.category || "Coffee Beans";
    if (priceInput)    priceInput.value     = item.price ?? "";
    if (stockInput)    stockInput.value     = item.stock ?? "";
    if (thresholdInput) thresholdInput.value = item.lowStockThreshold ?? "";
    if (unitsInput)    unitsInput.value     = item.unitsPerSale ?? "";
    if (statusInput)   statusInput.value    = item.status || "Available";

    updateInventoryButtonStates(true);

    document.querySelectorAll(".inv-row-selected").forEach(row => row.classList.remove("inv-row-selected"));
    const selectedRow = document.querySelector(`tr[data-inventory-id="${item._id}"]`);
    if (selectedRow) selectedRow.classList.add("inv-row-selected");
}

// ── Form Reset ─────────────────────────────────────────────────────────────

function clearInventoryForm() {
    selectedInventoryId = null;

    const linkSelect   = document.getElementById("invLinkedProduct");
    const nameInput    = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput   = document.getElementById("invPrice");
    const stockInput   = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput  = document.getElementById("invStatus");

    if (linkSelect)    linkSelect.value     = "";
    updateInventoryLinkTrigger();
    if (nameInput)     nameInput.value      = "";
    if (categoryInput) categoryInput.value  = "Coffee Beans";
    if (priceInput)    priceInput.value     = "";
    if (stockInput)    stockInput.value     = "";
    if (thresholdInput) thresholdInput.value = "";
    if (unitsInput)    unitsInput.value     = "";
    if (statusInput)   statusInput.value    = "Available";

    updateInventoryButtonStates(false);

    document.querySelectorAll(".inv-row-selected").forEach(row => row.classList.remove("inv-row-selected"));
}

// ── Payload Builder ────────────────────────────────────────────────────────

function getInventoryPayload() {
    const linkSelect    = document.getElementById("invLinkedProduct");
    const nameInput     = document.getElementById("invProdName");
    const categoryInput = document.getElementById("invCategory");
    const priceInput    = document.getElementById("invPrice");
    const stockInput    = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput   = document.getElementById("invStatus");

    const menuProductId = linkSelect    ? linkSelect.value.trim()    : "";
    const productName   = nameInput     ? nameInput.value.trim()     : "";
    const category      = categoryInput ? categoryInput.value        : "";
    const price         = priceInput    ? Number(priceInput.value)   : NaN;
    const stock         = stockInput    ? Number(stockInput.value)   : NaN;
    const lowStockThreshold = thresholdInput ? Number(thresholdInput.value) : NaN;
    const unitsPerSale  = unitsInput    ? Number(unitsInput.value)   : NaN;
    const status        = statusInput   ? statusInput.value          : "Available";

    if (!productName || !Number.isFinite(price) || !Number.isFinite(stock)) {
        showToast("Please complete inventory product name, price, and stock before saving.", "warning");
        return null;
    }

    const payload = {
        productName,
        category,
        price,
        stock,
        status,
        lowStockThreshold: Number.isFinite(lowStockThreshold) ? Math.max(0, lowStockThreshold) : 10,
        unitsPerSale: Number.isFinite(unitsPerSale) ? Math.max(0, unitsPerSale) : 1,
        date: new Date().toLocaleDateString()
    };
    if (menuProductId) payload.menuProductId = menuProductId;
    return payload;
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
            showToast("Inventory item added successfully!");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to create inventory item.");
    } catch (err) {
        console.error("❌ Inventory creation pipeline error:", err);
        showToast("Failed to save inventory item to database server.", "error");
    }
}

async function updateInventoryItem() {
    if (!selectedInventoryId) {
        showToast("Please select an inventory row from the table first before updating.", "warning");
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
            showToast("Inventory item updated successfully!");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to update inventory item.");
    } catch (err) {
        console.error("❌ Inventory update pipeline error:", err);
        showToast("Failed to update inventory item.", "error");
    }
}

async function deleteInventoryItem() {
    if (!selectedInventoryId) {
        showToast("Please select an inventory row from the table first to delete.", "warning");
        return;
    }

    const item = (allInventory || []).find(i => i._id === selectedInventoryId);
    const confirmed = await showConfirmModal({
        title: "Delete inventory item?",
        message: item
            ? `"${item.productName}" will be permanently removed from inventory. This cannot be undone.`
            : "This inventory item will be permanently removed. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) return;

    try {
        const response = await apiFetch(`/api/inventory/${selectedInventoryId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            showToast("Inventory item deleted successfully.");
            clearInventoryForm();
            loadLiveInventoryData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to delete inventory item.");
    } catch (err) {
        console.error("❌ Inventory deletion pipeline error:", err);
        showToast("Failed to delete inventory item.", "error");
    }
}

// ── Data Loader & Renderer ─────────────────────────────────────────────────

async function loadLiveInventoryData() {
    try {
        const response = await apiFetch("/api/inventory");
        if (!response.ok) throw new Error("Failed to fetch inventory list");

        const items = await response.json();
        allInventory = items;
        populateInventoryLinkSelect();
        renderInventoryTable(items);
    } catch (err) {
        console.error("❌ Inventory data load error:", err);
    }
}

function renderInventoryTable(items) {
    const tbody = document.getElementById("inventoryTableBody");
    if (!tbody) return;

    const filtered = (items || []).filter(item => {
        const haystack = [item.productName, item.category].join(" ").toLowerCase();
        if (inventorySearch && !haystack.includes(inventorySearch)) return false;
        if (inventoryFilterCategory && item.category !== inventoryFilterCategory) return false;
        if (inventoryFilterStatus && item.status !== inventoryFilterStatus) return false;
        return true;
    });

    const statsEls = {
        value: document.getElementById("invStatValue"),
        count: document.getElementById("invStatCount"),
        low:   document.getElementById("invStatLow")
    };
    if (statsEls.value || statsEls.count || statsEls.low) {
        const totalValue = (items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.stock || 0), 0);
        const lowCount = (items || []).filter(item =>
            Number(item.stock || 0) <= Number(item.lowStockThreshold ?? 10)
        ).length;
        if (statsEls.value) statsEls.value.textContent = `₱${totalValue.toFixed(2)}`;
        if (statsEls.count) statsEls.count.textContent = String((items || []).length);
        if (statsEls.low)   statsEls.low.textContent   = String(lowCount);
    }

    if (!filtered.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:#888; padding:22px;">
                    No inventory items match. ${(items || []).length ? "Try clearing the filters." : "Add your first supply item with the form."}
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const stock = Number(item.stock ?? 0);
        const low = stock <= Number(item.lowStockThreshold ?? 10);
        const linked = item.menuProductId
            ? '<span class="inv-link-badge" title="Linked to a menu product"><i class="fas fa-link"></i></span>'
            : "";
        return `
        <tr data-inventory-id="${item._id}">
            <td>${escapeHtml(item.productName)} ${linked}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>₱${Number(item.price).toFixed(2)}</td>
            <td class="${low ? "low-stock-cell" : ""}">${stock}</td>
            <td>${escapeHtml(String(item.lowStockThreshold ?? 10))}</td>
            <td>${escapeHtml(String(item.unitsPerSale ?? 1))}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.date)}</td>
            <td>
                <button type="button" class="restock-btn" data-restock-id="${item._id}" data-restock-type="inventory"
                    title="Restock this supply item">+ Restock</button>
            </td>
        </tr>`;
    }).join("");
}
