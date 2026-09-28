/**
 * controllers/assignmentController.js
 * Assignment management — ICT Admin assigns technicians to tickets
 */
const Assignment = require("../models/Assignment");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const Technician = require("../models/Technician");
const Notification = require("../models/Notification");
const { sendEventEmail } = require("../services/mailer");
const { broadcastNotification } = require("../services/notificationService");
const { displayTicketId } = require("../utils/ticketId");
const {
  validateObjectId,
  validateRequired,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_ASSIGN_STATUSES,
  VALID_PRIORITIES,
} = require("../middleware/validation");

const getAllAssignments = async (req, res, next) => {
  try {
    const list = await Assignment.find()
      .populate({
        path: "ticket",
        select: "ticketId status priority problemDescription equipmentType",
      })
      .populate({
        path: "technician",
        populate: { path: "user", select: "fullName" },
      })
      .populate("assigned_by", "fullName")
      .sort({ createdAt: -1 })
      .lean();

    const data = list.map((a) => ({
      _id: a._id,
      ticket_id: a.ticket?._id,
      ticketId: displayTicketId(a.ticket?.ticketId),
      equipmentType: a.ticket?.equipmentType,
      priority: a.ticket?.priority,
      ticket_status: a.ticket?.status,
      technician_id: a.technician?._id,
      technician_name: a.technician?.user?.fullName,
      assigned_by: a.assigned_by?.fullName,
      notes: a.notes,
      status: a.status,
      assigned_at: a.createdAt,
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const createAssignment = async (req, res, next) => {
  try {
    const { ticket_id, technician_id, notes, priority } = req.body;

    const ticketErr = validateRequired(ticket_id, "ticket_id");
    if (ticketErr)
      return res.status(422).json({ success: false, message: ticketErr });

    const techErr = validateRequired(technician_id, "technician_id");
    if (techErr)
      return res.status(422).json({ success: false, message: techErr });

    const ticketIdErr = validateObjectId(ticket_id, "Ticket");
    if (ticketIdErr)
      return res.status(400).json({ success: false, message: ticketIdErr });

    const techIdErr = validateObjectId(technician_id, "Technician");
    if (techIdErr)
      return res.status(400).json({ success: false, message: techIdErr });

    const priorityErr =
      priority !== undefined
        ? validateEnum(priority, VALID_PRIORITIES, "priority")
        : null;
    if (priorityErr)
      return res.status(400).json({ success: false, message: priorityErr });

    /* Verify ticket exists */
    const ticket = await Ticket.findById(ticket_id).select(
      "ticketId equipmentType priority status requester",
    );
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    const assignmentPriority = priority || ticket.priority || "medium";

    /* Prevent re-assigning a ticket that is already finished */
    if (ticket.status === "resolved" || ticket.status === "closed") {
      return res.status(400).json({
        success: false,
        message: `Cannot assign a ${ticket.status} ticket. Only open tickets can be assigned.`,
      });
    }

    /* Verify technician exists — technician_id is a Technician._id (separate collection) */
    const tech = await Technician.findById(technician_id).populate(
      "user",
      "fullName role status email",
    );
    if (!tech) {
      return res.status(400).json({
        success: false,
        message: "Invalid technician. Technician record not found.",
      });
    }

    if (!tech.user) {
      return res.status(400).json({
        success: false,
        message: "Invalid technician. Technician has no linked user account.",
      });
    }

    if (tech.user.role !== "Technician") {
      return res.status(400).json({
        success: false,
        message: "Invalid technician. Linked user is not a technician.",
      });
    }

    if (tech.user.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Invalid technician. Technician account is not active.",
      });
    }

    const techUser = tech.user;

    /* Prevent assigning to the same technician if already assigned */
    if (
      ticket.status === "assigned" ||
      ticket.status === "accepted" ||
      ticket.status === "in_progress"
    ) {
      const existing = await Assignment.findOne({
        ticket: ticket_id,
        status: { $in: ["assigned", "accepted", "in_progress"] },
      }).populate({
        path: "technician",
        populate: { path: "user", select: "fullName" },
      });
      if (existing && existing.technician?._id?.toString() === technician_id) {
        return res.status(400).json({
          success: false,
          message: `Ticket is already assigned to ${techUser.fullName}.`,
        });
      }
    }

    /* Mark any previous active assignment as reassigned */
    await Assignment.updateMany(
      {
        ticket: ticket_id,
        status: { $in: ["assigned", "accepted", "in_progress"] },
      },
      { status: "reassigned" },
    );

    await Assignment.create({
      ticket: ticket_id,
      technician: technician_id,
      notes: notes || null,
      assigned_by: req.user.id,
    });

    await Ticket.findByIdAndUpdate(ticket_id, {
      status: "assigned",
      assignedTechnician: tech.user._id,
      priority: assignmentPriority,
    });

    const displayId = displayTicketId(ticket.ticketId);

    /* Notify the technician (send to the User account linked to this Technician) */
    const techNotif = await Notification.create({
      user: tech.user._id,
      ticket: ticket._id,
      title: `New Request Assigned`,
      message: `You have been assigned ticket "${displayId}" (${ticket.equipmentType}). Priority: ${ticket.priority}.`,
      type: "info",
      notificationType: "new_request_assigned",
    });
    broadcastNotification(techNotif);

    /* Optional email to the technician (best-effort, never blocks the flow) */
    if (techUser.email) {
      sendEventEmail({
        to: techUser.email,
        subject: `New assignment — ticket ${displayId}`,
        text: `Hi ${techUser.fullName || "there"},\n\nYou have been assigned ticket "${displayId}" (${ticket.equipmentType}).\nPriority: ${ticket.priority}. Please log in to the portal to review it.\n\nSmart ICT Maintenance Management System`,
        html: `<p>Hi ${techUser.fullName || "there"},</p><p>You have been assigned ticket <strong>${displayId}</strong> (${ticket.equipmentType}).</p><p>Priority: <strong>${ticket.priority}</strong>.</p><p>Log in to the portal to review it.</p><p style="color:#888;">Smart ICT Maintenance Management System</p>`,
      }).catch(() => {}); /* email is best-effort only */
    }

    /* Notify the requester */
    if (ticket?.requester) {
      const requesterNotif = await Notification.create({
        user: ticket.requester,
        ticket: ticket_id,
        title: `Technician Assigned`,
        message: `Your service request #${displayId} has been assigned to a technician.`,
        type: "info",
        notificationType: "technician_assigned",
      });
      broadcastNotification(requesterNotif);

      /* Optional email to the requester — the user lookup runs off the request
         path so the assignment response is never delayed by e-mail. */
      const requesterId = ticket.requester;
      const subjectText = `Ticket ${displayId} assigned — Smart ICT Maintenance Management System`;
      const notifyRequesterByEmail = async () => {
        const u = await User.findById(requesterId).select("email");
        if (!u || !u.email)
          return { delivered: false, info: "Requester has no email." };
        return sendEventEmail({
          to: u.email,
          subject: subjectText,
          text: `Your service request #${displayId} has been assigned to a technician.\n\nYou can track its progress on the portal using ticket ID ${displayId}.\n\nSmart ICT Maintenance Management System`,
          html: `<p>Your service request <strong>#${displayId}</strong> has been assigned to a technician.</p><p>Track its progress on the portal with ticket ID <strong>${displayId}</strong>.</p><p style="color:#888;">Smart ICT Maintenance Management System</p>`,
        });
      };
      notifyRequesterByEmail().catch(() => {}); /* email is best-effort only */
    }

    res.status(201).json({
      success: true,
      message: `Technician ${techUser.fullName} assigned successfully.`,
      data: {
        ticket_id,
        technician_id,
        technician_name: techUser.fullName,
        status: "assigned",
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateAssignmentStatus = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Assignment");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { status } = req.body;
    if (!status) {
      return res
        .status(422)
        .json({ success: false, message: "Status is required." });
    }

    const statusErr = validateEnum(status, VALID_ASSIGN_STATUSES, "status");
    if (statusErr)
      return res.status(400).json({ success: false, message: statusErr });

    /* A Technician may only update assignments that belong to them */
    if (req.user.role === "Technician") {
      const assignment = await Assignment.findById(req.params.id).select(
        "technician",
      );
      if (!assignment)
        return res
          .status(404)
          .json({ success: false, message: "Assignment not found." });

      const tech = await Technician.findOne({ user: req.user.id });
      if (
        !tech ||
        !assignment.technician ||
        assignment.technician.toString() !== tech._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own assignments.",
        });
      }
    }

    const assignment = await Assignment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true },
    );

    if (!assignment)
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });

    res.json({ success: true, message: "Assignment status updated." });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/assignments/:id — remove/cancel an assignment (admin only) ──
   Marks the assignment as removed, clears the ticket's assigned technician,
   and returns the ticket to a pre-assignment status without deleting the
   maintenance request itself. */
const removeAssignment = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Assignment");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const assignment = await Assignment.findById(req.params.id)
      .populate({ path: "ticket", select: "ticketId equipmentType" })
      .populate({
        path: "technician",
        populate: { path: "user", select: "_id fullName" },
      });
    if (!assignment)
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });

    const ticket = assignment.ticket;
    const techUser = assignment.technician?.user;
    const displayId = displayTicketId(ticket?.ticketId);

    /* Remove this assignment (mark it so it no longer counts as active) */
    await Assignment.findByIdAndUpdate(
      assignment._id,
      { status: "reassigned" },
      { new: true, runValidators: true },
    );

    const ticketId = assignment.ticket;

    /* Any other active assignment for this ticket keeps the technician assigned.
       Otherwise, unassign the ticket and return it to a pending state. */
    const otherActive = await Assignment.findOne({
      ticket: ticketId,
      status: { $in: ["assigned", "accepted", "in_progress"] },
    });
    if (!otherActive) {
      await Ticket.findByIdAndUpdate(ticketId, {
        assignedTechnician: null,
        status: "submitted",
      });
    }

    /* Notify the technician that their assignment was removed */
    if (techUser) {
      const techNotif = await Notification.create({
        user: techUser._id,
        ticket: ticketId,
        title: `Request Reassigned`,
        message: `You have been unassigned from ticket "${displayId}" (${ticket?.equipmentType}).`,
        type: "warning",
        notificationType: "request_reassigned",
      });
      broadcastNotification(techNotif);
    }

    /* Notify the requester */
    const ticketDoc = await Ticket.findById(ticketId).select("requester");
    if (ticketDoc?.requester) {
      const requesterNotif = await Notification.create({
        user: ticketDoc.requester,
        ticket: ticketId,
        title: `Technician Reassigned`,
        message: `Your service request #${displayId} has been reassigned to another technician.`,
        type: "info",
        notificationType: "request_reopened",
      });
      broadcastNotification(requesterNotif);
    }

    res.json({ success: true, message: "Assignment removed successfully." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllAssignments,
  createAssignment,
  updateAssignmentStatus,
  removeAssignment,
};
