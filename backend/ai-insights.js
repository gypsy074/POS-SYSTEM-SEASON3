/* ==========================================================================
   ai-insights.js — in-house statistical "AI" for the POS.
   Pure, deterministic functions — no external APIs, no data leaves the server.

   Inputs: raw order/product/inventory/waste documents (plain objects).
   Output: { forecast, restock, wasteInsights, anomalies, meta }
   ========================================================================== */

const DAY_MS = 86400000;

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function dayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isCompleted(order) {
    return !order.status || String(order.status).toLowerCase() === 'completed';
}

function mean(values) {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values) {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1));
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Tomorrow's revenue forecast from a weighted moving average of daily
 * totals, adjusted by the target day-of-week's relative strength, plus a
 * confidence band from the series standard deviation.
 */
function forecastRevenue(dailyTotals, targetDayIndex, minDays = 7) {
    const days = Object.keys(dailyTotals).sort().map(k => dailyTotals[k]);
    if (days.length < minDays) return null;

    // Weight recent days more (linear decay, newest weight = n).
    let weightedSum = 0, weightTotal = 0;
    days.forEach((v, i) => {
        const w = i + 1;
        weightedSum += v * w;
        weightTotal += w;
    });
    const wma = weightedSum / weightTotal;

    // Day-of-week strength: today's weekday average vs overall average.
    const byDow = {};
    Object.keys(dailyTotals).forEach(k => {
        const dow = new Date(k).getDay();
        (byDow[dow] = byDow[dow] || []).push(dailyTotals[k]);
    });
    const overall = mean(days);
    const dowAvg = byDow[targetDayIndex] ? mean(byDow[targetDayIndex]) : 0;
    const dowFactor = overall > 0 && dowAvg > 0
        ? Math.min(1.5, Math.max(0.5, dowAvg / overall))
        : 1;

    const forecast = wma * dowFactor;
    const band = stddev(days) * 1.2;
    return {
        forecast: round2(forecast),
        low: round2(Math.max(0, forecast - band)),
        high: round2(forecast + band),
        confidence: days.length >= 21 ? 'high' : days.length >= 14 ? 'medium' : 'low'
    };
}

/**
 * Top items to prepare tomorrow: each item's share of total quantity sold
 * over the last 14 days, applied to the expected order count.
 */
