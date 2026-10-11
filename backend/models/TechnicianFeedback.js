const mongoose = require("mongoose");
const {
  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS,
  TECHNICIAN_FEEDBACK_CATEGORY_LABELS,
} = require("../utils/technicianFeedbackCategories");

const CATEGORY_GROUPS = TECHNICIAN_FEEDBACK_CATEGORY_GROUPS.map(
  ({ group }) => group,
);
const LEGACY_FEEDBACK_CATEGORIES = ["Workflow"];

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
    categoryGroup: {
      type: String,
      enum: CATEGORY_GROUPS,
      required: true,
    },
    category: {
      type: String,
      enum: [...TECHNICIAN_FEEDBACK_CATEGORY_LABELS, ...LEGACY_FEEDBACK_CATEGORIES],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
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
      enum: ["Pending", "Reviewed"],
      default: "Pending",
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

module.exports = mongoose.model(
  "TechnicianFeedback",
  technicianFeedbackSchema,
);
