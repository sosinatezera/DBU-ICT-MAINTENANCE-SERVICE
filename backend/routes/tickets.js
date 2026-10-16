/**
 * routes/tickets.js
 * Ticket CRUD endpoints with role-based access
 */
const express = require("express");
const router = express.Router();
const {
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
  submitAdminFeedback,
  editAdminFeedback,
  getAdminFeedback,
  getAdminFeedbackEvaluations,
  deleteAdminFeedback,
} = require("../controllers/ticketController");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  authorizeTicketTracking,
} = require("../middleware/authorizeTicketTracking");
const { rateLimit } = require("../middleware/rateLimiter");
const upload = require("../config/multer");

/* Keep tracking attempts throttled, including unauthenticated requests. */
const trackRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

/* ICT Admin — all tickets */
router.get("/", authenticate, authorize("ICT Admin"), getAllTickets);

/* Requester — own tickets */
router.get("/my", authenticate, getMyTickets);

/* Tracking is limited to the requester, assigned technician, or ICT Admin. */
router.get(
  "/track/:ticketId",
  trackRateLimit,
  authenticate,
  authorize("Requester", "Technician", "ICT Admin"),
  authorizeTicketTracking,
  trackTicket,
);

/* Saved admin feedback evaluations list (Feedback page).
   Static path — must stay before "/:id" so "admin-feedback" is never
   interpreted as a ticket id. */
router.get(
  "/admin-feedback",
  authenticate,
  authorize("ICT Admin"),
  getAdminFeedbackEvaluations,
);

/* Single ticket detail */
router.get("/:id", authenticate, getTicketById);

/* Create ticket (authenticated Requester only) */
router.post(
  "/",
  authenticate,
  authorize("Requester"),
  upload.single("attachment"),
  createTicket,
);

/* Update ticket fields (ICT Admin) */
router.put("/:id", authenticate, authorize("ICT Admin"), updateTicket);

/* Update status (ICT Admin + Technician) */
router.patch(
  "/:id/status",
  authenticate,
  authorize("ICT Admin", "Technician"),
  updateStatus,
);

/* Technician Maintenance Report (ICT Admin + assigned Technician)
   Purpose: the technician's official TECHNICAL report of the work done. */
router.post(
  "/:id/technician-feedback",
  authenticate,
  authorize("ICT Admin", "Technician"),
  submitTechnicianFeedback,
);
router.put(
  "/:id/technician-feedback",
  authenticate,
  authorize("ICT Admin", "Technician"),
  editTechnicianFeedback,
);
router.get(
  "/:id/technician-feedback",
  authenticate,
  authorize("ICT Admin", "Technician", "Requester"),
  getTechnicianFeedback,
);

/* Admin Service Feedback (ICT Admin only — no technicians/requesters)
   Purpose: management / service quality evaluation. */
router.post(
  "/:id/admin-feedback",
  authenticate,
  authorize("ICT Admin"),
  submitAdminFeedback,
);
router.put(
  "/:id/admin-feedback",
  authenticate,
  authorize("ICT Admin"),
  editAdminFeedback,
);
router.get("/:id/admin-feedback", authenticate, getAdminFeedback);
router.delete(
  "/:id/admin-feedback",
  authenticate,
  authorize("ICT Admin"),
  deleteAdminFeedback,
);

/* Delete ticket (ICT Admin only) */
router.delete("/:id", authenticate, authorize("ICT Admin"), deleteTicket);

module.exports = router;
