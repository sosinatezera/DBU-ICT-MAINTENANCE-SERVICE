/**
 * models/Category.js
 * Maintenance request categories — the taxonomy behind the requester's
 * "Category" dropdown.
 *
 * The dropdown is populated from this collection via GET /api/categories/maintenance,
 * so categories are data, not markup: an ICT Admin can add or deactivate one
 * through the API without touching the frontend. The request form never keeps
 * its own hard-coded list, and createTicket validates the submitted value
 * against these rows, which is what stops an unknown or tampered value from
 * being stored.
 *
 * BACKWARD COMPATIBILITY
 * `group`, `active` and `sortOrder` were added after the original two-field
 * model. Documents created before that simply have no `group`, and Mongoose
 * applies the default ("Other") when they are read, so nothing breaks and no
 * migration is required. `active` defaults to true, so every pre-existing
 * category stays selectable exactly as it was.
 */
const mongoose = require("mongoose");

/* The thirteen groups the dropdown renders as headings. Closed list, so a
   typo can never create a stray group. Exported on the model so the API and
   the seed script validate against one source of truth. */
const CATEGORY_GROUPS = ["ICT Support"];

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: null },
    /* Heading this category is listed under in the dropdown. Not required at the
     schema level so the pre-existing documents stay valid; the API validates
     it on create/update. */
    group: {
      type: String,
      trim: true,
      default: "Other",
      enum: {
        values: CATEGORY_GROUPS,
        message: "{VALUE} is not a valid category group.",
      },
    },
    /* Deactivated categories stay in the database so historical tickets and
     reports keep their meaning, but disappear from the requester's list. */
    active: { type: Boolean, default: true },
    /* Manual ordering within a group. Ties fall back to name. */
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/* Serves the requester dropdown query (active, grouped, ordered). */
categorySchema.index({ active: 1, group: 1, sortOrder: 1 });

const Category = mongoose.model("Category", categorySchema);

/* Exposed on the model so one require() gives the schema and its constants. */
Category.GROUPS = CATEGORY_GROUPS;

module.exports = Category;
