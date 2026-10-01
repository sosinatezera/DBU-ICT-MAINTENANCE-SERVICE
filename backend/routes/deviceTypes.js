/**
 * routes/deviceTypes.js
 * Device Type catalogue CRUD — the source of choices for the required
 * Device Type selector and its dependent category list.
 *
 *   GET    /api/device-types            — ACTIVE device types (any authenticated
 *                                         user; this is what the request form
 *                                         dropdown loads)
 *   GET    /api/device-types/all        — every entry incl. deactivated (ICT Admin)
 *   GET    /api/device-types/:id        — single entry (ICT Admin)
 *   POST   /api/device-types            — add (ICT Admin)
 *   PUT    /api/device-types/:id        — edit name / category / sort order (ICT Admin)
 *   PATCH  /api/device-types/:id/status — activate or deactivate (ICT Admin)
 *   DELETE /api/device-types/:id        — remove (ICT Admin), refused while in use
 *
 * Read (any authenticated user) / write (ICT Admin) mirrors routes/categories.js.
 *
 * Response contract (consistent with the rest of the project):
 *   Success → { success: true,  data, message? }   (201 create / 200 read-update-delete)
 *   Error   → { success: false, message }
 *   Status codes: 400 validation, 401 unauthenticated, 403 forbidden,
 *                 404 not found, 409 conflict, 422 required, 500 server error
 *
 * WHY THIS IS SAFE FOR EXISTING TICKETS
 * Ticket.equipmentType stores the device NAME as a string, not a reference to
 * a row here. Editing, deactivating or deleting an entry therefore never
 * rewrites or hides a ticket that already recorded that device. DELETE is the
 * one destructive operation, so it refuses to run while any ticket still uses
 * the name and tells the admin to deactivate instead.
 */
const express = require("express");
const router = express.Router();
const DeviceType = require("../models/DeviceType");
const Ticket = require("../models/Ticket");
const {
  getAllDeviceTypeCategories,
  resolveDeviceTypeCategories,
} = require("../utils/deviceTypeCategories");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const {
  validateObjectId,
  validateRequired,
  validateLength,
  sanitizeString,
} = require("../middleware/validation");

const CATEGORIES = DeviceType.CATEGORIES;
const OTHER_DEVICE_NAME = DeviceType.OTHER_DEVICE_NAME;

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Case-insensitive duplicate check so "Router" / "router" can't both exist.
   Excludes the given id when editing. */
const findDuplicate = (name, excludeId = null) => {
  const filter = { name: new RegExp("^" + escapeRegExp(name) + "$", "i") };
  if (excludeId) filter._id = { $ne: excludeId };
  return DeviceType.findOne(filter);
};

/* Shape a stored document for the API. Sorts are applied in the query. */
const formatDeviceType = (d) => ({
  id: d._id,
  name: d.name,
  category: d.category,
  active: d.active,
  sortOrder: d.sortOrder,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/* Group the active catalogue for the requester dropdown.
   Returns [{ category, devices: [{ id, name }] }] in category order. */
const groupForDropdown = (docs) => {
  const byCategory = new Map();
  for (const d of docs) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category).push({
      id: d._id,
      name: d.name,
      requiresCustomName: d.name === OTHER_DEVICE_NAME,
    });
  }
  /* CATEGORIES order is the authored display order; anything unexpected (a
     hand-inserted row, a future category) is appended rather than dropped. */
  const ordered = CATEGORIES.filter((c) => byCategory.has(c));
  for (const c of byCategory.keys()) if (!ordered.includes(c)) ordered.push(c);
  return ordered.map((category) => ({
    category,
    devices: byCategory.get(category),
  }));
};

