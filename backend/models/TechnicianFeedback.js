const mongoose = require("mongoose");
const {
  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS,
  TECHNICIAN_FEEDBACK_CATEGORY_LABELS,
  TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES,
  TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES,
} = require("../utils/technicianFeedbackCategories");

const CATEGORY_GROUPS = TECHNICIAN_FEEDBACK_CATEGORY_GROUPS.map(
  ({ group }) => group,
);
const LEGACY_FEEDBACK_CATEGORIES = ["Workflow"];
const LEGACY_FEEDBACK_STATUSES = ["Pending", "Reviewed"];

const technicianFeedbackSchema = new mongoose.Schema(
  {
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ICTAsset",
      default: null,
      index: true,
    },
    technicianName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    categoryGroup: {
      type: String,
      enum: CATEGORY_GROUPS,
      default: null,
    },
    category: {
      type: String,
      enum: [
        ...TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES,
        ...TECHNICIAN_FEEDBACK_CATEGORY_LABELS,
        ...LEGACY_FEEDBACK_CATEGORIES,
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    recommendation: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
    followUpRequired: {
      type: Boolean,
      required: true,
      default: null,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewComments: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: "Rating must be a whole number from 1 to 5.",
      },
    },
    status: {
      type: String,
      enum: [
        ...TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES,
        ...LEGACY_FEEDBACK_STATUSES,
      ],
      default: "Submitted",
    },
    adminResponse: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

technicianFeedbackSchema.index({ createdAt: -1 });
technicianFeedbackSchema.index({ technician: 1, createdAt: -1 });
technicianFeedbackSchema.index({ category: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model(
  "TechnicianFeedback",
  technicianFeedbackSchema,
);
