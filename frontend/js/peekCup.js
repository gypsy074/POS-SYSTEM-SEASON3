/* ==========================================================================
   peekCup.js — Peek-a-boo coffee cup character for the login page.
   The cup's pupils follow the cursor; on touch devices (no cursor) they
   follow whichever field is focused. While the password is being typed the
   cup keeps watching, but the moment the password is revealed (Show
   password / a browser password manager) the cup looks away and half-closes
   its eyes. Reduced-motion users get a still, polite cup.
   ========================================================================== */

(function () {
    var cup = document.getElementById("peekCup");
    if (!cup) return;
    var pupils = cup.querySelectorAll(".peek-pupil");
    if (!pupils.length) return;

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

    var RANGE = 5;            // max pupil travel in px (inner eye 16px - 6px pupil / 2)
    var away = false;         // looking away (password revealed)
    var px = 0, py = 0;       // applied pupil offset in px
    var lastMove = 0;
    var rafPending = false;
    var idleTimer = null;
    var idlePhase = 0;
    var cupRect = null;

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
        // While the password is revealed the cup refuses to peek: the pupils
        // point the opposite way of the cursor (cursor bottom -> eyes look up).
        var dx = away ? -px : px;
        var dy = away ? -py : py;
        var t = "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px)";
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
        if (reduceMotion) return;
        // Direction relative to the cup itself, so the pupils point exactly
        // at the cursor no matter where the cup sits on the screen.
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        setLook((e.clientX - cx) / (window.innerWidth / 2), (e.clientY - cy) / (window.innerHeight / 2));
    }

    // Touch: the cup follows the finger like it would a cursor. Uses the
    // visual viewport when the keyboard shrinks the screen.
    function onTouch(e) {
        if (reduceMotion) return;
        var touch = e.touches && e.touches[0];
        if (!touch) return;
        var vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
        var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : vw / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : vh / 2;
        setLook((touch.clientX - cx) / (vw / 2), (touch.clientY - cy) / (vh / 2));
    }

    // Touch fallback: watch the focused field instead of a cursor.
    // Only for coarse pointers — on desktop the cursor is the source of truth
    // (focusing the password field while clicking the toggle must not move
    // the pupils off their cursor-based direction).
    function onFocusIn(e) {
        if (away || reduceMotion || !coarsePointer) return;
        var target = e.target;
        if (!target || typeof target.getBoundingClientRect !== "function") return;
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        var r = target.getBoundingClientRect();
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        setLook(((r.left + r.width / 2) - cx) / (window.innerWidth / 2), ((r.top + r.height / 2) - cy) / (window.innerHeight / 2));
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
            schedule();
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