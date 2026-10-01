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

const VALID_TECH_FEEDBACK_STATUS = ["Fixed", "In Progress", "Not Fixed"];

/* ── Requester feedback option sets (service experience survey) ── */
const VALID_QUALITY_LEVELS = ["Excellent", "Very Good", "Good", "Fair", "Poor"];
const VALID_RESPONSE_TIME = ["Fast", "Normal", "Slow"];
const VALID_RESOLUTION = [
  "Completely Resolved",
  "Partially Resolved",
  "Not Resolved",
];
const VALID_SATISFACTION = [
  "Very Satisfied",
  "Satisfied",
  "Neutral",
  "Dissatisfied",
  "Very Dissatisfied",
];
const VALID_RECOMMEND = ["Yes", "No"];

/* ── Admin service evaluation option sets ─────────────────────── */
const VALID_SERVICE_EVALUATION = [
  "Excellent",
  "Good",
  "Satisfactory",
  "Needs Improvement",
  "Poor",
];
const VALID_TECH_PERFORMANCE = [
  "Excellent",
  "Good",
  "Satisfactory",
  "Needs Improvement",
];
const VALID_RESPONSE_EVAL = ["Excellent", "Good", "Slow"];
const VALID_POLICY_COMPLIANCE = ["Compliant", "Non-Compliant", "Partial"];

/* Fire-and-forget outbound email (gated by SMTP config + Settings). It is
   called WITHOUT await and with .catch() so it can never fail the request. */
const { sendEventEmail } = require("../services/mailer");
const { broadcastNotification } = require("../services/notificationService");

const Ticket = require("../models/Ticket");
const Category = require("../models/Category");
const Settings = require("../models/Settings");
const {
  isSupportedICTCategory,
  normalizeCategoryValue,
  normalizeIssueTypeValue,
  OTHER_ISSUE_TYPE,
} = require("../utils/ictCategoryHierarchy");
const {
  isIssueTypeAccepted,
  isIssueTypeAcceptedForUpdate,
} = require("../services/issueTypeCatalogue");
const {
  resolveDeviceTypeCategories,
} = require("../utils/deviceTypeCategories");
const User = require("../models/User");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
const ICTAsset = require("../models/ICTAsset");
const {
  validateObjectId,
  validateRequired,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_PRIORITIES,
  VALID_TICKET_STATUSES,
  VALID_EQUIPMENT,
  OTHER_DEVICE_TYPE,
  DEVICE_TYPE_MAX_LENGTH,
} = require("../middleware/validation");
const { displayTicketId, ticketCodeMatchQuery } = require("../utils/ticketId");

function ticketSubmissionResponse(ticket, requester) {
  return {
    success: true,
    message: "Ticket submitted.",
    data: {
      id: ticket._id,
      requester_id: requester._id,
      requester_name: requester.fullName,
      ticketId: displayTicketId(ticket.ticketId),
      status: ticket.status,
      created_at: ticket.createdAt,
      createdAt: ticket.createdAt,
    },
  };
}

async function getAssignedTechnicians(tickets) {
  const ticketIds = tickets.map((ticket) => ticket._id).filter(Boolean);
  if (!ticketIds.length) return new Map();

  const assignments = await Assignment.find({
    ticket: { $in: ticketIds },
    status: { $ne: "reassigned" },
  })
    .select("ticket technician status createdAt")
    .populate({
      path: "technician",
      select: "user",
      populate: { path: "user", select: "fullName email" },
    })
    .sort({ createdAt: -1 })
    .lean();

  const byTicket = new Map();
  for (const assignment of assignments) {
    const ticketId = String(assignment.ticket);
    if (byTicket.has(ticketId)) continue;

    const technician = assignment.technician;
    const user = technician?.user;
    byTicket.set(ticketId, {
      assignmentId: assignment._id,
      assignmentStatus: assignment.status,
      technicianId: technician?._id || null,
      technicianUserId: user?._id || null,
      technicianName: user?.fullName || null,
      technicianEmail: user?.email || null,
    });
  }
  return byTicket;
}

/* ── Device Type handling (shared by create + admin update) ─────
  The field remains nullable for existing records and admin updates. New
  requester submissions require a supported Device Type and Category before
  the ticket is written.

  Values are not checked against a Mongoose enum, so the admin-managed
  catalogue and legacy values on historical tickets keep round-tripping.

   Choosing "Other ICT Device" additionally requires the free-text
   "Specify Device Name" field. For every other choice that field is cleared,
   so a stale value can never linger next to a real device type. */
function resolveDeviceFields(body) {
  const sourceDeviceType =
    typeof body.deviceType === "string" && body.deviceType.trim()
      ? body.deviceType.trim()
      : typeof body.equipmentType === "string" && body.equipmentType.trim()
        ? body.equipmentType.trim()
        : null;

  const equipmentType = sourceDeviceType;

  if (equipmentType && equipmentType.length > DEVICE_TYPE_MAX_LENGTH) {
    return {
      error: `Device type must be no more than ${DEVICE_TYPE_MAX_LENGTH} characters.`,
    };
  }

  /* Not the "Other" entry (including no selection at all) — no custom name. */
  if (equipmentType !== OTHER_DEVICE_TYPE) {
    return { equipmentType, otherDeviceName: null, error: null };
  }

  const otherDeviceName =
    typeof body.otherDeviceName === "string"
      ? sanitizeString(body.otherDeviceName)
      : "";

  if (!otherDeviceName) {
    return { error: "Please enter the device name." };
  }
  const nameLenErr = validateLength(otherDeviceName, "Device name", {
    min: 2,
    max: DEVICE_TYPE_MAX_LENGTH,
  });
  if (nameLenErr) return { error: nameLenErr };

  return { equipmentType, otherDeviceName, error: null };
}

