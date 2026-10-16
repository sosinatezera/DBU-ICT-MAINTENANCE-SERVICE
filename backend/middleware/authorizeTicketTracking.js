const Ticket = require("../models/Ticket");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const { ticketCodeMatchQuery } = require("../utils/ticketId");
const { sameMongoId } = require("../utils/mongoId");

const ACTIVE_ASSIGNMENT_STATUSES = [
  "assigned",
  "accepted",
  "in_progress",
  "completed",
];

const authorizeTicketTracking = async (req, res, next) => {
  try {
    const match = ticketCodeMatchQuery(req.params.ticketId);
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const ticket = await Ticket.findOne(match)
      .select("_id requester assignedTechnician")
      .lean();
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    if (req.user.role === "ICT Admin") return next();

    if (
      req.user.role === "Requester" &&
      sameMongoId(ticket.requester, req.user.id)
    ) {
      return next();
    }

    if (req.user.role === "Technician") {
      const technician = await Technician.findOne({ user: req.user.id })
        .select("_id")
        .lean();
      if (
        sameMongoId(ticket.assignedTechnician, req.user.id) ||
        (technician &&
          sameMongoId(ticket.assignedTechnician, technician._id)) ||
        (technician &&
          (await Assignment.exists({
            ticket: ticket._id,
            technician: technician._id,
            status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
          })))
      ) {
        return next();
      }
    }

    return res
      .status(404)
      .json({ success: false, message: "Ticket not found." });
  } catch (err) {
    next(err);
  }
};

module.exports = { authorizeTicketTracking };
