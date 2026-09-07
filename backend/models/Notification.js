const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticket:  { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
  title:   { type: String, required: true },
  message: { type: String, required: true },
  type:    { type: String, enum: ['info','success','warning','danger'], default: 'info' },
  is_read: { type: Boolean, default: false },
}, { timestamps: true });

/* Hot path: "my notifications" sorted newest-first — index user + createdAt. */
notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
