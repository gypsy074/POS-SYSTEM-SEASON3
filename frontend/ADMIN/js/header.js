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
    const btn = document.getElementById("refreshAdminBtn");
    if (btn) btn.classList.add("spinning");
    const job = (() => {
        if (activePanelId === "menu-view")      return loadLiveMenuData();
        if (activePanelId === "users-view")     return loadLiveUserData();
        if (activePanelId === "inventory-view") return loadLiveInventoryData();
        if (activePanelId === "waste-view")     return loadWasteData();
        if (activePanelId === "audit-view")     return loadAuditData();
        return loadLiveDashboardData();
    })();
    Promise.resolve(job).finally(() => {
        if (btn) btn.classList.remove("spinning");
    });
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

function setupServerStatus() {
    const statusEl = document.getElementById("serverStatus");
    if (!statusEl) return;

    const dot = statusEl.querySelector(".status-dot");
    const text = statusEl.querySelector(".status-text");
    let pending = false;

    const setState = (state, label) => {
        statusEl.classList.remove("online", "offline", "waking");
        if (state) statusEl.classList.add(state);
        text.textContent = label;
    };

    const check = async () => {
        if (pending) return;
        pending = true;
        setState("waking", "Checking...");
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const response = await fetch("/api/health", { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                const data = await response.json();
                setState(data && data.ok ? "online" : "offline", data && data.ok ? "Online" : "Offline");
            } else {
                setState("offline", "Offline");
            }
        } catch (err) {
            setState("offline", "Offline");
        } finally {
            pending = false;
        }
    };

    check();
    setInterval(check, 30000);
}
