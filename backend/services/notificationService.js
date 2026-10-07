/**
 * services/notificationService.js
 * Real-time notification service using Socket.IO
 * Smart ICT Maintenance Management System
 */

const User = require("../models/User");
const Notification = require("../models/Notification");
const {
  shouldDeliverInAppNotification,
} = require("../utils/notificationPreferences");

let io = null;
const userSockets = new Map(); // userId -> Set of socket IDs

function initSocketIO(httpServer, sessionMiddleware) {
  const { Server } = require("socket.io");
  io = new Server(httpServer, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://simms-mau.netlify.app",
      ],
      credentials: true,
    },
  });

  io.engine.use(sessionMiddleware);
  io.use(async (socket, next) => {
    try {
      const userId = socket.request.session?.userId;
      if (!userId) return next(new Error("Authentication required"));
      const user = await User.findById(userId).select("role status");
      if (!user || user.status !== "active")
        return next(new Error("Authentication required"));
      socket.userId = String(user._id);
      socket.userRole = user.role;
      next();
    } catch (_) {
      next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    socket.on("disconnect", () => {
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, data) {
  if (!io) return;
  const sockets = userSockets.get(String(userId));
  if (sockets && sockets.size > 0) {
    sockets.forEach((socketId) => {
      io.to(socketId).emit(event, data);
    });
  }
}

function emitToRole(role, event, data) {
  if (!io) return;
  io.sockets.sockets.forEach((socket) => {
    if (socket.userRole === role) {
      socket.emit(event, data);
    }
  });
}

function emitToAdmins(event, data) {
  emitToRole("ICT Admin", event, data);
}

function emitToTechnicians(event, data) {
  emitToRole("Technician", event, data);
}

/* Deliberately fire-and-forget: every caller invokes this without `await` so
   that real-time delivery never sits on the latency path of the request that
   produced it. That contract only holds if this function can never reject —
   all 21 call sites drop the returned promise on the floor, so an escaping
   rejection would become an unhandledRejection. */
async function broadcastNotification(notification) {
  try {
    if (!io) return;
    const user = await User.findById(notification.user)
      .select("role notificationPreferences")
      .lean();
    if (
      !user ||
      !shouldDeliverInAppNotification(
        user.notificationPreferences,
        user.role,
        notification.notificationType,
      )
    )
      return;
    emitToUser(notification.user, "notification:new", notification);
    const unread = await getUnreadCount(notification.user, user);
    if (unread !== undefined) {
      emitToUser(notification.user, "notification:unread-count", { unread });
    }
  } catch (err) {
    /* The notification is already persisted in the database at every call
       site, so a delivery failure is a degraded UI, never lost data. */
    console.error("Notification broadcast failed:", err);
  }
}

async function getUnreadCount(userId, user) {
  try {
    const preferences = user.notificationPreferences || {};
    if (preferences.inAppNotifications === false) return 0;
    const filter = { user: userId, is_read: false };
    if (user.role === "Technician" && preferences.maintenanceAlerts === false) {
      filter.notificationType = {
        $nin: [
          "new_request_assigned",
          "request_reassigned",
          "request_reopened",
        ],
      };
    }
    return await Notification.countDocuments(filter);
  } catch (_) {
    return undefined;
  }
}

/**
 * Create and broadcast a notification to a specific user
 * @param {Object} params - Notification parameters
 * @param {string} params.userId - Target user ID
 * @param {string} params.ticketId - Related ticket ID (optional)
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message
 * @param {string} params.type - Notification type: 'info', 'success', 'warning', 'danger'
 * @param {string} params.notificationType - Specific notification type for role-based filtering
 */
async function createAndBroadcastNotification(params) {
  const notification = await Notification.create({
    user: params.userId,
    ticket: params.ticketId || null,
    title: params.title,
    message: params.message,
    type: params.type || "info",
    notificationType: params.notificationType || "info",
  });
  await broadcastNotification(notification);
  return notification;
}

/**
 * Create and broadcast notification to all users with a specific role
 * @param {string} role - Target role: 'Requester', 'Technician', 'ICT Admin'
 * @param {Object} params - Notification parameters (same as createAndBroadcastNotification but without userId)
 */
async function broadcastToRole(role, params) {
  if (!io) return;
  const User = require("../models/User");
  const users = await User.find({ role, status: "active" }).select("_id");
  await Promise.all(
    users.map((user) =>
      createAndBroadcastNotification({
        ...params,
        userId: user._id,
      }),
    ),
  );
}

module.exports = {
  initSocketIO,
  getIO,
  emitToUser,
  emitToRole,
  emitToAdmins,
  emitToTechnicians,
  broadcastNotification,
  createAndBroadcastNotification,
  broadcastToRole,
};
