/* ==========================================================================
   api.js — Shared API utilities
   ========================================================================== */

function getApiBaseUrl() {
    // file:// (opened directly in a browser, no server) → the local dev backend.
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
    // When served by the backend itself (same origin).
    return window.location.origin;
}

const API_BASE_URL = getApiBaseUrl();

function getAuthToken() {
    return localStorage.getItem("posAdminToken") || "";
}

function clearSession() {
    localStorage.removeItem("posAdminToken");
    localStorage.removeItem("posAdminUser");
}

function redirectToLogin() {
    clearSession();
    const current = window.location.href;
    if (!current.includes("login.html")) {
        window.location.href = "../login.html";
    }
}

function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getAuthToken();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    return fetch(`${API_BASE_URL}${path}`, { ...options, headers }).then(response => {
        if (response.status === 401 && !path.includes("/api/login")) {
            // Session missing/expired — send the user back to login.
            redirectToLogin();
        }
        return response;
    });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// Local (Philippine) date stamp for export filenames — toISOString() is UTC,
// which is off by one day for exports made between midnight and 8 AM.
function localDateStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
