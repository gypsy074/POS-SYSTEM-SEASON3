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
            if (!dropdown) return;
            if (dropdown.classList.contains("show")) closeNotificationDropdown();
            else openNotificationDropdown();
        });
    }

    // Close the notification dropdown when clicking anywhere outside it.
    document.addEventListener("click", event => {
        const dropdown = document.getElementById("notificationDropdown");
        if (dropdown && dropdown.classList.contains("show") && !dropdown.contains(event.target)) {
            closeNotificationDropdown();
        }
    });
}

let notifCloseTimer = null;

function openNotificationDropdown() {
    const dropdown = document.getElementById("notificationDropdown");
    if (!dropdown) return;
    if (notifCloseTimer) {
        clearTimeout(notifCloseTimer);
        notifCloseTimer = null;
    }
    dropdown.classList.remove("closing");
    dropdown.classList.add("show");
}

function closeNotificationDropdown() {
    const dropdown = document.getElementById("notificationDropdown");
    if (!dropdown || !dropdown.classList.contains("show")) return;
    if (notifCloseTimer) {
        clearTimeout(notifCloseTimer);
        notifCloseTimer = null;
    }
    dropdown.classList.add("closing");
    notifCloseTimer = setTimeout(() => {
        notifCloseTimer = null;
        dropdown.classList.remove("closing", "show");
    }, 230);
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

const HEADER_VIEW_TITLES = {
    "dashboard-view":  { icon: "fa-gauge-high", title: "Dashboard" },
    "sales-view":      { icon: "fa-chart-line", title: "Sales Analytics" },
    "users-view":      { icon: "fa-user-plus", title: "Add Users" },
    "menu-view":       { icon: "fa-utensils", title: "Add Menu" },
    "inventory-view":  { icon: "fa-boxes-stacked", title: "Inventory" },
    "waste-view":      { icon: "fa-recycle", title: "Waste Food" },
    "audit-view":      { icon: "fa-scroll", title: "Audit Log" }
};

function updateHeaderCenter() {
    const icon = document.getElementById("headerCenterIcon");
    const title = document.getElementById("headerCenterTitle");
    if (!icon || !title) return;
    const entry = HEADER_VIEW_TITLES[activePanelId] || HEADER_VIEW_TITLES["dashboard-view"];
    icon.className = `fas ${entry.icon}`;
    title.textContent = entry.title;
}

function setupHeaderCenter() {
    const clock = document.getElementById("headerCenterClock");
    if (clock) {
        const tick = () => {
            clock.textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
        };
        tick();
        setInterval(tick, 1000);
    }
    updateHeaderCenter();
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
        return loadLiveDashboardData(true); // force — bypass the 30s orders cache
    })();
    return Promise.resolve(job).finally(() => {
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
        // Charts paint on canvas — rebuild them so tick/label colors match the theme
        refreshCurrentPanel();
    });
}

function setupScrollHeader() {
    const header = document.querySelector(".admin-header");
    if (!header) return;
    if (!window.matchMedia("(max-width: 720px)").matches) return;

    let lastY = window.scrollY;
    let lastRun = 0;

    const onScroll = () => {
        const now = Date.now();
        if (now - lastRun < 80) return;
        lastRun = now;
        // While the AI panel is open, never hide the header — its transform
        // re-anchors the panel (fixed inside the header) and yanks it offscreen.
        const pill = document.getElementById("aiHeaderPill");
        if (pill && pill.classList.contains("open")) {
            header.classList.remove("header-hidden");
            return;
        }
        const y = window.scrollY;
        const dy = y - lastY;
        if (dy > 8 && y > 80) {
            header.classList.add("header-hidden");
        } else if (dy < -8 || y <= 80) {
            header.classList.remove("header-hidden");
        }
        lastY = y;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
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
