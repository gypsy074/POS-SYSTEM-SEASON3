/* ==========================================================================
   dashboard.js — Dashboard view module
   Handles: order data fetch, transaction table render, sales charts.
   ========================================================================== */

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

        const revenueAccumulator = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
        totalRevenueEl.innerText = `₱${revenueAccumulator.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        todaySalesCountEl.innerText = `${orders.length} Orders`;

        renderSalesCharts(orders, allProducts);
    } catch (err) {
        console.error("❌ Dashboard sync pipeline broken:", err);
    }
}

function renderTransactionTable(orders) {
    const tbody = document.getElementById("transactionBody");
    if (!tbody) return;

    tbody.innerHTML = orders.map(order => `
        <tr>
            <td>${escapeHtml(order.customer)}</td>
            <td>${new Date(order.date).toLocaleString()}</td>
            <td>${escapeHtml(order.receiptId)}</td>
            <td>${escapeHtml((order.items || []).map(item => item.name).join(", "))}</td>
            <td>₱${Number(order.total || 0).toFixed(2)}</td>
        </tr>
    `).join("");
}

function renderSalesCharts(orders, products) {
    if (!window.Chart) return;

    const salesCanvas = document.getElementById("salesLineChart");
    const radarCanvas = document.getElementById("itemsRadarChart");
    if (!salesCanvas || !radarCanvas) return;

    // --- Line chart: daily revenue ---
    const dailyTotals = orders.reduce((acc, order) => {
        const day = new Date(order.date).toLocaleDateString();
        acc[day] = (acc[day] || 0) + Number(order.total || 0);
        return acc;
    }, {});

    const lineLabels = Object.keys(dailyTotals).slice(-7);
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

    // --- Radar chart: items by category ---
    const categoryCounts = products.reduce((acc, product) => {
        const category = product.category || "Unknown";
        acc[category] = (acc[category] || 0) + 1;
        return acc;
    }, {});

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
