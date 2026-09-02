/**
 * controllers/assignmentController.js
 * Assignment management — ICT Admin assigns technicians to tickets
 */
const Assignment    = require('../models/Assignment');
const Ticket        = require('../models/Ticket');
const User          = require('../models/User');
const Technician    = require('../models/Technician');
const Notification  = require('../models/Notification');
const {
  validateObjectId, validateRequired, validateEnum, validateLength,
  sanitizeString, VALID_ASSIGN_STATUSES,
} = require('../middleware/validation');

const getAllAssignments = async (req, res, next) => {
  try {
    const list = await Assignment.find()
      .populate({ path: 'ticket',      select: 'ticketId status priority problemDescription equipmentType' })
      .populate({ path: 'technician',  populate: { path: 'user', select: 'fullName' } })
      .populate('assigned_by',         'fullName')
      .sort({ createdAt: -1 });

    const data = list.map(a => ({
      _id:              a._id,
      ticket_id:        a.ticket?._id,
      ticketId:         a.ticket?.ticketId,
      equipmentType:    a.ticket?.equipmentType,
      priority:         a.ticket?.priority,
      ticket_status:    a.ticket?.status,
      technician_id:    a.technician?._id,
      technician_name:  a.technician?.user?.fullName,
      assigned_by:      a.assigned_by?.fullName,
      notes:            a.notes,
      status:           a.status,
      assigned_at:      a.createdAt,
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const createAssignment = async (req, res, next) => {
  try {
    const { ticket_id, technician_id, notes } = req.body;

    const ticketErr = validateRequired(ticket_id, 'ticket_id');
    if (ticketErr) return res.status(422).json({ success: false, message: ticketErr });

    const techErr = validateRequired(technician_id, 'technician_id');
    if (techErr) return res.status(422).json({ success: false, message: techErr });

    const ticketIdErr = validateObjectId(ticket_id, 'Ticket');
    if (ticketIdErr) return res.status(400).json({ success: false, message: ticketIdErr });

    const techIdErr = validateObjectId(technician_id, 'Technician');
    if (techIdErr) return res.status(400).json({ success: false, message: techIdErr });

    /* Verify ticket exists */
    const ticket = await Ticket.findById(ticket_id).select('ticketId equipmentType priority status');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    /* Prevent re-assigning a ticket that is already finished */
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: `Cannot assign a ${ticket.status} ticket. Only open tickets can be assigned.`,
      });
    }

    /* Verify technician exists — technician_id is a Technician._id (separate collection) */
    const tech = await Technician.findById(technician_id).populate('user', 'fullName role status');
    if (!tech) {
      return res.status(400).json({ success: false, message: 'Invalid technician. Technician record not found.' });
    }

    if (!tech.user) {
      return res.status(400).json({ success: false, message: 'Invalid technician. Technician has no linked user account.' });
    }

    if (tech.user.role !== 'Technician') {
      return res.status(400).json({ success: false, message: 'Invalid technician. Linked user is not a technician.' });
    }

    if (tech.user.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Invalid technician. Technician account is not active.' });
    }

    const techUser = tech.user;

    /* Prevent assigning to the same technician if already assigned */
    if (ticket.status === 'assigned' || ticket.status === 'accepted' || ticket.status === 'in_progress') {
      const existing = await Assignment.findOne({ ticket: ticket_id, status: { $in: ['assigned', 'accepted', 'in_progress'] } })
        .populate({ path: 'technician', populate: { path: 'user', select: 'fullName' } });
      if (existing && existing.technician?._id?.toString() === technician_id) {
        return res.status(400).json({ success: false, message: `Ticket is already assigned to ${techUser.fullName}.` });
      }
    }

    /* Mark any previous active assignment as reassigned */
    await Assignment.updateMany(
      { ticket: ticket_id, status: { $in: ['assigned', 'accepted', 'in_progress'] } },
      { status: 'reassigned' }
    );

    await Assignment.create({
      ticket:     ticket_id,
      technician: technician_id,
      notes:      notes || null,
      assigned_by: req.user.id,
    });

    await Ticket.findByIdAndUpdate(ticket_id, { status: 'assigned', assignedTechnician: tech.user._id });

    /* Notify the technician (send to the User account linked to this Technician) */
    await Notification.create({
      user:    tech.user._id,
      ticket:  ticket._id,
      title:   `New Assignment: ${ticket.ticketId}`,
      message: `You have been assigned ticket "${ticket.ticketId}" (${ticket.equipmentType}). Priority: ${ticket.priority}.`,
      type:    'info',
    });

    /* Notify the requester */
    const ticketFull = await Ticket.findById(ticket_id).select('requester');
    if (ticketFull?.requester) {
      await Notification.create({
        user:    ticketFull.requester,
        ticket:  ticket_id,
        title:   `#${ticket.ticketId} — Assigned`,
        message: `Your service request #${ticket.ticketId} has been assigned to a technician.`,
        type:    'info',
      });
    }

    res.status(201).json({
      success: true,
      message: `Technician ${techUser.fullName} assigned successfully.`,
      data: {
        ticket_id,
        technician_id,
        technician_name: techUser.fullName,
        status: 'assigned',
      },
    });
  } catch (err) { next(err); }
};

const updateAssignmentStatus = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Assignment');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { status } = req.body;
    if (!status) {
      return res.status(422).json({ success: false, message: 'Status is required.' });
    }

    const statusErr = validateEnum(status, VALID_ASSIGN_STATUSES, 'status');
    if (statusErr) return res.status(400).json({ success: false, message: statusErr });

    /* A Technician may only update assignments that belong to them */
    if (req.user.role === 'Technician') {
      const assignment = await Assignment.findById(req.params.id).select('technician');
      if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

      const tech = await Technician.findOne({ user: req.user.id });
      if (!tech || !assignment.technician || assignment.technician.toString() !== tech._id.toString()) {
        return res.status(403).json({ success: false, message: 'You can only update your own assignments.' });
      }
    }

    const assignment = await Assignment.findByIdAndUpdate(
      req.params.id, { status }, { new: true, runValidators: true }
    );

    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    res.json({ success: true, message: 'Assignment status updated.' });
  } catch (err) { next(err); }
};

/* ── DELETE /api/assignments/:id — remove/cancel an assignment (admin only) ──
   Marks the assignment as removed, clears the ticket's assigned technician,
   and returns the ticket to a pre-assignment status without deleting the
   maintenance request itself. */
const removeAssignment = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Assignment');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    /* Remove this assignment (mark it so it no longer counts as active) */
    await Assignment.findByIdAndUpdate(assignment._id, { status: 'reassigned' }, { new: true, runValidators: true });

    const ticketId = assignment.ticket;

    /* Any other active assignment for this ticket keeps the technician assigned.
       Otherwise, unassign the ticket and return it to a pending state. */
    const otherActive = await Assignment.findOne({
      ticket: ticketId,
      status: { $in: ['assigned', 'accepted', 'in_progress'] },
    });
    if (!otherActive) {
      await Ticket.findByIdAndUpdate(ticketId, { assignedTechnician: null, status: 'submitted' });
    }

    res.json({ success: true, message: 'Assignment removed successfully.' });
  } catch (err) { next(err); }
};

module.exports = { getAllAssignments, createAssignment, updateAssignmentStatus, removeAssignment };
