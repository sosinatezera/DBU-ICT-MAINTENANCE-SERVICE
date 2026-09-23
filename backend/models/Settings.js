/**
 * models/Settings.js
 * System-wide settings — singleton pattern (one document)
 * Smart ICT Maintenance Management System
 */

const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    /* ── General ──────────────────────────────────────────── */
    systemName: {
      type: String,
      default: "Smart ICT Maintenance Management System",
      trim: true,
    },
    organizationName: {
      type: String,
      default: "Mekdela Amba University",
      trim: true,
    },
    systemDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    defaultLanguage: {
      type: String,
      enum: ["en", "am", "om"],
      default: "en",
    },
    timezone: {
      type: String,
      default: "Africa/Addis_Ababa",
      trim: true,
    },
    dateFormat: {
      type: String,
      enum: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "EC"],
      default: "DD/MM/YYYY",
    },

    /* ── Notifications ────────────────────────────────────── */
    notifNewRequest: { type: Boolean, default: true },
    notifAssignment: { type: Boolean, default: true },
    notifStatusChange: { type: Boolean, default: true },
    notifCompletion: { type: Boolean, default: true },
    notifSystemSecurity: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: false },

    /* ── Operational / quick settings ─────────────────────── */
    publicRegistration: { type: Boolean, default: false },
    techAutoNotify: { type: Boolean, default: true },
    slaResponseHours: { type: Number, default: 24, min: 1, max: 720 },
    defaultPriority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    /* ── Home page image layout ──────────────────────────── */
    homeImageLayout: {
      heroOrder: {
        type: [String],
        default: () => [
          "hero-1",
          "hero-2",
          "hero-3",
          "hero-4",
          "hero-5",
          "hero-6",
        ],
      },
      logoOffset: {
        x: { type: Number, default: 0, min: -14, max: 14 },
        y: { type: Number, default: 0, min: -14, max: 14 },
      },
    },

    /* ── Meta ─────────────────────────────────────────────── */
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

/* Ensure only one settings document exists */
settingsSchema.statics.getInstance = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model("Settings", settingsSchema);
