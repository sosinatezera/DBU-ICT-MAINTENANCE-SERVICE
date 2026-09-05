/**
 * middleware/validation.js
 * Shared validation utilities for all controllers
 * Smart Computer Maintenance Service Request and Tracking System
 */

const mongoose = require('mongoose');

/* ── Constants ──────────────────────────────────────────── */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,100}$/;
/* Gmail-only: local part must contain at least one letter and end exactly with @gmail.com (case-insensitive domain) */
const EMAIL_REGEX    = /^(?=[A-Za-z0-9._%+-]*[A-Za-z])[A-Za-z0-9._%+-]+@gmail\.com$/i;
/* Phone: Ethiopian mobile — exactly 10 digits (0-9) only, starting with 09 or 07.
   No letters, spaces, +, -, or special chars. */
const PHONE_REGEX   = /^(09|07)\d{8}$/;
/* Full name: must contain at least one letter, allow letters/digits/spaces/apostrophes/dots/hyphens.
   Rejects numbers-only and special-characters-only values; no length limit. */
const NAME_REGEX    = /^(?=[\p{L}\d\s.'-]*[\p{L}])[\p{L}\d\s.'-]+$/u;

const VALID_ROLES       = ['Requester', 'Technician', 'ICT Admin'];
const VALID_STATUSES    = ['active', 'inactive'];
const VALID_PRIORITIES  = ['low', 'medium', 'high', 'critical'];
const VALID_TICKET_STATUSES = ['submitted', 'under_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed'];
const VALID_EQUIPMENT   = ['Desktop Computer', 'Laptop', 'Printer', 'Scanner', 'Monitor', 'Projector', 'UPS / Power Supply', 'Keyboard / Mouse', 'Other'];
const VALID_MAINT_STATUS = ['accepted', 'in_progress', 'resolved'];
const VALID_ASSET_STATUSES = ['active', 'under_maintenance', 'decommissioned'];
const VALID_ASSIGN_STATUSES = ['assigned', 'accepted', 'in_progress', 'completed', 'reassigned'];
const VALID_INQUIRY_TYPES = ['Hardware Problem', 'Software Problem', 'Internet Connectivity', 'Printer Problem', 'Account / Access Problem', 'ICT Service Request', 'Other'];
const VALID_REQUEST_CATEGORIES = [
  'Hardware Problem',
  'Software Problem',
  'Internet Connectivity',
  'Printer / Scanner',
  'Computer / Laptop',
  'Account / Password',
  'Email Problem',
  'System / Application',
  'ICT Security',
  'Other'
];
const VALID_GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const VALID_LANGUAGES = ['en', 'am'];
const VALID_DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'EC'];
const VALID_TIMEZONES = ['Africa/Addis_Ababa', 'Africa/Nairobi', 'UTC'];

/* ── Core Validators ────────────────────────────────────── */

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function validateObjectId(id, fieldName = 'ID') {
  if (!id || !isValidObjectId(id)) {
    return `Invalid ${fieldName} format.`;
  }
  return null;
}

function validateRequired(value, fieldName) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return `${fieldName} is required.`;
  }
  return null;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return 'Email is required.';
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'Email is required.';
  if (trimmed.length > 254) return 'Email is too long.';
  if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid Gmail address ending with @gmail.com.';
  return null;
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters, contain both letters and numbers, and may include special characters.';
  if (!PASSWORD_REGEX.test(password)) return 'Password must be at least 8 characters (max 100), contain both letters and numbers, and may include special characters (no spaces).';
  return null;
}

function validatePasswordMatch(password, confirmPassword) {
  if (!confirmPassword) return 'Please confirm your password.';
  if (password !== confirmPassword) return 'Passwords do not match.';
  return null;
}

function validateName(name, fieldName = 'Name') {
  if (!name || typeof name !== 'string') return `${fieldName} is required.`;
  const trimmed = name.trim();
  if (trimmed.length === 0) return `${fieldName} is required.`;

  if (!NAME_REGEX.test(trimmed)) {
    return `${fieldName} must contain letters and cannot contain only numbers or special characters.`;
  }
  return null;
}

function validatePhone(phone) {
  if (!phone || phone.trim() === '') return null;
  if (!PHONE_REGEX.test(phone.trim())) return 'Phone number must be exactly 10 digits starting with 09 or 07.';
  return null;
}

/* Registration Terms-of-Service consent — must be explicitly true. */
function validateTermsAccepted(agreed) {
  if (agreed !== true && agreed !== 1 && agreed !== 'true') {
    return 'You must agree to the Terms of Service before registering.';
  }
  return null;
}

function validateEnum(value, allowed, fieldName) {
  if (value === undefined || value === null) return null;
  if (!allowed.includes(value)) {
    return `Invalid ${fieldName}. Must be one of: ${allowed.join(', ')}.`;
  }
  return null;
}

function validateLength(value, fieldName, { min = 0, max = Infinity } = {}) {
  if (!value || typeof value !== 'string') return null;
  const len = value.trim().length;
  if (len < min) return `${fieldName} must be at least ${min} characters.`;
  if (len > max) return `${fieldName} must be no more than ${max} characters.`;
  return null;
}

function validateBoolean(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean' && value !== 0 && value !== 1 && value !== 'true' && value !== 'false') {
    return `${fieldName} must be a boolean value.`;
  }
  return null;
}

function validateInteger(value, fieldName, { min = 0, max = Infinity } = {}) {
  const num = Number(value);
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(num)) return `${fieldName} must be a whole number.`;
  if (num < min) return `${fieldName} must be at least ${min}.`;
  if (num > max) return `${fieldName} must be no more than ${max}.`;
  return null;
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ');
}

function trimBody(fields, req, _res, next) {
  fields.forEach(f => {
    if (req.body[f] && typeof req.body[f] === 'string') {
      req.body[f] = req.body[f].trim();
    }
  });
  next();
}

/* ── Batch Validator ────────────────────────────────────── */
function runValidations(validations) {
  const errors = {};
  let hasError = false;

  for (const { field, value, checks } of validations) {
    for (const check of checks) {
      const msg = check(value);
      if (msg) {
        errors[field] = msg;
        hasError = true;
        break;
      }
    }
  }

  if (hasError) {
    return { success: false, message: 'Validation failed.', errors };
  }
  return null;
}

module.exports = {
  isValidObjectId,
  validateObjectId,
  validateRequired,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateName,
  validatePhone,
  validateTermsAccepted,
  validateEnum,
  validateLength,
  validateBoolean,
  validateInteger,
  sanitizeString,
  trimBody,
  runValidations,
  PASSWORD_REGEX,
  EMAIL_REGEX,
  PHONE_REGEX,
  VALID_ROLES,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_TICKET_STATUSES,
  VALID_EQUIPMENT,
  VALID_MAINT_STATUS,
  VALID_ASSET_STATUSES,
  VALID_ASSIGN_STATUSES,
  VALID_INQUIRY_TYPES,
  VALID_REQUEST_CATEGORIES,
  VALID_GENDERS,
  VALID_LANGUAGES,
  VALID_DATE_FORMATS,
  VALID_TIMEZONES,
};
