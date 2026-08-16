/* ==========================================================================
   peekCup.js — Peek-a-boo coffee cup character for the login page.
   Idle: the pupils follow the cursor (finger on touch screens). The moment
   a field is focused the eyes lock onto it and track the caret while the
   user types. While the password is revealed the cup gets sneaky: hands
   cover the eyes, but it tilts sideways and keeps watching through the gap.
   Reduced-motion users get a still, polite cup.
   ========================================================================== */

(function () {
    var cup = document.getElementById("peekCup");
    if (!cup) return;
    var pupils = cup.querySelectorAll(".peek-pupil");
    if (!pupils.length) return;

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var RANGE = 5;            // max pupil travel in px (inner eye 16px - 6px pupil / 2)
    var away = false;         // looking away (password revealed)
    var focused = false;      // an input is focused — the eyes lock onto it
    var activeInput = null;   // the focused field the eyes are watching
    var px = 0, py = 0;       // applied pupil offset in px
    var lastMove = 0;
    var rafPending = false;
    var idleTimer = null;
    var idlePhase = 0;
    var cupRect = null;
    var mirror = null;        // hidden span that measures the caret position
    var mirrorCss = null;     // cached font metrics of the focused input

    function refreshCupRect() {
        try {
            cupRect = cup.getBoundingClientRect();
        } catch (err) {
            cupRect = null;
        }
    }

    window.addEventListener("resize", refreshCupRect);
    refreshCupRect();

    function apply() {
        // While the password is revealed the cup is sneaky: the hands cover
        // the eyes, but the pupils keep tracking the caret through the gap.
        var t = "translate(" + px.toFixed(2) + "px," + py.toFixed(2) + "px)";
        for (var i = 0; i < pupils.length; i++) {
            pupils[i].style.transform = t;
        }
        rafPending = false;
    }

    function schedule() {
        if (rafPending || reduceMotion) return;
        rafPending = true;
        requestAnimationFrame(apply);
    }

    function setLook(nx, ny) {
        nx = Math.max(-1, Math.min(1, nx));
        ny = Math.max(-1, Math.min(1, ny));
        px = nx * RANGE;
        py = ny * RANGE * 0.9;
        lastMove = Date.now();
        stopIdle();
        schedule();
    }

    function onMouse(e) {
        if (focused || reduceMotion) return; // a field is focused — watch it, not the cursor
        // Direction relative to the cup itself, so the pupils point exactly
        // at the cursor no matter where the cup sits on the screen.
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        setLook((e.clientX - cx) / (window.innerWidth / 2), (e.clientY - cy) / (window.innerHeight / 2));
    }

    // Touch: the cup follows the finger like it would a cursor. Uses the
    // visual viewport when the keyboard shrinks the screen.
    function onTouch(e) {
        if (focused || reduceMotion) return;
        var touch = e.touches && e.touches[0];
        if (!touch) return;
        var vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
        var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : vw / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : vh / 2;
        setLook((touch.clientX - cx) / (vw / 2), (touch.clientY - cy) / (vh / 2));
    }

    // While a field is focused the eyes lock onto that field — that is what
    // makes the cup "watch" while the user types their username/password.
    // Cursor and finger tracking resume once nothing is focused.
    function onFocusIn(e) {
        if (reduceMotion) return;
        var target = e.target;
        if (!target || typeof target.getBoundingClientRect !== "function") return;
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        focused = true;
        activeInput = target;
        cup.classList.add("peek-focused");
        if (target.tagName === "INPUT" && typeof target.selectionStart === "number") {
            ensureMirror();
            cacheInputMetrics(target);
            refreshCaret();
        } else {
            lookAtFieldCenter(target);
        }
    }

    function onFocusOut(e) {
        if (!focused) return;
        var next = e.relatedTarget;
        if (next && /^(INPUT|TEXTAREA|SELECT)$/.test(next.tagName)) return; // jumped to another field — keep locked
        focused = false;
        activeInput = null;
        cup.classList.remove("peek-focused");
        stopIdle();
        schedule(); // re-apply current look; the cursor resumes on the next move
    }

    // --- Caret tracking -----------------------------------------------------
    // A hidden span copies the input's font metrics and holds the text before
    // the caret; its width locates the caret inside the field.
    function ensureMirror() {
        if (mirror) return;
        mirror = document.createElement("span");
        mirror.setAttribute("aria-hidden", "true");
        mirror.style.cssText = "position:absolute;visibility:hidden;white-space:pre;pointer-events:none;left:0;top:0;";
        document.body.appendChild(mirror);
    }

    function cacheInputMetrics(input) {
        var cs = getComputedStyle(input);
        mirrorCss = {
            font: cs.font,
            paddingLeft: parseFloat(cs.paddingLeft) || 0,
            borderLeft: parseFloat(cs.borderLeftWidth) || 0,
            letterSpacing: cs.letterSpacing,
            textTransform: cs.textTransform
        };
    }

    function refreshCaret() {
        if (!focused || !activeInput) return;
        var t = caretTarget(activeInput);
        if (!t) return; // keep the last look
        lookAt(t);
    }

    function caretTarget(input) {
        if (!mirror || !mirrorCss) return null;
        var start;
        try { start = input.selectionStart; } catch (err) { return null; }
        if (typeof start !== "number" || start < 0) return null;
        // Masked password dots advance like the real characters, so mirror a
        // bullet per character instead of the raw text.
        var text = input.type === "password"
            ? new Array(start + 1).join("\u2022")
            : String(input.value || "").slice(0, start);
        mirror.style.font = mirrorCss.font;
        mirror.style.letterSpacing = mirrorCss.letterSpacing;
        mirror.style.textTransform = mirrorCss.textTransform;
        mirror.textContent = text;
        var r = input.getBoundingClientRect();
        return {
            x: r.left + mirrorCss.paddingLeft + mirrorCss.borderLeft + mirror.offsetWidth,
            y: r.top + r.height / 2
        };
    }

    function lookAt(t) {
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        setLook((t.x - cx) / (window.innerWidth / 2), (t.y - cy) / (window.innerHeight / 2));
    }

    function lookAtFieldCenter(target) {
        var r = target.getBoundingClientRect();
        lookAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }

    function updateAway(isAway) {
        if (away === isAway) return;
        away = isAway;
        cup.classList.toggle("peek-away", isAway);
        apply();
        if (isAway) {
            stopIdle();
        } else {
            lastMove = 0;
            // Back to watching: snap straight onto the caret again.
            if (focused) {
                refreshCaret();
            } else {
                schedule();
            }
            startIdle();
        }
    }

    // Gentle random drift while nobody is touching the page.
    function startIdle() {
        if (reduceMotion) return;
        stopIdle();
        idleTimer = setInterval(function () {
            if (Date.now() - lastMove < 3000) return; // recently active — keep last look
            idlePhase = (idlePhase + 0.7) % (Math.PI * 2);
            px = Math.sin(idlePhase) * RANGE;
            py = Math.cos(idlePhase * 0.6) * RANGE * 0.6;
            schedule();
        }, 1200);
    }

    function stopIdle() {
        if (idleTimer) {
            clearInterval(idleTimer);
            idleTimer = null;
        }
    }

    function passwordVisible() {
        var input = document.getElementById("password");
        return !!input && input.type === "text";
    }

    document.addEventListener("mousemove", onMouse);
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("touchmove", onTouch, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("input", function (e) {
        if (e.target === activeInput) refreshCaret();
    });
    document.addEventListener("selectionchange", function () {
        if (activeInput && document.activeElement === activeInput) refreshCaret();
    });
    document.addEventListener("click", function (e) {
        if (e.target && e.target.closest && e.target.closest(".password-toggle")) {
            updateAway(passwordVisible());
        }
    });

    // Browser password managers flip the input type without our click —
    // watch the attribute so the cup still reacts.
    var passwordInput = document.getElementById("password");
    if (passwordInput && window.MutationObserver) {
        var observer = new MutationObserver(function () {
            updateAway(passwordVisible());
        });
        observer.observe(passwordInput, { attributes: true, attributeFilter: ["type"] });
    }

    apply();
    startIdle();
})();