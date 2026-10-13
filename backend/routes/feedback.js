/**
 * routes/feedback.js
 * Feedback — requesters rate resolved tickets
 */
const express = require('express');
const router  = express.Router();
const {
  getAllFeedback,
  getMyTechnicianFeedback,
  getTechnicianFeedback,
  submitTechnicianFeedback,
  updateTechnicianFeedback,
} = require('../controllers/feedbackController');
const { submitRequesterFeedback } = require('../controllers/ticketController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const uploadFeedbackAttachment = require('../config/multerFeedback');
const {
  submitFeedbackSubmission,
  getMyFeedbackSubmissions,
  getAdminFeedbackSubmissions,
  getFeedbackSubmission,
  addFeedbackReply,
  updateFeedbackSubmission,
  downloadFeedbackAttachment,
} = require('../controllers/feedbackSubmissionController');

router.post('/submissions', authenticate, authorize('Requester', 'Technician'), uploadFeedbackAttachment.single('attachment'), submitFeedbackSubmission);
router.get('/submissions/mine', authenticate, authorize('Requester', 'Technician'), getMyFeedbackSubmissions);
/* Keep this static Admin collection route before /submissions/:id so that
   "admin" can never be interpreted as a feedback submission id. */
router
  .route("/submissions/admin")
  .get(authenticate, authorize("ICT Admin"), getAdminFeedbackSubmissions);
router.get('/submissions/:id/attachment', authenticate, downloadFeedbackAttachment);
router.get('/submissions/:id', authenticate, getFeedbackSubmission);
router.post('/submissions/:id/replies', authenticate, authorize('Requester', 'Technician', 'ICT Admin'), addFeedbackReply);
router.patch('/submissions/:id', authenticate, authorize('ICT Admin'), updateFeedbackSubmission);
router.get('/',  authenticate, authorize('ICT Admin'), getAllFeedback);
router.post('/', authenticate, authorize('Requester'), (req, res, next) => {
  req.params.id = req.body?.request_id;
  submitRequesterFeedback(req, res, next);
});
router.get('/technician/mine', authenticate, authorize('Technician'), getMyTechnicianFeedback);
router.patch('/technician/:id', authenticate, authorize('ICT Admin'), updateTechnicianFeedback);
router.get('/technician', authenticate, authorize('ICT Admin'), getTechnicianFeedback);
router.post('/technician', authenticate, authorize('Technician'), submitTechnicianFeedback);

module.exports = router;
