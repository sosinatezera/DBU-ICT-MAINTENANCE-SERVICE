const mongoose = require("mongoose");

const technicianSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    specialization: { type: String, trim: true, default: null },
    /* Employee ID + shift are written/read by technicianController.updateMyTechnicianProfile */
    employeeId: { type: String, trim: true, default: null },
    shift: {
      type: String,
      enum: ["morning", "afternoon", "night"],
      default: null,
    },
    available: { type: Boolean, default: true },
    availability: {
      type: String,
      enum: ["available", "busy", "offline"],
      default: null,
    },
  },
  { timestamps: true },
);

technicianSchema.index({ specialization: 1, createdAt: 1 });
technicianSchema.index({ available: 1, createdAt: 1 });
technicianSchema.index({ availability: 1, createdAt: 1 });

module.exports = mongoose.model("Technician", technicianSchema);
