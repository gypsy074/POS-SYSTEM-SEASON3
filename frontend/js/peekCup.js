/* ==========================================================================
   peekCup.js — Peek-a-boo coffee cup character for the login page.
   Idle: steam rises off the coffee, the pupils follow the cursor (finger on
   touch screens), and after a long stretch without input the cup yawns and
   dozes off until touched again. Focusing the username makes the cup lean
   in attentively and track the caret; typing the password puts it in
   cautious-sneaky mode (half-lidded squint, tight mouth, arms tucked, a
   nervous sweat drop every so often); Caps Lock in the password field gets
   a worried little O mouth; hovering the Log In button draws the eyes to
   it. The moment the password is revealed the cup startles, then goes lazy
   (slouched, arms loose, serious face, steam stops) and holds its gaze up
   and away from the field — no cursor, finger or idle drift can pull it
back — but every few seconds it sneaks a squinting glance at the
    password text, leaning toward it, then looks away again (sometimes a
    cheeky double-take), with restless open-eyed darts to the other side
    in between. Failed logins react by kind: empty fields get an
   annoyed shake, invalid credentials a disappointed slump with a coffee
   sputter, connection failures a quiet worried look. A successful login
   gets one happy hop with a heart puff before the transition overlay.
   Tiny WebAudio blips accompany the key moments (no audio files).
   Reduced-motion users get a still, quiet, polite cup.
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
    var denied = false;       // login failed — sad slump, eyes down
    var activeInput = null;   // the focused field the eyes are watching
    var px = 0, py = 0;       // applied pupil offset in px
    var lastMove = 0;
    var idleTimer = null;
    var deniedTimer = null;
    var glanceTimer = null;
    var glanceHold = null;
    var startleTimer = null;
    var sweatTimer = null;
    var sweatHold = null;
    var sideTimer = null;
    var sideHold = null;
    var eyeBusy = false;      // a sneaky glance or a restless dart holds the eyes
    var lastActivity = Date.now();
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
        var t = "translate(" + px.toFixed(2) + "px," + py.toFixed(2) + "px)";
        for (var i = 0; i < pupils.length; i++) {
            pupils[i].style.transform = t;
        }
    }

    function schedule() {
        if (reduceMotion) return;
        apply();
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
        if (focused || away || reduceMotion) return; // a field is focused — watch it, not the cursor
        // Direction relative to the cup itself, so the pupils point exactly
        // at the cursor no matter where the cup sits on the screen.
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        setLook((e.clientX - cx) / (window.innerWidth / 2), (e.clientY - cy) / (window.innerHeight / 2));
    }

    // Touch: the cup follows the finger like it would a cursor. Uses the
    // visual viewport when the keyboard shrinks the screen.
    function onTouch(e) {
        if (focused || away || reduceMotion) return;
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
        cup.classList.toggle("peek-pw", target.id === "password");
        if (target.id === "password" && !away) startSweat();
        recoverDenied();
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
        stopSweat();
        cup.classList.remove("peek-focused");
        cup.classList.remove("peek-pw");
        cup.classList.remove("peek-caps");
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
        if (!focused || !activeInput || away || denied) return;
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
            stopSweat();
            // The password is showing — the cup startles, then looks away,
            // up and off to the side, politely not watching. It holds that
            // gaze (even if the cursor moves) until the password is masked
            // again, and sneaks the occasional glance at the field between.
            if (!reduceMotion) {
                setLook(0.5, -0.8);
                startGlance();
                scheduleSideDart(true);
                cup.classList.add("peek-startle");
                clearTimeout(startleTimer);
                startleTimer = setTimeout(function () {
                    cup.classList.remove("peek-startle");
                }, 400);
                blip(1300, 0.06, "sine", 0.03);
            }
        } else {
            stopGlance();
            lastMove = 0;
            blip(950, 0.05, "sine", 0.025);
            if (focused && activeInput && activeInput.id === "password") startSweat();
            // Back to watching: snap straight onto the caret again.
            if (focused) {
                refreshCaret();
            } else {
                px = 0;
                py = 0;
                schedule();
            }
            startIdle();
        }
    }

    // While the password is shown the cup sneaks a quick glance at the
    // visible text every so often — squinting through half-lidded eyes —
    // then looks away again: lazy body, alert eyes. Sometimes it cannot
    // resist a second peek (a double-take) before settling. Between these
    // peeks the eyes also dart restlessly off to the other side now and
    // then, like a person who cannot hold still — never squinting, and
    // never at the field.
    function startGlance() {
        stopGlance();
        glanceTimer = setTimeout(glanceOnce, 1500);
    }

    function glanceOnce() {
        if (!away) return;
        if (eyeBusy) {
            glanceTimer = setTimeout(glanceOnce, 250);
            return;
        }
        var input = document.getElementById("password");
        if (!input) return;
        eyeBusy = true;
        cup.classList.add("peek-glance");
        glanceAtText(input);
        glanceHold = setTimeout(function () {
            if (!away) return;
            setLook(0.5, -0.8);
            cup.classList.remove("peek-glance");
            if (Math.random() < 0.25) {
                // quick double-take: one more short peek before settling
                glanceHold = setTimeout(function () {
                    if (!away) return;
                    cup.classList.add("peek-glance");
                    glanceAtText(input);
                    glanceHold = setTimeout(function () {
                        eyeBusy = false;
                        if (away) setLook(0.5, -0.8);
                        cup.classList.remove("peek-glance");
                        glanceTimer = setTimeout(glanceOnce, 2200 + Math.random() * 1400);
                    }, 180);
                }, 160);
            } else {
                eyeBusy = false;
                glanceTimer = setTimeout(glanceOnce, 2200 + Math.random() * 1400);
            }
        }, 240);
    }

    // Aim the pupils at the centre of the revealed password text (or the
    // field's centre when it is empty) — a sneaky look that actually reads.
    function glanceAtText(input) {
        var r = input.getBoundingClientRect();
        var cx = cupRect ? cupRect.left + cupRect.width / 2 : window.innerWidth / 2;
        var cy = cupRect ? cupRect.top + cupRect.height / 2 : window.innerHeight / 2;
        var x = r.left + r.width / 2;
        var value = String(input.value || "");
        if (value && mirror && mirrorCss) {
            mirror.style.font = mirrorCss.font;
            mirror.style.letterSpacing = mirrorCss.letterSpacing;
            mirror.style.textTransform = mirrorCss.textTransform;
            mirror.textContent = value;
            x = r.left + mirrorCss.paddingLeft + mirrorCss.borderLeft + mirror.offsetWidth / 2;
        }
        setLook((x - cx) / (window.innerWidth / 2), (r.top + r.height / 2 - cy) / (window.innerHeight / 2));
    }

    function stopGlance() {
        if (glanceTimer) {
            clearTimeout(glanceTimer);
            clearInterval(glanceTimer);
            glanceTimer = null;
        }
        if (glanceHold) {
            clearTimeout(glanceHold);
            glanceHold = null;
        }
        if (sideTimer) {
            clearTimeout(sideTimer);
            sideTimer = null;
        }
        if (sideHold) {
            clearTimeout(sideHold);
            sideHold = null;
        }
        eyeBusy = false;
        cup.classList.remove("peek-glance");
    }

    // Occasional restless dart to the OTHER side — never at the password
    // (which sits down-centre of the cup). The held gaze is up-right, so
    // most darts flick left; the eyes snap back to the averted hold after.
    // Plain open eyes: the squint and body-lean belong to the sneak peek.
    function scheduleSideDart(first) {
        clearTimeout(sideTimer);
        sideTimer = setTimeout(dartOnce, first ? 1200 : 1000 + Math.random() * 2200);
    }

    function dartOnce() {
        if (!away) return;
        if (eyeBusy) {
            scheduleSideDart(false);
            return;
        }
        var targets = [
            [-1, -1],      // up-left
            [-1, -0.33],   // far left, mid
            [-1, 0],       // straight left
            [-0.3, -1],    // high up-left
            [1, -1]        // far up-right (the other side entirely)
        ];
        var t = targets[Math.floor(Math.random() * targets.length)];
        eyeBusy = true;
        setLook(t[0], t[1]);
        sideHold = setTimeout(function () {
            sideHold = null;
            eyeBusy = false;
            if (away) setLook(0.5, -0.8);
            scheduleSideDart(false);
        }, 160 + Math.random() * 160);
    }

    // --- Idle-to-sleep: after a long stretch without any input the cup
    // yawns slowly, then dozes with droopy lids until touched again. ---
    function bumpActivity() {
        lastActivity = Date.now();
        if (cup.classList.contains("peek-yawn") || cup.classList.contains("peek-sleepy")) {
            cup.classList.remove("peek-yawn", "peek-sleepy");
        }
    }

    function doYawn() {
        if (away || denied || reduceMotion) return;
        cup.classList.add("peek-yawn");
        setTimeout(function () {
            cup.classList.remove("peek-yawn");
            if (Date.now() - lastActivity > 8000 && !away && !denied) {
                cup.classList.add("peek-sleepy");
            }
        }, 1600);
    }

    // A nervous sweat drop appears beside the cup every so often while the
    // password is being typed (and hidden again once it is masked/revealed).
    function startSweat() {
        stopSweat();
        sweatTimer = setInterval(function () {
            cup.classList.add("peek-sweat-on");
            clearTimeout(sweatHold);
            sweatHold = setTimeout(function () {
                cup.classList.remove("peek-sweat-on");
            }, 1200);
        }, 6000);
    }

    function stopSweat() {
        if (sweatTimer) {
            clearInterval(sweatTimer);
            sweatTimer = null;
        }
        if (sweatHold) {
            clearTimeout(sweatHold);
            sweatHold = null;
        }
        cup.classList.remove("peek-sweat-on");
    }

    // --- Soft WebAudio blips (no audio files) for the little moments. ---
    var audio = null;
    function blip(freq, dur, type, vol, delay) {
        try {
            if (reduceMotion) return;
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!audio) audio = new AC();
            if (audio.state === "suspended") audio.resume().catch(function () { });
            var t = audio.currentTime + (delay || 0);
            var o = audio.createOscillator();
            var g = audio.createGain();
            o.type = type || "sine";
            o.frequency.setValueAtTime(freq, t);
            o.connect(g);
            g.connect(audio.destination);
            g.gain.setValueAtTime(vol || 0.04, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.start(t);
            o.stop(t + dur);
        } catch (err) { /* audio is optional */ }
    }

    // A failed login (dispatched by login.js with a kind) triggers the
    // matching body language. Empty fields just get an annoyed shake;
    // invalid credentials slump the cup; a connection failure makes it
    // go quiet and worried. Everything recovers on its own.
    function onDenied(e) {
        if (reduceMotion || denied) return;
        var kind = (e && e.detail && e.detail.kind) || "invalid";
        denied = true;
        stopIdle();
        stopGlance();
        stopSweat();
        clearTimeout(deniedTimer);
        if (kind === "empty") {
            cup.classList.add("peek-nudge");
            deniedTimer = setTimeout(recoverDenied, 700);
            blip(520, 0.07, "square", 0.03);
            return;
        }
        if (kind === "connect") {
            cup.classList.add("peek-worry");
            setLook(-0.4, 0.55);
            deniedTimer = setTimeout(recoverDenied, 2000);
            blip(240, 0.22, "sine", 0.045);
            return;
        }
        cup.classList.add("peek-denied");
        setLook(0, 0.55);
        deniedTimer = setTimeout(recoverDenied, 2500);
        blip(330, 0.16, "triangle", 0.05);
        blip(235, 0.22, "triangle", 0.045, 0.12);
    }

    function recoverDenied() {
        if (!denied) return;
        denied = false;
        cup.classList.remove("peek-denied", "peek-nudge", "peek-worry");
        clearTimeout(deniedTimer);
        deniedTimer = null;
        if (away) return; // still hiding — keep the averted gaze
        if (focused) {
            refreshCaret();
        } else {
            schedule();
            startIdle();
        }
    }

    // Successful login — one happy hop before the transition overlay.
    function onSuccess() {
        if (reduceMotion) return;
        cup.classList.remove("peek-away");
        away = false;
        stopGlance();
        stopSweat();
        clearTimeout(deniedTimer);
        if (denied) {
            denied = false;
            cup.classList.remove("peek-denied", "peek-nudge", "peek-worry");
        }
        stopIdle();
        cup.classList.add("peek-success");
        blip(660, 0.12, "sine", 0.05);
        blip(880, 0.2, "sine", 0.05, 0.1);
        setTimeout(function () {
            cup.classList.remove("peek-success");
            schedule();
            startIdle();
        }, 750);
    }

    // The eyes follow the cursor onto the Log In button when it is hovered.
    function watchLoginButton() {
        var btn = document.getElementById("loginBtn");
        if (!btn) return;
        btn.addEventListener("mouseenter", function () {
            if (reduceMotion || away || denied || btn.disabled) return;
            var r = btn.getBoundingClientRect();
            lookAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        });
        btn.addEventListener("mouseleave", function () {
            if (reduceMotion || away || denied) return;
            if (focused) {
                refreshCaret();
            } else {
                schedule();
                startIdle();
            }
        });
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
    ["mousemove", "touchstart", "touchmove", "click", "keydown"].forEach(function (t) {
        document.addEventListener(t, bumpActivity);
    });
    setInterval(function () {
        if (Date.now() - lastActivity > 8000 && !away && !denied && !reduceMotion &&
            !cup.classList.contains("peek-yawn") && !cup.classList.contains("peek-sleepy")) {
            doYawn();
        }
    }, 1000);
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
    document.addEventListener("cup:denied", onDenied);
    document.addEventListener("cup:success", onSuccess);
    watchLoginButton();

    // Caps Lock in the password field makes the cup look mildly worried.
    function syncCaps(e) {
        cup.classList.toggle("peek-caps", !!(e.getModifierState && e.getModifierState("CapsLock")));
    }
    document.addEventListener("keydown", function (e) {
        if (activeInput && activeInput.id === "password") syncCaps(e);
    });
    document.addEventListener("keyup", function (e) {
        if (activeInput && activeInput.id === "password") syncCaps(e);
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