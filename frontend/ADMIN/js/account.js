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
#accountBanner{position:sticky;top:0;z-index:900;display:none;align-items:center;gap:12px;
    margin:8px 16px;padding:12px 48px 12px 14px;background:#fff9ef;
    border:1px solid #ead3b1;border-left:4px solid #c47a32;border-radius:12px;
    color:#594128;font-size:13px;font-weight:500;line-height:1.45;
    box-shadow:0 5px 16px rgba(72,46,23,.09)}
#accountBanner>i{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;
    border-radius:10px;background:#f3e3ce;color:#a45f1e;font-size:15px}
#accountBannerText{min-width:0;flex:1}
#accountBanner strong{font-weight:700;color:#704611}
#accountBanner .banner-actions{margin-left:auto;display:flex;align-items:center;gap:7px;flex:0 0 auto}
#accountBanner button{background:#b96b20;color:#fff;border:1px solid #b96b20;border-radius:8px;
    padding:7px 11px;font-size:12px;font-weight:650;white-space:nowrap;cursor:pointer;
    transition:background .15s ease,border-color .15s ease,transform .12s ease,opacity .15s ease}
#accountBanner button:hover{background:#995316;border-color:#995316}
#accountBanner button:active{transform:scale(.95)}
#accountBanner button.ghost{background:#fffaf4;color:#795329;border:1px solid #dfc5a3}
#accountBanner button.ghost:hover{background:#f7ead8;border-color:#c99b65}
#accountBanner button.plain{position:absolute;top:8px;right:9px;display:grid;place-items:center;
    width:28px;height:28px;padding:0;background:transparent;border:0;color:#8b7965;
    cursor:pointer;font-size:17px;line-height:1}
#accountBanner button.plain:hover{background:#f1e4d3;color:#4f3a24}
body.dark #accountBanner{background:#34271c;border-color:#55402b;border-left-color:#d9934b;
    color:#e7d8c5;box-shadow:0 5px 18px rgba(0,0,0,.2)}
body.dark #accountBanner>i{background:#493521;color:#f0b879}
body.dark #accountBanner strong{color:#f3c58f}
body.dark #accountBanner button{background:#aa611f;border-color:#aa611f;color:#fff7ed}
body.dark #accountBanner button:hover{background:#c47a32;border-color:#c47a32}
body.dark #accountBanner button.ghost{background:#3d2e20;border-color:#6a5035;color:#f0d7b6}
body.dark #accountBanner button.ghost:hover{background:#4b3826;border-color:#946a3b}
body.dark #accountBanner button.plain{background:transparent;color:#c1ad95}
body.dark #accountBanner button.plain:hover{background:#493521;color:#fff0dc}
@media(max-width:720px){
    #accountBanner{flex-wrap:wrap;align-items:flex-start;gap:8px 10px;margin:8px 10px;padding:11px 42px 11px 11px}
    #accountBanner>i{flex-basis:30px;width:30px;height:30px}
    #accountBannerText{flex:1 1 calc(100% - 44px);padding-top:2px}
    #accountBanner .banner-actions{width:100%;margin-left:40px;gap:6px}
    #accountBanner .banner-actions button:not(.plain){flex:1;padding:7px 8px;font-size:11.5px}
}
@media(max-width:380px){
    #accountBanner{font-size:12px}
    #accountBanner .banner-actions{margin-left:0}
    #accountBanner .banner-actions button:not(.plain){white-space:normal;line-height:1.25}
}
.account-modal-overlay{position:fixed;inset:0;background:rgba(10,12,20,.55);z-index:1200;
    display:none;align-items:center;justify-content:center;padding:16px}
.account-modal-overlay.open{display:flex}
.account-modal{box-sizing:border-box;background:#fffaf5;border:1px solid #eadfd3;border-radius:18px;
    width:min(100%,520px);max-height:min(85vh,760px);display:flex;flex-direction:column;
    overflow:hidden;box-shadow:0 22px 60px rgba(31,20,12,.32)}
