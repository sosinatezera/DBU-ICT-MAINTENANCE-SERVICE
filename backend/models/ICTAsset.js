const mongoose = require('mongoose');

const ictAssetSchema = new mongoose.Schema({
  asset_name:      { type: String, required: true, trim: true },
  asset_tag:       { type: String, required: true, unique: true, trim: true },
  category:        { type: String, trim: true, default: null },
  department:      { type: String, trim: true, default: null },
  location:        { type: String, trim: true, default: null },
  serial_number:   { type: String, trim: true, default: null },
  manufacturer:    { type: String, trim: true, default: null },
  model:           { type: String, trim: true, default: null },
  condition:       { type: String, enum: ['new', 'good', 'fair', 'poor'], default: 'good' },
  status:          { type: String, enum: ['active','under_maintenance','decommissioned'], default: 'active' },
  purchase_date:   { type: Date, default: null },
  warranty_expiry: { type: Date, default: null },
  description:     { type: String, default: null },
}, { timestamps: true });

ictAssetSchema.index({ asset_name: 1 });
/* asset_tag is indexed exactly once, by `unique: true` on the field above.
   A second schema.index({ asset_tag: 1 }) here produced a duplicate index
   over the same key pattern with different options (unique vs non-unique),
   which MongoDB rejects with IndexOptionsConflict. Uniqueness is preserved. */

ictAssetSchema.index({ status: 1, asset_name: 1 });
ictAssetSchema.index({ category: 1, createdAt: -1 });
ictAssetSchema.index({ department: 1, asset_name: 1 });

module.exports = mongoose.model('ICTAsset', ictAssetSchema);
