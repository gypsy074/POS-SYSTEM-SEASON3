/* ==========================================================================
   dashboard.js — Dashboard view module
   Handles: order data fetch, transaction table render, sales charts.
   ========================================================================== */

let activeSalesRange = "day";
let activeRadarCategory = "";
let builtPillCategories = null;
let calendarViewDate = new Date();
let latestUsers = [];
let latestLogins = [];
let latestLogouts = [];
let transactionPage = 1;
const TRANSACTIONS_PER_PAGE = 25;
const activeSalesFilters = { day: [], week: [], month: [] };
let salesFilterOptionsBuilt = false;
let salesFilterMode = "day";

// Orders payload cache — view switches reuse it for 30s; the manual refresh
// button passes force=true to bypass. Rendering always runs, so the row/card
// animations replay identically on every load.
let dashboardOrdersCache = null;
let dashboardOrdersAt = 0;
let dashboardFetching = false;
const DASHBOARD_CACHE_MS = 30000;

async function loadLiveDashboardData(force) {
    try {
        if (dashboardFetching) return;
        dashboardFetching = true;
        let orders;
        if (force || !dashboardOrdersCache || Date.now() - dashboardOrdersAt > DASHBOARD_CACHE_MS) {
            const response = await apiFetch("/api/orders?days=90&limit=5000");
            if (!response.ok) throw new Error("Network payload reading failed");
            orders = await response.json();
            dashboardOrdersCache = orders;
            dashboardOrdersAt = Date.now();
        } else {
            orders = dashboardOrdersCache;
        }
        latestOrders = orders;

        const tableBody        = document.getElementById("transactionBody");
        const totalRevenueEl   = document.getElementById("totalRevenue");
        const todaySalesCountEl = document.getElementById("todaySalesCount");

        if (!tableBody || !totalRevenueEl || !todaySalesCountEl) return;

        renderTransactionTable(orders);
        setupSalesFilterOptions(orders);

        const revenueAccumulator = orders.reduce(
            (sum, order) => (order.status === "Voided" ? sum : sum + Number(order.total || 0)),
            0
        );
        totalRevenueEl.innerText = `₱${revenueAccumulator.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

        const today = new Date();
        const todayOrders = orders.filter(order => {
            const orderDate = new Date(order.date);
            return orderDate.getFullYear() === today.getFullYear() &&
                orderDate.getMonth() === today.getMonth() &&
                orderDate.getDate() === today.getDate() &&
                order.status !== "Voided";
        });
        todaySalesCountEl.innerText = `${todayOrders.length} Orders`;

        const performanceEl = document.getElementById("performanceValue");
        if (performanceEl) {
            const revenue = revenueAccumulator;
            const wasteCost = (latestWaste || []).reduce((sum, w) => sum + Number(w.totalCost || 0), 0);
            let performance = "No Data";
            if (revenue > 0) {
                const wasteRatio = wasteCost / revenue;
                if (wasteRatio === 0) performance = "Excellent";
                else if (wasteRatio < 0.05) performance = "Good";
                else if (wasteRatio < 0.15) performance = "Fair";
                else performance = "Poor";
            }
            performanceEl.innerText = performance;
        }

        await loadActivityFeed();
        renderUpdates();
        renderNotifications();
        renderDailySnapshot();

        renderSalesCharts(orders, allProducts);
        setupCategoryPills();
        renderUsageChart(orders);
        renderCalendar();
        loadInsights();
    } catch (err) {
        console.error("❌ Dashboard sync pipeline broken:", err);
    } finally {
        dashboardFetching = false;
    }
}

// Best-effort activity feed — who's logged in / active. Never breaks the dashboard.
async function loadActivityFeed() {
    try {
        const [usersRes, loginRes, logoutRes] = await Promise.allSettled([
            apiFetch("/api/users"),
            apiFetch("/api/audit?action=user.login&limit=2"),
            apiFetch("/api/audit?action=user.logout&limit=2")
        ]);
        if (usersRes.status === "fulfilled" && usersRes.value.ok) latestUsers = await usersRes.value.json();
        if (loginRes.status === "fulfilled" && loginRes.value.ok) latestLogins = await loginRes.value.json();
        if (logoutRes.status === "fulfilled" && logoutRes.value.ok) latestLogouts = await logoutRes.value.json();
    } catch (err) {
        // silent — the activity feed is optional
    }
}

// ── Updates Panel & Notification Feed ──────────────────────────────────────

function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function buildUpdates() {
    const updates = [];
    const activeCutoff = Date.now() - 5 * 60 * 1000;

    const sortedUsers = [...(latestUsers || [])].sort((a, b) => {
        const ta = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const tb = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        return tb - ta;
    });

    if (sortedUsers.length) {
        updates.push({ section: "USERS" });
        sortedUsers.forEach(user => {
            const t = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
            const active = t > activeCutoff;
            updates.push({
                icon: active ? "fa-user-check" : "fa-user",
                kind: "activity",
                compact: true,
                title: `${active ? "🟢" : "⚪"} ${user.username} · ${active ? "active now" : t ? `last seen ${timeAgo(t)}` : "never seen"} · ${user.role}`,
                sub: ""
            });
        });
    }

    if ((latestLogins || []).length || (latestLogouts || []).length) {
        updates.push({ section: "LOGINS & LOGOUTS" });
        (latestLogins || []).forEach(log => updates.push({
            icon: "fa-right-to-bracket",
            kind: "activity",
            compact: true,
            title: `${log.actor || "someone"} logged in`,
            sub: new Date(log.date).toLocaleTimeString()
        }));
        (latestLogouts || []).forEach(log => updates.push({
            icon: "fa-arrow-right-from-bracket",
            kind: "activity",
            compact: true,
            title: `${log.actor || "someone"} logged out`,
            sub: new Date(log.date).toLocaleTimeString()
        }));
    }

    const businessUpdates = [];

    (allProducts || [])
        .filter(product => Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10))
        .slice(0, 3)
        .forEach(product => {
            businessUpdates.push({
                icon: "fa-box-open",
                flagged: true,
                compact: true,
                title: `${product.status === "Out of Stock" ? "OUT OF STOCK" : "Low stock"} — ${product.name}`,
                sub: `${Number(product.stock ?? 0)} left · threshold ${Number(product.lowStockThreshold ?? 10)}`
            });
        });

    (latestWaste || []).slice(0, 3).forEach(waste => {
        businessUpdates.push({
            icon: "fa-recycle",
            flagged: true,
            compact: true,
            title: `Waste logged — ${waste.productName}`,
            sub: `${waste.cashier || "—"} · ${waste.reason || "Other"} · Qty ${waste.quantity} · ₱${Number(waste.totalCost || 0).toFixed(2)} · ${new Date(waste.date).toLocaleString()}`
        });
    });

    (latestOrders || []).slice(0, 4).forEach(order => {
        businessUpdates.push({
            icon: "fa-clipboard-check",
            flagged: false,
            compact: true,
            title: `${order.customer} placed an order`,
            sub: `${order.cashier || "—"} · ${order.receiptId} · ₱${Number(order.total || 0).toFixed(2)}`
        });
    });

    if (businessUpdates.length) {
        updates.push({ section: "STOCK & ORDERS" });
        updates.push(...businessUpdates);
    }

    if (!updates.length) {
        updates.push({
            icon: "fa-circle-check",
            flagged: false,
            title: "No recent updates yet",
            sub: "Orders, waste events, and stock alerts will appear here"
        });
    }

    return updates.slice(0, 30);
}

function renderUpdates() {
    const updateList = document.getElementById("updateList");
    if (!updateList) return;

    const items = buildUpdates();
    let html = "";
    let listOpen = false;
    let groupOpen = false;

    items.forEach(update => {
        if (update.section) {
            if (listOpen) {
                html += "</div>";
                listOpen = false;
            }
            if (groupOpen) {
                html += "</div>";
                groupOpen = false;
            }
            html += `<div class="update-section-group"><div class="update-section">${escapeHtml(update.section)}<button type="button" class="update-section-toggle" aria-label="Expand section"><span class="update-section-count"></span><i class="fas fa-chevron-down"></i></button></div>`;
            groupOpen = true;
        } else {
            if (!listOpen) {
                html += '<div class="update-section-list">';
                listOpen = true;
            }
            html += `
            <div class="update-item${update.compact ? " update-item--compact" : ""}">
                <div class="update-avatar${update.flagged ? " update-avatar-danger" : ""}">
                    <i class="fas ${update.icon}"></i>
                </div>
                <div class="update-text">
                    <strong>${escapeHtml(update.title)}</strong>
                    <span>${escapeHtml(update.sub)}</span>
                </div>
            </div>`;
        }
    });

    if (listOpen) html += "</div>";
    if (groupOpen) html += "</div>";

    updateList.innerHTML = html;

    // Fill each section's toggle button with its item count.
    updateList.querySelectorAll(".update-section-group").forEach(group => {
        const list = group.querySelector(".update-section-list");
        const count = list ? list.querySelectorAll(".update-item").length : 0;
        const countEl = group.querySelector(".update-section-count");
        if (countEl) countEl.textContent = count;
    });
}

// ── Updates section expander (opens the list over the Updates card) ────────

function setupUpdateSectionExpand() {
    const updateList = document.getElementById("updateList");
    if (!updateList || updateList.dataset.expandBound) return;
    updateList.dataset.expandBound = "1";

    // Delegated — survives renderUpdates() re-rendering the list every refresh.
    // The right-side button (count + chevron) is the trigger.
    updateList.addEventListener("click", e => {
        const toggle = e.target.closest(".update-section-toggle");
        if (!toggle) return;
        const header = toggle.closest(".update-section");
        if (header) openUpdatesSection(header);
    });

    const overlay = document.getElementById("updatesDetailOverlay");
    if (overlay) {
        const closeBtn = document.getElementById("updatesDetailClose");
        if (closeBtn) closeBtn.addEventListener("click", closeUpdatesSection);
        overlay.addEventListener("click", e => {
            if (e.target === overlay) closeUpdatesSection();
        });
    }
}

function openUpdatesSection(header) {
    const overlay = document.getElementById("updatesDetailOverlay");
    const titleEl = document.getElementById("updatesDetailTitle");
    const body = document.getElementById("updatesDetailBody");
    if (!overlay || !header) return;

    titleEl.textContent = (header.firstChild ? header.firstChild.textContent : header.textContent).trim();
    const group = header.closest(".update-section-group");
    const items = group ? group.querySelectorAll(".update-item") : [];

    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(item.cloneNode(true)));
    body.innerHTML = "";
    body.appendChild(frag);

    overlay.classList.add("open");
    document.addEventListener("keydown", closeUpdatesSectionOnEsc);
}

function closeUpdatesSection() {
    const overlay = document.getElementById("updatesDetailOverlay");
    if (overlay) overlay.classList.remove("open");
    document.removeEventListener("keydown", closeUpdatesSectionOnEsc);
}

function closeUpdatesSectionOnEsc(e) {
    if (e.key === "Escape") closeUpdatesSection();
}

function buildNotificationItems() {
    const items = [];
    const ai = window.__aiInsightsData || {};

    (ai.restock || []).slice(0, 3).forEach(r => {
        items.push({
            icon: "fa-boxes-stacked",
            flagged: true,
            nav: "menu-view",
            title: `Restock — ${r.name}`,
            sub: `${r.stock} left${r.daysLeft !== null ? ` · ~${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}` : ""} · order ${r.suggestedOrder}`
        });
    });

    ((ai.wasteInsights && ai.wasteInsights.items) || []).slice(0, 3).forEach(w => {
        items.push({
            icon: "fa-recycle",
            flagged: true,
            nav: "waste-view",
            title: `Over-preparing — ${w.name}`,
            sub: `${w.wastedQty} wasted vs ${w.soldQty} sold (${Math.round(w.ratio * 100)}%)`
        });
    });

    (ai.anomalies || []).slice(0, 3).forEach(a => {
        items.push({
            icon: "fa-exclamation-triangle",
            flagged: true,
            nav: "dashboard-view",
            title: a.label,
            sub: a.detail
        });
    });

    (allProducts || [])
        .filter(product => Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10))
        .slice(0, 3)
        .forEach(product => {
            items.push({
                icon: "fa-box-open",
                flagged: true,
                nav: "menu-view",
                title: `${product.status === "Out of Stock" ? "OUT OF STOCK" : "Low stock"} — ${product.name}`,
                sub: `${Number(product.stock ?? 0)} left · threshold ${Number(product.lowStockThreshold ?? 10)}`
            });
        });

    (latestWaste || []).slice(0, 2).forEach(waste => {
        items.push({
            icon: "fa-trash-can",
            flagged: true,
            nav: "waste-view",
            title: `Waste logged — ${waste.productName}`,
            sub: `${waste.reason || "Other"} · Qty ${waste.quantity} · ₱${Number(waste.totalCost || 0).toFixed(2)}`
        });
    });

    (latestOrders || []).slice(0, 3).forEach(order => {
        items.push({
            icon: "fa-clipboard-check",
            flagged: false,
            nav: "dashboard-view",
            title: `${order.customer} placed an order`,
            sub: `${order.cashier || "—"} · ${order.receiptId} · ₱${Number(order.total || 0).toFixed(2)}`
        });
    });

    return items;
}

function renderNotifications() {
    const panel = document.getElementById("notificationDropdown");
    if (!panel) return;

    const items = buildNotificationItems();
    panel.innerHTML = items.length
        ? items.map(item => `
            <button type="button" class="notification-item${item.flagged ? " notification-item-danger" : ""}" data-nav="${item.nav}">
                <i class="fas ${item.icon}"></i>
                <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.sub)}</span>
                </div>
            </button>`).join("")
        : `<div class="notification-item"><i class="fas fa-circle-check"></i><div><strong>All clear</strong><span>No alerts right now</span></div></div>`;

    if (!window.__notifBound) {
        window.__notifBound = true;
        panel.addEventListener("click", event => {
            const item = event.target.closest(".notification-item[data-nav]");
            if (!item) return;
            if (typeof closeNotificationDropdown === "function") closeNotificationDropdown();
            const navBtn = document.querySelector(`.nav-btn[data-target="${item.getAttribute("data-nav")}"]`);
            if (navBtn) navBtn.click();
        });
    }

    const badge = document.getElementById("notificationBadge");
    if (badge) {
        const ai = window.__aiInsightsData || {};
        const lowStockCount = (allProducts || []).filter(product =>
            Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10)
        ).length;
        const aiCount = (ai.restock || []).length
            + ((ai.wasteInsights && ai.wasteInsights.items) || []).length
            + (ai.anomalies || []).length;
        const count = lowStockCount + aiCount;
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }
}

// ── Today at a Glance ──────────────────────────────────────────────────────

function renderDailySnapshot() {
    const el = document.getElementById("dailySnapshot");
    if (!el) return;

    const today = new Date();
    const isSameDay = d => {
        const t = new Date(d);
        return t.getFullYear() === today.getFullYear() &&
            t.getMonth() === today.getMonth() &&
            t.getDate() === today.getDate();
    };

    const todayOrders = (latestOrders || []).filter(o => isSameDay(o.date) && o.status !== "Voided");
    const revenue = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);

    const qtyByItem = {};
    todayOrders.forEach(o => (o.items || []).forEach(it => {
        qtyByItem[it.name] = (qtyByItem[it.name] || 0) + Number(it.quantity || 0);
    }));
    const topItem = Object.entries(qtyByItem).sort((a, b) => b[1] - a[1])[0] || null;

    const wasteToday = (latestWaste || [])
        .filter(w => isSameDay(w.date))
        .reduce((s, w) => s + Number(w.totalCost || 0), 0);

    const lowStock = (allProducts || [])
        .filter(p => Number(p.stock ?? 0) <= Number(p.lowStockThreshold ?? 10)).length;

    const ai = window.__aiInsightsData || {};
    const restock = (ai.restock || [])[0] || null;

    const money = n => `₱${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const chip = (icon, label, value) => `
        <div class="snapshot-chip">
            <i class="fas ${icon}"></i>
            <span class="snapshot-chip-label">${label}</span>
            <strong>${value}</strong>
        </div>`;

    el.innerHTML = `
        <div class="snapshot-head"><i class="fas fa-sun"></i> Today at a Glance</div>
        <div class="snapshot-chips">
            ${chip("fa-peso-sign", "Revenue", money(revenue))}
            ${chip("fa-receipt", "Orders", String(todayOrders.length))}
            ${chip("fa-trophy", "Top item", topItem ? `${escapeHtml(topItem[0])} ×${topItem[1]}` : "—")}
            ${chip("fa-recycle", "Waste today", money(wasteToday))}
            ${chip("fa-box-open", "Low stock", String(lowStock))}
            ${chip("fa-boxes-stacked", "Restock soon", restock ? `${escapeHtml(restock.name)} · order ${restock.suggestedOrder}` : "—")}
        </div>`;
}

