/* ==========================================================================
   logoutTransition.js — Coffee-cup farewell overlay after logout
   Self-contained: injects its own markup + styles so the admin and cashier
   pages can show the same animated cup the login overlay uses.
   ========================================================================== */

(function () {
    const CUP_CSS = `
.login-transition-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: linear-gradient(135deg, #1a1a1a 0%, #4a3424 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.45s ease, visibility 0.45s ease;
}
.login-transition-overlay.show { opacity: 1; visibility: visible; }
.login-transition-title {
    color: #ffffff;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    opacity: 0;
    animation: ltTextIn 0.5s ease 0.9s both;
}
.login-transition-sub {
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.85rem;
    letter-spacing: 3px;
    text-transform: uppercase;
    opacity: 0;
    animation: ltTextIn 0.5s ease 1.1s both;
}
.coffee-cup {
    --cup-size: 90px;
    position: relative;
    width: var(--cup-size);
    height: calc(var(--cup-size) * 0.82);
    margin-bottom: 6px;
}
.cup-body {
    position: absolute;
    inset: 0;
    border: 3px solid #d8c4a8;
    border-radius: 0 0 18px 18px;
    background: #f5ede3;
    overflow: hidden;
}
.cup-fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0;
    background: linear-gradient(180deg, #8a5a33 0%, #6b4226 100%);
    z-index: 1;
    animation: ltFill 1.4s cubic-bezier(0.34, 1.2, 0.64, 1) 0.15s both;
}
.cup-fill::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 6px;
    background: rgba(255, 235, 205, 0.85);
    border-radius: 2px;
    z-index: 2;
}
.cup-handle {
    position: absolute;
    top: 10px;
    right: -13px;
    width: 26px;
    height: 34px;
    border: 3px solid #d8c4a8;
    border-left: none;
    border-radius: 0 14px 14px 0;
}
.steam {
    position: absolute;
    bottom: calc(100% + 4px);
    width: 5px;
    height: 24px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.45);
    opacity: 0;
    animation: ltSteam 2s ease-out infinite;
}
.steam-1 { left: 26%; animation-delay: 0s; }
.steam-2 { left: 47%; animation-delay: 0.65s; }
.steam-3 { left: 68%; animation-delay: 1.3s; }
@keyframes ltFill {
    from { height: 0; }
    to   { height: 100%; }
}
@keyframes ltSteam {
    0%   { opacity: 0; transform: translateY(6px) scaleX(1); }
    35%  { opacity: 0.8; }
    100% { opacity: 0; transform: translateY(-26px) scaleX(1.6); }
}
@keyframes ltTextIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
    .cup-fill { animation-duration: 0.4s; }
    .steam { display: none; }
    .login-transition-title,
    .login-transition-sub {
        opacity: 1;
        animation: none;
        transform: none;
    }
}
`;

    function escapeHtml(text) {
        return String(text || "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[ch]);
    }

    function injectStyle() {
        if (document.getElementById("logoutTransitionCss")) return;
        const style = document.createElement("style");
        style.id = "logoutTransitionCss";
        style.textContent = CUP_CSS;
        document.head.appendChild(style);
    }

    window.showLogoutTransition = function (username, onDone) {
        injectStyle();

        const overlay = document.createElement("div");
        overlay.className = "login-transition-overlay";
        overlay.id = "logoutTransitionOverlay";
        overlay.innerHTML = `
            <div class="coffee-cup" aria-hidden="true">
                <div class="cup-body">
                    <div class="cup-fill"></div>
                </div>
                <div class="cup-handle"></div>
                <span class="steam steam-1"></span>
                <span class="steam steam-2"></span>
                <span class="steam steam-3"></span>
            </div>
            <div class="login-transition-title">${username ? `See you soon, ${escapeHtml(username)}!` : "See you soon!"}</div>
            <div class="login-transition-sub">You have been logged out</div>
        `;
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add("show"));

        setTimeout(() => {
            if (typeof onDone === "function") onDone();
        }, 1800);
    };
})();