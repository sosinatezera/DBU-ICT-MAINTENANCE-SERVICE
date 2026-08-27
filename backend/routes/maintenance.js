/**
 * routes/maintenance.js
 * Maintenance activity logs — technicians log repair actions
 */
const express           = require('express');
const router            = express.Router();
const MaintenanceRecord = require('../models/MaintenanceRecord');
const Technician        = require('../models/Technician');
const Ticket            = require('../models/Ticket');
const Assignment        = require('../models/Assignment');
const { authenticate }  = require('../middleware/auth');
const { authorize }     = require('../middleware/authorize');
const {
  validateObjectId, validateRequired, validateEnum, validateLength,
  sanitizeString, VALID_MAINT_STATUS,
} = require('../middleware/validation');

/* GET /api/maintenance/my — my repair logs */
router.get('/my', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'ICT Admin') {
      const records = await MaintenanceRecord.find()
        .populate('request',    'ticketId status equipmentType')
        .populate({ path: 'technician', populate: { path: 'user', select: 'fullName' } })
        .sort({ createdAt: -1 }).limit(30);

      return res.json({ success: true, data: records.map(r => ({
        _id:              r._id,
        ticket_id:        r.request?._id,
        ticketId:         r.request?.ticketId,
        ticket_status:    r.request?.status,
        equipmentType:    r.request?.equipmentType,
        action_taken:     r.action_taken,
        parts_used:       r.parts_used,
        notes:            r.notes,
        status:           r.status,
        technician_name:  r.technician?.user?.fullName,
        created_at:       r.createdAt,
      })) });
    }

    const tech = await Technician.findOne({ user: req.user.id });
    if (!tech) return res.json({ success: true, data: [] });

    const records = await MaintenanceRecord.find({ technician: tech._id })
      .populate('request', 'ticketId status equipmentType')
      .sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, data: records.map(r => ({
      _id:              r._id,
      ticket_id:        r.request?._id,
      ticketId:         r.request?.ticketId,
      ticket_status:    r.request?.status,
      equipmentType:    r.request?.equipmentType,
      action_taken:     r.action_taken,
      parts_used:       r.parts_used,
      notes:            r.notes,
      status:           r.status,
      created_at:       r.createdAt,
    })) });
  } catch (err) { next(err); }
});

/* GET /api/maintenance/:ticketId — repair logs for a ticket */
router.get('/:ticketId', authenticate, async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.ticketId, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.ticketId).select('requester assignedTechnician');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    /* Role-based access — Admin: all, Technician: assigned only, others: own only */
    let allowed = req.user.role === 'ICT Admin';
    if (!allowed) allowed = ticket.requester && String(ticket.requester) === String(req.user.id);
    if (!allowed && req.user.role === 'Technician') {
      const tech = await Technician.findOne({ user: req.user.id });
      allowed = tech && (
        (ticket.assignedTechnician && String(ticket.assignedTechnician) === String(req.user.id)) ||
        (await Assignment.exists({
          ticket: ticket._id,
          technician: tech._id,
          status: { $in: ['assigned', 'accepted', 'in_progress'] },
        }))
      );
    }
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'You can only view maintenance logs for your own or assigned tickets.' });
    }

    const records = await MaintenanceRecord.find({ request: req.params.ticketId })
      .populate({ path: 'technician', populate: { path: 'user', select: 'fullName' } })
      .sort({ createdAt: 'asc' });
    res.json({ success: true, data: records });
  } catch (err) { next(err); }
});

/* POST /api/maintenance — log a repair action (Technician / ICT Admin) */
router.post('/', authenticate, authorize('Technician', 'ICT Admin'), async (req, res, next) => {
  try {
    const { request_id, action_taken, parts_used, notes, status } = req.body;

    const reqErr = validateRequired(request_id, 'request_id');
    if (reqErr) return res.status(422).json({ success: false, message: reqErr });

    const actionErr = validateRequired(action_taken, 'action_taken');
    if (actionErr) return res.status(422).json({ success: false, message: actionErr });

    const ticketIdErr = validateObjectId(request_id, 'Ticket');
    if (ticketIdErr) return res.status(400).json({ success: false, message: ticketIdErr });

    if (action_taken) {
      const actionLenErr = validateLength(sanitizeString(action_taken), 'Action taken', { min: 2, max: 1000 });
      if (actionLenErr) return res.status(400).json({ success: false, message: actionLenErr });
    }

    if (status) {
      const statusErr = validateEnum(status, VALID_MAINT_STATUS, 'status');
      if (statusErr) return res.status(400).json({ success: false, message: statusErr });
    }

    const tech = await Technician.findOne({ user: req.user.id });
    if (!tech) {
      return res.status(404).json({ success: false, message: 'Technician profile not found.' });
    }

    /* A Technician may only log maintenance for a ticket that is actually assigned to them */
    if (req.user.role === 'Technician') {
      const ticket = await Ticket.findById(request_id).select('assignedTechnician');
      if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

      const activeAssignment = await Assignment.exists({
        ticket: ticket._id,
        technician: tech._id,
        status: { $in: ['assigned', 'accepted', 'in_progress'] },
      });
      const isAssigned =
        activeAssignment ||
        (ticket.assignedTechnician && ticket.assignedTechnician.toString() === req.user.id);

      if (!isAssigned) {
        return res.status(403).json({ success: false, message: 'You can only log maintenance for tickets assigned to you.' });
      }
    }

    const record = await MaintenanceRecord.create({
      request:    request_id,
      technician: tech._id,
      action_taken: sanitizeString(action_taken),
      parts_used: parts_used || null,
      notes:      notes      || null,
      status:     status     || 'in_progress',
    });

    res.status(201).json({ success: true, message: 'Activity logged.', id: record._id });
  } catch (err) { next(err); }
});

module.exports = router;
