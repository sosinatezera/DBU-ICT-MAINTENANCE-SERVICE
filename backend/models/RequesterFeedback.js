const mongoose = require("mongoose");

const requesterFeedbackSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    problemFixed: {
      type: String,
      enum: ["Yes", "Partially", "No"],
      required: true,
    },
    equipmentWorkingProperly: {
      type: String,
      enum: ["Yes", "No"],
      required: true,
    },
    technicianRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Technician rating must be a whole number from 1 to 5.",
      },
    },
    satisfactionRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "Satisfaction rating must be a whole number from 1 to 5.",
      },
    },
    comments: { type: String, trim: true, maxlength: 2000, default: "" },
    improvementSuggestions: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    status: {
      type: String,
      enum: ["Submitted", "Reviewed", "Follow-up Required"],
      default: "Submitted",
      required: true,
    },
    adminReviewComments: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

requesterFeedbackSchema.pre("validate", function validateConditionalComments() {
  if (
    (this.problemFixed === "Partially" ||
      this.problemFixed === "No" ||
      this.equipmentWorkingProperly === "No") &&
    !this.comments?.trim()
  ) {
    this.invalidate(
      "comments",
      "Comments are required when work is incomplete or the equipment is not working properly.",
    );
  }
});

requesterFeedbackSchema.index({ ticket: 1 }, { unique: true });
requesterFeedbackSchema.index({ requester: 1, createdAt: -1 });
requesterFeedbackSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("RequesterFeedback", requesterFeedbackSchema);
