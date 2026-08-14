/* ==========================================================================
   typingGlow.js — Coffee-vibe typing feedback
   Every input/textarea glows warmly while being typed into; password fields
   get steam wisps rising above them. Both fade out after a short idle.
   A keystroke also strips any half-finished show/hide wipe classes so the
   wipe band can never stay stuck over the field.
   ========================================================================== */

(function () {
    var IDLE_MS = 1500;

    function clearFeedback(el) {
        el.classList.remove("typing");
        var wrap = el.closest(".password-wrap");
        if (wrap) wrap.classList.remove("steam");
        clearTimeout(el._typingTimer);
    }

    document.addEventListener(
        "input",
        function (e) {
            var el = e.target;
            if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;

            // A keystroke must never resurrect a half-finished show/hide wipe.
            el.classList.remove("pw-reveal", "pw-hide", "glow", "toggle-flash");

            el.classList.add("typing");
            var wrap = el.closest(".password-wrap");
            if (wrap) wrap.classList.add("steam");

            clearTimeout(el._typingTimer);
            el._typingTimer = setTimeout(function () {
                clearFeedback(el);
            }, IDLE_MS);
        },
        true
    );

    // Leaving the field stops the glow/steam immediately.
    document.addEventListener(
        "focusout",
        function (e) {
            var el = e.target;
            if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
            clearFeedback(el);
        },
        true
    );
})();