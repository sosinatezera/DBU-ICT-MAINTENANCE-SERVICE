const mongoose = require("mongoose");

const aiFeedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    question: { type: String, required: true, maxlength: 4000 },
    answer: { type: String, required: true, maxlength: 12000 },
    type: {
      type: String,
      enum: [
        "helpful",
        "not_helpful",
        "incorrect",
        "irrelevant",
        "complex",
        "missing",
        "other",
      ],
      required: true,
    },
    comment: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true },
);

aiFeedbackSchema.index({ createdAt: -1 });
aiFeedbackSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("AIFeedback", aiFeedbackSchema);
