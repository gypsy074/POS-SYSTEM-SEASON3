/* ==========================================================================
   header.js — Header component
   Handles: refresh button, notifications, logout dropdown, date chip, global search.
   ========================================================================== */

function setupHeaderActions() {
    const refreshButton       = document.getElementById("refreshAdminBtn");
    const notificationsButton = document.getElementById("notificationsBtn");
    const dateChip            = document.getElementById("adminDate");

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

    // ── Admin Profile Dropdown ────────────────────────────────────────────────
    setupAdminDropdown();
}

function setupAdminDropdown() {
    const container  = document.getElementById("adminDropdownContainer");
    const badge      = document.getElementById("adminBadge");
    const menu       = document.getElementById("adminDropdownMenu");
    const logoutBtn  = document.getElementById("adminLogoutDropdownBtn");
    const sidebarLogoutBtn = document.getElementById("logoutBtn"); // sidebar logout

    if (!container || !badge || !menu) return;

    // Populate username/initials from sessionStorage (set by login.js)
    const savedName = sessionStorage.getItem("posUsername");
    const savedRole = sessionStorage.getItem("posRole");
    const nameEl    = document.getElementById("adminName");
    const roleEl    = document.getElementById("adminRoleLabel");
    const avatarEl  = document.getElementById("adminAvatar");

    if (savedName) {
        if (nameEl)   nameEl.textContent = savedName;
        if (avatarEl) avatarEl.textContent = savedName.slice(0, 2).toUpperCase();
    }
    if (savedRole && roleEl) roleEl.textContent = savedRole;

    // Toggle dropdown on badge click
    badge.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = container.classList.toggle("open");
        menu.classList.toggle("open", isOpen);
    });

    // Close on outside click
    document.addEventListener("click", () => {
        container.classList.remove("open");
        menu.classList.remove("open");
    });

    // Dropdown logout button
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            sessionStorage.clear();
            window.location.href = "../login.html";
        });
    }

    // Sidebar logout button (keep backward compat)
    if (sidebarLogoutBtn) {
        sidebarLogoutBtn.addEventListener("click", () => {
            sessionStorage.clear();
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
    if (activePanelId === "sales-view")     { loadLiveDashboardData(); return; }
    loadLiveDashboardData();
}
