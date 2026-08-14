/* ==========================================================================
   dashboard.js — Dashboard view module
   Handles: order data fetch, transaction table render, sales charts, calendar.
   ========================================================================== */

// ── Module State ─────────────────────────────────────────────────────────────
let currentSalesFilter = "Day";
let currentPillFilter = "Cs & Fs";
let calendarDate = new Date();

// ── Main Data Loader ─────────────────────────────────────────────────────────
async function loadLiveDashboardData() {
    try {
        const [ordersRes, productsRes] = await Promise.all([
            apiFetch("/api/orders"),
            apiFetch("/api/products")
        ]);

        if (!ordersRes.ok) throw new Error("Failed to load orders");
        if (!productsRes.ok) throw new Error("Failed to load products");

        const orders = await ordersRes.json();
        const products = await productsRes.json();

        latestOrders = orders;
        allProducts = products;

        // Dashboard counters
        const totalRevenueEl = document.getElementById("totalRevenue");
        const todaySalesCountEl = document.getElementById("todaySalesCount");

        if (totalRevenueEl) {
            const total = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
            totalRevenueEl.innerText = `\u20b1${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        }
        if (todaySalesCountEl) {
            const today = new Date().toLocaleDateString();
            const count = orders.filter(o => new Date(o.date).toLocaleDateString() === today).length;
            todaySalesCountEl.innerText = `${count} Orders`;
        }

        renderTransactionTable(orders);
        renderSalesCharts(orders, products);
        renderCalendar(orders);
        setupSalesChartControls(orders, products);
        setupItemsPillControls(orders, products);

    } catch (err) {
        console.error("\u274c Dashboard sync pipeline broken:", err);
    }
}

// ── Service Type Badge Helper ─────────────────────────────────────────────────
function getServiceBadge(mode) {
    if (!mode) return `<span class="service-type-badge service-badge-dine-in">Dine In</span>`;
    const lower = mode.toLowerCase();
    if (lower.includes("dine")) {
        return `<span class="service-type-badge service-badge-dine-in">Dine In</span>`;
    } else if (lower.includes("go") || lower.includes("take")) {
        return `<span class="service-type-badge service-badge-to-go">To Go</span>`;
    } else if (lower.includes("online")) {
        return `<span class="service-type-badge service-badge-online">Online Order</span>`;
    }
    return `<span class="service-type-badge service-badge-dine-in">${escapeHtml(mode)}</span>`;
}

// ── Transaction Table ─────────────────────────────────────────────────────────
function renderTransactionTable(orders) {
    const tbody = document.getElementById("transactionBody");
    if (!tbody) return;

    if (!orders.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:#aaa;">No transactions yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(order => `
        <tr>
            <td>${escapeHtml(order.customer)}</td>
            <td>${new Date(order.date).toLocaleString()}</td>
            <td>${escapeHtml(order.receiptId)}</td>
            <td>${escapeHtml((order.items || []).map(item => item.name).join(", "))}</td>
            <td>${getServiceBadge(order.mode)}</td>
            <td>\u20b1${Number(order.total || 0).toFixed(2)}</td>
        </tr>
    `).join("");
}

// ── Date Filter Helper ────────────────────────────────────────────────────────
function filterOrdersByPeriod(orders, period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return orders.filter(o => {
        const d = new Date(o.date);
        if (period === "Day") {
            return d >= today;
        } else if (period === "Week") {
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 6);
            return d >= weekAgo;
        } else if (period === "Month") {
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return true; // All
    });
}

// ── Sales Charts ──────────────────────────────────────────────────────────────
function renderSalesCharts(orders, products) {
    if (!window.Chart) return;

    const salesCanvas = document.getElementById("salesLineChart");
    const radarCanvas = document.getElementById("itemsRadarChart");
    if (!salesCanvas || !radarCanvas) return;

    const filtered = filterOrdersByPeriod(orders, currentSalesFilter);
    const dailyTotals = filtered.reduce((acc, order) => {
        const day = new Date(order.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        acc[day] = (acc[day] || 0) + Number(order.total || 0);
        return acc;
    }, {});

    const lineLabels = Object.keys(dailyTotals);
    const lineData = lineLabels.map(l => dailyTotals[l]);

    if (salesLineChart) salesLineChart.destroy();

    salesLineChart = new Chart(salesCanvas.getContext("2d"), {
        type: "line",
        data: {
            labels: lineLabels.length ? lineLabels : ["No data"],
            datasets: [{
                label: "Sales (\u20b1)",
                data: lineData.length ? lineData : [0],
                borderColor: "#a67c52",
                backgroundColor: "rgba(166,124,82,0.12)",
                fill: true,
                tension: 0.4,
                pointBackgroundColor: "#a67c52",
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `\u20b1${Number(ctx.parsed.y).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => `\u20b1${v.toLocaleString()}` }
                }
            }
        }
    });

    renderItemsChart(radarCanvas, products);
}

