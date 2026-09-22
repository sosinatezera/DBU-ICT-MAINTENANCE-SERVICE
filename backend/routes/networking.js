/**
 * routes/networking.js
 * Networking/communication — direct user-to-user messages.
 * All routes require authentication. Sending is rate-limited per IP.
 */
const express = require('express');
const router  = express.Router();
const {
  getContacts,
  getConversations,
  startConversation,
  getMessages,
  sendMessage,
  markConversationRead,
  getUnreadCount,
} = require('../controllers/networkingController');
const { authenticate } = require('../middleware/auth');
const { rateLimit }    = require('../middleware/rateLimiter');

router.use(authenticate);

/* Read endpoints — cheap, no throttling. */
router.get('/unread-count',                       getUnreadCount);
router.get('/contacts',                           getContacts);
router.get('/conversations',                      getConversations);
router.get('/conversations/:id/messages',         getMessages);

/* Write endpoints — throttle message sends (30/15min default). */
router.post('/conversations',                     startConversation);
router.post('/conversations/:id/messages',        rateLimit(), sendMessage);
router.post('/conversations/:id/read',            markConversationRead);

module.exports = router;