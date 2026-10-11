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
  getDisabledSystemNotificationTypes,
  MANDATORY_NOTIFICATION_TYPES,
} = require("../utils/notificationPreferences");
const Settings = require("../models/Settings");

// GET /api/notifications
const getMyNotifications = async (req, res, next) => {
  try {
    const { type, unreadOnly, limit = 50, page = 1 } = req.query;
    const user = await User.findById(req.user.id)
      .select("role notificationPreferences")
      .lean();
    const preferences = user?.notificationPreferences || {};
    const settings = await Settings.getInstance();
    const disabledTypes = getDisabledSystemNotificationTypes(settings);
    const mandatoryTypes = Array.from(MANDATORY_NOTIFICATION_TYPES);
    const excludedTypes = [
      ...disabledTypes,
      ...(user?.role === "Technician" &&
      preferences.maintenanceAlerts === false
        ? Array.from(TECHNICIAN_MAINTENANCE_ALERT_TYPES)
        : []),
    ];
    const filter = { user: req.user.id };
    const unreadFilter = { user: req.user.id, is_read: false };
    if (preferences.inAppNotifications === false) {
      filter.notificationType = { $in: mandatoryTypes };
      unreadFilter.notificationType = { $in: mandatoryTypes };
    } else if (excludedTypes.length) {
      const notExcludedOrMandatory = {
        $or: [
          { notificationType: { $nin: excludedTypes } },
          { notificationType: { $in: mandatoryTypes } },
        ],
      };
      filter.$and = [notExcludedOrMandatory];
      unreadFilter.$and = [notExcludedOrMandatory];
    }

    if (type) {
      if (
        (preferences.inAppNotifications === false ||
          disabledTypes.includes(type) ||
          (user?.role === "Technician" &&
            preferences.maintenanceAlerts === false &&
            TECHNICIAN_MAINTENANCE_ALERT_TYPES.has(type))) &&
        !MANDATORY_NOTIFICATION_TYPES.has(type)
      ) {
        filter.notificationType = { $in: [] };
      } else {
        filter.notificationType = type;
      }
    }
    if (unreadOnly === "true") filter.is_read = false;

    const skip = (Number(page) - 1) * Number(limit);

    const [unread, notifications] = await Promise.all([
      Notification.countDocuments(unreadFilter),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate({
          path: "ticket",
          select: "ticketId requester equipmentType",
          populate: { path: "requester", select: "fullName" },
        })
        .populate("feedbackSubmission", "feedbackNumber")
        .lean(),
    ]);

    const data = notifications.map((n) => {
      const ticketId = displayTicketId(n.ticket?.ticketId);
      const isNewRequest = [
        "new_service_request",
        "high_priority_request",
        "critical_request",
      ].includes(n.notificationType);
      const message =
        isNewRequest && n.ticket?.requester?.fullName
          ? `Ticket "${ticketId}" submitted by ${n.ticket.requester.fullName}. Equipment: ${n.ticket.equipmentType || "Other"}.`
          : displayTicketText(n.message);
      return {
        id: n._id,
        ticket_id: n.ticket?._id || null,
        feedback_id: n.feedbackSubmission?._id || null,
        feedbackNumber: n.feedbackSubmission?.feedbackNumber || null,
        ticketId,
        requester_name: n.ticket?.requester?.fullName || null,
        title: displayTicketText(n.title),
        message: displayTicketText(message),
        type: n.type,
        notificationType: n.notificationType,
        is_read: n.is_read,
        created_at: n.createdAt,
      };
    });

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
    const settings = await Settings.getInstance();
    const filter = { user: req.user.id, is_read: false };
    const mandatoryTypes = Array.from(MANDATORY_NOTIFICATION_TYPES);
    if (preferences.inAppNotifications === false) {
      filter.notificationType = { $in: mandatoryTypes };
    }
    const disabledTypes = getDisabledSystemNotificationTypes(settings);
    const excludedTypes = [
      ...disabledTypes,
      ...(user?.role === "Technician" &&
      preferences.maintenanceAlerts === false
        ? Array.from(TECHNICIAN_MAINTENANCE_ALERT_TYPES)
        : []),
    ];
    if (excludedTypes.length && preferences.inAppNotifications !== false) {
      filter.$or = [
        { notificationType: { $nin: excludedTypes } },
        { notificationType: { $in: mandatoryTypes } },
      ];
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
