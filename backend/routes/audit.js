/**
 * routes/audit.js
 * GET /api/audit — read the audit trail (ICT Admin only, paginated).
 * A companion to middleware/audit.js which WRITES the trail.
 */
const express = require('express');
const AuditLog = require('../models/AuditLog');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');

const router = express.Router();

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get(
  '/',
  authenticate,
  authorize('ICT Admin'),
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit, 10) || 50),
      );
      const filter = {};
      if (req.query.entity) {
        filter.entity = String(req.query.entity).slice(0, 60);
      }
      if (req.query.action) {
        filter.action = new RegExp(escapeRegex(req.query.action), 'i');
      }
      if (req.query.success === 'true') filter.success = true;
      if (req.query.success === 'false') filter.success = false;

      const [total, logs] = await Promise.all([
        AuditLog.countDocuments(filter),
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('user', 'fullName email role')
          .lean(),
      ]);

      res.json({
        success: true,
        data: logs,
        meta: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;