/**
 * controllers/feedbackController.js
 * Technician feedback management.
 */
const TechnicianFeedback = require("../models/TechnicianFeedback");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { broadcastNotification } = require("../services/notificationService");
const {
  validateObjectId,
  validateRequired,
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
  submitTechnicianFeedback,
  getTechnicianFeedback,
  getMyTechnicianFeedback,
  updateTechnicianFeedback,
};
