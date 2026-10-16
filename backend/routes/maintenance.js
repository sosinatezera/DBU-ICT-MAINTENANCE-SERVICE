/**
 * routes/maintenance.js
 * Maintenance activity logs — technicians log repair actions
 */
const express = require("express");
const router = express.Router();
const MaintenanceRecord = require("../models/MaintenanceRecord");
const Technician = require("../models/Technician");
const Ticket = require("../models/Ticket");
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
/* Referenced below to notify every active ICT Admin, but was never imported —
   any request that reached that line threw `User is not defined`, which aborted
   the response with a 500 even though the maintenance record had already been
   saved. */
const User = require("../models/User");
const { broadcastNotification } = require("../services/notificationService");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  validateObjectId,
  validateRequired,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_MAINT_STATUS,
} = require("../middleware/validation");
const { displayTicketId } = require("../utils/ticketId");
const { sameMongoId } = require("../utils/mongoId");

/* GET /api/maintenance/my — my repair logs */
router.get("/my", authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === "ICT Admin";
    const tech = isAdmin ? null : await Technician.findOne({ user: req.user.id });
    if (!isAdmin && !tech) return res.json({ success: true, data: [] });

    const limit = isAdmin ? 30 : 20;
    const recordFilter = isAdmin ? {} : { technician: tech._id };
    const reportFilter = {
      "technicianFeedback.technicianConfirmed": true,
      ...(isAdmin
        ? {}
        : { "technicianFeedback.technician.technicianId": req.user.id }),
    };
    const [records, tickets] = await Promise.all([
      MaintenanceRecord.find(recordFilter)
      .populate({
        path: "request",
        select: "ticketId status equipmentType requester",
        populate: { path: "requester", select: "fullName" },
      })
      .populate({
        path: "technician",
        populate: { path: "user", select: "fullName email" },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
      Ticket.find(reportFilter)
        .select(
          "ticketId status equipmentType requester technicianFeedback createdAt updatedAt",
        )
        .populate({ path: "requester", select: "fullName" })
        .sort({ "technicianFeedback.submittedAt": -1 })
        .limit(limit)
        .lean(),
    ]);

    const activity = records.map((r) => ({
      _id: r._id,
      ticket_id: r.request?._id,
      ticketId: displayTicketId(r.request?.ticketId),
      ticket_status: r.request?.status,
      equipmentType: r.request?.equipmentType,
      requester_name: r.request?.requester?.fullName || null,
      action_taken: r.action_taken,
      diagnosis: r.diagnosis,
      parts_used: r.parts_used,
      notes: r.notes,
      status: r.status,
      technician_id: r.technician?._id || null,
      technician_user_id: r.technician?.user?._id || null,
      technician_name: r.technician?.user?.fullName,
      technician_email: r.technician?.user?.email || null,
      created_at: r.createdAt,
    }));
    tickets.forEach((ticket) => {
      const report = ticket.technicianFeedback;
      const resolved =
        report.repairResult === "Resolved" || report.status === "Fixed";
      activity.push({
        _id: `report-${ticket._id}`,
        ticket_id: ticket._id,
        ticketId: displayTicketId(ticket.ticketId),
        ticket_status: ticket.status,
        equipmentType: ticket.equipmentType,
        requester_name: ticket.requester?.fullName || null,
        action_taken: report.workPerformed,
        diagnosis: report.diagnosis,
        parts_used: report.partsUsed,
        notes: report.technicianNotes,
        time_spent_minutes: report.timeSpentMinutes,
        status: resolved ? "resolved" : "in_progress",
        report_status: report.status,
        technician_id: null,
        technician_user_id: report.technician?.technicianId || null,
        technician_name: report.technician?.technicianName || null,
        technician_email: null,
        created_at: report.submittedAt || ticket.updatedAt || ticket.createdAt,
        source: "technician-report",
      });
    });

    activity.sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    );
    res.json({ success: true, data: activity.slice(0, limit) });
  } catch (err) {
    next(err);
  }
});

