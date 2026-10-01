/**
 * routes/issueTypes.js
 * Issue Type CRUD — ICT Admin only.
 *
 * WHAT THIS MANAGES
 * The requester's "Issue Type / Service Type" catalogue: the list behind the
 * dropdown on the request form. It is a separate field from Category, stored
 * separately and validated separately — see services/issueTypeCatalogue.js,
 * which resolves this collection against the built-in catalogue.
 *
 * WHY DELETE DEACTIVATES INSTEAD OF REMOVING
 * Ticket.issueType is a plain String with no foreign key, so a hard delete
 * would leave every historical ticket and report row pointing at a value that
 * no longer exists anywhere. Worse, an empty collection is the trigger for the
 * built-in fallback: deleting all 85 rows would make the entire original
 * catalogue reappear in the requester dropdown. Deactivating keeps the value
 * resolvable for old records while removing it from the dropdown, which is what
 * an admin actually wants. There is deliberately no hard-delete route.
 *
 * The catalogue also cannot be emptied: deactivating the last active entry is
 * refused, because the fallback would immediately re-serve the built-in list and
 * the admin's change would appear to have done nothing.
 *
 * Response contract (same as routes/categories.js):
 *   Success → { success: true, data, message? }   (201 create / 200 read-update-delete)
 *   Error   → { success: false, message }
 *   Status codes: 400 validation, 401 unauthenticated, 403 forbidden,
 *                 404 not found, 409 conflict/duplicate, 500 server error
 */
const express = require("express");
const router = express.Router();
const IssueType = require("../models/IssueType");
const Ticket = require("../models/Ticket");
const { invalidateCatalogueCache } = require("../services/issueTypeCatalogue");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  validateObjectId,
  validateRequired,
  validateLength,
  sanitizeString,
} = require("../middleware/validation");

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Case-insensitive duplicate check so "Hardware Failure" / "hardware failure"
   cannot both exist. Excludes the given id when editing. */
const findDuplicate = (name, excludeId = null) => {
  const filter = { name: new RegExp("^" + escapeRegExp(name) + "$", "i") };
  if (excludeId) filter._id = { $ne: excludeId };
  return IssueType.findOne(filter);
};

/* How many tickets carry each of these values, so the admin UI can warn before
   a deactivation changes nothing for existing history. One grouped pass rather
   than a count per row.

   Lower bound by design: matching is exact-case, because issueType was never
   normalised to a single case on the way in, so a legacy "printer offline" sits
   beside "Printer Offline" and only the latter is counted here. */
const countUsage = async (names) => {
  if (!names.length) return new Map();
  const rows = await Ticket.aggregate([
    { $match: { issueType: { $in: names } } },
    { $group: { _id: "$issueType", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.count]));
};

/* GET /api/issue-types — admin list, paginated.
   ?page &limit &search &status=active|inactive|all
   Defaults to active-only so the list reads as "what requesters can pick now";
   status=all includes deactivated rows so they can be restored. */
router.get(
  "/",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit, 10) || 50),
      );

      const filter = {};
      if (req.query.status === "all") {
        /* no active filter */
      } else if (req.query.status === "inactive") {
        filter.active = false;
      } else {
        filter.active = true;
      }

      const search = sanitizeString(String(req.query.search ?? "").trim());
      if (search) filter.name = new RegExp(escapeRegExp(search), "i");

      const [total, rows] = await Promise.all([
        IssueType.countDocuments(filter),
        IssueType.find(filter)
          .sort({ sortOrder: 1, name: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const usage = await countUsage(rows.map((r) => r.name));
      const data = rows.map((row) => ({
        ...row,
        usageCount: usage.get(row.name) || 0,
      }));

      res.json({
        success: true,
        data,
        meta: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/* GET /api/issue-types/:id — single detail (Edit modal) */
router.get(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Issue Type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const row = await IssueType.findById(req.params.id).lean();
      if (!row)
        return res
          .status(404)
          .json({ success: false, message: "Issue type not found." });

      const usage = await countUsage([row.name]);
      res.json({
        success: true,
        data: { ...row, usageCount: usage.get(row.name) || 0 },
      });
    } catch (err) {
      next(err);
    }
  },
);

/* POST /api/issue-types — create (ICT Admin) */
router.post(
  "/",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const name = sanitizeString(String(req.body.name ?? "").trim());

      const nameErr = validateRequired(name, "Issue type");
      if (nameErr)
        return res.status(422).json({ success: false, message: nameErr });

      const lenErr = validateLength(name, "Issue type", { min: 2, max: 100 });
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });

      const description = req.body.description
        ? sanitizeString(String(req.body.description).trim())
        : null;
      const descLenErr = validateLength(description, "Description", {
        max: 500,
      });
      if (descLenErr)
        return res.status(400).json({ success: false, message: descLenErr });

      const duplicate = await findDuplicate(name);
      if (duplicate)
        return res.status(409).json({
          success: false,
          message: "An issue type with that name already exists.",
        });

      /* Append after the current tail unless the admin picked an explicit
         position, so a new entry never silently jumps into the middle of a
         curated order. */
      let sortOrder = Number(req.body.sortOrder);
      if (!Number.isFinite(sortOrder)) {
        const last = await IssueType.findOne().sort({ sortOrder: -1 }).lean();
        sortOrder = last ? (last.sortOrder ?? 0) + 1 : 0;
      }

      const created = await IssueType.create({
        name,
        description,
        sortOrder,
        active: req.body.active === undefined ? true : !!req.body.active,
        seeded: false,
      });
      req.auditEntityId = created._id;

      invalidateCatalogueCache();
      res.status(201).json({
        success: true,
        message: "Issue type created.",
        data: created,
      });
    } catch (err) {
      /* The unique index is the real guard against a concurrent double submit;
         the findDuplicate above only gives a friendlier message. */
      if (err && err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "An issue type with that name already exists.",
        });
      }
      next(err);
    }
  },
);

