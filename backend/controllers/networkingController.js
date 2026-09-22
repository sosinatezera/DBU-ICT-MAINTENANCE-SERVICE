/**
 * controllers/networkingController.js
 * Networking/communication — direct messages between users.
 *
 * Any authenticated user can exchange messages. A conversation is always
 * restricted to its two participants: every list/read request re-verifies
 * membership server-side (never trusts the client) and the sender of a message
 * is taken from the JWT (req.user.id), never from the request body.
 *
 * Endpoints:
 *   GET    /api/networking/contacts                      — who I can message
 *   GET    /api/networking/conversations                  — my threads + unread
 *   POST   /api/networking/conversations                  — start/find a thread
 *   GET    /api/networking/conversations/:id/messages     — timeline (marks read)
 *   POST   /api/networking/conversations/:id/messages     — send (rate-limited)
 *   POST   /api/networking/conversations/:id/read         — mark thread read
 *   GET    /api/networking/unread-count                   — total unread messages
 */

const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const User         = require('../models/User');
const Notification = require('../models/Notification');
const {
  validateObjectId,
  validateMessage,
} = require('../middleware/validation');

/* ── Helpers ─────────────────────────────────────────────── */

/* Sort two user ids so the unique participants index stays deterministic. */
function pair(userA, userB) {
  return String(userA) < String(userB) ? [userA, userB] : [userB, userA];
}

/* Confirm the current user is a member of the conversation. */
async function userInConversation(userId, conversation) {
  if (!conversation) return false;
  return conversation.participants.some(p => String(p) === String(userId));
}

/* The other participant's id — the person the current user is talking to. */
function otherParticipant(conversation, userId) {
  return conversation.participants.find(p => String(p) !== String(userId)) || null;
}

/* Build a lean, XSS-safe contact record. */
function formatContact(u) {
  return {
    id:         u._id,
    fullName:   u.fullName,
    role:       u.role,
    department: u.department || null,
    email:      u.email || null,
  };
}

/* Ascending timeline (oldest first) for the chat panel. */
async function getTimeline(conversationId, viewerId, { before = null, limit = 50 } = {}) {
  const filter = { conversation: conversationId };
  if (before) filter._id = { $lt: before };
  const messages = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();

  /* Mark every message addressed to the viewer as read when the thread is open. */
  const incomingIds = messages
    .filter(m => String(m.recipient) === String(viewerId) && !m.readAt)
    .map(m => m._id);
  if (incomingIds.length) {
    await Message.updateMany({ _id: { $in: incomingIds } }, { $set: { readAt: new Date() } });
  }

  return messages.reverse().map(m => ({
    id:        m._id,
    sender_id: m.sender,
    body:      m.body,
    read_at:   m.readAt,
    created_at: m.createdAt,
    is_mine:    String(m.sender) === String(viewerId),
  }));
}

/* ── GET /api/networking/contacts ──────────────────────────
   Who the current user may start a conversation with, based on role:
   - ICT Admin  → everyone
   - Technician → requesters + other ICT Admins
   - Requester  → technicians + ICT Admins */
