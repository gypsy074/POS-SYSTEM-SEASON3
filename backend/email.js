// Owner alert email delivery via nodemailer.
// Credentials come from env (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS /
// EMAIL_FROM). When they are missing, sends are skipped silently and
// isEmailConfigured() reports false so the admin UI can show the state.

const nodemailer = require("nodemailer");
const dns = require("dns");

let transporterPromise = null;

function isEmailConfigured() {
    return Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
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

// Sends an alert email to one recipient. Never throws; returns
// { ok: true } or { ok: false, error: "message" }.
async function sendAlertMail({ to, subject, html }) {
    const mailer = await getTransporter();
    if (!mailer) {
        return { ok: false, error: "SMTP not configured" };
    }
    try {
        await mailer.sendMail({
            from: process.env.EMAIL_FROM || process.env.SMTP_USER,
            to,
            subject,
            html,
        });
        return { ok: true };
    } catch (err) {
        console.error("❌ Email send failed:", err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = { isEmailConfigured, getTransporter, sendAlertMail, setTransporterForTests };