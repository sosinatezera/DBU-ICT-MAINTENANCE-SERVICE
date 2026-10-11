const mongoose = require("mongoose");

const systemOperationLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    operationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    leaseUntil: { type: Date, required: true },
  },
  { versionKey: false },
);

module.exports = mongoose.model(
  "SystemOperationLock",
  systemOperationLockSchema,
);
