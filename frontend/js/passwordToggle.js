/* ==========================================================================
   passwordToggle.js — Show/hide password toggles
   Wires every .password-toggle button to its sibling password input.
   ========================================================================== */

(function () {
    function runAnim(el, cls) {
        if (!el) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
    }

    function runFlash(el) {
        el.classList.add("toggle-flash");
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("toggle-flash")));
    }

    function init() {
        document.querySelectorAll(".password-wrap").forEach(wrap => {
            const input = wrap.querySelector("input[type='password'], input[type='text']");
            const btn = wrap.querySelector(".password-toggle");
            if (!input || !btn || btn.dataset.wired) return;
            btn.dataset.wired = "1";

            const icon = btn.querySelector("i");
            btn.addEventListener("click", () => {
                const showing = input.type === "text";
                input.type = showing ? "password" : "text";
                if (icon) icon.className = showing ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
                btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
                // Clear typing-feedback state so the wipe owns the animation slot
                // and its animationend cleanup always fires.
                input.classList.remove("typing", "pw-reveal", "pw-hide", "glow", "toggle-flash");
                const wrap = input.closest(".password-wrap");
                if (wrap) wrap.classList.remove("steam");
                clearTimeout(input._typingTimer);
                runAnim(btn, showing ? "hide" : "reveal");
                runAnim(input, showing ? "pw-hide" : "pw-reveal");
                runAnim(input, "glow");
                runFlash(input);
                input.focus();
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
