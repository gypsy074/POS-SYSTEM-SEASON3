/* ==========================================================================
   menu.js — Menu management module
   Handles: CRUD for menu items, image upload, Add button state fix.
   ========================================================================== */

// ── Setup ──────────────────────────────────────────────────────────────────

function setupMenuTableSelection() {
    const menuTableBody = document.getElementById("menuItemsTableBody");
    if (!menuTableBody) return;

    menuTableBody.addEventListener("click", event => {
        const row = event.target.closest("tr[data-product-id]");
        if (!row) return;

        const product = allProducts.find(item => item._id === row.dataset.productId);
        if (product) selectMenuRow(product);
    });
}

function setupMenuActionButtons() {
    document.querySelectorAll("[data-menu-action]").forEach(button => {
        button.addEventListener("click", () => {
            const action = button.getAttribute("data-menu-action");
            if (action === "add")    addMenuItem();
            if (action === "update") updateMenuItem();
            if (action === "delete") deleteMenuItem();
            if (action === "clear")  clearMenuForm();
        });
    });

    ["productNameInput", "priceInput"].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") addMenuItem();
        });
    });

    updateMenuButtonStates(false);
}

function setupImageUploadEngine() {
    const importBtn = document.getElementById("importBtn");
    const fileInput = document.getElementById("menuImageInput");
    if (!importBtn || !fileInput) return;

    importBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", event => {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            selectedImageData = "";
            renderImagePreview("");
            return;
        }

        compressImage(file, 800, 0.72)
            .then(compressed => {
                selectedImageData = compressed;
                renderImagePreview(selectedImageData);
            })
            .catch(() => {
                // Fallback: raw FileReader
                const reader = new FileReader();
                reader.onload = e => {
                    selectedImageData = e.target.result;
                    renderImagePreview(selectedImageData);
                };
                reader.readAsDataURL(file);
            });
    });
}

// ── Button State Control ───────────────────────────────────────────────────

/**
 * Controls Add / Update / Remove button enable states.
 * When a row is selected the Add button is greyed out to prevent duplication.
 * @param {boolean} hasSelection - true when a table row is selected
 */
function updateMenuButtonStates(hasSelection) {
    const addBtn    = document.querySelector('[data-menu-action="add"]');
    const updateBtn = document.querySelector('[data-menu-action="update"]');
    const deleteBtn = document.querySelector('[data-menu-action="delete"]');

    if (addBtn) {
        addBtn.disabled = hasSelection;
        addBtn.style.opacity = hasSelection ? "0.4" : "1";
        addBtn.style.cursor  = hasSelection ? "not-allowed" : "pointer";
    }
    if (updateBtn) updateBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
}

// ── Row Selection ──────────────────────────────────────────────────────────

function selectMenuRow(product) {
    selectedProductId  = product._id;
    selectedImageData  = product.image || "";

    const productNameInput = document.getElementById("productNameInput");
    const priceInput       = document.getElementById("priceInput");
    const categorySelect   = document.getElementById("categorySelect");
    const statusSelect     = document.getElementById("statusSelect");
    const stockInput       = document.getElementById("stockInput");
    const lowStockInput    = document.getElementById("lowStockInput");

    if (productNameInput) productNameInput.value = product.name || "";
    if (priceInput)       priceInput.value       = product.price ?? "";
    if (categorySelect)   categorySelect.value   = product.category || "Coffee";
    if (statusSelect)     statusSelect.value     = product.status   || "Available";
    if (stockInput)       stockInput.value       = product.stock ?? "";
    if (lowStockInput)    lowStockInput.value    = product.lowStockThreshold ?? "";

    renderImagePreview(selectedImageData);
    updateMenuButtonStates(true); // ← grey out Add, enable Update/Remove

    document.querySelectorAll(".menu-row-selected").forEach(row => row.classList.remove("menu-row-selected"));
    const selectedRow = document.querySelector(`tr[data-product-id="${product._id}"]`);
    if (selectedRow) selectedRow.classList.add("menu-row-selected");
}

// ── Image Preview ──────────────────────────────────────────────────────────

