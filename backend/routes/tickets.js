/**
 * routes/tickets.js
 * Ticket CRUD endpoints with role-based access
 */
const express = require('express');
const router  = express.Router();
const {
  getAllTickets, getMyTickets, trackTicket, getTicketById,
  createTicket, updateTicket, updateStatus, deleteTicket,
} = require('../controllers/ticketController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const upload           = require('../config/multer');

/* ICT Admin — all tickets */
router.get('/',              authenticate, authorize('ICT Admin'), getAllTickets);

/* Requester — own tickets */
router.get('/my',            authenticate, getMyTickets);

/* Public tracking by ticket code (no auth required) */
router.get('/track/:ticketId', trackTicket);

/* Single ticket detail */
router.get('/:id',           authenticate, getTicketById);

/* Create ticket (any authenticated user) */
router.post('/',             authenticate, upload.single('attachment'), createTicket);

/* Update ticket fields (ICT Admin) */
router.put('/:id',           authenticate, authorize('ICT Admin'), updateTicket);

/* Update status (ICT Admin + Technician) */
router.patch('/:id/status',  authenticate, authorize('ICT Admin', 'Technician'), updateStatus);

/* Delete ticket (ICT Admin only) */
router.delete('/:id',        authenticate, authorize('ICT Admin'), deleteTicket);

module.exports = router;