/* ── GET /api/tickets — all tickets (admin) ───────────────── */
const getAllTickets = async (req, res, next) => {
  try {
    const { status, priority } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : null;
    let ticketQuery = Ticket.find(filter)
      .populate("requester", "fullName email department")
      .populate("assignedTechnician", "fullName email")
      .populate("assetId", "asset_tag asset_name")
      .sort({ createdAt: -1 });
    if (limit) ticketQuery = ticketQuery.limit(limit);
    let tickets;
    if (limit && req.query.includeFeedback === "true") {
      const feedbackQuery = Ticket.find({
        $or: [
          { "requesterFeedback.overallRating": { $ne: null } },
          { "technicianFeedback.technicianConfirmed": true },
          { "adminFeedback.adminConfirmed": true },
        ],
      })
        .populate("requester", "fullName email department")
        .populate("assignedTechnician", "fullName email")
        .populate("assetId", "asset_tag asset_name")
        .sort({ createdAt: -1 })
        .limit(6)
        .lean();
      const [recentTickets, feedbackTickets] = await Promise.all([
        ticketQuery.limit(limit).lean(),
        feedbackQuery,
      ]);
      const uniqueTickets = new Map();
      [...recentTickets, ...feedbackTickets].forEach((ticket) =>
        uniqueTickets.set(String(ticket._id), ticket),
      );
      tickets = [...uniqueTickets.values()].sort(
        (left, right) => right.createdAt - left.createdAt,
      );
    } else {
      if (limit) ticketQuery = ticketQuery.limit(limit);
      tickets = await ticketQuery.lean();
    }
    const assignedTechnicians = await getAssignedTechnicians(tickets);

    res.json({
      success: true,
      data: tickets.map((t) =>
        formatTicket(
          t,
          req.user.role,
          req.user.id,
          assignedTechnicians.get(String(t._id)),
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/my — requester's own tickets ────────── */
const getMyTickets = async (req, res, next) => {
  try {
    const tickets = await Ticket.find({ requester: req.user.id })
      .populate("requester", "fullName email department")
      .populate("assignedTechnician", "fullName email")
      .populate("assetId", "asset_tag asset_name")
      .sort({ createdAt: -1 })
      .lean();
    const assignedTechnicians = await getAssignedTechnicians(tickets);

    res.json({
      success: true,
      data: tickets.map((t) =>
        formatTicket(
          t,
          req.user.role,
          req.user.id,
          assignedTechnicians.get(String(t._id)),
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/track/:ticketId — public tracking ───── */
const trackTicket = async (req, res, next) => {
  try {
    const match = ticketCodeMatchQuery(req.params.ticketId);
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const ticket = await Ticket.findOne(match)
      .populate("requester", "fullName email department")
      .populate("assignedTechnician", "fullName email")
      .populate("assetId", "asset_tag asset_name")
      .lean();

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const assignedTechnicians = await getAssignedTechnicians([ticket]);
    const assignedTechnician = assignedTechnicians.get(String(ticket._id));

    /* Return limited public info for tracking */
    res.json({
      success: true,
      data: {
        ticketId: displayTicketId(ticket.ticketId),
        requester_name: ticket.requester?.fullName || null,
        status: ticket.status,
        equipmentType: ticket.equipmentType || null,
        otherDeviceName: ticket.otherDeviceName || null,
        deviceLabel: formatDeviceLabel(ticket),
        device: ticket.device || null,
        category: ticket.category || null,
        problemDescription: ticket.problemDescription,
        assignedTechnician: assignedTechnician?.technicianName || null,
        technician: assignedTechnician
          ? {
              id: assignedTechnician.technicianId,
              userId: assignedTechnician.technicianUserId,
              name: assignedTechnician.technicianName,
              email: assignedTechnician.technicianEmail,
            }
          : null,
        identifiedProblem: ticket.identifiedProblem,
        resolutionResponse: ticket.resolutionResponse,
        isFixed: ticket.isFixed,
        feedbackRating: ticket.feedbackRating,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id — single ticket detail ──────────── */
const getTicketById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id)
      .populate("requester", "fullName email department phone")
      .populate("assignedTechnician", "fullName email")
      .populate("assetId", "asset_tag asset_name")
      .lean();

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    const assignedTechnicians = await getAssignedTechnicians([ticket]);
    const assignedTechnician = assignedTechnicians.get(String(ticket._id));

    /* Role-based access:
       - ICT Admin sees every ticket.
       - Technician sees only tickets assigned to them.
       - Everyone else sees only their own tickets. */
    let denyMessage = null;
    if (req.user.role !== "ICT Admin") {
      if (req.user.role === "Technician") {
        const tech = await Technician.findOne({ user: req.user.id });
        const ticketAssignedToUser =
          ticket.assignedTechnician &&
          String(ticket.assignedTechnician._id || ticket.assignedTechnician) ===
            String(req.user.id);
        const hasAssignment = tech
          ? await Assignment.exists({
              ticket: ticket._id,
              technician: tech._id,
              status: {
                $in: ["assigned", "accepted", "in_progress", "completed"],
              },
            })
          : false;
        if (!ticketAssignedToUser && !hasAssignment) {
          denyMessage = "You can only view tickets assigned to you.";
        }
      } else {
        const ownerId = ticket.requester?._id || ticket.requester;
        if (String(ownerId) !== String(req.user.id)) {
          denyMessage = "You can only view your own tickets.";
        }
      }
    }

    if (denyMessage) {
      return res.status(403).json({ success: false, message: denyMessage });
    }

    res.json({
      success: true,
      data: formatTicket(
        ticket,
        req.user.role,
        req.user.id,
        assignedTechnician,
      ),
    });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/tickets — create new ticket ────────────────── */
const createTicket = async (req, res, next) => {
  try {
    const requesterId = req.user.id;
    const requester = await User.findById(requesterId).select(
      "role fullName phone department email",
    );
    if (!requester) {
      return res.status(401).json({
        success: false,
        message: "The authenticated requester account no longer exists.",
      });
    }
    if (requester.role !== "Requester") {
      return res.status(403).json({
        success: false,
        message: "Only requesters can submit maintenance tickets.",
      });
    }

    const submissionKey = String(req.body.submissionKey || "");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        submissionKey,
      )
    ) {
      return res.status(422).json({
        success: false,
        message: "A valid submission key is required.",
      });
    }

    const existingTicket = await Ticket.findOne({
      requester: requester._id,
      submissionKey,
    });
    if (existingTicket) {
      req.auditEntityId = existingTicket._id;
      return res
        .status(200)
        .json(ticketSubmissionResponse(existingTicket, requester));
    }

    /* Validate required */
    const descErr = validateRequired(
      req.body.problemDescription,
      "Problem description",
    );
    if (descErr)
      return res.status(422).json({ success: false, message: descErr });

    /* Device Type is required for new requests. Accept the canonical field name
       while still honoring the legacy equipmentType alias. */
    const {
      equipmentType,
      otherDeviceName,
      error: deviceErr,
    } = resolveDeviceFields(req.body);
    if (deviceErr)
      return res.status(400).json({ success: false, message: deviceErr });
    if (!equipmentType) {
      return res
        .status(422)
        .json({ success: false, message: "Please select a device type." });
    }

    const allowedCategories = await resolveDeviceTypeCategories(equipmentType);
    if (!allowedCategories) {
      return res
        .status(400)
        .json({ success: false, message: "Unsupported device type." });
    }

    /* Priority is assigned by admin only; the requester cannot set it. New
       tickets therefore start at the ICT Admin's configured default.
       Read per-request rather than cached in a module constant so switching
       the default takes effect immediately. A Settings read that fails falls
       back to "medium" rather than rejecting the submission — losing a
       priority preference is recoverable, refusing a maintenance request is
       not. */
    let priority = "medium";
    try {
      const settings = await Settings.getInstance();
      priority = settings.defaultPriority || "medium";
    } catch (_) {
      /* keep the "medium" fallback */
    }

    /* Validate location — required */
    const locErr = validateRequired(req.body.location, "Location");
    if (locErr)
      return res.status(422).json({ success: false, message: locErr });

    const location = sanitizeString(req.body.location);
    const locLenErr = validateLength(location, "Location", {
      min: 2,
      max: 200,
    });
    if (locLenErr)
      return res.status(400).json({ success: false, message: locLenErr });

    /* Validate category — required and must be in approved list */
    const catErr = validateRequired(req.body.category, "Request category");
    if (catErr)
      return res.status(422).json({ success: false, message: catErr });

    const category = sanitizeString(String(req.body.category ?? "").trim());

    /* DATABASE-FIRST VALIDATION.
       The Category collection is the source of truth the requester picked from,
       so an unknown, deactivated or tampered value is rejected here before it
       can reach MongoDB. The stored value is "<Group> > <Label>", so the label
       is the part to look up.

       Two fallbacks keep this from ever locking requesters out mid-migration:
         • isSupportedICTCategory  — accepts the built-in taxonomy, so a request
           still succeeds on a database that has not been seeded yet.
         • allowedCategories       — device-specific categories proposed for the
           chosen device type.
       An empty value is already rejected above by validateRequired. */
    const categoryLabel = category.includes(">")
      ? category.slice(category.indexOf(">") + 1).trim()
      : category;
    const categoryIsActive = categoryLabel
      ? await Category.exists({ name: categoryLabel, active: true })
      : null;

    if (
      !categoryIsActive &&
      !isSupportedICTCategory(category) &&
      !allowedCategories.includes(category)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Unsupported ICT category. Please choose a category from the list.",
      });
    }

    const selectedIssueType = sanitizeString(
      String(req.body.issueType ?? req.body.serviceType ?? "").trim(),
    );
    const customIssueType = sanitizeString(
      String(req.body.otherIssue ?? "").trim(),
    );
    const isCustomIssueType =
      normalizeIssueTypeValue(selectedIssueType) ===
      normalizeIssueTypeValue(OTHER_ISSUE_TYPE);
    const issueTypeValue = isCustomIssueType
      ? customIssueType
      : selectedIssueType;
    if (!issueTypeValue) {
      return res.status(422).json({
        success: false,
        message: "Please select an issue type or service.",
      });
    }

    const legacyServiceTypeValue = sanitizeString(
      String(req.body.serviceType ?? req.body.networkServiceType ?? "").trim(),
    );

    /* Category and Issue Type are two separate fields and are validated as
       such. Both checks read the live catalogue, so a value the dropdown
       offered is never rejected here and one it did not offer cannot be
       smuggled in — Category = Network with Issue Type = "Free text" only
       passes through the documented "Other ICT Issue" escape hatch. */
    const normalizedCategory = normalizeCategoryValue(category);
    if (
      !normalizedCategory ||
      !(await isIssueTypeAccepted(issueTypeValue, category, {
        allowCustom: isCustomIssueType,
      }))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The selected issue type is not valid for the selected category.",
      });
    }

    /* Validate asset if provided */
    let assetId = null;
    const requestedAssetId =
      typeof req.body.asset_id === "string" ? req.body.asset_id.trim() : "";
    if (!requestedAssetId) {
      return res.status(422).json({
        success: false,
        message: "Please select an ICT Asset Tag or No Asset / Not Applicable.",
      });
    }
    if (requestedAssetId !== "none") {
      const assetIdErr = validateObjectId(requestedAssetId, "Asset");
      if (assetIdErr)
        return res
          .status(400)
          .json({ success: false, message: "Invalid asset selection." });

      const asset = await ICTAsset.findById(requestedAssetId);
      if (!asset || asset.status !== "active") {
        return res.status(400).json({
          success: false,
          message:
            "The selected ICT asset is unavailable. Please choose an active asset.",
        });
      }
      assetId = asset._id;
    }

    /* Validate lengths */
    const desc = sanitizeString(req.body.problemDescription);
    const descLenErr = validateLength(desc, "Problem description", {
      min: 5,
      max: 2000,
    });
    if (descLenErr)
      return res.status(400).json({ success: false, message: descLenErr });

    if (req.body.phone) {
      const phoneRegex = /^(09|07)\d{8}$/;
      if (!phoneRegex.test(req.body.phone.trim())) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid Ethiopian mobile number (10 digits, starting with 09 or 07).",
        });
      }
    }

    const payload = {
      requester: requester._id,
      submissionKey,
      department: requester.department || null,
      phone: req.body.phone || requester.phone || null,
      title: req.body.title || null,
      equipmentType: equipmentType,
      deviceType: equipmentType,
      otherDeviceName: otherDeviceName,
      device: req.body.device || null,
      category,
      location: location,
      assetId: assetId,
      serialNumber: req.body.serialNumber || null,
      officeBlock: req.body.officeBlock || null,
      serviceType: legacyServiceTypeValue || null,
      issueType: issueTypeValue,
      networkDevice: req.body.networkDevice || null,
      ipAddress: req.body.ipAddress || null,
      macAddress: req.body.macAddress || null,
      affectedUsers: req.body.affectedUsers || null,
      problemDescription: desc,
      priority: priority,
      status: "submitted",
      attachment: req.file ? req.file.filename : null,
    };

    let ticket;
    try {
      ticket = await Ticket.create(payload);
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.submissionKey) {
        const duplicate = await Ticket.findOne({
          requester: requester._id,
          submissionKey,
        });
        if (duplicate) {
          req.auditEntityId = duplicate._id;
          return res
            .status(200)
            .json(ticketSubmissionResponse(duplicate, requester));
        }
      }
      throw err;
    }
    req.auditEntityId = ticket._id;

    const displayId = displayTicketId(ticket.ticketId);

    /* Notify the requester */
    const requesterNotif = await Notification.create({
      user: requester._id,
      ticket: ticket._id,
      title: `Request Submitted`,
      message: `Your service request #${displayId} has been submitted and is awaiting review.`,
      type: "success",
      notificationType: "request_submitted",
    });
    broadcastNotification(requesterNotif);

    /* Optional email confirmation to the requester (never blocks the flow) */
    if (requester.email) {
      sendEventEmail({
        to: requester.email,
        subject: `Ticket ${displayId} received — Smart ICT Maintenance Management System`,
        text: `Hi ${requester.fullName},\n\nYour service request #${displayId} has been submitted and is awaiting review.\n\nTrack it on the portal using ticket ID ${displayId}.\n\nSmart ICT Maintenance Management System`,
        html: `<p>Hi ${requester.fullName},</p><p>Your service request <strong>#${displayId}</strong> has been submitted and is awaiting review.</p><p>You can track its progress on the portal with ticket ID <strong>${displayId}</strong>.</p><p style="color:#888;">Smart ICT Maintenance Management System</p>`,
      }).catch(() => {}); /* email is best-effort only */
    }

    /* Notify all ICT Admins */
    const admins = await User.find({
      role: "ICT Admin",
      status: "active",
    }).select("_id email");
    await Promise.all(
      admins.map(async (admin) => {
        const isHighPriority = payload.priority === "high";
        const isCritical = payload.priority === "critical";
        const adminNotif = await Notification.create({
          user: admin._id,
          ticket: ticket._id,
          title: isCritical
            ? "Critical Request"
            : isHighPriority
              ? "High Priority Request"
              : "New Service Request",
          message: `Ticket "${displayId}" submitted by ${requester.fullName}. Equipment: ${payload.equipmentType}.`,
          type: isCritical ? "danger" : isHighPriority ? "warning" : "info",
          notificationType: isCritical
            ? "critical_request"
            : isHighPriority
              ? "high_priority_request"
              : "new_service_request",
        });
        broadcastNotification(adminNotif);
        /* Optional email alert to each active admin (best-effort) */
        if (admin.email) {
          sendEventEmail({
            to: admin.email,
            subject: `New ${payload.priority.toUpperCase()} ticket ${displayId}`,
            text: `A new ${payload.priority} priority ticket (${displayId}) was submitted by ${requester.fullName}.\nEquipment: ${payload.equipmentType}.\n\nLog in to review it.\n\nSmart ICT Maintenance Management System`,
            html: `<p>A new <strong>${payload.priority.toUpperCase()}</strong> priority ticket (<strong>${displayId}</strong>) was submitted by ${requester.fullName}.</p><p>Equipment: ${payload.equipmentType}.</p><p>Log in to the admin portal to review it.</p><p style="color:#888;">Smart ICT Maintenance Management System</p>`,
          }).catch(() => {}); /* email is best-effort only */
        }
      }),
    );

    /* Technicians only receive a ticket notification once they are actually
       assigned to it ("New Assignment"); an unassigned technician must not get
       a clickable "New Ticket" notification for a ticket they cannot open. */

    res.status(201).json(ticketSubmissionResponse(ticket, requester));
  } catch (err) {
    console.error("Maintenance request creation failed.");
    res.status(500).json({
      success: false,
      message: "Unable to create maintenance request. Please try again.",
    });
  }
};

/* ── PUT /api/tickets/:id — update ticket fields ──────────── */
const updateTicket = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { priority, equipmentType, status } = req.body;

    /* Only ICT Admin / Admin can change priority.
       Requesters and Technicians cannot modify priority. */
    const isAdmin = req.user.role === "ICT Admin" || req.user.role === "Admin";
    let priorityToUpdate = undefined;

    if (priority !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only administrators can change priority.",
        });
      }
      const priErr = validateEnum(priority, VALID_PRIORITIES, "priority");
      if (priErr)
        return res.status(400).json({ success: false, message: priErr });
      priorityToUpdate = priority;
    }

    if (equipmentType !== undefined) {
      /* Same rules as creation: optional, free text, and "Other ICT Device"
         requires a name. Reusing resolveDeviceFields keeps an admin edit from
         being able to produce a state the request form could never create. */
      const resolved = resolveDeviceFields({
        equipmentType,
        otherDeviceName: req.body.otherDeviceName,
      });
      if (resolved.error) {
        return res
          .status(400)
          .json({ success: false, message: resolved.error });
      }
    }

    if (status !== undefined) {
      const statErr = validateEnum(status, VALID_TICKET_STATUSES, "status");
      if (statErr)
        return res.status(400).json({ success: false, message: statErr });
    }

    /* Get the current ticket to check for priority change, and to read the
       Issue Type it already stores. That stored value is what lets a ticket
       whose Issue Type has since been deactivated still be edited — see
       isIssueTypeAcceptedForUpdate. Without it in the projection an admin
       could not save an unrelated field change on such a ticket. */
    const currentTicket = await Ticket.findById(req.params.id).select(
      "priority requester assignedTechnician ticketId category issueType",
    );
    const priorityChanged =
      priorityToUpdate !== undefined &&
      priorityToUpdate !== currentTicket?.priority;

    const {
      department,
      phone,
      serialNumber,
      officeBlock,
      problemDescription,
      assignedTechnician,
      location,
      identifiedProblem,
      resolutionResponse,
      isFixed,
      reasonIfNotFixed,
      serviceType,
      issueType,
      networkDevice,
      ipAddress,
      macAddress,
      affectedUsers,
      otherDeviceName,
    } = req.body;

    const updateFields = {
      department,
      phone,
      equipmentType,
      serialNumber,
      officeBlock,
      problemDescription,
      assignedTechnician,
      location,
      identifiedProblem,
      resolutionResponse,
      isFixed,
      reasonIfNotFixed,
      serviceType,
      issueType,
      networkDevice,
      ipAddress,
      macAddress,
      affectedUsers,
    };

    /* An admin may correct the Issue Type. Validate it against the ticket's
       own category so the stored pair can never drift apart, and reject the
       whole update rather than persisting an invalid value. */
    if (issueType !== undefined) {
      const issueTypeValue = sanitizeString(String(issueType || "").trim());

      if (!issueTypeValue) {
        return res.status(400).json({
          success: false,
          message: "Please select an issue type or service.",
        });
      }

      if (!currentTicket) {
        return res
          .status(404)
          .json({ success: false, message: "Ticket not found." });
      }

      /* Lenient pairing for updates: tickets created before this taxonomy
         exist carry a free-text category ("Laptop", "Email Problem") and no
         Issue Type at all. Requiring the strict Category→Issue Type pairing
         would leave those records impossible to edit, so an update accepts
         any known Issue Type when the stored category is a legacy one, and
         accepts the ticket's own already-stored Issue Type even if that Issue
         Type has since been deactivated. New submissions always go through the
         strict create check, which rejects anything not currently active. */
      const ticketCategory = currentTicket.category || "";
      if (
        !(await isIssueTypeAcceptedForUpdate(
          issueTypeValue,
          ticketCategory,
          currentTicket.issueType,
        ))
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The selected issue type is not valid for this request's category.",
        });
      }

      updateFields.issueType = issueTypeValue;
    } else {
      /* Not supplied — never touch the stored value. */
      delete updateFields.issueType;
    }

    /* Only write the "Specify Device Name" field when the admin actually sent
       equipmentType, so an unrelated field edit can't silently clear it.
       resolveDeviceFields already decides the correct value (including null for
       any non-"Other" device type). */
    if (equipmentType !== undefined) {
      const resolved = resolveDeviceFields({ equipmentType, otherDeviceName });
      updateFields.equipmentType = resolved.equipmentType;
      updateFields.otherDeviceName = resolved.otherDeviceName;
    }

    if (priorityToUpdate !== undefined) {
      updateFields.priority = priorityToUpdate;
    }

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true,
    });

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    /* Send priority changed notification */
    if (priorityChanged && currentTicket) {
      const displayId = displayTicketId(currentTicket.ticketId);

      /* Notify requester */
      if (currentTicket.requester) {
        const requesterNotif = await Notification.create({
          user: currentTicket.requester,
          ticket: ticket._id,
          title: `Priority Changed`,
          message: `Your service request #${displayId} priority has been changed to ${priority}.`,
          type: "info",
          notificationType: "request_updated",
        });
        broadcastNotification(requesterNotif);
      }

      /* Notify assigned technician */
      if (currentTicket.assignedTechnician) {
        const techNotif = await Notification.create({
          user: currentTicket.assignedTechnician,
          ticket: ticket._id,
          title: `Priority Changed`,
          message: `Ticket "${displayId}" priority has been changed to ${priority}.`,
          type:
            priority === "critical" || priority === "high" ? "warning" : "info",
          notificationType: "priority_changed",
        });
        broadcastNotification(techNotif);
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
            title: `Priority Changed: ${displayId}`,
            message: `Ticket "${displayId}" priority changed to ${priority}.`,
            type: "info",
            notificationType: "technician_activity",
          });
          broadcastNotification(adminNotif);
        }),
      );
    }

    res.json({ success: true, message: "Ticket updated." });
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
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const { status } = req.body;

    if (!status) {
      return res
        .status(422)
        .json({ success: false, message: "Status is required." });
    }

    const statusErr = validateEnum(status, VALID_TICKET_STATUSES, "status");
    if (statusErr)
      return res.status(400).json({ success: false, message: statusErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    /* Track if this is a reopen (from resolved/closed to active status) */
    const isReopen =
      ["resolved", "closed"].includes(ticket.status) &&
      !["resolved", "closed"].includes(status);

    /* ── Diagnostic log (identifies the exact failing request) ── */
    console.log("[TICKET STATUS]", {
      userId: req.user?.id,
      role: req.user?.role,
      ticketId: req.params.id,
      from: ticket.status,
      to: status,
      body: req.body,
    });

    /* ── Validate the workflow transition (Technicians strictly) ──
       Admins keep full control (their flows set status directly). */
    const VALID_TRANSITIONS = {
      submitted: ["under_review", "assigned"],
      under_review: ["assigned"],
      assigned: ["accepted"],
      accepted: ["in_progress"],
      in_progress: ["resolved"],
      resolved: ["closed"],
      closed: [],
    };
    if (req.user.role === "Technician") {
      const allowed = VALID_TRANSITIONS[ticket.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change ticket status from "${ticket.status}" to "${status}".`,
        });
      }
    }

    /* If a technician is updating, they must be the technician assigned to this ticket */
    if (req.user.role === "Technician") {
      const tech = await Technician.findOne({ user: req.user.id });

      const activeAssignment = tech
        ? await Assignment.exists({
            ticket: ticket._id,
            technician: tech._id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          })
        : false;

      const isAssigned =
        activeAssignment ||
        (ticket.assignedTechnician &&
          ticket.assignedTechnician.toString() === req.user.id);

      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          message:
            "Access denied. You can only update tickets assigned to you.",
        });
      }
    }

    const updated = await Ticket.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true },
    )
      .populate("requester", "_id fullName email department")
      .populate("assignedTechnician", "fullName email");

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }

    /* Keep the linked Assignment.status in sync with the ticket lifecycle so
       the data chain stays consistent (accept→accepted, start→in_progress, resolve→completed). */
    const ASSIGN_STATUS = {
      accepted: "accepted",
      in_progress: "in_progress",
      resolved: "completed",
      closed: "completed",
    };
    if (ASSIGN_STATUS[status]) {
      await Assignment.updateMany(
        {
          ticket: ticket._id,
          status: { $in: ["assigned", "accepted", "in_progress"] },
        },
        { $set: { status: ASSIGN_STATUS[status] } },
      );
    }

    const displayId = displayTicketId(updated.ticketId);

    const statusDisplay = {
      submitted: "Submitted",
      under_review: "Under Review",
      assigned: "Assigned",
      accepted: "Accepted",
      in_progress: "In Progress",
      resolved: "Resolved",
      closed: "Closed",
    };
    const requesterNotificationTypes = {
      submitted: "request_received",
      under_review: "request_status_changed",
      assigned: "technician_assigned",
      accepted: "request_accepted",
      in_progress: "request_in_progress",
      resolved: "request_resolved",
      closed: "request_completed",
    };
    const statusMessages = {
      submitted: `Your service request #${displayId} has been submitted and is awaiting review.`,
      under_review: `Your service request #${displayId} is under review.`,
      assigned: `Your service request #${displayId} has been assigned to a technician.`,
      accepted: `Your service request #${displayId} has been accepted by a technician.`,
      in_progress: `Your service request #${displayId} is now in progress.`,
      resolved: `Your service request #${displayId} has been resolved. Please rate the service.`,
      closed: `Your service request #${displayId} has been closed.`,
    };

    /* Determine notification type for reopen case */
    let requesterNotifType =
      requesterNotificationTypes[status] || "request_status_changed";
    let requesterTitle = `Request ${statusDisplay[status] || status}`;
    let requesterMessage =
      statusMessages[status] ||
      `Your service request #${displayId} status has been changed to ${statusDisplay[status] || status}.`;

    if (isReopen) {
      requesterNotifType = "request_reopened";
      requesterTitle = "Request Reopened";
      requesterMessage = `Your service request #${displayId} has been reopened and is now ${statusDisplay[status] || status}.`;
    }

    /* Notify the requester of the status change */
    if (updated.requester?._id) {
      const requesterNotif = await Notification.create({
        user: updated.requester._id,
        ticket: updated._id,
        title: requesterTitle,
        message: requesterMessage,
        type: ["resolved", "closed"].includes(status) ? "success" : "info",
        notificationType: requesterNotifType,
      });
      broadcastNotification(requesterNotif);
    }

    /* Notify ICT Admins when resolved or closed */
    if (["resolved", "closed"].includes(status)) {
      const admins = await User.find({
        role: "ICT Admin",
        status: "active",
      }).select("_id");
      const adminStatusDisplay = status === "resolved" ? "Resolved" : "Closed";
      await Promise.all(
        admins.map(async (admin) => {
          const adminNotif = await Notification.create({
            user: admin._id,
            ticket: updated._id,
            title: `Request ${adminStatusDisplay}: ${displayId}`,
            message: `Ticket "${displayId}" has been marked as ${adminStatusDisplay}.`,
            type: "success",
            notificationType: "request_completed_admin",
          });
          broadcastNotification(adminNotif);
        }),
      );
    }

    /* Notify ICT Admins when reopened */
    if (isReopen) {
      const admins = await User.find({
        role: "ICT Admin",
        status: "active",
      }).select("_id");
      await Promise.all(
        admins.map(async (admin) => {
          const adminNotif = await Notification.create({
            user: admin._id,
            ticket: updated._id,
            title: `Request Reopened: ${displayId}`,
            message: `Ticket "${displayId}" has been reopened and is now ${statusDisplay[status] || status}.`,
            type: "warning",
            notificationType: "request_reopened",
          });
          broadcastNotification(adminNotif);
        }),
      );
    }

    /* Notify assigned technician when reopened */
    if (isReopen && updated.assignedTechnician) {
      const techNotif = await Notification.create({
        user: updated.assignedTechnician,
        ticket: updated._id,
        title: `Request Reopened: ${displayId}`,
        message: `Ticket "${displayId}" has been reopened and is now ${statusDisplay[status] || status}.`,
        type: "warning",
        notificationType: "request_reopened",
      });
      broadcastNotification(techNotif);
    }

    const assignedTechnicians = await getAssignedTechnicians([updated]);
    res.json({
      success: true,
      message: `Status updated to "${statusDisplay[status] || status}".`,
      data: formatTicket(
        updated,
        req.user.role,
        req.user.id,
        assignedTechnicians.get(String(updated._id)),
      ),
    });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/tickets/:id — delete ticket (admin) ──────── */
const deleteTicket = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });
    }
    res.json({ success: true, message: "Ticket deleted." });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: fetch report from body with shared label ───────── */