function forecastTopItems(soldByItem, daysWithSales) {
    const totalQty = Object.values(soldByItem).reduce((a, b) => a + b, 0);
    if (!totalQty) return [];
    const expectedOrders = Math.max(1, Math.round(daysWithSales));
    return Object.entries(soldByItem)
        .map(([name, qty]) => ({ name, qty, expectedQty: Math.max(1, Math.round((qty / totalQty) * expectedOrders)) }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
}

/**
 * Smart restock: consumption rate (sales + waste) per item over 14 days,
 * days left from current stock, alerts for items running out within 3 days
 * or already below their low-stock threshold.
 */
function computeRestock(soldByItem, wastedByItem, products, inventoryByProduct) {
    const DAYS = 14;
    const out = [];
    const names = new Set([
        ...Object.keys(soldByItem),
        ...Object.keys(wastedByItem),
        ...products.map(p => String(p.name || '').trim()),
        ...Object.keys(inventoryByProduct)
    ]);

    names.forEach(name => {
        if (!name) return;
        const consumed = (soldByItem[name] || 0) + (wastedByItem[name] || 0);
        const dailyRate = consumed / DAYS;

        const product = products.find(p => String(p.name || '').trim() === name);
        const stock = product && product.stock !== undefined
            ? Number(product.stock)
            : (inventoryByProduct[name] !== undefined ? Number(inventoryByProduct[name]) : null);
        if (stock === null || stock === undefined || Number.isNaN(stock)) return;

        const threshold = product && product.lowStockThreshold !== undefined
            ? Number(product.lowStockThreshold)
            : 10;

        const daysLeft = dailyRate > 0 ? stock / dailyRate : Infinity;
        const low = daysLeft < 3 || stock < threshold;

        let suggestedOrder = 0;
        if (dailyRate > 0) {
            suggestedOrder = Math.max(0, Math.ceil(7 * dailyRate) - stock);
        } else if (stock < threshold) {
            suggestedOrder = Math.max(0, Math.ceil(threshold * 1.5) - stock);
        }

        if (low) {
            out.push({
                name,
                stock,
                threshold,
                dailyRate: round1(dailyRate),
                daysLeft: dailyRate > 0 ? round1(daysLeft) : null,
                suggestedOrder
            });
        }
    });

    out.sort((a, b) => {
        const al = a.daysLeft === null ? 999 : a.daysLeft;
        const bl = b.daysLeft === null ? 999 : b.daysLeft;
        return al - bl;
    });
    return out.slice(0, 8);
}

/**
 * Waste insights: per-item waste-vs-sold ratio over 14 days (flags above
 * 15%) and wasted cost by category.
 */
function computeWasteInsights(soldByItem, wastedByItem, wasteDocs) {
    const items = [];
    Object.keys(wastedByItem).forEach(name => {
        if (!name) return;
        const wastedQty = wastedByItem[name];
        const soldQty = soldByItem[name] || 0;
        if (wastedQty < 1) return;
        const ratio = soldQty > 0 ? wastedQty / soldQty : 1; // all waste, no sales → 100%
        if (ratio > 0.15) {
            items.push({ name, soldQty, wastedQty: round1(wastedQty), ratio: round2(ratio) });
        }
    });
    items.sort((a, b) => b.wastedQty - a.wastedQty);

    const byCategory = {};
    wasteDocs.forEach(w => {
        const cat = String(w.category || 'Uncategorized').trim() || 'Uncategorized';
        const cost = Number(w.totalCost) || (Number(w.quantity) || 0) * (Number(w.price) || 0);
        byCategory[cat] = (byCategory[cat] || 0) + cost;
    });
    const categories = Object.entries(byCategory)
        .map(([category, cost]) => ({ category, cost: round2(cost) }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

    return { items: items.slice(0, 8), categories };
}

/**
 * Anomaly detection:
 *  1. Void spikes — a day with far more voided orders than the baseline.
 *  2. Revenue drops — a day >40% below its same-weekday baseline.
 *  3. Large voids — 3+ voided orders over ₱500 in a week (likely mistakes/theft).
 *  4. Stock-outs — item with strong sales that suddenly stopped AND is at 0 stock.
 */
function computeAnomalies(orders, products) {
    const out = [];
    const now = new Date();
    const day = startOfDay(now);
    const days = [];
    for (let i = 0; i < 28; i++) days.push(new Date(day.getTime() - i * DAY_MS));

    const dailyVoids = {};
    const dailyRevenue = {};
    days.forEach(d => { dailyVoids[dayKey(d)] = 0; dailyRevenue[dayKey(d)] = 0; });

    let largeVoidsRecent = 0;
    orders.forEach(o => {
        const k = dayKey(o.date);
        if (dailyRevenue[k] === undefined) return;
        if (String(o.status || '').toLowerCase() === 'voided') {
            dailyVoids[k] = (dailyVoids[k] || 0) + 1;
            const recent = (now.getTime() - new Date(o.date).getTime()) <= 7 * DAY_MS;
            if (recent && Number(o.total) > 500) largeVoidsRecent++;
        } else {
            dailyRevenue[k] = (dailyRevenue[k] || 0) + Number(o.total) || 0;
        }
    });

    // 1) Void spikes — compare the last 7 days to days 8..28.
    const voidSeries = days.slice(0, 7).map(d => dailyVoids[dayKey(d)]);
    const voidBaseline = days.slice(7).map(d => dailyVoids[dayKey(d)]);
    const bMean = mean(voidBaseline);
    const bStd = stddev(voidBaseline);
    days.slice(0, 7).forEach((d, i) => {
        const count = voidSeries[i];
        if (count >= 3 && count > bMean + 2 * bStd) {
            out.push({
                type: 'void-spike',
                label: 'Unusual voiding',
                detail: `${dayKey(d)}: ${count} orders voided (baseline ${round1(bMean)}/day).`
            });
        }
    });

    // 2) Revenue drops — vs same weekday baseline from days 8..28.
    days.slice(0, 7).forEach(d => {
        const k = dayKey(d);
        const rev = dailyRevenue[k];
        const dow = d.getDay();
        const same = days.slice(7).filter(x => x.getDay() === dow).map(x => dailyRevenue[dayKey(x)]);
        const base = mean(same);
        if (base > 0 && rev < base * 0.6) {
            out.push({
                type: 'revenue-drop',
                label: 'Revenue drop',
                detail: `${k}: ₱${Math.round(rev)} vs typical ₱${Math.round(base)} on ${d.toLocaleDateString('en-US', { weekday: 'long' })}s.`
            });
        }
    });

    // 3) Large voids.
    if (largeVoidsRecent >= 3) {
        out.push({
            type: 'large-voids',
            label: 'Large voids this week',
            detail: `${largeVoidsRecent} order(s) over ₱500 were voided in the last 7 days — verify with the cashier.`
        });
    }

    // 4) Stock-outs: item with 15+ sales on day D, zero sales on D+1, stock 0.
    const soldByDay = {};
    orders.filter(isCompleted).forEach(o => {
        (o.items || []).forEach(it => {
            const k = dayKey(o.date);
            if (dailyRevenue[k] === undefined) return;
            const name = String(it.name || '').trim();
            if (!name) return;
            (soldByDay[name] = soldByDay[name] || {})[k] = (soldByDay[name][k] || 0) + (Number(it.quantity) || 0);
        });
    });
    products.forEach(p => {
        const name = String(p.name || '').trim();
        if (!name || Number(p.stock) !== 0) return;
        const byDay = soldByDay[name];
        if (!byDay) return;
        const keys = Object.keys(byDay).sort();
        for (let i = 0; i < keys.length - 1; i++) {
            const cur = keys[i], next = keys[i + 1];
            const diffMs = new Date(next).getTime() - new Date(cur).getTime();
            if (byDay[cur] >= 15 && byDay[next] === 0 && diffMs <= 3 * DAY_MS) {
                out.push({
                    type: 'stockout',
                    label: 'Possible stock-out',
                    detail: `${name}: ${byDay[cur]} sold on ${cur}, none after — stock is now 0.`
                });
                return;
            }
        }
    });

    return out.slice(0, 6);
}

function computeInsights({ orders, products, inventory, waste }) {
    const now = new Date();
    const start = new Date(now.getTime() - 28 * DAY_MS);

    const completed = (orders || []).filter(isCompleted);
    const last28 = completed.filter(o => new Date(o.date) >= start);
    const last14 = last28.filter(o => new Date(o.date) >= new Date(now.getTime() - 14 * DAY_MS));

    // Daily revenue series (last 28 days).
    const dailyTotals = {};
    last28.forEach(o => {
        const k = dayKey(o.date);
        dailyTotals[k] = (dailyTotals[k] || 0) + (Number(o.total) || 0);
    });

    // Item quantities sold (14 days) + waste quantities (14 days).
    const soldByItem = {};
    const wastedByItem = {};
    last14.forEach(o => {
        (o.items || []).forEach(it => {
            const name = String(it.name || '').trim();
            if (!name) return;
            soldByItem[name] = (soldByItem[name] || 0) + (Number(it.quantity) || 0);
        });
    });
    const wasteDocs = (waste || [])
        .filter(w => new Date(w.date) >= new Date(now.getTime() - 14 * DAY_MS));
    wasteDocs.forEach(w => {
        const name = String(w.productName || '').trim();
        if (!name) return;
        wastedByItem[name] = (wastedByItem[name] || 0) + (Number(w.quantity) || 0);
    });

    const tomorrow = new Date(now.getTime() + DAY_MS);
    const forecast = forecastRevenue(dailyTotals, tomorrow.getDay());
    const topItems = forecastTopItems(soldByItem, last14.length);

    const inventoryByProduct = {};
    (inventory || []).forEach(i => {
        const name = String(i.productName || '').trim();
        if (name) inventoryByProduct[name] = Number(i.stock);
    });

    const restock = computeRestock(soldByItem, wastedByItem, products || [], inventoryByProduct);
    const wasteInsights = computeWasteInsights(soldByItem, wastedByItem, wasteDocs);
    const anomalies = computeAnomalies(completed, products || []);

    const hasData = Object.keys(dailyTotals).length > 0 || restock.length > 0 || anomalies.length > 0;

    return {
        forecast,
        topItems,
        restock,
        wasteInsights,
        anomalies,
        meta: {
            generatedAt: now.toISOString(),
            hasData,
            daysAnalyzed: Object.keys(dailyTotals).length,
            ordersAnalyzed: last28.length
        }
    };
}

module.exports = { computeInsights, forecastRevenue, computeRestock, computeWasteInsights, computeAnomalies, dayKey };