function renderImagePreview(imageData) {
    const previewBox  = document.getElementById("imagePreviewBox");
    const previewIcon = document.getElementById("previewIcon");
    const previewText = document.getElementById("previewText");
    if (!previewBox || !previewIcon || !previewText) return;

    if (!imageData) {
        previewBox.style.backgroundImage = "none";
        previewIcon.style.display = "block";
        previewText.style.display = "block";
        previewText.innerText = "No Image Uploaded";
        return;
    }

    previewIcon.style.display = "none";
    previewText.style.display = "none";
    previewBox.style.backgroundImage    = `url('${imageData}')`;
    previewBox.style.backgroundSize     = "contain";
    previewBox.style.backgroundPosition = "center";
    previewBox.style.backgroundRepeat   = "no-repeat";
}

// ── Form Reset ─────────────────────────────────────────────────────────────

function clearMenuForm() {
    selectedProductId = null;
    selectedImageData = "";

    const productNameInput = document.getElementById("productNameInput");
    const priceInput       = document.getElementById("priceInput");
    const categorySelect   = document.getElementById("categorySelect");
    const statusSelect     = document.getElementById("statusSelect");
    const stockInput       = document.getElementById("stockInput");
    const lowStockInput    = document.getElementById("lowStockInput");
    const fileInput        = document.getElementById("menuImageInput");

    if (productNameInput) productNameInput.value = "";
    if (priceInput)       priceInput.value       = "";
    if (categorySelect)   categorySelect.value   = "Coffee";
    if (statusSelect)     statusSelect.value     = "Available";
    if (stockInput)       stockInput.value       = "";
    if (lowStockInput)    lowStockInput.value    = "";
    if (fileInput)        fileInput.value        = "";

    renderImagePreview("");
    updateMenuButtonStates(false); // ← re-enable Add

    document.querySelectorAll(".menu-row-selected").forEach(row => row.classList.remove("menu-row-selected"));
}

// ── Payload Builder ────────────────────────────────────────────────────────

function getMenuPayload() {
    const nameInput      = document.getElementById("productNameInput");
    const priceInput     = document.getElementById("priceInput");
    const categorySelect = document.getElementById("categorySelect");
    const statusSelect   = document.getElementById("statusSelect");
    const stockInput     = document.getElementById("stockInput");
    const lowStockInput  = document.getElementById("lowStockInput");

    const name     = nameInput      ? nameInput.value.trim()  : "";
    const price    = priceInput     ? Number(priceInput.value) : NaN;
    const category = categorySelect ? categorySelect.value     : "";
    const status   = statusSelect   ? statusSelect.value       : "Available";
    const stock    = stockInput     ? Number(stockInput.value) : NaN;
    const lowStockThreshold = lowStockInput ? Number(lowStockInput.value) : NaN;

    if (!name || !Number.isFinite(price) || price < 0) {
        showToast("Please complete the product name and a valid price before saving.", "warning");
        return null;
    }

    const stockNum = Number.isFinite(stock) ? Math.max(0, stock) : 999;

    return {
        name,
        price,
        category,
        // Running out always marks the item sold out (mirrors the server).
        status: stockNum <= 0 ? "Out of Stock" : status,
        stock: stockNum,
        lowStockThreshold: Number.isFinite(lowStockThreshold) ? Math.max(0, lowStockThreshold) : 10,
        image: selectedImageData ||
            (selectedProductId
                ? (allProducts.find(p => p._id === selectedProductId)?.image || "")
                : "")
    };
}

// ── Categories ──────────────────────────────────────────────────────────────

function setupCategoryManager() {
    const addBtn = document.getElementById("addCategoryBtn");
    const input = document.getElementById("newCategoryInput");
    if (addBtn) addBtn.addEventListener("click", addCategory);
    if (input) input.addEventListener("keydown", event => {
        if (event.key === "Enter") addCategory();
    });

    const list = document.getElementById("categoryManagerList");
    if (!list) return;
    list.addEventListener("click", event => {
        const item = event.target.closest(".category-manager-item");
        if (!item) return;
        const name = item.dataset.category;
        const action = event.target.closest("[data-cat-action]")?.dataset.catAction;
        if (action === "rename") startRenameCategory(item, name);
        if (action === "rename-save") {
            const input = item.querySelector("input");
            finishRenameCategory(item, name, input ? input.value.trim() : "");
        }
        if (action === "rename-cancel") loadCategories();
        if (action === "delete") deleteCategory(name);
    });
}

