/* ==========================================================================
   insights.js — AI Insights (in-house statistics, admin header)
   Renders compact forecast / restock / waste / anomaly cards into the
   header dropdown panel (#aiHeaderPanelBody) and keeps the pill count
   (#aiPillCount) updated. Every failure degrades to a quiet empty state.
   ========================================================================== */

const AI_LOADING_HTML = `
    <div class="ai-card">
        <div class="ai-card-header"><i class="fas fa-robot"></i> Computing…</div>
        <div class="ai-skeleton-line"></div>
        <div class="ai-skeleton-line" style="width: 70%;"></div>
    </div>`;

const AI_ERROR_HTML = `
    <div class="ai-card">
        <div class="ai-card-header"><i class="fas fa-robot"></i> AI Insights</div>
        <p class="ai-empty">Insights are unavailable right now. Pull the refresh button to try again.</p>
    </div>`;

function aiPeso(value) {
    return `₱${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function aiEmpty(text) {
    return `<p class="ai-empty">${text}</p>`;
}

function renderForecastCard(data) {
    if (!data.forecast) return `<p class="ai-empty">Not enough sales data yet — keep selling and check back in a few days.</p>`;
    const f = data.forecast;
    const chips = (data.topItems || []).slice(0, 5)
        .map(t => `<span class="ai-chip" title="${t.qty} sold in 14 days"><i class="fas fa-utensils"></i> ${t.name} · ${t.expectedQty}</span>`)
        .join("");
    return `
        <div class="ai-forecast-value">${aiPeso(f.forecast)} <span class="ai-forecast-range">(${aiPeso(f.low)} – ${aiPeso(f.high)})</span></div>
        <p class="ai-card-sub">Expected revenue tomorrow</p>
        ${chips ? `<div class="ai-chip-row"><span class="ai-chip-label">Top items to prepare</span>${chips}</div>` : ""}
    `;
}

function renderRestockCard(items) {
    if (!items.length) return `<p class="ai-empty">No items running low — stock looks healthy.</p>`;
    return `<ul class="ai-list">${items.map(it => `
        <li>
            <div class="ai-list-main"><strong>${it.name}</strong>
                <span class="ai-list-meta">${it.daysLeft !== null
                    ? `${it.stock} left · ~${it.daysLeft} day${it.daysLeft === 1 ? "" : "s"}`
                    : `${it.stock} left · no recent sales`}</span>
            </div>
            <span class="ai-list-action">Order ${it.suggestedOrder}</span>
        </li>`).join("")}</ul>`;
}

function renderWasteCard(data) {
    if (!data.items.length && !data.categories.length) return `<p class="ai-empty">No waste patterns to report.</p>`;
    const parts = [];
    if (data.items.length) {
        parts.push(`<ul class="ai-list">${data.items.map(it => `
            <li>
                <div class="ai-list-main"><strong>${it.name}</strong>
                    <span class="ai-list-meta">${it.wastedQty} wasted vs ${it.soldQty} sold (${Math.round(it.ratio * 100)}%)</span>
                </div>
                <span class="ai-list-action ai-warn">Over-preparing</span>
            </li>`).join("")}</ul>`);
    }
    if (data.categories.length) {
        parts.push(`<div class="ai-chip-row">${data.categories.map(c =>
            `<span class="ai-chip"><i class="fas fa-tag"></i> ${c.category} · ${aiPeso(c.cost)} wasted</span>`).join("")}</div>`);
    }
    return parts.join("");
}

function renderAnomaliesCard(items) {
    if (!items.length) return `<p class="ai-empty">No anomalies detected — everything looks normal.</p>`;
    return `<ul class="ai-list">${items.map(a => `
        <li class="ai-anomaly">
            <div class="ai-list-main"><strong>${a.label}</strong>
                <span class="ai-list-meta">${a.detail}</span>
            </div>
            <i class="fas fa-circle-exclamation ai-list-icon"></i>
        </li>`).join("")}</ul>`;
}

function renderInsights(data) {
    const body = document.getElementById("aiHeaderPanelBody");
    if (!body) return;
    body.innerHTML = `
        <div class="ai-card">
            <div class="ai-card-header"><i class="fas fa-chart-line"></i> Tomorrow's Forecast</div>
            <div class="ai-card-body">${renderForecastCard(data)}</div>
        </div>
        <div class="ai-card">
            <div class="ai-card-header"><i class="fas fa-boxes-stacked"></i> Restock Alerts</div>
            <div class="ai-card-body">${renderRestockCard(data.restock || [])}</div>
        </div>
        <div class="ai-card">
            <div class="ai-card-header"><i class="fas fa-recycle"></i> Waste Insights</div>
            <div class="ai-card-body">${renderWasteCard(data.wasteInsights || { items: [], categories: [] })}</div>
        </div>
        <div class="ai-card">
            <div class="ai-card-header"><i class="fas fa-exclamation-triangle"></i> Anomalies</div>
            <div class="ai-card-body">${renderAnomaliesCard(data.anomalies || [])}</div>
        </div>
        ${renderAiReportCard()}`;
    if (aiLastReport) fillAiReportCard(aiLastReport);
}

let aiLastReport = null;
let aiReportBusy = false;
// The panel must NOT close while the report is generating — the AI call can
// take up to 20s, far beyond the 1.2s ghost-tap window, so a delayed ghost
// click on the pill would otherwise close the panel mid-generation.
let aiPanelLock = false;

function renderAiReportCard() {
    const busy = aiReportBusy;
    return `
        <div class="ai-card">
            <div class="ai-card-header"><i class="fas fa-wand-magic-sparkles"></i> Weekly AI Report</div>
            <div class="ai-card-body">
                <button type="button" class="ai-report-btn${busy ? " busy" : ""}" id="aiReportBtn" aria-busy="${busy}" ${busy ? "disabled" : ""}>
                    ${busy
                        ? '<i class="fas fa-spinner fa-spin"></i> Writing report…'
                        : '<i class="fas fa-file-lines"></i> Generate report'}
                </button>
                <div class="ai-report-text" id="aiReportText" hidden></div>
            </div>
        </div>`;
}

function fillAiReportCard(report) {
    const textEl = document.getElementById("aiReportText");
    if (!textEl) return;
    const icon = report.source === "ai" ? "fa-wand-magic-sparkles" : "fa-calculator";
    const label = report.source === "ai" ? "Generated by AI" : "Statistics summary";
    textEl.innerHTML = `
        <p class="ai-report-source"><i class="fas ${icon}"></i> ${label} · ${escapeHtml(report.at)}</p>
        <p>${escapeHtml(report.text)}</p>`;
    textEl.hidden = false;
}

async function generateAiReport() {
    const btn = document.getElementById("aiReportBtn");
    if (!btn || aiReportBusy) return;
    aiReportBusy = true;
    // Lock the panel open for the entire generation — even if the AI call
    // takes the full 20s timeout, no tap may close it.
    aiPanelLock = true;
    aiTapGuardUntil = Date.now() + 1200;
    btn.setAttribute("aria-busy", "true");
    // Note: never set btn.disabled here — mobile browsers re-fire the click on
    // body when a button disables itself mid-tap, and that ghost click would
    // close the panel via the outside-click handler.
    btn.classList.add("busy");
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Writing report…';
    let report;
    try {
        const response = await apiFetch("/api/ai/report", { method: "POST" });
        if (!response.ok) throw new Error("Report request failed");
        const data = await response.json();
        report = {
            text: data.report,
            source: data.source === "ai" ? "ai" : "stats",
            at: new Date().toLocaleString()
        };
    } catch (err) {
        report = {
            text: "The AI report is unavailable right now. Check the connection and try again in a moment.",
            source: "stats",
            at: new Date().toLocaleString()
        };
    }
    aiLastReport = report;
    aiReportBusy = false;
    if (btn.isConnected) {
        btn.setAttribute("aria-busy", "false");
        btn.classList.remove("busy");
        btn.innerHTML = '<i class="fas fa-file-lines"></i> Generate report';
    }
    fillAiReportCard(report);
    // Trailing grace: stay locked briefly so delayed ghost clicks from the
    // original tap can't slam the panel shut right after the report lands.
    aiTapGuardUntil = Date.now() + 1500;
    setTimeout(() => { aiPanelLock = false; }, 1500);
}

function updateAiPillCount(data) {
    const countEl = document.getElementById("aiPillCount");
    if (!countEl) return;
    const count = (data.restock || []).length
        + ((data.wasteInsights && data.wasteInsights.items) || []).length
        + (data.anomalies || []).length;
    countEl.textContent = String(count);
    countEl.classList.toggle("zero", count === 0);
}

async function loadInsights() {
    const body = document.getElementById("aiHeaderPanelBody");
    const countEl = document.getElementById("aiPillCount");
    if (!body || !countEl) return;
    body.innerHTML = AI_LOADING_HTML;
    countEl.textContent = "–";
    countEl.classList.remove("zero");
    try {
        const response = await apiFetch("/api/insights");
        if (!response.ok) throw new Error("Network payload reading failed");
        const data = await response.json();
        window.__aiInsightsData = data;
        renderInsights(data);
        updateAiPillCount(data);
        if (typeof renderNotifications === "function") renderNotifications();
        if (typeof renderDailySnapshot === "function") renderDailySnapshot();
    } catch (err) {
        body.innerHTML = AI_ERROR_HTML;
        countEl.textContent = "–";
        countEl.classList.add("zero");
    }
}

let aiPanelCloseTimer = null;
// Suppression window after tapping Generate report: mobile browsers re-fire
// the tap ("ghost click") onto the element now under the finger — which can be
// the html root or the pill itself — and we must not treat that as "outside".
let aiTapGuardUntil = 0;

function aiTapGuarded() {
    // While the report is generating (or just finished) no tap may close the
    // panel — covers delayed/late ghost clicks and stray touches.
    return aiPanelLock || aiReportBusy || Date.now() < aiTapGuardUntil;
}

function setAiPanelOpen(open) {
    const pill = document.getElementById("aiHeaderPill");
    if (!pill) return;
    if (aiPanelCloseTimer) {
        clearTimeout(aiPanelCloseTimer);
        aiPanelCloseTimer = null;
    }
    pill.classList.remove("closing");
    if (open) {
        pill.classList.add("open");
        pill.setAttribute("aria-expanded", "true");
        // The header's hide-transform re-anchors the fixed panel offscreen —
        // make sure it's visible whenever the panel is open.
        const header = document.querySelector(".admin-header");
        if (header) header.classList.remove("header-hidden");
    } else if (pill.classList.contains("open")) {
        // Play the exit animation, then really hide
        pill.classList.add("closing");
        aiPanelCloseTimer = setTimeout(() => {
            aiPanelCloseTimer = null;
            pill.classList.remove("closing", "open");
            pill.setAttribute("aria-expanded", "false");
        }, 230);
    }
}

function setupAiHeaderPanel() {
    const pill = document.getElementById("aiHeaderPill");
    const closeBtn = document.getElementById("aiHeaderPanelClose");
    if (!pill) return;

    const toggle = () => setAiPanelOpen(!pill.classList.contains("open"));

    pill.addEventListener("click", event => {
        if (aiTapGuarded()) return; // redirected ghost tap — ignore
        if (event.target.closest(".ai-header-panel-close") || event.target.closest(".ai-header-panel")) return;
        toggle();
    });

    if (closeBtn) closeBtn.addEventListener("click", event => {
        event.stopPropagation();
        if (aiTapGuarded()) return; // ghost tap landing on the close button — ignore
        setAiPanelOpen(false);
    });

    const panelBody = document.getElementById("aiHeaderPanelBody");
    if (panelBody) panelBody.addEventListener("click", event => {
        const btn = event.target.closest("#aiReportBtn");
        if (btn && btn.isConnected) generateAiReport();
    });

    pill.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
        }
        if (event.key === "Escape") setAiPanelOpen(false);
    });

    document.addEventListener("click", event => {
        if (aiTapGuarded()) return; // redirected ghost tap — ignore
        if (!pill.classList.contains("open")) return;
        if (!event.target.isConnected) return; // stale target from a re-render — ignore
        // Mobile browsers redirect a tap onto body/document when the tapped
        // element changes mid-tap — never treat that as an outside click.
        if (event.target === document || event.target === document.body) return;
        if (!pill.contains(event.target)) setAiPanelOpen(false);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setAiPanelOpen(false);
    });
}