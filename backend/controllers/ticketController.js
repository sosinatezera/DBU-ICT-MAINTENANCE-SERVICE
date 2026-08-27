/**
 * controllers/ticketController.js
 * Full CRUD for maintenance tickets
 *
 * Endpoints:
 *   GET    /api/tickets         — all tickets (ICT Admin)
 *   GET    /api/tickets/my      — current user's tickets (Requester)
 *   GET    /api/tickets/track/:ticketId — public tracking by ticket code
 *   GET    /api/tickets/:id     — single ticket detail
 *   POST   /api/tickets         — create new ticket (Requester)
 *   PUT    /api/tickets/:id     — update ticket fields (ICT Admin)
 *   PATCH  /api/tickets/:id/status — update ticket status (ICT Admin / Technician)
 *   DELETE /api/tickets/:id     — delete ticket (ICT Admin)
 */

const Ticket       = require('../models/Ticket');
const User         = require('../models/User');
const Technician   = require('../models/Technician');
const Assignment   = require('../models/Assignment');
const Notification = require('../models/Notification');
const ICTAsset     = require('../models/ICTAsset');
const {
  validateObjectId, validateRequired, validateEnum, validateLength,
  sanitizeString, VALID_PRIORITIES, VALID_TICKET_STATUSES, VALID_EQUIPMENT,
  VALID_REQUEST_CATEGORIES,
} = require('../middleware/validation');

