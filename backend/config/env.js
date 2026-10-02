// env.js — Environment configuration (MongoDB)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/* ── SMTP readiness ──────────────────────────────────────────
   Outbound email has no fallback channel: if this is unusable, "forgot password"
   is broken for every user. So the readiness of the mail provider must be
   diagnosable, and it is reported here using variable NAMES only — never a
   host, mailbox or app-password value — which lets the boot banner, the
   forgot-password error path and `npm run verify:smtp` all name the exact
   variable an operator forgot without ever exposing a credential to a log,
   a terminal or an API response. */
/* Gmail App Passwords are always displayed in groups of four
   ("xxxx xxxx xxxx xxxx"). Copy-pasting that straight from the Google page
   leaves the spaces inside the value, and they are then sent verbatim in the
   SMTP AUTH payload, which Gmail rejects with 535 / EAUTH. Every variable then
   reads as correctly "present", so nothing looks misconfigured while every
   send fails. Stripping whitespace here — once, at the single point every
   caller reads — keeps the credential usable however it was pasted, both in
   backend/.env and in the hosting provider's dashboard. */
const stripCredentialWhitespace = (value) =>
  String(value || "").replace(/\s+/g, "");

function normalizeOllamaBaseUrl(value) {
  const configured = String(value || "").trim();
  if (!configured) return "";
  const withProtocol = /^https?:\/\//i.test(configured)
    ? configured
    : `http://${configured}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

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

  // Email (Gmail SMTP — SMTP_HOST/SMTP_USER/SMTP_PASSWORD are REQUIRED for
  // password recovery. SMTP_PASSWORD must be a GOOGLE APP PASSWORD, NOT the
  // normal Gmail password — see .env.example for step-by-step instructions.)
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: process.env.SMTP_PORT || 587, // 587 → STARTTLS; 465 → implicit TLS
  SMTP_USER: smtpUser, // your.account@gmail.com
  SMTP_PASSWORD: smtpPassword, // 16-char Google App Password, whitespace stripped
  SMTP_PASS: smtpPassword, // legacy alias for SMTP_PASSWORD
  /* True only when the provider can actually be used. SMTP_STATUS.missing
     explains *why* it is false, by variable name only. */
  SMTP_CONFIGURED: smtpStatus.configured,
  SMTP_STATUS: smtpStatus,
  SMTP_FROM_NAME:
    process.env.SMTP_FROM_NAME || "Smart ICT Maintenance Management System",
  /* Optional independent From address for outbound mail. When unset the From
     header falls back to SMTP_USER (with the SMTP_FROM_NAME display label). */
  MAIL_FROM: process.env.MAIL_FROM || "",

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
    smtpStatus.configured && adminEmailStatus.configured,

  // AI support (server-side only; uses the local Ollama server. No OpenAI or
  // any cloud AI is required anywhere in the AI Assistant flow.)
  AI_SUPPORT_ENABLED: process.env.AI_SUPPORT_ENABLED || "true",
  AI_MAX_FILE_SIZE_MB: Number(process.env.AI_MAX_FILE_SIZE_MB) || 10,

  // Local AI (Ollama) — the only AI provider of the AI Assistant.
  OLLAMA_BASE_URL: normalizeOllamaBaseUrl(
    process.env.OLLAMA_BASE_URL ||
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:11434"),
  ),
  OLLAMA_MODEL: (process.env.OLLAMA_MODEL || "llama3.2").trim(),
  OLLAMA_TIMEOUT_MS: Number(process.env.OLLAMA_TIMEOUT_MS) || 120000,
  OLLAMA_PING_TIMEOUT_MS: Number(process.env.OLLAMA_PING_TIMEOUT_MS) || 3000,
  OLLAMA_MAX_TOKENS: Number(process.env.OLLAMA_MAX_TOKENS) || 1500,

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
