/**
 * services/mailer.js
 * Outbound email service for the Smart Computer Maintenance Service.
 *
 * Uses the project's existing Nodemailer dependency and the SMTP_* settings
 * centralised in config/env.js. Email is OPTIONAL in this project: as long as
 * SMTP_HOST, SMTP_USER and SMTP_PASS are left blank, real delivery is disabled
 * and nothing crashes — every send path reports `delivered:false` instead.
 *
 * ── Gmail configuration (see .env / .env.example) ─────────────────────────
 *   SMTP_HOST = smtp.gmail.com
 *   SMTP_PORT = 587   (STARTTLS — the default and recommended Gmail port)
 *   SMTP_USER = your.account@gmail.com
 *   SMTP_PASS = your 16-character GOOGLE APP PASSWORD
 *
 *   SMTP_PASS MUST be a Google App Password. It is NOT your normal Gmail
 *   login password and NOT your recovery code. How to get one:
 *     1. Turn ON 2-Step Verification on the Google account.
 *     2. Go to  https://myaccount.google.com/apppasswords
 *     3. Create an app password for "Mail" (16 chars, groups of 4).
 *     4. Paste ONLY that generated code into SMTP_PASS (spaces are fine).
 *   If your account uses passkeys or Google blocks "less secure apps", the
 *   App Password still works because it is a dedicated per-app credential.
 *
 * ── Security (IMPORTANT) ──────────────────────────────────────────────────
 *   - Credentials live ONLY in environment variables /.env — never hard-coded.
 *   - SMTP_PASS (and the full SMTP_USER) is never written to log files or the
 *     console. The helper `maskEmail()` is used wherever the account is shown.
 *   - On failure, nodemailer errors are re-wrapped so no credentials leak.
 *
 * ── Honesty + non-blocking contract ────────────────────────────────────────
 *   - This module NEVER pretends an email was sent.
 *   - All send functions return `{ delivered:Boolean, info:String }`.
 *   - sendEmail()/sendPasswordResetEmail()/sendEventEmail() never reject;
 *     they resolve with `delivered:false` on any failure so callers — even
 *     awaited ones — can never crash the request/operation.
 *   - `verifySmtp()` performs a real Nodemailer transporter.verify() and can
 *     reject, so callers should .catch() it (see scripts/verify-smtp.js).
 */

const nodemailer = require('nodemailer');
const env = require('../config/env');

/* ── Credential redaction ────────────────────────────────────
   Never let the full SMTP account or any raw credentials reach logs. */
function maskEmail(email) {
  if (typeof email !== 'string' || !email) return '(unset)';
  const at = email.lastIndexOf('@');
  if (at <= 1) return '***@***';
  return `${email.slice(0, 2)}***${email.slice(at - 1, at + 1)}***`;
}

function maskConfig() {
  return {
    host: env.SMTP_HOST || '(unset)',
    port: Number(env.SMTP_PORT) || 587,
    user: maskEmail(env.SMTP_USER),
    pass: env.SMTP_PASS ? '****(set)' : '(unset)',
  };
}

/* SMTP is considered configured only when host + credentials all exist.
   A server without any of them cannot deliver mail. */
function smtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/* ── Transporter construction ────────────────────────────────
   Gmail on port 587 uses STARTTLS: we connect insecurely and upgrade with
   requireTLS:true (explicit STARTTLS). Port 465 is implicit TLS (secure:true).
   A cached singleton keeps the login handshake from being repeated on every
   message within the same process. */
function buildTransporterOptions(overrides) {
  const port = Number(env.SMTP_PORT) || 587;
  const isImplicitTls = port === 465;

  return {
    host: env.SMTP_HOST,
    port,
    secure: isImplicitTls,                    /* 465 → implicit TLS      */
    requireTLS: !isImplicitTls,               /* 587 → explicit STARTTLS */
    connectionTimeout: 15000,                 /* ms — fail fast, don't hang a request */
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    ...overrides,
  };
}

let cachedTransporter = null;

