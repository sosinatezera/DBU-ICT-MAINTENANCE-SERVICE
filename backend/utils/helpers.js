/**
 * backend/utils/helpers.js
 * Shared utility functions for the Smart Computer Maintenance Service backend.
 */

'use strict';

/* ── Date & Time ──────────────────────────────────────────── */

/**
 * Format a Date object to a readable string.
 * @param {Date|string} date
 * @returns {string} e.g. "16 Aug 2026, 14:30"
 */
function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calculate the difference between two dates in hours.
 * @param {Date|string} start
 * @param {Date|string} end
 * @returns {number} hours (rounded to 1 decimal)
 */
function hoursBetween(start, end) {
  const diff = new Date(end) - new Date(start);
  return Math.round((diff / 3600000) * 10) / 10;
}

/* ── String Helpers ───────────────────────────────────────── */

/**
 * Capitalise first letter of each word.
 * @param {string} str
 * @returns {string}
 */
function titleCase(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Truncate a string to a max length and append ellipsis.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max = 100) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/* ── Validation ───────────────────────────────────────────── */

/**
 * Check if a value is a valid MongoDB ObjectId string.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id));
}

/**
 * Validate an email address format.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

/**
 * Sanitise a string — strip HTML tags and trim whitespace.
 * @param {string} str
 * @returns {string}
 */
function sanitise(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

/* ── Pagination ───────────────────────────────────────────── */

/**
 * Parse pagination params from a request query.
 * @param {object} query  req.query
 * @param {number} defaultLimit
 * @returns {{ skip: number, limit: number, page: number }}
 */
function parsePagination(query, defaultLimit = 20) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(100, parseInt(query.limit) || defaultLimit);
  return { skip: (page - 1) * limit, limit, page };
}

/**
 * Build a pagination metadata object for API responses.
 * @param {number} total   total document count
 * @param {number} page
 * @param {number} limit
 * @returns {object}
 */
function paginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    pages:    Math.ceil(total / limit),
    hasNext:  page * limit < total,
    hasPrev:  page > 1,
  };
}

/* ── Response Helpers ─────────────────────────────────────── */

/**
 * Send a standardised success response.
 * @param {object} res    Express response object
 * @param {*}      data
 * @param {string} message
 * @param {number} status HTTP status code
 */
function sendSuccess(res, data, message = 'OK', status = 200) {
  res.status(status).json({ success: true, message, data });
}

/**
 * Send a standardised error response.
 * @param {object} res
 * @param {string} message
 * @param {number} status
 */
function sendError(res, message = 'An error occurred.', status = 400) {
  res.status(status).json({ success: false, message });
}

/* ── Exports ──────────────────────────────────────────────── */
module.exports = {
  formatDate,
  hoursBetween,
  titleCase,
  truncate,
  isValidObjectId,
  isValidEmail,
  sanitise,
  parsePagination,
  paginationMeta,
  sendSuccess,
  sendError,
};
