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
  getSystemOverview,
} = require("../controllers/settingsController");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  getOperationsStatus,
  getMaintenanceStatus,
  updateMaintenance,
  listBackups,
  createBackup,
  downloadBackup,
} = require("../controllers/systemOperationsController");

router.get("/", authenticate, authorize("ICT Admin"), getSettings);
router.get("/overview", authenticate, authorize("ICT Admin"), getSystemOverview);
router.get("/operations", authenticate, authorize("ICT Admin"), getOperationsStatus);
router.get("/maintenance", authenticate, authorize("ICT Admin"), getMaintenanceStatus);
router.put("/maintenance", authenticate, authorize("ICT Admin"), updateMaintenance);
router.get("/backups", authenticate, authorize("ICT Admin"), listBackups);
router.post("/backups", authenticate, authorize("ICT Admin"), createBackup);
router.get("/backups/:id/download", authenticate, authorize("ICT Admin"), downloadBackup);
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
