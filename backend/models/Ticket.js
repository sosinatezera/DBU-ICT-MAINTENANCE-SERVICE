/**
 * models/Ticket.js
 * Maintenance ticket schema for Smart Computer Maintenance Service Request and Tracking System
 *
 * ticketId: Auto-generated unique tracking code (e.g., TK-1001, TK-1002)
 * status lifecycle: submitted -> under_review -> assigned -> accepted -> in_progress -> resolved -> closed
 */

const mongoose = require('mongoose');

/* ── Auto-increment counter for ticketId ───────────────────── */
const CounterSchema = new mongoose.Schema({
  _id:        { type: String, required: true },
  seq:        { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', CounterSchema);

/* ── Ticket Schema ─────────────────────────────────────────── */
const ticketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      unique: true,
      index: true,
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Requester is required.'],
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    title: {
      type: String,
      trim: true,
      default: null,
    },
    equipmentType: {
      type: String,
      enum: [
        'Desktop Computer',
        'Laptop',
        'Printer',
        'Scanner',
        'Monitor',
        'Projector',
        'UPS / Power Supply',
        'Keyboard / Mouse',
        'Other',
      ],
      default: 'Other',
    },
    category: {
      type: String,
      trim: true,
      default: null,
    },
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ICTAsset',
      default: null,
    },
    serialNumber: {
      type: String,
      trim: true,
      default: null,
    },
    officeBlock: {
      type: String,
      trim: true,
      default: null,
    },
    problemDescription: {
      type: String,
      required: [true, 'Problem description is required.'],
      trim: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed'],
      default: 'submitted',
    },
    assignedTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    identifiedProblem: {
      type: String,
      trim: true,
      default: null,
    },
    resolutionResponse: {
      type: String,
      trim: true,
      default: null,
    },
    isFixed: {
      type: Boolean,
      default: false,
    },
    reasonIfNotFixed: {
      type: String,
      trim: true,
      default: null,
    },
    feedbackRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    feedbackComments: {
      type: String,
      trim: true,
      default: null,
    },
    attachment: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

/* ── Auto-generate ticketId before saving ──────────────────── */
ticketSchema.pre('save', async function (next) {
  if (this.ticketId) return next();

  try {
    const counter = await Counter.findByIdAndUpdate(
      { _id: 'ticketId' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.ticketId = `TK-${String(counter.seq).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Ticket', ticketSchema);
