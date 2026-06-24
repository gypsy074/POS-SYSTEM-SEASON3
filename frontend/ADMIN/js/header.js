/* ==========================================================================
   header.js — Header component
   Handles: refresh button, notifications, logout, date chip, global search.
   ========================================================================== */

function setupHeaderActions() {
    const refreshButton      = document.getElementById("refreshAdminBtn");
    const notificationsButton = document.getElementById("notificationsBtn");
    const logoutButton       = document.getElementById("logoutBtn");
    const dateChip           = document.getElementById("adminDate");

    // Live date chip
    if (dateChip) {
        const now = new Date();
        dateChip.textContent = now.toLocaleDateString("en-US", {
            weekday: "long", month: "short", day: "numeric"
        });
    }

    if (refreshButton) {
        refreshButton.addEventListener("click", refreshCurrentPanel);
    }

    if (notificationsButton) {
        notificationsButton.addEventListener("click", () => {
            alert("No new notifications yet.");
        });
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            window.location.href = "../login.html";
        });
    }
}

function setupGlobalSearch() {
    const searchInput = document.getElementById("globalSearch");
    if (!searchInput) return;

    searchInput.addEventListener("input", event => {
        const searchTerm = event.target.value.trim().toLowerCase();
        const filteredProducts = allProducts.filter(product =>
            [product.name, product.category, product.status]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(searchTerm))
        );
        renderMenuTable(filteredProducts);
    });
}

function refreshCurrentPanel() {
    if (activePanelId === "menu-view")      { loadLiveMenuData();      return; }
    if (activePanelId === "users-view")     { loadLiveUserData();      return; }
    if (activePanelId === "inventory-view") { loadLiveInventoryData(); return; }
    loadLiveDashboardData();
}
