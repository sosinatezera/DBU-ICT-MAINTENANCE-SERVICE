/**
 * models/MaintenanceRecord.js
 * Technician activity log for a ticket — repair actions, parts used, notes
 */
const mongoose = require('mongoose');

const maintenanceRecordSchema = new mongoose.Schema(
  {
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: [true, 'Ticket reference is required.'],
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Technician',
      required: [true, 'Technician reference is required.'],
    },
    action_taken: {
      type: String,
      required: [true, 'Action taken is required.'],
    },
    parts_used: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['accepted', 'in_progress', 'resolved'],
      default: 'in_progress',
    },
  },
  { timestamps: true }
);

/* Frequently queried by request and by technician. */
maintenanceRecordSchema.index({ request: 1 });
maintenanceRecordSchema.index({ technician: 1, createdAt: -1 });

module.exports = mongoose.model('MaintenanceRecord', maintenanceRecordSchema);
