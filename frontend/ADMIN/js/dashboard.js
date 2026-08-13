/* ==========================================================================
   dashboard.js — Dashboard view module
   Handles: order data fetch, transaction table render, sales charts.
   ========================================================================== */

let activeSalesRange = "day";
let calendarViewDate = new Date();

async function loadLiveDashboardData() {
    try {
        const response = await apiFetch("/api/orders");
        if (!response.ok) throw new Error("Network payload reading failed");

        const orders = await response.json();
        latestOrders = orders;

        const tableBody        = document.getElementById("transactionBody");
        const totalRevenueEl   = document.getElementById("totalRevenue");
        const todaySalesCountEl = document.getElementById("todaySalesCount");

        if (!tableBody || !totalRevenueEl || !todaySalesCountEl) return;

        renderTransactionTable(orders);

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

        renderUpdates();
        renderNotifications();

        renderSalesCharts(orders, allProducts);
        renderUsageChart(orders);
        renderCalendar();
    } catch (err) {
        console.error("❌ Dashboard sync pipeline broken:", err);
    }
}

// ── Updates Panel & Notification Feed ──────────────────────────────────────

function buildUpdates() {
    const updates = [];

    (allProducts || [])
        .filter(product => Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10))
        .slice(0, 3)
        .forEach(product => {
            updates.push({
                icon: "fa-box-open",
                flagged: true,
                title: `${product.status === "Out of Stock" ? "OUT OF STOCK" : "Low stock"} — ${product.name}`,
                sub: `${Number(product.stock ?? 0)} left · threshold ${Number(product.lowStockThreshold ?? 10)}`
            });
        });

    (latestWaste || []).slice(0, 3).forEach(waste => {
        updates.push({
            icon: "fa-recycle",
            flagged: true,
            title: `Waste logged — ${waste.productName}`,
            sub: `${waste.cashier || "—"} · ${waste.reason || "Other"} · Qty ${waste.quantity} · ₱${Number(waste.totalCost || 0).toFixed(2)} · ${new Date(waste.date).toLocaleString()}`
        });
    });

    (latestOrders || []).slice(0, 4).forEach(order => {
        updates.push({
            icon: "fa-clipboard-check",
            flagged: false,
            title: `${order.customer} placed an order`,
            sub: `${order.cashier || "—"} · ${order.receiptId} · ₱${Number(order.total || 0).toFixed(2)}`
        });
    });

    if (!updates.length) {
        updates.push({
            icon: "fa-circle-check",
            flagged: false,
            title: "No recent updates yet",
            sub: "Orders, waste events, and stock alerts will appear here"
        });
    }

    return updates.slice(0, 6);
}

function renderUpdates() {
    const updateList = document.getElementById("updateList");
    if (!updateList) return;

    updateList.innerHTML = buildUpdates().map(update => `
        <div class="update-item">
            <div class="update-avatar${update.flagged ? " update-avatar-danger" : ""}">
                <i class="fas ${update.icon}"></i>
            </div>
            <div class="update-text">
                <strong>${escapeHtml(update.title)}</strong>
                <span>${escapeHtml(update.sub)}</span>
            </div>
        </div>
    `).join("");
}

