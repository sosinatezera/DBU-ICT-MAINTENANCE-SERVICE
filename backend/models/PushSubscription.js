/**
 * models/PushSubscription.js
 * Browser Web-Push subscription, linked to the owning user (Requester).
 * One user may register multiple browsers/devices (one document per user+endpoint).
 */

const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required.'],
      index: true,
    },
    endpoint: {
      type: String,
      required: [true, 'Push endpoint is required.'],
    },
    keys: {
      p256dh: { type: String, required: [true, 'p256dh key is required.'] },
      auth:   { type: String, required: [true, 'auth key is required.'] },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

// One subscription per user + endpoint (upserts cleanly on re-login).
pushSubscriptionSchema.index({ user: 1, endpoint: 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);