const getContacts = async (req, res, next) => {
  try {
    const { role, id } = req.user;

    const roleFilter =
      role === 'ICT Admin' ? null
      : role === 'Technician' ? { $in: ['Requester', 'ICT Admin'] }
      : { $in: ['Technician', 'ICT Admin'] };

    const filter = { _id: { $ne: id }, status: 'active' };
    if (roleFilter) filter.role = roleFilter;

    const users = await User.find(filter)
      .select('fullName role department email')
      .sort({ fullName: 1 })
      .lean();

    res.json({ success: true, data: users.map(formatContact) });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/networking/conversations ───────────────────── */
const getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      participants: userId,
      archivedFor:  { $ne: userId },
    })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();

    /* Collect the other participant ids and conversation ids in one pass. */
    const otherIds   = new Set();
    const convIds    = [];
    conversations.forEach(c => {
      const other = otherParticipant(c, userId);
      if (other) otherIds.add(String(other));
      convIds.push(c._id);
    });

    const [users, unreadRows] = await Promise.all([
      otherIds.size
        ? User.find({ _id: { $in: Array.from(otherIds) } })
            .select('fullName role department email')
            .lean()
        : Promise.resolve([]),
      convIds.length
        ? Message.aggregate([
            { $match: { conversation: { $in: convIds }, recipient: userId, readAt: null } },
            { $group: { _id: '$conversation', count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map(u => [String(u._id), u]));
    const unreadMap = new Map(unreadRows.map(r => [String(r._id), r.count]));

    const data = conversations.map(c => {
      const otherId = otherParticipant(c, userId);
      const other = otherId ? userMap.get(String(otherId)) : null;
      return {
        id:               c._id,
        other: other ? formatContact(other) : null,
        last_message:     c.lastMessage?.body || '',
        last_message_from_me: !!(c.lastMessage?.sender && String(c.lastMessage.sender) === String(userId)),
        last_message_at:  c.lastMessageAt,
        created_at:       c.createdAt,
        unread:           unreadMap.get(String(c._id)) || 0,
        archived_for_me:  Array.isArray(c.archivedFor) && c.archivedFor.some(a => String(a) === String(userId)),
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/networking/conversations — start/find a thread ── */
const startConversation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { recipient_id } = req.body;

    const idErr = validateObjectId(recipient_id, 'Recipient');
    if (idErr) return res.status(400).json({ success: false, message: idErr });
    if (String(recipient_id) === String(userId)) {
      return res.status(400).json({ success: false, message: 'You cannot message yourself.' });
    }

    const recipient = await User.findById(recipient_id).select('_id status role');
    if (!recipient || recipient.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Recipient not found or deactivated.' });
    }

    const [a, b] = pair(userId, recipient_id);
    let conversation = await Conversation.findOne({ participants: [a, b] });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [a, b],
        lastMessageAt: new Date(),
      });
    }

    /* Un-archive for the current user if they had hidden it. */
    if (Array.isArray(conversation.archivedFor) && conversation.archivedFor.some(p => String(p) === String(userId))) {
      conversation.archivedFor = conversation.archivedFor.filter(p => String(p) !== String(userId));
      await conversation.save();
    }

    res.status(201).json({ success: true, data: { id: conversation._id, other: formatContact(recipient) } });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/networking/conversations/:id/messages ───────
   Paginated timeline; fetching the thread also marks incoming
   messages as read (server-side, viewer scoped). */
const getMessages = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const idErr = validateObjectId(req.params.id, 'Conversation');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const conversation = await Conversation.findById(req.params.id).lean();
    if (!conversation || !await userInConversation(userId, conversation)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only view your own conversations.' });
    }

    const other = otherParticipant(conversation, userId);
    const otherUser = other
      ? await User.findById(other).select('fullName role department').lean()
      : null;

    const messages = await getTimeline(conversation._id, userId, {
      before: req.query.before || null,
      limit:  req.query.limit || 50,
    });

    res.json({
      success: true,
      data: {
        conversation_id: conversation._id,
        other: otherUser ? formatContact(otherUser) : null,
        messages,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/networking/conversations/:id/messages — send ── */
const sendMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const idErr = validateObjectId(req.params.id, 'Conversation');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || !await userInConversation(userId, conversation)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only message in your own conversations.' });
    }

    const bodyErr = validateMessage(req.body.body);
    if (bodyErr) return res.status(422).json({ success: false, message: bodyErr });

    const recipientId = otherParticipant(conversation, userId);
    const text = String(req.body.body).trim();

    const message = await Message.create({
      conversation: conversation._id,
      sender:       userId,
      recipient:    recipientId,
      body:         text,
      readAt:       null,
    });

    conversation.lastMessage = { body: text, sender: userId };
    conversation.lastMessageAt = new Date();
    await conversation.save();

    /* Mirror into the existing Notification system so the bell reflects it. */
    try {
      await Notification.create({
        user:    recipientId,
        title:   `New message from ${req.user.name || 'a user'}`,
        message: text.length > 90 ? `${text.slice(0, 90)}…` : text,
        type:    'info',
      });
    } catch (_) { /* notification failure never fails the send */ }

    res.status(201).json({
      success: true,
      message: 'Message sent.',
      data: {
        id:         message._id,
        sender_id:  message.sender,
        body:       message.body,
        read_at:    message.readAt,
        created_at: message.createdAt,
        is_mine:    true,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/networking/conversations/:id/read ────────── */
const markConversationRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const idErr = validateObjectId(req.params.id, 'Conversation');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || !await userInConversation(userId, conversation)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only mark your own conversations.' });
    }

    await Message.updateMany(
      { conversation: conversation._id, recipient: userId, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, message: 'Conversation marked as read.' });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/networking/unread-count ─────────────────────
   Aggregate unread messages across all of the user's threads. */
const getUnreadCount = async (req, res, next) => {
  try {
    const unread = await Message.countDocuments({ recipient: req.user.id, readAt: null });
    res.json({ success: true, unread });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getContacts,
  getConversations,
  startConversation,
  getMessages,
  sendMessage,
  markConversationRead,
  getUnreadCount,
};