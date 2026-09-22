/**
 * models/Conversation.js
 * Networking/communication — a two-party conversation between users.
 *
 * participants is normalized (sorted ascending) so the compound unique index
 * prevents duplicate conversations between the same pair regardless of who
 * starts the thread. lastMessageAt feeds the "recent conversations" sort and
 * unread queries avoid scanning the whole collection.
 */
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    /* Exactly two distinct participants (sorted by ObjectId string). */
    participants: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2 && String(v[0]) !== String(v[1]),
        message: 'A conversation must have exactly two distinct participants.',
      },
    },
    /* Snapshot of the latest activity so the list endpoint stays cheap. */
    lastMessage: {
      body:   { type: String, default: '' },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    /* Soft-delete support: which participant(s) archived this thread for
       themselves. The conversation stays for the other side. */
    archivedFor: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
  },
  { timestamps: true }
);

/* Unique pair — participants must already be stored sorted ascending. */
conversationSchema.index({ participants: 1 }, { unique: true });

/* Hot path: list a user's conversations ordered by most recent activity. */
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);