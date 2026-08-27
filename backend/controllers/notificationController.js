/**
 * controllers/notificationController.js
 * User notifications — list, mark read, delete
 */
const Notification = require('../models/Notification');
const { validateObjectId } = require('../middleware/validation');

// GET /api/notifications
const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('ticket', 'ticketId');
    const unread = notifications.filter(n => !n.is_read).length;
    const data   = notifications.map(n => ({
      id:         n._id,
      ticket_id:  n.ticket?._id || null,
      ticketId:   n.ticket?.ticketId || null,
      title:      n.title,
      message:    n.message,
      type:       n.type,
      is_read:    n.is_read,
      created_at: n.createdAt,
    }));
    res.json({ success: true, data, unread });
  } catch (err) { next(err); }
};

// PATCH /api/notifications/:id/read
const markAsRead = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Notification');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { is_read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found.' });

    res.json({ success: true, message: 'Notification marked as read.' });
  } catch (err) { next(err); }
};

// PATCH /api/notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user.id, is_read: false }, { is_read: true });
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) { next(err); }
};

// DELETE /api/notifications/:id
const deleteNotification = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Notification');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const notif = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found.' });

    res.json({ success: true, message: 'Notification deleted.' });
  } catch (err) { next(err); }
};

module.exports = { getMyNotifications, markAsRead, markAllRead, deleteNotification };