function pickFeedbackFields(body) {
  const fields = {};
  const textFields = [
    "diagnosis",
    "workPerformed",
    "partsUsed",
    "resolution",
    "reasonNotFixed",
    "recommendation",
    "technicianNotes",
  ];
  textFields.forEach((f) => {
    if (body[f] !== undefined) {
      fields[f] =
        body[f] === null || body[f] === "" ? null : sanitizeString(body[f]);
    }
  });
  if (body.status !== undefined) fields.status = body.status;
  return fields;
}

/* ── Validate a feedback payload, returns error string or null ── */
function validateFeedbackPayload(payload, { isEdit = false } = {}) {
  const required = ["diagnosis", "workPerformed", "resolution"];
  for (const f of required) {
    if (
      !isEdit &&
      validateRequired(
        payload[f],
        f === "diagnosis"
          ? "Diagnosis"
          : f === "workPerformed"
            ? "Work performed"
            : "Resolution summary",
      )
    ) {
      return `${f === "diagnosis" ? "Diagnosis" : f === "workPerformed" ? "Work performed" : "Resolution summary"} is required.`;
    }
  }
  if (!payload.status) return "Current result/status is required.";
  const statusErr = validateEnum(
    payload.status,
    VALID_TECH_FEEDBACK_STATUS,
    "report status",
  );
  if (statusErr) return statusErr;
  if (payload.status === "Not Fixed") {
    if (!payload.reasonNotFixed)
      return "Please provide a reason why the issue is not fixed.";
  } else if (payload.reasonNotFixed) {
    // ignore stray reason when status is not 'Not Fixed' — clears stale value
    payload.reasonNotFixed = null;
  }
  for (const [f, max] of [
    ["diagnosis", 2000],
    ["workPerformed", 2000],
    ["resolution", 1000],
    ["reasonNotFixed", 1000],
    ["recommendation", 1000],
    ["technicianNotes", 2000],
    ["partsUsed", 500],
  ]) {
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
    diagnosis: payload.diagnosis ?? null,
    workPerformed: payload.workPerformed ?? null,
    partsUsed: payload.partsUsed ?? null,
    resolution: payload.resolution ?? null,
    status: payload.status ?? (isEdit ? null : "In Progress"),
    reasonNotFixed: payload.reasonNotFixed ?? null,
    recommendation: payload.recommendation ?? null,
    technicianNotes: payload.technicianNotes ?? null,
    technicianConfirmed: true,
    technician: {
      technicianId: user.id,
      technicianName: user.name || "Technician",
    },
    submittedAt: isEdit
      ? ticket.technicianFeedback?.submittedAt || new Date()
      : new Date(),
    completionDate: payload.status === "Fixed" ? new Date() : null,
  };
}

