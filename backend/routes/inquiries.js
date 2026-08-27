/**
 * routes/inquiries.js
 * Public contact/support inquiry — submit + admin list
 */
const express = require('express');
const router  = express.Router();
const { submitInquiry, getAllInquiries } = require('../controllers/inquiryController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const { rateLimit }    = require('../middleware/rateLimiter');

const inquiryRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/',    inquiryRateLimit, submitInquiry);
router.get('/',     authenticate, authorize('ICT Admin'), getAllInquiries);

module.exports = router;
