/**
 * middleware/errorHandler.js
 * Global error handling — converts Mongoose/validation errors into
 * consistent, user-friendly JSON responses.
 */

const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${err.name}: ${err.message}`);

  /* ── Mongoose CastError (invalid ObjectId, bad type) ──── */
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path || 'value'} format.`,
    });
  }

  /* ── Mongoose ValidationError (schema validation) ─────── */
  if (err.name === 'ValidationError') {
    const errors = {};
    Object.keys(err.errors).forEach(key => {
      errors[key] = err.errors[key].message;
    });
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  /* ── Mongoose Duplicate Key (E11000) ──────────────────── */
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `A record with that ${field} already exists.`,
    });
  }

  /* ── Multer upload errors (too large / disallowed type) ── */
  if (err.name === 'MulterError') {
    const code = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded file exceeds the 5 MB limit.'
      : err.message || 'File upload failed.';
    return res.status(400).json({ success: false, message: code });
  }

  /* ── Custom application errors ────────────────────────── */
  const statusCode = err.statusCode || 500;
  const message    = err.message    || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
