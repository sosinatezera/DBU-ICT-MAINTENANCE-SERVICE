// rateLimiter.js — Simple in-memory rate limiter (no external dependencies)
//
// Design notes
// -------------
// * Each rateLimit() instance owns an isolated bucket, so unrelated endpoints
//   never consume each other's quota.
// * A bucket can be keyed by ANY dimension, not only the client IP. Password
//   recovery is therefore throttled twice: once per client IP (volumetric
//   abuse) and once per target account (OTP spam / enumeration of one specific
//   address). A shared campus NAT can no longer exhaust a single user's
//   allowance, and one attacker can no longer lock a victim's account out.
// * Always answers 429 with Retry-After (seconds) plus X-RateLimit-* headers, and
//   accepts a caller-supplied message so the UI shows a specific, actionable
//   error instead of a generic "Too many requests".

/** Default bucket identity: the connecting client address. */
function defaultKeyGenerator(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

/**
 * rateLimit({ windowMs, max, keyGenerator, message, scope })
 * Returns Express middleware that limits requests per bucket key.
 * @param {number} windowMs — time window in milliseconds (default: 15 min)
 * @param {number} max — max requests per window (default: 30)
 * @param {Function} [keyGenerator] — (req) => string bucket key (default: client IP)
 * @param {string} [message] — user-facing 429 message
 * @param {string} [scope] — label used in server-side logs only
 */
const rateLimit = ({
  windowMs = 15 * 60 * 1000,
  max = 30,
  keyGenerator = defaultKeyGenerator,
  message = "Too many requests. Please try again later.",
  scope = "requests",
} = {}) => {
  const store = new Map();

  // Cleanup expired entries every 5 minutes
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.start > windowMs) store.delete(key);
    }
  }, 5 * 60 * 1000);
  cleanup.unref();

  return (req, res, next) => {
    let key;
    try {
      key = String(keyGenerator(req));
    } catch (_err) {
      /* A broken key function must never take the request down. */
      key = "unknown";
    }

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now - entry.start > windowMs) {
      store.set(key, { start: now, count: 1 });
      res.set("X-RateLimit-Limit", String(max));
      res.set("X-RateLimit-Remaining", String(Math.max(0, max - 1)));
      return next();
    }

    entry.count += 1;
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((entry.start + windowMs - now) / 1000),
      );
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Reset", String(Math.ceil((entry.start + windowMs) / 1000)));
      console.warn(
        `[rate-limit] ${scope} blocked a request from bucket "${key}" ` +
          `(${entry.count}/${max} per ${Math.round(windowMs / 1000)}s). ` +
          `Retry-After: ${retryAfter}s`,
      );
      /* retryAfter is duplicated in the body because Retry-After is NOT a
         CORS-safelisted response header — without the body copy a cross-origin
         frontend could never read the cooldown. */
      return res
        .status(429)
        .json({ success: false, message, retryAfter: retryAfter });
    }

    next();
  };
};

module.exports = { rateLimit };
