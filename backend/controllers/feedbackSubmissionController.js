const FeedbackSubmission = require("../models/FeedbackSubmission");
const FeedbackCounter = require("../models/FeedbackCounter");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Assignment = require("../models/Assignment");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const { broadcastNotification } = require("../services/notificationService");
const { validateObjectId } = require("../middleware/validation");
const {
  TECHNICIAN_FEEDBACK_CATEGORIES,
} = require("../utils/feedbackCategories");

const FEEDBACK_STATUSES = [
  "Pending",
  "In Progress",
  "Replied",
  "Resolved",
  "Closed",
];
const LEGACY_STATUS_MAP = { "In Review": "In Progress", Responded: "Replied", Reopened: "Replied" };
const PAGE_SIZE_MAX = 50;
const PRIVATE_FEEDBACK_DIR = path.join(__dirname, "..", "private_uploads", "feedback");
const FEEDBACK_POPULATES = [
  { path: "sender", select: "fullName email department" },
  { path: "relatedRequest", select: "ticketId title" },
  { path: "messages.sender", select: "fullName role" },
  { path: "statusHistory.changedBy", select: "fullName role" },
];

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populatedSubmission = (query) =>
  FEEDBACK_POPULATES.reduce((populatedQuery, options) => populatedQuery.populate(options), query);

const populateSubmissionRecords = (records) =>
  FeedbackSubmission.populate(records, FEEDBACK_POPULATES);

function normalizeSubmission(record) {
  if (!record) return record;
  record.status = LEGACY_STATUS_MAP[record.status] || record.status;
  const lastReply = (record.messages || []).reduce((latest, message) => {
    if (!message.createdAt) return latest;
    const time = new Date(message.createdAt).getTime();
    return Number.isFinite(time) && (!latest || time > latest.getTime())
      ? new Date(time)
      : latest;
  }, null);
  record.lastReplyAt = lastReply;
  (record.statusHistory || []).forEach((entry) => {
    entry.oldStatus = LEGACY_STATUS_MAP[entry.oldStatus] || entry.oldStatus;
    entry.newStatus = LEGACY_STATUS_MAP[entry.newStatus] || entry.newStatus;
  });
  return record;
}

function statusFilter(status) {
  if (status === "In Progress") return { $in: ["In Progress", "In Review"] };
  if (status === "Replied") return { $in: ["Replied", "Responded", "Reopened"] };
  return status;
}

