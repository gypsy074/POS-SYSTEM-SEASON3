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

let salesLineChart = null;
let itemsRadarChart = null;
let activePanelId  = "dashboard-view";

// ── Application Bootstrap ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    // Components
    setupSidebarNavigation();
    setupHeaderActions();
    setupGlobalSearch();

    // Menu module
    setupMenuTableSelection();
    setupMenuActionButtons();
    setupImageUploadEngine();

    // Users module
    setupUserTableSelection();
    setupUserActionButtons();

    // Inventory module
    setupInventoryTableSelection();
    setupInventoryActionButtons();

    // Initial data load
    loadLiveDashboardData();
    loadLiveMenuData();
});
