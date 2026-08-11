/* ==========================================================================
   api.js — Shared API utilities
   ========================================================================== */

function getApiBaseUrl() {
    // When the frontend is served from a file:// (opened directly in a browser)
    if (window.location.protocol === "file:") {
        return "http://localhost:3000";
    }
    // When served by the backend itself (same origin)
    return window.location.origin;
}

const API_BASE_URL = getApiBaseUrl();

function getAuthToken() {
    return localStorage.getItem("posToken") || "";
}

function clearSession() {
    localStorage.removeItem("posToken");
    localStorage.removeItem("posUser");
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
