/* ==========================================================================
   settings.js — Owner email alerts settings panel
   Loads/saves the OwnerAlertSettings document via /api/settings/owner-alerts.
   ========================================================================== */

let ownerAlertSettings = null;

async function loadSettings() {
    const recipientsBox = document.getElementById("alertRecipients");
    const lowStockToggle = document.getElementById("lowStockToggle");
    const dailySummaryToggle = document.getElementById("dailySummaryToggle");
    const hourSelect = document.getElementById("dailySummaryHour");
    const statusLine = document.getElementById("smtpStatusLine");
    if (!recipientsBox) return;

    try {
        const response = await apiFetch("/api/settings/owner-alerts");
        if (!response.ok) throw new Error("Failed to load settings.");
        ownerAlertSettings = await response.json();

        recipientsBox.value = (ownerAlertSettings.recipients || []).join("\n");
        lowStockToggle.checked = Boolean(ownerAlertSettings.lowStockEnabled);
        dailySummaryToggle.checked = Boolean(ownerAlertSettings.dailySummaryEnabled);

        const currentHour = ownerAlertSettings.dailySummaryHour;
        hourSelect.innerHTML = "";
        for (let h = 0; h < 24; h++) {
            const option = document.createElement("option");
            option.value = h;
            option.textContent = `${String(h).padStart(2, "0")}:00`;
            if (h === currentHour) option.selected = true;
            hourSelect.appendChild(option);
        }

        if (statusLine) {
            statusLine.className = "settings-smtp-status " + (ownerAlertSettings.smtpConfigured ? "ok" : "err");
            statusLine.innerHTML = ownerAlertSettings.smtpConfigured
                ? '<i class="fas fa-check-circle"></i> Email sending is configured — alerts will be sent.'
                : '<i class="fas fa-exclamation-triangle"></i> Email sending is NOT configured — add SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY + EMAIL_FROM to the server environment.';
        }
    } catch (err) {
        console.error("❌ Load settings error:", err);
        if (statusLine) {
            statusLine.className = "settings-smtp-status err";
            statusLine.textContent = "Failed to load settings.";
        }
    }
}

function setupSettingsForm() {
    const saveBtn = document.getElementById("saveAlertSettingsBtn");
    const testBtn = document.getElementById("testAlertEmailBtn");

    saveBtn?.addEventListener("click", async () => {
        const recipientsBox = document.getElementById("alertRecipients");
        const lowStockToggle = document.getElementById("lowStockToggle");
        const dailySummaryToggle = document.getElementById("dailySummaryToggle");
        const hourSelect = document.getElementById("dailySummaryHour");

        const recipients = recipientsBox.value
            .split("\n")
            .map(e => e.trim())
            .filter(Boolean);

        if (!recipients.length) {
            showToast("Add at least one recipient email.", "warning");
            recipientsBox.focus();
            return;
        }
        if (recipients.length > 5) {
            showToast("Maximum of 5 recipient emails.", "warning");
            return;
        }
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (recipients.some(e => !emailRe.test(e))) {
            showToast("One or more recipient emails are invalid.", "warning");
            return;
        }

        try {
            const response = await apiFetch("/api/settings/owner-alerts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipients,
                    lowStockEnabled: lowStockToggle.checked,
                    dailySummaryEnabled: dailySummaryToggle.checked,
                    dailySummaryHour: Number(hourSelect.value)
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error || "Failed to save settings.");
            }
            ownerAlertSettings = await response.json();
            showToast("Alert settings saved!");
            loadSettings();
        } catch (err) {
            console.error("❌ Save settings error:", err);
            showToast("Failed to save settings: " + err.message, "error");
        }
    });

    testBtn?.addEventListener("click", async () => {
        testBtn.disabled = true;
        try {
            const response = await apiFetch("/api/settings/owner-alerts/test", {
                method: "POST"
            });
            if (response.ok) {
                showToast("Test email sent — check your inbox!");
                return;
            }
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || "Test email failed.");
        } catch (err) {
            console.error("❌ Test email error:", err);
            showToast("Test email failed: " + err.message, "error");
        } finally {
            testBtn.disabled = false;
        }
    });
}