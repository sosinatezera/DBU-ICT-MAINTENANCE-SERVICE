const express = require('express');
const router  = express.Router();
const { getAllTechnicians, getTechnicianById, getMyAssignments, updateTechnician } = require('../controllers/technicianController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',               authenticate, getAllTechnicians);
router.get('/my/assignments', authenticate, authorize('Technician'), getMyAssignments);
router.get('/:id',            authenticate, getTechnicianById);
router.put('/:id',            authenticate, authorize('ICT Admin'), updateTechnician);

module.exports = router;
