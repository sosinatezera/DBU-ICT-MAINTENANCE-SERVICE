const express = require('express');
const router  = express.Router();
const { getMyNotifications, markAsRead, markAllRead, deleteNotification } = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.get('/',              authenticate, getMyNotifications);
// read-all MUST come before /:id/read to avoid "read-all" being treated as an id
router.patch('/read-all',    authenticate, markAllRead);
router.patch('/:id/read',    authenticate, markAsRead);
router.delete('/:id',        authenticate, deleteNotification);

module.exports = router;
