/* ==========================================================================
   toast.js — Lightweight toast notifications for the admin panel.
   Usage: showToast("Product saved", "success" | "error" | "warning" | "info")
   Slides in top-right, auto-dismisses, stacks up to 4, works in dark mode.
   ========================================================================== */

function showToast(message, type = "success") {
    const container = getToastContainer();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const icons = {
        success: "fa-circle-check",
        error: "fa-circle-xmark",
        warning: "fa-triangle-exclamation",
        info: "fa-circle-info"
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info} toast-icon"></i>
        <span class="toast-text">${escapeToast(message)}</span>
        <button type="button" class="toast-close" aria-label="Dismiss">&times;</button>`;

    toast.querySelector(".toast-close").addEventListener("click", () => dismiss(toast));
    container.appendChild(toast);

    // Keep at most 4 toasts on screen.
    while (container.children.length > 4) {
        dismiss(container.firstElementChild, true);
    }

    const timeout = type === "error" ? 6000 : 3500;
    toast._timer = setTimeout(() => dismiss(toast), timeout);

    // Re-enter animation every time (re-adding the class restarts it).
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-in")));
}

function getToastContainer() {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    return container;
}

function dismiss(toast, immediate = false) {
    if (toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._timer);
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), immediate ? 0 : 250);
}

function escapeToast(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