/* ── GET /api/device-types — active only, grouped (the request form) ── */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const docs = await DeviceType.find({ active: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json({ success: true, data: groupForDropdown(docs) });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/device-types/categories — allowed issue categories ── */
router.get("/categories", authenticate, async (req, res, next) => {
  try {
    const requestedDeviceType = String(req.query.deviceType ?? "").trim();
    if (!requestedDeviceType) {
      return res.json({
        success: true,
        data: getAllDeviceTypeCategories(),
      });
    }

    const deviceType = sanitizeString(requestedDeviceType);
    const categories = await resolveDeviceTypeCategories(deviceType);
    if (!categories) {
      return res
        .status(400)
        .json({ success: false, message: "Unsupported device type." });
    }

    res.json({ success: true, data: categories });
  } catch (err) {
    console.error("Device Type category lookup failed.");
    res.status(500).json({
      success: false,
      message: "Could not load categories. Please try again.",
    });
  }
});

/* ── GET /api/device-types/all — active + deactivated (admin table) ──
   Declared before /:id so "all" is never parsed as an id. */
router.get(
  "/all",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const docs = await DeviceType.find()
        .sort({ category: 1, sortOrder: 1, name: 1 })
        .lean();
      res.json({
        success: true,
        data: docs.map(formatDeviceType),
        categories: CATEGORIES,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ── GET /api/device-types/:id — single entry ── */
router.get(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Device type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const doc = await DeviceType.findById(req.params.id).lean();
      if (!doc)
        return res
          .status(404)
          .json({ success: false, message: "Device type not found." });
      res.json({ success: true, data: formatDeviceType(doc) });
    } catch (err) {
      next(err);
    }
  },
);

/* ── POST /api/device-types — create (ICT Admin) ── */
router.post(
  "/",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const name = sanitizeString(String(req.body.name ?? "").trim());
      const category = sanitizeString(String(req.body.category ?? "").trim());

      const nameErr = validateRequired(name, "Device name");
      if (nameErr)
        return res.status(422).json({ success: false, message: nameErr });

      const nameLenErr = validateLength(name, "Device name", {
        min: 2,
        max: 100,
      });
      if (nameLenErr)
        return res.status(400).json({ success: false, message: nameLenErr });

      const categoryErr = validateRequired(category, "Category");
      if (categoryErr)
        return res.status(422).json({ success: false, message: categoryErr });

      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}.`,
        });
      }

      const duplicate = await findDuplicate(name);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "A device type with that name already exists.",
        });
      }

      /* sortOrder is optional: append to the end of the chosen category so a
       newly added device never scrambles the existing order. */
      let sortOrder = Number.parseInt(req.body.sortOrder, 10);
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        const last = await DeviceType.findOne({ category })
          .sort({ sortOrder: -1 })
          .select("sortOrder")
          .lean();
        sortOrder = (last?.sortOrder ?? 0) + 10;
      }

      const active =
        req.body.active === undefined
          ? true
          : req.body.active === true || req.body.active === "true";

      const doc = await DeviceType.create({
        name,
        category,
        active,
        sortOrder,
      });
      res.status(201).json({
        success: true,
        message: "Device type added.",
        data: formatDeviceType(doc),
      });
    } catch (err) {
      /* Surface a race on the unique index as the same 409 the pre-check gives. */
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "A device type with that name already exists.",
        });
      }
      next(err);
    }
  },
);

/* ── PUT /api/device-types/:id — update (ICT Admin) ── */
router.put(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Device type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const doc = await DeviceType.findById(req.params.id);
      if (!doc)
        return res
          .status(404)
          .json({ success: false, message: "Device type not found." });

      /* Whitelist updates — only name/category/sortOrder are mutable here.
       Activation is deliberately a separate PATCH endpoint. */
      const updates = {};

      if (req.body.name !== undefined) {
        const name = sanitizeString(String(req.body.name).trim());
        const nameLenErr = validateLength(name, "Device name", {
          min: 2,
          max: 100,
        });
        if (nameLenErr)
          return res.status(400).json({ success: false, message: nameLenErr });

        const duplicate = await findDuplicate(name, doc._id);
        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: "A device type with that name already exists.",
          });
        }
        updates.name = name;
      }

      if (req.body.category !== undefined) {
        const category = sanitizeString(String(req.body.category).trim());
        const categoryErr = validateRequired(category, "Category");
        if (categoryErr)
          return res.status(422).json({ success: false, message: categoryErr });
        if (!CATEGORIES.includes(category)) {
          return res.status(400).json({
            success: false,
            message: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}.`,
          });
        }
        updates.category = category;
      }

      if (req.body.sortOrder !== undefined) {
        const sortOrder = Number.parseInt(req.body.sortOrder, 10);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          return res.status(400).json({
            success: false,
            message: "Sort order must be a whole number of 0 or more.",
          });
        }
        updates.sortOrder = sortOrder;
      }

      const updated = await DeviceType.findByIdAndUpdate(doc._id, updates, {
        new: true,
        runValidators: true,
      });
      res.json({
        success: true,
        message: "Device type updated.",
        data: formatDeviceType(updated),
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "A device type with that name already exists.",
        });
      }
      next(err);
    }
  },
);

/* ── PATCH /api/device-types/:id/status — activate / deactivate (ICT Admin) ──
   Deactivating is the reversible, history-safe option: the row stays, so any
   ticket already recorded against it keeps its readable device name. */
router.patch(
  "/:id/status",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Device type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const doc = await DeviceType.findById(req.params.id);
      if (!doc)
        return res
          .status(404)
          .json({ success: false, message: "Device type not found." });

      if (req.body.active === undefined) {
        return res.status(422).json({
          success: false,
          message: 'An "active" boolean is required.',
        });
      }
      const active = req.body.active === true || req.body.active === "true";

      if (doc.active === active) {
        return res.json({
          success: true,
          message: active
            ? "Device type is already active."
            : "Device type is already deactivated.",
          data: formatDeviceType(doc),
        });
      }

      doc.active = active;
      await doc.save();

      res.json({
        success: true,
        message: active
          ? `"${doc.name}" is now available on the request form.`
          : `"${doc.name}" was removed from the request form. Existing requests are unchanged.`,
        data: formatDeviceType(doc),
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ── DELETE /api/device-types/:id — remove (ICT Admin) ──
   Allowed only while no ticket references the name. Tickets store the name as
   a string, so the guard is about not removing a value that is still part of
   the request history/reports — and the fix is always "deactivate", not
   "delete". */
router.delete(
  "/:id",
  authenticate,
  authorize("ICT Admin"),
  async (req, res, next) => {
    try {
      const idErr = validateObjectId(req.params.id, "Device type");
      if (idErr)
        return res.status(400).json({ success: false, message: idErr });

      const doc = await DeviceType.findById(req.params.id);
      if (!doc)
        return res
          .status(404)
          .json({ success: false, message: "Device type not found." });

      const inUse = await Ticket.countDocuments({ equipmentType: doc.name });
      if (inUse > 0) {
        return res.status(409).json({
          success: false,
          message: `"${doc.name}" is used by ${inUse} existing request${inUse === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead — it will disappear from the request form while the existing requests keep their device name.`,
          data: { inUse },
        });
      }

      await DeviceType.findByIdAndDelete(doc._id);
      res.json({ success: true, message: `"${doc.name}" deleted.` });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
