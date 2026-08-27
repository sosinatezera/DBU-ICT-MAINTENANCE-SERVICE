/**
 * routes/feedback.js
 * Feedback — requesters rate resolved tickets
 */
const express = require('express');
const router  = express.Router();
const { getAllFeedback, submitFeedback } = require('../controllers/feedbackController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',  authenticate, authorize('ICT Admin'), getAllFeedback);
router.post('/', authenticate, submitFeedback);

module.exports = router;
