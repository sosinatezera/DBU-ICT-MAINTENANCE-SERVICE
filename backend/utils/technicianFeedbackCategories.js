const {
  ICT_CATEGORY_GROUPS,
} = require("./ictCategoryHierarchy");

const TECHNICIAN_FEEDBACK_GROUP = "Feedback";
const TECHNICIAN_FEEDBACK_CATEGORIES = [
  "Technical Issues",
  "Maintenance Process",
  "Equipment and Tools",
  "System Usability",
  "Resource Requests",
  "Workload and Scheduling",
  "Security Concerns",
  "Suggestions for Improvement",
  "Other",
];

const TECHNICIAN_FEEDBACK_CATEGORY_GROUPS = [
  ...ICT_CATEGORY_GROUPS,
  {
    group: TECHNICIAN_FEEDBACK_GROUP,
    categories: TECHNICIAN_FEEDBACK_CATEGORIES,
  },
];

const TECHNICIAN_FEEDBACK_CATEGORY_LABELS =
  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS.flatMap(({ categories }) => categories);

const TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES = [
  "Technical Difficulty",
  "Spare Parts Shortage",
  "Recurring Fault",
  "Resource Problem",
  "Safety Concern",
  "Improvement Suggestion",
];
const TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES = [
  "Submitted",
  "Under Review",
  "Action Required",
  "Resolved",
];

module.exports = {
  TECHNICIAN_FEEDBACK_GROUP,
  TECHNICIAN_FEEDBACK_CATEGORIES,
  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS,
  TECHNICIAN_FEEDBACK_CATEGORY_LABELS,
  TECHNICIAN_MAINTENANCE_FEEDBACK_CATEGORIES,
  TECHNICIAN_MAINTENANCE_FEEDBACK_STATUSES,
};
