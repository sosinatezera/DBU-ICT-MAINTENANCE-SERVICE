
const Settings = require("../models/Settings");
const mongoose = require("mongoose");
const config = require("../config/env");
const { AUTH_TOKEN_TTL_SECONDS } = require("../services/authToken");
const { writeAuditLog } = require("../middleware/audit");
const {
  validateEnum,
  validateLength,
  validateBoolean,
  validateRequired,
  sanitizeString,
  VALID_LANGUAGES,
  VALID_DATE_FORMATS,
  VALID_TIMEZONES,
} = require("../middleware/validation");

const GENERAL_FIELDS = [
  "systemName",
  "organizationName",
  "systemDescription",
  "defaultLanguage",
  "defaultTheme",
  "timezone",
  "dateFormat",
  "timeFormat",
];

const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
const POLICY_FIELDS = [
  "publicRegistration",
  "techAutoNotify",
  "slaResponseHours",
  "defaultPriority",
];

const NOTIF_FIELDS = [
  "notifNewRequest",
  "notifAssignment",
  "notifStatusChange",
  "notifCompletion",
  "notifSystemSecurity",
  "notifUserFeedback",
  "notifTechnicianFeedback",
  "notifFeedbackReplies",
  "notificationSound",
  "emailNotifications",
];

const HOME_HERO_IMAGE_IDS = [
  "hero-1",
  "hero-2",
  "hero-3",
  "hero-4",
  "hero-5",
  "hero-6",
];

function recordSettingChanges(req, section, before, after, fields) {
  const changes = fields
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      setting: field,
      previousValue: before[field],
      newValue: after[field],
    }));
  if (!changes.length) return;
  void writeAuditLog({
    user: req.user.id,
    action: `Updated ${section} settings`,
    entity: "settings",
    entityId: String(after._id),
    details: JSON.stringify(changes),
    ip: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.headers?.["user-agent"] || "",
  });
}

