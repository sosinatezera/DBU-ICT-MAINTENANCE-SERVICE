/**
 * controllers/pushController.js
 * Web Push subscriptions + one-off send helper.
 *
 * Endpoints:
 *   GET  /api/push/vapid-public-key — VAPID public key for the browser
 *   POST /api/push/subscribe        — save/replace a browser subscription (auth)
 *   POST /api/push/unsubscribe      — remove a browser subscription (auth)
 */

const PushSubscription = require('../models/PushSubscription');
const { PUBLIC_KEY, configured, sendPush } = require('../config/push');

/* ── GET /api/push/vapid-public-key ─────────────────────── */
const getVapidPublicKey = (_req, res) => {
  if (!configured || !PUBLIC_KEY) {
    return res.status(503).json({
      success: false,
      message: 'Web Push is not configured. Generate VAPID keys and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env',
    });
  }
  res.json({ success: true, data: { publicKey: PUBLIC_KEY } });
};

/* ── POST /api/push/subscribe ───────────────────────────── */
const subscribe = async (req, res, next) => {
  try {
    const { endpoint, keys = {}, userAgent } = req.body;

    if (!endpoint || !keys.p256dh || !keys.auth) {
      return res.status(422).json({
        success: false,
        message: 'endpoint, keys.p256dh and keys.auth are required.',
      });
    }

    /* Upsert per user+endpoint so re-login / re-subscription never creates
       duplicates and login/logout does not lose the subscription. */
    await PushSubscription.updateOne(
      { user: req.user.id, endpoint },
      {
        $set: {
          user:       req.user.id,
          endpoint,
          'keys.p256dh': keys.p256dh,
          'keys.auth':   keys.auth,
          userAgent:     userAgent || '',
        },
      },
      { upsert: true }
    );

    res.json({ success: true, message: 'Push subscription saved.' });
  } catch (err) { next(err); }
};

/* ── POST /api/push/unsubscribe ─────────────────────────── */
const unsubscribe = async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(422).json({ success: false, message: 'endpoint is required.' });
    }
    await PushSubscription.deleteOne({ user: req.user.id, endpoint });
    res.json({ success: true, message: 'Push subscription removed.' });
  } catch (err) { next(err); }
};

/* ── Send a push to every subscription of a user ────────── */
const sendPushToUser = async (userId, payload) => {
  if (!configured) return { sent: 0, removed: 0 };

  const subscriptions = await PushSubscription.find({ user: userId });
  let sent = 0, removed = 0;

  for (const sub of subscriptions) {
    try {
      await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        payload
      );
      sent += 1;
    } catch (err) {
      /* Invalid / expired / no-longer-registered subscriptions must be removed
         so they are not retried forever. */
      const gone = [400, 404, 410].includes(err?.statusCode);
      if (gone || /Gone|Expired|register/i.test(err?.body || '')) {
        try { await PushSubscription.deleteOne({ _id: sub._id }); removed += 1; }
        catch (_) { /* ignore cleanup errors */ }
      } else {
        console.warn('[push] send failed:', err.statusCode || '', err.message || err.body || '');
      }
    }
  }

  return { sent, removed };
};

module.exports = { getVapidPublicKey, subscribe, unsubscribe, sendPushToUser };