/* ── Map a feedback report to a ticket status + sync public fields ── */
function applyFeedbackToTicket(ticket, report) {
  ticket.identifiedProblem = report.diagnosis ?? ticket.identifiedProblem;
  ticket.resolutionResponse = report.resolution ?? ticket.resolutionResponse;
  ticket.reasonIfNotFixed = report.reasonNotFixed ?? ticket.reasonIfNotFixed;

  if (report.status === "Fixed") {
    ticket.isFixed = true;
    ticket.status = "resolved";
  } else {
    ticket.isFixed = false;
    ticket.status = "in_progress";
  }
}

/* ── Ownership guard: is the current user's tech assigned to ticket? ──
   Reused by submit / edit / view. Admin is always allowed.
   Includes 'completed' because a technician must be able to view and edit
   reports for tickets they were assigned to, even after the ticket is
   resolved and the assignment status transitions to 'completed'. */
async function canSubmitFeedback(req, ticket) {
  if (req.user.role === "ICT Admin") return true;
  if (req.user.role !== "Technician") return false;

  const tech = await Technician.findOne({ user: req.user.id });
  const hasAssignment = tech
    ? await Assignment.exists({
        ticket: ticket._id,
        technician: tech._id,
        status: { $in: ["assigned", "accepted", "in_progress", "completed"] },
      })
    : false;
  const isAssigned =
    hasAssignment ||
    (ticket.assignedTechnician &&
      String(ticket.assignedTechnician) === String(req.user.id));
  return isAssigned;
}

