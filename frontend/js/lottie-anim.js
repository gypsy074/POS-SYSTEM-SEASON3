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

    window.PosLottie = { enhanceSuccessIcon, mountCartEmpty };
})();