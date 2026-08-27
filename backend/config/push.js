/**
 * config/push.js — Web Push / VAPID configuration
 *
 * Requires the `web-push` package and VAPID keys in .env:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
 *
 * Install & generate keys once (run from backend/):
 *   npm install
 *   node scripts/generate-vapid.js
 *
 * This module is safe to load even when `web-push` is not installed yet or
 * VAPID keys are missing: pushes are simply skipped and the rest of the
 * system (in-app notifications, status updates, etc.) keeps working.
 */

let webPush = null;
try {
  webPush = require('web-push');
} catch (_) {
  console.warn('[push] "web-push" package is not installed. Run `npm install` in backend/. Web Push is disabled until then.');
}

const PUBLIC_KEY    = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE_KEY   = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:ict-support@example.com';

const configured = Boolean(webPush && PUBLIC_KEY && PRIVATE_KEY);

if (configured) {
  webPush.setVapidDetails(VAPID_SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else if (!webPush) {
  console.warn('[push] Cannot enable Web Push: web-push package missing.');
} else {
  console.warn('[push] VAPID keys are not configured. Web Push is disabled (in-app notifications still work).');
  console.warn('[push] Run `node scripts/generate-vapid.js` and add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env.');
}

/**
 * Send a push notification to one subscription.
 * Promise rejection must be handled by the caller (never break status updates).
 */
function sendPush(subscription, payload) {
  if (!configured) {
    return Promise.resolve({ skipped: true });
  }
  return webPush.sendNotification(
    subscription,
    JSON.stringify(payload),
    { TTL: 86400, urgency: 'high' }
  );
}

module.exports = { webPush, configured, PUBLIC_KEY, sendPush };