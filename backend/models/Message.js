/**
 * models/Message.js
 * Networking/communication — an individual message inside a conversation.
 *
 * readAt is null while the recipient has not opened the thread; once the
 * receiving user fetches the conversation, all their unread messages have
 * readAt set. Presence/absence + indexes drive the unread badges.
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    body: {
      type: String,
      required: [true, 'Message body is required.'],
      trim: true,
      maxlength: 2000,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/* Hot path: conversation timeline sorted newest-first. */
messageSchema.index({ conversation: 1, createdAt: -1 });
/* Hot path: unread counts per recipient inside a conversation. */
messageSchema.index({ conversation: 1, recipient: 1, readAt: 1 });

module.exports = mongoose.model('Message', messageSchema);