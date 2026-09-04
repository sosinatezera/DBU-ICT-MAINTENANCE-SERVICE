const express = require('express');
const router  = express.Router();
const { getAllTechnicians, getTechnicianById, getMyTechnicianProfile, getMyAssignments, updateTechnician, updateMyTechnicianProfile } = require('../controllers/technicianController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/',               authenticate, getAllTechnicians);
router.get('/my/assignments', authenticate, authorize('Technician'), getMyAssignments);
router.get('/me',             authenticate, authorize('Technician'), getMyTechnicianProfile);
router.put('/me',             authenticate, authorize('Technician'), updateMyTechnicianProfile);
router.get('/:id',            authenticate, getTechnicianById);
router.put('/:id',            authenticate, authorize('ICT Admin', 'Technician'), updateTechnician);

module.exports = router;
