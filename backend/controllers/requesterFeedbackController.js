const Assignment = require("../models/Assignment");
const RequesterFeedback = require("../models/RequesterFeedback");
const Ticket = require("../models/Ticket");
const mongoose = require("mongoose");

const COMPLETED_TICKET_STATUSES = ["resolved", "closed"];
const FEEDBACK_STATUSES = ["Submitted", "Reviewed", "Follow-up Required"];
const MAX_TEXT_LENGTH = 2000;

function feedbackError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function normalizeRating(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return NaN;
}

async function resolveAssignedTechnician(ticket) {
  const assignment = await Assignment.findOne({
    ticket: ticket._id,
    status: { $ne: "reassigned" },
  })
    .sort({ createdAt: -1 })
    .populate({
      path: "technician",
      select: "user",
      populate: { path: "user", select: "fullName email role" },
    })
    .lean();

  const assignmentUser = assignment?.technician?.user;
  if (assignmentUser?.role === "Technician") return assignmentUser;

  const ticketUser = ticket.assignedTechnician;
  if (ticketUser?.role === "Technician") return ticketUser;
  return null;
}

async function formatEligibleTicket(ticket, alreadySubmittedIds) {
  if (alreadySubmittedIds.has(String(ticket._id))) return null;
  const technician = await resolveAssignedTechnician(ticket);
  if (!technician) return null;
  return {
    id: String(ticket._id),
    ticketId: ticket.ticketId,
    title: ticket.title || ticket.problemDescription || "Maintenance request",
    completedAt: ticket.updatedAt || ticket.createdAt,
    technician: {
      id: String(technician._id),
      name: technician.fullName || "Assigned technician",
    },
  };
}

const getEligibleRequests = async (req, res, next) => {
  try {
    const [tickets, submittedTicketIds] = await Promise.all([
      Ticket.find({
        requester: req.user.id,
        status: { $in: COMPLETED_TICKET_STATUSES },
      })
        .populate("assignedTechnician", "fullName role")
        .sort({ updatedAt: -1 })
        .lean(),
      RequesterFeedback.distinct("ticket", { requester: req.user.id }),
    ]);
    const submittedIds = new Set(submittedTicketIds.map(String));
    const formatted = await Promise.all(
      tickets.map((ticket) => formatEligibleTicket(ticket, submittedIds)),
    );
    return res.json({ success: true, data: formatted.filter(Boolean) });
  } catch (error) {
    return next(error);
  }
};