/* ── GET /api/settings — retrieve all settings ─────────── */
const getSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getInstance();
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/settings/general — update general settings ─ */
const updateGeneral = async (req, res, next) => {
  try {
    const settings = await Settings.getInstance();
    const before = settings.toObject();

    /* Validate */
    if (req.body.systemName !== undefined) {
      const nameErr = validateRequired(req.body.systemName, "System name");
      if (nameErr)
        return res.status(422).json({ success: false, message: nameErr });
      const lenErr = validateLength(
        sanitizeString(req.body.systemName),
        "System name",
        { min: 2, max: 100 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.organizationName !== undefined) {
      const orgErr = validateRequired(
        req.body.organizationName,
        "Organization name",
      );
      if (orgErr)
        return res.status(422).json({ success: false, message: orgErr });
      const lenErr = validateLength(
        sanitizeString(req.body.organizationName),
        "Organization name",
        { min: 2, max: 100 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.defaultLanguage !== undefined) {
      const langErr = validateEnum(
        req.body.defaultLanguage,
        VALID_LANGUAGES,
        "language",
      );
      if (langErr)
        return res.status(400).json({ success: false, message: langErr });
    }

    if (req.body.timezone !== undefined) {
      const tzErr = validateEnum(
        req.body.timezone,
        VALID_TIMEZONES,
        "time zone",
      );
      if (tzErr)
        return res.status(400).json({ success: false, message: tzErr });
    }

    if (req.body.dateFormat !== undefined) {
      const fmtErr = validateEnum(
        req.body.dateFormat,
        VALID_DATE_FORMATS,
        "date format",
      );
      if (fmtErr)
        return res.status(400).json({ success: false, message: fmtErr });
    }

    if (req.body.defaultTheme !== undefined) {
      const themeErr = validateEnum(req.body.defaultTheme, ["light", "dark"], "default theme");
      if (themeErr) return res.status(400).json({ success: false, message: themeErr });
    }
    if (req.body.timeFormat !== undefined) {
      const timeErr = validateEnum(req.body.timeFormat, ["12h", "24h"], "time format");
      if (timeErr) return res.status(400).json({ success: false, message: timeErr });
    }

    for (const field of ["publicRegistration", "techAutoNotify"]) {
      if (req.body[field] === undefined) continue;
      const boolErr = validateBoolean(req.body[field], field);
      if (boolErr) return res.status(400).json({ success: false, message: boolErr });
      settings[field] = req.body[field] === true || req.body[field] === 1 || req.body[field] === "true";
    }

    if (req.body.slaResponseHours !== undefined) {
      const sla = Number(req.body.slaResponseHours);
      if (!Number.isFinite(sla) || sla < 1 || sla > 720) {
        return res.status(400).json({
          success: false,
          message: "SLA response time must be between 1 and 720 hours.",
        });
      }
      settings.slaResponseHours = sla;
    }

    if (req.body.defaultPriority !== undefined) {
      const priErr = validateEnum(
        req.body.defaultPriority,
        VALID_PRIORITIES,
        "default priority",
      );
      if (priErr)
        return res.status(400).json({ success: false, message: priErr });
      settings.defaultPriority = req.body.defaultPriority;
    }

    if (req.body.defaultTheme !== undefined) settings.defaultTheme = req.body.defaultTheme;
    if (req.body.timeFormat !== undefined) settings.timeFormat = req.body.timeFormat;

    GENERAL_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) {
        settings[f] =
          typeof req.body[f] === "string"
            ? sanitizeString(req.body[f])
            : req.body[f];
      }
    });

    settings.updatedBy = req.user.id;
    await settings.save();
    recordSettingChanges(
      req,
      "general and operational",
      before,
      settings.toObject(),
      [...GENERAL_FIELDS, ...POLICY_FIELDS],
    );
    /* getInstance() memoises the document, so the next reader would pick up
       the in-memory copy. Invalidate anyway so every reader is guaranteed to
       observe the write that just happened. */
    Settings.invalidateInstanceCache();
    res.json({
      success: true,
      message: "General settings updated.",
      data: settings,
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/settings/notifications — update notif prefs ─ */
const updateNotifications = async (req, res, next) => {
  try {
    const entries = Object.entries(req.body || {});
    if (!entries.length) {
      return res.status(400).json({
        success: false,
        message: "No notification preferences were provided.",
      });
    }
    for (const [key, value] of entries) {
      if (!NOTIF_FIELDS.includes(key)) {
        return res.status(400).json({
          success: false,
          message: `Unknown notification preference "${key}".`,
        });
      }
      if (typeof value !== "boolean") {
        return res.status(400).json({
          success: false,
          message: `${key} must be true or false.`,
        });
      }
    }

    const settings = await Settings.getInstance();
    const before = settings.toObject();
    entries.forEach(([key, value]) => {
      settings[key] = value;
    });
    settings.updatedBy = req.user.id;
    await settings.save();
    recordSettingChanges(
      req,
      "notification",
      before,
      settings.toObject(),
      entries.map(([key]) => key),
    );
    Settings.invalidateInstanceCache();
    res.json({
      success: true,
      message: "Notification settings updated.",
      data: settings,
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/settings/home-layout — save Home image order ─ */
const updateHomeLayout = async (req, res, next) => {
  try {
    const { heroOrder, logoOffset = { x: 0, y: 0 } } = req.body || {};
    const isValidOrder =
      Array.isArray(heroOrder) &&
      heroOrder.length === HOME_HERO_IMAGE_IDS.length &&
      new Set(heroOrder).size === HOME_HERO_IMAGE_IDS.length &&
      heroOrder.every((id) => HOME_HERO_IMAGE_IDS.includes(id));

    if (!isValidOrder) {
      return res
        .status(422)
        .json({ success: false, message: "Home image order is invalid." });
    }

    const logoX = Number(logoOffset.x);
    const logoY = Number(logoOffset.y);
    if (
      !Number.isFinite(logoX) ||
      !Number.isFinite(logoY) ||
      logoX < -14 ||
      logoX > 14 ||
      logoY < -14 ||
      logoY > 14
    ) {
      return res
        .status(422)
        .json({ success: false, message: "Home logo position is invalid." });
    }

    const settings = await Settings.getInstance();
    const before = settings.toObject();
    settings.homeImageLayout = {
      heroOrder,
      logoOffset: { x: logoX, y: logoY },
    };
    settings.updatedBy = req.user.id;
    await settings.save();
    recordSettingChanges(req, "home layout", before, settings.toObject(), ["homeImageLayout"]);
    Settings.invalidateInstanceCache();
    res.json({
      success: true,
      message: "Home image layout saved.",
      data: settings.homeImageLayout,
    });
  } catch (err) {
    next(err);
  }
};

const getSystemOverview = async (_req, res, next) => {
  try {
    const packageJson = require("../package.json");
    res.json({
      success: true,
      data: {
        version: packageJson.version,
        environment: config.NODE_ENV,
        database: mongoose.connection.readyState === 1 ? "Connected" : "Unavailable",
        authTokenLifetimeHours: Math.ceil(
          AUTH_TOKEN_TTL_SECONDS / 3600,
        ),
        passwordPolicy: "8–16 characters; at least one letter and one number; no spaces.",
        multiFactorAuthentication: "Not configured",
        roles: [
          { name: "ICT Admin", access: "Administrator routes, including settings and audit logs" },
          { name: "Requester", access: "Own requests, feedback, and profile" },
          { name: "Technician", access: "Assigned work, technician feedback, and profile" },
        ],
        supportedOperations: {
          backups: false,
          maintenanceMode: false,
          editableRolePermissions: false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSettings,
  updateGeneral,
  updateNotifications,
  updateHomeLayout,
  getSystemOverview,
};
