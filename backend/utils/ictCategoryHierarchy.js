/* ═══════════════════════════════════════════════════════════════
 * utils/ictCategoryHierarchy.js
 *
 * The single source of truth for the requester's two-part classification:
 *
 *      Category  →  Issue Type
 *
 * Category answers "which high-level ICT area is this?"; Issue Type answers
 * "what specifically is wrong or needed?". They are two separate fields,
 * stored separately, validated separately and displayed separately. Nothing
 * here ever folds one into the other.
 *
 * The frontend holds a mirror (frontend/assets/js/requests.js) because the
 * client is plain <script> tags with no bundler. The two are compared by
 * backend/scripts/verify-issue-type.js so they cannot silently drift.
 * ═══════════════════════════════════════════════════════════════ */

/* ── CATEGORY ──────────────────────────────────────────────────
   Fifteen high-level ICT areas. Specific problems ("Laptop Problem",
   "Printer Problem", "Software Error") belong in the Issue Type list and
   must never appear here. */
const ICT_CATEGORY_GROUPS = [
  {
    group: "ICT Support",
    categories: [
      "Hardware",
      "Software",
      "Network",
      "Printer & Scanner",
      "Account & Access",
      "Email",
      "Internet",
      "Security",
      "System & Operating System",
      "Application",
      "Data & Storage",
      "Mobile & Device",
      "Audio & Video",
      "ICT Infrastructure",
      "Other",
    ],
  },
];

const ICT_CATEGORY_OPTIONS = ICT_CATEGORY_GROUPS.flatMap(
  ({ group, categories }) =>
    categories.map((label) => ({
      group,
      label,
      value: `${group} > ${label}`,
    })),
);

/* Both the stored form ("ICT Support > Hardware") and the bare label
   ("Hardware") are recognised, so hand-submitted values, older records and
   API clients all resolve to the same category. */
const ICT_CATEGORY_VALUES = new Set(
  ICT_CATEGORY_OPTIONS.flatMap((category) => [category.value, category.label]),
);

/* ── ISSUE TYPE / SERVICE TYPE ────────────────────────────────
   One independent catalogue shared by all Categories and Device Types. */

/* ISSUE TYPE / SERVICE TYPE — the single authority.

   One catalogue of exactly 85 values, in catalogue order. The first entry is
   "Hardware Failure" and the last is "Other ICT Issue"; the order written
   here is the order the dropdown renders them in.

   The catalogue is deliberately independent of Category. Choosing a Category
   never narrows, empties or reorders this list — every Category offers all 85
   values. Category and Issue Type remain two separate fields, stored
   separately and validated separately; nothing here ever folds one into the
   other, and no Category name appears in this list.

   The frontend mirrors this list (frontend/assets/js/requests.js) because the
   client is plain <script> tags with no bundler. The two are compared by
   backend/scripts/verify-issue-type.js so they cannot silently drift. */
const ICT_ISSUE_TYPES = [
  "Hardware Failure",
  "Hardware Installation",
  "Hardware Replacement",
  "Hardware Inspection",
  "Computer Not Starting",
  "Laptop Problem",
  "Desktop Problem",
  "Printer Problem",
  "Scanner Problem",
  "Monitor Problem",
  "Keyboard / Mouse Problem",
  "Hard Disk / SSD Problem",
  "RAM / Memory Problem",
  "Power Supply Problem",
  "Battery / Charging Problem",
  "Overheating Problem",
  "USB / Port Problem",
  "Network Adapter Problem",
  "Software Installation",
  "Software Update",
  "Software Configuration",
  "Software Error",
  "Application Not Opening",
  "Application Crashing",
  "Operating System Problem",
  "Driver Problem",
  "License / Activation Problem",
  "Antivirus / Security Software Problem",
  "Software Compatibility Problem",
  "No Internet Connection",
  "Slow Internet",
  "Wi-Fi Problem",
  "LAN / Ethernet Problem",
  "Network Connection Problem",
  "Network Configuration Problem",
  "IP Address Problem",
  "DNS Problem",
  "VPN Problem",
  "Network Access Problem",
  "Password Reset",
  "Account Locked",
  "Login Problem",
  "Email Access Problem",
  "System Access Problem",
  "Permission / Access Rights Problem",
  "User Account Creation",
  "User Account Deactivation",
  "Email Not Sending",
  "Email Not Receiving",
  "Email Configuration",
  "Email Synchronization Problem",
  "Email Storage Problem",
  "Cannot Print",
  "Printer Offline",
  "Print Quality Problem",
  "Printer Configuration",
  "Printer Driver Problem",
  "Scanner Not Working",
  "Scanner Configuration",
  "Malware / Virus Problem",
  "Suspicious Activity",
  "Security Alert",
  "Unauthorized Access",
  "Antivirus Problem",
  "Security Configuration",
  "File Access Problem",
  "File Sharing Problem",
  "Data Backup Problem",
  "Data Recovery Request",
  "Storage Full",
  "File Corruption",
  "Database Access Problem",
  "Projector Problem",
  "Projector Installation",
  "Webcam Problem",
  "Speaker / Audio Problem",
  "Microphone Problem",
  "UPS Problem",
  "CCTV / Camera Problem",
  "Other ICT Equipment Problem",
  "System Configuration",
  "ICT Equipment Inspection",
  "Maintenance Request",
  "Technical Support Request",
  "Other ICT Issue",
];

/* Every Category maps to the same ordered catalogue. It stays a map rather
   than a bare array because that is the shape GET /api/categories/maintenance
   has always sent in its top-level `issueTypes` key, and the frontend has
   always read it as a per-category lookup; flattening either side would be a
   breaking API change for no benefit. Each category gets its own copy so a
   caller mutating the returned list cannot corrupt the shared catalogue. */
