/* ==========================================================================
   api.js — Shared API utilities
   ========================================================================== */

const API_BASE_URL = "http://localhost:3000";

function apiFetch(path, options) {
    return fetch(`${API_BASE_URL}${path}`, options);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
