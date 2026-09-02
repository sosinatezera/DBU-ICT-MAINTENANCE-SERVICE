/**
 * models/Settings.js
 * System-wide settings — singleton pattern (one document)
 * Smart Computer Maintenance Service Request and Tracking System
 */

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    /* ── General ──────────────────────────────────────────── */
    systemName: {
      type: String,
      default: 'Smart Computer Maintenance Service Request and Tracking System',
      trim: true,
    },
    organizationName: {
      type: String,
      default: 'Debre Berhan University',
      trim: true,
    },
    systemDescription: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    defaultLanguage: {
      type: String,
      enum: ['en', 'am'],
      default: 'en',
    },
    timezone: {
      type: String,
      default: 'Africa/Addis_Ababa',
      trim: true,
    },
    dateFormat: {
      type: String,
      enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY'],
      default: 'DD/MM/YYYY',
    },

    /* ── Notifications ────────────────────────────────────── */
    notifNewRequest:     { type: Boolean, default: true },
    notifAssignment:     { type: Boolean, default: true },
    notifStatusChange:   { type: Boolean, default: true },
    notifCompletion:     { type: Boolean, default: true },
    notifSystemSecurity: { type: Boolean, default: true },
    emailNotifications:  { type: Boolean, default: false },

    /* ── Operational / quick settings ─────────────────────── */
    publicRegistration: { type: Boolean, default: false },
    techAutoNotify:     { type: Boolean, default: true },
    slaResponseHours:   { type: Number,  default: 24, min: 1, max: 720 },
    defaultPriority:    { type: String,  enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },

    /* ── Meta ─────────────────────────────────────────────── */
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

/* Ensure only one settings document exists */
settingsSchema.statics.getInstance = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('Settings', settingsSchema);
