const FEEDBACK_CATEGORIES = [
  "Service Quality",
  "Technician Performance",
  "System Improvement",
  "Complaint",
  "Suggestion",
  "Other",
];

const TECHNICIAN_FEEDBACK_CATEGORIES = [
  "Work Challenges",
  "Equipment Request",
  "Technical Issue",
  "Resource Request",
  "System Improvement",
  "Process Improvement",
  "Suggestion",
  "Other",
];

const ALL_FEEDBACK_CATEGORIES = [
  ...new Set([...FEEDBACK_CATEGORIES, ...TECHNICIAN_FEEDBACK_CATEGORIES]),
];

const FEEDBACK_CATEGORIES_BY_ROLE = {
  Requester: FEEDBACK_CATEGORIES,
  Technician: TECHNICIAN_FEEDBACK_CATEGORIES,
};

module.exports = {
  FEEDBACK_CATEGORIES,
  TECHNICIAN_FEEDBACK_CATEGORIES,
  ALL_FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORIES_BY_ROLE,
};
