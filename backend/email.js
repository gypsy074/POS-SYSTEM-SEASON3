// Owner alert email delivery.
// Two transports, chosen automatically:
//  1. Resend HTTP API (RESEND_API_KEY + EMAIL_FROM) — port 443, works from
//     any network, including Render. Preferred.
//  2. SMTP via nodemailer (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) — for
//     Gmail/other providers. The host is pinned to an IPv4 literal because
//     Render cannot reach Gmail over IPv6.
// When neither is configured, sends are skipped and isEmailConfigured()
// reports false so the admin UI can show the state.

const nodemailer = require("nodemailer");
const dns = require("dns");

let transporterPromise = null;

function isEmailConfigured() {
    return Boolean(
        (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) ||
        (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    );
}

// Resolve the SMTP host to a literal IPv4 address and connect to that.
// nodemailer resolves hostnames internally with an IPv6 fallback, and
// Render's network cannot reach Gmail over IPv6 — the fallback attempt
// hangs (ENETUNREACH / Connection timeout) before auth ever runs. With the
// host pinned to an IPv4 literal there is nothing left to resolve.
async function createTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || (host === "smtp.gmail.com" ? 465 : 587));
    const ip = await new Promise((resolve, reject) => {
        dns.lookup(host, { family: 4 }, (err, address) => {
            if (err) return reject(err);
            resolve(address);
        });
    });
    return nodemailer.createTransport({
        host: ip,
        servername: host, // TLS SNI stays smtp.gmail.com for the cert check
        port,
        secure: port === 465,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

function getTransporter() {
    if (!isEmailConfigured()) {
        return null;
    }
    if (!transporterPromise) {
        transporterPromise = createTransporter().catch(err => {
            transporterPromise = null; // allow a retry on the next send
            throw err;
        });
    }
    return transporterPromise;
}

// Test-only hook so jest can inject a fake mailer without SMTP.
function setTransporterForTests(fake) {
    transporterPromise = fake ? Promise.resolve(fake) : null;
}

async function sendViaResend({ to, subject, html }) {
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: to.split(",").map(s => s.trim()).filter(Boolean),
            subject,
            html,
        }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Resend HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
}

// Sends an alert email. Never throws; returns { ok: true } or
// { ok: false, error: "message" }.
async function sendAlertMail({ to, subject, html }) {
    if (!isEmailConfigured()) {
        return { ok: false, error: "Email sending is not configured" };
    }
    try {
        if (process.env.RESEND_API_KEY) {
            await sendViaResend({ to, subject, html });
        } else {
            const mailer = await getTransporter();
            if (!mailer) {
                return { ok: false, error: "Email sending is not configured" };
            }
            await mailer.sendMail({
                from: process.env.EMAIL_FROM || process.env.SMTP_USER,
                to,
                subject,
                html,
            });
        }
        return { ok: true };
    } catch (err) {
        console.error("❌ Email send failed:", err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = { isEmailConfigured, getTransporter, sendAlertMail, setTransporterForTests };