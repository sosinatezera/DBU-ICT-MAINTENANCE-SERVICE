const mongoose = require("mongoose");

const profileFileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    storedName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["document", "image"],
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

profileFileSchema.index({ user: 1, uploadedAt: -1 });
profileFileSchema.index({ user: 1, category: 1 });

module.exports = mongoose.model("ProfileFile", profileFileSchema);