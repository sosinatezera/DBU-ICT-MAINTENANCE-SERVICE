const express = require("express");
const {
  getEligibleRequests,
  submitRequesterFeedback,
  getMyRequesterFeedback,
  getAdminRequesterFeedback,
  updateRequesterFeedbackReview,
} = require("../controllers/requesterFeedbackController");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");

const router = express.Router();

router.use(authenticate);
router.get("/eligible-requests", authorize("Requester"), getEligibleRequests);
router.post("/", authorize("Requester"), submitRequesterFeedback);
router.get("/mine", authorize("Requester"), getMyRequesterFeedback);
router.get("/admin", authorize("ICT Admin"), getAdminRequesterFeedback);
router.patch("/:id/review", authorize("ICT Admin"), updateRequesterFeedbackReview);

module.exports = router;