/* ── GET /api/tickets — all tickets (admin) ───────────────── */
const getAllTickets = async (req, res, next) => {
  try {
    const { status, priority } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (priority) filter.priority = priority;

    const tickets = await Ticket.find(filter)
      .populate('requester',         'fullName email department')
      .populate('assignedTechnician', 'fullName email')
      .populate('assetId',           'asset_tag asset_name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: tickets.map(formatTicket) });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/my — requester's own tickets ────────── */
const getMyTickets = async (req, res, next) => {
  try {
    const tickets = await Ticket.find({ requester: req.user.id })
      .populate('assignedTechnician', 'fullName email')
      .populate('assetId',            'asset_tag asset_name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: tickets.map(formatTicket) });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/track/:ticketId — public tracking ───── */
const trackTicket = async (req, res, next) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.ticketId })
      .populate('requester',          'fullName email department')
      .populate('assignedTechnician', 'fullName email')
      .populate('assetId',            'asset_tag asset_name');

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* Return limited public info for tracking */
    res.json({
      success: true,
      data: {
        ticketId:    ticket.ticketId,
        status:      ticket.status,
        equipmentType: ticket.equipmentType,
        problemDescription: ticket.problemDescription,
        assignedTechnician: ticket.assignedTechnician?.fullName || null,
        identifiedProblem:  ticket.identifiedProblem,
        resolutionResponse: ticket.resolutionResponse,
        isFixed:            ticket.isFixed,
        feedbackRating:     ticket.feedbackRating,
        createdAt:          ticket.createdAt,
        updatedAt:          ticket.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id — single ticket detail ──────────── */
const getTicketById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id)
      .populate('requester',          'fullName email department phone')
      .populate('assignedTechnician', 'fullName email')
      .populate('assetId',            'asset_tag asset_name');

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* Role-based access:
       - ICT Admin sees every ticket.
       - Technician sees only tickets assigned to them.
       - Everyone else sees only their own tickets. */
    if (req.user.role !== 'ICT Admin') {
      if (req.user.role === 'Technician') {
        const tech = await Technician.findOne({ user: req.user.id });
        const ticketAssignedToUser = ticket.assignedTechnician &&
          String(ticket.assignedTechnician._id || ticket.assignedTechnician) === String(req.user.id);
        const activeAssignment = tech
          ? await Assignment.exists({
              ticket: ticket._id,
              technician: tech._id,
              status: { $in: ['assigned', 'accepted', 'in_progress'] },
            })
          : false;
        if (!ticketAssignedToUser && !activeAssignment) {
          return res.status(403).json({ success: false, message: 'You can only view tickets assigned to you.' });
        }
      } else {
        const ownerId = ticket.requester?._id || ticket.requester;
        if (String(ownerId) !== String(req.user.id)) {
          return res.status(403).json({ success: false, message: 'You can only view your own tickets.' });
        }
      }
    }

    res.json({ success: true, data: formatTicket(ticket) });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/tickets — create new ticket ────────────────── */
const createTicket = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user   = await User.findById(userId).select('fullName phone department');

    /* Validate required */
    const descErr = validateRequired(req.body.problemDescription, 'Problem description');
    if (descErr) return res.status(422).json({ success: false, message: descErr });

    /* Validate optional enums */
    const priErr = validateEnum(req.body.priority, VALID_PRIORITIES, 'priority');
    if (priErr) return res.status(400).json({ success: false, message: priErr });

    const eqErr = validateEnum(req.body.equipmentType, VALID_EQUIPMENT, 'equipment type');
    if (eqErr) return res.status(400).json({ success: false, message: eqErr });

    /* Validate category — required and must be in approved list */
    const catErr = validateRequired(req.body.category, 'Request category');
    if (catErr) return res.status(422).json({ success: false, message: catErr });

    const catEnumErr = validateEnum(req.body.category, VALID_REQUEST_CATEGORIES, 'request category');
    if (catEnumErr) return res.status(400).json({ success: false, message: catEnumErr });

    /* Validate asset if provided */
    let assetId = null;
    if (req.body.asset_id && req.body.asset_id !== 'none') {
      const assetIdErr = validateObjectId(req.body.asset_id, 'Asset');
      if (assetIdErr) return res.status(400).json({ success: false, message: 'Invalid asset selection.' });
      
      const asset = await ICTAsset.findById(req.body.asset_id);
      if (!asset) {
        return res.status(400).json({ success: false, message: 'The selected asset does not exist in the system.' });
      }
      assetId = asset._id;
    }

    /* Validate lengths */
    const desc = sanitizeString(req.body.problemDescription);
    const descLenErr = validateLength(desc, 'Problem description', { min: 5, max: 2000 });
    if (descLenErr) return res.status(400).json({ success: false, message: descLenErr });

    if (req.body.phone) {
      const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;
      if (!phoneRegex.test(req.body.phone.trim())) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
      }
    }

    const payload = {
      requester:          userId,
      department:         req.body.department  || user?.department || null,
      phone:              req.body.phone       || user?.phone     || null,
      title:              req.body.title       || null,
      equipmentType:      req.body.equipmentType  || 'Other',
      category:           req.body.category    || null,
      assetId:            assetId,
      serialNumber:       req.body.serialNumber   || null,
      officeBlock:        req.body.officeBlock    || null,
      problemDescription: desc,
      priority:           req.body.priority       || 'medium',
      status:             'submitted',
      attachment:         req.file ? req.file.filename : null,
    };

    const ticket = await Ticket.create(payload);

    /* Notify the requester */
    await Notification.create({
      user:    userId,
      ticket:  ticket._id,
      title:   `#${ticket.ticketId} — ቀርቧል`,
      message: `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} ቀርቧል እና ግምገማ በመጠበቅ ላይ ነው።`,
      type:    'success',
    });

    /* Notify all ICT Admins */
    const admins = await User.find({ role: 'ICT Admin', status: 'active' }).select('_id');
    for (const admin of admins) {
      await Notification.create({
        user:    admin._id,
        ticket:  ticket._id,
        title:   `New ${payload.priority.toUpperCase()} Ticket`,
        message: `Ticket "${ticket.ticketId}" submitted by ${user?.fullName}. Equipment: ${payload.equipmentType}.`,
        type:    payload.priority === 'critical' ? 'danger' : 'info',
      });
    }

    /* Notify available technicians */
    const techs = await Technician.find({ available: true }).populate('user', '_id status');
    for (const t of techs) {
      if (t.user?.status === 'active') {
        await Notification.create({
          user:    t.user._id,
          ticket:  ticket._id,
          title:   `New Ticket: ${ticket.ticketId}`,
          message: `${user?.fullName} reported a ${payload.equipmentType} issue. Priority: ${payload.priority}.`,
          type:    'info',
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Ticket submitted.',
      data: { id: ticket._id, ticketId: ticket.ticketId },
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/tickets/:id — update ticket fields ──────────── */
const updateTicket = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { priority, equipmentType, status } = req.body;

    if (priority !== undefined) {
      const priErr = validateEnum(priority, VALID_PRIORITIES, 'priority');
      if (priErr) return res.status(400).json({ success: false, message: priErr });
    }

    if (equipmentType !== undefined) {
      const eqErr = validateEnum(equipmentType, VALID_EQUIPMENT, 'equipment type');
      if (eqErr) return res.status(400).json({ success: false, message: eqErr });
    }

    if (status !== undefined) {
      const statErr = validateEnum(status, VALID_TICKET_STATUSES, 'status');
      if (statErr) return res.status(400).json({ success: false, message: statErr });
    }

    const {
      department, phone, serialNumber, officeBlock,
      problemDescription, assignedTechnician,
      identifiedProblem, resolutionResponse, isFixed, reasonIfNotFixed,
    } = req.body;

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      {
        department, phone, equipmentType, serialNumber, officeBlock,
        problemDescription, priority, assignedTechnician,
        identifiedProblem, resolutionResponse, isFixed, reasonIfNotFixed,
      },
      { new: true, runValidators: true }
    );

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    res.json({ success: true, message: 'Ticket updated.' });
  } catch (err) {
    next(err);
  }
};

/* ── PATCH /api/tickets/:id/status — update status ────────── */
const updateStatus = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { status } = req.body;

    if (!status) {
      return res.status(422).json({ success: false, message: 'Status is required.' });
    }

    const statusErr = validateEnum(status, VALID_TICKET_STATUSES, 'status');
    if (statusErr) return res.status(400).json({ success: false, message: statusErr });

    /* If a technician is updating, they must be the technician assigned to this ticket */
    if (req.user.role === 'Technician') {
      const tech   = await Technician.findOne({ user: req.user.id });
      const ticket = await Ticket.findById(req.params.id).select('assignedTechnician');

      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found.' });
      }

      const activeAssignment = tech
        ? await Assignment.exists({
            ticket: ticket._id,
            technician: tech._id,
            status: { $in: ['assigned', 'accepted', 'in_progress'] },
          })
        : false;

      const isAssigned =
        activeAssignment ||
        (ticket.assignedTechnician && ticket.assignedTechnician.toString() === req.user.id);

      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update tickets assigned to you.',
        });
      }
    }

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('requester', '_id fullName email department')
     .populate('assignedTechnician', 'fullName email');

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* Notify the requester of the status change */
    if (ticket.requester?._id) {
      const statusMessages = {
        'submitted':    `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} ቀርቧል እና ግምገማ በመጠበቅ ላይ ነው።`,
        'under_review': `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} በግምገማ ላይ ነው።`,
        'assigned':     `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} ለቴክኒሻን ተመድቧል።`,
        'accepted':     `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} በቴክኒሻን ተቀብሏል።`,
        'in_progress':  `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} አሁን በሂደት ላይ ነው።`,
        'resolved':     `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} ተፈትቷል። እባክዎ ውጤቱን ይገምግሙ።`,
        'closed':       `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} ተዘግቷል።`,
      };
      const statusDisplay = {
        'submitted': 'ቀርቧል', 'under_review': 'በግምገማ ላይ', 'assigned': 'ተመድቧል',
        'accepted': 'ተቀብሏል', 'in_progress': 'በሂደት ላይ', 'resolved': 'ተፈትቷል', 'closed': 'ተዘግቷል',
      };
      await Notification.create({
        user:    ticket.requester._id,
        ticket:  ticket._id,
        title:   `#${ticket.ticketId} — ${statusDisplay[status] || status}`,
        message: statusMessages[status] || `የእርስዎ የአገልግሎት ጥያቄ #${ticket.ticketId} status ወደ ${statusDisplay[status] || status} ተቀይሯል።`,
        type:    ['resolved', 'closed'].includes(status) ? 'success' : 'info',
      });
    }

    /* Notify ICT Admins when resolved or closed */
    if (['resolved', 'closed'].includes(status)) {
      const admins = await User.find({ role: 'ICT Admin', status: 'active' }).select('_id');
      const statusDisplay = status === 'resolved' ? 'Resolved' : 'Closed';
      for (const admin of admins) {
        await Notification.create({
          user:    admin._id,
          ticket:  ticket._id,
          title:   `Ticket ${statusDisplay}: ${ticket.ticketId}`,
          message: `Ticket "${ticket.ticketId}" has been marked as ${statusDisplay}.`,
          type:    'success',
        });
      }
    }

    const statusDisplay = {
      'submitted': 'Submitted', 'under_review': 'Under Review', 'assigned': 'Assigned',
      'accepted': 'Accepted', 'in_progress': 'In Progress', 'resolved': 'Resolved', 'closed': 'Closed',
    };
    res.json({
      success: true,
      message: `Status updated to "${statusDisplay[status] || status}".`,
      data: formatTicket(ticket),
    });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/tickets/:id — delete ticket (admin) ──────── */
const deleteTicket = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }
    res.json({ success: true, message: 'Ticket deleted.' });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: format ticket for API response ────────────────── */
function formatTicket(t) {
  return {
    id:                  t._id,
    ticketId:            t.ticketId,
    requester_name:      t.requester?.fullName || null,
    requester_email:     t.requester?.email    || null,
    department:          t.department,
    phone:               t.phone,
    title:               t.title,
    equipmentType:       t.equipmentType,
    category:            t.category,
    assetId:             t.assetId?._id || t.assetId || null,
    asset_tag:           t.assetId?.asset_tag || null,
    asset_name:          t.assetId?.asset_name || null,
    serialNumber:        t.serialNumber,
    officeBlock:         t.officeBlock,
    problemDescription:  t.problemDescription,
    priority:            t.priority,
    status:              t.status,
    assignedTechnician:  t.assignedTechnician?.fullName || null,
    identifiedProblem:   t.identifiedProblem,
    resolutionResponse:  t.resolutionResponse,
    isFixed:             t.isFixed,
    reasonIfNotFixed:    t.reasonIfNotFixed,
    feedbackRating:      t.feedbackRating,
    feedbackComments:    t.feedbackComments,
    attachment:          t.attachment,
    created_at:          t.createdAt,
    updated_at:          t.updatedAt,
  };
}

module.exports = {
  getAllTickets,
  getMyTickets,
  trackTicket,
  getTicketById,
  createTicket,
  updateTicket,
  updateStatus,
  deleteTicket,
};
