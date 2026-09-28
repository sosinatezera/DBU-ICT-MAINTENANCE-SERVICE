const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticket:   { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  type:     { type: String, enum: ['info','success','warning','danger'], default: 'info' },
  notificationType: {
    type: String,
    enum: [
      // Requester notifications
      'request_submitted',
      'request_received',
      'technician_assigned',
      'request_accepted',
      'request_in_progress',
      'request_updated',
      'request_status_changed',
      'request_completed',
      'request_resolved',
      'request_reopened',
      'new_comment',
      'feedback_available',
      // Technician notifications
      'new_request_assigned',
      'request_reassigned',
      'new_service_request',
      'priority_changed',
      'request_reopened',
      'request_escalated',
      'request_cancelled',
      // ICT Admin notifications
      'new_service_request',
      'high_priority_request',
      'critical_request',
      'request_assigned',
      'request_reassigned_admin',
      'request_escalated_admin',
      'request_completed_admin',
      'technician_activity',
      'system_notification',
    ],
    default: 'info',
  },
  is_read:  { type: Boolean, default: false },
}, { timestamps: true });

/* Hot path: "my notifications" sorted newest-first — index user + createdAt. */
notificationSchema.index({ user: 1, createdAt: -1 });
/* Hot path: unread-count + mark-all-read for a single user. */
notificationSchema.index({ user: 1, is_read: 1, createdAt: -1 });
/* Hot path: filter by notificationType for role-based views */
notificationSchema.index({ user: 1, notificationType: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);