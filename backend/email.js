// Owner alert email delivery via nodemailer.
// Credentials come from env (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS /
// EMAIL_FROM). When they are missing, sends are skipped silently and
// isEmailConfigured() reports false so the admin UI can show the state.

const nodemailer = require("nodemailer");

let transporter = null;

function isEmailConfigured() {
    return Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
    );
}

function getTransporter() {
    if (!isEmailConfigured()) {
        return null;
    }
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || (process.env.SMTP_HOST === "smtp.gmail.com" ? 465 : 587));
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return transporter;
}

// Test-only hook so jest can inject a fake mailer without SMTP.
function setTransporterForTests(fake) {
    transporter = fake;
}

// Sends an alert email to one recipient. Never throws; returns
// { ok: true } or { ok: false, error: "message" }.
async function sendAlertMail({ to, subject, html }) {
    const mailer = getTransporter();
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