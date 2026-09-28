/**
 * models/AuditLog.js
 * Immutable trail of sensitive/mutating actions (create, update, delete) for
 * ICT Admins. Writes are fire-and-forget and must never break the request
 * that triggered them.
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    entity: {
      type: String,
      index: true,
    },
    entityId: {
      type: String,
      default: null,
    },
    details: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    ip: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
      maxlength: 300,
    },
    success: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);