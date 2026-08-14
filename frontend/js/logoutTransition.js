/* ==========================================================================
   logoutTransition.js — Coffee-cup farewell overlay after logout
   Builds the overlay DOM and injects the shared transition stylesheet
   (css/cup-transition.css) on pages that don't load it. Also exposes
   redirectAfterTransition() so login.js and the logout flow share one
   animation-driven redirect — no magic timers.
   ========================================================================== */

(function () {
    function escapeHtml(text) {
        return String(text || "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[ch]);
    }

    function injectStyle() {
        if (document.getElementById("cupTransitionCss")) return;
        const link = document.createElement("link");
        link.id = "cupTransitionCss";
        link.rel = "stylesheet";
        link.href = "../css/cup-transition.css";
        document.head.appendChild(link);
    }

    // Animation-driven redirect: fires when the cup pour finishes, triggers
    // the crema pulse, then calls onDone. Falls back after 3s if the
    // animation is ever blocked so the flow can never stall.
    window.redirectAfterTransition = function (rootEl, onDone) {
        const fill = rootEl ? rootEl.querySelector(".cup-fill") : null;
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            if (typeof onDone === "function") onDone();
        };

        if (fill) {
            fill.addEventListener("animationend", () => {
                fill.classList.add("pulse");
                setTimeout(finish, 350);
            }, { once: true });
        }

        setTimeout(finish, 3000);
    };

    window.showLogoutTransition = function (username, onDone) {
        injectStyle();

        const overlay = document.createElement("div");
        overlay.className = "login-transition-overlay drain";
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

        redirectAfterTransition(overlay, onDone);
    };
})();