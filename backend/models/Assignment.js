/**
 * models/Assignment.js
 * Links a Ticket to an assigned Technician
 */
const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: [true, 'Ticket reference is required.'],
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Technician',
      required: [true, 'Technician reference is required.'],
    },
    assigned_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'in_progress', 'completed', 'reassigned'],
      default: 'assigned',
    },
  },
  { timestamps: true }
);

/* Busiest join-table in the system — assignment existence + technician listing
   queries filter on ticket/technician/status combinations. */
assignmentSchema.index({ ticket: 1, technician: 1, status: 1 });
assignmentSchema.index({ technician: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
