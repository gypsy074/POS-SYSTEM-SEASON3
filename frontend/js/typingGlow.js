/* ==========================================================================
   typingGlow.js — Coffee-vibe typing feedback
   Every input/textarea glows warmly while being typed into; password fields
   get steam wisps rising above them. Both fade out after a short idle.
   ========================================================================== */

(function () {
    var IDLE_MS = 1500;

    document.addEventListener(
        "input",
        function (e) {
            var el = e.target;
            if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;

            el.classList.add("typing");
            var wrap = el.closest(".password-wrap");
            if (wrap) wrap.classList.add("steam");

            clearTimeout(el._typingTimer);
            el._typingTimer = setTimeout(function () {
                el.classList.remove("typing");
                if (wrap) wrap.classList.remove("steam");
            }, IDLE_MS);
        },
        true
    );
})();
