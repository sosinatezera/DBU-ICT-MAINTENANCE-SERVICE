/**
 * models/IssueType.js
 * Maintenance request issue types — the taxonomy behind the requester's
 * "Issue Type / Service Type" dropdown.
 *
 * WHY THIS EXISTS
 * The catalogue originally lived only as a hard-coded array in
 * utils/ictCategoryHierarchy.js (ICT_ISSUE_TYPES). That array remains the
 * single authority for the DEFAULT catalogue and the last line of defence: see
 * resolveIssueTypeCatalogue() in services/issueTypeCatalogue.js, which falls
 * back to it whenever this collection is empty and lazily seeds the 85 rows on
 * first use. That fallback is deliberate — a database problem must never leave
 * the requester form with an empty, permanently unselectable required field.
 *
 * SEPARATE FROM CATEGORY, ON PURPOSE
 * Category answers "which high-level ICT area?"; Issue Type answers "what
 * specifically is wrong or needed?". They are separate fields, stored
 * separately, validated separately, and managed separately. This model has NO
 * category foreign key: the catalogue is shared by every category, so an issue
 * type is never nested inside a category. Do not add one.
 *
 * The 85 seeded values are the ones the taxonomy shipped with. Seeding is
 * idempotent and non-fatal — see seedIssueTypesIfEmpty() in
 * services/issueTypeCatalogue.js, which only runs when the collection is empty
 * and never overwrites a row an admin has since edited.
 */
const mongoose = require("mongoose");

const issueTypeSchema = new mongoose.Schema(
  {
    /* Display text AND the stored value. Unique, so the same issue type can
       never exist twice under different casing or spacing. */
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    /* Deactivated issue types stay in the database so historical tickets and
       reports keep their meaning, but disappear from the requester's list.
       createTicket rejects them outright, so a new ticket can never be filed
       against one. An existing ticket that already uses a deactivated value
       stays editable — the update path accepts the value it already stores. */
    active: { type: Boolean, default: true },
    /* Manual ordering in the dropdown. Ties fall back to name. Seeded from the
       canonical catalogue order, so the dropdown reads Hardware Failure →
       Other ICT Issue unless an admin deliberately reorders it. */
    sortOrder: { type: Number, default: 0 },
    /* True for the 85 rows seeded from the hard-coded catalogue. Lets the
       admin UI show provenance and lets the seeder skip rows an admin has
       since edited. */
    seeded: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/* Serves the requester dropdown query (active, ordered) and the admin list's
   case-insensitive name search. */
issueTypeSchema.index({ active: 1, sortOrder: 1, name: 1 });

const IssueType = mongoose.model("IssueType", issueTypeSchema);

module.exports = IssueType;
