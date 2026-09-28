/**
 * services/mailer.js
 * Outbound email service for the Smart ICT Maintenance Management System.
 *
 * Uses the project's existing Nodemailer dependency and the SMTP_* settings
 * centralised in config/env.js. Email is REQUIRED for password recovery: there
 * is no second channel, so if SMTP_HOST / SMTP_USER / SMTP_PASSWORD are not
 * usable then "forgot password" is broken for every user. The rest of the system
 * (ticketing, notifications) still runs without it, which is why an unusable
 * configuration is reported loudly at boot instead of being treated as normal.
 * Every send path therefore reports `delivered:false` plus a `code` naming the
 * failing stage (see EMAIL_ERROR) and never pretends a message was sent.
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

const nodemailer = require("nodemailer");
const env = require("../config/env");
const User = require("../models/User");

/* ── Credential redaction ────────────────────────────────────
   Never let the full SMTP account or any raw credentials reach logs. */
function maskEmail(email) {
  if (typeof email !== "string" || !email) return "(unset)";
  const at = email.lastIndexOf("@");
  if (at <= 1) return "***@***";
  return `${email.slice(0, 2)}***${email.slice(at - 1, at + 1)}***`;
}

function maskConfig() {
  return {
    host: env.SMTP_HOST || "(unset)",
    port: Number(env.SMTP_PORT) || 587,
    user: maskEmail(env.SMTP_USER),
    pass: env.SMTP_PASSWORD || env.SMTP_PASS ? "****(set)" : "(unset)",
  };
}

/* SMTP is considered configured only when host + credentials all exist.
   A server without any of them cannot deliver mail. */
function smtpConfigured() {
  return env.SMTP_CONFIGURED;
}

/* ── Safe failure classification ────────────────────────────
   "The email did not go out" has to be diagnosable, because password recovery
   has no second channel. These three categories are deliberately coarse: each
   names WHICH stage failed and nothing else. No category, log line or return
   value ever carries a password, a token, the verification code, a full
   address or the SMTP AUTH payload. */
const EMAIL_ERROR = {
  /* The provider was never usable: variables missing, or the relay rejected
     the credentials (EAUTH → typically a wrong/normal Gmail password instead of
     an App Password). */
  CONFIGURATION: "EMAIL_CONFIGURATION_ERROR",
  /* The conversation never completed: DNS, TCP, TLS or timeout. */
  CONNECTION: "EMAIL_CONNECTION_ERROR",
  /* The relay was reached and answered, but refused the message (size, policy,
     421 throttling, 5.x.x). */
  SEND: "EMAIL_SEND_ERROR",
};

/* Socket/TLS codes that mean we never finished talking to the relay. */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EDNS",
  "ESOCKET",
  "EPIPE",
  "ETIMEDOUT",
  "ETIMEOUT",
  "STARTTLS",
]);

/* Which SMTP variables are absent/placeholder. Names only, by construction. */
function describeMissing() {
  const missing = (env.SMTP_STATUS && env.SMTP_STATUS.missing) || [];
  return missing.length ? missing.join(", ") : "none reported";
}

/* Nodemailer errors are never echoed verbatim: a relay quotes the address it
   rejected, and some relays echo long AUTH payloads. Redact addresses and
   long opaque blobs, then truncate — the SMTP response code is what makes the
   failure actionable, and it is preserved below. */
