/**
 * middleware/audit.js
 * Security audit trail for mutating endpoints (POST/PUT/PATCH/DELETE).
 *
 * Wired centrally in server.js for management mounts, so individual route
 * handlers stay untouched. The entry is written when the response finishes,
 * which (a) lets req.user reflect the auth middleware that ran later in the
 * chain and (b) lets us record success=true/false from the final status code.
 * Writes are fire-and-forget and can never break the request flow.
 */
const AuditLog = require('../models/AuditLog');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function writeAuditLog(entry) {
  try {
    await AuditLog.create({
      user: entry.user || null,
      action: String(entry.action || '').slice(0, 120),
      entity: entry.entity ? String(entry.entity).slice(0, 60) : null,
      entityId: entry.entityId ? String(entry.entityId).slice(0, 60) : null,
      details: entry.details ? String(entry.details).slice(0, 2000) : '',
      ip: String(entry.ip || '').slice(0, 60),
      userAgent: String(entry.userAgent || '').slice(0, 300),
      success: entry.success !== false,
    });
  } catch (err) {
    console.error(
      `[Audit] Failed to write log | message=${String((err && err.message) || err).slice(0, 200)}`,
    );
  }
}

/* Middleware factory: mount on a path prefix (e.g. app.use('/api/users', ...))
   to audit every mutating request that reaches that prefix. */
function auditRouter({ entity = 'system' } = {}) {
  return (req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    if (!MUTATING_METHODS.has(method)) return next();
    const url = req.originalUrl || req.url;
    res.on('finish', () => {
      try {
        writeAuditLog({
          user: req.user?.id,
          action: `${method} ${url}`,
          entity,
          entityId:
            req.params?.id ||
            req.params?.ticketId ||
            req.body?.ticketId ||
            req.body?.assetTag ||
            null,
          ip: req.ip || req.socket?.remoteAddress || '',
          userAgent: req.headers?.['user-agent'] || '',
          success: res.statusCode < 400,
        });
      } catch (_) {
        /* never throw into the request lifecycle */
      }
    });
    next();
  };
}

module.exports = { auditRouter, writeAuditLog };