/* ── POST /api/tickets/:id/technician-feedback — submit report ── */
const submitTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    if (!(await canSubmitFeedback(req, ticket))) {
      return res.status(403).json({
        success: false,
        message:
          "You can only submit a maintenance report for a ticket assigned to you.",
      });
    }

    if (
      ticket.technicianFeedback &&
      ticket.technicianFeedback.technicianConfirmed
    ) {
      if (
        String(ticket.technicianFeedback.technician?.technicianId) ===
        String(req.user.id)
      ) {
        return res.status(200).json({
          success: true,
          message: "Maintenance report was already submitted.",
          data: formatFeedbackReport(ticket.technicianFeedback),
        });
      }
      return res.status(409).json({
        success: false,
        message:
          "A maintenance report already exists for this ticket. Edit it instead.",
      });
    }

    const payload = pickFeedbackFields(req.body);
    const validationErr = validateFeedbackPayload(payload);
    if (validationErr)
      return res.status(422).json({ success: false, message: validationErr });

    const user = req.user;
    const report = buildFeedbackReport(payload, user, ticket, false);
    ticket.technicianFeedback = report;
    applyFeedbackToTicket(ticket, report);
    ticket.markModified("technicianFeedback");
    await ticket.save();

    /* Keep the linked Assignment.status in sync so the technician's
       assignment is no longer counted as active once the ticket resolves. */
    const ASSIGN_FB_MAP = {
      resolved: "completed",
      closed: "completed",
      in_progress: "in_progress",
    };
    if (ASSIGN_FB_MAP[ticket.status]) {
      try {
        await Assignment.updateMany(
          {
            ticket: ticket._id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          },
          { $set: { status: ASSIGN_FB_MAP[ticket.status] } },
        );
      } catch (assignmentError) {
        console.error(
          "Technician report saved, but assignment sync failed:",
          assignmentError,
        );
      }
    }

    /* Notify requester + admins of the outcome */
    try {
      const ticketCode = displayTicketId(ticket.ticketId);
      const notifyTitle =
        report.status === "Fixed"
          ? `Request Resolved`
          : `Request Updated: ${report.status}`;
      const notifyMsg =
        report.status === "Fixed"
          ? `The technician has completed your request #${ticketCode}. Please rate the service.`
          : `The technician has updated the work performed on request #${ticketCode} (${report.status}).`;
      if (ticket.requester) {
        const requesterNotif = await Notification.create({
          user: ticket.requester,
          ticket: ticket._id,
          title: notifyTitle,
          message: notifyMsg,
          type: report.status === "Fixed" ? "success" : "info",
          notificationType:
            report.status === "Fixed" ? "request_resolved" : "request_updated",
        });
        broadcastNotification(requesterNotif);
      }
      if (report.status === "Fixed") {
        const admins = await User.find({
          role: "ICT Admin",
          status: "active",
        }).select("_id");
        await Promise.all(
          admins.map(async (a) => {
            const adminNotif = await Notification.create({
              user: a._id,
              ticket: ticket._id,
              title: `Request Resolved: ${ticketCode}`,
              message: `Ticket "${ticketCode}" resolved by ${user.name || "technician"}.`,
              type: "success",
              notificationType: "request_completed_admin",
            });
            broadcastNotification(adminNotif);
          }),
        );
      }
    } catch (notificationError) {
      console.error(
        "Technician report saved, but notification delivery failed:",
        notificationError,
      );
    }

    res.status(201).json({
      success: true,
      message:
        report.status === "Fixed"
          ? "Maintenance report submitted. Ticket marked as resolved."
          : "Maintenance report submitted.",
      data: formatFeedbackReport(ticket.technicianFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/tickets/:id/technician-feedback — edit report ─── */
const editTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    if (!(await canSubmitFeedback(req, ticket))) {
      return res.status(403).json({
        success: false,
        message:
          "You can only edit a maintenance report for a ticket assigned to you.",
      });
    }

    if (
      !ticket.technicianFeedback ||
      !ticket.technicianFeedback.technicianConfirmed
    ) {
      return res.status(404).json({
        success: false,
        message: "No maintenance report exists yet for this ticket.",
      });
    }

    const payload = pickFeedbackFields(req.body);
    const validationErr = validateFeedbackPayload(payload, { isEdit: true });
    if (validationErr)
      return res.status(422).json({ success: false, message: validationErr });

    const report = buildFeedbackReport(payload, req.user, ticket, true);
    // preserve the original submitter identity when editing
    const existingTech = ticket.technicianFeedback.technician;
    if (
      existingTech &&
      (existingTech.technicianId || existingTech.technicianName)
    ) {
      report.technician = {
        technicianId:
          existingTech.technicianId || report.technician.technicianId,
        technicianName:
          existingTech.technicianName || report.technician.technicianName,
      };
    }
    report.submittedAt = ticket.technicianFeedback.submittedAt || new Date();
    ticket.technicianFeedback = report;
    applyFeedbackToTicket(ticket, report);
    ticket.markModified("technicianFeedback");
    await ticket.save();

    /* Keep the linked Assignment.status in sync with the resolved/closed outcome. */
    const ASSIGN_FB_MAP_EDIT = {
      resolved: "completed",
      closed: "completed",
      in_progress: "in_progress",
    };
    if (ASSIGN_FB_MAP_EDIT[ticket.status]) {
      try {
        await Assignment.updateMany(
          {
            ticket: ticket._id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          },
          { $set: { status: ASSIGN_FB_MAP_EDIT[ticket.status] } },
        );
      } catch (assignmentError) {
        console.error(
          "Technician report updated, but assignment sync failed:",
          assignmentError,
        );
      }
    }

    res.json({
      success: true,
      message: "Maintenance report updated.",
      data: formatFeedbackReport(ticket.technicianFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/technician-feedback — read report ── */
const getTechnicianFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select(
      "technicianFeedback _id assignedTechnician",
    );
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    const report = ticket.technicianFeedback;
    if (!report || !report.technicianConfirmed) {
      return res.status(404).json({
        success: false,
        message: "No maintenance report found for this ticket.",
      });
    }

    // Full report for technicians (assigned) and ICT Admins only.
    if (req.user.role === "Requester") {
      const ownerId = ticket.requester;
      const isOwner = ownerId && String(ownerId) === String(req.user.id);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own ticket reports.",
        });
      }
      // Requesters get only the public subset — no internal notes.
      return res.json({
        success: true,
        data: {
          resolution: report.resolution,
          status: report.status,
          isFixed: report.status === "Fixed",
          completionDate: report.completionDate,
          technician:
            report.technician?.technicianName ||
            report.technician?.name ||
            null,
          submittedAt: report.submittedAt,
        },
      });
    }

    if (
      req.user.role === "Technician" &&
      !(await canSubmitFeedback(req, ticket))
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only view reports for tickets assigned to you.",
      });
    }

    res.json({ success: true, data: formatFeedbackReport(report) });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: format technician feedback for API response ───── */
function formatFeedbackReport(report) {
  return {
    diagnosis: report?.diagnosis ?? null,
    workPerformed: report?.workPerformed ?? null,
    partsUsed: report?.partsUsed ?? null,
    resolution: report?.resolution ?? null,
    status: report?.status ?? null,
    reasonNotFixed: report?.reasonNotFixed ?? null,
    recommendation: report?.recommendation ?? null,
    technicianNotes: report?.technicianNotes ?? null,
    technicianConfirmed: report?.technicianConfirmed ?? false,
    technician_name:
      report?.technician?.technicianName || report?.technician?.name || null,
    submittedAt: report?.submittedAt ?? null,
    completionDate: report?.completionDate ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN SERVICE FEEDBACK  (management/service quality evaluation)
   ═══════════════════════════════════════════════════════════ */

/* ── Pick + sanitize admin feedback fields from body ────────── */
function pickAdminFeedbackFields(body) {
  const fields = {};
  const textFields = [
    "serviceHandlingQuality",
    "technicianPerformance",
    "responseTime",
    "resolutionQuality",
    "documentationQuality",
    "policyCompliance",
    "overallServiceQuality",
    "adminComment",
    "followUpNotes",
    "administrativeRecommendation",
  ];
  textFields.forEach((f) => {
    if (body[f] !== undefined) {
      fields[f] =
        body[f] === null || body[f] === "" ? null : sanitizeString(body[f]);
    }
  });
  return fields;
}

/* ── Validate admin feedback payload → error string or null ──── */
function validateAdminFeedbackPayload(payload, { isEdit = false } = {}) {
  const reqEnums = [
    [
      "serviceHandlingQuality",
      VALID_SERVICE_EVALUATION,
      "Service handling quality",
    ],
    ["technicianPerformance", VALID_TECH_PERFORMANCE, "Technician performance"],
    ["responseTime", VALID_RESPONSE_EVAL, "Response time"],
    ["resolutionQuality", VALID_SERVICE_EVALUATION, "Resolution quality"],
    ["documentationQuality", VALID_SERVICE_EVALUATION, "Documentation quality"],
    [
      "policyCompliance",
      VALID_POLICY_COMPLIANCE,
      "Policy/Procedure compliance",
    ],
    [
      "overallServiceQuality",
      VALID_SERVICE_EVALUATION,
      "Overall service quality",
    ],
  ];
  for (const [f, allowed, label] of reqEnums) {
    if (payload[f]) {
      const e = validateEnum(payload[f], allowed, label);
      if (e) return e;
    }
  }

  if (!isEdit) {
    if (
      validateRequired(
        payload.serviceHandlingQuality,
        "Service handling quality",
      )
    )
      return "Service handling quality is required.";
    if (
      validateRequired(payload.overallServiceQuality, "Overall service quality")
    )
      return "Overall service quality is required.";
    if (validateRequired(payload.adminComment, "Admin comment"))
      return "Admin comment is required.";
  }

  for (const f of [
    "serviceHandlingQuality",
    "technicianPerformance",
    "responseTime",
    "resolutionQuality",
    "documentationQuality",
    "policyCompliance",
    "overallServiceQuality",
  ]) {
    if (payload[f]) {
      const lenErr = validateLength(payload[f], f, { max: 50 });
      if (lenErr) return lenErr;
    }
  }
  if (payload.adminComment) {
    const lenErr = validateLength(payload.adminComment, "Admin comment", {
      max: 2000,
    });
    if (lenErr) return lenErr;
  }
  if (payload.followUpNotes) {
    const lenErr = validateLength(payload.followUpNotes, "Follow-up notes", {
      max: 1000,
    });
    if (lenErr) return lenErr;
  }
  if (payload.administrativeRecommendation) {
    const lenErr = validateLength(
      payload.administrativeRecommendation,
      "Administrative recommendation",
      { max: 1000 },
    );
    if (lenErr) return lenErr;
  }
  return null;
}

/* ── Build the admin feedback report to store ───────────────── */
function buildAdminFeedbackReport(payload, user, isEdit, existing) {
  const keep = (key) => payload[key] ?? (existing ? existing[key] : null);
  return {
    serviceHandlingQuality: keep("serviceHandlingQuality"),
    technicianPerformance: keep("technicianPerformance"),
    responseTime: keep("responseTime"),
    resolutionQuality: keep("resolutionQuality"),
    documentationQuality: keep("documentationQuality"),
    policyCompliance: keep("policyCompliance"),
    overallServiceQuality: keep("overallServiceQuality"),
    followUpRequired:
      payload.followUpRequired ??
      (existing ? existing.followUpRequired : false),
    followUpNotes: keep("followUpNotes"),
    adminComment: keep("adminComment"),
    administrativeRecommendation: keep("administrativeRecommendation"),
    adminConfirmed: payload.adminConfirmed ?? false,
    admin: {
      adminId: user.id,
      adminName: user.name || "ICT Admin",
    },
    submittedAt:
      isEdit && existing ? existing.submittedAt || new Date() : new Date(),
  };
}

/* ── POST /api/tickets/:id/admin-feedback ──────────────────── */
const submitAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    if (ticket.adminFeedback && ticket.adminFeedback.adminConfirmed) {
      return res.status(409).json({
        success: false,
        message:
          "Admin service feedback already exists for this ticket. Edit it instead.",
      });
    }

    const payload = pickAdminFeedbackFields(req.body);
    if (req.body.followUpRequired !== undefined)
      payload.followUpRequired = !!req.body.followUpRequired;
    if (req.body.adminConfirmed !== undefined)
      payload.adminConfirmed = !!req.body.adminConfirmed;

    const validationErr = validateAdminFeedbackPayload(payload);
    if (validationErr)
      return res.status(422).json({ success: false, message: validationErr });

    if (payload.followUpRequired && !payload.followUpNotes) {
      return res.status(422).json({
        success: false,
        message: "Please explain what the follow-up requires.",
      });
    }
    if (!payload.adminConfirmed) {
      return res.status(422).json({
        success: false,
        message: "Please confirm that this service evaluation is accurate.",
      });
    }

    const report = buildAdminFeedbackReport(payload, req.user, false, null);
    ticket.adminFeedback = report;
    ticket.markModified("adminFeedback");
    await ticket.save();

    const displayId = displayTicketId(ticket.ticketId);
    const adminName = req.user.fullName || "ICT Admin";

    /* Notify requester */
    if (ticket.requester) {
      const requesterNotif = await Notification.create({
        user: ticket.requester,
        ticket: ticket._id,
        title: `Admin Review Completed`,
        message: `${adminName} has completed an administrative review of your request #${displayId}.`,
        type: "info",
        notificationType: "request_updated",
      });
      broadcastNotification(requesterNotif);
    }

    /* Notify assigned technician */
    if (ticket.assignedTechnician) {
      const techNotif = await Notification.create({
        user: ticket.assignedTechnician,
        ticket: ticket._id,
        title: `Admin Review Completed`,
        message: `${adminName} has completed an administrative review of ticket #${displayId}.`,
        type: "info",
        notificationType: "technician_activity",
      });
      broadcastNotification(techNotif);
    }

    res.status(201).json({
      success: true,
      message: "Admin service feedback submitted.",
      data: formatAdminFeedbackReport(ticket.adminFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/tickets/:id/admin-feedback ───────────────────── */
const editAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    if (!ticket.adminFeedback || !ticket.adminFeedback.adminConfirmed) {
      return res.status(404).json({
        success: false,
        message: "No admin service feedback exists yet for this ticket.",
      });
    }

    const payload = pickAdminFeedbackFields(req.body);
    if (req.body.followUpRequired !== undefined)
      payload.followUpRequired = !!req.body.followUpRequired;
    if (req.body.adminConfirmed !== undefined)
      payload.adminConfirmed = !!req.body.adminConfirmed;

    const validationErr = validateAdminFeedbackPayload(payload, {
      isEdit: true,
    });
    if (validationErr)
      return res.status(422).json({ success: false, message: validationErr });

    if (payload.followUpRequired && !payload.followUpNotes) {
      return res.status(422).json({
        success: false,
        message: "Please explain what the follow-up requires.",
      });
    }

    const report = buildAdminFeedbackReport(
      payload,
      req.user,
      true,
      ticket.adminFeedback,
    );
    // preserve the original submitter identity when editing
    if (
      ticket.adminFeedback.admin &&
      (ticket.adminFeedback.admin.adminId ||
        ticket.adminFeedback.admin.adminName)
    ) {
      report.admin = {
        adminId: ticket.adminFeedback.admin.adminId || report.admin.adminId,
        adminName:
          ticket.adminFeedback.admin.adminName || report.admin.adminName,
      };
    }
    ticket.adminFeedback = report;
    ticket.markModified("adminFeedback");
    await ticket.save();

    res.json({
      success: true,
      message: "Admin service feedback updated.",
      data: formatAdminFeedbackReport(ticket.adminFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/admin-feedback ───────────────────── */
const getAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select(
      "adminFeedback requester assignedTechnician status ticketId",
    );
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    const report = ticket.adminFeedback;
    if (!report || !report.adminConfirmed) {
      return res.status(404).json({
        success: false,
        message: "No admin service feedback found for this ticket.",
      });
    }

    if (req.user.role === "ICT Admin") {
      return res.json({
        success: true,
        data: formatAdminFeedbackReport(report),
      });
    }

    const ownerId = ticket.requester;
    const isOwner = ownerId && String(ownerId) === String(req.user.id);
    let isAssignedTechnician = false;
    if (req.user.role === "Technician") {
      const tech = await Technician.findOne({ user: req.user.id }).select(
        "_id",
      );
      isAssignedTechnician = !!(
        tech &&
        (await Assignment.exists({
          ticket: ticket._id,
          technician: tech._id,
          status: { $in: ["assigned", "accepted", "in_progress", "completed"] },
        }))
      );
    }
    if (!isOwner && !isAssignedTechnician) {
      return res.status(403).json({
        success: false,
        message:
          "You can only view admin feedback for your own or assigned ticket.",
      });
    }

    res.json({
      success: true,
      data: formatAdminFeedbackPublic(report, ticket),
    });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/tickets/:id/admin-feedback — clear feedback ──
   Removes the embedded admin service feedback from the ticket.
   ICT Admin only. Requires a real MongoDB operation. */
const deleteAdminFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id).select(
      "adminFeedback ticketId",
    );
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    if (!ticket.adminFeedback || !ticket.adminFeedback.adminConfirmed) {
      return res.status(404).json({
        success: false,
        message: "No admin service feedback exists for this ticket.",
      });
    }

    ticket.adminFeedback = undefined;
    await ticket.save();

    res.json({
      success: true,
      message: `Admin service feedback for #${displayTicketId(ticket.ticketId)} deleted.`,
    });
  } catch (err) {
    next(err);
  }
};

/* ── Helper: format admin feedback for API response ────────── */
function formatAdminFeedbackReport(report) {
  return {
    serviceHandlingQuality: report?.serviceHandlingQuality ?? null,
    technicianPerformance: report?.technicianPerformance ?? null,
    responseTime: report?.responseTime ?? null,
    resolutionQuality: report?.resolutionQuality ?? null,
    documentationQuality: report?.documentationQuality ?? null,
    policyCompliance: report?.policyCompliance ?? null,
    overallServiceQuality: report?.overallServiceQuality ?? null,
    followUpRequired: report?.followUpRequired ?? false,
    followUpNotes: report?.followUpNotes ?? null,
    adminComment: report?.adminComment ?? null,
    administrativeRecommendation: report?.administrativeRecommendation ?? null,
    adminConfirmed: report?.adminConfirmed ?? false,
    admin_name: report?.admin?.adminName || report?.admin?.name || null,
    submittedAt: report?.submittedAt ?? null,
  };
}

function formatAdminFeedbackPublic(report, ticket) {
  return {
    admin_name: report?.admin?.adminName || report?.admin?.name || null,
    adminComment: report?.adminComment ?? null,
    followUpRequired: report?.followUpRequired ?? false,
    followUpNotes: report?.followUpNotes ?? null,
    administrativeRecommendation: report?.administrativeRecommendation ?? null,
    submittedAt: report?.submittedAt ?? null,
    ticketId: displayTicketId(ticket?.ticketId),
    ticketStatus: ticket?.status ?? null,
    relatedAction: "Administrative review",
  };
}

/* ── Helper: format ticket for API response ────────────────── */
function formatFeedbackPublic(report) {
  return {
    diagnosis: report?.diagnosis ?? null,
    workPerformed: report?.workPerformed ?? null,
    partsUsed: report?.partsUsed ?? null,
    resolution: report?.resolution ?? null,
    status: report?.status ?? null,
    reasonNotFixed: report?.reasonNotFixed ?? null,
    recommendation: report?.recommendation ?? null,
    technician_name:
      report?.technician?.technicianName || report?.technician?.name || null,
    submittedAt: report?.submittedAt ?? null,
    completionDate: report?.completionDate ?? null,
  };
}

/* ── Helper: one display string for a ticket's device ─────────
   Returns null when no device was recorded, so every view can render a clean
   "not specified" instead of the string "null"/"undefined".

   Handles three shapes:
     • new catalogue pick                     → "Router"
     • "Other ICT Device" + specified name    → "Other ICT Device — Attendance reader"
     • legacy enum "Other" + free-text device → "Other — Attendance reader"
   The legacy branch is what keeps pre-migration tickets displaying their real
   device after the enum was removed. */
function formatDeviceLabel(t) {
  const type = t.equipmentType || null;
  const detail =
    t.otherDeviceName || (type === "Other" ? t.device || null : null) || null;
  if (type && detail) return `${type} — ${detail}`;
  return type || detail || null;
}

function formatTicket(
  t,
  viewerRole = "ICT Admin",
  viewerId = null,
  assignedTechnician = null,
) {
  const isAdmin = viewerRole === "ICT Admin";
  const isTech = viewerRole === "Technician";

  /* Requester service-experience feedback.
     - The requester (owner) and ICT Admin may view the full survey.
     - Technicians/others do not need the requester's evaluation. */
  const requesterId = t.requester?._id || t.requester;
  const isOwner =
    !!viewerId && !!requesterId && String(requesterId) === String(viewerId);
  const canSeeRequesterFeedback = isAdmin || isOwner;
  const rf =
    canSeeRequesterFeedback &&
    t.requesterFeedback &&
    t.requesterFeedback.overallRating
      ? t.requesterFeedback
      : null;

  /* Technician maintenance report:
     - ICT Admin & assigned Technician see the full report (incl. notes).
     - Requesters/others see only the public subset (notes + admin feedback stay hidden). */
  const tf =
    t.technicianFeedback && t.technicianFeedback.technicianConfirmed
      ? t.technicianFeedback
      : null;
  const techFeedback = tf
    ? isAdmin || isTech
      ? formatFeedbackReport(tf)
      : formatFeedbackPublic(tf)
    : null;

  /* Admins see the full evaluation; the requester and assigned technician see
     only the communication and ticket context relevant to them. */
  const canSeeAdminFeedback =
    (isAdmin ||
      isOwner ||
      (isTech &&
        t.assignedTechnician &&
        String(t.assignedTechnician._id || t.assignedTechnician) ===
          String(viewerId))) &&
    t.adminFeedback &&
    t.adminFeedback.adminConfirmed;
  const adminFeedback = canSeeAdminFeedback
    ? isAdmin
      ? formatAdminFeedbackReport(t.adminFeedback)
      : formatAdminFeedbackPublic(t.adminFeedback, t)
    : null;

  return {
    id: t._id,
    ticketId: displayTicketId(t.ticketId),
    requester_id: t.requester?._id || t.requester || null,
    requester_name: t.requester?.fullName || null,
    requester_email: t.requester?.email || null,
    department: t.department,
    phone: t.phone,
    title: t.title,
    /* Device Type is optional, so the raw value is passed through untouched
       (may be null) and deviceLabel is the single string every view should
       render — it already folds in the "Other ICT Device" name and the legacy
       "Other" + device pairing. */
    equipmentType: t.equipmentType || null,
    otherDeviceName: t.otherDeviceName || null,
    deviceLabel: formatDeviceLabel(t),
    device: t.device || null,
    category: t.category,
    location: t.location || "Not provided",
    assetId: t.assetId?._id || t.assetId || null,
    asset_tag: t.assetId?.asset_tag || null,
    asset_name: t.assetId?.asset_name || null,
    serialNumber: t.serialNumber,
    officeBlock: t.officeBlock,
    problemDescription: t.problemDescription,
    /* Issue Type / Service Type — the "what problem or service is required?"
       answer, chosen by the requester as its OWN field, independent of
       category, deviceType and assetId. This is the canonical value; every
       requester / admin / technician / report view reads it from here.
       `serviceType` is still returned because the legacy network reports
       aggregate on it, and legacy records predate this field. */
    issueType: t.issueType || t.serviceType || null,
    serviceType: t.serviceType,
    networkDevice: t.networkDevice,
    ipAddress: t.ipAddress,
    macAddress: t.macAddress,
    affectedUsers: t.affectedUsers,
    priority: t.priority,
    status: t.status,
    assignedTechnician: assignedTechnician?.technicianName || null,
    technician_id: assignedTechnician?.technicianId || null,
    technician_user_id: assignedTechnician?.technicianUserId || null,
    technician_name: assignedTechnician?.technicianName || null,
    technician_email: assignedTechnician?.technicianEmail || null,
    assignment_id: assignedTechnician?.assignmentId || null,
    assignment_status: assignedTechnician?.assignmentStatus || null,
    identifiedProblem: t.identifiedProblem,
    resolutionResponse: t.resolutionResponse,
    isFixed: t.isFixed,
    reasonIfNotFixed: t.reasonIfNotFixed,
    feedbackRating: canSeeRequesterFeedback ? t.feedbackRating : null,
    feedbackComments: canSeeRequesterFeedback ? t.feedbackComments : null,
    attachment: t.attachment,
    requester_feedback: rf
      ? {
          ...formatRequesterFeedback(rf),
          requester_name: t.requester?.fullName || null,
        }
      : null,
    has_requester_feedback: !!rf,
    technician_feedback: techFeedback,
    has_technician_feedback: !!tf,
    admin_feedback: adminFeedback,
    has_admin_feedback: !!adminFeedback,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/* ── Helper: format requester feedback for API response ────── */
function formatRequesterFeedback(report) {
  return {
    requester_name: report?.requesterName || null,
    overallRating: report?.overallRating ?? null,
    serviceQuality: report?.serviceQuality ?? null,
    technicianProfessionalism: report?.technicianProfessionalism ?? null,
    responseTime: report?.responseTime ?? null,
    communication: report?.communication ?? null,
    problemResolution: report?.problemResolution ?? null,
    satisfactionLevel: report?.satisfactionLevel ?? null,
    wouldRecommend: report?.wouldRecommend ?? null,
    comment: report?.comment ?? null,
    suggestions: report?.suggestions ?? null,
    submittedAt: report?.submittedAt ?? null,
  };
}

/* ── Helper: pick + sanitize requester feedback fields ─────── */
function pickRequesterFeedbackFields(body) {
  const fields = {};
  const options = {
    serviceQuality: VALID_QUALITY_LEVELS,
    technicianProfessionalism: VALID_QUALITY_LEVELS,
    responseTime: VALID_RESPONSE_TIME,
    communication: VALID_QUALITY_LEVELS,
    problemResolution: VALID_RESOLUTION,
    satisfactionLevel: VALID_SATISFACTION,
  };
  const textFields = ["comment", "suggestions"];
  textFields.forEach((f) => {
    if (body[f] !== undefined) {
      fields[f] =
        body[f] === null || body[f] === "" ? null : sanitizeString(body[f]);
    }
  });
  if (
    body.overallRating !== undefined &&
    body.overallRating !== null &&
    body.overallRating !== ""
  ) {
    fields.overallRating = body.overallRating;
  }
  if (
    body.wouldRecommend !== undefined &&
    body.wouldRecommend !== null &&
    body.wouldRecommend !== ""
  ) {
    fields.wouldRecommend = body.wouldRecommend;
  }
  for (const [f, allowed] of Object.entries(options)) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "")
      fields[f] = body[f];
  }
  return fields;
}

/* ── Validate requester feedback payload → error string or null ── */
function validateRequesterFeedbackPayload(payload) {
  const rating = Number(payload.overallRating);
  if (
    !payload.overallRating ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return "Overall service rating (1-5) is required.";
  }
  if (validateRequired(payload.serviceQuality, "Service quality"))
    return "Service quality is required.";
  if (validateRequired(payload.comment, "Comment"))
    return "Comment is required.";
  if (
    validateRequired(
      payload.technicianProfessionalism,
      "Technician professionalism",
    )
  )
    return "Technician professionalism is required.";
  if (validateRequired(payload.responseTime, "Response time"))
    return "Response time is required.";
  if (validateRequired(payload.communication, "Communication"))
    return "Communication is required.";
  if (validateRequired(payload.problemResolution, "Problem resolution"))
    return "Problem resolution is required.";
  if (validateRequired(payload.satisfactionLevel, "Satisfaction level"))
    return "Satisfaction level is required.";
  if (validateRequired(payload.wouldRecommend, "Would recommend service"))
    return "Please indicate whether you would recommend the service.";

  const options = {
    serviceQuality: VALID_QUALITY_LEVELS,
    technicianProfessionalism: VALID_QUALITY_LEVELS,
    responseTime: VALID_RESPONSE_TIME,
    communication: VALID_QUALITY_LEVELS,
    problemResolution: VALID_RESOLUTION,
    satisfactionLevel: VALID_SATISFACTION,
  };
  for (const [f, allowed] of Object.entries(options)) {
    if (payload[f]) {
      const e = validateEnum(
        payload[f],
        allowed,
        f.replace(/([A-Z])/g, " $1").toLowerCase(),
      );
      if (e) return e;
    }
  }
  if (
    payload.wouldRecommend &&
    !VALID_RECOMMEND.includes(payload.wouldRecommend)
  ) {
    return "Would recommend must be Yes or No.";
  }
  if (payload.comment) {
    const lenErr = validateLength(payload.comment, "Comment", { max: 1000 });
    if (lenErr) return lenErr;
  }
  if (payload.suggestions) {
    const lenErr = validateLength(payload.suggestions, "Suggestions", {
      max: 1000,
    });
    if (lenErr) return lenErr;
  }
  return null;
}

/* ── POST /api/tickets/:id/requester-feedback — submit ─────── */
const submitRequesterFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    /* Only the Requester (owner) or an ICT Admin may submit. Technicians cannot. */
    if (req.user.role === "Technician") {
      return res.status(403).json({
        success: false,
        message: "Only the requester can submit service feedback.",
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    const ownerId = ticket.requester?._id || ticket.requester;
    const isOwner = String(ownerId) === String(req.user.id);
    if (!isOwner && req.user.role !== "ICT Admin") {
      return res.status(403).json({
        success: false,
        message: "You can only give feedback on your own tickets.",
      });
    }

    if (ticket.requesterFeedback && ticket.requesterFeedback.overallRating) {
      return res.status(409).json({
        success: false,
        message: "Service feedback already submitted for this ticket.",
      });
    }

    if (!["resolved", "closed"].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message:
          "Feedback can only be submitted for resolved or closed tickets.",
      });
    }

    const payload = pickRequesterFeedbackFields(req.body);
    const validationErr = validateRequesterFeedbackPayload(payload);
    if (validationErr)
      return res.status(422).json({ success: false, message: validationErr });

    const requester = await User.findById(ticket.requester).select("fullName");
    if (!requester) {
      return res.status(409).json({
        success: false,
        message: "The ticket requester account no longer exists.",
      });
    }
    ticket.requesterFeedback = {
      requesterId: requester._id,
      requesterName: requester.fullName,
      overallRating: Number(payload.overallRating),
      serviceQuality: payload.serviceQuality,
      technicianProfessionalism: payload.technicianProfessionalism,
      responseTime: payload.responseTime,
      communication: payload.communication,
      problemResolution: payload.problemResolution,
      satisfactionLevel: payload.satisfactionLevel,
      wouldRecommend: payload.wouldRecommend,
      comment: payload.comment || null,
      suggestions: payload.suggestions || null,
      submittedAt: new Date(),
    };
    ticket.markModified("requesterFeedback");
    /* Keep legacy aggregate fields in sync (used by reports + history display). */
    ticket.feedbackRating = Number(payload.overallRating);
    ticket.feedbackComments = payload.comment || null;
    await ticket.save();

    /* Mirror a minimal record into the standalone Feedback collection so the
       existing admin dashboard avg-rating and "recent feedback" report keep working. */
    try {
      const Feedback = require("../models/Feedback");
      const existing = await Feedback.findOne({ request: ticket._id });
      if (existing) {
        existing.user = requester._id;
        existing.rating = Number(payload.overallRating);
        existing.comment = payload.comment || null;
        await existing.save();
      } else {
        await Feedback.create({
          request: ticket._id,
          user: requester._id,
          rating: Number(payload.overallRating),
          comment: payload.comment || null,
        });
      }
    } catch (_) {
      /* non-blocking */
    }

    res.status(201).json({
      success: true,
      message: "Service feedback submitted. Thank you!",
      data: formatRequesterFeedback(ticket.requesterFeedback),
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/tickets/:id/requester-feedback — read ─────────── */
const getRequesterFeedback = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Ticket");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ticket = await Ticket.findById(req.params.id)
      .select("requesterFeedback requester")
      .populate("requester", "fullName");
    if (!ticket)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found." });

    const report = ticket.requesterFeedback;
    if (!report || !report.overallRating) {
      return res.status(404).json({
        success: false,
        message: "No service feedback has been submitted for this ticket.",
      });
    }

    /* Only the ticket owner or an ICT Admin may read the requester's survey. */
    if (req.user.role !== "ICT Admin") {
      const ownerId = ticket.requester?._id || ticket.requester;
      if (String(ownerId) !== String(req.user.id)) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own feedback.",
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...formatRequesterFeedback(report),
        requester_name: ticket.requester?.fullName || null,
      },
    });
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
