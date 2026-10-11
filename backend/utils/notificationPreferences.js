const TECHNICIAN_MAINTENANCE_ALERT_TYPES = new Set([
  "new_request_assigned",
  "request_reassigned",
  "request_reopened",
]);

const SYSTEM_NOTIFICATION_TYPES = {
  notifNewRequest: ["new_service_request"],
  notifAssignment: [
    "new_request_assigned",
    "technician_assigned",
    "request_reassigned",
  ],
  notifStatusChange: ["request_updated", "priority_changed"],
  notifCompletion: ["request_completed_admin"],
  notifSystemSecurity: ["system_notification"],
  notifUserFeedback: ["feedback_submission_user"],
  notifTechnicianFeedback: ["feedback_submission_technician"],
  notifFeedbackReplies: ["feedback_reply"],
};
const MANDATORY_NOTIFICATION_TYPES = new Set(["critical_request"]);

function getDisabledSystemNotificationTypes(settings = {}) {
  return Object.entries(SYSTEM_NOTIFICATION_TYPES)
    .filter(([key]) => settings[key] === false)
    .flatMap(([, types]) => types);
}

function shouldDeliverInAppNotification(
  preferences,
  role,
  notificationType,
  settings = {},
) {
  if (MANDATORY_NOTIFICATION_TYPES.has(notificationType)) return true;
  if (preferences?.inAppNotifications === false) return false;
  if (getDisabledSystemNotificationTypes(settings).includes(notificationType)) {
    return false;
  }
  if (
    role === "Technician" &&
    preferences?.maintenanceAlerts === false &&
    TECHNICIAN_MAINTENANCE_ALERT_TYPES.has(notificationType)
  ) {
    return false;
  }
  return true;
}

module.exports = {
  TECHNICIAN_MAINTENANCE_ALERT_TYPES,
  SYSTEM_NOTIFICATION_TYPES,
  MANDATORY_NOTIFICATION_TYPES,
  getDisabledSystemNotificationTypes,
  shouldDeliverInAppNotification,
};
