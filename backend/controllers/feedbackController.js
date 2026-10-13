/**
 * controllers/feedbackController.js
 * Requester ratings and technician maintenance feedback.
 */
const Feedback = require("../models/Feedback");
const TechnicianFeedback = require("../models/TechnicianFeedback");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { broadcastNotification } = require("../services/notificationService");
const {
  validateObjectId,
  validateRequired,
  validateInteger,
  validateLength,
  sanitizeString,
} = require("../middleware/validation");
const { displayTicketId } = require("../utils/ticketId");
const {
  TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES,
  TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES,
} = require("../utils/technicianFeedbackCategories");
const LEGACY_TECHNICIAN_FEEDBACK_STATUS = {
  Pending: "Submitted",
  Reviewed: "Under Review",
};

/* Escape a string for safe use inside a RegExp (user-supplied filters). */
const escapeRegExp = (s) =>
  String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const VALID_REPAIR_QUALITIES = ["Fully Fixed", "Partially Fixed", "Not Fixed"];

const getAllFeedback = async (req, res, next) => {
  try {
    const {
      rating,
      minRating,
      maxRating,
      status,
      department,
      technician,
      from,
      to,
      repairQuality,
      followUpRequested,
    } = req.query;

    const filter = {};

    /* Rating filters (top-level Feedback fields). */
    let ratingCond;
    if (rating !== undefined && rating !== "") {
      const r = Number(rating);
      if (Number.isFinite(r)) ratingCond = r;
    }
    const ratingRange = {};
    if (
      minRating !== undefined &&
      minRating !== "" &&
      Number.isFinite(Number(minRating))
    )
      ratingRange.$gte = Number(minRating);
    if (
      maxRating !== undefined &&
      maxRating !== "" &&
      Number.isFinite(Number(maxRating))
    )
      ratingRange.$lte = Number(maxRating);
    if (ratingCond === undefined && Object.keys(ratingRange).length)
      ratingCond = ratingRange;
    if (ratingCond !== undefined) filter.rating = ratingCond;

    if (repairQuality) {
      if (!VALID_REPAIR_QUALITIES.includes(repairQuality)) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid repair quality.",
        });
      }
      filter.repairQuality = repairQuality;
    }
    if (followUpRequested !== undefined && followUpRequested !== "") {
      if (!["true", "false"].includes(String(followUpRequested))) {
        return res.status(400).json({
          success: false,
          message: "Follow-up filter must be true or false.",
        });
      }
      if (String(followUpRequested) === "true") {
        filter.followUpRequested = true;
      } else {
        filter.$or = [
          { followUpRequested: false },
          { followUpRequested: { $exists: false } },
        ];
      }
    }

    /* Date range on when the feedback was submitted. */
    if (from || to) {
      filter.createdAt = {};
      for (const date of [from, to].filter(Boolean)) {
        const parsed = new Date(`${date}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== date
        ) {
          return res.status(400).json({
            success: false,
            message: "Feedback date filters must use YYYY-MM-DD.",
          });
        }
      }
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    /*
     * Ticket-level filters (status / department / technician) live on the
     * referenced Ticket, so resolve them to matching ticket ids first and
     * constrain the Feedback records by that set.
     */
    const ticketConds = [];
    if (status) ticketConds.push({ status });
    if (department)
      ticketConds.push({
        department: new RegExp(escapeRegExp(department), "i"),
      });
    if (technician) {
      const techIds = (
        await User.find({ fullName: new RegExp(escapeRegExp(technician), "i") })
          .select("_id")
          .lean()
      ).map((u) => u._id);
      /* An empty $in yields no matches (rather than matching everything). */
      ticketConds.push({ assignedTechnician: { $in: techIds } });
    }

    if (ticketConds.length) {
      const matched = await Ticket.find({ $and: ticketConds })
        .select("_id")
        .lean();
      if (!matched.length) {
        return res.json({
          success: true,
          data: [],
          summary: {
            totalFeedback: 0,
            averageRating: 0,
            fiveStarFeedback: 0,
            lowRatings: 0,
            pendingReview: 0,
            followUpRequests: 0,
          },
        });
      }
      filter.request = { $in: matched.map((t) => t._id) };
    }

    const feedback = await Feedback.find(filter)
      .populate("user", "fullName")
      .populate({
        path: "request",
        select:
          "ticketId title problemDescription status equipmentType otherDeviceName device assetId department requester assignedTechnician adminFeedback.adminId",
        populate: [
          { path: "requester", select: "fullName" },
          { path: "assignedTechnician", select: "fullName" },
          { path: "assetId", select: "asset_tag asset_name" },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    feedback.forEach((fb) => {
      if (fb.request && fb.request.ticketId)
        fb.request.ticketId = displayTicketId(fb.request.ticketId);
    });

    /* KPIs are computed by the backend from the same filtered dataset —
       never hard-coded in the frontend. */
    const [agg] = await Feedback.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avg: { $avg: "$rating" },
          five: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          low: { $sum: { $cond: [{ $lte: ["$rating", 2] }, 1, 0] } },
          followUps: {
            $sum: { $cond: [{ $eq: ["$followUpRequested", true] }, 1, 0] },
          },
        },
      },
    ]);

    /* "Pending review" = submitted requester feedback that no ICT Admin has
       evaluated yet (no admin feedback recorded on the underlying ticket).
       A feedback record whose referenced Ticket resolved to null (the ticket
       was deleted or its ObjectId is orphaned) has no document to inspect, so
       it is skipped here — it can never be a pending review. Without this the
       access below would throw "Cannot read properties of null (reading '_id')"
       and kill the whole GET /feedbacks response. */
    const requestIds = [
      ...new Set(
        feedback
          .filter((f) => f.request && f.request._id)
          .map((f) => String(f.request._id)),
      ),
    ];
    const pendingReview = requestIds.length
      ? await Ticket.countDocuments({
          _id: { $in: requestIds },
          "adminFeedback.adminId": null,
        })
      : 0;

    res.json({
      success: true,
      data: feedback,
      summary: {
        totalFeedback: agg ? agg.total : 0,
        averageRating: agg && agg.total ? Math.round(agg.avg * 10) / 10 : 0,
        fiveStarFeedback: agg ? agg.five : 0,
        lowRatings: agg ? agg.low : 0,
        pendingReview,
        followUpRequests: agg ? agg.followUps : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

const submitFeedback = async (req, res, next) => {
  try {
    const { request_id, rating, comment } = req.body;

    const reqErr = validateRequired(request_id, "request_id");
    if (reqErr)
      return res.status(422).json({ success: false, message: reqErr });

    const ratingErr = validateRequired(rating, "rating");
    if (ratingErr)
      return res.status(422).json({ success: false, message: ratingErr });

    const idErr = validateObjectId(request_id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ratingIntErr = validateInteger(rating, "Rating", { min: 1, max: 5 });
    if (ratingIntErr)
      return res.status(400).json({ success: false, message: ratingIntErr });

    if (comment !== undefined && comment !== null) {
      const commentLenErr = validateLength(String(comment), "Comment", {
        max: 500,
      });
      if (commentLenErr)
        return res.status(400).json({ success: false, message: commentLenErr });
    }

    /* Verify the ticket belongs to the requester and is resolved/closed */
    const ticket = await Ticket.findById(request_id);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    /* Compare both IDs as strings so the ownership check works:
       `ticket.requester` is a Mongoose ObjectId and `req.user.id` is also an ObjectId.
       Comparing a string to an ObjectId directly would always be unequal and would
       wrongly reject the ticket owner with a 403. */
    if (String(ticket.requester) !== String(req.user.id)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You can only rate your own tickets.",
        });
    }

    if (!["resolved", "closed"].includes(ticket.status)) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Feedback can only be submitted for resolved or closed tickets.",
        });
    }

    /* Prevent duplicate feedback */
    const existing = await Feedback.findOne({ request: request_id });
    if (existing) {
      return res
        .status(409)
        .json({
          success: false,
          message: "Feedback already submitted for this ticket.",
        });
    }

    if (ticket.requesterFeedback && ticket.requesterFeedback.overallRating) {
      return res.status(409).json({
        success: false,
        message: "Feedback already submitted for this ticket.",
      });
    }

    await Feedback.create({
      request: request_id,
      user: req.user.id,
      rating: Number(rating),
      comment: comment || null,
    });

    /* Update ticket feedback fields */
    await Ticket.findByIdAndUpdate(request_id, {
      feedbackRating: Number(rating),
      feedbackComments: comment || null,
    });

    const displayId = displayTicketId(ticket.ticketId);
    const requesterName = req.user.fullName || "A requester";

    /* Notify assigned technician */
    if (ticket.assignedTechnician) {
      const techNotif = await Notification.create({
        user: ticket.assignedTechnician,
        ticket: ticket._id,
        title: `Feedback Available`,
        message: `${requesterName} rated your work on ticket #${displayId} with ${rating} star${rating > 1 ? "s" : ""}.`,
        type: rating >= 4 ? "success" : rating >= 3 ? "info" : "warning",
        notificationType: "feedback_available",
      });
      broadcastNotification(techNotif);
    }

    /* Notify ICT Admins */
    const admins = await User.find({ role: "ICT Admin", status: "active" })
      .select("_id")
      .lean();
    await Promise.all(
      admins.map(async (admin) => {
        const adminNotif = await Notification.create({
          user: admin._id,
          ticket: ticket._id,
          title: `Feedback Received: ${displayId}`,
          message: `${requesterName} submitted feedback (${rating} star${rating > 1 ? "s" : ""}) for ticket "${displayId}".`,
          type: "info",
          notificationType: "technician_activity",
        });
        broadcastNotification(adminNotif);
      }),
    );

    res
      .status(201)
      .json({ success: true, message: "Feedback submitted. Thank you!" });
  } catch (err) {
    next(err);
  }
};

