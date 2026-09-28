/**
 * models/User.js
 * User schema for Smart ICT Maintenance Management System
 *
 * Roles:
 *   - 'Requester'   → DBU staff who submit maintenance tickets
 *   - 'Technician'  → ICT repair staff who resolve tickets
 *   - 'ICT Admin'   → Directorate manager with full system access
 * */

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required."],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address."],
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", "Prefer not to say"],
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: 8,
      /* Stored as a bcrypt hash. select:false keeps the hash out of every default
         query; code that needs it must re-add it with .select('+password'). */
      select: false,
    },
    role: {
      type: String,
      enum: ["Requester", "Technician", "ICT Admin"],
      default: "Requester",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    /* Password reset verification state. Raw codes and reset-session tokens
       are never persisted; only their SHA-256 hashes are stored. */
    resetPasswordCodeHash: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordCodeExpires: {
      type: Date,
      default: null,
      select: false,
    },
    resetPasswordCodeAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    resetPasswordDeliveryMethod: {
      type: String,
      enum: ["email", "sms", null],
      default: null,
      select: false,
    },
    resetPasswordRequestId: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordCodeSentAt: {
      type: Date,
      default: null,
      select: false,
    },
    resetPasswordVerifiedHash: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordVerifiedExpires: {
      type: Date,
      default: null,
      select: false,
    },
    profileImage: {
      type: String,
      default: null,
    },
    notificationPreferences: {
      inAppNotifications: { type: Boolean, default: true },
      emailNotifications: { type: Boolean, default: true },
      maintenanceAlerts: { type: Boolean, default: true },
    },
    /* Per-user display preferences. These are stored server-side so a user's
       language and theme follow their account across devices/browsers; the
       client still mirrors them into localStorage for instant application
       before the first API response arrives (see theme.js / lang.js). */
    preferences: {
      language: {
        type: String,
        enum: ["en", "am"],
        default: "en",
      },
      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "light",
      },
    },
  },
  { timestamps: true },
);

/* Hot path: admin user list filtered by role + status. */
userSchema.index({ role: 1, status: 1 });
userSchema.index({ role: 1, status: 1, createdAt: -1 });
userSchema.index({ fullName: 1 });
userSchema.index({ department: 1, createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
