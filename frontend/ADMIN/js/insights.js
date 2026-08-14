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
        </div>`;
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
        renderInsights(data);
        updateAiPillCount(data);
    } catch (err) {
        body.innerHTML = AI_ERROR_HTML;
        countEl.textContent = "–";
        countEl.classList.add("zero");
    }
}

function setAiPanelOpen(open) {
    const pill = document.getElementById("aiHeaderPill");
    if (!pill) return;
    pill.classList.toggle("open", open);
    pill.setAttribute("aria-expanded", open ? "true" : "false");
}

function setupAiHeaderPanel() {
    const pill = document.getElementById("aiHeaderPill");
    const closeBtn = document.getElementById("aiHeaderPanelClose");
    if (!pill) return;

    const toggle = () => setAiPanelOpen(!pill.classList.contains("open"));

    pill.addEventListener("click", event => {
        if (event.target.closest(".ai-header-panel-close") || event.target.closest(".ai-header-panel")) return;
        toggle();
    });

    if (closeBtn) closeBtn.addEventListener("click", event => {
        event.stopPropagation();
        setAiPanelOpen(false);
    });

    pill.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
        }
        if (event.key === "Escape") setAiPanelOpen(false);
    });

    document.addEventListener("click", event => {
        if (!pill.classList.contains("open")) return;
        if (!pill.contains(event.target)) setAiPanelOpen(false);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setAiPanelOpen(false);
    });
}