.account-modal-head{display:flex;align-items:center;justify-content:space-between;
    padding:17px 22px;background:linear-gradient(135deg,#fffaf5,#f8eee3);border-bottom:1px solid #eadfd3}
.account-modal-head h3{display:flex;align-items:center;gap:10px;margin:0;font-size:16px;color:#38291e}
.account-modal-head h3 i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;
    background:#f1dfca;color:#9a5c22;font-size:15px}
.account-modal-close{display:grid;place-items:center;width:34px;height:34px;background:transparent;
    border:0;border-radius:9px;font-size:20px;color:#8a7a6a;cursor:pointer;line-height:1;
    transition:color .15s ease,transform .12s ease}
.account-modal-close:hover{color:#6b4f3b;background:#f1e5d8}
.account-modal-close:active{transform:scale(.9)}
.account-tabs{display:flex;gap:5px;margin:14px 22px 0;padding:5px;background:#f3e9de;
    border:1px solid #eadfd3;border-radius:12px}
.account-tabs button{flex:1;background:transparent;border:0;border-radius:8px;padding:9px 12px;
    font-size:13px;font-weight:600;color:#766555;cursor:pointer;
    transition:color .15s ease,background .15s ease,box-shadow .15s ease,transform .12s ease}
.account-tabs button:hover{color:#d97706}
.account-tabs button:active{transform:scale(.95)}
.account-tabs button.active{color:#98500e;background:#fffaf5;box-shadow:0 2px 6px rgba(87,58,31,.12)}
.account-tabs button:focus-visible,.account-modal-close:focus-visible{outline:2px solid #c47a32;outline-offset:2px}
.account-tab-body{padding:20px 22px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
.account-tab-body[hidden]{display:none}
.account-danger{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;
    padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer;
    transition:background .15s ease,transform .12s ease}
.account-danger:hover{background:#fecaca}
.account-danger:active{transform:scale(.97)}
.account-primary{background:#d97706;color:#fff;border:0;border-radius:8px;padding:10px 14px;
    font-size:13px;font-weight:700;cursor:pointer;
    transition:background .15s ease,transform .12s ease}
.account-primary:hover{background:#b45309}
.account-primary:active{transform:scale(.97)}
.account-primary:disabled{opacity:.5;cursor:not-allowed}
.account-session-row{display:flex;align-items:center;gap:12px;padding:11px 12px;
    border:1px solid #eef0f4;border-radius:10px;
    transition:border-color .15s ease,box-shadow .15s ease,transform .12s ease}
.account-session-row:hover{border-color:#e5c189;box-shadow:0 3px 10px rgba(0,0,0,.06)}
.account-session-row:active{transform:scale(.995)}
.account-session-row .acct-icon{width:36px;height:36px;border-radius:9px;flex:0 0 36px;
    background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center;font-size:15px}
.account-session-row .acct-meta{flex:1;min-width:0}
.account-session-row .acct-device{font-size:13px;font-weight:600;color:#1a2233}
.account-session-row .acct-sub{font-size:11.5px;color:#8a93a5;margin-top:2px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
.account-session-row .acct-badge{font-size:10.5px;font-weight:700;color:#15803d;background:#dcfce7;
    border-radius:99px;padding:3px 8px;flex:0 0 auto}
.account-session-row button.acct-kill{background:none;border:1px solid #fecaca;color:#b91c1c;
    border-radius:7px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;flex:0 0 auto;
    transition:background .15s ease,transform .12s ease}
.account-session-row button.acct-kill:hover{background:#fee2e2}
.account-session-row button.acct-kill:active{transform:scale(.94)}
.acct-age{font-size:10px;font-weight:700;border-radius:99px;padding:2px 7px;margin-left:6px;flex:0 0 auto}
.acct-age.today{color:#15803d;background:#dcfce7}
.acct-age.week{color:#b45309;background:#fef3c7}
.acct-age.old{color:#6b7280;background:#f1f5f9}
.acct-retry{display:block;margin:10px auto 0;background:#d97706;color:#fff;border:0;border-radius:7px;
    padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;
    transition:background .15s ease,transform .12s ease}
.acct-retry:hover{background:#b45309}
.acct-retry:active{transform:scale(.95)}
.account-modal-overlay{animation:accountModalFade .18s ease-out}
@keyframes accountModalFade{from{opacity:0}to{opacity:1}}
.account-modal-overlay.closing{animation:accountModalFadeOut .16s ease-in forwards}
@keyframes accountModalFadeOut{to{opacity:0}}
.account-modal{animation:accountModalPop .22s cubic-bezier(.34,1.56,.64,1)}
@keyframes accountModalPop{from{transform:translateY(18px) scale(.96);opacity:.5}to{transform:none;opacity:1}}
.account-modal-overlay.closing .account-modal{animation:accountModalPopOut .16s ease-in forwards}
@keyframes accountModalPopOut{to{transform:translateY(12px) scale(.97);opacity:0}}
.account-empty{font-size:12.5px;color:#8a93a5;text-align:center;padding:14px 0}
.account-field{display:flex;flex-direction:column;gap:5px}
.account-field label{font-size:12px;font-weight:650;color:#5a493a}
.account-field input{box-sizing:border-box;width:100%;min-height:44px;background:#fff;border:1px solid #dfd1c3;
    border-radius:10px;padding:10px 12px;font-size:13px;color:#29231d;outline:none;
    transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.account-field input:focus{border-color:#d97706;box-shadow:0 0 0 3px rgba(217,119,6,.15)}
.account-policy-hint{padding:2px 1px 0;text-align:left;color:#806e5d;font-size:11.5px;line-height:1.45}
.account-footnote{padding:1px 0 0;font-size:11.5px;color:#8a7a6a}
.account-msg{font-size:12.5px;border-radius:8px;padding:9px 11px;display:none}
.account-msg.ok{display:block;background:#dcfce7;color:#15803d}
.account-msg.err{display:block;background:#fee2e2;color:#b91c1c}
body.dark .account-modal{background:#2e2318;border-color:#4a3a2c}
body.dark .account-modal-head{background:linear-gradient(135deg,#34271c,#2e2318);border-color:#4a3a2c}
body.dark .account-modal-head h3{color:#f2e7d8}
body.dark .account-modal-head h3 i{background:#4a3828;color:#e2a76b}
body.dark .account-modal-close{color:#b8a895}
body.dark .account-modal-close:hover{color:#f2e7d8;background:#403123}
body.dark .account-tabs{background:#241b14;border-color:#4a3a2c}
body.dark .account-tabs button{color:#bdad9a}
body.dark .account-tabs button.active{color:#f2b36f;background:#403123;box-shadow:0 2px 6px rgba(0,0,0,.25)}
body.dark .account-tab-body{color:#e8dccb}
body.dark .account-danger{background:#482323;border-color:#653333;color:#fecaca}
body.dark .account-danger:hover{background:#5b2929}
body.dark .account-session-row{border-color:#4a3a2c}
body.dark .account-session-row .acct-icon{background:#403123;color:#e1cdb5}
body.dark .account-session-row .acct-device{color:#f2e7d8}
body.dark .account-session-row .acct-sub{color:#b8a895}
body.dark .account-session-row .acct-badge{background:#183b2c;color:#bbf7d0}
body.dark .acct-age.today{background:#183b2c;color:#bbf7d0}
body.dark .acct-age.week{background:#49351e;color:#fcd34d}
body.dark .acct-age.old{background:#403123;color:#d1c4b4}
body.dark .account-field label{color:#e1d1be}
body.dark .account-field input{background:#241c15;border-color:#514131;color:#f2e7d8}
body.dark .account-field input:focus{border-color:#d9934b;box-shadow:0 0 0 3px rgba(217,147,75,.18)}
body.dark .account-policy-hint,body.dark .account-footnote{color:#b8a895}
body.dark .account-empty{color:#b8a895}
body.dark .account-msg.ok{background:#183b2c;color:#bbf7d0}
body.dark .account-msg.err{background:#482323;color:#fecaca}
@media(max-width:480px){
    .account-modal-overlay{padding:10px}
    .account-modal{max-height:calc(100dvh - 20px);border-radius:15px}
    .account-modal-head{padding:14px 16px}
    .account-tabs{margin:12px 16px 0}
    .account-tab-body{padding:16px;gap:12px}
}`;

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

    function deviceIcon(ua) {
        const s = String(ua || "").toLowerCase();
        if (s.includes("ipad")) return "fa-tablet-screen-button";
        if (s.includes("iphone") || s.includes("ios") || s.includes("android")) return "fa-mobile-screen";
        return "fa-laptop";
    }

    function relTime(d) {
        const t = new Date(d);
        if (isNaN(t.getTime())) return "";
        const diff = Date.now() - t.getTime();
        const min = Math.floor(diff / 60000);
        if (min < 1) return "just now";
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day}d ago`;
        const wk = Math.floor(day / 7);
        if (wk < 5) return `${wk}w ago`;
        return t.toLocaleDateString();
    }

    function sessionAgeInfo(d) {
        const t = new Date(d);
        if (isNaN(t.getTime())) return { cls: "old", label: "unknown age" };
        const diff = Date.now() - t.getTime();
        if (diff < 24 * 3600 * 1000) return { cls: "today", label: "today" };
        if (diff < 7 * 24 * 3600 * 1000) return { cls: "week", label: `${Math.floor(diff / (24 * 3600 * 1000))}d old` };
        return { cls: "old", label: `${Math.floor(diff / (7 * 24 * 3600 * 1000))}w old` };
    }

    function confirmDialog(title, message, confirmLabel) {
        if (typeof showConfirmModal === "function") {
            return showConfirmModal({ title, message, confirmLabel, cancelLabel: "Cancel", danger: true });
        }
        return Promise.resolve(window.confirm(`${title} ${message}`));
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
    let sessionsFailed = false;
    let lastAlertedJti = null;
    let sessionsLoading = false;
    let refreshAccountPasswordStrength = () => {};

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
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = `
        <i class="fa-solid fa-shield-halved"></i>
        <span id="accountBannerText">New sign-in detected</span>
        <span class="banner-actions">
            <button type="button" id="accountBannerKill">Log out other sessions</button>
            <button type="button" id="accountBannerView" class="ghost">View sessions</button>
            <button type="button" id="accountBannerClose" class="plain" title="Dismiss" aria-label="Dismiss sign-in alert">&times;</button>
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
                    <input type="password" id="acctNewPw" autocomplete="new-password" minlength="8" aria-describedby="accountPasswordPolicyHint accountPasswordStrength">
                    <small class="account-policy-hint" id="accountPasswordPolicyHint">At least 8 characters, up to 72 UTF-8 bytes. Spaces are allowed; avoid common passwords, your username, and the cafe name.</small>
                    <div class="password-strength" id="accountPasswordStrength" aria-live="polite" aria-atomic="true" hidden>
                        <div class="password-strength__summary">Strength <strong class="password-strength__label" data-strength-label></strong></div>
                        <div class="password-strength__track" aria-hidden="true">
                            <span data-strength-segment></span><span data-strength-segment></span><span data-strength-segment></span>
                        </div>
                        <small class="password-strength__message" data-strength-message></small>
                    </div>
                </div>
                <div class="account-field">
                    <label for="acctConfirmPw">Confirm new password</label>
                    <input type="password" id="acctConfirmPw" autocomplete="new-password">
                </div>
                <div class="account-msg" id="accountPwMsg"></div>
                <button type="button" class="account-primary" id="accountPwSave">Change password</button>
                <span class="account-footnote">Changing your password logs out every other device instantly.</span>
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
        if (pw) {
            const strengthIndicator = overlay.querySelector("#accountPasswordStrength");
            const username = getSignedInUsername();
            refreshAccountPasswordStrength = window.setupPosPasswordStrength(
                pw,
                strengthIndicator,
                () => username
            );
        }
        if (pw) pw.addEventListener("keydown", e => { if (e.key === "Enter") changePassword(); });
    });

    function switchTab(tab) {
        overlay.querySelectorAll(".account-tabs button").forEach(b =>
            b.classList.toggle("active", b.dataset.tab === tab));
        overlay.querySelector("#accountTabSessions").hidden = tab !== "sessions";
        overlay.querySelector("#accountTabPassword").hidden = tab !== "password";
    }

    let modalCloseTimer = null;

    function openAccountModal(tab) {
        if (typeof closeProfileDropdown === "function") closeProfileDropdown();
        if (modalCloseTimer) {
            clearTimeout(modalCloseTimer);
            modalCloseTimer = null;
        }
        overlay.classList.remove("closing");
        switchTab(tab || "sessions");
        overlay.classList.add("open");
        loadSessions();
    }

    function closeAccountModal() {
        if (modalCloseTimer) {
            clearTimeout(modalCloseTimer);
            modalCloseTimer = null;
        }
        overlay.classList.add("closing");
        modalCloseTimer = setTimeout(() => {
            modalCloseTimer = null;
            overlay.classList.remove("closing", "open");
        }, 170);
    }

    function showMsg(text, isError) {
        const el = overlay.querySelector("#accountPwMsg");
        el.textContent = text;
        el.className = "account-msg " + (isError ? "err" : "ok");
    }

    // ── Sessions ─────────────────────────────────────────────────────────
    async function loadSessions() {
        if (sessionsLoading) return;
        sessionsLoading = true;
        try {
            const res = await api("/api/auth/sessions", { cache: "no-store" });
            if (!res.ok) throw new Error("bad status");
            const data = await res.json();
            sessions = (data.sessions || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            sessionsFailed = false;
            renderSessions();
            evaluateBanner();
        } catch (e) {
            sessionsFailed = true;
            renderSessions();
        } finally {
            sessionsLoading = false;
        }
    }

    function renderSessions() {
        const list = overlay.querySelector("#accountSessionList");
        if (sessionsFailed) {
            list.innerHTML = `<div class="account-empty">Couldn't load your sessions right now.
                <button type="button" class="acct-retry" id="acctRetryBtn">Retry</button></div>`;
            const retry = list.querySelector("#acctRetryBtn");
            if (retry) retry.addEventListener("click", loadSessions);
            return;
        }
        if (!sessions.length) {
            list.innerHTML = `<div class="account-empty"><i class="fa-solid fa-shield-halved"></i> No active sessions.</div>`;
            return;
        }
        list.innerHTML = sessions.map(s => {
            const age = sessionAgeInfo(s.createdAt);
            const device = deviceLabel(s.userAgent);
            const meta = `
                <div class="acct-icon"><i class="fa-solid ${deviceIcon(s.userAgent)}"></i></div>
                <div class="acct-meta">
                    <div class="acct-device">${device}</div>
                    <div class="acct-sub">${escapeHtml(s.ip || "unknown IP")} · ${relTime(s.createdAt)}
                        <span class="acct-age ${age.cls}">${age.label}</span></div>
                </div>`;
            if (s.isCurrent) {
                return `<div class="account-session-row">${meta}<span class="acct-badge">● This device</span></div>`;
            }
            return `<div class="account-session-row">${meta}
                <button type="button" class="acct-kill" data-jti="${s.jti}" data-device="${device.replace(/"/g, "&quot;")}">Log out</button></div>`;
        }).join("");
        list.querySelectorAll(".acct-kill").forEach(btn =>
            btn.addEventListener("click", () => killSession(btn.dataset.jti, btn.dataset.device)));
    }

    async function killSession(jti, device) {
        const confirmed = await confirmDialog(
            "Log out this device?",
            `"${device || "This device"}" will be signed out and must log in again.`,
            "Log out"
        );
        if (!confirmed) return;
        try {
            const res = await api(`/api/auth/sessions/${encodeURIComponent(jti)}`, { method: "DELETE" });
            if (res.ok) loadSessions();
        } catch (e) { /* ignore */ }
    }

    async function revokeOthers() {
        const confirmed = await confirmDialog(
            "Log out all other sessions?",
            "Every other device will be signed out immediately. This device stays signed in.",
            "Log them out"
        );
        if (!confirmed) return;
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
        const username = getSignedInUsername();
        const passwordError = window.getPosPasswordPolicyError(newPw, username);
        if (passwordError) return showMsg(passwordError, true);
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
            refreshAccountPasswordStrength();
            showMsg(`Password changed — ${data.revoked || 0} other session(s) logged out.`, false);
            loadSessions();
        } catch (e) {
            btn.disabled = false;
            showMsg("Network error — try again.", true);
        } finally {
            btn.disabled = false;
        }
    }

    function getSignedInUsername() {
        const storedUser = localStorage.getItem(userKey) || sessionStorage.getItem(userKey);
        if (!storedUser) return "";
        try {
            return JSON.parse(storedUser).username || "";
        } catch (error) {
            console.error("Could not read the signed-in username for password validation.", error);
            return "";
        }
    }

    // ── Wire dropdown buttons ────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        const adminBtn = document.getElementById("profileAccountBtn");
        const cashierBtn = document.getElementById("cashierAccountBtn");
        const trigger = adminBtn || cashierBtn;
        if (trigger) trigger.addEventListener("click", () => openAccountModal("sessions"));
        loadSessions();
        setInterval(() => {
            if (!document.hidden) loadSessions();
        }, 10000);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) loadSessions();
        });
    });
})();
