/**
 * routes/public.js
 * Public endpoints — no authentication required
 */
const express    = require('express');
const router     = express.Router();
const User       = require('../models/User');
const ICTAsset   = require('../models/ICTAsset');
const Technician = require('../models/Technician');
const Ticket     = require('../models/Ticket');

/* GET /api/public/stats — aggregate counts only (no PII) */
router.get('/stats', async (req, res, next) => {
  try {
    const [total_users, total_assets, total_technicians, total_tickets, resolved, pending] = await Promise.all([
      User.countDocuments({ status: 'active' }),
      ICTAsset.countDocuments(),
      Technician.countDocuments(),
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: { $in: ['resolved', 'closed'] } }),
      Ticket.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
    ]);
    res.json({ success: true, data: { total_users, total_assets, total_technicians, total_tickets, resolved, pending } });
  } catch (err) { next(err); }
});

module.exports = router;
