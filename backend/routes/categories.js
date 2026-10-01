/**
 * routes/categories.js
 * Category CRUD — view for any authenticated user, write for ICT Admin
 *
 * Response contract (consistent with the rest of the project):
 *   Success → { success: true,  data, message? }   (201 create / 200 read-update-delete)
 *   Error   → { success: false, message }
 *   Status codes: 400 validation, 401 unauthenticated, 403 forbidden,
 *                 404 not found, 409 duplicate name, 500 server error
 */
const express = require("express");
const router = express.Router();
const Category = require("../models/Category");
const {
  ICT_CATEGORY_GROUPS,
} = require("../utils/ictCategoryHierarchy");
const { resolveIssueTypeMap } = require("../services/issueTypeCatalogue");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  validateObjectId,
  validateRequired,
  validateLength,
  sanitizeString,
} = require("../middleware/validation");

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Case-insensitive duplicate check so "Hardware" / "hardware" can't both exist.
   excludes the given id when editing. */
const findDuplicate = (name, excludeId = null) => {
  const filter = { name: new RegExp("^" + escapeRegExp(name) + "$", "i") };
  if (excludeId) filter._id = { $ne: excludeId };
  return Category.findOne(filter);
};

/* GET /api/categories — list (any authenticated user; the request form uses this) */
router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await Category.find().sort({ name: 1 }).lean(),
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/categories/maintenance — the requester's Category dropdown.

   Serves the canonical taxonomy from utils/ictCategoryHierarchy.js, plus any
   extra active categories an ICT Admin has added through the API. See the
   handler comment below for why this is taxonomy-authoritative rather than
   collection-first.

   Declared BEFORE /:id so "maintenance" is never parsed as an id. */
router.get("/maintenance", authenticate, async (req, res, next) => {
  try {
    /* TWO LISTS, TWO SOURCES.

       Category — TAXONOMY-AUTHORITATIVE.
       The requester's Category dropdown is the 15 high-level ICT areas defined
       in utils/ictCategoryHierarchy.js. Those two lists only work together: a
       Category with no matching Issue Type entry would leave a required,
       permanently unselectable field on the form. So Category is served from
       code, and the Category collection is NOT the source — it still backs the
       admin Category manager (GET /api/categories) and the per-category report,
       and every existing request keeps the category string it was saved with,
       including the legacy free-text values predating this taxonomy.

       ADMIN-ADDED CATEGORIES ARE STILL HONOURED: any active category the
       collection holds that is not part of the canonical fifteen is appended
       under its own heading, so an ICT Admin adding a category through the
       API still sees it in the requester form.

       Issue Type — DATABASE-FIRST.
       The catalogue is managed through the admin Issue Type API and read from
       the IssueType collection, so an admin can add, rename, reorder or
       deactivate one without a code change. resolveIssueTypeMap() falls back to
       the built-in catalogue of 85 whenever the collection is empty or the
       database is unreachable, so this field can never be rendered empty. The
       catalogue stays independent of Category: every Category is offered the
       same ordered list. */
    const canonical = new Set(
      ICT_CATEGORY_GROUPS.flatMap(({ categories }) => categories),
    );
    const extraDocs = await Category.find({ active: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const groups = ICT_CATEGORY_GROUPS.map(({ group, categories }) => ({
      group,
      categories: categories.map((label) => ({
        label,
        value: `${group} > ${label}`,
      })),
    }));

    const extras = extraDocs.filter((doc) => !canonical.has(doc.name));
    if (extras.length) {
      const byGroup = new Map();
      for (const doc of extras) {
        const group = doc.group || "Other";
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push({
          label: doc.name,
          value: `${group} > ${doc.name}`,
        });
      }
      for (const [group, categories] of byGroup) {
        const existing = groups.find((g) => g.group === group);
        if (existing) existing.categories.push(...categories);
        else groups.push({ group, categories });
      }
    }

    res.json({
      success: true,
      data: groups,
      issueTypes: await resolveIssueTypeMap(),
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/categories/:id — single category detail (View modal) */
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Category");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const cat = await Category.findById(req.params.id);
    if (!cat)
      return res
        .status(404)
        .json({ success: false, message: "Category not found." });
    res.json({ success: true, data: cat });
  } catch (err) {
    next(err);
  }
});

/* POST /api/categories — create (ICT Admin) */
router.post(
  "/",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const name = sanitizeString(String(req.body.name ?? "").trim());
      const description = req.body.description
        ? sanitizeString(String(req.body.description).trim())
        : null;

      const nameErr = validateRequired(name, "Name");
      if (nameErr)
        return res.status(422).json({ success: false, message: nameErr });

      const lenErr = validateLength(name, "Name", { min: 2, max: 100 });
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });

      const descLenErr = validateLength(description, "Description", {
        max: 500,
      });
      if (descLenErr)
        return res.status(400).json({ success: false, message: descLenErr });

      const duplicate = await findDuplicate(name);
      if (duplicate)
        return res.status(409).json({
          success: false,
          message: "A category with that name already exists.",
        });

      const cat = await Category.create({ name, description });
      res
        .status(201)
        .json({ success: true, message: "Category created.", id: cat._id });
    } catch (err) {
      next(err);
    }
  },
);

/* PUT /api/categories/:id — update (ICT Admin) */
router.put(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Category");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const cat = await Category.findById(req.params.id);
      if (!cat)
        return res
          .status(404)
          .json({ success: false, message: "Category not found." });

      /* Whitelist updates — only name/description are mutable. */
      const updates = {};
      if (req.body.name !== undefined) {
        const name = sanitizeString(String(req.body.name).trim());
        const lenErr = validateLength(name, "Name", { min: 2, max: 100 });
        if (lenErr)
          return res.status(400).json({ success: false, message: lenErr });

        const duplicate = await findDuplicate(name, cat._id);
        if (duplicate)
          return res.status(409).json({
            success: false,
            message: "A category with that name already exists.",
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

      const updated = await Category.findByIdAndUpdate(cat._id, updates, {
        new: true,
        runValidators: true,
      });
      res.json({ success: true, message: "Category updated.", data: updated });
    } catch (err) {
      next(err);
    }
  },
);

/* DELETE /api/categories/:id — remove (ICT Admin) */
router.delete(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Category");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const cat = await Category.findByIdAndDelete(req.params.id);
      if (!cat)
        return res
          .status(404)
          .json({ success: false, message: "Category not found." });
      res.json({ success: true, message: "Category deleted." });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
