// env.js — Environment configuration (MongoDB)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const publicRegistrationEnabled = true;

/* Production is pinned to Resend over HTTPS because Render's free instances
   block outbound SMTP. Local development defaults to SMTP to preserve the
   existing workflow; EMAIL_PROVIDER=resend opts into the API locally. */
const stripCredentialWhitespace = (value) =>
  String(value || "").replace(/\s+/g, "");

const smtpUser = String(process.env.SMTP_USER || "").trim();
const smtpPassword = stripCredentialWhitespace(
  process.env.SMTP_PASSWORD || process.env.SMTP_PASS || "",
);

const smtpStatus = (() => {
  const host = process.env.SMTP_HOST || "";
  const user = smtpUser;
  const pass = smtpPassword;
  /* Documentation filler left in the file is as unusable as a blank value, so
     it is surfaced the same way instead of silently disabling delivery. */
  const placeholder =
    /paste[-_]?your|gmail[-_]?here|your[-_]?sending|your\.account|example\.com|replace[_-]?with/i;
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASSWORD (or legacy SMTP_PASS)");
  if (!missing.length && (placeholder.test(user) || placeholder.test(pass))) {
    missing.push("placeholder value still present in SMTP_USER/SMTP_PASSWORD");
  }
  return { configured: missing.length === 0, missing };
})();

const emailProvider =
  process.env.NODE_ENV === "production"
    ? "resend"
    : String(process.env.EMAIL_PROVIDER || "smtp")
        .trim()
        .toLowerCase();
const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const resendFromEmail = String(
  process.env.EMAIL_FROM || process.env.MAIL_FROM || "",
).trim();

const resendStatus = (() => {
  const missing = [];
  if (
    !/^re_[A-Za-z0-9_-]{8,}$/.test(resendApiKey) ||
    /^(re_[xX]+|your[-_ ]|replace)/i.test(resendApiKey)
  ) {
    missing.push("RESEND_API_KEY");
  }
  if (
    !resendFromEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendFromEmail) ||
    /example\.com|your[-_. ]|replace/i.test(resendFromEmail)
  ) {
    missing.push("EMAIL_FROM (verified sender address)");
  }
  return { configured: missing.length === 0, missing };
})();

const emailStatus = (() => {
  if (emailProvider === "smtp") return smtpStatus;
  if (emailProvider === "resend") return resendStatus;
  return {
    configured: false,
    missing: ["EMAIL_PROVIDER (must be smtp or resend)"],
  };
})();

/* ── Contact-form notification readiness ──────────────────────
   The contact form persists every message to MongoDB, but the ICT Admin is
   notified ONLY by email. When ADMIN_EMAIL is blank the send has no recipient,
   so the mailer short-circuits and POST /api/inquiries answers HTTP 503 for
   every visitor — a total outage of that form caused by a single missing
   variable, with no other symptom. Reported by NAME only, so the boot banner
   and the controller can name it without exposing an address. */
const adminEmailStatus = (() => {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const missing = [];
  if (!email) missing.push("ADMIN_EMAIL");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    missing.push("ADMIN_EMAIL (present but not a valid email address)");
  }
  return { configured: missing.length === 0, missing };
})();

