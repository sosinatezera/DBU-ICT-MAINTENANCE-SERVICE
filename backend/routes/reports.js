/**
 * routes/reports.js
 * Reporting and analytics — ICT Admin only
 */
const express = require('express');
const router  = express.Router();
const {
  getDashboardStats, getRequestsByStatus, getRequestsByEquipment,
  getTechnicianPerformance, getRequestsByDepartment, getRequestsByCategory,
  getRequestsByIssueType, getRecentFeedback, getNetworkReports,
  getReportExport,
} = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');

router.get('/dashboard',              authenticate, authorize('ICT Admin'), getDashboardStats);
router.get('/requests-by-status',     authenticate, authorize('ICT Admin'), getRequestsByStatus);
router.get('/requests-by-equipment',  authenticate, authorize('ICT Admin'), getRequestsByEquipment);
router.get('/technician-performance', authenticate, authorize('ICT Admin'), getTechnicianPerformance);
router.get('/requests-by-department', authenticate, authorize('ICT Admin'), getRequestsByDepartment);
router.get('/requests-by-category',   authenticate, authorize('ICT Admin'), getRequestsByCategory);
router.get('/requests-by-issue-type', authenticate, authorize('ICT Admin'), getRequestsByIssueType);
router.get('/recent-feedback',        authenticate, authorize('ICT Admin'), getRecentFeedback);
router.get('/network',                authenticate, authorize('ICT Admin'), getNetworkReports);
router.get('/export',                 authenticate, authorize('ICT Admin'), getReportExport);

module.exports = router;