/* GET /api/maintenance/:ticketId — repair logs for a ticket */
router.get("/:ticketId", authenticate, async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.ticketId, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.ticketId).select(
      "requester assignedTechnician",
    );
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    /* Role-based access — Admin: all, Technician: assigned only, others: own only */
    let allowed = req.user.role === "ICT Admin";
    if (!allowed)
      allowed =
        ticket.requester && String(ticket.requester) === String(req.user.id);
    if (!allowed && req.user.role === "Technician") {
      const tech = await Technician.findOne({ user: req.user.id });
      allowed =
        tech &&
        ((ticket.assignedTechnician &&
          String(ticket.assignedTechnician) === String(req.user.id)) ||
          (ticket.assignedTechnician &&
            sameMongoId(ticket.assignedTechnician, tech._id)) ||
          (await Assignment.exists({
            ticket: ticket._id,
            technician: tech._id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          })));
    }
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message:
          "You can only view maintenance logs for your own or assigned tickets.",
      });
    }

    const records = await MaintenanceRecord.find({
      request: req.params.ticketId,
    })
      .populate({
        path: "request",
        select: "requester",
        populate: { path: "requester", select: "fullName" },
      })
      .populate({
        path: "technician",
        populate: { path: "user", select: "fullName" },
      })
      .sort({ createdAt: "asc" });
    res.json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
});

/* POST /api/maintenance — log a repair action (Technician / ICT Admin) */
router.post(
  "/",
  authenticate,
  authorize("Technician", "ICT Admin"),
  async (req, res, next) => {
    try {
      const { request_id, action_taken, parts_used, notes, status } = req.body;

      const reqErr = validateRequired(request_id, "request_id");
      if (reqErr)
        return res.status(422).json({ success: false, message: reqErr });

      const actionErr = validateRequired(action_taken, "action_taken");
      if (actionErr)
        return res.status(422).json({ success: false, message: actionErr });

      const ticketIdErr = validateObjectId(request_id, "Ticket");
      if (ticketIdErr)
        return res.status(400).json({ success: false, message: ticketIdErr });

      if (action_taken) {
        const actionLenErr = validateLength(
          sanitizeString(action_taken),
          "Action taken",
          { min: 2, max: 1000 },
        );
        if (actionLenErr)
          return res
            .status(400)
            .json({ success: false, message: actionLenErr });
      }

      if (status) {
        const statusErr = validateEnum(status, VALID_MAINT_STATUS, "status");
        if (statusErr)
          return res.status(400).json({ success: false, message: statusErr });
      }

      const tech = await Technician.findOne({ user: req.user.id });
      if (!tech) {
        return res
          .status(404)
          .json({ success: false, message: "Technician profile not found." });
      }

      /* A Technician may only log maintenance for a ticket that is actually assigned to them */
      if (req.user.role === "Technician") {
        const ticket =
          await Ticket.findById(request_id).select("assignedTechnician");
        if (!ticket)
          return res
            .status(404)
            .json({ success: false, message: "Ticket not found." });

        const activeAssignment = await Assignment.exists({
          ticket: ticket._id,
          technician: tech._id,
          status: { $in: ["assigned", "accepted", "in_progress"] },
        });
        const isAssigned =
          activeAssignment ||
          sameMongoId(ticket.assignedTechnician, req.user.id) ||
          sameMongoId(ticket.assignedTechnician, tech._id);

        if (!isAssigned) {
          return res.status(403).json({
            success: false,
            message:
              "This ticket is not assigned to your technician account. Ask an ICT Admin to assign it to you or manage the ticket.",
          });
        }
      }

      const record = await MaintenanceRecord.create({
        request: request_id,
        technician: tech._id,
        action_taken: sanitizeString(action_taken),
        parts_used: parts_used || null,
        notes: notes || null,
        status: status || "in_progress",
      });

      const ticket = await Ticket.findById(request_id).select(
        "ticketId requester assignedTechnician equipmentType",
      );
      if (ticket) {
        const displayId = displayTicketId(ticket.ticketId);
        const techName = req.user.fullName || "A technician";

        /* Notify the requester */
        if (ticket.requester) {
          const requesterNotif = await Notification.create({
            user: ticket.requester,
            ticket: ticket._id,
            title: `Maintenance Update: ${displayId}`,
            message: `${techName} logged maintenance activity on your request #${displayId}.`,
            type: "info",
          });
          broadcastNotification(requesterNotif);
        }

        /* Notify ICT Admins */
        const admins = await User.find({
          role: "ICT Admin",
          status: "active",
        }).select("_id");
        await Promise.all(
          admins.map(async (admin) => {
            const adminNotif = await Notification.create({
              user: admin._id,
              ticket: ticket._id,
              title: `Maintenance Logged: ${displayId}`,
              message: `${techName} logged maintenance activity on ticket "${displayId}".`,
              type: "info",
            });
            broadcastNotification(adminNotif);
          }),
        );
      }

      res
        .status(201)
        .json({ success: true, message: "Activity logged.", id: record._id });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
