/* ==========================================================================
   account.js — Shared "My Account" module (admin + cashier)
   - New sign-in detection banner
   - Active sessions list with per-session log out
   - "Log out all other sessions"
   - Self-service password change (revokes other sessions on success)
   Rendered styles are injected here so no CSS file changes are needed.
   ========================================================================== */
(function () {
    "use strict";

    if (window.__accountPanelLoaded) return;
    window.__accountPanelLoaded = true;

    // ── Styles ────────────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
#accountBanner{position:sticky;top:0;z-index:900;display:none;align-items:center;gap:10px;
    background:#fff7e6;border-bottom:1px solid #f5c26b;color:#6b4a12;
    padding:10px 16px;font-size:13px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,.06)}
#accountBanner i{color:#d97706;font-size:15px}
#accountBanner strong{font-weight:700}
#accountBanner .banner-actions{margin-left:auto;display:flex;gap:8px}
#accountBanner button{background:#d97706;color:#fff;border:0;border-radius:6px;
    padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
#accountBanner button.ghost{background:transparent;color:#6b4a12;border:1px solid #e0a74c;padding:5px 10px}
#accountBanner button.plain{background:none;border:0;color:#999;cursor:pointer;font-size:16px;line-height:1}
.account-modal-overlay{position:fixed;inset:0;background:rgba(10,12,20,.55);z-index:1200;
    display:none;align-items:center;justify-content:center;padding:16px}