const submitTechnicianFeedback = async (req, res, next) => {
  try {
    const category =
      typeof req.body.category === "string" ? req.body.category.trim() : "";
    const description =
      typeof req.body.description === "string"
        ? sanitizeString(req.body.description)
        : "";
    const recommendation =
      typeof req.body.recommendation === "string"
        ? sanitizeString(req.body.recommendation)
        : "";
    const rawTicketId = req.body.relatedRequestId ?? req.body.ticketId;
    const ticketId =
      typeof rawTicketId === "string" ? rawTicketId.trim() : "";
    const rawAssetId = req.body.assetId;
    const assetId =
      typeof rawAssetId === "string" ? rawAssetId.trim() : "";
    const errors = [];

    if (
      req.body.recommendation !== undefined &&
      req.body.recommendation !== null &&
      typeof req.body.recommendation !== "string"
    ) {
      errors.push("Recommendation must be text.");
    }
    if (!TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES.includes(category)) {
      errors.push("Choose a valid feedback category.");
    }
    if (!description) {
      errors.push("Feedback description is required.");
    } else {
      const lengthError = validateLength(description, "Feedback description", {
        min: 1,
        max: 2000,
      });
      if (lengthError) errors.push(lengthError);
    }
    const recommendationLengthError = validateLength(
      recommendation,
      "Recommendation",
      { max: 2000 },
    );
    if (recommendationLengthError) errors.push(recommendationLengthError);
    if (
      rawTicketId !== undefined &&
      rawTicketId !== null &&
      (typeof rawTicketId !== "string" || !ticketId || ticketId.length > 64)
    ) {
      errors.push("Related maintenance request is invalid.");
    }
    if (
      rawAssetId !== undefined &&
      rawAssetId !== null &&
      (typeof rawAssetId !== "string" || !assetId)
    ) {
      errors.push("Equipment or asset ID is invalid.");
    } else if (assetId) {
      const ticketIdError = validateObjectId(assetId, "Equipment or asset");
      if (ticketIdError) errors.push(ticketIdError);
    }
    const followUpRaw = req.body.followUpRequired;
    let followUpRequired;
    if (followUpRaw === true || followUpRaw === "Yes" || followUpRaw === "true") {
      followUpRequired = true;
    } else if (
      followUpRaw === false ||
      followUpRaw === "No" ||
      followUpRaw === "false"
    ) {
      followUpRequired = false;
    } else {
      errors.push("Choose whether follow-up is required.");
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(" ") });
    }

    let ticket = null;
    if (ticketId) {
      const ticketFilter = { assignedTechnician: req.user.id };
      if (validateObjectId(ticketId, "Maintenance request")) {
        ticketFilter.ticketId = ticketId;
      } else {
        ticketFilter._id = ticketId;
      }
      ticket = await Ticket.findOne(ticketFilter)
        .select("_id ticketId title assetId")
        .lean();
      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: "Maintenance request not found or is not assigned to you.",
        });
      }
    }

    if (assetId && ticket && String(ticket.assetId || "") !== assetId) {
      return res.status(400).json({
        success: false,
        message:
          "The selected asset is not linked to the assigned maintenance request.",
      });
    }
    const selectedAssetId = assetId || ticket?.assetId || null;
    if (assetId && !ticket) {
      const authorizedAsset = await Ticket.exists({
        assignedTechnician: req.user.id,
        assetId,
      });
      if (!authorizedAsset) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or is not assigned to you to maintain.",
        });
      }
    }

    const savedFeedback = await TechnicianFeedback.create({
      technician: req.user.id,
      technicianName: req.user.name || "",
      ticket: ticket?._id || null,
      asset: selectedAssetId,
      category,
      description,
      recommendation: recommendation || null,
      followUpRequired,
      submittedAt: new Date(),
      status: "Submitted",
    });

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully!",
      data: {
        id: savedFeedback._id,
        technicianId: savedFeedback.technician,
        technicianName: savedFeedback.technicianName,
        relatedRequestId: savedFeedback.ticket,
        ticketId: ticket ? displayTicketId(ticket.ticketId) : null,
        assetId: savedFeedback.asset,
        status: savedFeedback.status,
        submittedAt: savedFeedback.submittedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getTechnicianFeedback = async (req, res, next) => {
  try {
    const { category, status } = req.query;
    if (
      category &&
      !TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES.includes(category)
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid feedback category filter.",
      });
    }
    if (
      status &&
      !TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES.includes(status) &&
      !Object.hasOwn(LEGACY_TECHNICIAN_FEEDBACK_STATUS, status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid feedback status filter.",
      });
    }
    const filter = {};
    if (category) filter.category = category;
    if (status) {
      const matchingStatuses = [
        status,
        ...Object.entries(LEGACY_TECHNICIAN_FEEDBACK_STATUS)
          .filter(([, currentStatus]) => currentStatus === status)
          .map(([legacyStatus]) => legacyStatus),
      ];
      filter.status = { $in: matchingStatuses };
    }
    const records = await TechnicianFeedback.find(filter)
      .populate("technician", "fullName email department")
      .populate("ticket", "ticketId title category priority")
      .populate("asset", "asset_tag asset_name")
      .sort({ createdAt: -1 })
      .lean();
    const feedback = records.map(formatTechnicianFeedback);
    return res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
};

