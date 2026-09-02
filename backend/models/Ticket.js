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
    /* ── Requester Feedback (service experience survey) ─────────
       Completed by the requester once the ticket is resolved/closed.
       Purpose: evaluate the ICT SERVICE the requester received.
       This is kept as a subdocument so the full ticket carries it. */
    requesterFeedback: {
      requesterId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requesterName: { type: String, trim: true, default: null },
      overallRating:      { type: Number, min: 1, max: 5, default: null },
      serviceQuality:      { type: String, trim: true, default: null }, // Excellent/Very Good/Good/Fair/Poor
      technicianProfessionalism: { type: String, trim: true, default: null },
      responseTime:        { type: String, trim: true, default: null }, // Fast/Normal/Slow
      communication:       { type: String, trim: true, default: null },
      problemResolution:   { type: String, trim: true, default: null }, // Completely Resolved/Partially Resolved/Not Resolved
      satisfactionLevel:   { type: String, trim: true, default: null }, // Very Satisfied .. Very Dissatisfied
      wouldRecommend:      { type: String, enum: ['Yes', 'No', null], default: null },
      comment:             { type: String, trim: true, default: null },
      suggestions:         { type: String, trim: true, default: null },
      submittedAt:         { type: Date, default: null },
    },
    attachment: {
      type: String,
      default: null,
    },
    /* ── Technician Maintenance Report (one per ticket) ──────
       Single report submitted by the assigned technician once the
       work is done. Kept as a subdocument so the full ticket detail
       carries the report along with it. Internal notes stay private
       to technicians and ICT Admins (never exposed to requesters). */
    technicianFeedback: {
      diagnosis:          { type: String, trim: true, default: null }, // identified problem
      workPerformed:      { type: String, trim: true, default: null }, // action taken
      partsUsed:          { type: String, trim: true, default: null },
      resolution:         { type: String, trim: true, default: null }, // resolution summary (public)
      status: {
        type: String,
        enum: ['Fixed', 'In Progress', 'Not Fixed'],
        default: null,
      },
      reasonNotFixed:     { type: String, trim: true, default: null }, // required when status = 'Not Fixed'
      recommendation:     { type: String, trim: true, default: null },
      technicianNotes:    { type: String, trim: true, default: null }, // internal notes (private)
      technicianConfirmed:{ type: Boolean, default: false },
      technician: {
        technicianId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        technicianName: { type: String, trim: true, default: null },
      },
      submittedAt:        { type: Date, default: null },
      completionDate:     { type: Date, default: null }, // resolved date (public)
    },
    /* ── Admin Service Feedback (management/quality evaluation) ──
       Management/service-level evaluation submitted by an ICT Admin.
       Evaluates how the request was handled and service quality — it does
       NOT re-record the technical repair and must NOT overwrite the
       requester's original feedback or the technician's original report. */
    adminFeedback: {
      serviceHandlingQuality:  { type: String, trim: true, default: null }, // Excellent/Good/Satisfactory/Needs Improvement/Poor
      technicianPerformance:   { type: String, trim: true, default: null }, // Excellent/Good/Satisfactory/Needs Improvement
      responseTime:            { type: String, trim: true, default: null }, // Excellent/Good/Slow
      resolutionQuality:       { type: String, trim: true, default: null },
      documentationQuality:    { type: String, trim: true, default: null },
      policyCompliance:        { type: String, trim: true, default: null }, // Compliant/Non-Compliant/Partial
      overallServiceQuality:   { type: String, trim: true, default: null },
      followUpRequired:        { type: Boolean, default: false },
      followUpNotes:           { type: String, trim: true, default: null },
      adminComment:            { type: String, trim: true, default: null }, // required
      administrativeRecommendation: { type: String, trim: true, default: null },
      adminConfirmed:          { type: Boolean, default: false },
      admin: {
        adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        adminName: { type: String, trim: true, default: null },
      },
      submittedAt:             { type: Date, default: null },
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
