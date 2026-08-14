/* ==========================================================================
   confirm.js — Styled confirm dialog for the admin panel.
   Replaces native window.confirm() with an in-app modal (toast-like design,
   dark-mode aware). Resolves true on confirm, false on cancel/escape/backdrop.
   ========================================================================== */

function showConfirmModal({
    title = "Are you sure?",
    message = "",
    icon = "fa-triangle-exclamation",
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    danger = true
} = {}) {
    return new Promise(resolve => {
        let overlay = document.getElementById("confirmModalOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "confirmModalOverlay";
            overlay.className = "confirm-modal-overlay";
            overlay.innerHTML = `
                <div class="confirm-modal">
                    <div class="confirm-modal-icon"><i class="fas fa-triangle-exclamation"></i></div>
                    <h3 class="confirm-modal-title"></h3>
                    <p class="confirm-modal-message"></p>
                    <div class="confirm-modal-actions">
                        <button type="button" class="confirm-btn confirm-btn-cancel"></button>
                        <button type="button" class="confirm-btn confirm-btn-primary"></button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }

        const iconEl = overlay.querySelector(".confirm-modal-icon");
        const titleEl = overlay.querySelector(".confirm-modal-title");
        const msgEl = overlay.querySelector(".confirm-modal-message");
        const confirmBtn = overlay.querySelector(".confirm-btn-primary");
        const cancelBtn = overlay.querySelector(".confirm-btn-cancel");

        iconEl.innerHTML = `<i class="fas ${icon}"></i>`;
        iconEl.classList.toggle("danger", !!danger);
        titleEl.textContent = title;
        msgEl.textContent = message;
        confirmBtn.textContent = confirmLabel;
        confirmBtn.classList.toggle("danger", !!danger);
        cancelBtn.textContent = cancelLabel;

        let settled = false;
        const close = result => {
            if (settled) return;
            settled = true;
            overlay.classList.remove("open");
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };
        const onKey = e => {
            if (e.key === "Escape") close(false);
            if (e.key === "Enter") { e.preventDefault(); close(true); }
        };
        overlay.onclick = e => { if (e.target === overlay) close(false); };
        document.addEventListener("keydown", onKey);
        confirmBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
        overlay.classList.add("open");
        confirmBtn.focus();
    });
}