// ── CSV Export (Sales Analytics) ───────────────────────────────────────────

function exportSalesCsv() {
    const orders = latestOrders || [];
    if (!orders.length) {
        showToast("No orders to export yet.", "info");
        return;
    }

    const rangeLimit = { day: 7, week: 28, month: 90, all: Infinity }[activeSalesRange] || 7;
    const cutoff = activeSalesRange === "all"
        ? null
        : Date.now() - (rangeLimit * 24 * 60 * 60 * 1000);

    const rows = [["Receipt", "Customer", "Cashier", "Mode", "Payment", "Items", "Total", "Tendered", "Change", "Status", "Date"]];
    orders
        .filter(order => activeSalesRange === "all" || new Date(order.date).getTime() >= cutoff)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(order => rows.push([
            String(order.receiptId || ""),
            String(order.customer || ""),
            String(order.cashier || ""),
            String(order.mode || ""),
            String(order.paymentMethod || ""),
            String((order.items || []).map(item => `${item.name} x${item.quantity}`).join("; ")),
            Number(order.total || 0).toFixed(2),
            Number(order.tendered ?? 0).toFixed(2),
            Number(order.change ?? 0).toFixed(2),
            String(order.status || "Completed"),
            new Date(order.date).toLocaleString()
        ]));

    // Neutralize spreadsheet formula injection: cells starting with =, +, -,
    // or @ would execute as a formula when the CSV is opened in Excel/Sheets.
    const csv = rows.map(row => row.map(cell =>
        `"${String(cell).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`
    ).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `season3-sales-${activeSalesRange}-${localDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ── Waste Food Panel (view + remove) ───────────────────────────────────────

function setupWasteFilters() {
    const fromEl = document.getElementById("wasteFrom");
    const toEl   = document.getElementById("wasteTo");
    if (fromEl) fromEl.addEventListener("change", renderWasteTable);
    if (toEl)   toEl.addEventListener("change", renderWasteTable);
}

// The visible waste set, bounded by the from/to date filters.
function filteredWaste() {
    const waste = latestWaste || [];
    const fromEl = document.getElementById("wasteFrom");
    const toEl   = document.getElementById("wasteTo");
    const from = fromEl && fromEl.value ? new Date(fromEl.value + "T00:00:00") : null;
    const to   = toEl && toEl.value ? new Date(toEl.value + "T23:59:59") : null;
    return waste.filter(entry => {
        const d = new Date(entry.date);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    });
}

async function loadWasteData() {
    try {
        const response = await apiFetch("/api/waste");
        if (!response.ok) throw new Error("Failed to fetch waste");

        const waste = await response.json();
        latestWaste = Array.isArray(waste) ? waste : [];

        renderWasteTable();
        updateWasteStat();
        renderUpdates();
        renderNotifications();
    } catch (err) {
        console.error("❌ Waste load error:", err);
    }
}

function updateWasteStat() {
    const countEl = document.getElementById("wasteCount");
    if (countEl) {
        const now = new Date();
        const monthWaste = (latestWaste || []).filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate.getFullYear() === now.getFullYear() &&
                entryDate.getMonth() === now.getMonth();
        });
        const monthCost = monthWaste.reduce((sum, entry) => sum + Number(entry.totalCost || 0), 0);
        countEl.innerText = `₱${monthCost.toFixed(2)} · ${monthWaste.length} items`;
    }
}

function renderWasteTopItems(filtered) {
    const el = document.getElementById("wasteTopItems");
    if (!el) return;
    if (!filtered.length) {
        el.innerHTML = "";
        return;
    }
    const byName = {};
    filtered.forEach(entry => {
        byName[entry.productName] = (byName[entry.productName] || 0) + Number(entry.totalCost || 0);
    });
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 3);
    el.innerHTML = '<span class="waste-top-label"><i class="fas fa-fire"></i> Top wasted:</span> ' +
        top.map(([name, cost]) =>
            `<span class="waste-top-chip">${escapeHtml(name)} · ₱${cost.toFixed(2)}</span>`
        ).join(" ");
}

function renderWasteTable() {
    const tbody = document.getElementById("wasteTableBody");
    if (!tbody) return;

    const waste = filteredWaste();

    const totalEl = document.getElementById("wasteTotalCost");
    if (totalEl) {
        const total = waste.reduce((sum, entry) => sum + Number(entry.totalCost || 0), 0);
        totalEl.innerText = `Total Waste: ₱${total.toFixed(2)}`;
    }

    renderWasteTopItems(waste);

    if (!waste.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:#888; padding:22px;">
                    No food waste logged${latestWaste && latestWaste.length ? " in this date range" : ""}. Everything looks great!
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = waste.map(entry => `
        <tr data-waste-id="${entry._id}">
            <td>${escapeHtml(entry.productName)}</td>
            <td>${escapeHtml(entry.cashier || "—")}</td>
            <td>${entry.quantity}</td>
            <td>₱${Number(entry.price || 0).toFixed(2)}</td>
            <td>₱${Number(entry.totalCost || 0).toFixed(2)}</td>
            <td>${escapeHtml(entry.reason || "Other")}</td>
            <td>${new Date(entry.date).toLocaleString()}</td>
            <td>
                <button type="button" class="btn-pill resolve-btn" data-waste-id="${entry._id}">Remove</button>
            </td>
        </tr>
    `).join("");

    tbody.querySelectorAll(".resolve-btn").forEach(button => {
        button.addEventListener("click", async () => {
            const entryId = button.dataset.wasteId;
            const entry = (latestWaste || []).find(w => w._id === entryId);
            const confirmed = await showConfirmModal({
                title: "Remove waste entry?",
                message: entry
                    ? `"${entry.productName}" × ${entry.quantity} will be removed from the waste record. This cannot be undone.`
                    : "This waste entry will be permanently removed. This cannot be undone.",
                confirmLabel: "Remove",
                danger: true
            });
            if (!confirmed) return;
            await removeWasteEntry(entryId, button);
        });
    });
}

async function removeWasteEntry(entryId, button) {
    const row = button ? button.closest("tr") : null;
    const originalLabel = button ? button.textContent : "";
    if (button) {
        button.disabled = true;
        button.textContent = "Removing…";
    }
    if (row) row.classList.add("removing-row");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await apiFetch(`/api/waste/${entryId}`, { method: "DELETE", signal: controller.signal });
        if (!response.ok) throw new Error("Failed to delete waste entry");

        if (row) row.remove();
        showToast("Waste entry removed.", "success");
        await loadWasteData();
        loadLiveDashboardData();
    } catch (err) {
        if (row) row.classList.remove("removing-row");
        if (err.name === "AbortError") {
            showToast("The server took too long — refresh to check whether the entry was removed.", "error");
        } else {
            console.error("❌ Waste removal error:", err);
            showToast("Failed to remove the waste entry.", "error");
        }
    } finally {
        clearTimeout(timeoutId);
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
}

function renderTransactionTable(orders) {
    const tbody = document.getElementById("transactionBody");
    if (!tbody) return;

    const search = String(transactionSearch || "").trim().toLowerCase();
    const filtered = orders.filter(order => {
        const dateText = new Date(order.date).toLocaleString();
        const values = {
            customer: order.customer,
            cashier: order.cashier,
            date: dateText,
            receiptId: order.receiptId,
            items: (order.items || []).map(item => item.name).join(", "),
            total: Number(order.total || 0).toFixed(2),
            paymentMethod: order.paymentMethod || "Cash",
            mode: order.mode || "Dine In"
        };
        const matchesSearch = !search || [
            values.customer, values.receiptId, values.items
        ].join(" ").toLowerCase().includes(search);
        const matchesColumns = Object.entries(transactionFilters).every(([key, value]) =>
            !value || String(values[key] || "").toLowerCase().includes(value.toLowerCase())
        );
        return matchesSearch && matchesColumns;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / TRANSACTIONS_PER_PAGE));
    transactionPage = Math.min(transactionPage, totalPages);
    const start = (transactionPage - 1) * TRANSACTIONS_PER_PAGE;
    const visible = filtered.slice(start, start + TRANSACTIONS_PER_PAGE);
    const countEl = document.getElementById("transactionCount");
    if (countEl) {
        countEl.textContent = search
            ? `${filtered.length} matching · page ${transactionPage} of ${totalPages}`
            : `${filtered.length} order${filtered.length === 1 ? "" : "s"} · page ${transactionPage} of ${totalPages}`;
    }

    if (!visible.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="tx-empty">${
            search || Object.values(transactionFilters).some(Boolean)
                ? "No transactions match the current filters."
                : "No transactions yet."
        }</td></tr>`;
        renderTransactionPagination(totalPages);
        return;
    }

    tbody.innerHTML = visible.map(order => {
        const isVoided = order.status === "Voided";
        return `
        <tr class="${isVoided ? "voided-row" : ""}">
            <td>${escapeHtml(order.customer)}</td>
            <td>${escapeHtml(order.cashier || "—")}</td>
            <td>${new Date(order.date).toLocaleString()}</td>
            <td>${escapeHtml(order.receiptId)}${isVoided ? ' <span class="voided-badge">VOIDED</span>' : ""}</td>
            <td>${escapeHtml((order.items || []).map(item => item.name).join(", "))}</td>
            <td>₱${Number(order.total || 0).toFixed(2)}</td>
            <td>${escapeHtml(order.paymentMethod || "Cash")}</td>
            <td>${escapeHtml(order.mode || "Dine In")}</td>
        </tr>
    `;
    }).join("");
    renderTransactionPagination(totalPages);
}

