/**
 * controllers/feedbackController.js
 * Feedback — requesters rate resolved tickets
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
  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS,
} = require("../utils/technicianFeedbackCategories");

/* Escape a string for safe use inside a RegExp (user-supplied filters). */
const escapeRegExp = (s) =>
  String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

    /* Date range on when the feedback was submitted. */
    if (from || to) {
      filter.createdAt = {};
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
          "ticketId problemDescription status equipmentType department requester assignedTechnician adminFeedback.adminId",
        populate: [
          { path: "requester", select: "fullName" },
          { path: "assignedTechnician", select: "fullName" },
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
    if (
      String(ticket.requester) !== String(req.user.id) &&
      req.user.role !== "ICT Admin"
    ) {
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
    const categoryGroup =
      typeof req.body.categoryGroup === "string"
        ? req.body.categoryGroup.trim()
        : "";
    const category =
      typeof req.body.category === "string" ? req.body.category.trim() : "";
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";
    const rawTicketId = req.body.ticketId;
    const ticketIdProvided =
      rawTicketId !== undefined && rawTicketId !== null && rawTicketId !== "";
    const ticketId =
      typeof rawTicketId === "string" ? rawTicketId.trim() : "";
    const errors = [];

    const categoryGroupDefinition = TECHNICIAN_FEEDBACK_CATEGORY_GROUPS.find(
      (group) => group.group === categoryGroup,
    );
    if (!categoryGroupDefinition?.categories.includes(category)) {
      errors.push("Choose a valid feedback category.");
    }
    if (!message) {
      errors.push("Feedback message is required.");
    } else {
      const lengthError = validateLength(message, "Feedback message", {
        min: 1,
        max: 2000,
      });
      if (lengthError) errors.push(lengthError);
    }

    let rating = null;
    if (
      req.body.rating !== undefined &&
      req.body.rating !== null &&
      req.body.rating !== ""
    ) {
      const rawRating = req.body.rating;
      rating =
        typeof rawRating === "number" || typeof rawRating === "string"
          ? Number(rawRating)
          : NaN;
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        errors.push("Rating must be a whole number from 1 to 5.");
      }
    }
    if (ticketIdProvided && (typeof rawTicketId !== "string" || !ticketId)) {
      errors.push("Related maintenance request is invalid.");
    } else if (ticketId) {
      const ticketIdError = validateObjectId(ticketId, "Maintenance request");
      if (ticketIdError) errors.push(ticketIdError);
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(" ") });
    }

    let ticket = null;
    if (ticketId) {
      ticket = await Ticket.findOne({
        _id: ticketId,
        assignedTechnician: req.user.id,
      })
        .select("_id")
        .lean();
      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: "Maintenance request not found or is not assigned to you.",
        });
      }
    }

    const savedFeedback = await TechnicianFeedback.create({
      technician: req.user.id,
      ticket: ticket?._id || null,
      categoryGroup,
      category,
      message,
      rating,
    });

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully!",
      data: { id: savedFeedback._id, createdAt: savedFeedback.createdAt },
    });
  } catch (err) {
    next(err);
  }
};

const getTechnicianFeedback = async (req, res, next) => {
  try {
    const records = await TechnicianFeedback.find()
      .populate("technician", "fullName email department")
      .populate("ticket", "ticketId title category priority")
      .sort({ createdAt: -1 })
      .lean();
    const feedback = records.map((record) => ({
      ...record,
      ticket: record.ticket
        ? {
            ...record.ticket,
            ticketId: displayTicketId(record.ticket.ticketId),
          }
        : null,
    }));
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
      .sort({ createdAt: -1 })
      .lean();
    const feedback = records.map((record) => ({
      ...record,
      ticket: record.ticket
        ? {
            ...record.ticket,
            ticketId: displayTicketId(record.ticket.ticketId),
          }
        : null,
    }));
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
    if (!["Pending", "Reviewed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid feedback status.",
      });
    }

    let adminResponse;
    if (req.body.adminResponse !== undefined) {
      if (typeof req.body.adminResponse !== "string") {
        return res.status(400).json({
          success: false,
          message: "Administrator response must be text.",
        });
      }
      adminResponse = sanitizeString(req.body.adminResponse);
      const lengthError = validateLength(
        adminResponse,
        "Administrator response",
        { max: 2000 },
      );
      if (lengthError) {
        return res.status(400).json({ success: false, message: lengthError });
      }
    }

    const update = {
      status,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    };
    if (adminResponse !== undefined) {
      update.adminResponse = adminResponse || null;
    }

    const feedback = await TechnicianFeedback.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    )
      .populate("technician", "fullName")
      .lean();
    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Technician feedback was not found.",
      });
    }

    try {
      const notification = await Notification.create({
        user: feedback.technician._id,
        ticket: feedback.ticket || null,
        title: "Technician feedback reviewed",
        message: adminResponse
          ? "An ICT Admin responded to your feedback."
          : `Your feedback status was updated to ${status}.`,
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
      data: {
        id: feedback._id,
        status: feedback.status,
        adminResponse: feedback.adminResponse,
        reviewedAt: feedback.reviewedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllFeedback,
  submitFeedback,
  submitTechnicianFeedback,
  getTechnicianFeedback,
  getMyTechnicianFeedback,
  updateTechnicianFeedback,
};