const getMyTechnicianFeedback = async (req, res, next) => {
  try {
    const records = await TechnicianFeedback.find({
      technician: req.user.id,
    })
      .populate("ticket", "ticketId title category priority")
      .populate("asset", "asset_tag asset_name")
      .sort({ createdAt: -1 })
      .lean();
    const feedback = records.map(formatTechnicianFeedback);
    return res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
};

const updateTechnicianFeedback = async (req, res, next) => {
  try {
    const idError = validateObjectId(req.params.id, "Feedback");
    if (idError) {
      return res.status(400).json({ success: false, message: idError });
    }

    const status = req.body.status;
    if (
      status !== undefined &&
      !TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid feedback status.",
      });
    }

    const rawReviewComments =
      req.body.reviewComments ?? req.body.adminResponse;
    let reviewComments;
    if (rawReviewComments !== undefined) {
      if (typeof rawReviewComments !== "string") {
        return res.status(400).json({
          success: false,
          message: "Review comments must be text.",
        });
      }
      reviewComments = sanitizeString(rawReviewComments);
      const lengthError = validateLength(
        reviewComments,
        "Review comments",
        { max: 2000 },
      );
      if (lengthError) {
        return res.status(400).json({ success: false, message: lengthError });
      }
    }
    if (status === undefined && rawReviewComments === undefined) {
      return res.status(400).json({
        success: false,
        message: "Provide a feedback status or review comments to update.",
      });
    }

    const update = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    };
    if (status !== undefined) update.status = status;
    if (reviewComments !== undefined) {
      update.reviewComments = reviewComments || null;
      update.adminResponse = reviewComments || null;
    }

    const feedback = await TechnicianFeedback.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    )
      .populate("technician", "fullName")
      .populate("ticket", "ticketId title")
      .populate("asset", "asset_tag asset_name")
      .lean();
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Technician feedback was not found.",
      });
    }

    try {
      const notification = await Notification.create({
        user: feedback.technician?._id || feedback.technician,
        ticket: feedback.ticket?._id || feedback.ticket || null,
        title: "Technician feedback reviewed",
        message: reviewComments
          ? "An ICT Admin added review comments to your feedback."
          : `Your feedback status was updated to ${status || feedback.status}.`,
        type: "info",
        notificationType: "technician_activity",
      });
      broadcastNotification(notification);
    } catch (notificationError) {
      console.error(
        "Unable to notify technician about feedback review:",
        notificationError.message,
      );
    }

    return res.json({
      success: true,
      message: "Technician feedback updated successfully.",
      data: formatTechnicianFeedback(feedback),
    });
  } catch (err) {
    next(err);
  }
};

function formatTechnicianFeedback(record) {
  const status =
    LEGACY_TECHNICIAN_FEEDBACK_STATUS[record.status] || record.status;
  return {
    ...record,
    status,
    technicianName:
      record.technician?.fullName || record.technicianName || null,
    technicianId: record.technician?._id || record.technician || null,
    description: record.description || record.message || "",
    recommendation: record.recommendation || null,
    reviewComments: record.reviewComments || record.adminResponse || null,
    submittedAt: record.submittedAt || record.createdAt,
    ticket: record.ticket
      ? {
          ...record.ticket,
          ticketId: displayTicketId(record.ticket.ticketId),
        }
      : null,
    asset: record.asset || null,
  };
}

module.exports = {
  getAllFeedback,
  submitFeedback,
  submitTechnicianFeedback,
  getTechnicianFeedback,
  getMyTechnicianFeedback,
  updateTechnicianFeedback,
};
