/**
 * models/Feedback.js
 * Requester feedback/rating on a resolved ticket
 */
const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: [true, 'Ticket reference is required.'],
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required.'],
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required.'],
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

/* `request` is already indexed — the `unique: true` on the field above creates a
   unique index on { request: 1 }. Declaring a second, non-unique index on the
   same key pattern is an IndexOptionsConflict (Mongo error 85), so it is
   deliberately NOT repeated here. */
feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ rating: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
