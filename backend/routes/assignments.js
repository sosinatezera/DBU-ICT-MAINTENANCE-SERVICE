/**
 * routes/assignments.js
 * Ticket assignment management — ICT Admin assigns technicians
 */
const express = require('express');
const router  = express.Router();
const { getAllAssignments, createAssignment, updateAssignmentStatus, removeAssignment } = require('../controllers/assignmentController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',             authenticate, authorize('ICT Admin'), getAllAssignments);
router.post('/',            authenticate, authorize('ICT Admin'), createAssignment);
router.patch('/:id/status', authenticate, authorize('ICT Admin', 'Technician'), updateAssignmentStatus);
router.delete('/:id',       authenticate, authorize('ICT Admin'), removeAssignment);

module.exports = router;
