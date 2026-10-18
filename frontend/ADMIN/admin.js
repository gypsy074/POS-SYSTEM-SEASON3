/* ==========================================================================
   admin.js — Main entry point & shared application state
   
   Module load order (defined in admin.html):
     1. js/api.js              — apiFetch, escapeHtml
     2. js/imageCompressor.js  — compressImage
     3. js/sidebar.js          — setupSidebarNavigation
     4. js/header.js           — setupHeaderActions, setupGlobalSearch, refreshCurrentPanel
     5. js/dashboard.js        — loadLiveDashboardData, renderTransactionTable, renderSalesCharts
     6. js/menu.js             — all menu CRUD + image upload
     7. js/users.js            — all user CRUD
     8. js/inventory.js        — all inventory CRUD
     9. admin.js               ← this file (runs last, everything is already defined)
   ========================================================================== */

// ── Shared Application State ───────────────────────────────────────────────

let selectedProductId   = null;
let selectedUserId      = null;
let selectedInventoryId = null;
let selectedImageData   = "";

let allProducts  = [];
let allUsers     = [];
let allInventory = [];
let latestOrders = [];
let latestWaste  = [];

let salesLineChart = null;
let itemsRadarChart = null;
let usageBarChart  = null;
let activePanelId  = "dashboard-view";
let currentAdminRole = "Admin";

// ── Profile Dropdown (animated open/close) ─────────────────────────────────

let profileCloseTimer = null;

function openProfileDropdown() {
    const dropdown = document.getElementById("profileDropdown");
    if (!dropdown) return;
    closeNotificationDropdown();
    if (profileCloseTimer) {
        clearTimeout(profileCloseTimer);
        profileCloseTimer = null;
    }
    dropdown.classList.remove("closing");
    dropdown.classList.add("show");
}

function closeProfileDropdown() {
    const dropdown = document.getElementById("profileDropdown");
    if (!dropdown || !dropdown.classList.contains("show")) return;
    if (profileCloseTimer) {
        clearTimeout(profileCloseTimer);
        profileCloseTimer = null;
    }
    dropdown.classList.add("closing");
    profileCloseTimer = setTimeout(() => {
        profileCloseTimer = null;
        dropdown.classList.remove("closing", "show");
    }, 230);
}

// ── Profile Badge ──────────────────────────────────────────────────────────

function setupProfileBadge() {
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem("posAdminUser") || "null");
    } catch (err) {
        console.warn("Unable to read the saved admin profile; using the default profile.", err);
    }
    const name = (user && user.username) || "Admin";
    const role = (user && user.role) || "Admin";

    const initials = name
        .split(/\s+/)
        .map(part => part.charAt(0).toUpperCase())
        .join("")
        .slice(0, 2) || "AD";

    document.getElementById("profileName").textContent = name;
    document.getElementById("profileRole").textContent = role;
    document.getElementById("profileAvatar").textContent = initials;
    document.getElementById("profileDropdownName").textContent = name;
    document.getElementById("profileDropdownRole").textContent = role;
    document.getElementById("profileDropdownAvatar").textContent = initials;

    const toggleBtn = document.getElementById("adminProfileBtn");
    const dropdown = document.getElementById("profileDropdown");
    if (!toggleBtn || !dropdown) return;

    toggleBtn.addEventListener("click", event => {
        event.stopPropagation();
        if (dropdown.classList.contains("show")) closeProfileDropdown();
        else openProfileDropdown();
    });

    const accountButton = document.getElementById("profileAccountBtn");
    if (accountButton) {
        accountButton.addEventListener("click", closeProfileDropdown);
    }

    document.addEventListener("click", event => {
        if (dropdown.classList.contains("show") && !dropdown.contains(event.target)) {
            closeProfileDropdown();
        }
    });

    const logoutButton = document.getElementById("profileLogoutBtn");
    if (logoutButton) logoutButton.addEventListener("click", () => {
        apiFetch("/api/logout", { method: "POST" }).catch(() => {});
        let name = "";
        try {
            const stored = JSON.parse(localStorage.getItem("posAdminUser") || "{}");
            name = stored.username || "";
        } catch (err) { /* ignore */ }
        localStorage.removeItem("posAdminToken");
        localStorage.removeItem("posAdminUser");
        localStorage.removeItem("posToken");
        localStorage.removeItem("posUser");
        showLogoutTransition(name, () => {
            window.location.href = "../login.html";
        });
    });
}

// Page guard: opening the admin panel without a valid session → back to login.
async function guardAdminPage() {
    try {
        const response = await apiFetch("/api/auth/me");
        if (!response.ok) {
            window.location.href = "../login.html";
            return false;
        }
        const data = await response.json();
        if (!["Admin", "Manager"].includes(data.role)) {
            window.location.href = "../CASHIER/pos.html";
            return false;
        }
        currentAdminRole = data.role;
        if (data.role === "Manager") {
            document.querySelectorAll(".nav-btn[data-target='users-view'], .nav-btn[data-target='audit-view'], .nav-btn[data-target='settings-view']")
                .forEach(button => {
                    button.style.display = "none";
                    button.setAttribute("aria-hidden", "true");
                });
        }
        return true;
    } catch (err) {
        window.location.href = "../login.html";
        return false;
    }
}

// ── Application Bootstrap ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    if (!await guardAdminPage()) return;

    // Components
    setupSidebarNavigation();
    setupHeaderActions();
    setupGlobalSearch();

    // Menu module
    setupMenuTableSelection();
    setupMenuActionButtons();
    setupImageUploadEngine();
    setupCategoryManager();
    setupMenuTableFilters();

    // Users module
    setupUserTableSelection();
    setupUserActionButtons();

    // Inventory module
    setupInventoryTableSelection();
    setupInventoryActionButtons();
    setupInventoryFilters();

    // Restock flow — menu rows, inventory rows, AI suggestions
    setupRestockButtons();

    // Waste panel — date filters
    setupWasteFilters();

    // Sales analytics module
    setupSalesFilterTabs();

    // Dashboard — recent transactions search
    setupTransactionSearch();

    // Updates card — tap a section header to expand it full-screen
    setupUpdateSectionExpand();

    // Header center — current view title + live clock
    setupHeaderCenter();

    // Mobile: hide the fixed header while scrolling down, show on scroll up
    setupScrollHeader();

    // Audit log module
    setupAuditFilters();

    // Dark mode
    setupDarkModeToggle();

    // Server status indicator
    setupServerStatus();

    // Owner email alerts settings panel
    setupSettingsForm();

    // Excel export for Sales Analytics
    const exportBtn = document.getElementById("exportCsvBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportSalesExcel);

    // Auto-refresh the active view + notification badge every 25s.
    // Ticks are skipped while the tab is hidden or a previous load is still
    // in flight, so backgrounded tabs and slow connections never pile up work.
    let autoRefreshPending = false;
    setInterval(() => {
        if (document.hidden || autoRefreshPending) return;
        autoRefreshPending = true;
        refreshCurrentPanel().finally(() => {
            autoRefreshPending = false;
            renderNotifications();
        });
    }, 25000);

    // Initial data load — wait for both before rendering charts so the
    // line/radar charts never render with half-loaded state.
    const dashboardLoad = loadLiveDashboardData();
    const menuLoad = loadLiveMenuData();
    Promise.allSettled([dashboardLoad, menuLoad]).then(() => {
        renderSalesCharts(latestOrders, allProducts);
        populateInventoryLinkSelect();
    });

    // Profile + waste modules
    setupProfileBadge();
    loadWasteData();
});
