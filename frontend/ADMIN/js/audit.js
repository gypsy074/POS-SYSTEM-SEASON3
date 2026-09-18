/* ==========================================================================
   audit.js — Audit Log view module
   Handles: audit log fetch, date filtering, table render, CSV export.
   ========================================================================== */

let latestAudit = [];

async function loadAuditData() {
    try {
        const from = document.getElementById("auditFrom");
        const to = document.getElementById("auditTo");
        const params = new URLSearchParams();
        if (from && from.value) params.set("from", from.value);
        if (to && to.value) params.set("to", to.value);

        const query = params.toString();
        const response = await apiFetch(`/api/audit${query ? `?${query}` : ""}`);
        if (!response.ok) throw new Error("Failed to fetch audit log");

        const logs = await response.json();
        latestAudit = Array.isArray(logs) ? logs : [];
        renderAuditTable();
    } catch (err) {
        console.error("❌ Audit load error:", err);
    }
}

function renderAuditTable() {
    const tbody = document.getElementById("auditTableBody");
    if (!tbody) return;

    if (!latestAudit.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; color:#888; padding:22px;">
                    No audit entries found for the selected range.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = latestAudit.map(entry => `
        <tr>
            <td>${new Date(entry.date).toLocaleString()}</td>
            <td><span class="audit-action-badge">${escapeHtml(entry.action || "—")}</span></td>
            <td>${escapeHtml(entry.actor || "—")}</td>
            <td>${escapeHtml(entry.detail || "—")}</td>
        </tr>
    `).join("");
}

function exportAuditCsv() {
    if (!latestAudit.length) {
        showToast("No audit entries to export yet.", "info");
        return;
    }

    const rows = [["Date", "Action", "Actor", "Detail"]];
    latestAudit.forEach(entry => rows.push([
        new Date(entry.date).toLocaleString(),
        String(entry.action || ""),
        String(entry.actor || ""),
        String(entry.detail || "")
    ]));

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `season3-audit-${localDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function setupAuditFilters() {
    const from = document.getElementById("auditFrom");
    const to = document.getElementById("auditTo");
    const exportBtn = document.getElementById("exportAuditCsvBtn");

    if (from) from.addEventListener("change", loadAuditData);
    if (to) to.addEventListener("change", loadAuditData);
    if (exportBtn) exportBtn.addEventListener("click", exportAuditCsv);
}
