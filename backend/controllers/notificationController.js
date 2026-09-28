/**
 * controllers/notificationController.js
 * User notifications — list, mark read, delete
 */
const Notification = require("../models/Notification");
const User = require("../models/User");
const { validateObjectId } = require("../middleware/validation");
const { displayTicketId, displayTicketText } = require("../utils/ticketId");
const {
  TECHNICIAN_MAINTENANCE_ALERT_TYPES,
} = require("../utils/notificationPreferences");

// GET /api/notifications
const getMyNotifications = async (req, res, next) => {
  try {
    const { type, unreadOnly, limit = 50, page = 1 } = req.query;
    const user = await User.findById(req.user.id)
      .select("role notificationPreferences")
      .lean();
    const preferences = user?.notificationPreferences || {};
    if (preferences.inAppNotifications === false) {
      return res.json({ success: true, data: [], unread: 0, total: 0 });
    }
    const filter = { user: req.user.id };
    const unreadFilter = { user: req.user.id, is_read: false };

    if (
      user?.role === "Technician" &&
      preferences.maintenanceAlerts === false
    ) {
      filter.notificationType = {
        $nin: Array.from(TECHNICIAN_MAINTENANCE_ALERT_TYPES),
      };
      unreadFilter.notificationType = {
        $nin: Array.from(TECHNICIAN_MAINTENANCE_ALERT_TYPES),
      };
    }

    if (type) {
      if (
        user?.role === "Technician" &&
        preferences.maintenanceAlerts === false &&
        TECHNICIAN_MAINTENANCE_ALERT_TYPES.has(type)
      ) {
        return res.json({ success: true, data: [], unread: 0, total: 0 });
      }
      filter.notificationType = type;
    }
    if (unreadOnly === "true") filter.is_read = false;

    const skip = (Number(page) - 1) * Number(limit);

    const [unread, notifications] = await Promise.all([
      Notification.countDocuments(unreadFilter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("ticket", "ticketId")
        .lean(),
    ]);

    const data = notifications.map((n) => ({
      id: n._id,
      ticket_id: n.ticket?._id || null,
      ticketId: displayTicketId(n.ticket?.ticketId),
      title: displayTicketText(n.title),
      message: displayTicketText(n.message),
      type: n.type,
      notificationType: n.notificationType,
      is_read: n.is_read,
      created_at: n.createdAt,
    }));

    res.json({ success: true, data, unread, total: notifications.length });
  } catch (err) {
    next(err);
  }
};

// GET /api/notifications/unread-count
const getUnreadCount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id)
      .select("role notificationPreferences")
      .lean();
    const preferences = user?.notificationPreferences || {};
    if (preferences.inAppNotifications === false)
      return res.json({ success: true, unread: 0 });
    const filter = { user: req.user.id, is_read: false };
    if (
      user?.role === "Technician" &&
      preferences.maintenanceAlerts === false
    ) {
      filter.notificationType = {
        $nin: Array.from(TECHNICIAN_MAINTENANCE_ALERT_TYPES),
      };
    }
    const unread = await Notification.countDocuments(filter);
    res.json({ success: true, unread });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/:id/read
const markAsRead = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Notification");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { is_read: true },
      { new: true },
    );
    if (!notif)
      return res
        .status(404)
        .json({ success: false, message: "Notification not found." });

    res.json({ success: true, message: "Notification marked as read." });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, is_read: false },
      { is_read: true },
    );
    res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/:id
const deleteNotification = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Notification");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const notif = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!notif)
      return res
        .status(404)
        .json({ success: false, message: "Notification not found." });

    res.json({ success: true, message: "Notification deleted." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllRead,
  deleteNotification,
};