async function loadCategories() {
    try {
        const response = await apiFetch("/api/categories");
        if (!response.ok) throw new Error("Failed to pull categories");
        const categories = (await response.json()) || [];
        populateCategorySelect(categories);
        renderCategoryManager(categories);
    } catch (err) {
        console.error("❌ Category load fault:", err);
    }
}

function populateCategorySelect(categories) {
    const select = document.getElementById("categorySelect");
    if (!select) return;
    const current = select.value || "Coffee";
    select.innerHTML = categories
        .map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join("") || `<option value="Coffee">Coffee</option>`;
    if (categories.includes(current)) {
        select.value = current;
    } else if (current) {
        const option = document.createElement("option");
        option.value = current;
        option.textContent = current;
        select.appendChild(option);
        select.value = current;
    }
}

function renderCategoryManager(categories) {
    const list = document.getElementById("categoryManagerList");
    if (!list) return;

    const counts = (allProducts || []).reduce((map, product) => {
        const cat = product.category || "Uncategorized";
        map[cat] = (map[cat] || 0) + 1;
        return map;
    }, {});

    list.innerHTML = categories.map(category => `
        <div class="category-manager-item" data-category="${escapeHtml(category)}">
            <span class="category-manager-name">${escapeHtml(category)}</span>
            <span class="category-manager-count">${counts[category] || 0} product(s)</span>
            <span class="category-manager-actions">
                <button type="button" class="category-manager-btn" data-cat-action="rename">Rename</button>
                <button type="button" class="category-manager-btn danger" data-cat-action="delete">Delete</button>
            </span>
        </div>
    `).join("") || `<span class="category-manager-count">No categories yet — add one or create a product with a new category.</span>`;
}

async function addCategory() {
    const input = document.getElementById("newCategoryInput");
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        showToast("Enter a category name first.", "warning");
        return;
    }
    try {
        const response = await apiFetch("/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
        if (response.ok) {
            showToast(`Category "${name}" created.`);
            input.value = "";
            loadCategories();
            return;
        }
        const errorPayload = await response.json().catch(() => null);
        showToast(errorPayload?.error || `Failed to create category (HTTP ${response.status}).`, "error");
    } catch (err) {
        showToast(`Failed to create category. ${err.message}`, "error");
    }
}

function startRenameCategory(item, oldName) {
    const nameEl = item.querySelector(".category-manager-name");
    if (!nameEl) return;
    const actionsEl = item.querySelector(".category-manager-actions");
    const input = document.createElement("input");
    input.value = oldName;
    nameEl.replaceWith(input);
    actionsEl.innerHTML = `
        <button type="button" class="category-manager-btn" data-cat-action="rename-save">Save</button>
        <button type="button" class="category-manager-btn danger" data-cat-action="rename-cancel">Cancel</button>`;
    input.focus();
    input.select();
}