const ICT_ISSUE_TYPES_BY_CATEGORY = Object.fromEntries(
  ICT_CATEGORY_GROUPS.flatMap(({ categories }) =>
    categories.map((label) => [label, [...ICT_ISSUE_TYPES]]),
  ),
);

/* Selecting this reveals the "Specify Issue / Service" free-text box, so a
   requester can describe something the list does not cover. */
const OTHER_ISSUE_TYPE = "Other ICT Issue";

/* Built from the catalogue itself, so "is this a known Issue Type at all?" is
   answered from the same 85 values the dropdown offers. If it were built from
   a stale list the "Other" custom-text escape hatch would start accepting real
   catalogue values. */
const ICT_ISSUE_TYPE_LABELS = new Set(ICT_ISSUE_TYPES);

/* Lower-cased index so a differently-cased value still matches its entry. */
const ICT_ISSUE_TYPE_LABELS_LOWER = new Set(
  ICT_ISSUE_TYPES.map((item) => item.toLowerCase()),
);

/* ── Normalisation ───────────────────────────────────────────
   Two deliberately separate helpers so a value is never run through the
   wrong field's rules. Mirrored once on the client. */
function normalizeCategoryValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeIssueTypeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/* Category is stored as "<Group> > <Label>"; recover the bare label, which is
   the key used by the maps above. */
function resolveCategoryLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes(">")) return raw.slice(raw.indexOf(">") + 1).trim();
  return raw;
}

function isSupportedICTCategory(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return (
    ICT_CATEGORY_VALUES.has(raw) ||
    ICT_CATEGORY_VALUES.has(resolveCategoryLabel(raw))
  );
}

/* The Issue Types the chosen Category offers, in catalogue order. Empty when
   no usable category is chosen — the caller then shows the gated
   "Select Category First" state rather than an enabled but empty control.

   Every Category offers the same 85 values, so the result does not actually
   depend on which Category was passed; the parameter is still resolved and
   still returns [] for a missing category, so the gating above keeps working
   and an unknown category never silently yields a full list. */
function getIssueTypesForCategory(category) {
  const label = resolveCategoryLabel(category);
  if (!label) return [];
  const list = ICT_ISSUE_TYPES_BY_CATEGORY[label];
  return list ? [...list] : [];
}
/* Every known Issue Type, in catalogue order. */
function getAllIssueTypes() {
  return [...ICT_ISSUE_TYPES];
}

function isKnownIssueType(value) {
  return ICT_ISSUE_TYPE_LABELS_LOWER.has(normalizeIssueTypeValue(value));
}

/* Category→Issue Type pairing, used when a request is CREATED.

   Category remains required, but it does not restrict the Issue Type: the
   catalogue is shared by every Category, so any of the 85 values is valid
   with any valid Category. What is still refused is an Issue Type that is in
   no catalogue at all — which can only happen for the free-text escape hatch
   ("Other ICT Issue"), whose typed description is what gets stored. */
function isIssueTypeAllowed(issueType, category) {
  const value = String(issueType || "").trim();
  if (!value || !resolveCategoryLabel(category)) return false;
  const target = normalizeIssueTypeValue(value);
  const list = getIssueTypesForCategory(category);
  if (list.some((item) => normalizeIssueTypeValue(item) === target)) return true;
  /* "Other ICT Issue" opens a free-text box whose typed description is sent
     as the Issue Type. Accept such custom text, but never a real catalogue
     value, which can only arrive here as a stale or hand-crafted payload. */
  const allowsCustom = list.some(
    (item) =>
      normalizeIssueTypeValue(item) === normalizeIssueTypeValue(OTHER_ISSUE_TYPE),
  );
  return allowsCustom && !isKnownIssueType(value);
}

/* Lenient pairing, used when an admin UPDATES an existing ticket.

   Requests created before this taxonomy existed carry a free-text category
   ("Laptop", "Email Problem") and no Issue Type at all. Rejecting a pairing
   on such a record would leave it impossible to edit, so an update also
   accepts any known Issue Type when the stored category is a legacy one. A
   modern category never reaches that branch: its list is non-empty, so an
   unknown Issue Type is still refused. */
function isIssueTypeAllowedForUpdate(issueType, category) {
  const value = String(issueType || "").trim();
  if (!value || !resolveCategoryLabel(category)) return false;
  if (isIssueTypeAllowed(value, category)) return true;
  return ICT_ISSUE_TYPES_BY_CATEGORY[resolveCategoryLabel(category)]
    ? false
    : isKnownIssueType(value);
}
/* Kept for call-site compatibility. */
function isIssueTypeForCategory(issueType, category) {
  return isIssueTypeAllowed(issueType, category);
}

function isNetworkICTCategory(value) {
  const label = resolveCategoryLabel(value);
  return ["Network", "Internet", "ICT Infrastructure", "Networking"].includes(
    label,
  );
}

module.exports = {
  ICT_CATEGORY_GROUPS,
  ICT_CATEGORY_OPTIONS,
  ICT_ISSUE_TYPES,
  ICT_ISSUE_TYPES_BY_CATEGORY,
  OTHER_ISSUE_TYPE,
  ICT_ISSUE_TYPE_LABELS,
  isSupportedICTCategory,
  isKnownIssueType,
  getIssueTypesForCategory,
  getAllIssueTypes,
  isIssueTypeAllowed,
  isIssueTypeAllowedForUpdate,
  isIssueTypeForCategory,
  normalizeCategoryValue,
  normalizeIssueTypeValue,
  resolveCategoryLabel,
  isNetworkICTCategory,
};
