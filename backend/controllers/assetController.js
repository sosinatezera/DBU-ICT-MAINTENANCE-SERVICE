/**
 * controllers/assetController.js
 * ICT asset CRUD — admin only
 */
const ICTAsset = require("../models/ICTAsset");
const {
  validateObjectId,
  validateRequired,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_ASSET_STATUSES,
} = require("../middleware/validation");

/* Escape user-supplied search terms so they are treated as literal text. */
const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAllAssets = async (req, res, next) => {
  try {
    const { q, status } = req.query;

    /* Optional status filter, e.g. GET /api/assets?status=active
       Requesters use ?status=active so only available assets appear
       in the Submit Request dropdown (decommissioned/inactive are hidden). */
    const filter = {};
    if (status) filter.status = status;

    /* Search: matches the term against any identifying/informational field. */
    if (q && String(q).trim()) {
      const rx = { $regex: escapeRegex(String(q).trim()), $options: "i" };
      filter.$or = [
        { asset_name: rx },
        { asset_tag: rx },
        { serial_number: rx },
        { model: rx },
        { manufacturer: rx },
        { department: rx },
        { location: rx },
        { category: rx },
      ];
    }

    /* Only ever surface available assets to non-admin viewers.
       Decommissioned assets are treated as retired/inactive. */
    const isAdmin = req.user?.role === "ICT Admin";
    if (!isAdmin) filter.status = "active";

    let assetsQuery = ICTAsset.find(filter).sort({ asset_name: 1 });
    if (!isAdmin) {
      assetsQuery = assetsQuery.select(
        "_id asset_tag asset_name category department location serial_number manufacturer model status",
      );
    }
    const assets = await assetsQuery.lean();
    res.json({ success: true, data: assets });
  } catch (err) {
    console.error("ICT asset list request failed.");
    res.status(500).json({
      success: false,
      message: "Unable to load ICT assets. Please try again.",
    });
  }
};

const getAssetById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Asset");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const asset = await ICTAsset.findById(req.params.id);
    if (!asset)
      return res
        .status(404)
        .json({ success: false, message: "Asset not found." });
    res.json({ success: true, data: asset });
  } catch (err) {
    next(err);
  }
};

const createAsset = async (req, res, next) => {
  try {
    const nameErr = validateRequired(req.body.asset_name, "Asset name");
    if (nameErr)
      return res.status(422).json({ success: false, message: nameErr });

    const tagErr = validateRequired(req.body.asset_tag, "Asset tag");
    if (tagErr)
      return res.status(422).json({ success: false, message: tagErr });

    if (req.body.asset_name) {
      const lenErr = validateLength(
        sanitizeString(req.body.asset_name),
        "Asset name",
        { min: 2, max: 100 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.asset_tag) {
      const lenErr = validateLength(
        sanitizeString(req.body.asset_tag),
        "Asset tag",
        { min: 2, max: 50 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
    }

    if (req.body.status) {
      const statusErr = validateEnum(
        req.body.status,
        VALID_ASSET_STATUSES,
        "status",
      );
      if (statusErr)
        return res.status(400).json({ success: false, message: statusErr });
    }

    const asset = await ICTAsset.create({
      ...req.body,
      asset_name: req.body.asset_name
        ? sanitizeString(req.body.asset_name)
        : req.body.asset_name,
      asset_tag: req.body.asset_tag
        ? sanitizeString(req.body.asset_tag)
        : req.body.asset_tag,
    });
    res
      .status(201)
      .json({ success: true, message: "Asset created.", id: asset._id });
  } catch (err) {
    next(err);
  }
};

const updateAsset = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Asset");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (req.body.asset_name) {
      const lenErr = validateLength(
        sanitizeString(req.body.asset_name),
        "Asset name",
        { min: 2, max: 100 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
      req.body.asset_name = sanitizeString(req.body.asset_name);
    }

    if (req.body.asset_tag) {
      const lenErr = validateLength(
        sanitizeString(req.body.asset_tag),
        "Asset tag",
        { min: 2, max: 50 },
      );
      if (lenErr)
        return res.status(400).json({ success: false, message: lenErr });
      req.body.asset_tag = sanitizeString(req.body.asset_tag);
    }

    if (req.body.status) {
      const statusErr = validateEnum(
        req.body.status,
        VALID_ASSET_STATUSES,
        "status",
      );
      if (statusErr)
        return res.status(400).json({ success: false, message: statusErr });
    }

    const asset = await ICTAsset.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!asset)
      return res
        .status(404)
        .json({ success: false, message: "Asset not found." });
    res.json({ success: true, message: "Asset updated." });
  } catch (err) {
    next(err);
  }
};

const deleteAsset = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "Asset");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const asset = await ICTAsset.findByIdAndDelete(req.params.id);
    if (!asset)
      return res
        .status(404)
        .json({ success: false, message: "Asset not found." });
    res.json({ success: true, message: "Asset deleted." });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
};