function renderNotifications() {
    const panel = document.getElementById("notificationDropdown");
    if (!panel) return;

    panel.innerHTML = buildUpdates().map(update => `
        <div class="notification-item${update.flagged ? " notification-item-danger" : ""}">
            <i class="fas ${update.icon}"></i>
            <div>
                <strong>${escapeHtml(update.title)}</strong>
                <span>${escapeHtml(update.sub)}</span>
            </div>
        </div>
    `).join("");

    const badge = document.getElementById("notificationBadge");
    if (badge) {
        const lowStockCount = (allProducts || []).filter(product =>
            Number(product.stock ?? 0) <= Number(product.lowStockThreshold ?? 10)
        ).length;
        if (lowStockCount > 0) {
            badge.textContent = lowStockCount;
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }
}

// ── CSV Export (Sales Analytics) ───────────────────────────────────────────

function exportSalesCsv() {
    const orders = latestOrders || [];
    if (!orders.length) {
        alert("No orders to export yet.");
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

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `season3-sales-${activeSalesRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ── Waste Food Panel (view + remove) ───────────────────────────────────────

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

function renderWasteTable() {
    const tbody = document.getElementById("wasteTableBody");
    if (!tbody) return;

    const waste = latestWaste || [];

    const totalEl = document.getElementById("wasteTotalCost");
    if (totalEl) {
        const total = waste.reduce((sum, entry) => sum + Number(entry.totalCost || 0), 0);
        totalEl.innerText = `Total Waste: ₱${total.toFixed(2)}`;
    }

    if (!waste.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; color:#888; padding:22px;">
                    No food waste logged. Everything looks great!
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
            if (!confirm("Remove this waste entry from the record?")) return;
            await removeWasteEntry(entryId);
        });
    });
}

async function removeWasteEntry(entryId) {
    try {
        const response = await apiFetch(`/api/waste/${entryId}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Failed to delete waste entry");

        await Promise.all([loadWasteData(), loadLiveDashboardData()]);
    } catch (err) {
        console.error("❌ Waste removal error:", err);
        alert("Failed to remove the waste entry.");
    }
}

function renderTransactionTable(orders) {
    const tbody = document.getElementById("transactionBody");
    if (!tbody) return;

    tbody.innerHTML = orders.map(order => {
        const isVoided = order.status === "Voided";
        return `
        <tr class="${isVoided ? "voided-row" : ""}">
            <td>${escapeHtml(order.customer)}</td>
            <td>${escapeHtml(order.cashier || "—")}</td>
            <td>${new Date(order.date).toLocaleString()}</td>
            <td>${escapeHtml(order.receiptId)}${isVoided ? ' <span class="voided-badge">VOIDED</span>' : ""}</td>
            <td>${escapeHtml((order.items || []).map(item => item.name).join(", "))}</td>
            <td>₱${Number(order.total || 0).toFixed(2)}</td>
        </tr>
    `;
    }).join("");
}

function renderSalesCharts(orders, products, range = activeSalesRange) {
    if (!window.Chart) return;

    const salesCanvas = document.getElementById("salesLineChart");
    const radarCanvas = document.getElementById("itemsRadarChart");
    if (!salesCanvas || !radarCanvas) return;

    // --- Line chart: daily revenue ---
    const dailyTotals = orders.reduce((acc, order) => {
        if (order.status === "Voided") return acc;
        const day = new Date(order.date).toLocaleDateString();
        acc[day] = (acc[day] || 0) + Number(order.total || 0);
        return acc;
    }, {});

    const allDays = Object.keys(dailyTotals);
    const rangeLimit = { day: 7, week: 28, month: 90, all: Infinity }[range] || 7;
    const lineLabels = allDays.slice(-rangeLimit);
    const lineData   = lineLabels.map(label => dailyTotals[label]);

    if (salesLineChart) salesLineChart.destroy();

    salesLineChart = new Chart(salesCanvas, {
        type: "line",
        data: {
            labels: lineLabels,
            datasets: [{
                label: "Sales",
                data: lineData,
                borderColor: "#4e73df",
                backgroundColor: "rgba(78,115,223,0.1)",
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });

    // --- Radar chart: items sold by category (from real orders) ---
    const categoryByProduct = (products || []).reduce((map, product) => {
        map[product.name] = product.category || "Unknown";
        return map;
    }, {});

    const categoryCounts = (orders || []).reduce((acc, order) => {
        (order.items || []).forEach(item => {
            const category = categoryByProduct[item.name] || item.category || "Unknown";
            acc[category] = (acc[category] || 0) + Number(item.quantity || 0);
        });
        return acc;
    }, {});

    if (Object.keys(categoryCounts).length === 0) {
        (products || []).forEach(product => {
            const category = product.category || "Unknown";
            categoryCounts[category] = (categoryCounts[category] || 0);
        });
    }

    const radarLabels = Object.keys(categoryCounts);
    const radarData   = radarLabels.map(label => categoryCounts[label]);

    if (itemsRadarChart) itemsRadarChart.destroy();

    itemsRadarChart = new Chart(radarCanvas, {
        type: "radar",
        data: {
            labels: radarLabels,
            datasets: [{
                label: "Items by category",
                data: radarData,
                borderColor: "#4e73df",
                backgroundColor: "rgba(78,115,223,0.2)",
                pointBackgroundColor: "#4e73df"
            }]
        },
        options: {
            responsive: true,
            scales: { r: { beginAtZero: true } }
        }
    });
}

// ── Orders & Revenue bar chart (usage analytics) ──────────────────────────

function renderUsageChart(orders, range = activeSalesRange) {
    if (!window.Chart) return;

    const usageCanvas = document.getElementById("usageBarChart");
    if (!usageCanvas) return;

    const dailyRevenue = {};
    const dailyCount   = {};
    (orders || []).forEach(order => {
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
        (orders || []).forEach(order => {
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
            }]
        },
        options: {
            responsive: true,
            interaction: { mode: "index", intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Revenue (₱)" }
                },
                y1: {
                    beginAtZero: true,
                    position: "right",
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "Orders" }
                }
            },
            plugins: { legend: { position: "top" } }
        }
    });
}

// ── Sales Range Filter Tabs (Day / Week / Month / All) ─────────────────────

function setupSalesFilterTabs() {
    const tabs = document.querySelectorAll(".filter-tabs .tab");
    if (!tabs.length) return;

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            activeSalesRange = tab.textContent.trim().toLowerCase();
            renderSalesCharts(latestOrders, allProducts);
            renderUsageChart(latestOrders);
        });
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
