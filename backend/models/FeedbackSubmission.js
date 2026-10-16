const mongoose = require("mongoose");
const { TECHNICIAN_FEEDBACK_CATEGORIES } = require("../utils/feedbackCategories");

const FEEDBACK_STATUSES = ["Pending", "In Progress", "Replied", "Resolved", "Closed"];
const LEGACY_STATUS_MAP = {
  "In Review": "In Progress",
  Responded: "Replied",
  Reopened: "Replied",
};

const normalizeStatus = (status) => LEGACY_STATUS_MAP[status] || status;

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["Technician", "ICT Admin"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    actionTaken: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    oldStatus: { type: String, default: null },
    newStatus: {
      type: String,
      enum: [...FEEDBACK_STATUSES, "In Review", "Responded", "Reopened"],
      required: true,
    },
    comment: { type: String, trim: true, maxlength: 2000, default: "" },
    actionTaken: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true },
);

const feedbackSubmissionSchema = new mongoose.Schema(
  {
    feedbackNumber: {
      type: String,
      required: true,
      unique: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["Technician"],
      required: true,
    },
    department: { type: String, trim: true, maxlength: 100, default: null },
    category: {
      type: String,
      enum: TECHNICIAN_FEEDBACK_CATEGORIES,
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    relatedRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: null,
    },
    attachment: {
      storageName: { type: String, default: null },
      originalName: { type: String, trim: true, maxlength: 255, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, min: 0, default: null },
    },
    status: {
      type: String,
      enum: [...FEEDBACK_STATUSES, "In Review", "Responded", "Reopened"],
      default: "Pending",
    },
    messages: { type: [messageSchema], default: [] },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

feedbackSubmissionSchema.pre("validate", function normalizeLegacyStatuses() {
  this.status = normalizeStatus(this.status);
  this.statusHistory.forEach((entry) => {
    if (entry.oldStatus) entry.oldStatus = normalizeStatus(entry.oldStatus);
    entry.newStatus = normalizeStatus(entry.newStatus);
  });
});

feedbackSubmissionSchema.index({ sender: 1, createdAt: -1 });
feedbackSubmissionSchema.index({ senderRole: 1, createdAt: -1 });
feedbackSubmissionSchema.index({ status: 1, createdAt: -1 });
feedbackSubmissionSchema.index({ category: 1, createdAt: -1 });
feedbackSubmissionSchema.index({ senderRole: 1, priority: 1, createdAt: -1 });
feedbackSubmissionSchema.index({ relatedRequest: 1 });

module.exports = mongoose.model("FeedbackSubmission", feedbackSubmissionSchema);
