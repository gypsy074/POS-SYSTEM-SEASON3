(function () {
    "use strict";

    const MIN_PASSWORD_CHARACTERS = 8;
    const MAX_PASSWORD_BYTES = 72;
    const COMMON_PASSWORDS = new Set([
        "12345678",
        "123456789",
        "1234567890",
        "admin",
        "admin123",
        "abc12345",
        "baseball",
        "changeme",
        "dragon",
        "football",
        "hello",
        "iloveyou",
        "letmein",
        "letmein123",
        "master",
        "monkey",
        "password",
        "password1",
        "password123",
        "passw0rd",
        "princess",
        "qwerty",
        "qwerty123",
        "sunshine",
        "trustno1",
        "welcome",
        "welcome1"
    ]);
    const COMMON_PASSWORD_PREFIXES = [
        "123456",
        "abc123",
        "admin",
        "baseball",
        "changeme",
        "dragon",
        "football",
        "hello",
        "iloveyou",
        "letmein",
        "master",
        "monkey",
        "password",
        "passw0rd",
        "princess",
        "qwerty",
        "sunshine",
        "trustno1",
        "welcome"
    ];

    function normalizeForComparison(value) {
        return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    window.getPosPasswordPolicyError = function (password, username = "") {
        if (typeof password !== "string") return "Password must be text.";
        if (Array.from(password).length < MIN_PASSWORD_CHARACTERS) {
            return `Password must be at least ${MIN_PASSWORD_CHARACTERS} characters.`;
        }
        if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
            return `Password must be no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
        }

        const normalizedPassword = normalizeForComparison(password);
        const normalizedUsername = normalizeForComparison(username);
        if (normalizedUsername && normalizedPassword === normalizedUsername) {
            return "Password must not be the same as the username.";
        }
        if (COMMON_PASSWORDS.has(normalizedPassword)
            || COMMON_PASSWORD_PREFIXES.some(prefix => normalizedPassword.startsWith(prefix))) {
            return "Choose a less common password.";
        }
        if (normalizedPassword.includes("season3")) return "Password must not contain the cafe name.";
        return "";
    };

    window.getPosPasswordStrength = function (password, username = "") {
        if (!password) return { level: "", score: 0, message: "" };

        const policyError = window.getPosPasswordPolicyError(password, username);
        if (policyError) return { level: "weak", score: 1, message: policyError };

        if (new Set(Array.from(password)).size < 4) {
            return {
                level: "weak",
                score: 1,
                message: "Avoid passwords made from highly repetitive characters."
            };
        }

        if (Array.from(password).length < 12) {
            return {
                level: "fair",
                score: 2,
                message: "Meets the password rules. A longer passphrase is harder to guess."
            };
        }

        return {
            level: "strong",
            score: 3,
            message: "Good length. Symbols are optional."
        };
    };

    window.setupPosPasswordStrength = function (input, indicator, getUsername = () => "") {
        if (!input || !indicator) return () => {};

        const label = indicator.querySelector("[data-strength-label]");
        const message = indicator.querySelector("[data-strength-message]");
        const segments = Array.from(indicator.querySelectorAll("[data-strength-segment]"));
        const labels = { weak: "Weak", fair: "Fair", strong: "Strong" };

        function update() {
            const result = window.getPosPasswordStrength(input.value, getUsername());
            indicator.hidden = !input.value;
            indicator.dataset.strength = result.level;
            if (label) label.textContent = labels[result.level] || "";
            if (message) message.textContent = result.message;
            segments.forEach((segment, index) => {
                segment.classList.toggle("is-active", index < result.score);
            });
        }

        input.addEventListener("input", update);
        update();
        return update;
    };

    if (typeof document !== "undefined" && !document.getElementById("pos-password-strength-styles")) {
        const style = document.createElement("style");
        style.id = "pos-password-strength-styles";
        style.textContent = `
.password-strength{display:grid;grid-template-columns:minmax(90px,auto) 1fr;align-items:center;gap:7px 12px;
    margin-top:5px;padding:10px 12px;border:1px solid #eadfd3;border-radius:10px;background:#fbf6f0}
.password-strength[hidden]{display:none}
.password-strength__summary{display:flex;align-items:center;gap:6px;color:#5a493a;font-size:12px}
.password-strength__label{font-weight:700}
.password-strength__track{display:flex;gap:4px}
.password-strength__track span{height:6px;flex:1;border-radius:999px;background:#e8dfd5;transition:background .18s ease}
.password-strength__track span.is-active{background:#dc2626}
.password-strength[data-strength="fair"] .password-strength__track span.is-active{background:#d97706}
.password-strength[data-strength="strong"] .password-strength__track span.is-active{background:#16a34a}
.password-strength[data-strength="weak"] .password-strength__label{color:#b91c1c}
.password-strength[data-strength="fair"] .password-strength__label{color:#b45309}
.password-strength[data-strength="strong"] .password-strength__label{color:#15803d}
.password-strength__message{grid-column:1/-1;color:#806e5d;font-size:11.5px;line-height:1.4}
body.dark .password-strength{border-color:#514131;background:#241c15}
body.dark .password-strength__summary{color:#e1d1be}
body.dark .password-strength__message{color:#b8a895}
body.dark .password-strength__track span{background:#514131}
body.dark .password-strength[data-strength="weak"] .password-strength__label{color:#ff8585}
body.dark .password-strength[data-strength="weak"] .password-strength__track span.is-active{
    background:#ff5c5c;box-shadow:0 0 7px rgba(255,92,92,.42)}
body.dark .password-strength[data-strength="fair"] .password-strength__label{color:#fcd34d}
body.dark .password-strength[data-strength="strong"] .password-strength__label{color:#86efac}
@media(max-width:480px){.password-strength{grid-template-columns:1fr;gap:6px}}
`;
        document.head.appendChild(style);
    }
})();