function parseDateRange(fromValue, toValue) {
  const range = {};
  if (fromValue) {
    const from = new Date(`${fromValue}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) return { error: "Invalid start date." };
    range.$gte = from;
  }
  if (toValue) {
    const to = new Date(`${toValue}T23:59:59.999Z`);
    if (Number.isNaN(to.getTime())) return { error: "Invalid end date." };
    range.$lte = to;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    return { error: "Start date must not be after end date." };
  }
  return { range };
}

function safeAttachmentOriginalName(name) {
  return String(name || "feedback-attachment")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\r\n"]/g, "_")
    .slice(0, 255);
}

function hasExpectedAttachmentSignature(file) {
  const bytes = file.buffer;
  switch (file.mimetype) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    case "image/webp":
      return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    case "application/msword":
    case "application/vnd.ms-excel":
      return bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    case "text/plain":
      return !bytes.includes(0);
    default:
      return false;
  }
}

async function notifyUsers(userIds, submission, title, message, type, notificationType = "feedback_update") {
  if (!userIds.length) return;
  try {
    const notifications = await Notification.insertMany(
      userIds.map((userId) => ({
        user: userId,
        feedbackSubmission: submission._id,
        title,
        message,
        type,
        notificationType,
      })),
    );
    notifications.forEach((notification) => broadcastNotification(notification));
  } catch (err) {
    console.error(
      `Unable to create feedback notifications: ${String(err.message || err).slice(0, 200)}`,
    );
  }
}

async function notifyAdmins(submission, title, message, notificationType) {
  try {
    const admins = await User.find({ role: "ICT Admin", status: "active" })
      .select("_id")
      .lean();
    await notifyUsers(
      admins.map((admin) => admin._id),
      submission,
      title,
      message,
      "info",
      notificationType,
    );
  } catch (err) {
    console.error(
      `Unable to find feedback administrators: ${String(err.message || err).slice(0, 200)}`,
    );
  }
}

async function nextFeedbackNumber() {
  let counter;
  try {
    counter = await FeedbackCounter.findByIdAndUpdate(
      "feedbackNumber",
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    counter = await FeedbackCounter.findByIdAndUpdate(
      "feedbackNumber",
      { $inc: { seq: 1 } },
      { new: true },
    );
  }
  return `FB-${String(counter.seq).padStart(6, "0")}`;
}

function sendValidationError(res, message) {
  return res.status(400).json({ success: false, message });
}

const submitFeedbackSubmission = async (req, res, next) => {
  let savedAttachmentPath;
  try {
    if (req.user.role !== "Technician") {
      return res.status(403).json({ success: false, message: "Only Technicians may submit feedback." });
    }
    const { category, subject, description } = req.body;
    if (typeof category !== "string" || !TECHNICIAN_FEEDBACK_CATEGORIES.includes(category)) {
      return sendValidationError(res, "Choose a valid feedback category.");
    }
    if (typeof subject !== "string" || !subject.trim()) {
      return sendValidationError(res, "Feedback subject is required.");
    }
    if (subject.trim().length > 160) {
      return sendValidationError(res, "Feedback subject must be 160 characters or fewer.");
    }
    if (typeof description !== "string" || !description.trim()) {
      return sendValidationError(res, "Feedback description is required.");
    }
    if (description.trim().length > 5000) {
      return sendValidationError(res, "Feedback description must be 5,000 characters or fewer.");
    }
    const priority = typeof req.body.priority === "string" ? req.body.priority.trim() : "";
    if (!["Low", "Medium", "High"].includes(priority)) {
      return sendValidationError(res, "Choose a valid feedback priority.");
    }

    const sender = await User.findById(req.user.id).select("fullName department role status");
    if (!sender || sender.status !== "active" || sender.role !== req.user.role) {
      return res.status(403).json({ success: false, message: "Your active user profile could not be verified." });
    }

    let relatedRequest = null;
    const relatedRequestId = typeof req.body.relatedRequestId === "string"
      ? req.body.relatedRequestId.trim()
      : "";
    if (relatedRequestId) {
      const isObjectId = mongoose.isValidObjectId(relatedRequestId);
      if (!isObjectId && !/^MAU-\d{4,}$/i.test(relatedRequestId)) {
        return sendValidationError(res, "Enter a valid service request ID.");
      }
      relatedRequest = await Ticket.findOne(isObjectId
        ? { _id: relatedRequestId }
        : { ticketId: relatedRequestId.toUpperCase() }).select("_id assignedTechnician ticketId");
      if (!relatedRequest) {
        return sendValidationError(res, "The referenced service request was not found.");
      }
      const technicianProfile = await Technician.findOne({ user: req.user.id }).select("_id");
      const assigned = relatedRequest.assignedTechnician &&
        String(relatedRequest.assignedTechnician) === String(req.user.id);
      const historicalAssignment = technicianProfile && await Assignment.exists({
        ticket: relatedRequest._id,
        technician: technicianProfile._id,
      });
      if (!assigned && !historicalAssignment) {
        return sendValidationError(res, "You may reference only a service request assigned to your technician account.");
      }
    }

    let attachment = null;
    if (req.file) {
      if (!hasExpectedAttachmentSignature(req.file)) {
        return sendValidationError(res, "The uploaded file content does not match its declared type.");
      }
      const storageName = `${crypto.randomBytes(24).toString("hex")}${path.extname(req.file.originalname).toLowerCase()}`;
      await fs.promises.mkdir(PRIVATE_FEEDBACK_DIR, { recursive: true });
      savedAttachmentPath = path.join(PRIVATE_FEEDBACK_DIR, storageName);
      await fs.promises.writeFile(savedAttachmentPath, req.file.buffer, { flag: "wx", mode: 0o600 });
      attachment = {
        storageName,
        originalName: safeAttachmentOriginalName(req.file.originalname),
        mimeType: req.file.mimetype,
        size: req.file.size,
      };
    }

    const submission = await FeedbackSubmission.create({
      feedbackNumber: await nextFeedbackNumber(),
      sender: req.user.id,
      senderRole: "Technician",
      department: sender.department || null,
      category,
      subject: subject.trim(),
      description: description.trim(),
      relatedRequest: relatedRequest?._id || null,
      priority,
      attachment,
      statusHistory: [
        {
          changedBy: req.user.id,
          oldStatus: null,
          newStatus: "Pending",
          comment: "Feedback submitted.",
        },
      ],
    });
    req.auditEntityId = submission._id;

    await notifyAdmins(
      submission,
      "New feedback submitted",
      `${sender.fullName || req.user.role} submitted ${submission.feedbackNumber}.`,
      "feedback_submission_technician",
    );

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully.",
      data: { id: submission._id, feedbackNumber: submission.feedbackNumber, createdAt: submission.createdAt },
    });
  } catch (err) {
    if (savedAttachmentPath) {
      await fs.promises.unlink(savedAttachmentPath).catch((cleanupError) => {
        console.error(`Unable to remove orphan feedback attachment: ${String(cleanupError.message || cleanupError).slice(0, 200)}`);
      });
    }
    next(err);
  }
};

const getMyFeedbackSubmissions = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = { sender: req.user.id, senderRole: "Technician" };
    if (req.query.status) {
      if (!FEEDBACK_STATUSES.includes(req.query.status)) {
        return sendValidationError(res, "Choose a valid feedback status.");
      }
      filter.status = statusFilter(req.query.status);
    }
    if (req.query.category) {
      if (!TECHNICIAN_FEEDBACK_CATEGORIES.includes(req.query.category)) {
        return sendValidationError(res, "Choose a valid feedback category.");
      }
      filter.category = req.query.category;
    }
    if (req.query.priority) {
      if (req.user.role !== "Technician" || !["Low", "Medium", "High"].includes(req.query.priority)) {
        return sendValidationError(res, "Choose a valid feedback priority.");
      }
      filter.priority = req.query.priority;
    }
    if (req.query.from || req.query.to) {
      const { range, error } = parseDateRange(req.query.from, req.query.to);
      if (error) return sendValidationError(res, error);
      filter.createdAt = range;
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const expression = new RegExp(escapeRegExp(req.query.search.trim().slice(0, 100)), "i");
      filter.$or = [
        { feedbackNumber: expression },
        { subject: expression },
        { category: expression },
        { description: expression },
        { "messages.message": expression },
      ];
    }

    const [total, records, groupedStatuses] = await Promise.all([
      FeedbackSubmission.countDocuments(filter),
      populatedSubmission(
        FeedbackSubmission.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
      ).lean(),
      FeedbackSubmission.aggregate([
        { $match: { sender: new mongoose.Types.ObjectId(req.user.id) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const statusCounts = Object.fromEntries(
      groupedStatuses.map((entry) => [entry._id, entry.count]),
    );
    return res.json({
      success: true,
      data: records.map(normalizeSubmission),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: {
        total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
        pending: statusCounts.Pending || 0,
        inProgress: (statusCounts["In Progress"] || 0) + (statusCounts["In Review"] || 0),
        replied: (statusCounts.Replied || 0) + (statusCounts.Responded || 0) + (statusCounts.Reopened || 0),
        resolved: statusCounts.Resolved || 0,
        closed: statusCounts.Closed || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getAdminFeedbackSubmissions = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = { senderRole: "Technician" };
    if (req.query.status) {
      if (!FEEDBACK_STATUSES.includes(req.query.status)) {
        return sendValidationError(res, "Choose a valid feedback status.");
      }
      filter.status = statusFilter(req.query.status);
    }
    if (req.query.role) {
      if (req.query.role !== "Technician") {
        return sendValidationError(res, "Choose a valid sender role.");
      }
    }
    if (req.query.technician) {
      if (req.query.role && req.query.role !== "Technician") {
        return sendValidationError(res, "Technician filter cannot be combined with another sender role.");
      }
      const idError = validateObjectId(req.query.technician, "Technician");
      if (idError) return sendValidationError(res, idError);
      filter.senderRole = "Technician";
      filter.sender = req.query.technician;
    }
    if (typeof req.query.department === "string" && req.query.department.trim()) {
      filter.department = new RegExp(escapeRegExp(req.query.department.trim().slice(0, 100)), "i");
    }
    if (req.query.replyStatus) {
      if (!["replied", "unreplied"].includes(req.query.replyStatus)) {
        return sendValidationError(res, "Choose a valid reply status.");
      }
      filter.messages = req.query.replyStatus === "replied"
        ? { $elemMatch: { senderRole: "ICT Admin" } }
        : { $not: { $elemMatch: { senderRole: "ICT Admin" } } };
    }
    if (req.query.priority) {
      if (!["Low", "Medium", "High"].includes(req.query.priority)) {
        return sendValidationError(res, "Choose a valid feedback priority.");
      }
      filter.priority = req.query.priority;
    }
    if (req.query.category) {
      if (!TECHNICIAN_FEEDBACK_CATEGORIES.includes(req.query.category)) {
        return sendValidationError(res, "Choose a valid feedback category.");
      }
      filter.category = req.query.category;
    }
    if (req.query.from || req.query.to) {
      const { range, error } = parseDateRange(req.query.from, req.query.to);
      if (error) return sendValidationError(res, error);
      filter.createdAt = range;
    }
    const queryText = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    if (queryText) {
      const expression = new RegExp(escapeRegExp(queryText), "i");
      const [matchingSenders, matchingRequests] = await Promise.all([
        User.find({
          $or: [{ fullName: expression }, { email: expression }],
        }).select("_id").lean(),
        Ticket.find({ ticketId: expression }).select("_id").lean(),
      ]);
      filter.$or = [
        { feedbackNumber: expression },
        { subject: expression },
        { category: expression },
        { description: expression },
        { sender: { $in: matchingSenders.map((user) => user._id) } },
        { relatedRequest: { $in: matchingRequests.map((ticket) => ticket._id) } },
      ];
    }
    const sort = req.query.sort === "oldest"
      ? { createdAt: 1 }
      : req.query.sort === "status"
        ? { status: 1, createdAt: -1 }
        : req.query.sort === "priority"
          ? { priority: -1, createdAt: -1 }
          : { createdAt: -1 };

    const recordsQuery = req.query.sort === "priority"
      ? FeedbackSubmission.aggregate([
        { $match: filter },
        {
          $addFields: {
            priorityRank: {
              $switch: {
                branches: [
                  { case: { $eq: ["$priority", "High"] }, then: 3 },
                  { case: { $eq: ["$priority", "Medium"] }, then: 2 },
                  { case: { $eq: ["$priority", "Low"] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        { $sort: { priorityRank: -1, createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $unset: "priorityRank" },
      ]).then(populateSubmissionRecords)
      : populatedSubmission(
        FeedbackSubmission.find(filter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit),
      ).lean();
    const [total, records, groupedStatuses] = await Promise.all([
      FeedbackSubmission.countDocuments(filter),
      recordsQuery,
      FeedbackSubmission.aggregate([
        { $match: filter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const byStatus = Object.fromEntries(groupedStatuses.map((entry) => [entry._id, entry.count]));
    return res.json({
      success: true,
      data: records.map(normalizeSubmission),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        pending: byStatus.Pending || 0,
        inProgress: (byStatus["In Progress"] || 0) + (byStatus["In Review"] || 0),
        replied: (byStatus.Replied || 0) + (byStatus.Responded || 0) + (byStatus.Reopened || 0),
        resolved: byStatus.Resolved || 0,
        closed: byStatus.Closed || 0,
        technicians: total,
      },
      categories: TECHNICIAN_FEEDBACK_CATEGORIES,
    });
  } catch (err) {
    next(err);
  }
};

const getFeedbackSubmission = async (req, res, next) => {
  try {
    const idError = validateObjectId(req.params.id, "Feedback");
    if (idError) return sendValidationError(res, idError);
    const submission = normalizeSubmission(await populatedSubmission(
      FeedbackSubmission.findOne({ _id: req.params.id, senderRole: "Technician" }),
    ).lean());
    if (!submission) return res.status(404).json({ success: false, message: "Feedback was not found." });
    if (req.user.role !== "ICT Admin" && String(submission.sender?._id) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: "Feedback was not found." });
    }
    return res.json({ success: true, data: submission });
  } catch (err) {
    next(err);
  }
};

const addFeedbackReply = async (req, res, next) => {
  try {
    const idError = validateObjectId(req.params.id, "Feedback");
    if (idError) return sendValidationError(res, idError);
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!message) return sendValidationError(res, "Reply message is required.");
    if (message.length > 2000) return sendValidationError(res, "Reply must be 2,000 characters or fewer.");
    const actionTaken = typeof req.body.actionTaken === "string" ? req.body.actionTaken.trim() : "";
    if (actionTaken.length > 2000) return sendValidationError(res, "Action taken must be 2,000 characters or fewer.");
    const requestedStatus = req.body.status;
    if (requestedStatus !== undefined &&
      (!["In Progress", "Replied", "Resolved", "Closed"].includes(requestedStatus))) {
      return sendValidationError(res, "Choose a valid reply status.");
    }

    const submission = await FeedbackSubmission.findOne({
      _id: req.params.id,
      senderRole: "Technician",
    });
    if (!submission) return res.status(404).json({ success: false, message: "Feedback was not found." });
    const isAdmin = req.user.role === "ICT Admin";
    if (!isAdmin && String(submission.sender) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: "Feedback was not found." });
    }
    submission.status = LEGACY_STATUS_MAP[submission.status] || submission.status;
    const previousStatus = submission.status;
    if (!isAdmin && submission.status === "Closed") {
      return res.status(409).json({ success: false, message: "This feedback is closed. Contact ICT Admin to reopen it." });
    }

    submission.messages.push({
      sender: req.user.id,
      senderRole: req.user.role,
      message,
      actionTaken: isAdmin ? actionTaken : "",
    });
    if (isAdmin) {
      const nextStatus = requestedStatus || "Replied";
      if (submission.status !== nextStatus) {
        submission.statusHistory.push({
          changedBy: req.user.id,
          oldStatus: submission.status,
          newStatus: nextStatus,
          comment: "Status updated with administrator reply.",
          actionTaken,
        });
        submission.status = nextStatus;
      }
    } else if (["Resolved", "Replied", "Responded"].includes(submission.status)) {
      submission.statusHistory.push({
        changedBy: req.user.id,
        oldStatus: submission.status,
        newStatus: "Replied",
        comment: "Sender replied to the feedback.",
      });
      submission.status = "Replied";
    }
    await submission.save();
    req.auditEntityId = submission._id;

    if (isAdmin) {
      await notifyUsers(
        [submission.sender],
        submission,
        "New feedback reply",
        `ICT Admin replied to ${submission.feedbackNumber}.`,
        "info",
        "feedback_reply",
      );
      if (submission.status !== previousStatus) {
        await notifyUsers(
          [submission.sender],
          submission,
          "Feedback status updated",
          `${submission.feedbackNumber} is now ${submission.status}.`,
          requestedStatus === "Resolved" || requestedStatus === "Closed" ? "success" : "info",
          "feedback_reply",
        );
      }
    } else {
      await notifyAdmins(
        submission,
        "Feedback updated",
        `${req.user.name || submission.senderRole} replied to ${submission.feedbackNumber}.`,
        "feedback_submission_technician",
      );
    }
    return res.status(201).json({ success: true, data: { id: submission._id } });
  } catch (err) {
    next(err);
  }
};

const updateFeedbackSubmission = async (req, res, next) => {
  try {
    const idError = validateObjectId(req.params.id, "Feedback");
    if (idError) return sendValidationError(res, idError);
    const { status } = req.body;
    if (!FEEDBACK_STATUSES.includes(status)) {
      return sendValidationError(res, "Choose a valid feedback status.");
    }
    const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
    if (comment.length > 2000) {
      return sendValidationError(res, "Status note must be 2,000 characters or fewer.");
    }
    const actionTaken = typeof req.body.actionTaken === "string" ? req.body.actionTaken.trim() : "";
    if (actionTaken.length > 2000) return sendValidationError(res, "Action taken must be 2,000 characters or fewer.");

    const submission = await FeedbackSubmission.findOne({
      _id: req.params.id,
      senderRole: "Technician",
    });
    if (!submission) return res.status(404).json({ success: false, message: "Feedback was not found." });
    submission.status = LEGACY_STATUS_MAP[submission.status] || submission.status;
    const statusChanged = submission.status !== status;
    if (statusChanged || comment || actionTaken) {
      submission.statusHistory.push({
        changedBy: req.user.id,
        oldStatus: submission.status,
        newStatus: status,
        comment,
        actionTaken,
      });
      submission.status = status;
      await submission.save();
    }
    req.auditEntityId = submission._id;
    if (statusChanged) {
      await notifyUsers(
        [submission.sender],
        submission,
        "Feedback status updated",
        `${submission.feedbackNumber} is now ${submission.status}.`,
        status === "Resolved" || status === "Closed" ? "success" : "info",
        "feedback_reply",
      );
    }
    return res.json({ success: true, data: { id: submission._id, status: submission.status } });
  } catch (err) {
    next(err);
  }
};

const downloadFeedbackAttachment = async (req, res, next) => {
  try {
    const idError = validateObjectId(req.params.id, "Feedback");
    if (idError) return sendValidationError(res, idError);
    const submission = await FeedbackSubmission.findOne({
      _id: req.params.id,
      senderRole: "Technician",
    }).select("sender senderRole attachment");
    if (!submission?.attachment?.storageName) {
      return res.status(404).json({ success: false, message: "Feedback attachment was not found." });
    }
    if (req.user.role !== "ICT Admin" && String(submission.sender) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: "Feedback attachment was not found." });
    }
    const storageName = path.basename(submission.attachment.storageName);
    const filePath = path.join(PRIVATE_FEEDBACK_DIR, storageName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "Feedback attachment is unavailable." });
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");
    return res.download(filePath, safeAttachmentOriginalName(submission.attachment.originalName || "feedback-attachment"));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitFeedbackSubmission,
  getMyFeedbackSubmissions,
  getAdminFeedbackSubmissions,
  getFeedbackSubmission,
  addFeedbackReply,
  updateFeedbackSubmission,
  downloadFeedbackAttachment,
};
