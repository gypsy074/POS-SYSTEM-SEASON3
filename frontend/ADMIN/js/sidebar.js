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

            if (typeof updateHeaderCenter === "function") updateHeaderCenter();

            // On phones the nav is a scrollable bottom bar — keep the active tab
            // in view by scrolling ONLY the bar. Never scrollIntoView the button:
            // it pans every scrollable ancestor, including the page itself,
            // which makes the screen slide sideways on mobile.
            if (window.innerWidth <= 720) {
                const links = document.querySelector(".nav-links");
                if (links) {
                    const btnRect = button.getBoundingClientRect();
                    const barRect = links.getBoundingClientRect();
                    links.scrollTo({
                        left: links.scrollLeft + (btnRect.left - barRect.left) - (links.clientWidth - btnRect.width) / 2,
                        behavior: "smooth"
                    });
                }
            }

            if (activePanelId === "dashboard-view") loadLiveDashboardData();
            if (activePanelId === "sales-view")     loadLiveDashboardData();
            if (activePanelId === "menu-view")      loadLiveMenuData();
            if (activePanelId === "users-view")     loadLiveUserData();
            if (activePanelId === "inventory-view") loadLiveInventoryData();
            if (activePanelId === "waste-view") loadWasteData();
            if (activePanelId === "audit-view") loadAuditData();
            if (activePanelId === "settings-view") loadSettings();
        });
    });
}
