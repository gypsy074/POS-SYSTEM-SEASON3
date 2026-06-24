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

    if (productNameInput) productNameInput.value = product.name || "";
    if (priceInput)       priceInput.value       = product.price ?? "";
    if (categorySelect)   categorySelect.value   = product.category || "Coffee";
    if (statusSelect)     statusSelect.value     = product.status   || "Available";

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
    const fileInput        = document.getElementById("menuImageInput");

    if (productNameInput) productNameInput.value = "";
    if (priceInput)       priceInput.value       = "";
    if (categorySelect)   categorySelect.value   = "Coffee";
    if (statusSelect)     statusSelect.value     = "Available";
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

    const name     = nameInput      ? nameInput.value.trim()  : "";
    const price    = priceInput     ? Number(priceInput.value) : NaN;
    const category = categorySelect ? categorySelect.value     : "";
    const status   = statusSelect   ? statusSelect.value       : "Available";

    if (!name || !Number.isFinite(price) || price < 0) {
        alert("Please complete the product name and a valid price before saving.");
        return null;
    }

    return {
        name,
        price,
        category,
        status,
        image: selectedImageData ||
            (selectedProductId
                ? (allProducts.find(p => p._id === selectedProductId)?.image || "")
                : "")
    };
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
            alert("✅ New menu item uploaded to MongoDB!");
            clearMenuForm();
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        const reason = errorPayload?.error || `HTTP ${response.status}`;
        alert(`❌ Failed to save product.\n\nReason: ${reason}`);
    } catch (err) {
        console.error("❌ Product creation pipeline error:", err);
        alert(`❌ Failed to save product.\n\nReason: ${err.message}`);
    }
}

async function updateMenuItem() {
    if (!selectedProductId) {
        alert("Please select a menu product row from the table first before updating.");
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
            alert("✅ Menu item configuration updated on MongoDB!");
            clearMenuForm();
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        const reason = errorPayload?.error || `HTTP ${response.status}`;
        alert(`❌ Failed to update product.\n\nReason: ${reason}`);
    } catch (err) {
        console.error("❌ Update communication fault:", err);
        alert(`❌ Failed to update product.\n\nReason: ${err.message}`);
    }
}

async function deleteMenuItem() {
    if (!selectedProductId) {
        alert("Please select a menu product row from the table first to delete.");
        return;
    }

    if (!confirm("Are you completely sure you want to permanently delete this menu item?")) return;

    try {
        const response = await apiFetch(`/api/products/${selectedProductId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            alert("🗑️ Menu item completely deleted from the system.");
            clearMenuForm();         // ← clears form AND re-enables Add
            loadLiveMenuData();
            return;
        }

        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || "Failed to delete product");
    } catch (err) {
        console.error("❌ Delete database pipeline fault:", err);
        alert("Failed to delete product.");
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
            <td>${escapeHtml(product.status)}</td>
            <td>${escapeHtml(product.date)}</td>
        </tr>
    `).join("");
}
