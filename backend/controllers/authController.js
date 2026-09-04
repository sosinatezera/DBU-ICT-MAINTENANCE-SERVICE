/**
 * controllers/authController.js
 * Authentication — register, login, get current user
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateName,
  validatePhone,
  validateEnum,
  validateTermsAccepted,
  sanitizeString,
  VALID_GENDERS,
} = require("../middleware/validation");
const { sendPasswordResetEmail } = require("../services/mailer");
const env = require("../config/env");

/* Token lifetime for password reset links — 15–30 minutes per spec; we use 30. */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/* ── POST /api/auth/register ────────────────────────────────── */
const register = async (req, res, next) => {
  try {
    let { fullName, email, password, confirmPassword, department, phone, gender, agreeTerms } =
      req.body;

    /* Sanitize */
    fullName = fullName ? sanitizeString(fullName) : "";
    email = email ? sanitizeString(email) : "";

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

    /* Validate gender if provided */
    if (gender) {
      const genderErr = validateEnum(gender, VALID_GENDERS, 'gender');
      if (genderErr)
        return res.status(400).json({ success: false, message: genderErr });
    }

    /* Normalize department */
    let normalizedDept = null;
    if (department && typeof department === "string") {
      const trimmed = department.trim();
      if (trimmed !== "" && trimmed !== "No Department / Not Assigned") {
        normalizedDept = trimmed;
      }
    }

    /* Check duplicate email */
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "Email already registered." });
    }

    const hashed = await bcrypt.hash(password, 12);
    await User.create({
      fullName,
      email: email.toLowerCase(),
      password: hashed,
      role: "Requester",
      department: normalizedDept,
      phone: phone || null,
      gender: gender || null,
    });

    res.status(201).json({
      success: true,
      message: "Registration successful. You can now log in.",
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
    const user = await User.findOne({ email: normalizedEmail });
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

    /* Record last login */
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    console.log(
      `[auth/login] SUCCESS for "${user.email}" (role: ${user.role}).`,
    );

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.fullName },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "24h" },
    );

    const redirectMap = {
      "ICT Admin": "/views/admin/dashboard.html",
      Requester: "/views/user/dashboard.html",
      Technician: "/views/technician/dashboard.html",
    };

    res.json({
      success: true,
      message: "Login successful.",
      token,
      redirect: redirectMap[user.role] || "/views/user/dashboard.html",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: user.department,
        gender: user.gender,
        profileImage: user.profileImage || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/auth/me ───────────────────────────────────────── */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/forgot-password ────────────────────────────
   Issues a short-lived, single-use, hashed reset token and sends a reset link.
   ACCOUNT-ENUMERATION SAFE: we always return the same generic message whether
   an account exists or not, and never reveal existence via status codes.
   Errors are only emitted to the server console, never to the client. */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body || {};

    const emailErr = validateEmail(email);
    if (emailErr) {
      return res
        .status(422)
        .json({ success: false, message: emailErr });
    }

    const normalizedEmail = email.trim().toLowerCase();

    /* Generic success — returned both for existing and non-existing emails so
       the response tells an attacker nothing about whether the account exists. */
    const genericMessage =
      "If an account exists for this email, a password reset link has been sent.";

    /* Find the account; .select('+...') is not needed here because we only need
       the user document to issue a token. Any lookup failure is non-fatal. */
    const user = await User.findOne({ email: normalizedEmail });

    if (user && user.status === "active") {
      /* Cryptographic random token — 32 bytes → 64 hex chars.
         Never user-id, email, timestamp or username based.
         Only the SHA-256 HASH is stored in the database, never the raw token. */
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      /* Single active token per user: overwrite any previous (also invalidates
         an unused, still-unexpired token from an earlier request). */
      user.resetPasswordToken = tokenHash;
      user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await user.save({ validateBeforeSave: false });

      const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/views/reset-password.html?token=${rawToken}`;

      await sendPasswordResetEmail({ to: user.email, resetUrl });
    } else if (user) {
      console.warn(
        `[auth/forgot-password] Skipping token for "${user.email}": account status is "${user.status}".`,
      );
    } else {
      console.warn(
        `[auth/forgot-password] No account found for "${normalizedEmail}" (server-only log).`,
      );
    }

    return res.json({ success: true, message: genericMessage });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/auth/reset-password ─────────────────────────────
   Verifies the (hashed) token, enforces expiry + single-use, updates the
   user's password with the existing bcrypt mechanism, then destroys the token. */
const resetPassword = async (req, res, next) => {
  try {
    let { token, password } = req.body || {};

    if (typeof token !== "string" || !token) {
      return res
        .status(400)
        .json({ success: false, message: "An invalid or expired reset token was provided." });
    }
    if (typeof password !== "string") {
      return res
        .status(422)
        .json({ success: false, message: "A new password is required." });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    /* In the database we only ever have the hash — look the token up by its
       SHA-256 digest. If the user is missing, the token was already used and
       destroyed (single-use) or never existed for this hash. */
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "This reset link is invalid or has already been used." });
    }

    if (!user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      /* Expired or malformed — destroy it and reject. */
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save({ validateBeforeSave: false });
      return res
        .status(400)
        .json({ success: false, message: "This reset link has expired. Please request a new one." });
    }

    if (user.status !== "active") {
      return res
        .status(403)
        .json({ success: false, message: "Account has been deactivated. Contact ICT Admin." });
    }

    /* Update the password with the SAME mechanism used everywhere (bcrypt,
       cost 12). NEVER return the password or its hash — the response omits them. */
    user.password = await bcrypt.hash(password, 12);

    /* Invalid the token immediately: single-use guaranteed — the same token
       can never be used again, and it dies with expiry going forward. */
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save({ validateBeforeSave: false });

    console.log(`[auth/reset-password] Password reset for "${user.email}".`);

    return res.json({
      success: true,
      message: "Your password has been reset. You can now sign in.",
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe, forgotPassword, resetPassword };
