/* ==========================================================================
   audit.js — Audit Log view module
    Handles: audit log fetch, date filtering, table render, Excel export.
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

const AUDIT_EXPORT_PAGE_SIZE = 1000;

async function fetchAllAuditForExport() {
    const from = document.getElementById("auditFrom")?.value || "";
    const to = document.getElementById("auditTo")?.value || "";
    const logs = [];
    let skip = 0;
    while (true) {
        const params = new URLSearchParams({
            limit: String(AUDIT_EXPORT_PAGE_SIZE),
            skip: String(skip),
            sort: "asc"
        });
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        const response = await apiFetch(`/api/audit?${params.toString()}`);
        if (!response.ok) throw new Error("Could not load the complete audit log.");
        const page = await response.json();
        logs.push(...page);
        if (page.length < AUDIT_EXPORT_PAGE_SIZE) return { logs, from, to };
        skip += page.length;
    }
}

function addAuditExportTable(workbook, logs) {
    const headers = ["Date/Time", "Action", "Actor", "Target ID", "Detail"];
    const rows = logs.map(entry => {
        const date = new Date(entry.date);
        return [
            Number.isNaN(date.getTime()) ? "" : date,
            String(entry.action || ""),
            String(entry.actor || ""),
            String(entry.targetId || ""),
            String(entry.detail || "")
        ];
    });
    const sheet = workbook.addWorksheet("Audit Log");
    sheet.columns = [{ width: 26 }, { width: 28 }, { width: 22 }, { width: 30 }, { width: 80 }];
    sheet.addTable({
        name: "AuditLogTable",
        ref: "A1",
        headerRow: true,
        totalsRow: false,
        style: { theme: "TableStyleMedium2", showRowStripes: true },
        columns: headers.map(header => ({ name: header, filterButton: true })),
        rows
    });
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF34423A" } };
    sheet.getColumn(1).numFmt = "yyyy-mm-dd hh:mm:ss";
    sheet.getColumn(4).numFmt = "@";
    return sheet;
}

async function exportAuditExcel() {
    const button = document.getElementById("exportAuditCsvBtn");
    if (!window.ExcelJS) {
        showToast("Excel export is unavailable. Check the internet connection and try again.", "error");
        return;
    }
    if (button) button.disabled = true;
    showToast("Preparing audit workbook…", "info");
    try {
        const { logs, from, to } = await fetchAllAuditForExport();
        if (!logs.length) {
            showToast("No audit entries found for the selected date range.", "info");
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Season 3 POS";
        workbook.created = new Date();
        addAuditExportTable(workbook, logs);

        const dateBounds = logs.reduce((bounds, entry) => {
            const time = new Date(entry.date).getTime();
            if (!Number.isFinite(time)) return bounds;
            bounds.min = Math.min(bounds.min, time);
            bounds.max = Math.max(bounds.max, time);
            return bounds;
        }, { min: Infinity, max: -Infinity });
        const info = workbook.addWorksheet("Export Info");
        info.addRows([
            ["Export Field", "Value"],
            ["Generated", new Date()],
            ["From Date", from || "All dates"],
            ["To Date", to || "All dates"],
            ["Rows Exported", logs.length],
            ["Earliest Entry", Number.isFinite(dateBounds.min) ? new Date(dateBounds.min) : ""],
            ["Latest Entry", Number.isFinite(dateBounds.max) ? new Date(dateBounds.max) : ""]
        ]);
        info.columns = [{ width: 24 }, { width: 42 }];
        info.views = [{ state: "frozen", ySplit: 1 }];
        info.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        info.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF34423A" } };
        [2, 6, 7].forEach(rowIndex => { info.getCell(`B${rowIndex}`).numFmt = "yyyy-mm-dd hh:mm:ss"; });

        const dictionary = workbook.addWorksheet("Data Dictionary");
        dictionary.addRows([
            ["Field", "Meaning"],
            ["Date/Time", "Date and time the event was recorded."],
            ["Action", "System action code, such as order.void or user.create."],
            ["Actor", "Username associated with the action."],
            ["Target ID", "Identifier of the record affected by the action, when available."],
            ["Detail", "Recorded description of the action; exported as text."]
        ]);
        dictionary.columns = [{ width: 24 }, { width: 90 }];
        dictionary.views = [{ state: "frozen", ySplit: 1 }];
        dictionary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        dictionary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF34423A" } };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `season3-audit-${from || "all"}-to-${to || "all"}-${localDateStamp()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`Audit workbook exported: ${logs.length} entries.`, "success");
    } catch (error) {
        console.error("Audit Excel export failed:", error);
        showToast(error.message || "Could not create the audit workbook.", "error");
    } finally {
        if (button) button.disabled = false;
    }
}

function setupAuditFilters() {
    const from = document.getElementById("auditFrom");
    const to = document.getElementById("auditTo");
    const exportBtn = document.getElementById("exportAuditCsvBtn");

    if (from) from.addEventListener("change", loadAuditData);
    if (to) to.addEventListener("change", loadAuditData);
    if (exportBtn) exportBtn.addEventListener("click", exportAuditExcel);
}
