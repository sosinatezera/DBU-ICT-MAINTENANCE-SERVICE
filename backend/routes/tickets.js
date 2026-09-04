/**
 * routes/tickets.js
 * Ticket CRUD endpoints with role-based access
 */
const express = require('express');
const router  = express.Router();
const {
  getAllTickets, getMyTickets, trackTicket, getTicketById,
  createTicket, updateTicket, updateStatus, deleteTicket,
  submitTechnicianFeedback, editTechnicianFeedback, getTechnicianFeedback,
  submitRequesterFeedback, getRequesterFeedback,
  submitAdminFeedback, editAdminFeedback, getAdminFeedback, deleteAdminFeedback,
} = require('../controllers/ticketController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const { rateLimit }    = require('../middleware/rateLimiter');
const upload           = require('../config/multer');

/* Public tracking is open to anyone, so throttle it tightly to prevent
   brute-force enumeration of the sequential ticket codes. */
const trackRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

/* ICT Admin — all tickets */
router.get('/',              authenticate, authorize('ICT Admin'), getAllTickets);

/* Requester — own tickets */
router.get('/my',            authenticate, getMyTickets);

/* Public tracking by ticket code (no auth required, rate-limited) */
router.get('/track/:ticketId', trackRateLimit, trackTicket);

/* Single ticket detail */
router.get('/:id',           authenticate, getTicketById);

/* Create ticket (any authenticated user) */
router.post('/',             authenticate, upload.single('attachment'), createTicket);

/* Update ticket fields (ICT Admin) */
router.put('/:id',           authenticate, authorize('ICT Admin'), updateTicket);

/* Update status (ICT Admin + Technician) */
router.patch('/:id/status',  authenticate, authorize('ICT Admin', 'Technician'), updateStatus);

/* Technician Maintenance Report (ICT Admin + assigned Technician)
   Purpose: the technician's official TECHNICAL report of the work done. */
router.post('/:id/technician-feedback', authenticate, authorize('ICT Admin', 'Technician'), submitTechnicianFeedback);
router.put('/:id/technician-feedback',  authenticate, authorize('ICT Admin', 'Technician'), editTechnicianFeedback);
router.get('/:id/technician-feedback',  authenticate, getTechnicianFeedback);

/* Requester Service Feedback (Requester owner + ICT Admin)
   Purpose: the requester's evaluation of the ICT SERVICE they received. */
router.post('/:id/requester-feedback', authenticate, submitRequesterFeedback);
router.get('/:id/requester-feedback', authenticate, getRequesterFeedback);

/* Admin Service Feedback (ICT Admin only — no technicians/requesters)
   Purpose: management / service quality evaluation. */
router.post('/:id/admin-feedback', authenticate, authorize('ICT Admin'), submitAdminFeedback);
router.put('/:id/admin-feedback',  authenticate, authorize('ICT Admin'), editAdminFeedback);
router.get('/:id/admin-feedback',  authenticate, getAdminFeedback);
router.delete('/:id/admin-feedback', authenticate, authorize('ICT Admin'), deleteAdminFeedback);

/* Delete ticket (ICT Admin only) */
router.delete('/:id',        authenticate, authorize('ICT Admin'), deleteTicket);

module.exports = router;