module.exports = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || "development",

  // MongoDB
  MONGO_URI: process.env.MONGO_URI || "mongodb://localhost:27017",
  MONGO_DB_NAME: process.env.MONGO_DB_NAME || "ict_maintenance_db",

  // Server-side session
  SESSION_SECRET: process.env.SESSION_SECRET || "change_this_session_secret",
  SESSION_TTL_MS: Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000,

  // File Upload
  UPLOAD_PATH: process.env.UPLOAD_PATH || "uploads/",
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || 5 * 1024 * 1024,

  // Frontend base URL retained for other frontend integrations. Matches the
  // developer origin by default; override for production when needed.
  FRONTEND_URL:
    process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"),
  /* Public self-registration is intentionally enabled; the registration
     endpoint still creates Requester accounts only. */
  PUBLIC_REGISTRATION_ENABLED: publicRegistrationEnabled,

  // Production uses Resend over HTTPS; local development defaults to SMTP.
  EMAIL_PROVIDER: emailProvider,
  EMAIL_CONFIGURED: emailStatus.configured,
  EMAIL_STATUS: emailStatus,
  RESEND_API_KEY: resendApiKey,
  EMAIL_FROM: resendFromEmail,
  RESEND_TIMEOUT_MS: Math.min(
    30000,
    Math.max(1000, Number(process.env.RESEND_TIMEOUT_MS) || 10000),
  ),
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: process.env.SMTP_PORT || 587, // 587 → STARTTLS; 465 → implicit TLS
  SMTP_USER: smtpUser, // your.account@gmail.com
  SMTP_PASSWORD: smtpPassword, // 16-char Google App Password, whitespace stripped
  SMTP_PASS: smtpPassword, // legacy alias for SMTP_PASSWORD
  /* Retained for local SMTP diagnostics. Production readiness is EMAIL_STATUS. */
  SMTP_CONFIGURED: smtpStatus.configured,
  SMTP_STATUS: smtpStatus,
  SMTP_FROM_NAME:
    process.env.SMTP_FROM_NAME || "Smart ICT Maintenance Management System",
  /* Optional independent From address for local SMTP. */
  MAIL_FROM: String(process.env.MAIL_FROM || "").trim(),

  // SMS (replaceable provider adapter; credentials stay server-side)
  SMS_PROVIDER: process.env.SMS_PROVIDER || "",
  SMS_API_KEY: process.env.SMS_API_KEY || "",
  SMS_API_SECRET: process.env.SMS_API_SECRET || "",
  SMS_FROM: process.env.SMS_FROM || "",

  // ICT Admin inbox — every successful contact-form submission is emailed here.
  // Blank here means the contact form answers 503 for every visitor; see
  // ADMIN_EMAIL_STATUS / CONTACT_NOTIFICATION_CONFIGURED below.
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || "").trim(),
  ADMIN_EMAIL_STATUS: adminEmailStatus,
  /* The contact form can only confirm a submission when BOTH a working
     provider and a recipient exist. */
  CONTACT_NOTIFICATION_CONFIGURED:
    emailStatus.configured && adminEmailStatus.configured,

  // AI support (server-side only; keys never leave the backend).
  AI_SUPPORT_ENABLED: process.env.AI_SUPPORT_ENABLED || "true",
  AI_MAX_FILE_SIZE_MB: Number(process.env.AI_MAX_FILE_SIZE_MB) || 10,

  // Gemini AI Studio is the sole AI provider. The API key stays server-side.
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: String(process.env.GEMINI_API_KEY || "").trim(),
  GEMINI_MODEL: (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim(),
  GEMINI_BASE_URL: (() => {
    const raw = String(
      process.env.GEMINI_BASE_URL ||
        "https://generativelanguage.googleapis.com/v1beta",
    ).trim();
    try {
      return new URL(raw).toString().replace(/\/+$/, "");
    } catch {
      return "https://generativelanguage.googleapis.com/v1beta";
    }
  })(),
  GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS) || 120000,
  GEMINI_PING_TIMEOUT_MS: Number(process.env.GEMINI_PING_TIMEOUT_MS) || 10000,
  GEMINI_MAX_TOKENS: Number(process.env.GEMINI_MAX_TOKENS) || 1500,

  /* ── Rate limiting (see backend/middleware/rateLimiter.js) ────────
     Every authentication endpoint has its own isolated bucket, so unrelated
     traffic can never drain a user's password-recovery allowance.

     Password recovery is limited on TWO independent dimensions:
       • per IP       — stops volumetric abuse / spraying many addresses
       • per account  — stops OTP spam and enumeration of one address, and
                        stops an attacker from locking a victim out of their
                        own recovery flow
     The per-account limit is what really protects the system; the per-IP limit
     is a coarse outer bound. Because a university network puts many users
     behind a single NAT address, the per-IP budgets are deliberately generous
     while the per-account budgets stay tight.

     Production defaults are strict, development defaults are practical for
     local testing, and every value can be overridden in .env. */
  RATE_LIMIT: (() => {
    const isProduction =
      (process.env.NODE_ENV || "development") === "production";
    const positive = (raw, fallback) => {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    };
    const defaults = isProduction
      ? {
          auth: 30, // unchanged from the previous shared login/register limit
          resetPassword: 30,
          forgotIp: 20,
          forgotAccount: 5,
          verifyIp: 60,
          verifyAccount: 10,
        }
      : {
          auth: 300,
          resetPassword: 300,
          forgotIp: 300,
          forgotAccount: 200,
          verifyIp: 300,
          verifyAccount: 200,
        };
    return {
      windowMs: positive(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      auth: positive(process.env.AUTH_RATE_LIMIT_MAX, defaults.auth),
      resetPassword: positive(
        process.env.RESET_PASSWORD_RATE_LIMIT_MAX,
        defaults.resetPassword,
      ),
      forgotIp: positive(
        process.env.FORGOT_RATE_LIMIT_IP_MAX,
        defaults.forgotIp,
      ),
      forgotAccount: positive(
        process.env.FORGOT_RATE_LIMIT_ACCOUNT_MAX,
        defaults.forgotAccount,
      ),
      verifyIp: positive(
        process.env.VERIFY_CODE_RATE_LIMIT_IP_MAX,
        defaults.verifyIp,
      ),
      verifyAccount: positive(
        process.env.VERIFY_CODE_RATE_LIMIT_ACCOUNT_MAX,
        defaults.verifyAccount,
      ),
    };
  })(),

  /* ── Reverse-proxy trust ─────────────────────────────────────────
     The deployment terminates TLS in front of this process, so the socket
     address belongs to the proxy for EVERY caller. Without trusting that hop,
     req.ip is the proxy for all users and the per-IP rate-limit buckets
     collapse into a single shared bucket that throttles the whole user base.
     Only a fixed number of hops is trusted (never `true`), so a client cannot
     spoof X-Forwarded-For to escape a rate limit. */
  TRUST_PROXY: (() => {
    const raw = String(process.env.TRUST_PROXY || "").trim();
    if (raw === "") {
      return (process.env.NODE_ENV || "development") === "production"
        ? 1
        : false;
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    const hops = Number(raw);
    return Number.isInteger(hops) && hops >= 0 ? hops : false;
  })(),
};