// ── Recent Transactions search ─────────────────────────────────────────────
let transactionSearch = "";
const transactionFilters = {
    customer: "",
    cashier: "",
    date: "",
    receiptId: "",
    items: "",
    total: "",
    paymentMethod: "",
    mode: ""
};

function setupTransactionSearch() {
    const input = document.getElementById("transactionSearch");
    if (!input) return;
    input.addEventListener("input", () => {
        transactionSearch = input.value;
        transactionPage = 1;
        clearTimeout(setupTransactionSearch._t);
        setupTransactionSearch._t = setTimeout(() => renderTransactionTable(latestOrders || []), 150);
    });
    document.querySelectorAll("[data-tx-filter]").forEach(filterInput => {
        const key = filterInput.dataset.txFilter;
        if (!(key in transactionFilters)) return;
        filterInput.addEventListener("input", () => {
            transactionFilters[key] = filterInput.value.trim();
            transactionPage = 1;
            renderTransactionTable(latestOrders || []);
        });
    });
}

function renderTransactionPagination(totalPages) {
    const pagination = document.getElementById("transactionPagination");
    if (!pagination) return;
    if (totalPages <= 1) {
        pagination.innerHTML = "";
        return;
    }
    const buttons = [];
    for (let page = 1; page <= totalPages; page += 1) {
        buttons.push(`<button type="button" class="${page === transactionPage ? "active" : ""}" data-page="${page}" aria-label="Go to page ${page}">${page}</button>`);
    }
    pagination.innerHTML = `
        <button type="button" data-page="${transactionPage - 1}" ${transactionPage === 1 ? "disabled" : ""} aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>
        ${buttons.join("")}
        <button type="button" data-page="${transactionPage + 1}" ${transactionPage === totalPages ? "disabled" : ""} aria-label="Next page"><i class="fas fa-chevron-right"></i></button>
    `;
    pagination.querySelectorAll("button:not([disabled])").forEach(button => {
        button.addEventListener("click", () => {
            transactionPage = Number(button.dataset.page);
            renderTransactionTable(latestOrders || []);
        });
    });
}