function safeMailReason(err) {
  const raw = err && typeof err.message === "string" ? err.message : "";
  const cleaned = raw
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "***@***")
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "***")
    .replace(/\b\d{8,}\b/g, "***")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 160)}...` : cleaned;
}

function classifyMailError(err) {
  const code = (err && err.code) || "";
  if (code === "EAUTH" || code === "EENVELOPE")
    return EMAIL_ERROR.CONFIGURATION;
  if (CONNECTION_ERROR_CODES.has(code)) return EMAIL_ERROR.CONNECTION;
  /* Some timeouts surface with no code at all; fall back to the redacted text. */
  if (
    !code &&
    /connect|socket|timeout|dns|getaddrinfo/i.test(safeMailReason(err))
  ) {
    return EMAIL_ERROR.CONNECTION;
  }
  return EMAIL_ERROR.SEND;
}

/* Credential-free description of a Nodemailer failure. The SMTP response code
   (535 vs 550 vs 421) and command are intentionally kept: they carry no secret
   and are exactly what identifies the specific rejection. */
function describeMailFailure(err) {
  return {
    code: classifyMailError(err),
    smtpCode: (err && err.code) || "UNKNOWN",
    responseCode: (err && err.responseCode) || "none",
    command: (err && err.command) || "none",
    reason: safeMailReason(err),
  };
}

function formatMailFailure(failure) {
  const head =
    `${failure.code} (smtp=${failure.smtpCode}, response=${failure.responseCode}` +
    `, command=${failure.command})`;
  return failure.reason ? `${head} - ${failure.reason}` : head;
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
    secure: isImplicitTls /* 465 → implicit TLS      */,
    requireTLS: !isImplicitTls /* 587 → explicit STARTTLS */,
    connectionTimeout: 15000 /* ms — fail fast, don't hang a request */,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD || env.SMTP_PASS,
    },
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

/* Build the From header. MAIL_FROM, when set, becomes the mailbox address
   (optionally labelled by SMTP_FROM_NAME); otherwise the authenticated
   SMTP_USER account is used (Gmail always rewrites From to the authenticated
   sender anyway, so MAIL_FROM mainly controls the address for non-Gmail relays). */
function fromAddress() {
  const display = env.SMTP_FROM_NAME
    ? `"${env.SMTP_FROM_NAME.replace(/"/g, "'")}" `
    : "";
  if (env.MAIL_FROM) return `${display}<${env.MAIL_FROM}>`;
  return env.SMTP_USER ? `${display}<${env.SMTP_USER}>` : env.SMTP_USER;
}

/**
 * Verify the SMTP connection using Nodemailer's transporter.verify().
 * @returns {Promise<{ok:boolean, detail:string, code?:string}>} — never rejects, never leaks credentials.
 *   `code` is one of the EMAIL_ERROR categories so the boot banner and the CLI
 *   can report the failing stage rather than a generic "failed".
 */
async function verifySmtp() {
  if (!smtpConfigured()) {
    return {
      ok: false,
      code: EMAIL_ERROR.CONFIGURATION,
      detail:
        `SMTP not configured - email delivery is disabled, so password reset cannot work. ` +
        `Missing or invalid: ${describeMissing()}.`,
    };
  }
  try {
    await getTransporter().verify();
    return {
      ok: true,
      detail: `SMTP connection verified (${maskConfig().host}:${maskConfig().port}) as ${maskConfig().user}.`,
    };
  } catch (err) {
    /* Generic, credential-free message built from the category + SMTP codes. */
    const failure = describeMailFailure(err);
    return {
      ok: false,
      code: failure.code,
      smtpCode: failure.smtpCode,
      responseCode: failure.responseCode,
      detail:
        `SMTP verification failed: ${formatMailFailure(failure)}. ` +
        "Check that SMTP_PASSWORD is a Google App Password and that SMTP_HOST/SMTP_PORT match.",
    };
  }
}

/**
 * Core send. Never rejects.
 * @param {Object} opts
 * @param {string} opts.to        — recipient address
 * @param {string} [opts.replyTo] — address the recipient replies to (e.g. the contact sender)
 * @param {string} opts.subject
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @returns {Promise<{delivered:boolean, info:string, code?:string}>}
 */