.account-modal-overlay.open{display:flex}
.account-modal{background:#fff;border-radius:14px;width:100%;max-width:520px;max-height:85vh;
    display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.account-modal-head{display:flex;align-items:center;justify-content:space-between;
    padding:16px 20px;border-bottom:1px solid #eef0f4}
.account-modal-head h3{margin:0;font-size:16px;color:#1a2233}
.account-modal-close{background:none;border:0;font-size:20px;color:#8a93a5;cursor:pointer;line-height:1}
.account-tabs{display:flex;gap:4px;padding:10px 20px 0;border-bottom:1px solid #eef0f4}
.account-tabs button{background:none;border:0;padding:9px 14px;font-size:13px;font-weight:600;
    color:#8a93a5;cursor:pointer;border-bottom:2px solid transparent}
.account-tabs button.active{color:#d97706;border-bottom-color:#d97706}
.account-tab-body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
.account-tab-body[hidden]{display:none}
.account-danger{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;
    padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer}
.account-danger:hover{background:#fecaca}
.account-primary{background:#d97706;color:#fff;border:0;border-radius:8px;padding:10px 14px;
    font-size:13px;font-weight:700;cursor:pointer}
.account-primary:hover{background:#b45309}
.account-primary:disabled{opacity:.5;cursor:not-allowed}
.account-session-row{display:flex;align-items:center;gap:12px;padding:11px 12px;
    border:1px solid #eef0f4;border-radius:10px}
.account-session-row .acct-icon{width:36px;height:36px;border-radius:9px;flex:0 0 36px;
    background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;font-size:15px}
.account-session-row .acct-meta{flex:1;min-width:0}
.account-session-row .acct-device{font-size:13px;font-weight:600;color:#1a2233}
.account-session-row .acct-sub{font-size:11.5px;color:#8a93a5;margin-top:2px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
.account-session-row .acct-badge{font-size:10.5px;font-weight:700;color:#15803d;background:#dcfce7;
    border-radius:99px;padding:3px 8px;flex:0 0 auto}
.account-session-row button.acct-kill{background:none;border:1px solid #fecaca;color:#b91c1c;
    border-radius:7px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;flex:0 0 auto}
.account-session-row button.acct-kill:hover{background:#fee2e2}
.account-empty{font-size:12.5px;color:#8a93a5;text-align:center;padding:14px 0}
.account-field{display:flex;flex-direction:column;gap:5px}
.account-field label{font-size:12px;font-weight:600;color:#475569}
.account-field input{border:1px solid #d7dce4;border-radius:8px;padding:9px 11px;font-size:13px;
    outline:none}
.account-field input:focus{border-color:#d97706;box-shadow:0 0 0 3px rgba(217,119,6,.15)}
.account-msg{font-size:12.5px;border-radius:8px;padding:9px 11px;display:none}
.account-msg.ok{display:block;background:#dcfce7;color:#15803d}
.account-msg.err{display:block;background:#fee2e2;color:#b91c1c}
[data-theme="dark"] .account-modal{background:#1e2433}
[data-theme="dark"] .account-modal-head{border-color:#2a3247}
[data-theme="dark"] .account-modal-head h3{color:#e8ecf4}
[data-theme="dark"] .account-tabs{border-color:#2a3247}
[data-theme="dark"] .account-session-row{border-color:#2a3247}
[data-theme="dark"] .account-session-row .acct-icon{background:#2a3247;color:#cbd5e1}
[data-theme="dark"] .account-session-row .acct-device{color:#e8ecf4}
[data-theme="dark"] .account-field input{background:#161b28;border-color:#2a3247;color:#e8ecf4}
[data-theme="dark"] .account-close-x{color:#8a93a5}`;

    document.head.appendChild(style);

    // ── Helpers ──────────────────────────────────────────────────────────
    function fmtTime(d) {
        try { return new Date(d).toLocaleString(); } catch (e) { return ""; }
    }

    function deviceLabel(ua) {
        const s = String(ua || "").toLowerCase();
        let os = "Unknown device";
        if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) os = "Apple mobile";
        else if (s.includes("android")) os = "Android";
        else if (s.includes("windows")) os = "Windows";
        else if (s.includes("mac os")) os = "Mac";
        else if (s.includes("linux")) os = "Linux";
        let browser = "";
        if (s.includes("edg/")) browser = "Edge";
        else if (s.includes("chrome")) browser = "Chrome";
        else if (s.includes("firefox")) browser = "Firefox";
        else if (s.includes("safari")) browser = "Safari";
        return browser ? `${browser} · ${os}` : os;
    }

    // account.js runs on both apps — each stores its own session keys.
    const isAdminApp = window.location.pathname.includes("/ADMIN/");
    const tokenKey = isAdminApp ? "posAdminToken" : "posToken";
    const userKey = isAdminApp ? "posAdminUser" : "posUser";

    async function api(path, options) {
        if (typeof window.apiFetch === "function") return window.apiFetch(path, options);
        const res = await fetch(path, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem(tokenKey) || ""}`,
                ...(options && options.headers ? options.headers : {})
            }
        });
        if (res.status === 401 && !path.includes("/api/login")) {
            localStorage.removeItem(tokenKey);
            localStorage.removeItem(userKey);
            window.location.href = "../login.html";
        }
        return res;
    }

    // ── State ────────────────────────────────────────────────────────────
    let sessions = [];
    let lastAlertedJti = null;

    // ── Alert sound (browser-generated tones — no audio files needed) ────
    let alertAudioCtx = null;

    function getAlertAudioContext() {
        if (!alertAudioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) {
                alertAudioCtx = new Ctx();
                // Browsers block audio until the first user gesture — unlock then.
                const resume = () => {
                    if (alertAudioCtx && alertAudioCtx.state === "suspended") {
                        alertAudioCtx.resume().catch(() => {});
                    }
                };
                document.addEventListener("pointerdown", resume, { once: true });
                document.addEventListener("keydown", resume, { once: true });
            }
        }
        return alertAudioCtx;
    }

    function alertTone(freq, duration, volume, type, delay) {
        const ctx = getAlertAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const start = ctx.currentTime + (delay || 0);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    function playNewSignInAlert() {
        if (localStorage.getItem("posSoundOn") === "off") return;
        const ctx = getAlertAudioContext();
        if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        // Two-tone security chime: high then low.
        alertTone(988, 0.14, 0.2, "triangle");
        alertTone(784, 0.22, 0.2, "triangle", 0.16);
    }

    // ── Banner ───────────────────────────────────────────────────────────
    const banner = document.createElement("div");
    banner.id = "accountBanner";
    banner.innerHTML = `
        <i class="fa-solid fa-shield-halved"></i>
        <span id="accountBannerText">New sign-in detected</span>
        <span class="banner-actions">
            <button type="button" id="accountBannerKill">Log out other sessions</button>
            <button type="button" id="accountBannerView" class="ghost">View sessions</button>
            <button type="button" id="accountBannerClose" class="plain" title="Dismiss">&times;</button>
        </span>`;
    document.addEventListener("DOMContentLoaded", () => {
        const header = document.querySelector("header");
        if (header && header.parentNode) header.after(banner);
        else document.body.prepend(banner);
        // Admin app: the banner lives in its own grid row below the header —
        // stay there instead of sticking over the header while scrolling.
        if (isAdminApp) banner.style.position = "relative";
        banner.querySelector("#accountBannerKill").addEventListener("click", revokeOthers);
        banner.querySelector("#accountBannerView").addEventListener("click", () => openAccountModal("sessions"));
        banner.querySelector("#accountBannerClose").addEventListener("click", () => banner.style.display = "none");
    });

    function evaluateBanner() {
        const current = sessions.find(s => s.isCurrent);
        if (!current) return;
        const newer = sessions.filter(s => !s.isCurrent && new Date(s.createdAt) > new Date(current.createdAt));
        if (!newer.length) { banner.style.display = "none"; return; }
        const latest = newer[0];
        if (latest.jti !== lastAlertedJti) {
            playNewSignInAlert();
            lastAlertedJti = latest.jti;
        }
        banner.querySelector("#accountBannerText").innerHTML =
            `New sign-in detected: <strong>${deviceLabel(latest.userAgent)}</strong> · ${fmtTime(latest.createdAt)}` +
            ` — if this wasn't you, log that session out now.`;
        banner.style.display = "flex";
    }

    // ── Modal ────────────────────────────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.className = "account-modal-overlay";
    overlay.id = "accountModalOverlay";
    overlay.innerHTML = `
        <div class="account-modal">
            <div class="account-modal-head">
                <h3><i class="fa-solid fa-user-shield"></i> My Account</h3>
                <button type="button" class="account-modal-close" id="accountModalClose" title="Close">&times;</button>
            </div>
            <div class="account-tabs">
                <button type="button" data-tab="sessions" class="active">Sessions</button>
                <button type="button" data-tab="password">Change password</button>
            </div>
            <div class="account-tab-body" id="accountTabSessions">
                <button type="button" class="account-danger" id="accountRevokeAll">Log out all other sessions</button>
                <div id="accountSessionList"></div>
            </div>
            <div class="account-tab-body" id="accountTabPassword" hidden>
                <div class="account-field">
                    <label for="acctCurrentPw">Current password</label>
                    <input type="password" id="acctCurrentPw" autocomplete="current-password">
                </div>
                <div class="account-field">
                    <label for="acctNewPw">New password</label>
                    <input type="password" id="acctNewPw" autocomplete="new-password">
                </div>
                <div class="account-field">
                    <label for="acctConfirmPw">Confirm new password</label>
                    <input type="password" id="acctConfirmPw" autocomplete="new-password">
                </div>
                <div class="account-msg" id="accountPwMsg"></div>
                <button type="button" class="account-primary" id="accountPwSave">Change password</button>
                <span class="account-empty">Changing your password logs out every other device instantly.</span>
            </div>
        </div>`;
    overlay.addEventListener("click", e => { if (e.target === overlay) closeAccountModal(); });
    document.body.appendChild(overlay);

    document.addEventListener("DOMContentLoaded", () => {
        overlay.querySelector("#accountModalClose").addEventListener("click", closeAccountModal);
        overlay.querySelector("#accountRevokeAll").addEventListener("click", revokeOthers);
        overlay.querySelector("#accountPwSave").addEventListener("click", changePassword);
        overlay.querySelectorAll(".account-tabs button").forEach(btn =>
            btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
        const pw = overlay.querySelector("#acctNewPw");
        if (pw) pw.addEventListener("keydown", e => { if (e.key === "Enter") changePassword(); });
    });

    function switchTab(tab) {
        overlay.querySelectorAll(".account-tabs button").forEach(b =>
            b.classList.toggle("active", b.dataset.tab === tab));
        overlay.querySelector("#accountTabSessions").hidden = tab !== "sessions";
        overlay.querySelector("#accountTabPassword").hidden = tab !== "password";
    }

    function openAccountModal(tab) {
        const dd = document.querySelector(".profile-dropdown");
        if (dd) dd.classList.remove("show");
        switchTab(tab || "sessions");
        overlay.classList.add("open");
        loadSessions();
    }

    function closeAccountModal() { overlay.classList.remove("open"); }

    function showMsg(text, isError) {
        const el = overlay.querySelector("#accountPwMsg");
        el.textContent = text;
        el.className = "account-msg " + (isError ? "err" : "ok");
    }

    // ── Sessions ─────────────────────────────────────────────────────────
    async function loadSessions() {
        try {
            const res = await api("/api/auth/sessions");
            if (!res.ok) return;
            const data = await res.json();
            sessions = (data.sessions || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderSessions();
            evaluateBanner();
        } catch (e) { /* offline — ignore */ }
    }

    function renderSessions() {
        const list = overlay.querySelector("#accountSessionList");
        if (!sessions.length) {
            list.innerHTML = `<div class="account-empty">No active sessions.</div>`;
            return;
        }
        list.innerHTML = sessions.map(s => {
            const meta = `
                <div class="acct-icon"><i class="fa-solid fa-laptop"></i></div>
                <div class="acct-meta">
                    <div class="acct-device">${deviceLabel(s.userAgent)}</div>
                    <div class="acct-sub">${s.ip || "unknown IP"} · ${fmtTime(s.createdAt)}</div>
                </div>`;
            if (s.isCurrent) {
                return `<div class="account-session-row">${meta}<span class="acct-badge">● This device</span></div>`;
            }
            return `<div class="account-session-row">${meta}
                <button type="button" class="acct-kill" data-jti="${s.jti}">Log out</button></div>`;
        }).join("");
        list.querySelectorAll(".acct-kill").forEach(btn =>
            btn.addEventListener("click", () => killSession(btn.dataset.jti)));
    }

    async function killSession(jti) {
        try {
            const res = await api(`/api/auth/sessions/${encodeURIComponent(jti)}`, { method: "DELETE" });
            if (res.ok) loadSessions();
        } catch (e) { /* ignore */ }
    }

    async function revokeOthers() {
        try {
            const res = await api("/api/auth/sessions/revoke-others", { method: "POST" });
            if (!res.ok) return;
            const data = await res.json();
            banner.style.display = "none";
            showMsg(`Logged out ${data.revoked || 0} other session(s).`, false);
            loadSessions();
        } catch (e) { /* ignore */ }
    }

    // ── Password change ──────────────────────────────────────────────────
    async function changePassword() {
        const currentPw = overlay.querySelector("#acctCurrentPw").value;
        const newPw = overlay.querySelector("#acctNewPw").value;
        const confirmPw = overlay.querySelector("#acctConfirmPw").value;
        showMsg("", false);
        if (!currentPw || !newPw) return showMsg("Fill in your current and new password.", true);
        if (newPw.length < 4) return showMsg("New password must be at least 4 characters.", true);
        if (newPw !== confirmPw) return showMsg("Passwords do not match.", true);
        const btn = overlay.querySelector("#accountPwSave");
        btn.disabled = true;
        try {
            const res = await api("/api/auth/password", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                btn.disabled = false;
                return showMsg(err.error || "Password change failed.", true);
            }
            const data = await res.json();
            overlay.querySelector("#acctCurrentPw").value = "";
            overlay.querySelector("#acctNewPw").value = "";
            overlay.querySelector("#acctConfirmPw").value = "";
            showMsg(`Password changed — ${data.revoked || 0} other session(s) logged out.`, false);
            loadSessions();
        } catch (e) {
            btn.disabled = false;
            showMsg("Network error — try again.", true);
        } finally {
            btn.disabled = false;
        }
    }

    // ── Wire dropdown buttons ────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        const adminBtn = document.getElementById("profileAccountBtn");
        const cashierBtn = document.getElementById("cashierAccountBtn");
        const trigger = adminBtn || cashierBtn;
        if (trigger) trigger.addEventListener("click", () => openAccountModal("sessions"));
        loadSessions();
        setInterval(loadSessions, 60000);
    });
})();
