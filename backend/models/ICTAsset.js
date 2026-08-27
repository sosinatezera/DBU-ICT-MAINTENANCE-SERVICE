const mongoose = require('mongoose');

const ictAssetSchema = new mongoose.Schema({
  asset_name:      { type: String, required: true, trim: true },
  asset_tag:       { type: String, required: true, unique: true, trim: true },
  category:        { type: String, trim: true, default: null },
  department:      { type: String, trim: true, default: null },
  location:        { type: String, trim: true, default: null },
  status:          { type: String, enum: ['active','under_maintenance','decommissioned'], default: 'active' },
  purchase_date:   { type: Date, default: null },
  warranty_expiry: { type: Date, default: null },
  description:     { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ICTAsset', ictAssetSchema);
