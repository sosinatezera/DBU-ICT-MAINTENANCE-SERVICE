const mongoose = require('mongoose');

const technicianSchema = new mongoose.Schema({
  user:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  specialization: { type: String, trim: true, default: null },
  /* Employee ID + shift are written/read by technicianController.updateMyTechnicianProfile */
  employeeId:     { type: String, trim: true, default: null },
  shift:          { type: String, enum: ['morning', 'afternoon', 'night'], default: null },
  available:      { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Technician', technicianSchema);