function renderItemsChart(canvas, products) {
    const pillMap = {
        "Cs & Fs": ["coffee", "frappe"],
        "RMs & Ps": ["rice", "pasta"],
        "Snacks": ["snack"]
    };

    const allowedKeys = currentPillFilter ? (pillMap[currentPillFilter] || null) : null;
    const filtered = allowedKeys
        ? products.filter(p => allowedKeys.some(k => (p.category || "").toLowerCase().includes(k)))
        : products;

    const categoryCounts = filtered.reduce((acc, p) => {
        const cat = p.category || "Unknown";
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
    }, {});

    const labels = Object.keys(categoryCounts);
    const data = labels.map(l => categoryCounts[l]);

    if (itemsRadarChart) itemsRadarChart.destroy();

    itemsRadarChart = new Chart(canvas.getContext("2d"), {
        type: "radar",
        data: {
            labels: labels.length ? labels : ["No data"],
            datasets: [{
                label: "Items by category",
                data: data.length ? data : [0],
                borderColor: "#a67c52",
                backgroundColor: "rgba(166,124,82,0.2)",
                pointBackgroundColor: "#a67c52"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

// ── Chart Filter Controls ─────────────────────────────────────────────────────
function setupSalesChartControls(orders, products) {
    document.querySelectorAll(".filter-tabs .tab").forEach(tab => {
        const fresh = tab.cloneNode(true);
        tab.parentNode.replaceChild(fresh, tab);
        fresh.addEventListener("click", () => {
            document.querySelectorAll(".filter-tabs .tab").forEach(t => t.classList.remove("active"));
            fresh.classList.add("active");
            currentSalesFilter = fresh.textContent.trim();
            renderSalesCharts(orders, products);
        });
    });
}

function setupItemsPillControls(orders, products) {
    document.querySelectorAll(".category-pills .pill").forEach(pill => {
        const fresh = pill.cloneNode(true);
        pill.parentNode.replaceChild(fresh, pill);
        fresh.addEventListener("click", () => {
            const wasActive = fresh.classList.contains("active");
            document.querySelectorAll(".category-pills .pill").forEach(p => p.classList.remove("active"));
            if (!wasActive) {
                fresh.classList.add("active");
                currentPillFilter = fresh.textContent.trim();
            } else {
                currentPillFilter = null;
            }
            const radarCanvas = document.getElementById("itemsRadarChart");
            if (radarCanvas) renderItemsChart(radarCanvas, products);
        });
    });
}

// ── Dynamic Calendar ──────────────────────────────────────────────────────────
function renderCalendar(orders) {
    const grid = document.getElementById("calendarGrid");
    const monthDisplay = document.getElementById("monthDisplay");
    const yearSelect = document.getElementById("yearSelect");
    const prevBtn = document.getElementById("prevMonthBtn");
    const nextBtn = document.getElementById("nextMonthBtn");

    if (!grid || !monthDisplay) return;

    // Populate year select once
    if (yearSelect && !yearSelect.dataset.populated) {
        yearSelect.dataset.populated = "1";
        const thisYear = new Date().getFullYear();
        for (let y = thisYear - 3; y <= thisYear + 1; y++) {
            const opt = document.createElement("option");
            opt.value = y;
            opt.textContent = y;
            if (y === calendarDate.getFullYear()) opt.selected = true;
            yearSelect.appendChild(opt);
        }
        yearSelect.addEventListener("change", () => {
            calendarDate.setFullYear(Number(yearSelect.value));
            renderCalendar(latestOrders);
        });
        if (prevBtn) prevBtn.addEventListener("click", () => {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            renderCalendar(latestOrders);
        });
        if (nextBtn) nextBtn.addEventListener("click", () => {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            renderCalendar(latestOrders);
        });
    }

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    monthDisplay.textContent = monthNames[calendarDate.getMonth()];
    if (yearSelect) yearSelect.value = calendarDate.getFullYear();

    // Build order map: day → total revenue
    const orderMap = {};
    const yr = calendarDate.getFullYear();
    const mo = calendarDate.getMonth();
    orders.forEach(o => {
        const d = new Date(o.date);
        if (d.getFullYear() === yr && d.getMonth() === mo) {
            const key = d.getDate();
            orderMap[key] = (orderMap[key] || 0) + Number(o.total || 0);
        }
    });

    const firstDay = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();
    const today = new Date();

    grid.innerHTML = "";

    // Blank cells before first day
    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement("div");
        grid.appendChild(blank);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = (today.getFullYear() === yr && today.getMonth() === mo && today.getDate() === day);
        const revenue = orderMap[day];
        const hasOrders = revenue !== undefined;

        const cell = document.createElement("div");
        cell.style.cssText = `
            width:32px; height:32px; margin:auto;
            border-radius:50%;
            display:flex; flex-direction:column;
            align-items:center; justify-content:center;
            font-size:0.8rem; font-weight:600;
            cursor:${hasOrders ? "pointer" : "default"};
            position:relative;
            background:${isToday ? "#a67c52" : "transparent"};
            color:${isToday ? "#fff" : "inherit"};
            border:${hasOrders && !isToday ? "2px solid #a67c52" : "none"};
            transition:background 0.2s;
        `;
        cell.textContent = day;

        if (hasOrders) {
            const dot = document.createElement("div");
            dot.style.cssText = `position:absolute;bottom:2px;width:5px;height:5px;border-radius:50%;background:${isToday ? "#fff" : "#a67c52"};`;
            cell.appendChild(dot);
            cell.title = `\u20b1${revenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
            cell.addEventListener("mouseenter", () => { if (!isToday) cell.style.background = "#f5e8da"; });
            cell.addEventListener("mouseleave", () => { if (!isToday) cell.style.background = "transparent"; });
        }

        grid.appendChild(cell);
    }
}


