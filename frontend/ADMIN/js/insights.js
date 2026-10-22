/* ========================================================================
   insights.js — local sales, restock, waste, and anomaly insights
   ======================================================================== */

let insightsLoading = false;

async function loadInsights() {
    if (insightsLoading) return;
    insightsLoading = true;

    try {
        const response = await apiFetch("/api/insights");
        if (!response.ok) throw new Error("Could not load local insights.");

        window.__aiInsightsData = await response.json();
        if (typeof renderNotifications === "function") renderNotifications();
        if (typeof renderDailySnapshot === "function") renderDailySnapshot();
    } catch (err) {
        console.error("Local insights load failed:", err);
    } finally {
        insightsLoading = false;
    }
}