/* PUT /api/issue-types/:id — update (ICT Admin) */
router.put(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Issue Type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const row = await IssueType.findById(req.params.id);
      if (!row)
        return res
          .status(404)
          .json({ success: false, message: "Issue type not found." });

      /* Whitelist updates — nothing outside these four fields is writable. */
      const updates = {};

      if (req.body.name !== undefined) {
        const name = sanitizeString(String(req.body.name).trim());
        const nameErr = validateRequired(name, "Issue type");
        if (nameErr)
          return res.status(422).json({ success: false, message: nameErr });
        const lenErr = validateLength(name, "Issue type", { min: 2, max: 100 });
        if (lenErr)
          return res.status(400).json({ success: false, message: lenErr });

        const duplicate = await findDuplicate(name, row._id);
        if (duplicate)
          return res.status(409).json({
            success: false,
            message: "An issue type with that name already exists.",
          });

        updates.name = name;
      }

      if (req.body.description !== undefined) {
        const description = req.body.description
          ? sanitizeString(String(req.body.description).trim())
          : null;
        const descLenErr = validateLength(description, "Description", {
          max: 500,
        });
        if (descLenErr)
          return res.status(400).json({ success: false, message: descLenErr });
        updates.description = description;
      }

      if (req.body.sortOrder !== undefined) {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isFinite(sortOrder))
          return res.status(400).json({
            success: false,
            message: "Sort order must be a number.",
          });
        updates.sortOrder = sortOrder;
      }

      if (req.body.active !== undefined) {
        const active = !!req.body.active;
        /* Refuse to empty the catalogue — see the file header. */
        if (!active && row.active) {
          const activeCount = await IssueType.countDocuments({ active: true });
          if (activeCount <= 1)
            return res.status(409).json({
              success: false,
              message:
                "At least one issue type must stay active. Deactivate this one last, after adding a replacement.",
            });
        }
        updates.active = active;
      }

      const updated = await IssueType.findByIdAndUpdate(row._id, updates, {
        new: true,
        runValidators: true,
      });

      invalidateCatalogueCache();
      res.json({
        success: true,
        message: "Issue type updated.",
        data: updated,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "An issue type with that name already exists.",
        });
      }
      next(err);
    }
  },
);

/* DELETE /api/issue-types/:id — deactivate (ICT Admin).
   See the file header: this is intentionally a soft delete. */
router.delete(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Issue Type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const row = await IssueType.findById(req.params.id);
      if (!row)
        return res
          .status(404)
          .json({ success: false, message: "Issue type not found." });

      if (row.active) {
        const activeCount = await IssueType.countDocuments({ active: true });
        if (activeCount <= 1)
          return res.status(409).json({
            success: false,
            message:
              "At least one issue type must stay active. Deactivate this one last, after adding a replacement.",
          });
      }

      await IssueType.findByIdAndUpdate(row._id, { active: false });
      invalidateCatalogueCache();
      res.json({
        success: true,
        message: "Issue type deactivated. Existing requests keep their value.",
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
