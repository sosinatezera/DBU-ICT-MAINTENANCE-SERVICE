const mongoose = require("mongoose");

const systemBackupSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["in_progress", "completed", "failed"],
      required: true,
      index: true,
    },
    backupType: { type: String, enum: ["mongodump-archive"], required: true },
    fileName: { type: String, required: true, unique: true },
    fileSizeBytes: { type: Number, min: 0, default: null },
    checksumSha256: { type: String, default: null },
    integrityVerified: { type: Boolean, default: false },
    errorMessage: { type: String, default: null, maxlength: 1000 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SystemBackup", systemBackupSchema);
