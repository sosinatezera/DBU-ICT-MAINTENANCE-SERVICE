/**
 * models/DeviceType.js
 * Admin-manageable catalogue of ICT device types offered on the
 * maintenance-request form (the "Device Type" selector).
 *
 * Replaces the previous hard-coded 10-item array/enum pair that had to be
 * edited in two places for every new device. Requesters now load the active
 * list from this collection, so an ICT Admin can add or deactivate a device
 * without a code change or a redeploy.
 *
 * Fields: name, category, active, sortOrder (+ timestamps).
 *
 * MIGRATION NOTE — Ticket.equipmentType is a plain String on purpose. It used
 * to be a Mongoose enum, but an enum can only be widened in code and every
 * stored document keeps its original string either way, so dropping the enum
 * loses no data and is what allows the full catalogue to be used. Existing
 * tickets that still carry a legacy value ("Network", "UPS / Power Supply",
 * "Keyboard / Mouse", "Other", ...) continue to read and display unchanged.
 * The catalogue is therefore NOT referenced by _id: a ticket keeps a readable
 * snapshot of the device name, so deleting or deactivating an entry can never
 * rewrite or hide historical requests.
 */

const mongoose = require("mongoose");

/* ── Category whitelist ───────────────────────────────────────
   The thirteen groups the catalogue is organised into. This is the
   institution's own ICT taxonomy: it deliberately spans not only physical
   hardware but also software/OS, connectivity service problems, and
   account/access issues, because that is how the helpdesk actually triages
   an incoming request.
   Kept as a closed list so a typo can never create a stray group, and
   exported on the model so the API and the seed script validate against one
   source of truth. */
const DEVICE_TYPE_CATEGORIES = [
  "Computer & End-User Devices",
  "Printing & Imaging",
  "Network & Connectivity",
  "Server & Data Center",
  "Storage & Backup",
  "Power & Electrical",
  "Software & Operating Systems",
  "Security & Surveillance",
  "Communication",
  "Account & Access",
  "ICT Infrastructure",
  "Internet & Network Services",
  "Other",
];

/* The one catalogue entry that opens an extra free-text field ("Specify
   Device Name"). Shared by the seed script and the API so the trigger string
   can never drift. It matches the "Other" category's single leaf. */
const OTHER_DEVICE_NAME = "Other ICT Issue";

/* Legacy values from the old hard-coded enum. They are NOT seeded as active
   options (the catalogue supersedes them) but the list is kept here so the
   migration is documented in one place and a future admin tool can offer them
   for reactivation. */
const LEGACY_EQUIPMENT_VALUES = [
  "Desktop Computer",
  "Laptop",
  "Network",
  "Printer",
  "Scanner",
  "Monitor",
  "Projector",
  "UPS / Power Supply",
  "Keyboard / Mouse",
  "Other",
];

const deviceTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Device name is required."],
      trim: true,
      maxlength: [100, "Device name must be no more than 100 characters."],
    },
    /* category drives the <optgroup>/heading grouping in the dropdown. */
    category: {
      type: String,
      required: [true, "Category is required."],
      trim: true,
      enum: {
        values: DEVICE_TYPE_CATEGORIES,
        message: "{VALUE} is not a valid device category.",
      },
    },
    /* Inactive entries stay in the database (so history and reports keep their
       meaning) but disappear from the requester dropdown. */
    active: {
      type: Boolean,
      default: true,
    },
    /* Manual ordering within a category. Ties fall back to name, so the
       dropdown order is always deterministic. */
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

/* One row per device name. The controller additionally enforces a
   case-insensitive duplicate check, because a plain unique index would treat
   "router" and "Router" as two different devices. */
deviceTypeSchema.index({ name: 1 }, { unique: true });

/* Serves the requester dropdown query (active, ordered) and the admin list. */
deviceTypeSchema.index({ active: 1, category: 1, sortOrder: 1 });

const DeviceType = mongoose.model("DeviceType", deviceTypeSchema);

/* Exposed on the model (rather than as extra module exports) so a single
   `require('../models/DeviceType')` gives the schema and its constants. */
DeviceType.CATEGORIES = DEVICE_TYPE_CATEGORIES;
DeviceType.OTHER_DEVICE_NAME = OTHER_DEVICE_NAME;
DeviceType.LEGACY_EQUIPMENT_VALUES = LEGACY_EQUIPMENT_VALUES;

module.exports = DeviceType;
