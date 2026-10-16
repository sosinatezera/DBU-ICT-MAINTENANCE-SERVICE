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
const Settings   = require('../models/Settings');

router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await Settings.getInstance();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      success: true,
      data: {
        systemName: settings.systemName,
        organizationName: settings.organizationName,
        defaultLanguage: settings.defaultLanguage,
        defaultTheme: settings.defaultTheme,
        timezone: settings.timezone,
        dateFormat: settings.dateFormat,
        timeFormat: settings.timeFormat,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/maintenance-mode', async (_req, res, next) => {
  try {
    const settings = await Settings.findOne()
      .select('maintenanceMode maintenanceNotice')
      .lean();
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        enabled: settings?.maintenanceMode === true,
        notice:
          settings?.maintenanceNotice ||
          'The system is temporarily unavailable while maintenance is in progress.',
      },
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/public/stats — aggregate counts only (no PII) */

/* This is the landing page's first paint and is served to anonymous visitors
   with no rate limit, so it was 6 countDocuments round-trips on every hit —
   three of them against the same Ticket collection. Two changes:
     1. One $group by status replaces the three Ticket counts, so the whole
        endpoint is 4 round-trips and the ticket numbers stay mutually
        consistent (they are now a single snapshot).
     2. A short TTL cache. These are marketing counters on a public page; a
        value that is up to 30s stale is indistinguishable to a visitor, and
        the endpoint stays exactly as cheap as a memory read for repeat hits. */
const STATS_CACHE_TTL_MS = 30000;
let _statsCache = { at: 0, data: null };
let _statsInFlight = null;

async function computePublicStats() {
  const [total_users, total_assets, total_technicians, ticketCounts] =
    await Promise.all([
      User.countDocuments({ status: 'active' }),
      ICTAsset.countDocuments(),
      Technician.countDocuments(),
      Ticket.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

  const byStatus = {};
  ticketCounts.forEach((row) => {
    byStatus[row._id] = row.count;
  });

  const resolved =
    (byStatus.resolved || 0) +
    (byStatus.closed || 0);
  const pending =
    (byStatus.submitted || 0) +
    (byStatus.under_review || 0);
  const total_tickets = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return {
    total_users,
    total_assets,
    total_technicians,
    total_tickets,
    resolved,
    pending,
  };
}

router.get('/stats', async (req, res, next) => {
  try {
    const now = Date.now();
    if (_statsCache.data && now - _statsCache.at < STATS_CACHE_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=30');
      return res.json({ success: true, data: _statsCache.data });
    }

    if (!_statsInFlight) {
      _statsInFlight = computePublicStats()
        .then((data) => {
          _statsCache = { at: Date.now(), data };
          return data;
        })
        .finally(() => {
          _statsInFlight = null;
        });
    }

    const data = await _statsInFlight;
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
