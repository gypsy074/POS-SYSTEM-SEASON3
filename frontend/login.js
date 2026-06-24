/* ==========================================================================
   Login Page Logic — Season 3 POS System
   Handles: date display, form submission, API auth, role-based redirect
   ========================================================================== */

const API_BASE = "http://localhost:3000";

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
async function handleLogin(e) {
    e.preventDefault();
    clearError();

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

        // ── Route by role ──────────────────────────────────────────────
        if (data.role === "Admin") {
            window.location.href = `${API_BASE}/ADMIN/admin.html`;
        } else if (data.role === "Cashier") {
            window.location.href = `${API_BASE}/CASHIER/pos.html`;
        } else {
            showError("Unknown user role. Contact an administrator.");
        }

    } catch (err) {
        showError("Cannot connect to the server. Make sure the backend is running on port 3000.");
    } finally {
        setLoading(false);
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
