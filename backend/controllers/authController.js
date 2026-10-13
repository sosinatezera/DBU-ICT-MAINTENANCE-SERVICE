/**
 * controllers/authController.js
 * Authentication — register, login, get current user
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const env = require("../config/env");
const { verifyGoogleIdToken } = require("../services/googleIdToken");
const {
  AUTH_TOKEN_TTL_SECONDS,
  createAuthToken,
  createGoogleNonceChallenge,
  verifyGoogleNonceChallenge,
} = require("../services/authToken");
const Settings = require("../models/Settings");
const { normalizeGender } = require("../utils/gender");
const {
  validateEmail,
  validateMauId,
  validatePassword,
  validatePasswordMatch,
  validateName,
  validatePhone,
  validateEnum,
  validateTermsAccepted,
  sanitizeString,
} = require("../middleware/validation");
const {
  sendPasswordResetEmail,
  emailConfigured,
  EMAIL_ERROR,
  describeEmailMissing,
} = require("../services/mailer");
const {
  sendPasswordResetSms,
  smsConfigured,
} = require("../services/smsService");
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;
const RESET_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
/* Minimum gap between two code deliveries for the SAME account. The client
   shows a matching countdown, but the server enforces the real window so the
   endpoint cannot be hammered/abused to re-send codes. */
const RESEND_COOLDOWN_MS = 30 * 1000;
const DASHBOARD_BY_ROLE = Object.freeze({
  "ICT Admin": "/views/admin/dashboard.html",
  Requester: "/views/user/dashboard.html",
  Technician: "/views/technician/dashboard.html",
});

function hashResetValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loginUserResponse(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    department: user.department,
    gender: normalizeGender(user.gender),
    profileImage: user.profileImage || null,
  };
}

/* ── GET /api/auth/google/config ──────────────────────────────
   The GIS client ID is public. A short-lived signed challenge binds the
   Google ID token to this browser's sign-in attempt without server sessions. */
const getGoogleAuthConfig = async (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!env.GOOGLE_CLIENT_ID) {
    return res.json({ success: true, enabled: false });
  }

  const challenge = createGoogleNonceChallenge();
  return res.json({
    success: true,
    enabled: true,
    clientId: env.GOOGLE_CLIENT_ID,
    ...challenge,
  });
};

/* ── POST /api/auth/google ───────────────────────────────────
   GIS sends a Google-signed ID token. Only existing active accounts whose
   email is verified by Google may use it; roles always come from MongoDB. */
const googleLogin = async (req, res, next) => {
  const idToken = req.body && req.body.credential;
  if (typeof idToken !== "string" || !idToken || idToken.length > 16384) {
    return res
      .status(422)
      .json({ success: false, message: "A valid Google credential is required." });
  }
  if (!env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({
      success: false,
      message: "Google Sign-In is not configured. Please use email and password.",
    });
  }
  const { nonce, nonceExpiresAt, nonceProof } = req.body || {};
  if (!verifyGoogleNonceChallenge({ nonce, nonceExpiresAt, nonceProof })) {
    return res.status(400).json({
      success: false,
      message: "Your Google sign-in attempt expired. Reload the page and try again.",
    });
  }

  let payload;
  try {
    payload = await verifyGoogleIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
      nonce,
    });
  } catch (err) {
    const transient = err && err.transient === true;
    console.warn(
      `[auth/google] ID token verification ${transient ? "temporarily unavailable" : "rejected"} (${(err && err.name) || "Error"}).`,
    );
    return res.status(transient ? 503 : 401).json({
      success: false,
      message: transient
        ? "Google could not be reached to verify your sign-in. Please retry."
        : "Google sign-in could not be verified. Please try again.",
    });
  }

  if (
    !payload ||
    !payload.sub ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    return res.status(401).json({
      success: false,
      message: "Google sign-in could not be verified. Please try again.",
    });
  }

  try {
    const user = await User.findOne({
      email: payload.email.trim().toLowerCase(),
    });
    if (!user) {
      return res.status(403).json({
        success: false,
        message:
          "No existing account is registered with this Google email. Use the approved registration process or contact ICT support.",
      });
    }
    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated. Contact ICT Admin.",
      });
    }
    if (!Object.hasOwn(DASHBOARD_BY_ROLE, user.role)) {
      return res.status(403).json({
        success: false,
        message: "This account has an unsupported role. Contact ICT Admin.",
      });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = createAuthToken(user._id);
    console.log(
      `[auth/google] SUCCESS for existing account (role: ${user.role}).`,
    );
    return res.json({
      success: true,
      message: "Google sign-in successful.",
      redirect: DASHBOARD_BY_ROLE[user.role],
      token,
      expiresIn: AUTH_TOKEN_TTL_SECONDS,
      user: loginUserResponse(user),
    });
  } catch (err) {
    return next(err);
  }
};