async function sendEmail({ to, replyTo, subject, text, html }) {
  if (!smtpConfigured()) {
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: `SMTP not configured; email disabled (missing: ${describeMissing()}).`,
    };
  }
  if (!to) {
    /* CONFIGURATION, not SEND: an empty recipient means the caller was not
       configured with a destination, so the relay was never even contacted. The
       contact form reaches this whenever ADMIN_EMAIL is unset, and it must not
       be reported as a transient failure that invites a retry. */
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: "No recipient provided.",
    };
  }

  let transporter;
  try {
    transporter = getTransporter();
  } catch (err) {
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: "Unable to build mail transport.",
    };
  }

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      replyTo,
      subject,
      text,
      html,
    });
    return { delivered: true, info: "Email delivered to SMTP server." };
  } catch (err) {
    const failure = describeMailFailure(err);
    console.error(
      `[mailer] ${formatMailFailure(failure)} (recipient masked: ${maskEmail(String(to))})`,
    );
    return {
      delivered: false,
      code: failure.code,
      info: "Email delivery failed.",
    };
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
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: `SMTP not configured; email disabled (missing: ${describeMissing()}).`,
    };
  }

  /* Lazy require keeps this module free of a hard model dependency. */
  let settings;
  try {
    const Settings = require("../models/Settings");
    settings = await Settings.getInstance();
  } catch (err) {
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: "Email notifications disabled (settings unavailable).",
    };
  }
  if (!settings || !settings.emailNotifications) {
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: "Email notifications are disabled in Settings.",
    };
  }

  const recipient = await User.findOne({ email: String(to).toLowerCase() })
    .select("role notificationPreferences")
    .lean();
  const preferences = recipient?.notificationPreferences;
  if (
    preferences?.emailNotifications === false ||
    (recipient?.role === "Technician" &&
      preferences?.maintenanceAlerts === false)
  ) {
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: "Email notification disabled by recipient preferences.",
    };
  }

  return sendEmail({ to, subject, text, html });
}

/**
 * Send a password reset verification code email.
 * @returns {Promise<{delivered:boolean, info:string, code?:string}>}
 *   - delivered:true  → the email was handed to the SMTP server.
 *   - delivered:false → SMTP is not configured or delivery failed; mail NOT sent.
 *     `code` is the EMAIL_ERROR category that lets the caller log the real cause.
 */
async function sendPasswordResetEmail({ to, code, expiresMinutes = 10 }) {
  /* ── SMTP unusable ─────────────────────────────────────────
     Do not pretend delivery, and never log the code itself. The category plus the
     missing variable names are logged because this is the single reason password
     recovery can fail outright, and the names carry no secret. */
  if (!smtpConfigured()) {
    console.error(
      `[auth/password-reset] ${EMAIL_ERROR.CONFIGURATION} - verification email NOT sent to "${maskEmail(to)}". ` +
        `Missing or invalid: ${describeMissing()}.`,
    );
    return {
      delivered: false,
      code: EMAIL_ERROR.CONFIGURATION,
      info: `SMTP not configured; email not delivered (missing: ${describeMissing()}).`,
    };
  }

  const text =
    "Your Password Reset Verification Code\n\n" +
    "You requested a password reset for your Smart ICT Maintenance Management System account.\n\n" +
    `Your verification code is: ${code}\n\n` +
    `This code expires in ${expiresMinutes} minutes and can only be used once.\n` +
    "Never share this code with anyone. If you did not request this, you can safely ignore this email.\n\n" +
    "Smart ICT Maintenance Management System";

  const html =
    "<h2>Your Password Reset Verification Code</h2>" +
    "<p>You requested a password reset for your <strong>Smart ICT Maintenance Management System</strong> account.</p>" +
    `<p style="font-size:2rem;letter-spacing:.35rem;font-weight:700;">${code}</p>` +
    `<p>This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.</p>` +
    '<p style="color:#666;">Never share this code with anyone. If you did not request this, you can safely ignore this email.</p>' +
    '<p style="color:#888;font-size:.8rem;">Smart ICT Maintenance Management System</p>';

  return sendEmail({
    to,
    subject: "Smart ICT Maintenance Management System - Password Reset Code",
    text,
    html,
  });
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
  /* failure classification, shared by the boot banner, the verify script and
     the forgot-password controller so all three report the same category */
  EMAIL_ERROR,
  describeMissing,
  describeMailFailure,
  formatMailFailure,
};
