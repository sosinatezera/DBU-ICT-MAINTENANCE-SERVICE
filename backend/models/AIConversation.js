/**
 * models/AIConversation.js
 * Persistent Master AI chat transcripts.
 * Each authenticated user's conversation is stored so history survives server
 * restarts and can be resumed via the same conversationId. Anonymous visitor
 * chats are intentionally not persisted (see routes/ai.js).
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 20000,
    },
  },
  { _id: false }
);

const aiConversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

aiConversationSchema.index({ lastActivityAt: -1 });

module.exports = mongoose.model('AIConversation', aiConversationSchema);