/* ── Public self-registration availability ──────────────────────
   The Admin-managed setting controls public registration only; it does not
   affect accounts created directly by administrators. */
const REGISTRATION_CLOSED_MESSAGE =
  "Public registration is currently disabled. Please contact ICT support to have an account created.";

async function isPublicRegistrationEnabled() {
  const settings = await Settings.getInstance();
  return settings.publicRegistration !== false;
}

/* ── GET /api/auth/registration-status ─────────────────────────
   Lets the login page hide its "Register" link and the register page refuse to
   render a dead form, instead of letting a visitor fill in a form that is
   guaranteed to be rejected.

   Deliberately public and deliberately minimal. It exposes only whether
   self-registration is currently allowed — the same fact POST /register
   reveals on its first line — and never any Settings value. */
const getRegistrationStatus = async (_req, res, next) => {
  try {
    const registrationOpen = await isPublicRegistrationEnabled();
    res.json({ success: true, data: { registrationOpen } });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/register ────────────────────────────────── */
const register = async (req, res, next) => {
  try {
    /* Checked FIRST, before any field validation, so a closed switch never
       reveals which fields are valid or burns a bcrypt round. */
    if (!(await isPublicRegistrationEnabled())) {
      return res
        .status(403)
        .json({ success: false, message: REGISTRATION_CLOSED_MESSAGE });
    }

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};
    let {
      fullName,
      email,
      mauId,
      password,
      confirmPassword,
      department,
      phone,
      gender,
      agreeTerms,
    } = body;

    /* Sanitize */
    fullName = fullName ? sanitizeString(fullName) : "";
    email = email ? sanitizeString(email) : "";
    const mauIdErr = validateMauId(mauId);
    if (mauIdErr)
      return res.status(422).json({ success: false, message: mauIdErr });
    const requestedMauId = mauId;

    /* Validate Terms-of-Service consent — cannot be bypassed by direct API call */
    const termsErr = validateTermsAccepted(agreeTerms);
    if (termsErr)
      return res.status(422).json({ success: false, message: termsErr });

    /* Validate required */
    const nameErr = validateName(fullName, "Full name");
    if (nameErr)
      return res.status(422).json({ success: false, message: nameErr });

    const emailErr = validateEmail(email);
    if (emailErr)
      return res.status(422).json({ success: false, message: emailErr });

    if (!password) {
      return res
        .status(422)
        .json({ success: false, message: "Password is required." });
    }

    /* Validate password strength */
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    /* Validate password match */
    const matchErr = validatePasswordMatch(password, confirmPassword);
    if (matchErr)
      return res.status(400).json({ success: false, message: matchErr });

    /* Validate phone if provided */
    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr)
        return res.status(400).json({ success: false, message: phoneErr });
    }

    /* Gender and department are required by the registration form. The
       department list mirrors its predefined choices; custom department/user
       labels are accepted only as letters and spaces, as the form requires. */
    if (typeof gender !== "string" || !gender) {
      return res
        .status(422)
        .json({ success: false, message: "Please select a gender." });
    }
    const genderErr = validateEnum(gender, ["Male", "Female"], "gender");
    if (genderErr)
      return res.status(422).json({ success: false, message: genderErr });

    if (typeof department !== "string" || !department.trim()) {
      return res
        .status(422)
        .json({ success: false, message: "Please select a department." });
    }
    const departmentValue = sanitizeString(department);
    const allowedDepartments = [
      "No Department / Not Assigned",
      "Computer Maintenance",
      "ICT Infrastructure and Security Services",
      "Software Development",
      "Network Administrations",
      "Learning and Technology",
      "System Administration",
    ];

    let normalizedDept = null;
    if (departmentValue === "No Department / Not Assigned") {
      normalizedDept = null;
    } else if (allowedDepartments.includes(departmentValue)) {
      normalizedDept = departmentValue;
    } else if (
      departmentValue.length <= 100 &&
      /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/.test(departmentValue)
    ) {
      normalizedDept = departmentValue;
    } else {
      return res.status(422).json({
        success: false,
        message: "Please select a valid department.",
      });
    }

    if (phone !== undefined && phone !== null && typeof phone !== "string") {
      return res
        .status(422)
        .json({ success: false, message: "Phone number must be text." });
    }
    const normalizedPhone =
      typeof phone === "string" && phone.trim() ? phone.trim() : null;

    /* Check duplicate email */
    const normalizedEmail = email.toLowerCase();
    const existingMauId = await User.findOne({ mauId: requestedMauId });
    if (existingMauId) {
      return res
        .status(409)
        .json({ success: false, message: "This ID is already registered." });
    }
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "Email already registered." });
    }

    const hashed = await bcrypt.hash(password, 12);
    try {
      await User.create({
        fullName,
        email: normalizedEmail,
        mauId: requestedMauId,
        password: hashed,
        role: "Requester",
        department: normalizedDept,
        phone: normalizedPhone,
        gender,
      });
    } catch (err) {
      /* Unique indexes are the final concurrency-safe duplicate guard; two
         simultaneous submissions can both pass the lookup above. */
      if (err && err.code === 11000) {
        if (err.keyPattern?.mauId || err.keyValue?.mauId) {
          return res.status(409).json({
            success: false,
            message: "This ID is already registered.",
          });
        }
        if (err.keyPattern?.email || err.keyValue?.email) {
          return res
            .status(409)
            .json({ success: false, message: "Email already registered." });
        }
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      message:
        "Account created successfully. Your account has been registered as a Requester. You can now sign in.",
    });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/login ───────────────────────────────────── */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    /* Reject malformed bodies instead of crashing with a 500 (typeof guards keep
       numberOf-like values from reaching String methods / bcrypt). */
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res
        .status(422)
        .json({ success: false, message: "Email and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    /* +password: the field is select:false in the schema; login needs the hash. */
    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password",
    );
    if (!user) {
      /* Only log the input email on the server console — never the password. The
         client keeps receiving the generic message for security. */
      console.warn(
        `[auth/login] FAILED for "${normalizedEmail}": no user found with that email.`,
      );
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });
    }

    if (user.status !== "active") {
      console.warn(
        `[auth/login] BLOCKED for "${user.email}": account status is "${user.status}".`,
      );
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated. Contact ICT Admin.",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.warn(
        `[auth/login] FAILED for "${user.email}": password did not match.`,
      );
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password." });
    }

    if (!Object.hasOwn(DASHBOARD_BY_ROLE, user.role)) {
      return res.status(403).json({
        success: false,
        message: "This account has an unsupported role. Contact ICT Admin.",
      });
    }

    /* Record last login */
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    console.log(
      `[auth/login] SUCCESS for "${user.email}" (role: ${user.role}).`,
    );

    const token = createAuthToken(user._id);

    res.json({
      success: true,
      message: "Login successful.",
      redirect: DASHBOARD_BY_ROLE[user.role],
      token,
      expiresIn: AUTH_TOKEN_TTL_SECONDS,
      user: loginUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
};

const logout = (_req, res) => {
  res.json({
    success: true,
    message: "Access token cleared by the client.",
  });
};

/* ── GET /api/auth/me ───────────────────────────────────────── */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      "-password " +
        "-resetPasswordCodeHash " +
        "-resetPasswordCodeExpires " +
        "-resetPasswordCodeAttempts " +
        "-resetPasswordDeliveryMethod " +
        "-resetPasswordRequestId " +
        "-resetPasswordCodeSentAt " +
        "-resetPasswordVerifiedHash " +
        "-resetPasswordVerifiedExpires",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    const profile = user.toObject();
    profile.gender = normalizeGender(profile.gender);
    res.json({ success: true, user: profile });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/forgot-password ────────────────────────────
   Issues a short-lived, single-use, hashed verification code and sends it
   through the configured mailer for real accounts.

   ACCOUNT-ENUMERATION SAFE:
   - The delivery-service availability check runs BEFORE the account lookup,
     so a disabled email/SMS service returns the exact same response for
     every address and never acts as an existence oracle.
   - For a real active account the full reset flow runs (OTP generated,
     hashed, stored, emailed). For unknown/inactive addresses the identical
     generic success response is returned — status and body never differ in
     a way that reveals whether an account exists.
   - Technical failures (provider unavailable, delivery rejected) are logged on the
     server only; the client gets a friendly, generic message plus a `code`
     naming the failing stage (EMAIL_CONFIGURATION_ERROR /
     EMAIL_CONNECTION_ERROR / EMAIL_SEND_ERROR, and the SMS equivalents).
     That code names the stage only — never a host, mailbox or credential. */
const forgotPassword = async (req, res, next) => {
  try {
    const { email, deliveryMethod = "email" } = req.body || {};

    const emailErr = validateEmail(email);
    if (emailErr) {
      return res.status(422).json({ success: false, message: emailErr });
    }
    if (!["email", "sms"].includes(deliveryMethod)) {
      return res
        .status(422)
        .json({ success: false, message: "Choose Email or SMS delivery." });
    }

    /* Delivery-availability gate — checked for EVERY caller BEFORE any user
       lookup so an unconfigured or failing delivery provider can never leak
       account existence, and raw config details (host, mailboxes, credentials)
       are never surfaced to users. The reason is written to the server log only.
       The response carries a `code` naming the failing STAGE — never a host,
       address or credential — so the client can tell the user what to do next
       without learning anything about the deployment. */
    if (
      (deliveryMethod === "email" && !emailConfigured()) ||
      (deliveryMethod === "sms" && !smsConfigured())
    ) {
      const unavailable =
        deliveryMethod === "email"
          ? EMAIL_ERROR.CONFIGURATION
          : "SMS_CONFIGURATION_ERROR";
      console.error(
        `[auth/forgot-password] ${unavailable} - ${deliveryMethod} delivery is not usable in this deployment, ` +
          "so password reset cannot complete for any account. " +
          (deliveryMethod === "email"
            ? `Missing or invalid: ${describeEmailMissing()}.`
            : "Set the SMS provider variables in the deployment environment."),
      );
      return res.status(503).json({
        success: false,
        code: unavailable,
        message:
          "Password reset is temporarily unavailable. Please try again later or contact ICT support.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    /* Identical generic response whether the code was really issued or no
       sendable account exists — so account existence is never revealed. */
    const genericMessage =
      "If the email is associated with an account, a verification code has been sent. Please check your inbox and spam folder.";

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+resetPasswordCodeHash +resetPasswordCodeSentAt",
    );

    if (user && user.status === "active") {
      if (deliveryMethod === "sms" && !user.phone) {
        /* No phone on file: nothing is sent, but the identical generic
           response is returned so the account's existence is not disclosed. */
        console.warn(
          `[auth/forgot-password] SMS requested for "${user.email}" but no phone on file (server-only log).`,
        );
        return res.json({ success: true, message: genericMessage, expiresInSeconds: RESET_CODE_TTL_MS / 1000 });
      }

      /* Server-side resend cooldown — a second request for the SAME account
         inside the cooldown window returns the identical generic response and
         silently keeps the still-valid code (never a status/message that could
         reveal that an account exists). This complements the client countdown
         and survives page reloads / direct API calls. */
      if (
        user.resetPasswordCodeSentAt &&
        Date.now() - new Date(user.resetPasswordCodeSentAt).getTime() <
          RESEND_COOLDOWN_MS
      ) {
        return res.json({ success: true, message: genericMessage, expiresInSeconds: RESET_CODE_TTL_MS / 1000 });
      }

      /* Cryptographic six-digit code. Only its SHA-256 hash is persisted. */
      const code = String(crypto.randomInt(100000, 1000000));

      /* Overwriting the code invalidates every earlier code for this account
         (exactly one live code, one-time use, expires in RESET_CODE_TTL_MS). */
      user.resetPasswordCodeHash = hashResetValue(code);
      user.resetPasswordCodeExpires = new Date(Date.now() + RESET_CODE_TTL_MS);
      user.resetPasswordCodeAttempts = 0;
      user.resetPasswordVerifiedHash = null;
      user.resetPasswordVerifiedExpires = null;
      user.resetPasswordDeliveryMethod = deliveryMethod;
      user.resetPasswordRequestId = crypto.randomUUID();
      user.resetPasswordCodeSentAt = new Date();
      await user.save({ validateBeforeSave: false });

      const delivery =
        deliveryMethod === "sms"
          ? await sendPasswordResetSms({
              to: user.phone,
              code,
              expiresMinutes: RESET_CODE_TTL_MS / 60000,
            })
          : await sendPasswordResetEmail({
              to: user.email,
              code,
              expiresMinutes: RESET_CODE_TTL_MS / 60000,
            });
      if (!delivery.delivered) {
        /* Roll back the stored code — a code is never usable if its delivery
           never happened. Never expose the raw delivery error to the client. */
        user.resetPasswordCodeHash = null;
        user.resetPasswordCodeExpires = null;
        user.resetPasswordCodeAttempts = 0;
        user.resetPasswordDeliveryMethod = null;
        user.resetPasswordRequestId = null;
        user.resetPasswordCodeSentAt = null;
        await user.save({ validateBeforeSave: false });
        const failureCode =
          delivery.code ||
          (deliveryMethod === "sms" ? "SMS_SEND_ERROR" : EMAIL_ERROR.SEND);
        console.error(
          `[auth/forgot-password] ${failureCode} - verification code was NOT delivered ` +
            `for "${user.email}" (${delivery.info}). The stored code has been rolled back, ` +
            "so the account is not left with a usable code that never arrived.",
        );
        return res.status(503).json({
          success: false,
          code: failureCode,
          message:
            "We couldn't send the verification code right now. Please try again later.",
        });
      }
    } else if (user) {
      console.warn(
        `[auth/forgot-password] Skipping token for "${user.email}": account status is "${user.status}" (server-only log).`,
      );
    } else {
      console.warn(
        `[auth/forgot-password] No account found for "${normalizedEmail}" (server-only log).`,
      );
    }

    return res.json({ success: true, message: genericMessage, expiresInSeconds: RESET_CODE_TTL_MS / 1000 });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/verify-reset-code ──────────────────────────
   Checks the 6-digit code (hash match + attempted-count budget + expiry,
   all enforced server-side) and, on success, issues a single-use reset
   authorization token. User-facing messages are generic; technical detail
   is never sent to the client. */
const verifyResetCode = async (req, res, next) => {
  try {
    const { email, code } = req.body || {};
    const emailErr = validateEmail(email);
    if (emailErr) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({
        success: false,
        message: "Enter the 6-digit verification code.",
      });
    }
    const trimmedCode = code.trim();

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select(
      "+resetPasswordCodeHash +resetPasswordCodeExpires +resetPasswordCodeAttempts +resetPasswordDeliveryMethod +resetPasswordRequestId",
    );
    const invalidMessage =
      "The verification code is invalid or has expired. Please request a new code.";
    if (!user || !user.resetPasswordCodeHash) {
      return res.status(400).json({ success: false, message: invalidMessage });
    }

    /* Attempt budget — blocks brute force before any comparison work. */
    if (user.resetPasswordCodeAttempts >= RESET_CODE_MAX_ATTEMPTS) {
      /* The lockout lasts exactly as long as the current code would have, so
         tell the client the real cooldown (Retry-After) instead of leaving it
         to guess with a vague "try again later". */
      const lockoutSeconds = user.resetPasswordCodeExpires
        ? Math.max(
            1,
            Math.ceil(
              (new Date(user.resetPasswordCodeExpires).getTime() - Date.now()) /
                1000,
            ),
          )
        : null;
      if (lockoutSeconds) res.set("Retry-After", String(lockoutSeconds));
      return res.status(429).json({
        success: false,
        message: "Too many verification attempts. Please request a new code.",
        /* Duplicated in the body (like the limiter's 429) so a cross-origin
           client can read the cooldown. */
        ...(lockoutSeconds ? { retryAfter: lockoutSeconds } : {}),
      });
    }

    /* Expiration — enforced on the server, never by client timers. */
    if (
      !user.resetPasswordCodeExpires ||
      user.resetPasswordCodeExpires < new Date()
    ) {
      user.resetPasswordCodeHash = null;
      user.resetPasswordCodeExpires = null;
      user.resetPasswordCodeAttempts = 0;
      user.resetPasswordDeliveryMethod = null;
      user.resetPasswordRequestId = null;
      user.resetPasswordCodeSentAt = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message:
          "This verification code has expired. Please request a new code.",
      });
    }

    const expected = Buffer.from(user.resetPasswordCodeHash, "hex");
    const actual = Buffer.from(hashResetValue(trimmedCode), "hex");
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      user.resetPasswordCodeAttempts += 1;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message:
          "The verification code is incorrect. Please check the code and try again.",
      });
    }

    /* Code accepted. Issue a random, single-use token; only its hash is stored. */
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordCodeHash = null;
    user.resetPasswordCodeExpires = null;
    user.resetPasswordCodeAttempts = 0;
    user.resetPasswordDeliveryMethod = null;
    user.resetPasswordRequestId = null;
    user.resetPasswordCodeSentAt = null;
    user.resetPasswordVerifiedHash = hashResetValue(resetToken);
    user.resetPasswordVerifiedExpires = new Date(
      Date.now() + RESET_TOKEN_TTL_MS,
    );
    await user.save({ validateBeforeSave: false });
    return res.json({
      success: true,
      message: "Code verified. Create your new password.",
      resetToken,
    });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/reset-password ─────────────────────────────
   Updates the password ONLY when the caller can present a valid reset
   authorization: the single-use token issued by verify-reset-code in the
   JSON body.
   The token is opaque, single-use, expires, and is tied to this reset
   request — the server resolves the account from the hashed token, so an
   arbitrary user ID can never be submitted by the client. */
const resetPassword = async (req, res, next) => {
  try {
    const { password, resetToken } = req.body || {};
    if (typeof password !== "string") {
      return res
        .status(422)
        .json({ success: false, message: "A new password is required." });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    const rawToken = typeof resetToken === "string" ? resetToken.trim() : "";
    if (!RESET_TOKEN_PATTERN.test(rawToken)) {
      return res.status(400).json({
        success: false,
        message:
          "Your verification token is invalid or has already been used.",
      });
    }

    const tokenHash = hashResetValue(rawToken);
    const user = await User.findOne({
      resetPasswordVerifiedHash: tokenHash,
    }).select("+resetPasswordVerifiedHash +resetPasswordVerifiedExpires");

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Your verification token is invalid or has already been used.",
      });
    }

    if (
      !user.resetPasswordVerifiedExpires ||
      user.resetPasswordVerifiedExpires < new Date()
    ) {
      user.resetPasswordVerifiedHash = null;
      user.resetPasswordVerifiedExpires = null;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message:
          "Your verification token has expired. Please request a new code.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated. Contact ICT Admin.",
      });
    }

    /* Update the password with the SAME mechanism used everywhere (bcrypt,
       cost 12). Roles, permissions and all other account fields are untouched.
       NEVER return the password or its hash — the response omits them. */
    user.password = await bcrypt.hash(password, 12);

    /* Consume the token immediately: single-use is guaranteed — the same
       token can never be used again, and it dies with expiry going forward.
       Any leftover code state is cleared too. */
    user.resetPasswordVerifiedHash = null;
    user.resetPasswordVerifiedExpires = null;
    user.resetPasswordCodeHash = null;
    user.resetPasswordCodeExpires = null;
    user.resetPasswordCodeAttempts = 0;
    user.resetPasswordDeliveryMethod = null;
    user.resetPasswordRequestId = null;
    user.resetPasswordCodeSentAt = null;
    await user.save({ validateBeforeSave: false });
    console.log(`[auth/reset-password] Password reset for "${user.email}".`);

    return res.json({
      success: true,
      message:
        "Your password has been reset successfully. You can now log in with your new password.",
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  getRegistrationStatus,
  getGoogleAuthConfig,
  googleLogin,
  login,
  logout,
  getMe,
  forgotPassword,
  verifyResetCode,
  resetPassword,
};