// Chart colors follow the active theme — Chart.js paints on canvas, so CSS
// dark-mode rules cannot touch it.
function getChartTheme() {
    const dark = document.body.classList.contains("dark");
    return {
        text:    dark ? "#b09a80" : "#666",
        strong:  dark ? "#e8dccb" : "#666",
        grid:    dark ? "rgba(232, 220, 203, 0.12)" : "rgba(0, 0, 0, 0.08)",
        backdrop: "transparent"
    };
}

function filterOrdersByRange(orders, range = activeSalesRange) {
    if (!Array.isArray(orders) || !orders.length) return [];
    if (range === "all" || salesFilterMode === "all") {
        return orders.filter(order => order.status !== "Voided");
    }
    const selected = new Set(activeSalesFilters[range] || []);
    if (!selected.size) return orders.filter(order => order.status !== "Voided");

    return orders.filter(order => {
        if (order.status === "Voided") return false;
        const date = new Date(order.date);
        if (Number.isNaN(date.getTime())) return false;
        if (range === "day") return selected.has(formatLocalDate(date));
        if (range === "month") return selected.has(formatLocalMonth(date));
        return selected.has(formatLocalWeek(date).key);
    });
}

function formatLocalDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function formatLocalMonth(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatLocalWeek(date) {
    const week = Math.floor((date.getDate() - 1) / 7) + 1;
    const start = new Date(date.getFullYear(), date.getMonth(), (week - 1) * 7 + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    if (end > monthEnd) end.setTime(monthEnd.getTime());
    return {
        key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${week}`,
        week,
        start,
        end,
        month: start.toLocaleString("en-US", { month: "long" }),
        year: start.getFullYear()
    };
}

function setupSalesFilterOptions(orders) {
    if (salesFilterOptionsBuilt) return;
    const validOrders = (orders || []).filter(order => order.status !== "Voided" && !Number.isNaN(new Date(order.date).getTime()));
    salesFilterMode = "day";
    activeSalesRange = "day";
    document.querySelector(".all-sales-filter")?.classList.remove("active");
    const orderDates = validOrders.map(order => new Date(order.date));
    const fallbackEnd = new Date();
    const fallbackStart = new Date(fallbackEnd);
    fallbackStart.setDate(fallbackStart.getDate() - 89);
    const rangeStart = orderDates.length ? new Date(Math.min(...orderDates)) : fallbackStart;
    const rangeEnd = orderDates.length ? new Date(Math.max(...orderDates)) : fallbackEnd;
    const dates = [...new Set(validOrders.map(order => formatLocalDate(new Date(order.date))))].sort().reverse();
    if (!dates.length) {
        for (const date = new Date(rangeEnd); date >= rangeStart; date.setDate(date.getDate() - 1)) {
            dates.push(formatLocalDate(date));
        }
    }
    const months = [];
    const monthCursor = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
    const firstMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    for (; monthCursor >= firstMonth; monthCursor.setMonth(monthCursor.getMonth() - 1)) {
        months.push(formatLocalMonth(monthCursor));
    }
    const weeks = new Map();
    for (const month of months) {
        const [year, monthNumber] = month.split("-").map(Number);
        const monthEnd = new Date(year, monthNumber, 0);
        for (let day = 1; day <= monthEnd.getDate(); day += 7) {
            const week = formatLocalWeek(new Date(year, monthNumber - 1, day));
            if (!weeks.has(week.key)) weeks.set(week.key, week);
        }
    }
    const optionSets = {
        day: dates.map(value => ({ value, label: new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) })),
        week: [...weeks.values()].sort((a, b) => b.start - a.start).map(week => ({
            value: week.key,
            label: `${week.month} ${week.week} · ${week.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${week.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        })),
        month: months.map(value => ({ value, label: new Date(`${value}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) }))
    };
    Object.entries(optionSets).forEach(([type, options]) => {
        const menu = document.querySelector(`.filter-dropdown[data-filter="${type}"] .filter-dropdown-menu`);
        if (!menu) return;
        menu.innerHTML = options.map(option => `
            <label class="filter-option">
                <input type="checkbox" value="${option.value}" data-filter-type="${type}">
                <span class="filter-radio" aria-hidden="true"></span>
                <span>${option.label}</span>
            </label>
        `).join("");
        menu.querySelectorAll("input").forEach(input => {
            input.addEventListener("change", () => {
                salesFilterMode = type;
                activeSalesRange = type;
                Object.keys(activeSalesFilters).forEach(key => {
                    if (key !== type) activeSalesFilters[key] = [];
                });
                activeSalesFilters[type] = [...menu.querySelectorAll("input:checked")].map(item => item.value);
                document.querySelectorAll(".filter-dropdown").forEach(dropdown => {
                    if (dropdown.dataset.filter !== type) {
                        dropdown.querySelectorAll("input").forEach(item => { item.checked = false; });
                    }
                });
                Object.keys(activeSalesFilters).forEach(key => updateSalesFilterLabel(key));
                document.querySelector(".all-sales-filter")?.classList.remove("active");
                renderSalesCharts(latestOrders, allProducts);
                renderUsageChart(latestOrders);
            });
        });
    });
    if (dates.length) {
        activeSalesFilters.day = [dates[0]];
        const firstDay = document.querySelector('.filter-dropdown[data-filter="day"] input');
        if (firstDay) firstDay.checked = true;
        updateSalesFilterLabel("day");
    }
    Object.keys(activeSalesFilters).forEach(key => {
        if (key !== "day") activeSalesFilters[key] = [];
    });
    salesFilterOptionsBuilt = true;
}

function updateSalesFilterLabel(type) {
    const dropdown = document.querySelector(`.filter-dropdown[data-filter="${type}"]`);
    const toggle = dropdown?.querySelector(".filter-dropdown-toggle");
    if (!toggle) return;
    const count = activeSalesFilters[type].length;
    toggle.innerHTML = `${type[0].toUpperCase() + type.slice(1)}${count ? ` <span class="filter-selection-count">${count}</span>` : ""} <i class="fas fa-chevron-down"></i>`;
}

const DEFAULT_SALES_TARGET = 100000;

function formatPeso(value) {
    return `₱${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getSalesTarget() {
    const input = document.getElementById("targetSalesInput");
    const stored = Number.parseFloat(localStorage.getItem("dashboardSalesTarget") || "");
    const value = Number.parseFloat(input?.value || "");
    return Number.isFinite(value) && value >= 0
        ? value
        : Number.isFinite(stored) && stored >= 0
            ? stored
            : DEFAULT_SALES_TARGET;
}

function updateSalesTargetProgress(total, target) {
    const progressText = document.getElementById("targetSalesProgressText");
    const progressBar = document.getElementById("targetSalesProgressBar");
    const progressTrack = progressBar?.parentElement;
    const percent = target > 0 ? Math.min(100, (total / target) * 100) : 0;
    if (progressText) {
        progressText.textContent = `${formatPeso(total)} / ${formatPeso(target)} (${Math.round(percent)}%)`;
    }
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
}

function setupSalesTargetControl() {
    const input = document.getElementById("targetSalesInput");
    if (!input || input.dataset.bound === "true") return;
    const stored = Number.parseFloat(localStorage.getItem("dashboardSalesTarget") || "");
    if (Number.isFinite(stored) && stored >= 0) input.value = String(stored);
    input.dataset.bound = "true";
    input.addEventListener("change", () => {
        const target = getSalesTarget();
        input.value = String(target);
        localStorage.setItem("dashboardSalesTarget", String(target));
        renderUsageChart(latestOrders);
    });
}

function renderSalesCharts(orders, products, range = activeSalesRange) {
    if (!window.Chart) return;

    const theme = getChartTheme();

    const salesCanvas = document.getElementById("salesLineChart");
    const radarCanvas = document.getElementById("itemsRadarChart");
    if (!salesCanvas || !radarCanvas) return;

    const filteredOrders = filterOrdersByRange(orders, range);

    const dailyTotals = filteredOrders.reduce((acc, order) => {
        const day = new Date(order.date).toLocaleDateString();
        acc[day] = (acc[day] || 0) + Number(order.total || 0);
        return acc;
    }, {});

    const allDays = Object.keys(dailyTotals);
    const rangeLimit = { day: 7, week: 28, month: 90, all: Infinity }[range] || 7;
    const lineLabels = allDays.slice(-rangeLimit);
    const lineData = lineLabels.map(label => dailyTotals[label]);

    if (salesLineChart) salesLineChart.destroy();

    salesLineChart = new Chart(salesCanvas, {
        type: "line",
        data: {
            labels: lineLabels,
            datasets: [{
                label: "Sales (₱)",
                data: lineData,
                borderColor: "#4e73df",
                backgroundColor: "rgba(78,115,223,0.1)",
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: theme.text }, grid: { color: theme.grid } },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: theme.text,
                        callback: value => formatPeso(value)
                    },
                    grid: { color: theme.grid }
                }
            }
        }
    });

    const categoryByProduct = (products || []).reduce((map, product) => {
        map[product.name] = product.category || "Unknown";
        return map;
    }, {});

    const radarTitleEl = document.getElementById("radarCardTitle");
    const itemSource = (products || []).filter(product => (product.category || "Unknown") === activeRadarCategory);

    const itemCounts = {};
    itemSource.forEach(product => { itemCounts[product.name] = 0; });

    filteredOrders.forEach(order => {
        (order.items || []).forEach(item => {
            const category = categoryByProduct[item.name] || item.category || "Unknown";
            if (category === activeRadarCategory) {
                const key = item.name || "Unknown";
                itemCounts[key] = (itemCounts[key] || 0) + Number(item.quantity || 0);
            }
        });
    });

    const chartLabels = Object.keys(itemCounts)
        .sort((a, b) => itemCounts[b] - itemCounts[a])
        .slice(0, 20);
    const chartData = chartLabels.map(label => itemCounts[label]);
    if (radarCanvas.parentElement) {
        radarCanvas.parentElement.style.height = `${Math.max(280, Math.min(chartLabels.length * 34, 620))}px`;
    }

    if (itemsRadarChart) itemsRadarChart.destroy();

    itemsRadarChart = new Chart(radarCanvas, {
        type: "bar",
        data: {
            labels: chartLabels,
            datasets: [{
                label: "Quantity sold",
                data: chartData,
                backgroundColor: "#a67c52",
                borderRadius: 6,
                barThickness: 14,
                categoryPercentage: 0.78,
                barPercentage: 0.82
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0, color: theme.text }, grid: { color: theme.grid } },
                y: { ticks: { autoSkip: false, color: theme.text, padding: 10 }, grid: { color: theme.grid } }
            }
        }
    });
}

// ── Orders & Revenue bar chart (usage analytics) ──────────────────────────

function renderUsageChart(orders, range = activeSalesRange) {
    if (!window.Chart) return;

    const theme = getChartTheme();

    const usageCanvas = document.getElementById("usageBarChart");
    if (!usageCanvas) return;
    setupSalesTargetControl();
    const filteredOrders = filterOrdersByRange(orders, range);

    const dailyRevenue = {};
    const dailyCount   = {};
    filteredOrders.forEach(order => {
        if (order.status === "Voided") return;
        const key = new Date(order.date).toLocaleDateString();
        dailyRevenue[key] = (dailyRevenue[key] || 0) + Number(order.total || 0);
        dailyCount[key]   = (dailyCount[key] || 0) + 1;
    });

    const rangeLimit = { day: 7, week: 28, month: 90, all: Infinity }[range] || 7;
    let labels = [];
    let revenueByLabel = [];
    let countByLabel   = [];

    if (range === "all") {
        const monthlyRevenue = {};
        const monthlyCount   = {};
        filteredOrders.forEach(order => {
            if (order.status === "Voided") return;
            const key = new Date(order.date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
            monthlyRevenue[key] = (monthlyRevenue[key] || 0) + Number(order.total || 0);
            monthlyCount[key]   = (monthlyCount[key] || 0) + 1;
        });
        labels = Object.keys(monthlyRevenue).sort((a, b) => new Date(a) - new Date(b));
        revenueByLabel = labels.map(label => monthlyRevenue[label]);
        countByLabel   = labels.map(label => monthlyCount[label]);
    } else {
        for (let i = rangeLimit - 1; i >= 0; i--) {
            const label = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toLocaleDateString();
            labels.push(label);
            revenueByLabel.push(dailyRevenue[label] || 0);
            countByLabel.push(dailyCount[label] || 0);
        }
    }

    const selectedRevenue = revenueByLabel.reduce((sum, value) => sum + Number(value || 0), 0);
    const target = getSalesTarget();
    updateSalesTargetProgress(selectedRevenue, target);

    if (usageBarChart) usageBarChart.destroy();

    usageBarChart = new Chart(usageCanvas, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                type: "bar",
                label: "Revenue",
                data: revenueByLabel,
                backgroundColor: "#4e73df",
                yAxisID: "y"
            }, {
                type: "line",
                label: "Orders",
                data: countByLabel,
                borderColor: "#e74a3b",
                backgroundColor: "rgba(231,74,59,0.1)",
                fill: true,
                tension: 0.3,
                yAxisID: "y1"
            }, {
                type: "line",
                label: "Target sales",
                data: labels.map(() => target),
                borderColor: "#f6c23e",
                borderDash: [7, 5],
                pointRadius: 0,
                borderWidth: 2,
                fill: false,
                yAxisID: "y"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: {
                x: { ticks: { color: theme.text }, grid: { color: theme.grid } },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Revenue (₱)" },
                    ticks: {
                        color: theme.text,
                        callback: value => formatPeso(value)
                    },
                    grid: { color: theme.grid }
                },
                y1: {
                    beginAtZero: true,
                    position: "right",
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "Orders" },
                    ticks: { color: theme.text }
                }
            },
            plugins: { legend: { position: "top", labels: { color: theme.text } } }
        }
    });
}

// ── Category filter pills (Items Performance radar) ────────────────────────

function setupCategoryPills() {
    const container = document.querySelector(".category-pills");
    if (!container) return;

    const categories = [...new Set((allProducts || []).map(p => p.category || "Unknown"))];
    if (!activeRadarCategory || !categories.includes(activeRadarCategory)) {
        activeRadarCategory = categories[0] || "";
    }
    const key = categories.join("|");
    if (builtPillCategories === key) return;
    builtPillCategories = key;

    container.innerHTML = categories.map(category => `
        <button type="button" class="pill${category === activeRadarCategory ? " active" : ""}"
            data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
    `).join("");

    container.querySelectorAll(".pill").forEach(pill => {
        pill.addEventListener("click", () => {
            container.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            activeRadarCategory = pill.dataset.category;
            renderSalesCharts(latestOrders, allProducts);
        });
    });
}

// ── Sales Range Filter Tabs (Day / Week / Month / All) ─────────────────────
function setupSalesFilterTabs() {
    document.querySelectorAll(".filter-dropdown").forEach(dropdown => {
        const toggle = dropdown.querySelector(".filter-dropdown-toggle");
        const menu = dropdown.querySelector(".filter-dropdown-menu");
        if (!toggle || !menu) return;
        toggle.addEventListener("click", event => {
            event.stopPropagation();
            const isOpen = dropdown.classList.toggle("open");
            toggle.setAttribute("aria-expanded", String(isOpen));
            document.querySelectorAll(".filter-dropdown.open").forEach(other => {
                if (other !== dropdown) {
                    other.classList.remove("open");
                    other.querySelector(".filter-dropdown-toggle")?.setAttribute("aria-expanded", "false");
                }
            });
        });
    });
    document.addEventListener("click", () => {
        document.querySelectorAll(".filter-dropdown.open").forEach(dropdown => {
            dropdown.classList.remove("open");
            dropdown.querySelector(".filter-dropdown-toggle")?.setAttribute("aria-expanded", "false");
        });
    });
    document.querySelector(".all-sales-filter")?.addEventListener("click", event => {
        event.stopPropagation();
        salesFilterMode = "all";
        activeSalesRange = "all";
        Object.keys(activeSalesFilters).forEach(key => { activeSalesFilters[key] = []; });
        document.querySelectorAll(".filter-dropdown input").forEach(input => { input.checked = false; });
        document.querySelectorAll(".filter-dropdown").forEach(dropdown => {
            updateSalesFilterLabel(dropdown.dataset.filter);
        });
        document.querySelector(".all-sales-filter")?.classList.add("active");
        renderSalesCharts(latestOrders, allProducts);
        renderUsageChart(latestOrders);
    });
}

// ── Sales Calendar (month navigation + days with orders) ───────────────────

function setupCalendarControls() {
    const prevBtn    = document.getElementById("prevMonthBtn");
    const nextBtn    = document.getElementById("nextMonthBtn");
    const yearSelect = document.getElementById("yearSelect");

    if (!prevBtn || !nextBtn || !yearSelect) return;

    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 3; year <= currentYear + 1; year++) {
        const option = document.createElement("option");
        option.value = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    }

    prevBtn.addEventListener("click", () => {
        calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
        renderCalendar();
    });

    nextBtn.addEventListener("click", () => {
        calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
        renderCalendar();
    });

    yearSelect.addEventListener("change", () => {
        calendarViewDate.setFullYear(Number(yearSelect.value));
        renderCalendar();
    });

    renderCalendar();
}

