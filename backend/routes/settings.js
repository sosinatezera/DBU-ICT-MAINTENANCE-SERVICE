/**
 * routes/settings.js
 * System-wide settings — admin only
 * Smart Computer Maintenance Service Request and Tracking System
 */

const express = require('express');
const router  = express.Router();
const { getSettings, updateGeneral, updateNotifications } = require('../controllers/settingsController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',             authenticate, authorize('ICT Admin'), getSettings);
router.put('/general',      authenticate, authorize('ICT Admin'), updateGeneral);
router.put('/notifications', authenticate, authorize('ICT Admin'), updateNotifications);

module.exports = router;
