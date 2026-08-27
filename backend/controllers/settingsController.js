/**
 * controllers/settingsController.js
 * System-wide settings — read & update (admin only)
 */
const Settings = require('../models/Settings');
const { validateEnum, validateLength, validateBoolean, validateRequired, sanitizeString, VALID_LANGUAGES, VALID_DATE_FORMATS } = require('../middleware/validation');

const GENERAL_FIELDS = [
  'systemName', 'organizationName', 'systemDescription',
  'defaultLanguage', 'timezone', 'dateFormat',
];

const NOTIF_FIELDS = [
  'notifNewRequest', 'notifAssignment', 'notifStatusChange',
  'notifCompletion', 'notifSystemSecurity', 'emailNotifications',
];

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

    /* Validate */
    if (req.body.systemName !== undefined) {
      const nameErr = validateRequired(req.body.systemName, 'System name');
      if (nameErr) return res.status(422).json({ success: false, message: nameErr });
      const lenErr = validateLength(sanitizeString(req.body.systemName), 'System name', { min: 2, max: 100 });
      if (lenErr) return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.organizationName !== undefined) {
      const orgErr = validateRequired(req.body.organizationName, 'Organization name');
      if (orgErr) return res.status(422).json({ success: false, message: orgErr });
      const lenErr = validateLength(sanitizeString(req.body.organizationName), 'Organization name', { min: 2, max: 100 });
      if (lenErr) return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.defaultLanguage !== undefined) {
      const langErr = validateEnum(req.body.defaultLanguage, VALID_LANGUAGES, 'language');
      if (langErr) return res.status(400).json({ success: false, message: langErr });
    }

    if (req.body.dateFormat !== undefined) {
      const fmtErr = validateEnum(req.body.dateFormat, VALID_DATE_FORMATS, 'date format');
      if (fmtErr) return res.status(400).json({ success: false, message: fmtErr });
    }

    GENERAL_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) {
        settings[f] = typeof req.body[f] === 'string' ? sanitizeString(req.body[f]) : req.body[f];
      }
    });

    settings.updatedBy = req.user.id;
    await settings.save();
    res.json({ success: true, message: 'General settings updated.', data: settings });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/settings/notifications — update notif prefs ─ */
const updateNotifications = async (req, res, next) => {
  try {
    const settings = await Settings.getInstance();
    NOTIF_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) settings[f] = !!req.body[f];
    });
    settings.updatedBy = req.user.id;
    await settings.save();
    res.json({ success: true, message: 'Notification settings updated.', data: settings });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateGeneral, updateNotifications };