function renderCalendar() {
    const monthDisplay = document.getElementById("monthDisplay");
    const yearSelect   = document.getElementById("yearSelect");
    const calendarGrid = document.getElementById("calendarGrid");
    if (!monthDisplay || !yearSelect || !calendarGrid) return;

    const year  = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const today = new Date();

    monthDisplay.textContent = calendarViewDate.toLocaleDateString("en-US", { month: "long" });
    yearSelect.value = year;

    const firstDay     = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();

    const ordersByDay = (latestOrders || []).reduce((acc, order) => {
        const date = new Date(order.date);
        if (date.getFullYear() === year && date.getMonth() === month) {
            const day = date.getDate();
            acc[day] = (acc[day] || 0) + 1;
        }
        return acc;
    }, {});

    let html = "";
    for (let i = 0; i < firstDay; i++) html += `<span></span>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const count = ordersByDay[day] || 0;
        const isToday = day === today.getDate()
            && month === today.getMonth()
            && year === today.getFullYear();
        html += `
            <div class="calendar-day${count ? " has-orders" : ""}${isToday ? " today" : ""}"
                 title="${count ? `${count} order(s)` : ""}">
                ${day}${count ? `<small>${count}</small>` : ""}
            </div>`;
    }

    calendarGrid.innerHTML = html;
}
