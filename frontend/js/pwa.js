(() => {
    const installButton = document.querySelector("[data-pwa-install]");
    if (installButton) {
        let installPrompt = null;
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
            || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isInstalled = window.matchMedia("(display-mode: standalone)").matches
            || navigator.standalone === true;

        if (isInstalled) {
            installButton.hidden = true;
        } else {
            const helpDialog = document.createElement("dialog");
            helpDialog.className = "pwa-install-help";
            helpDialog.setAttribute("aria-labelledby", "pwaInstallHelpTitle");
            helpDialog.innerHTML = `
                <h2 id="pwaInstallHelpTitle"></h2>
                <p></p>
                <button type="button">Got it</button>`;
            document.body.appendChild(helpDialog);
            helpDialog.querySelector("button").addEventListener("click", () => helpDialog.close());

            function showInstallHelp() {
                const title = helpDialog.querySelector("h2");
                const message = helpDialog.querySelector("p");
                if (isIos) {
                    title.textContent = "Add Season 3 POS to your Home Screen";
                    message.textContent = "In Safari, tap Share, scroll the menu, then tap Add to Home Screen and confirm.";
                } else {
                    title.textContent = "Install Season 3 POS";
                    message.textContent = "Open your browser menu and choose Install app or Add to Home screen. If you do not see that option, confirm you are using a supported browser and reload the site while online.";
                }
                if (typeof helpDialog.showModal === "function") {
                    helpDialog.showModal();
                } else {
                    window.alert(message.textContent);
                }
            }

            window.addEventListener("beforeinstallprompt", event => {
                event.preventDefault();
                installPrompt = event;
            });

            window.addEventListener("appinstalled", () => {
                installPrompt = null;
                installButton.hidden = true;
            });

            installButton.addEventListener("click", async () => {
                if (!installPrompt) {
                    showInstallHelp();
                    return;
                }

                installPrompt.prompt();
                await installPrompt.userChoice;
                installPrompt = null;
            });
        }
    }

    if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
        const registerAppWorker = async () => {
            const registrations = await navigator.serviceWorker.getRegistrations();
            const cashierWorker = registrations.find(registration =>
                new URL(registration.scope).pathname === "/CASHIER/"
            );
            if (cashierWorker) await cashierWorker.unregister();
            return navigator.serviceWorker.register("/sw.js", { scope: "/" });
        };

        registerAppWorker().catch(error => {
            console.error("PWA service worker registration failed:", error);
        });
    }
})();
