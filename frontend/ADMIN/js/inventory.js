/* ==========================================================================
   inventory.js — Stock & supply inventory module
   Handles: CRUD for inventory items, linking to MULTIPLE menu products
   (each sale of any linked item deducts stock), low-stock highlighting,
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
    setupCategoryDropdowns();
}

function getInventoryCategories() {
    const categories = new Set();
    document.querySelectorAll("#invFilterCategory option").forEach(option => {
        if (option.value) categories.add(option.value);
    });
    (allInventory || []).forEach(item => {
        const category = String(item.category || "").trim();
        if (category) categories.add(category);
    });
    return [...categories].sort((a, b) => a.localeCompare(b));
}

function setupCategoryDropdowns() {
    const filterDropdown = document.getElementById("invFilterCategoryDropdown");
    const categoryDropdown = document.getElementById("invCategoryDropdown");
    const filterSelect = document.getElementById("invFilterCategory");
    const categoryInput = document.getElementById("invCategory");
    if (!filterDropdown || !categoryDropdown || !filterSelect || !categoryInput) return;

    const categories = getInventoryCategories();
    const renderOptions = (menu, values, selectedValue, allowAll = false) => {
        const options = allowAll ? ["", ...values] : values;
        menu.innerHTML = options.map(value => `
            <button type="button" class="category-dropdown-option${value === selectedValue ? " selected" : ""}"
                role="option" data-value="${escapeHtml(value)}" aria-selected="${value === selectedValue}">
                ${escapeHtml(value || "All Categories")}
            </button>
        `).join("") || `<span class="category-dropdown-empty">No categories yet</span>`;
    };

    const filterMenu = filterDropdown.querySelector(".category-dropdown-menu");
    const filterValue = filterDropdown.querySelector(".category-dropdown-value");
    const filterTrigger = filterDropdown.querySelector(".category-dropdown-trigger");
    renderOptions(filterMenu, categories, filterSelect.value, true);
    filterValue.textContent = filterSelect.value || "All Categories";

    filterTrigger.addEventListener("click", () => {
        renderOptions(filterMenu, getInventoryCategories(), filterSelect.value, true);
        const open = filterDropdown.classList.toggle("open");
        filterTrigger.setAttribute("aria-expanded", String(open));
    });
    filterMenu.addEventListener("click", event => {
        const option = event.target.closest(".category-dropdown-option");
        if (!option) return;
        filterSelect.value = option.dataset.value || "";
        filterSelect.dispatchEvent(new Event("change", { bubbles: true }));
        filterValue.textContent = filterSelect.value || "All Categories";
        renderOptions(filterMenu, getInventoryCategories(), filterSelect.value, true);
        filterDropdown.classList.remove("open");
        filterTrigger.setAttribute("aria-expanded", "false");
    });

    const editableMenu = categoryDropdown.querySelector(".category-dropdown-menu");
    const categoryArrow = categoryDropdown.querySelector(".category-dropdown-arrow");
    const renderEditableOptions = () => {
        const query = categoryInput.value.trim().toLowerCase();
        renderOptions(editableMenu, getInventoryCategories().filter(category =>
            !query || category.toLowerCase().includes(query)
        ), categoryInput.value.trim());
    };
    const openEditable = () => {
        renderEditableOptions();
        categoryDropdown.classList.add("open");
        categoryInput.setAttribute("aria-expanded", "true");
    };
    categoryArrow.addEventListener("click", () => {
        if (categoryDropdown.classList.contains("open")) {
            categoryDropdown.classList.remove("open");
            categoryInput.setAttribute("aria-expanded", "false");
        } else {
            openEditable();
            categoryInput.focus();
        }
    });
    categoryInput.addEventListener("focus", openEditable);
    categoryInput.addEventListener("input", renderEditableOptions);
    editableMenu.addEventListener("click", event => {
        const option = event.target.closest(".category-dropdown-option");
        if (!option) return;
        categoryInput.value = option.dataset.value || "";
        categoryDropdown.classList.remove("open");
        categoryInput.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("click", event => {
        [filterDropdown, categoryDropdown].forEach(dropdown => {
            if (dropdown.contains(event.target)) return;
            dropdown.classList.remove("open");
            const input = dropdown.querySelector("input");
            const trigger = dropdown.querySelector("[aria-expanded]");
            if (input) input.setAttribute("aria-expanded", "false");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        });
    });
}

// ── Multi-link Picker ──────────────────────────────────────────────────────
// The hidden field `invLinkedProducts` holds a JSON array of product IDs.
// The tag container `invLinkedTags` shows chips with × buttons to remove.

function getLinkedProductIds() {
    const hidden = document.getElementById("invLinkedProducts");
    if (!hidden || !hidden.value) return [];
    try {
        const parsed = JSON.parse(hidden.value);
        if (Array.isArray(parsed)) {
            return [...new Set(parsed.map(id => String(id).trim()).filter(Boolean))];
        }
        return [];
    } catch {
        return [];
    }
}

function setLinkedProductIds(ids) {
    const hidden = document.getElementById("invLinkedProducts");
    if (hidden) hidden.value = JSON.stringify(ids || []);
    renderLinkedTags();
}

function renderLinkedTags() {
    const container = document.getElementById("invLinkedTags");
    if (!container) return;
    const ids = getLinkedProductIds();
    if (!ids.length) {
        container.innerHTML = `<span class="inv-linked-empty">None — standalone supply</span>`;
        return;
    }
    container.innerHTML = ids.map(id => {
        const product = (allProducts || []).find(p => p._id === id);
        const safeName = product ? escapeHtml(product.name || "(Unnamed)") : `<em>Unknown</em>`;
        return `<span class="inv-link-tag" data-link-id="${id}">${safeName}<button type="button" class="inv-link-tag-remove" data-remove-id="${id}" aria-label="Remove link">&times;</button></span>`;
    }).join("");

    container.querySelectorAll(".inv-link-tag-remove").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            const removeId = btn.dataset.removeId;
            setLinkedProductIds(getLinkedProductIds().filter(id => id !== removeId));
            renderInventoryProductPickerOptions();
        });
    });
}

function setupInventoryLinkPicker() {
    const trigger   = document.getElementById("invLinkProductButton");
    const dialog    = document.getElementById("invProductPickerDialog");
    const search    = document.getElementById("invProductPickerSearch");
    const optionsEl = document.getElementById("invProductPickerOptions");
    const closeBtn  = document.getElementById("invProductPickerClose");
    const doneBtn   = document.getElementById("invProductPickerDone");

    if (!trigger || !dialog || !search || !optionsEl || !closeBtn) return;

    trigger.addEventListener("click", () => {
        search.value = "";
        renderInventoryProductPickerOptions();
        dialog.showModal();
        trigger.setAttribute("aria-expanded", "true");
        search.focus();
    });

    const closeDialog = () => {
        dialog.close();
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
    };

    closeBtn.addEventListener("click", closeDialog);
    if (doneBtn) doneBtn.addEventListener("click", closeDialog);
    dialog.addEventListener("click", event => {
        if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("close", () => {
        trigger.setAttribute("aria-expanded", "false");
    });
    search.addEventListener("input", renderInventoryProductPickerOptions);

    // Checkbox toggle inside the options list
    optionsEl.addEventListener("change", event => {
        const checkbox = event.target.closest("input[type='checkbox'][data-product-id]");
        if (!checkbox) return;
        const productId = checkbox.dataset.productId;
        const current = getLinkedProductIds();
        if (checkbox.checked) {
            if (!current.includes(productId)) setLinkedProductIds([...current, productId]);
        } else {
            setLinkedProductIds(current.filter(id => id !== productId));
        }
    });
}

function populateInventoryLinkSelect() {
    renderInventoryProductPickerOptions();
    renderLinkedTags();
}

function renderInventoryProductPickerOptions() {
    const optionsEl = document.getElementById("invProductPickerOptions");
    const emptyEl   = document.getElementById("invProductPickerEmpty");
    const searchEl  = document.getElementById("invProductPickerSearch");
    if (!optionsEl || !emptyEl || !searchEl) return;

    const query = searchEl.value.trim().toLocaleLowerCase();
    const selected = new Set(getLinkedProductIds());

    const products = [...(allProducts || [])]
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
        .filter(product => String(product.name || "").toLocaleLowerCase().includes(query));

    optionsEl.replaceChildren();
    products.forEach(product => {
        const label = document.createElement("label");
        label.className = "inv-product-picker-option inv-product-picker-checkbox-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "inv-product-picker-check";
        checkbox.dataset.productId = product._id;
        checkbox.checked = selected.has(product._id);

        const nameSpan = document.createElement("span");
        nameSpan.className = "inv-product-picker-name";
        nameSpan.textContent = product.name || "(Unnamed product)";

        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        optionsEl.appendChild(label);
    });

    emptyEl.hidden = products.length > 0;
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

    const nameInput      = document.getElementById("invProdName");
    const categoryInput  = document.getElementById("invCategory");
    const priceInput     = document.getElementById("invPrice");
    const stockInput     = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput    = document.getElementById("invStatus");

    // Normalise: support legacy single menuProductId or new array menuProductIds
    let ids = [];
    if (Array.isArray(item.menuProductIds) && item.menuProductIds.length) {
        ids = item.menuProductIds;
    } else if (item.menuProductId) {
        ids = [item.menuProductId];
    }
    setLinkedProductIds(ids);

    if (nameInput)      nameInput.value      = item.productName || "";
    if (categoryInput)  categoryInput.value  = item.category || "";
    if (priceInput)     priceInput.value     = item.price ?? "";
    if (stockInput)     stockInput.value     = item.stock ?? "";
    if (thresholdInput) thresholdInput.value = item.lowStockThreshold ?? "";
    if (unitsInput)     unitsInput.value     = item.unitsPerSale ?? "";
    if (statusInput)    statusInput.value    = item.status || "Available";

    updateInventoryButtonStates(true);

    document.querySelectorAll(".inv-row-selected").forEach(row => row.classList.remove("inv-row-selected"));
    const selectedRow = document.querySelector(`tr[data-inventory-id="${item._id}"]`);
    if (selectedRow) selectedRow.classList.add("inv-row-selected");
}

// ── Form Reset ─────────────────────────────────────────────────────────────

function clearInventoryForm() {
    selectedInventoryId = null;

    const nameInput      = document.getElementById("invProdName");
    const categoryInput  = document.getElementById("invCategory");
    const priceInput     = document.getElementById("invPrice");
    const stockInput     = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput    = document.getElementById("invStatus");

    setLinkedProductIds([]);
    if (nameInput)      nameInput.value      = "";
    if (categoryInput)  categoryInput.value  = "";
    if (priceInput)     priceInput.value     = "";
    if (stockInput)     stockInput.value     = "";
    if (thresholdInput) thresholdInput.value = "";
    if (unitsInput)     unitsInput.value     = "";
    if (statusInput)    statusInput.value    = "Available";

    updateInventoryButtonStates(false);

    document.querySelectorAll(".inv-row-selected").forEach(row => row.classList.remove("inv-row-selected"));
}

// ── Payload Builder ────────────────────────────────────────────────────────

function getInventoryPayload() {
    const nameInput      = document.getElementById("invProdName");
    const categoryInput  = document.getElementById("invCategory");
    const priceInput     = document.getElementById("invPrice");
    const stockInput     = document.getElementById("invStock");
    const thresholdInput = document.getElementById("invThreshold");
    const unitsInput     = document.getElementById("invUnitsPerSale");
    const statusInput    = document.getElementById("invStatus");

    const menuProductIds    = getLinkedProductIds();
    const productName       = nameInput     ? nameInput.value.trim()     : "";
    const category          = categoryInput ? categoryInput.value.trim() : "";
    const price             = priceInput    ? Number(priceInput.value)   : NaN;
    const stock             = stockInput    ? Number(stockInput.value)   : NaN;
    const lowStockThreshold = thresholdInput ? Number(thresholdInput.value) : NaN;
    const unitsPerSale      = unitsInput    ? Number(unitsInput.value)   : NaN;
    const status            = statusInput   ? statusInput.value          : "Available";

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
        date: new Date().toLocaleDateString(),
        menuProductIds: menuProductIds
    };
    if (menuProductIds.length) payload.menuProductId = menuProductIds[0];
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
            if (typeof loadLiveMenuData === "function") loadLiveMenuData();
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
            if (typeof loadLiveMenuData === "function") loadLiveMenuData();
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
            if (typeof loadLiveMenuData === "function") loadLiveMenuData();
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
                <td colspan="10" style="text-align:center; color:#888; padding:22px;">
                    No inventory items match. ${(items || []).length ? "Try clearing the filters." : "Add your first supply item with the form."}
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const stock = Number(item.stock ?? 0);
        const low = stock <= Number(item.lowStockThreshold ?? 10);

        // Support both legacy single menuProductId and new array menuProductIds
        const linkedIds = Array.isArray(item.menuProductIds) && item.menuProductIds.length
            ? item.menuProductIds
            : item.menuProductId ? [item.menuProductId] : [];

        const linkedBadges = linkedIds.map(id => {
            const product = (allProducts || []).find(p => p._id === id);
            const name = product ? escapeHtml(product.name) : "Linked";
            return `<span class="inv-link-badge" title="Linked to: ${name}"><i class="fas fa-link"></i> ${name}</span>`;
        }).join(" ");

        return `
        <tr data-inventory-id="${item._id}">
            <td>${escapeHtml(item.productName)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>₱${Number(item.price).toFixed(2)}</td>
            <td class="${low ? "low-stock-cell" : ""}">${stock}</td>
            <td>${escapeHtml(String(item.lowStockThreshold ?? 10))}</td>
            <td>${escapeHtml(String(item.unitsPerSale ?? 1))}</td>
            <td>${linkedBadges || '<span class="inv-standalone-badge">Standalone</span>'}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.date)}</td>
            <td>
                <button type="button" class="restock-btn" data-restock-id="${item._id}" data-restock-type="inventory"
                    title="Restock this supply item">+ Restock</button>
            </td>
        </tr>`;
    }).join("");
}
