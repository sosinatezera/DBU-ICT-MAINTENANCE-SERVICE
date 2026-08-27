const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const { getVapidPublicKey, subscribe, unsubscribe } = require('../controllers/pushController');

/* VAPID public key is public (it is only the public half of the key pair) */
router.get('/vapid-public-key', getVapidPublicKey);

/* Subscription endpoints are per-user (Requester) */
router.post('/subscribe',   authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);

module.exports = router;