async function finishRenameCategory(item, oldName, newName) {
    if (!newName || newName === oldName) {
        loadCategories();
        return;
    }
    try {
        const response = await apiFetch(`/api/categories/${encodeURIComponent(oldName)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName })
        });
        if (response.ok) {
            showToast(`Category "${oldName}" renamed to "${newName}".`);
            loadCategories();
            loadLiveMenuData();
            return;
        }
        const errorPayload = await response.json().catch(() => null);
        showToast(errorPayload?.error || `Failed to rename category (HTTP ${response.status}).`, "error");
        loadCategories();
    } catch (err) {
        showToast(`Failed to rename category. ${err.message}`, "error");
        loadCategories();
    }
}

async function deleteCategory(name) {
    const counts = (allProducts || []).filter(p => p.category === name).length;
    const confirmed = await showConfirmModal({
        title: "Delete category?",
        message: counts > 0
            ? `"${name}" still has ${counts} product(s). You must move them to another category first — deleting is blocked while products use it.`
            : `Category "${name}" is empty and will be removed.`,
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) return;
    try {
        const response = await apiFetch(`/api/categories/${encodeURIComponent(name)}`, {
            method: "DELETE"
        });
        if (response.ok) {
            showToast(`Category "${name}" deleted.`);
            loadCategories();
            return;
        }
        const errorPayload = await response.json().catch(() => null);
        showToast(errorPayload?.error || `Failed to delete category (HTTP ${response.status}).`, "error");
        loadCategories();
    } catch (err) {
        showToast(`Failed to delete category. ${err.message}`, "error");
    }
}

// ── CRUD Operations ────────────────────────────────────────────────────────

async function addMenuItem() {
    const payload = getMenuPayload();
    if (!payload) return;

    try {
        const response = await apiFetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showToast("New menu item uploaded to MongoDB!");
            clearMenuForm();
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        const reason = errorPayload?.error || `HTTP ${response.status}`;
        showToast(`Failed to save product. ${reason}`, "error");
    } catch (err) {
        console.error("❌ Product creation pipeline error:", err);
        showToast(`Failed to save product. ${err.message}`, "error");
    }
}

async function updateMenuItem() {
    if (!selectedProductId) {
        showToast("Please select a menu product row from the table first before updating.", "warning");
        return;
    }

    const payload = getMenuPayload();
    if (!payload) return;

    try {
        const response = await apiFetch(`/api/products/${selectedProductId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showToast("Menu item configuration updated on MongoDB!");
            clearMenuForm();
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        const reason = errorPayload?.error || `HTTP ${response.status}`;
        showToast(`Failed to update product. ${reason}`, "error");
    } catch (err) {
        console.error("❌ Update communication fault:", err);
        showToast(`Failed to update product. ${err.message}`, "error");
    }
}

async function deleteMenuItem() {
    if (!selectedProductId) {
        showToast("Please select a menu product row from the table first to delete.", "warning");
        return;
    }

    const product = allProducts.find(p => p._id === selectedProductId);
    const confirmed = await showConfirmModal({
        title: "Delete menu item?",
        message: product
            ? `"${product.name}" will be permanently removed from the menu. This cannot be undone.`
            : "This menu item will be permanently removed. This cannot be undone.",
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) return;

    try {
        const response = await apiFetch(`/api/products/${selectedProductId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            showToast("Menu item completely deleted from the system.");
            clearMenuForm();         // ← clears form AND re-enables Add
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to delete product");
    } catch (err) {
        console.error("❌ Delete database pipeline fault:", err);
        showToast("Failed to delete product.", "error");
    }
}

// ── Table Renderer ─────────────────────────────────────────────────────────

async function loadLiveMenuData() {
    try {
        const response = await apiFetch("/api/products");
        if (!response.ok) throw new Error("Failed to pull product list");

        const products = await response.json();
        allProducts = products;

        renderMenuTable(products);
        renderSalesCharts(latestOrders, products);
        loadCategories();

        if (selectedProductId && !products.some(p => p._id === selectedProductId)) {
            clearMenuForm();
        }
    } catch (err) {
        console.error("❌ Menu table render mapping fault:", err);
    }
}

function renderMenuTable(products) {
    const tbody = document.getElementById("menuItemsTableBody");
    if (!tbody) return;

    tbody.innerHTML = products.map(product => `
        <tr data-product-id="${product._id}">
            <td>${escapeHtml(product.name)}</td>
            <td>${escapeHtml(product.category)}</td>
            <td>₱${Number(product.price).toFixed(2)}</td>
            <td class="${Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10) ? "low-stock-cell" : ""}">
                ${Number(product.stock ?? 0)}
            </td>
            <td>${escapeHtml(product.status)}</td>
            <td>${escapeHtml(product.date)}</td>
            <td>
                <button type="button" class="restock-btn" data-restock-id="${product._id}" data-restock-type="menu"
                    title="Restock this menu item">+ Restock</button>
            </td>
        </tr>
    `).join("");
}
