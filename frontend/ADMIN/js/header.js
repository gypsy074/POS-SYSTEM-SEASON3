/* ==========================================================================
   header.js — Header component
   Handles: refresh button, notifications, logout, date chip, global search.
   ========================================================================== */

function setupHeaderActions() {
    const refreshButton      = document.getElementById("refreshAdminBtn");
    const notificationsButton = document.getElementById("notificationsBtn");
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
        notificationsButton.addEventListener("click", event => {
            event.stopPropagation();
            const dropdown = document.getElementById("notificationDropdown");
            if (dropdown) dropdown.classList.toggle("show");
        });
    }

    // Close the notification dropdown when clicking anywhere outside it.
    document.addEventListener("click", event => {
        const dropdown = document.getElementById("notificationDropdown");
        if (dropdown && dropdown.classList.contains("show") && !dropdown.contains(event.target)) {
            dropdown.classList.remove("show");
        }
    });
}

function setupGlobalSearch() {    const searchInput = document.getElementById("globalSearch");
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
    if (activePanelId === "waste-view")     { loadWasteData();        return; }
    if (activePanelId === "audit-view")     { loadAuditData();        return; }
    loadLiveDashboardData();
}

function setupDarkModeToggle() {
    const btn = document.getElementById("darkModeBtn");
    if (!btn) return;

    const icon = btn.querySelector("i");
    const apply = dark => {
        document.body.classList.toggle("dark", dark);
        if (icon) icon.className = dark ? "fas fa-sun" : "fas fa-moon";
    };

    apply(localStorage.getItem("posDarkMode") === "1");

    btn.addEventListener("click", () => {
        const dark = !document.body.classList.contains("dark");
        localStorage.setItem("posDarkMode", dark ? "1" : "0");
        apply(dark);
    });
}
