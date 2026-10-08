const mongoose = require("mongoose");

const profileImageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contentType: {
      type: String,
      enum: ["image/jpeg", "image/png", "image/webp"],
      required: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
      max: 1.5 * 1024 * 1024,
    },
  },
  { timestamps: true },
);

profileImageSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("ProfileImage", profileImageSchema);
