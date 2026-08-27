// validate.js — Simple request body validation (no external dependencies)

/**
 * validateRequired(fields)
 * Checks that required fields exist and are non-empty in req.body.
 * Usage: router.post('/', validateRequired(['name','email']), handler)
 */
const validateRequired = (...fields) => (req, res, next) => {
  const missing = fields.filter(f => !req.body[f] || String(req.body[f]).trim() === '');
  if (missing.length > 0) {
    return res.status(422).json({
      success: false,
      message: `Missing required fields: ${missing.join(', ')}`,
    });
  }
  next();
};

module.exports = { validateRequired };
