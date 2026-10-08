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
    notificationSound: { type: Boolean, default: true },
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

/* ── Singleton accessor ────────────────────────────────────────
   getInstance() sat on the request path of 6 handlers (4 in settingsController,
   getDashboardStats, and the mailer's send gating), and each call issued a
   fresh findOne against Mongo. The document is read-mostly — it changes only
   when an admin saves a settings form — so it is memoised in memory.

   The cache holds the live Mongoose document on purpose: callers mutate it
   (updateGeneral, mailer.settingEnabled) and then save(), and the updatedAt
   hook still fires because save() runs on the real document. A lean() clone
   would silently discard those writes.

   Invalidate explicitly via Settings.invalidateInstanceCache() after any
   save() issued outside getInstance(). */
const INSTANCE_CACHE_TTL_MS = 5000;
let _instanceCache = { at: 0, doc: null };
let _instanceInFlight = null;

settingsSchema.statics.getInstance = async function () {
  const now = Date.now();
  if (_instanceCache.doc && now - _instanceCache.at < INSTANCE_CACHE_TTL_MS) {
    return _instanceCache.doc;
  }

  /* Collapse concurrent misses into a single query — the duplicate-call
     pattern on the frontend (concurrent requests) used to fan out here. */
  if (!_instanceInFlight) {
    _instanceInFlight = (async () => {
      let settings = await this.findOne();
      if (!settings) {
        settings = await this.create({});
      }
      return settings;
    })();
  }

  /* Capture the handle we actually await. Without this, a later caller that
     already installed a fresh in-flight query could have its handle nulled by
     an earlier caller's finally, causing a needless extra findOne. */
  const pending = _instanceInFlight;
  try {
    const doc = await pending;
    _instanceCache = { at: Date.now(), doc };
    return doc;
  } finally {
    if (_instanceInFlight === pending) _instanceInFlight = null;
  }
};

settingsSchema.statics.invalidateInstanceCache = function () {
  _instanceCache = { at: 0, doc: null };
};

module.exports = mongoose.model("Settings", settingsSchema);
