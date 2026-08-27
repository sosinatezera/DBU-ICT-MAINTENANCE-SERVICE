// rateLimiter.js — Simple in-memory rate limiter (no external dependencies)

const store = new Map();

/**
 * rateLimit({ windowMs, max })
 * Returns Express middleware that limits requests per IP.
 * @param {number} windowMs — time window in milliseconds (default: 15 min)
 * @param {number} max — max requests per window (default: 30)
 */
const rateLimit = ({ windowMs = 15 * 60 * 1000, max = 30 } = {}) => {
  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.start > windowMs) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now - entry.start > windowMs) {
      store.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
      });
    }

    next();
  };
};

module.exports = { rateLimit };
