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
 *   POST   /api/tickets/:id/technician-feedback — submit technician maintenance report
 *   PUT    /api/tickets/:id/technician-feedback — edit technician maintenance report
 *   GET    /api/tickets/:id/technician-feedback — read technician maintenance report
 *   DELETE /api/tickets/:id     — delete ticket (ICT Admin)
 */

const VALID_TECH_FEEDBACK_STATUS = ['Fixed', 'In Progress', 'Not Fixed'];

/* ── Requester feedback option sets (service experience survey) ── */
const VALID_QUALITY_LEVELS  = ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'];
const VALID_RESPONSE_TIME   = ['Fast', 'Normal', 'Slow'];
const VALID_RESOLUTION      = ['Completely Resolved', 'Partially Resolved', 'Not Resolved'];
const VALID_SATISFACTION    = ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'];
const VALID_RECOMMEND       = ['Yes', 'No'];

/* ── Admin service evaluation option sets ─────────────────────── */
const VALID_SERVICE_EVALUATION = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement', 'Poor'];
const VALID_TECH_PERFORMANCE = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement'];
const VALID_RESPONSE_EVAL   = ['Excellent', 'Good', 'Slow'];
const VALID_POLICY_COMPLIANCE = ['Compliant', 'Non-Compliant', 'Partial'];

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

    res.json({ success: true, data: tickets.map(t => formatTicket(t, req.user.role, req.user.id)) });
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

    /* Diagnostic — confirms the authenticated user and the count actually
       matched in MongoDB, pinpointing any "tracking shows 0" report. */
    console.log(`[TRACK] GET /api/tickets/my | user=${req.user?.id} | found=${tickets.length}`);

    res.json({ success: true, data: tickets.map(t => formatTicket(t, req.user.role, req.user.id)) });
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

    res.json({ success: true, data: formatTicket(ticket, req.user.role, req.user.id) });
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
      const phoneRegex = /^(09|07)\d{8}$/;
      if (!phoneRegex.test(req.body.phone.trim())) {
        return res.status(400).json({ success: false, message: 'Enter a valid Ethiopian mobile number (10 digits, starting with 09 or 07).' });
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
      title:   `#${ticket.ticketId} — Submitted`,
      message: `Your service request #${ticket.ticketId} has been submitted and is awaiting review.`,
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
      data: {
        id:         ticket._id,            /* real MongoDB ticket ID  */
        ticketId:   ticket.ticketId,       /* human-readable tracking code (TK-xxxx) */
        status:     ticket.status,         /* initial status set by the model */
        created_at: ticket.createdAt,      /* server-generated request date/time */
        createdAt:  ticket.createdAt,
      },
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

/* ── PATCH /api/tickets/:id/status — update status ──────────
   Enforces the forward workflow:
     submitted → under_review → assigned → accepted → in_progress → resolved → closed
   Technicians may only advance through the valid chain (no skipping steps,
   no backward moves, no modifying a closed ticket), and only for tickets that
   are actively assigned to them. The linked Assignment.status is kept in sync
   so the data chain (User → Technician → Assignment → Ticket) stays consistent. */
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

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* ── Diagnostic log (identifies the exact failing request) ── */
    console.log('[TICKET STATUS]', {
      userId: req.user?.id,
      role:   req.user?.role,
      ticketId: req.params.id,
      from:   ticket.status,
      to:     status,
      body:   req.body,
    });

    /* ── Validate the workflow transition (Technicians strictly) ──
       Admins keep full control (their flows set status directly). */
    const VALID_TRANSITIONS = {
      'submitted':    ['under_review', 'assigned'],
      'under_review': ['assigned'],
      'assigned':     ['accepted'],
      'accepted':     ['in_progress'],
      'in_progress':  ['resolved'],
      'resolved':     ['closed'],
      'closed':       [],
    };
    if (req.user.role === 'Technician') {
      const allowed = VALID_TRANSITIONS[ticket.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change ticket status from "${ticket.status}" to "${status}".`,
        });
      }
    }

    /* If a technician is updating, they must be the technician assigned to this ticket */
    if (req.user.role === 'Technician') {
      const tech = await Technician.findOne({ user: req.user.id });

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

    const updated = await Ticket.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('requester', '_id fullName email department')
     .populate('assignedTechnician', 'fullName email');

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* Keep the linked Assignment.status in sync with the ticket lifecycle so
       the data chain stays consistent (accept→accepted, start→in_progress, resolve→completed). */
    const ASSIGN_STATUS = { accepted: 'accepted', in_progress: 'in_progress', resolved: 'completed', closed: 'completed' };
    if (ASSIGN_STATUS[status]) {
      await Assignment.updateMany(
        { ticket: ticket._id, status: { $in: ['assigned', 'accepted', 'in_progress'] } },
        { $set: { status: ASSIGN_STATUS[status] } }
      );
    }

    /* Notify the requester of the status change */
    if (updated.requester?._id) {
      const statusMessages = {
        'submitted':    `Your service request #${ticket.ticketId} has been submitted and is awaiting review.`,
        'under_review': `Your service request #${ticket.ticketId} is under review.`,
        'assigned':     `Your service request #${ticket.ticketId} has been assigned to a technician.`,
        'accepted':     `Your service request #${ticket.ticketId} has been accepted by a technician.`,
        'in_progress':  `Your service request #${ticket.ticketId} is now in progress.`,
        'resolved':     `Your service request #${ticket.ticketId} has been resolved. Please rate the service.`,
        'closed':       `Your service request #${ticket.ticketId} has been closed.`,
      };
      const statusDisplay = {
        'submitted': 'Submitted', 'under_review': 'Under Review', 'assigned': 'Assigned',
        'accepted': 'Accepted', 'in_progress': 'In Progress', 'resolved': 'Resolved', 'closed': 'Closed',
      };
      await Notification.create({
        user:    updated.requester._id,
        ticket:  updated._id,
        title:   `#${updated.ticketId} — ${statusDisplay[status] || status}`,
        message: statusMessages[status] || `Your service request #${updated.ticketId} status has been changed to ${statusDisplay[status] || status}.`,
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
          ticket:  updated._id,
          title:   `Ticket ${statusDisplay}: ${updated.ticketId}`,
          message: `Ticket "${updated.ticketId}" has been marked as ${statusDisplay}.`,
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
      data: formatTicket(updated, req.user.role, req.user.id),
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

/* ── Helper: fetch report from body with shared label ───────── */
function pickFeedbackFields(body) {
  const fields = {};
  const textFields = [
    'diagnosis', 'workPerformed', 'partsUsed', 'resolution',
    'reasonNotFixed', 'recommendation', 'technicianNotes',
  ];
  textFields.forEach(f => {
    if (body[f] !== undefined) {
      fields[f] = body[f] === null || body[f] === '' ? null : sanitizeString(body[f]);
    }
  });
  if (body.status !== undefined) fields.status = body.status;
  return fields;
}

/* ── Validate a feedback payload, returns error string or null ── */
function validateFeedbackPayload(payload, { isEdit = false } = {}) {
  const required = ['diagnosis', 'workPerformed', 'resolution'];
  for (const f of required) {
    if (!isEdit && validateRequired(payload[f], f === 'diagnosis' ? 'Diagnosis' : f === 'workPerformed' ? 'Work performed' : 'Resolution summary')) {
      return `${f === 'diagnosis' ? 'Diagnosis' : f === 'workPerformed' ? 'Work performed' : 'Resolution summary'} is required.`;
    }
  }
  if (payload.status) {
    const statusErr = validateEnum(payload.status, VALID_TECH_FEEDBACK_STATUS, 'report status');
    if (statusErr) return statusErr;
  }
  if (payload.status === 'Not Fixed') {
    if (!payload.reasonNotFixed) return 'Please provide a reason why the issue is not fixed.';
  } else if (payload.reasonNotFixed) {
    // ignore stray reason when status is not 'Not Fixed' — clears stale value
    payload.reasonNotFixed = null;
  }
  for (const [f, max] of [['diagnosis', 2000], ['workPerformed', 2000], ['resolution', 1000],
                          ['reasonNotFixed', 1000], ['recommendation', 1000], ['technicianNotes', 2000],
                          ['partsUsed', 500]]) {
    if (payload[f]) {
      const lenErr = validateLength(payload[f], f, { max });
      if (lenErr) return lenErr;
    }
  }
  return null;
}

/* ── Build the report to store on the ticket ────────────────── */
function buildFeedbackReport(payload, user, ticket, isEdit) {
  return {
    diagnosis:          payload.diagnosis          ?? null,
    workPerformed:      payload.workPerformed      ?? null,
    partsUsed:          payload.partsUsed          ?? null,
    resolution:         payload.resolution         ?? null,
    status:             payload.status             ?? (isEdit ? null : 'In Progress'),
    reasonNotFixed:     payload.reasonNotFixed     ?? null,
    recommendation:     payload.recommendation     ?? null,
    technicianNotes:    payload.technicianNotes    ?? null,
    technicianConfirmed: true,
    technician: {
      technicianId:   user.id,
      technicianName: user.name || 'Technician',
    },
    submittedAt:        isEdit ? (ticket.technicianFeedback?.submittedAt || new Date()) : new Date(),
    completionDate:     payload.status === 'Fixed' ? new Date() : null,
  };
}

/* ── Map a feedback report to a ticket status + sync public fields ── */
function applyFeedbackToTicket(ticket, report) {
  ticket.identifiedProblem  = report.diagnosis ?? ticket.identifiedProblem;
  ticket.resolutionResponse = report.resolution ?? ticket.resolutionResponse;
  ticket.reasonIfNotFixed   = report.reasonNotFixed ?? ticket.reasonIfNotFixed;

  if (report.status === 'Fixed') {
    ticket.isFixed = true;
    ticket.status  = 'resolved';
  } else {
    ticket.isFixed = false;
    ticket.status  = 'in_progress';
  }
}

/* ── Ownership guard: is the current user's tech assigned to ticket? ──
   Reused by submit / edit. Admin is always allowed. */
async function canSubmitFeedback(req, ticket) {
  if (req.user.role === 'ICT Admin') return true;
  if (req.user.role !== 'Technician') return false;

  const tech = await Technician.findOne({ user: req.user.id });
  const activeAssignment = tech
    ? await Assignment.exists({
        ticket: ticket._id,
        technician: tech._id,
        status: { $in: ['assigned', 'accepted', 'in_progress'] },
      })
    : false;
  const isAssigned =
    activeAssignment ||
    (ticket.assignedTechnician && String(ticket.assignedTechnician) === String(req.user.id));
  return isAssigned;
}

/* ── POST /api/tickets/:id/technician-feedback — submit report ── */
const submitTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (!(await canSubmitFeedback(req, ticket))) {
      return res.status(403).json({
        success: false,
        message: 'You can only submit a maintenance report for a ticket assigned to you.',
      });
    }

    if (ticket.technicianFeedback && ticket.technicianFeedback.technicianConfirmed) {
      return res.status(409).json({ success: false, message: 'A maintenance report already exists for this ticket. Edit it instead.' });
    }

    const payload = pickFeedbackFields(req.body);
    const validationErr = validateFeedbackPayload(payload);
    if (validationErr) return res.status(422).json({ success: false, message: validationErr });

    const user = req.user;
    const report = buildFeedbackReport(payload, user, ticket, false);
    ticket.technicianFeedback = report;
    applyFeedbackToTicket(ticket, report);
    ticket.markModified('technicianFeedback');
    await ticket.save();

    /* Keep the linked Assignment.status in sync so the technician's
       assignment is no longer counted as active once the ticket resolves. */
    const ASSIGN_FB_MAP = { resolved: 'completed', closed: 'completed', in_progress: 'in_progress' };
    if (ASSIGN_FB_MAP[ticket.status]) {
      await Assignment.updateMany(
        { ticket: ticket._id, status: { $in: ['assigned', 'accepted', 'in_progress'] } },
        { $set: { status: ASSIGN_FB_MAP[ticket.status] } }
      );
    }

    /* Notify requester + admins of the outcome */
    const notifyTitle = report.status === 'Fixed'
      ? `#${ticket.ticketId} — Resolved`
      : `#${ticket.ticketId} — Update: ${report.status}`;
    const notifyMsg = report.status === 'Fixed'
      ? `The technician has completed your request #${ticket.ticketId}. Please rate the service.`
      : `The technician has updated the work performed on request #${ticket.ticketId} (${report.status}).`;
    if (ticket.requester) {
      await Notification.create({
        user:    ticket.requester,
        ticket:  ticket._id,
        title:   notifyTitle,
        message: notifyMsg,
        type:    report.status === 'Fixed' ? 'success' : 'info',
      });
    }
    if (report.status === 'Fixed') {
      const admins = await User.find({ role: 'ICT Admin', status: 'active' }).select('_id');
      for (const a of admins) {
        await Notification.create({
          user:    a._id,
          ticket:  ticket._id,
          title:   `Ticket Resolved: ${ticket.ticketId}`,
          message: `Ticket "${ticket.ticketId}" resolved by ${user.name || 'technician'}.`,
          type:    'success',
        });
      }
    }

    res.status(201).json({
      success: true,
      message: report.status === 'Fixed' ? 'Maintenance report submitted. Ticket marked as resolved.' : 'Maintenance report submitted.',
      data: formatFeedbackReport(ticket.technicianFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/tickets/:id/technician-feedback — edit report ─── */
const editTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (!(await canSubmitFeedback(req, ticket))) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit a maintenance report for a ticket assigned to you.',
      });
    }

    if (!ticket.technicianFeedback || !ticket.technicianFeedback.technicianConfirmed) {
      return res.status(404).json({ success: false, message: 'No maintenance report exists yet for this ticket.' });
    }

    const payload = pickFeedbackFields(req.body);
    const validationErr = validateFeedbackPayload(payload, { isEdit: true });
    if (validationErr) return res.status(422).json({ success: false, message: validationErr });

    const report = buildFeedbackReport(payload, req.user, ticket, true);
    // preserve the original submitter identity when editing
    const existingTech = ticket.technicianFeedback.technician;
    if (existingTech && (existingTech.technicianId || existingTech.technicianName)) {
      report.technician = {
        technicianId:   existingTech.technicianId || report.technician.technicianId,
        technicianName: existingTech.technicianName || report.technician.technicianName,
      };
    }
    report.submittedAt = ticket.technicianFeedback.submittedAt || new Date();
    ticket.technicianFeedback = report;
    applyFeedbackToTicket(ticket, report);
    ticket.markModified('technicianFeedback');
    await ticket.save();

    /* Keep the linked Assignment.status in sync with the resolved/closed outcome. */
    const ASSIGN_FB_MAP_EDIT = { resolved: 'completed', closed: 'completed', in_progress: 'in_progress' };
    if (ASSIGN_FB_MAP_EDIT[ticket.status]) {
      await Assignment.updateMany(
        { ticket: ticket._id, status: { $in: ['assigned', 'accepted', 'in_progress'] } },
        { $set: { status: ASSIGN_FB_MAP_EDIT[ticket.status] } }
      );
    }

    res.json({
      success: true,
      message: 'Maintenance report updated.',
      data: formatFeedbackReport(ticket.technicianFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/technician-feedback — read report ── */
const getTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select('technicianFeedback _id');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const report = ticket.technicianFeedback;
    if (!report || !report.technicianConfirmed) {
      return res.status(404).json({ success: false, message: 'No maintenance report found for this ticket.' });
    }

    // Full report for technicians (assigned) and ICT Admins only.
    if (req.user.role === 'Requester') {
      const ownerId = ticket.requester;
      const isOwner = ownerId && String(ownerId) === String(req.user.id);
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'You can only view your own ticket reports.' });
      }
      // Requesters get only the public subset — no internal notes.
      return res.json({
        success: true,
        data: {
          resolution:    report.resolution,
          status:        report.status,
          isFixed:       report.status === 'Fixed',
          completionDate: report.completionDate,
          technician:    report.technician?.technicianName || report.technician?.name || null,
          submittedAt:   report.submittedAt,
        },
      });
    }

    if (req.user.role === 'Technician' && !(await canSubmitFeedback(req, ticket))) {
      return res.status(403).json({ success: false, message: 'You can only view reports for tickets assigned to you.' });
    }

    res.json({ success: true, data: formatFeedbackReport(report) });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: format technician feedback for API response ───── */
function formatFeedbackReport(report) {
  return {
    diagnosis:          report?.diagnosis          ?? null,
    workPerformed:      report?.workPerformed      ?? null,
    partsUsed:          report?.partsUsed          ?? null,
    resolution:         report?.resolution         ?? null,
    status:             report?.status             ?? null,
    reasonNotFixed:     report?.reasonNotFixed     ?? null,
    recommendation:     report?.recommendation     ?? null,
    technicianNotes:    report?.technicianNotes    ?? null,
    technicianConfirmed: report?.technicianConfirmed ?? false,
    technician_name: report?.technician?.technicianName || report?.technician?.name || null,
    submittedAt:        report?.submittedAt        ?? null,
    completionDate:     report?.completionDate     ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN SERVICE FEEDBACK  (management/service quality evaluation)
   ═══════════════════════════════════════════════════════════ */

/* ── Pick + sanitize admin feedback fields from body ────────── */
function pickAdminFeedbackFields(body) {
  const fields = {};
  const textFields = ['serviceHandlingQuality', 'technicianPerformance', 'responseTime',
                      'resolutionQuality', 'documentationQuality', 'policyCompliance',
                      'overallServiceQuality', 'adminComment', 'followUpNotes',
                      'administrativeRecommendation'];
  textFields.forEach(f => {
    if (body[f] !== undefined) {
      fields[f] = body[f] === null || body[f] === '' ? null : sanitizeString(body[f]);
    }
  });
  return fields;
}

/* ── Validate admin feedback payload → error string or null ──── */
function validateAdminFeedbackPayload(payload, { isEdit = false } = {}) {
  const reqEnums = [
    ['serviceHandlingQuality',  VALID_SERVICE_EVALUATION, 'Service handling quality'],
    ['technicianPerformance',   VALID_TECH_PERFORMANCE,   'Technician performance'],
    ['responseTime',            VALID_RESPONSE_EVAL,      'Response time'],
    ['resolutionQuality',       VALID_SERVICE_EVALUATION, 'Resolution quality'],
    ['documentationQuality',    VALID_SERVICE_EVALUATION, 'Documentation quality'],
    ['policyCompliance',        VALID_POLICY_COMPLIANCE,  'Policy/Procedure compliance'],
    ['overallServiceQuality',   VALID_SERVICE_EVALUATION, 'Overall service quality'],
  ];
  for (const [f, allowed, label] of reqEnums) {
    if (payload[f]) {
      const e = validateEnum(payload[f], allowed, label);
      if (e) return e;
    }
  }

  if (!isEdit) {
    if (validateRequired(payload.serviceHandlingQuality, 'Service handling quality')) return 'Service handling quality is required.';
    if (validateRequired(payload.overallServiceQuality, 'Overall service quality')) return 'Overall service quality is required.';
    if (validateRequired(payload.adminComment, 'Admin comment')) return 'Admin comment is required.';
  }

  for (const f of ['serviceHandlingQuality','technicianPerformance','responseTime','resolutionQuality',
                   'documentationQuality','policyCompliance','overallServiceQuality']) {
    if (payload[f]) {
      const lenErr = validateLength(payload[f], f, { max: 50 });
      if (lenErr) return lenErr;
    }
  }
  if (payload.adminComment) {
    const lenErr = validateLength(payload.adminComment, 'Admin comment', { max: 2000 });
    if (lenErr) return lenErr;
  }
  if (payload.followUpNotes) {
    const lenErr = validateLength(payload.followUpNotes, 'Follow-up notes', { max: 1000 });
    if (lenErr) return lenErr;
  }
  if (payload.administrativeRecommendation) {
    const lenErr = validateLength(payload.administrativeRecommendation, 'Administrative recommendation', { max: 1000 });
    if (lenErr) return lenErr;
  }
  return null;
}

/* ── Build the admin feedback report to store ───────────────── */
function buildAdminFeedbackReport(payload, user, isEdit, existing) {
  const keep = (key) => payload[key] ?? (existing ? existing[key] : null);
  return {
    serviceHandlingQuality:  keep('serviceHandlingQuality'),
    technicianPerformance:   keep('technicianPerformance'),
    responseTime:            keep('responseTime'),
    resolutionQuality:       keep('resolutionQuality'),
    documentationQuality:    keep('documentationQuality'),
    policyCompliance:        keep('policyCompliance'),
    overallServiceQuality:   keep('overallServiceQuality'),
    followUpRequired:        payload.followUpRequired ?? (existing ? existing.followUpRequired : false),
    followUpNotes:           keep('followUpNotes'),
    adminComment:            keep('adminComment'),
    administrativeRecommendation: keep('administrativeRecommendation'),
    adminConfirmed:          payload.adminConfirmed ?? false,
    admin: {
      adminId:   user.id,
      adminName: user.name || 'ICT Admin',
    },
    submittedAt:             isEdit && existing ? (existing.submittedAt || new Date()) : new Date(),
  };
}

/* ── POST /api/tickets/:id/admin-feedback ──────────────────── */
const submitAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (ticket.adminFeedback && ticket.adminFeedback.adminConfirmed) {
      return res.status(409).json({ success: false, message: 'Admin service feedback already exists for this ticket. Edit it instead.' });
    }

    const payload = pickAdminFeedbackFields(req.body);
    if (req.body.followUpRequired !== undefined) payload.followUpRequired = !!req.body.followUpRequired;
    if (req.body.adminConfirmed !== undefined) payload.adminConfirmed = !!req.body.adminConfirmed;

    const validationErr = validateAdminFeedbackPayload(payload);
    if (validationErr) return res.status(422).json({ success: false, message: validationErr });

    if (payload.followUpRequired && !payload.followUpNotes) {
      return res.status(422).json({ success: false, message: 'Please explain what the follow-up requires.' });
    }
    if (!payload.adminConfirmed) {
      return res.status(422).json({ success: false, message: 'Please confirm that this service evaluation is accurate.' });
    }

    const report = buildAdminFeedbackReport(payload, req.user, false, null);
    ticket.adminFeedback = report;
    ticket.markModified('adminFeedback');
    await ticket.save();

    res.status(201).json({
      success: true,
      message: 'Admin service feedback submitted.',
      data: formatAdminFeedbackReport(ticket.adminFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/tickets/:id/admin-feedback ───────────────────── */
const editAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (!ticket.adminFeedback || !ticket.adminFeedback.adminConfirmed) {
      return res.status(404).json({ success: false, message: 'No admin service feedback exists yet for this ticket.' });
    }

    const payload = pickAdminFeedbackFields(req.body);
    if (req.body.followUpRequired !== undefined) payload.followUpRequired = !!req.body.followUpRequired;
    if (req.body.adminConfirmed !== undefined) payload.adminConfirmed = !!req.body.adminConfirmed;

    const validationErr = validateAdminFeedbackPayload(payload, { isEdit: true });
    if (validationErr) return res.status(422).json({ success: false, message: validationErr });

    if (payload.followUpRequired && !payload.followUpNotes) {
      return res.status(422).json({ success: false, message: 'Please explain what the follow-up requires.' });
    }

    const report = buildAdminFeedbackReport(payload, req.user, true, ticket.adminFeedback);
    // preserve the original submitter identity when editing
    if (ticket.adminFeedback.admin && (ticket.adminFeedback.admin.adminId || ticket.adminFeedback.admin.adminName)) {
      report.admin = {
        adminId:   ticket.adminFeedback.admin.adminId   || report.admin.adminId,
        adminName: ticket.adminFeedback.admin.adminName || report.admin.adminName,
      };
    }
    ticket.adminFeedback = report;
    ticket.markModified('adminFeedback');
    await ticket.save();

    res.json({
      success: true,
      message: 'Admin service feedback updated.',
      data: formatAdminFeedbackReport(ticket.adminFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/admin-feedback ───────────────────── */
const getAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select('adminFeedback requester');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const report = ticket.adminFeedback;
    if (!report || !report.adminConfirmed) {
      return res.status(404).json({ success: false, message: 'No admin service feedback found for this ticket.' });
    }

    // Internal management information — only ICT Admins may view it.
    if (req.user.role !== 'ICT Admin') {
      return res.status(403).json({ success: false, message: 'Only ICT Admins can view admin service feedback.' });
    }

    res.json({ success: true, data: formatAdminFeedbackReport(report) });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/tickets/:id/admin-feedback — clear feedback ──
   Removes the embedded admin service feedback from the ticket.
   ICT Admin only. Requires a real MongoDB operation. */
const deleteAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select('adminFeedback ticketId');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (!ticket.adminFeedback || !ticket.adminFeedback.adminConfirmed) {
      return res.status(404).json({ success: false, message: 'No admin service feedback exists for this ticket.' });
    }

    ticket.adminFeedback = undefined;
    await ticket.save();

    res.json({
      success: true,
      message: `Admin service feedback for #${ticket.ticketId} deleted.`,
    });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: format admin feedback for API response ────────── */
function formatAdminFeedbackReport(report) {
  return {
    serviceHandlingQuality:  report?.serviceHandlingQuality ?? null,
    technicianPerformance:   report?.technicianPerformance ?? null,
    responseTime:            report?.responseTime ?? null,
    resolutionQuality:       report?.resolutionQuality ?? null,
    documentationQuality:    report?.documentationQuality ?? null,
    policyCompliance:        report?.policyCompliance ?? null,
    overallServiceQuality:   report?.overallServiceQuality ?? null,
    followUpRequired:        report?.followUpRequired ?? false,
    followUpNotes:           report?.followUpNotes ?? null,
    adminComment:            report?.adminComment ?? null,
    administrativeRecommendation: report?.administrativeRecommendation ?? null,
    adminConfirmed:          report?.adminConfirmed ?? false,
    admin_name: report?.admin?.adminName || report?.admin?.name || null,
    submittedAt:             report?.submittedAt ?? null,
  };
}

/* ── Helper: format ticket for API response ────────────────── */
function formatFeedbackPublic(report) {
  return {
    diagnosis:          report?.diagnosis          ?? null,
    workPerformed:      report?.workPerformed      ?? null,
    partsUsed:          report?.partsUsed          ?? null,
    resolution:         report?.resolution         ?? null,
    status:             report?.status             ?? null,
    reasonNotFixed:     report?.reasonNotFixed     ?? null,
    recommendation:     report?.recommendation     ?? null,
    technician_name: report?.technician?.technicianName || report?.technician?.name || null,
    submittedAt:        report?.submittedAt        ?? null,
    completionDate:     report?.completionDate     ?? null,
  };
}

function formatTicket(t, viewerRole = 'ICT Admin', viewerId = null) {
  const isAdmin = viewerRole === 'ICT Admin';
  const isTech  = viewerRole === 'Technician';

  /* Requester service-experience feedback.
     - The requester (owner) and ICT Admin may view the full survey.
     - Technicians/others do not need the requester's evaluation. */
  const requesterId = t.requester?._id || t.requester;
  const isOwner = !!viewerId && !!requesterId && String(requesterId) === String(viewerId);
  const canSeeRequesterFeedback = isAdmin || isOwner;
  const rf = canSeeRequesterFeedback && t.requesterFeedback && t.requesterFeedback.overallRating
    ? t.requesterFeedback : null;

  /* Technician maintenance report:
     - ICT Admin & assigned Technician see the full report (incl. notes).
     - Requesters/others see only the public subset (notes + admin feedback stay hidden). */
  const tf = t.technicianFeedback && t.technicianFeedback.technicianConfirmed ? t.technicianFeedback : null;
  const techFeedback =
    tf ? (isAdmin || isTech ? formatFeedbackReport(tf) : formatFeedbackPublic(tf)) : null;

  /* Admin service feedback is internal management info: ICT Admin only. */
  const adminFeedback =
    isAdmin && t.adminFeedback && t.adminFeedback.adminConfirmed
      ? formatAdminFeedbackReport(t.adminFeedback)
      : null;

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
    feedbackRating:      canSeeRequesterFeedback ? t.feedbackRating : null,
    feedbackComments:    canSeeRequesterFeedback ? t.feedbackComments : null,
    attachment:          t.attachment,
    requester_feedback:  rf ? formatRequesterFeedback(rf) : null,
    has_requester_feedback: !!rf,
    technician_feedback: techFeedback,
    has_technician_feedback: !!tf,
    admin_feedback:        adminFeedback,
    has_admin_feedback:    !!adminFeedback,
    created_at:          t.createdAt,
    updated_at:          t.updatedAt,
  };
}

/* ── Helper: format requester feedback for API response ────── */
function formatRequesterFeedback(report) {
  return {
    requester_name:  report?.requesterName || null,
    overallRating:   report?.overallRating ?? null,
    serviceQuality:  report?.serviceQuality ?? null,
    technicianProfessionalism: report?.technicianProfessionalism ?? null,
    responseTime:    report?.responseTime ?? null,
    communication:   report?.communication ?? null,
    problemResolution: report?.problemResolution ?? null,
    satisfactionLevel: report?.satisfactionLevel ?? null,
    wouldRecommend:  report?.wouldRecommend ?? null,
    comment:         report?.comment ?? null,
    suggestions:     report?.suggestions ?? null,
    submittedAt:     report?.submittedAt ?? null,
  };
}

/* ── Helper: pick + sanitize requester feedback fields ─────── */
function pickRequesterFeedbackFields(body) {
  const fields = {};
  const options = {
    serviceQuality:      VALID_QUALITY_LEVELS,
    technicianProfessionalism: VALID_QUALITY_LEVELS,
    responseTime:        VALID_RESPONSE_TIME,
    communication:       VALID_QUALITY_LEVELS,
    problemResolution:   VALID_RESOLUTION,
    satisfactionLevel:   VALID_SATISFACTION,
  };
  const textFields = ['comment', 'suggestions'];
  textFields.forEach(f => {
    if (body[f] !== undefined) {
      fields[f] = body[f] === null || body[f] === '' ? null : sanitizeString(body[f]);
    }
  });
  if (body.overallRating !== undefined && body.overallRating !== null && body.overallRating !== '') {
    fields.overallRating = body.overallRating;
  }
  if (body.wouldRecommend !== undefined && body.wouldRecommend !== null && body.wouldRecommend !== '') {
    fields.wouldRecommend = body.wouldRecommend;
  }
  for (const [f, allowed] of Object.entries(options)) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== '') fields[f] = body[f];
  }
  return fields;
}

/* ── Validate requester feedback payload → error string or null ── */
function validateRequesterFeedbackPayload(payload) {
  const rating = Number(payload.overallRating);
  if (!payload.overallRating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return 'Overall service rating (1-5) is required.';
  }
  if (validateRequired(payload.serviceQuality, 'Service quality')) return 'Service quality is required.';
  if (validateRequired(payload.technicianProfessionalism, 'Technician professionalism')) return 'Technician professionalism is required.';
  if (validateRequired(payload.responseTime, 'Response time')) return 'Response time is required.';
  if (validateRequired(payload.communication, 'Communication')) return 'Communication is required.';
  if (validateRequired(payload.problemResolution, 'Problem resolution')) return 'Problem resolution is required.';
  if (validateRequired(payload.satisfactionLevel, 'Satisfaction level')) return 'Satisfaction level is required.';
  if (validateRequired(payload.wouldRecommend, 'Would recommend service')) return 'Please indicate whether you would recommend the service.';

  const options = {
    serviceQuality:      VALID_QUALITY_LEVELS,
    technicianProfessionalism: VALID_QUALITY_LEVELS,
    responseTime:        VALID_RESPONSE_TIME,
    communication:       VALID_QUALITY_LEVELS,
    problemResolution:   VALID_RESOLUTION,
    satisfactionLevel:   VALID_SATISFACTION,
  };
  for (const [f, allowed] of Object.entries(options)) {
    if (payload[f]) {
      const e = validateEnum(payload[f], allowed, f.replace(/([A-Z])/g, ' $1').toLowerCase());
      if (e) return e;
    }
  }
  if (payload.wouldRecommend && !VALID_RECOMMEND.includes(payload.wouldRecommend)) {
    return 'Would recommend must be Yes or No.';
  }
  if (payload.comment) {
    const lenErr = validateLength(payload.comment, 'Comment', { max: 1000 });
    if (lenErr) return lenErr;
  }
  if (payload.suggestions) {
    const lenErr = validateLength(payload.suggestions, 'Suggestions', { max: 1000 });
    if (lenErr) return lenErr;
  }
  return null;
}

/* ── POST /api/tickets/:id/requester-feedback — submit ─────── */
const submitRequesterFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    /* Only the Requester (owner) or an ICT Admin may submit. Technicians cannot. */
    if (req.user.role === 'Technician') {
      return res.status(403).json({ success: false, message: 'Only the requester can submit service feedback.' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const ownerId = ticket.requester?._id || ticket.requester;
    const isOwner = String(ownerId) === String(req.user.id);
    if (!isOwner && req.user.role !== 'ICT Admin') {
      return res.status(403).json({ success: false, message: 'You can only give feedback on your own tickets.' });
    }

    if (ticket.requesterFeedback && ticket.requesterFeedback.overallRating) {
      return res.status(409).json({ success: false, message: 'Service feedback already submitted for this ticket.' });
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Feedback can only be submitted for resolved or closed tickets.' });
    }

    const payload = pickRequesterFeedbackFields(req.body);
    const validationErr = validateRequesterFeedbackPayload(payload);
    if (validationErr) return res.status(422).json({ success: false, message: validationErr });

    const user = await User.findById(req.user.id).select('fullName');
    ticket.requesterFeedback = {
      requesterId:   req.user.id,
      requesterName: user?.fullName || req.user.name || 'Requester',
      overallRating: Number(payload.overallRating),
      serviceQuality:           payload.serviceQuality,
      technicianProfessionalism: payload.technicianProfessionalism,
      responseTime:             payload.responseTime,
      communication:            payload.communication,
      problemResolution:        payload.problemResolution,
      satisfactionLevel:        payload.satisfactionLevel,
      wouldRecommend:           payload.wouldRecommend,
      comment:                  payload.comment || null,
      suggestions:              payload.suggestions || null,
      submittedAt:              new Date(),
    };
    ticket.markModified('requesterFeedback');
    /* Keep legacy aggregate fields in sync (used by reports + history display). */
    ticket.feedbackRating   = Number(payload.overallRating);
    ticket.feedbackComments = payload.comment || null;
    await ticket.save();

    /* Mirror a minimal record into the standalone Feedback collection so the
       existing admin dashboard avg-rating and "recent feedback" report keep working. */
    try {
      const Feedback = require('../models/Feedback');
      const existing = await Feedback.findOne({ request: ticket._id });
      if (existing) {
        existing.rating  = Number(payload.overallRating);
        existing.comment = payload.comment || null;
        await existing.save();
      } else {
        await Feedback.create({
          request: ticket._id,
          user:    req.user.id,
          rating:  Number(payload.overallRating),
          comment: payload.comment || null,
        });
      }
    } catch (_) { /* non-blocking */ }

    res.status(201).json({
      success: true,
      message: 'Service feedback submitted. Thank you!',
      data: formatRequesterFeedback(ticket.requesterFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/requester-feedback — read ─────────── */
const getRequesterFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select('requesterFeedback requester');
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const report = ticket.requesterFeedback;
    if (!report || !report.overallRating) {
      return res.status(404).json({ success: false, message: 'No service feedback has been submitted for this ticket.' });
    }

    /* Only the ticket owner or an ICT Admin may read the requester's survey. */
    if (req.user.role !== 'ICT Admin') {
      const ownerId = ticket.requester?._id || ticket.requester;
      if (String(ownerId) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'You can only view your own feedback.' });
      }
    }

    res.json({ success: true, data: formatRequesterFeedback(report) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllTickets,
  getMyTickets,
  trackTicket,
  getTicketById,
  createTicket,
  updateTicket,
  updateStatus,
  deleteTicket,
  submitTechnicianFeedback,
  editTechnicianFeedback,
  getTechnicianFeedback,
  submitRequesterFeedback,
  getRequesterFeedback,
  submitAdminFeedback,
  editAdminFeedback,
  getAdminFeedback,
  deleteAdminFeedback,
};
