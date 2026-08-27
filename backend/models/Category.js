const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
