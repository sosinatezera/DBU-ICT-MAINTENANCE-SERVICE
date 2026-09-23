/**
 * routes/settings.js
 * System-wide settings — admin only
 * Smart ICT Maintenance Management System
 */

const express = require("express");
const router = express.Router();
const {
  getSettings,
  updateGeneral,
  updateNotifications,
  updateHomeLayout,
} = require("../controllers/settingsController");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");

router.get("/", authenticate, authorize("ICT Admin"), getSettings);
router.put("/general", authenticate, authorize("ICT Admin"), updateGeneral);
router.put(
  "/notifications",
  authenticate,
  authorize("ICT Admin"),
  updateNotifications,
);
router.put(
  "/home-layout",
  authenticate,
  authorize("ICT Admin"),
  updateHomeLayout,
);

module.exports = router;
