/* ==========================================================================
   restock.js — Quick restock flow for menu products and supply items.
   A small modal asks for the quantity (+ optional reason), calls the
   product/inventory restock endpoint, and refreshes the affected views.
   Entry points: menu table rows, inventory table rows, and the AI Insights
   restock suggestions (matched by product name).
   ========================================================================== */

let restockRequest = null;

function openRestockModal({ id, type, label, suggested }) {
    let overlay = document.getElementById("restockModalOverlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "restockModalOverlay";
        overlay.className = "confirm-modal-overlay restock-modal-overlay";
        overlay.innerHTML = `
            <div class="confirm-modal restock-modal">
                <div class="confirm-modal-icon"><i class="fas fa-boxes-stacked"></i></div>
                <h3 class="confirm-modal-title" id="restockModalTitle"></h3>
                <p class="confirm-modal-message" id="restockModalSub"></p>
                <label class="restock-field-label" for="restockQty">Quantity to add</label>
                <input type="number" class="restock-field" id="restockQty" min="1" step="1" inputmode="numeric">
                <label class="restock-field-label" for="restockReason">Reason (optional)</label>
                <input type="text" class="restock-field" id="restockReason" placeholder="Manual restock" maxlength="100">
                <div class="confirm-modal-actions">
                    <button type="button" class="confirm-btn confirm-btn-cancel" id="restockCancelBtn">Cancel</button>
                    <button type="button" class="confirm-btn confirm-btn-primary" id="restockOkBtn">Restock</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }

    document.getElementById("restockModalTitle").textContent = `Restock ${label}`;
    document.getElementById("restockModalSub").textContent =
        type === "inventory" ? "Supply item — stock will be raised by the quantity below." : "Menu item — stock will be raised by the quantity below.";

    const qtyInput = document.getElementById("restockQty");
    const reasonInput = document.getElementById("restockReason");
    qtyInput.value = suggested ? String(suggested) : "";
    reasonInput.value = "";

    restockRequest = { id, type, label };

    const overlayEl = overlay;
    const close = () => {
        overlayEl.classList.remove("open");
        document.removeEventListener("keydown", onKey);
        restockRequest = null;
    };

    const onKey = e => {
        if (e.key === "Escape") close();
        if (e.key === "Enter") { e.preventDefault(); submitRestock(); }
    };

    const submitRestock = async () => {
        const quantity = Number(qtyInput.value);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            showToast("Restock quantity must be a number above zero.", "warning");
            qtyInput.focus();
            return;
        }
        const reason = reasonInput.value.trim();
        const req = restockRequest;
        close();
        await doRestock({ id: req.id, type: req.type, label: req.label, quantity, reason });
    };

    overlay.onclick = e => { if (e.target === overlayEl) close(); };
    document.addEventListener("keydown", onKey);
    document.getElementById("restockOkBtn").onclick = submitRestock;
    document.getElementById("restockCancelBtn").onclick = close;
    overlayEl.classList.add("open");
    qtyInput.focus();
}

async function doRestock({ id, type, label, quantity, reason }) {
    const endpoint = type === "inventory"
        ? `/api/inventory/${id}/restock`
        : `/api/products/${id}/restock`;

    try {
        const response = await apiFetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity, reason })
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            throw new Error(errorPayload?.error || "Failed to restock item.");
        }

        showToast(`Restocked "${label}" +${quantity}.`);
        if (type === "inventory") {
            loadLiveInventoryData();
        } else {
            loadLiveMenuData();
        }
        if (typeof loadInsights === "function") loadInsights();
        if (typeof renderNotifications === "function") renderNotifications();
    } catch (err) {
        console.error("❌ Restock pipeline error:", err);
        showToast(`Failed to restock "${label}".`, "error");
    }
}

function setupRestockButtons() {
    // Menu table rows — restock without triggering row selection.
    const menuTbody = document.getElementById("menuItemsTableBody");
    if (menuTbody) {
        menuTbody.addEventListener("click", event => {
            const btn = event.target.closest("[data-restock-id][data-restock-type]");
            if (!btn || btn.dataset.restockType !== "menu") return;
            event.stopPropagation();
            const product = allProducts.find(p => p._id === btn.dataset.restockId);
            if (product) openRestockModal({ id: product._id, type: "menu", label: product.name });
        });
    }

    // Inventory table rows — same pattern.
    const invTbody = document.getElementById("inventoryTableBody");
    if (invTbody) {
        invTbody.addEventListener("click", event => {
            const btn = event.target.closest("[data-restock-id][data-restock-type]");
            if (!btn || btn.dataset.restockType !== "inventory") return;
            event.stopPropagation();
            const item = allInventory.find(i => i._id === btn.dataset.restockId);
            if (item) openRestockModal({ id: item._id, type: "inventory", label: item.productName });
        });
    }

    // AI Insights restock suggestions — matched by product name so the
    // suggested order quantity comes pre-filled.
    const aiBody = document.getElementById("aiHeaderPanelBody");
    if (aiBody) {
        aiBody.addEventListener("click", event => {
            const btn = event.target.closest(".ai-restock-btn");
            if (!btn) return;
            const name = btn.dataset.aiName;
            if (!name) return;
            const product = (allProducts || []).find(p => p.name === name);
            const invItem = (allInventory || []).find(i => i.productName === name);
            if (product) {
                openRestockModal({ id: product._id, type: "menu", label: product.name, suggested: btn.dataset.aiQty || "" });
            } else if (invItem) {
                openRestockModal({ id: invItem._id, type: "inventory", label: invItem.productName, suggested: btn.dataset.aiQty || "" });
            } else {
                showToast(`"${name}" is not tracked in the menu or inventory.`, "warning");
            }
        });
    }
}