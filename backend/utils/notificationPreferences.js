const TECHNICIAN_MAINTENANCE_ALERT_TYPES = new Set([
  "new_request_assigned",
  "request_reassigned",
  "request_reopened",
]);

function shouldDeliverInAppNotification(preferences, role, notificationType) {
  if (preferences?.inAppNotifications === false) return false;
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
  shouldDeliverInAppNotification,
};