function getTransporter() {
  if (smtpConfigured() && cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport(buildTransporterOptions());
  return cachedTransporter;
}

/* Public factory — kept for callers that need an explicit transport. */
function createTransporter() {
  return nodemailer.createTransport(buildTransporterOptions());
}

/* Build the From header: `"Name" <account@gmail.com>` when SMTP_FROM_NAME is set. */
function fromAddress() {
  const account = env.SMTP_USER;
  return env.SMTP_FROM_NAME ? `"${env.SMTP_FROM_NAME.replace(/"/g, "'")}" <${account}>` : account;
}

/**
 * Verify the SMTP connection using Nodemailer's transporter.verify().
 * @returns {Promise<{ok:boolean, detail:string}>} — never rejects, never leaks credentials.
 */
async function verifySmtp() {
  if (!smtpConfigured()) {
    return { ok: false, detail: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS required). Email disabled.' };
  }
  try {
    await getTransporter().verify();
    return { ok: true, detail: `SMTP connection verified (${maskConfig().host}:${maskConfig().port}) as ${maskConfig().user}.` };
  } catch (err) {
    /* Generic, credential-free message. Do NOT echo err.message verbatim —
       a misbehaving SMTP relay could echo the AUTH payload back. */
    return { ok: false, detail: 'SMTP verification failed. Check host, port, account and App Password.' };
  }
}

/**
 * Core send. Never rejects.
 * @returns {Promise<{delivered:boolean, info:string}>}
 */
async function sendEmail({ to, subject, text, html }) {
  if (!smtpConfigured()) {
    return { delivered: false, info: 'SMTP not configured; email disabled.' };
  }
  if (!to) {
    return { delivered: false, info: 'No recipient provided.' };
  }

  let transporter;
  try {
    transporter = getTransporter();
  } catch (err) {
    return { delivered: false, info: 'Unable to build mail transport.' };
  }

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      html,
    });
    return { delivered: true, info: 'Email delivered to SMTP server.' };
  } catch (err) {
    console.error('[mailer] Email delivery failed (recipient masked):', maskEmail(String(to)));
    return { delivered: false, info: 'Email delivery failed.' };
  }
}

/**
 * Send an event/notification email. Gated by BOTH the SMTP configuration and
 * the admin "emailNotifications" toggle in Settings — so nothing is sent until
 * the admin enables it. Non-blocking: returns the same {delivered, info} shape
 * and never rejects.
 */
async function sendEventEmail({ to, subject, text, html }) {
  if (!smtpConfigured()) {
    return { delivered: false, info: 'SMTP not configured; email disabled.' };
  }

  /* Lazy require keeps this module free of a hard model dependency. */
  let settings;
  try {
    const Settings = require('../models/Settings');
    settings = await Settings.getInstance();
  } catch (err) {
    return { delivered: false, info: 'Email notifications disabled (settings unavailable).' };
  }
  if (!settings || !settings.emailNotifications) {
    return { delivered: false, info: 'Email notifications are disabled in Settings.' };
  }

  return sendEmail({ to, subject, text, html });
}

/**
 * Send a password reset email.
 * @returns {Promise<{delivered:boolean, info:string}>}
 *   - delivered:true  → the email was handed to the SMTP server.
 *   - delivered:false → SMTP is not configured or delivery failed; mail NOT sent.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  /* ── Dev mode / SMTP disabled ────────────────────────────────
     Do not pretend delivery. Emit the reset link on the server console only
     (existing development convention in the codebase) and report that no email
     was sent; the API still returns the generic enumeration-safe message so
     nothing is leaked to the client. */
  if (!smtpConfigured()) {
    console.log(
      `[auth/password-reset] SMTP not configured — reset email NOT sent to "${maskEmail(to)}". ` +
      `RAW RESET LINK (development only): ${resetUrl}`
    );
    return { delivered: false, info: 'SMTP not configured; email not delivered.' };
  }

  const text =
    'You requested a password reset for your Smart Computer Maintenance Service account.\n\n' +
    'Click the link below to reset your password. This link is valid for 30 minutes and can only be used once.\n\n' +
    `${resetUrl}\n\n` +
    'If you did not request this, you can safely ignore this email — your password will not change.\n\n' +
    'Smart Computer Maintenance Service';

  const html =
    '<p>You requested a password reset for your <strong>Smart Computer Maintenance Service</strong> account.</p>' +
    '<p>Click the button below to reset your password. This link is valid for <strong>30 minutes</strong> and can only be used once.</p>' +
    `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 22px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>` +
    '<p style="color:#666;">If you did not request this, you can safely ignore this email — your password will not change.</p>' +
    '<p style="color:#888;font-size:.8rem;">Smart Computer Maintenance Service</p>';

  return sendEmail({ to, subject: 'Reset your password', text, html });
}

module.exports = {
  smtpConfigured,
  createTransporter,
  verifySmtp,
  sendEmail,
  sendEventEmail,
  sendPasswordResetEmail,
  /* small helpers exposed for the verify script / diagnostics */
  maskEmail,
  maskConfig,
};