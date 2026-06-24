/* ==========================================================================
   sidebar.js — Sidebar navigation component
   Handles panel switching and triggers data load for each view.
   ========================================================================== */

function setupSidebarNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    const adminPanels = document.querySelectorAll(".admin-panel");

    navButtons.forEach(button => {
        button.addEventListener("click", () => {
            navButtons.forEach(btn => btn.classList.remove("active"));
            adminPanels.forEach(panel => panel.classList.add("hidden"));

            button.classList.add("active");
            activePanelId = button.getAttribute("data-target");
            const targetPanel = document.getElementById(activePanelId);

            if (targetPanel) {
                targetPanel.classList.remove("hidden");
            }

            if (activePanelId === "dashboard-view") loadLiveDashboardData();
            if (activePanelId === "menu-view")      loadLiveMenuData();
            if (activePanelId === "users-view")     loadLiveUserData();
            if (activePanelId === "inventory-view") loadLiveInventoryData();
        });
    });
}
