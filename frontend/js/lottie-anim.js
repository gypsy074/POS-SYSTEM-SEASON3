/* ==========================================================================
   PosLottie — small Lottie touches for the cashier POS.
   Loads vendor/lottie.min.js lazily (only when an animation is actually
   used), so the page weight and offline shell stay untouched until needed.
   If the library or an animation fails for any reason, the original static
   icons remain in place — every entry point is fail-safe.
   ========================================================================== */

(function () {
    const LIB_URL = "../vendor/lottie.min.js";
    let libPromise = null;

    function loadLib() {
        if (window.lottie && typeof window.lottie.loadAnimation === "function") {
            return Promise.resolve();
        }
        if (!libPromise) {
            libPromise = new Promise((resolve, reject) => {
                const tag = document.createElement("script");
                tag.src = LIB_URL;
                tag.onload = resolve;
                tag.onerror = () => { libPromise = null; reject(new Error("lottie lib unavailable")); };
                document.head.appendChild(tag);
            });
        }
        return libPromise;
    }

    /* ---- animation data (hand-authored, brand colors) ---- */

    const easeOut = { i: { x: 0.25, y: 1 }, o: { x: 0.45, y: 0 } };
    const stat = k => ({ a: 0, k });
    const fill = c => ({ ty: "fl", c: stat(c), o: stat(100) });
    const stroke = (c, w) => ({ ty: "st", c: stat(c), o: stat(100), w: stat(w), lc: 2, lj: 2 });
    const trItem = () => ({ ty: "tr", p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(100) });
    const group = items => ({ ty: "gr", it: items.concat([trItem()]) });
    const layer = (nm, ind, op, shapes, ks) => ({
        ddd: 0, ind, ty: 4, nm, sr: 1,
        ks: Object.assign({ o: stat(100), r: stat(0), p: stat([0, 0, 0]), a: stat([0, 0, 0]), s: stat([100, 100, 100]) }, ks || {}),
        ao: 0, shapes, ip: 0, op, st: 0, bm: 0
    });
    const anim = (w, h, op, layers) => ({ v: "5.7.4", fr: 60, ip: 0, op, w, h, ddd: 0, assets: [], layers });

    function successData() {
        return anim(240, 240, 90, [
            layer("check", 2, 90, [
                { ty: "tm", s: stat(0), e: { a: 1, k: [{ t: 14, s: [0] }, Object.assign({ t: 38, s: [100] }, easeOut)] }, o: stat(0), m: 1 },
                { ty: "sh", ks: stat({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[84, 124], [109, 149], [157, 99]], c: false }) },
                stroke([1, 1, 1, 1], 13)
            ], { o: { a: 1, k: [{ t: 76, s: [100] }, { t: 86, s: [0] }] } }),
            layer("circle", 1, 90, [
                group([(({ ty: "el", p: stat([120, 120]), s: stat([150, 150]) })), fill([0.18, 0.49, 0.196, 1])])
            ], {
                s: { a: 1, k: [{ t: 0, s: [0, 0, 100] }, Object.assign({ t: 16, s: [114, 114, 100] }, easeOut), { t: 26, s: [100, 100, 100] }] },
                o: { a: 1, k: [{ t: 76, s: [100] }, { t: 86, s: [0] }] }
            })
        ]);
    }

    function cartData(strokeRgb, bodyRgb) {
        return anim(240, 210, 60, [
            layer("cart", 1, 60, [
                group([{ ty: "el", p: stat([92, 160]), s: stat([22, 22]) }].concat([stroke(strokeRgb, 9)])),
                group([{ ty: "el", p: stat([148, 160]), s: stat([22, 22]) }].concat([stroke(strokeRgb, 9)])),
                group([
                    { ty: "sh", ks: stat({ i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], v: [[62, 82], [178, 82], [162, 134], [78, 134]], c: true }) },
                    fill(bodyRgb),
                    stroke(strokeRgb, 10)
                ]),
                group([
                    { ty: "sh", ks: stat({ i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], v: [[178, 82], [198, 56]], c: false }) },
                    stroke(strokeRgb, 10)
                ])
            ], {
                r: { a: 1, k: [{ t: 0, s: [-6] }, Object.assign({ t: 28, s: [6] }, { i: { x: 0.42, y: 1 }, o: { x: 0.58, y: 0 } }), { t: 56, s: [-6] }] },
                a: stat([120, 110, 0]),
                p: stat([120, 110, 0])
            })
        ]);
    }

    // Cup + three staggered steam wisps — shown while the menu loads.
    function coffeeData() {
        const steamColor = [0.761, 0.565, 0.369, 1];
        const ease = { i: { x: 0.42, y: 1 }, o: { x: 0.58, y: 0 } };
        const wispShape = {
            ty: "sh",
            ks: stat({
                i: [[0, 0], [-5, -3], [4, -4], [-4, -3]],
                o: [[0, 0], [5, 3], [-4, -4], [4, 3]],
                v: [[0, 0], [-5, -8], [3, -16], [-2, -24]],
                c: false
            })
        };
        const wispLayer = (ind, x, delay) => layer("steam" + ind, ind, 56, [
            group([wispShape, stroke(steamColor, 7)])
        ], {
            p: { a: 1, k: [
                { t: delay, s: [x, 74, 0] },
                Object.assign({ t: delay + 26, s: [x, 46, 0] }, ease),
                { t: 56, s: [x, 46, 0] }
            ] },
            o: { a: 1, k: [
                { t: delay, s: [0] },
                Object.assign({ t: delay + 8, s: [85] }, ease),
                Object.assign({ t: delay + 30, s: [0] }, ease),
                { t: 56, s: [0] }
            ] }
        });
        return anim(200, 150, 56, [
            wispLayer(3, 118, 16),
            wispLayer(2, 99, 8),
            wispLayer(1, 80, 0),
            layer("handle", 4, 56, [
                group([{ ty: "el", p: stat([146, 102]), s: stat([30, 30]) }, stroke([0.42, 0.31, 0.231, 1], 9)])
            ]),
            layer("cup", 5, 56, [
                group([{ ty: "rc", p: stat([100, 106]), s: stat([84, 58]), r: stat(14) }, fill([0.651, 0.486, 0.322, 1])])
            ])
        ]);
    }

    // One-shot sparkle used when switching dark mode on/off.
    function burstData(rgb) {
        const rays = [];
        for (let i = 0; i < 8; i++) {
            const ang = Math.PI * i / 4;
            const c = Math.cos(ang), s = Math.sin(ang);
            rays.push({
                ty: "sh",
                ks: stat({
                    i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]],
                    v: [[60 + c * 20, 60 + s * 20], [60 + c * 46, 60 + s * 46]],
                    c: false
                })
            });
        }
        const easeOutK = { i: { x: 0.2, y: 1 }, o: { x: 0.4, y: 0 } };
        return anim(120, 120, 34, [
            layer("rays", 1, 34, [group(rays.concat([stroke(rgb, 9)]))], {
                r: { a: 1, k: [{ t: 0, s: [0] }, Object.assign({ t: 32, s: [150] }, easeOutK)] },
                s: { a: 1, k: [{ t: 0, s: [130, 130, 100] }, Object.assign({ t: 32, s: [40, 40, 100] }, easeOutK)] },
                o: { a: 1, k: [{ t: 0, s: [100] }, Object.assign({ t: 32, s: [0] }, easeOutK)] }
            })
        ]);
    }

    // Dot + two expanding rings — mirrors the status pill's waking state.
    function pulseData(liveRgb) {
        const ring = (ind, delay) => layer("ring" + ind, ind, 70, [
            group([{ ty: "el", p: stat([70, 70]), s: stat([34, 34]) }, stroke(liveRgb, 6)])
        ], {
            s: { a: 1, k: [{ t: delay, s: [80, 80, 100] }, Object.assign({ t: delay + 44, s: [280, 280, 100] }, easeOut)] },
            o: { a: 1, k: [{ t: delay, s: [85] }, Object.assign({ t: delay + 44, s: [0] }, easeOut)] }
        });
        return anim(140, 140, 70, [
            layer("dot", 3, 70, [
                group([{ ty: "el", p: stat([70, 70]), s: stat([26, 26]) }, fill(liveRgb)])
            ]),
            ring(2, 18),
            ring(1, 0)
        ]);
    }

    /* ---- mounting helpers ---- */

    async function mountInto(container, dataFactory) {
        if (!container || container.dataset.lottie === "1") return;
        try {
            await loadLib();
        } catch (err) {
            return; // offline / blocked → static fallback stays
        }
        if (!container.isConnected || container.dataset.lottie === "1") return;
        container.dataset.lottie = "1";
        try {
            window.lottie.loadAnimation({
                container,
                renderer: "svg",
                loop: true,
                autoplay: true,
                animationData: dataFactory()
            });
        } catch (err) {
            delete container.dataset.lottie;
        }
    }

    // Replaces the static check circle inside .pos-modal-success-icon with
    // the animated one. Called only after the library is confirmed, so a
    // failure leaves the original icon untouched.
    function enhanceSuccessIcon(iconEl) {
        if (!iconEl || iconEl.classList.contains("lottified")) return;
        loadLib().then(() => {
            if (!iconEl.isConnected || iconEl.classList.contains("lottified") ||
                !(window.lottie && typeof window.lottie.loadAnimation === "function")) return;
            iconEl.classList.add("lottified");
            iconEl.innerHTML = "";
            const holder = document.createElement("div");
            holder.className = "pos-modal-success-icon-lottie";
            iconEl.appendChild(holder);
            mountInto(holder, successData);
        }).catch(() => {});
    }

    function mountCartEmpty(el) {
        const dark = document.body.classList.contains("dark");
        // Dark-brown strokes vanish on the dark drawer — use the light accent there.
        const strokeRgb = dark ? [0.761, 0.565, 0.369, 1] : [0.42, 0.31, 0.231, 1];
        const bodyRgb = dark ? [0.18, 0.153, 0.125, 1] : [0.992, 0.953, 0.922, 1];
        mountInto(el, () => cartData(strokeRgb, bodyRgb));
    }

    // Menu loading state. The loader lives inside #menuGrid, so the next
    // render wipes it automatically — no manual teardown needed.
    function showMenuLoader(gridEl) {
        if (!gridEl || gridEl.querySelector(".menu-lottie")) return;
        const wrap = document.createElement("div");
        wrap.className = "menu-lottie";
        const holder = document.createElement("div");
        holder.className = "menu-lottie-holder";
        const label = document.createElement("p");
        label.textContent = "Brewing your menu…";
        wrap.appendChild(holder);
        wrap.appendChild(label);
        gridEl.innerHTML = "";
        gridEl.appendChild(wrap);
        mountInto(holder, coffeeData);
    }

    // One-shot sparkle over a button (e.g. the dark-mode toggle). Plays once
    // and removes itself; falls back to a timer in case "complete" never fires.
    function playThemeBurst(btnEl) {
        if (!btnEl) return;
        loadLib().then(() => {
            if (!(window.lottie && typeof window.lottie.loadAnimation === "function")) return;
            const old = btnEl.querySelector(".theme-burst-holder");
            if (old) old.remove();
            const holder = document.createElement("span");
            holder.className = "theme-burst-holder";
            btnEl.appendChild(holder);
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                try { instance.destroy(); } catch (e) {}
                holder.remove();
            };
            let instance;
            try {
                instance = window.lottie.loadAnimation({
                    container: holder,
                    renderer: "svg",
                    loop: false,
                    autoplay: true,
                    animationData: burstData([0.761, 0.565, 0.369, 1])
                });
                instance.addEventListener("complete", finish);
            } catch (err) {
                finish();
                return;
            }
            setTimeout(finish, 900);
        }).catch(() => {});
    }

    // Expanding rings behind the status dot while the server is waking.
    function setPillWaking(statusEl, waking) {
        if (!statusEl) return;
        const dot = statusEl.querySelector(".status-dot");
        if (!dot) return;
        const existing = dot.querySelector(".status-pill-pulse");
        if (waking) {
            if (existing || !window.PosLottie) return;
            loadLib().then(() => {
                if (!(window.lottie && typeof window.lottie.loadAnimation === "function")) return;
                if (dot.querySelector(".status-pill-pulse")) return;
                const holder = document.createElement("span");
                holder.className = "status-pill-pulse";
                dot.appendChild(holder);
                mountInto(holder, () => pulseData([0.086, 0.639, 0.29, 1]));
            }).catch(() => {});
        } else if (existing) {
            existing.remove();
        }
    }

    window.PosLottie = { enhanceSuccessIcon, mountCartEmpty, showMenuLoader, playThemeBurst, setPillWaking };
})();