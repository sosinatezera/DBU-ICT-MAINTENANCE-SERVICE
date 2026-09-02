/**
 * controllers/authController.js
 * Authentication — register, login, get current user
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateName,
  validatePhone,
  sanitizeString,
} = require("../middleware/validation");

/* ── POST /api/auth/register ────────────────────────────────── */
const register = async (req, res, next) => {
  try {
    let { fullName, email, password, confirmPassword, department, phone } =
      req.body;

    /* Sanitize */
    fullName = fullName ? sanitizeString(fullName) : "";
    email = email ? sanitizeString(email) : "";

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

module.exports = { register, login, getMe };