const submitRequesterFeedback = async (req, res, next) => {
  try {
    const {
      ticketId,
      problemFixed,
      equipmentWorkingProperly,
      technicianRating,
      satisfactionRating,
      comments = "",
      improvementSuggestions = "",
    } = req.body;

    if (typeof ticketId !== "string" || !ticketId.trim()) {
      return feedbackError(res, 400, "Select a completed maintenance request.");
    }
    if (!["Yes", "Partially", "No"].includes(problemFixed)) {
      return feedbackError(res, 400, "Choose whether the problem was fixed.");
    }
    if (!["Yes", "No"].includes(equipmentWorkingProperly)) {
      return feedbackError(res, 400, "Choose whether the equipment works properly.");
    }

    const techRating = normalizeRating(technicianRating);
    const satisfaction = normalizeRating(satisfactionRating);
    if (!Number.isInteger(techRating) || techRating < 1 || techRating > 5) {
      return feedbackError(res, 400, "Choose a technician rating from 1 to 5 stars.");
    }
    if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
      return feedbackError(res, 400, "Choose an overall satisfaction rating from 1 to 5 stars.");
    }
    if (
      typeof comments !== "string" ||
      typeof improvementSuggestions !== "string"
    ) {
      return feedbackError(res, 400, "Comments and suggestions must be text.");
    }
    if (comments.trim().length > MAX_TEXT_LENGTH) {
      return feedbackError(res, 400, "Comments must be 2,000 characters or fewer.");
    }
    if (improvementSuggestions.trim().length > MAX_TEXT_LENGTH) {
      return feedbackError(res, 400, "Improvement suggestions must be 2,000 characters or fewer.");
    }
    const normalizedComments = comments.trim();
    if (
      (problemFixed !== "Yes" || equipmentWorkingProperly === "No") &&
      !normalizedComments
    ) {
      return feedbackError(
        res,
        400,
        "Please explain what remains unresolved or what is not working properly.",
      );
    }

    const normalizedTicketId = ticketId.trim().toUpperCase();
    const ticketQuery = mongoose.isValidObjectId(normalizedTicketId)
      ? {
          _id: normalizedTicketId,
          requester: req.user.id,
          status: { $in: COMPLETED_TICKET_STATUSES },
        }
      : {
          ticketId: normalizedTicketId,
          requester: req.user.id,
          status: { $in: COMPLETED_TICKET_STATUSES },
        };
    const ticket = await Ticket.findOne(ticketQuery)
      .populate("assignedTechnician", "fullName role")
      .lean();
    if (!ticket) {
      return feedbackError(
        res,
        404,
        "That completed request is unavailable for feedback.",
      );
    }
    const technician = await resolveAssignedTechnician(ticket);
    if (!technician) {
      return feedbackError(
        res,
        400,
        "This request does not have a verified assigned technician.",
      );
    }

    try {
      await RequesterFeedback.init();
      const existingFeedback = await RequesterFeedback.exists({
        ticket: ticket._id,
      });
      if (existingFeedback) {
        return feedbackError(
          res,
          409,
          "Feedback has already been submitted for this maintenance request.",
        );
      }
      const feedback = await RequesterFeedback.create({
        ticket: ticket._id,
        requester: req.user.id,
        technician: technician._id,
        problemFixed,
        equipmentWorkingProperly,
        technicianRating: techRating,
        satisfactionRating: satisfaction,
        comments: normalizedComments,
        improvementSuggestions: improvementSuggestions.trim(),
      });
      return res.status(201).json({
        success: true,
        message: "Thank you. Your feedback has been submitted.",
        data: {
          id: feedback._id,
          ticketId: ticket.ticketId,
          status: feedback.status,
          createdAt: feedback.createdAt,
        },
      });
    } catch (error) {
      if (error?.code === 11000) {
        return feedbackError(
          res,
          409,
          "Feedback has already been submitted for this maintenance request.",
        );
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
};

const getMyRequesterFeedback = async (req, res, next) => {
  try {
    const feedback = await RequesterFeedback.find({ requester: req.user.id })
      .sort({ createdAt: -1 })
      .populate("ticket", "ticketId title problemDescription")
      .populate("technician", "fullName")
      .select("-requester -__v")
      .lean();
    return res.json({ success: true, data: feedback });
  } catch (error) {
    return next(error);
  }
};

const getAdminRequesterFeedback = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (req.query.status) {
      if (!FEEDBACK_STATUSES.includes(req.query.status)) {
        return feedbackError(res, 400, "Choose a valid feedback status.");
      }
      filter.status = req.query.status;
    }

    const [data, total] = await Promise.all([
      RequesterFeedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("requester", "fullName email department")
        .populate("technician", "fullName email")
        .populate("ticket", "ticketId title problemDescription")
        .select("-__v")
        .lean(),
      RequesterFeedback.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
};

const updateRequesterFeedbackReview = async (req, res, next) => {
  try {
    const { status, adminReviewComments = "" } = req.body;
    if (!FEEDBACK_STATUSES.includes(status)) {
      return feedbackError(res, 400, "Choose a valid feedback status.");
    }
    if (
      typeof adminReviewComments !== "string" ||
      adminReviewComments.trim().length > MAX_TEXT_LENGTH
    ) {
      return feedbackError(
        res,
        400,
        "Review comments must be 2,000 characters or fewer.",
      );
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return feedbackError(res, 400, "Invalid feedback record.");
    }

    const feedback = await RequesterFeedback.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status,
          adminReviewComments: adminReviewComments.trim(),
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    );
    if (!feedback) return feedbackError(res, 404, "Feedback record not found.");
    return res.json({
      success: true,
      message: "Feedback review status updated.",
      data: { id: feedback._id, status: feedback.status },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEligibleRequests,
  submitRequesterFeedback,
  getMyRequesterFeedback,
  getAdminRequesterFeedback,
  updateRequesterFeedbackReview,
};
