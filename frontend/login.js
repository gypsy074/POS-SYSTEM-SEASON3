/* ==========================================================================
   Login Page Logic — Season 3 POS System
   Handles: date display, form submission, API auth, role-based redirect
   ========================================================================== */

function getApiBaseUrl() {
    // file:// (opened directly from disk, no server) → the local dev backend.
    if (window.location.protocol === "file:") {
        return "http://localhost:3000";
    }
    const host = window.location.hostname;
    const port = window.location.port;
    // The live site serves its own API — never fall back, so a sleeping
    // free-tier instance is never misdetected as "no backend".
    if (host.endsWith(".onrender.com")) {
        return window.location.origin;
    }
    // Local static dev servers (VS Code Live Server :5500, python http.server,
    // …) have no /api — only the real backend (default port 3000) does.
    if ((host === "localhost" || host === "127.0.0.1" || host === "::1") && (port || "80") !== "3000") {
        return "http://localhost:3000";
    }
    // Same origin — the backend itself serves this page.
    return window.location.origin;
}

const API_BASE = getApiBaseUrl();

// ── Date Badge ─────────────────────────────────────────────────────────────
function initDateBadge() {
    const dateDisplay = document.getElementById("loginDateDisplay");
    if (dateDisplay) {
        dateDisplay.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });
    }
}

// ── Error Banner ────────────────────────────────────────────────────────────
function showError(message) {
    const banner = document.getElementById("loginError");
    const text   = document.getElementById("loginErrorText");
    if (banner && text) {
        text.textContent = message;
        banner.classList.add("visible");
    }
    const container = document.querySelector(".login-page-container");
    if (container) {
        container.classList.remove("shake");
        void container.offsetWidth; // restart the shake animation
        container.classList.add("shake");
    }
    // Tell the peek-a-boo cup what went wrong so it can react: empty fields
    // get an annoyed shake, connection failures a worried look, everything
    // else (invalid credentials / inactive account) the sad slump.
    let kind = "invalid";
    const msg = String(message || "");
    if (msg.includes("Please enter both")) kind = "empty";
    else if (msg.includes("Cannot connect")) kind = "connect";
    document.dispatchEvent(new CustomEvent("cup:denied", { detail: { kind } }));
}

function clearError() {
    const banner = document.getElementById("loginError");
    if (banner) banner.classList.remove("visible");
}

// ── Button Loading State ────────────────────────────────────────────────────
function setLoading(isLoading) {
    const btn = document.getElementById("loginBtn");
    if (!btn) return;
    btn.disabled = isLoading;
    btn.classList.toggle("loading", isLoading);
}

// ── Form Submit ─────────────────────────────────────────────────────────────
let loginRetryCount = 0;

async function handleLogin(e, isRetry = false) {
    e.preventDefault();
    clearError();
    if (!isRetry) loginRetryCount = 0;

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    // Basic client-side validation
    if (!username || !password) {
        showError("Please enter both username and password.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            showError(data.error || "Login failed. Please try again.");
            return;
        }

        // ── Store session user + token for profile widgets & API calls ──
        // Each app keeps its own session keys (admin vs cashier) so one
        // browser can hold both logins without them overwriting each other.
        const isAdmin = data.role === "Admin";
        localStorage.setItem(
            isAdmin ? "posAdminUser" : "posUser",
            JSON.stringify({
                username: data.username,
                role: data.role
            })
        );
        if (data.token) {
            localStorage.setItem(isAdmin ? "posAdminToken" : "posToken", data.token);
        }

        // ── Route by role ──────────────────────────────────────────────
        // Relative paths so redirects also work when the frontend is opened
        // directly via file:// (not just when served by the backend).
        if (data.role === "Admin" || data.role === "Cashier") {
            redirectAfterLogin(data.role, data.username);
        } else {
            showError("Unknown user role. Contact an administrator.");
        }

    } catch (err) {
        // A sleeping free-tier backend can take ~1 min to wake on first
        // contact — give it a couple of short retries before giving up.
        if (loginRetryCount < 2) {
            loginRetryCount++;
            setLoading(true);
            setTimeout(() => handleLogin(e, true), 3000);
            return;
        }
        const isLocalBackend = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(API_BASE);
        showError(isLocalBackend
            ? `Cannot connect to ${API_BASE} — make sure the backend is running on port 3000.`
            : `Cannot connect to ${API_BASE} — the backend may still be starting. Press Log In to retry.`);
    } finally {
        setLoading(false);
    }
}

// ── Success Transition ──────────────────────────────────────────────────────
// Shows the brand overlay briefly, then routes the user to their app.
// The redirect is driven by the cup-pour animation (redirectAfterTransition
// in logoutTransition.js) so the transition never drifts from its CSS.
function redirectAfterLogin(role, username) {
    document.dispatchEvent(new CustomEvent("cup:success")); // the peek-a-boo cup hops
    const overlay  = document.getElementById("loginTransitionOverlay");
    const welcome  = document.getElementById("transitionWelcome");
    const roleEl   = document.getElementById("transitionRole");

    const go = () => {
        window.location.href = role === "Admin" ? "ADMIN/admin.html" : "CASHIER/pos.html";
    };

    if (overlay) {
        if (welcome) welcome.textContent = `Welcome, ${String(username || "").trim() || "there"}!`;
        if (roleEl)  roleEl.textContent  = role === "Admin" ? "Administrator" : "Cashier";
        overlay.classList.add("show");
        redirectAfterTransition(overlay, go);
    } else {
        go();
    }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initDateBadge();

    const form = document.getElementById("loginForm");
    if (form) {
        form.addEventListener("submit", handleLogin);
    }

    // Clear error when user starts typing again
    ["username", "password"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", clearError);
    });
});
