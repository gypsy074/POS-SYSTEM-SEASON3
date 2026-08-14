/* ==========================================================================
   ai-report.js — optional LLM business report (admin, free Gemini tier).
   Pure helpers (prompt builder + statistics fallback) and a guarded fetch
   to Google's free gemini-flash API. The prompt is anonymized by
   construction: it only contains aggregates (revenue, item quantities,
   category costs) — never customer or cashier names.

   Any failure (no AI_API_KEY, network, rate limit) returns null from
   fetchAiReport so callers can fall back to buildStatsReport.
   ========================================================================== */

const AI_MODEL = "gemini-2.0-flash";
const AI_TIMEOUT_MS = 20000;

function currency(n) {
    return `₱${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Compact, anonymized prompt from the insights payload.
 * Keep it small — the free tier is token-limited and the report is weekly.
 */
function buildReportPrompt(insights) {
    const lines = [];
    lines.push("You are a friendly business analyst for a small restaurant. Write a short weekly report (max 5 short paragraphs, plain text, no markdown headers) in casual but professional English. Cover: revenue outlook, best/worst items, restock priorities, waste problems, and anything suspicious. Be specific, actionable, and honest — if a section has no data, say so briefly.");

    const data = insights || {};
    if (data.forecast) {
        const f = data.forecast;
        lines.push(`- Tomorrow's expected revenue: ${currency(f.forecast)} (range ${currency(f.low)}-${currency(f.high)}).`);
    } else {
        lines.push("- Forecast: not enough sales history yet.");
    }
    if (data.topItems && data.topItems.length) {
        lines.push(`- Top items to prepare (expected quantities tomorrow): ${data.topItems.map(t => `${t.name} (${t.expectedQty})`).join(", ")}.`);
    }
    if (data.restock && data.restock.length) {
        lines.push(`- Restock alerts: ${data.restock.map(r => `${r.name}: ${r.stock} left, ~${r.daysLeft === null ? "no recent sales" : r.daysLeft + " days"} left, suggest ordering ${r.suggestedOrder}`).join("; ")}.`);
    } else {
        lines.push("- Restock: nothing running low.");
    }
    const w = data.wasteInsights || {};
    if (w.items && w.items.length) {
        lines.push(`- Over-preparation waste: ${w.items.map(i => `${i.name}: ${i.wastedQty} wasted vs ${i.soldQty} sold (${Math.round(i.ratio * 100)}%)`).join("; ")}.`);
    }
    if (w.categories && w.categories.length) {
        lines.push(`- Waste cost by category: ${w.categories.map(c => `${c.category} (${currency(c.cost)})`).join(", ")}.`);
    }
    if (data.anomalies && data.anomalies.length) {
        lines.push(`- Anomalies flagged: ${data.anomalies.map(a => `${a.label} — ${a.detail}`).join(" | ")}.`);
    } else {
        lines.push("- Anomalies: none detected.");
    }
    return lines.join("\n");
}

/**
 * Plain-language report built from the statistics — the fallback when the
 * LLM is unavailable. Same tone as the AI version, zero external calls.
 */
function buildStatsReport(insights) {
    const data = insights || {};
    const out = [];
    if (data.forecast) {
        const f = data.forecast;
        out.push(`Revenue outlook: expect around ${currency(f.forecast)} tomorrow (${currency(f.low)}-${currency(f.high)}).`);
    } else {
        out.push("Revenue outlook: not enough sales history yet.");
    }
    if (data.topItems && data.topItems.length) {
        out.push(`Top items to prepare: ${data.topItems.map(t => `${t.name} (about ${t.expectedQty})`).join(", ")}.`);
    }
    if (data.restock && data.restock.length) {
        out.push(`Restock needed soon: ${data.restock.map(r => `${r.name} (${r.stock} left, ${r.daysLeft === null ? "no recent sales" : "~" + r.daysLeft + " days left"}) — order ${r.suggestedOrder}`).join("; ")}.`);
    } else {
        out.push("Restock: nothing running low.");
    }
    const w = data.wasteInsights || {};
    if (w.items && w.items.length) {
        out.push(`Waste: ${w.items.map(i => `${i.name} wastes ${Math.round(i.ratio * 100)}% of what sells`).join("; ")}.`);
    } else {
        out.push("Waste: no over-preparation patterns.");
    }
    if (data.anomalies && data.anomalies.length) {
        out.push(`Watch out: ${data.anomalies.map(a => a.label.toLowerCase()).join(", ")}.`);
    } else {
        out.push("Anomalies: none detected.");
    }
    return out.join("\n");
}

/**
 * Server-side call to Google's free Gemini REST API.
 * Returns the trimmed text or null on any failure (no key, HTTP error,
 * empty response, timeout).
 */
async function fetchAiReport(prompt) {
    const key = process.env.AI_API_KEY;
    if (!key) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 700 }
            }),
            signal: AbortSignal.timeout(AI_TIMEOUT_MS)
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const parts = payload && payload.candidates && payload.candidates[0]
            && payload.candidates[0].content && payload.candidates[0].content.parts;
        const text = Array.isArray(parts)
            ? parts.map(p => p.text || "").join("")
            : "";
        return text.trim() ? text.trim() : null;
    } catch (err) {
        return null;
    }
}

module.exports = { buildReportPrompt, buildStatsReport, fetchAiReport };