const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const {
  register,
  getRegistrationStatus,
  login,
  logout,
  getMe,
  forgotPassword,
  verifyResetCode,
  resetPassword,
} = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimiter");
const { RATE_LIMIT } = require("../config/env");

const WINDOW_MS = RATE_LIMIT.windowMs;

/* Bucket identity for "one specific account being recovered".
   The normalized email is never used as a raw map key — only its SHA-256
   digest is held in memory, so a heap dump cannot reveal which addresses were
   targeted. A missing/blank value falls back to the caller's own IP so
   malformed payloads can never pool every caller into one shared bucket. */
function accountKey(field) {
  return (req) => {
    const raw = req.body ? req.body[field] : undefined;
    if (typeof raw !== "string" || !raw.trim()) {
      return `anon:${req.ip || "unknown"}`;
    }
    return crypto.createHash("sha256").update(raw.trim().toLowerCase()).digest("hex");
  };
}

/* 429 copy. Deliberately short so the frontend can append the exact cooldown
   it receives in Retry-After without the sentence reading as a duplicate. */
const FORGOT_LIMIT_MESSAGE =
  "Too many verification requests.";
const VERIFY_LIMIT_MESSAGE = "Too many verification attempts.";
const AUTH_LIMIT_MESSAGE = "Too many sign-in attempts. Please wait a few minutes and try again.";

const authRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.auth,
  scope: "auth/login+register",
  message: AUTH_LIMIT_MESSAGE,
});

/* Password reset needs an unguessable 256-bit token, so it is limited only as
   a coarse abuse bound and no longer shares a bucket with login/register. */
const resetPasswordRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.resetPassword,
  scope: "auth/reset-password",
  message: "Too many password reset attempts. Please wait a few minutes and try again.",
});

const forgotIpRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.forgotIp,
  scope: "auth/forgot-password/ip",
  message: FORGOT_LIMIT_MESSAGE,
});

const forgotAccountRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.forgotAccount,
  keyGenerator: accountKey("email"),
  scope: "auth/forgot-password/account",
  message: FORGOT_LIMIT_MESSAGE,
});

const verifyIpRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.verifyIp,
  scope: "auth/verify-reset-code/ip",
  message: VERIFY_LIMIT_MESSAGE,
});

const verifyAccountRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: RATE_LIMIT.verifyAccount,
  keyGenerator: accountKey("email"),
  scope: "auth/verify-reset-code/account",
  message: VERIFY_LIMIT_MESSAGE,
});

/* Declared before /register's rate limiter is irrelevant here, but it is the
   one public auth route that must stay cheap: the login page calls it on every
   load to decide whether to offer the Register link, so it carries no limiter
   and reads only a single boolean. */
router.get("/registration-status", getRegistrationStatus);
router.post("/register", authRateLimit, register);
router.post("/login", authRateLimit, login);
router.post("/logout", logout);
router.post(
  "/forgot-password",
  forgotIpRateLimit,
  forgotAccountRateLimit,
  forgotPassword,
);
router.post(
  "/verify-reset-code",
  verifyIpRateLimit,
  verifyAccountRateLimit,
  verifyResetCode,
);
router.post("/reset-password", resetPasswordRateLimit, resetPassword);
router.get("/me", authenticate, getMe);

module.exports = router;
