/**
 * scripts/seedDeviceTypes.js — Idempotent Device Type catalogue seed
 * Populates the admin-manageable ICT catalogue: 13 categories / 83 entries.
 *
 * Usage:  node scripts/seedDeviceTypes.js
 * Runs:   npm run seed:device-types
 *
 * WHAT THIS CATALOGUE IS FOR
 * The requester's New Request form deliberately shows ten FIXED image cards
 * and does NOT call this API — the cards must render instantly and a request
 * must never be blocked because device data failed to load. This collection is
 * the institution's wider reference taxonomy, kept server-side so it can be
 * used by admin tooling, reporting and future selectors without another
 * hard-coded list, and so an ICT Admin can add or deactivate entries through
 * the API without a code change or redeploy.
 *
 * IDEMPOTENT / NON-DESTRUCTIVE
 * Every entry is written with $setOnInsert, so re-running only creates what is
 * missing. It never renames, recategorises, reorders or re-activates an
 * existing row — an admin's edits (including a deliberate deactivation)
 * survive every later run. Existing requests are never touched:
 * Ticket.equipmentType stores the device name as a string, so historical
 * tickets keep displaying exactly as before regardless of what this adds.
 *
 * LEGACY COMPATIBILITY
 * Five values from the old hard-coded 10-item enum have no exact equivalent in
 * the new taxonomy, because it splits or renames them:
 *     Monitor            -> "Monitor / Display"
 *     Keyboard / Mouse   -> "Keyboard" and "Mouse"
 *     UPS / Power Supply -> "UPS" and "Power Supply"
 *     Network            -> the "Network & Connectivity" category
 *     Other              -> "Other ICT Issue"
 * Those five are inserted INACTIVE under their natural category. They are not
 * offered anywhere, but they stay visible in the admin table so the mapping
 * from the previous schema is documented and reversible. The remaining five
 * legacy values (Desktop Computer, Laptop, Printer, Scanner, Projector) exist
 * verbatim in the new taxonomy and are seeded as normal active entries.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const DeviceType = require("../models/DeviceType");

/* ── The catalogue ─────────────────────────────────────────────
   The institution's ICT taxonomy, 13 categories / 83 entries.
   Order within each array IS the display order (sortOrder = index * 10).
   Order of CATEGORY_GROUPS is the order the categories appear. */
const CATEGORY_GROUPS = [
  {
    category: "Computer & End-User Devices",
    devices: [
      "Desktop Computer",
      "Laptop",
      "Tablet",
      "Thin Client",
      "Monitor / Display",
      "Keyboard",
      "Mouse",
      "Webcam",
      "Headset / Speaker",
    ],
  },
  {
    category: "Printing & Imaging",
    devices: [
      "Printer",
      "Scanner",
      "Photocopier",
      "Multifunction Printer",
      "Projector",
    ],
  },
  {
    category: "Network & Connectivity",
    devices: [
      "Router",
      "Switch",
      "Hub",
      "Modem",
      "Access Point",
      "Firewall",
      "Network Cable",
      "Fiber Optic",
      "Patch Panel",
      "Network Rack",
      "Network Adapter",
      "Internet / WAN",
      "LAN",
      "Wi-Fi",
    ],
  },
  {
    category: "Server & Data Center",
    devices: [
      "Server",
      "Server Storage",
      "NAS",
      "RAID",
      "Server Rack",
      "Data Center Equipment",
    ],
  },
  {
    category: "Storage & Backup",
    devices: [
      "Hard Disk",
      "SSD",
      "USB Storage",
      "External Drive",
      "Backup System",
      "Data Recovery",
    ],
  },
  {
    category: "Power & Electrical",
    devices: [
      "UPS",
      "Power Supply",
      "Surge Protector",
      "Power Cable",
      "Power Outlet",
      "Generator / Power Backup",
    ],
  },
  {
    category: "Software & Operating Systems",
    devices: [
      "Windows",
      "Linux",
      "Application Software",
      "Antivirus / Security Software",
      "Driver",
      "Software Installation",
      "Software Update",
      "Software Configuration",
    ],
  },
  {
    category: "Security & Surveillance",
    devices: [
      "CCTV Camera",
      "NVR / DVR",
      "Biometric Device",
      "Access Control",
      "Security System",
    ],
  },
  {
    category: "Communication",
    devices: [
      "IP Phone",
      "Telephone",
      "VoIP",
      "Video Conferencing",
      "Communication Equipment",
    ],
  },
  {
    category: "Account & Access",
    devices: [
      "User Account",
      "Password / Login",
      "Email Account",
      "Network Account",
      "Access Permission",
    ],
  },
  {
    category: "ICT Infrastructure",
    devices: [
      "Structured Cabling",
      "Fiber Infrastructure",
      "Server Room",
      "Network Infrastructure",
      "ICT Equipment Installation",
    ],
  },
  {
    category: "Internet & Network Services",
    devices: [
      "No Internet",
      "Slow Internet",
      "Network Connection",
      "Wi-Fi Connection",
      "IP Address",
      "DNS",
      "DHCP",
      "Network Configuration",
    ],
  },
  {
    category: "Other",
    devices: [
      /* Matches DeviceType.OTHER_DEVICE_NAME — the one entry that can open a
         free-text "Specify Device Name" field. */
      DeviceType.OTHER_DEVICE_NAME,
    ],
  },
];

/* Legacy enum values superseded by a renamed or split entry, mapped to the
   category they now belong to. Inserted INACTIVE — documentation, not an
   option. */
const LEGACY_INACTIVE = [
  { name: "Network", category: "Network & Connectivity" },
  { name: "Monitor", category: "Computer & End-User Devices" },
  { name: "Keyboard / Mouse", category: "Computer & End-User Devices" },
  { name: "UPS / Power Supply", category: "Power & Electrical" },
  { name: "Other", category: "Other" },
];

/* Flatten the groups into insert rows, then append the legacy tail. */
function buildSeedRows() {
  const rows = [];
  for (const group of CATEGORY_GROUPS) {
    group.devices.forEach((name, index) => {
      rows.push({
        name,
        category: group.category,
        active: true,
        sortOrder: (index + 1) * 10,
      });
    });
  }
  for (const legacy of LEGACY_INACTIVE) {
    rows.push({
      name: legacy.name,
      category: legacy.category,
      active: false,
      sortOrder: 999,
    });
  }
  return rows;
}

const log = (msg) => console.log(`  ✔  ${msg}`);

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const rows = buildSeedRows();
    let created = 0;
    let existing = 0;

    for (const { name, category, active, sortOrder } of rows) {
      /* $setOnInsert only: never overwrite an admin's later edit. */
      const result = await DeviceType.updateOne(
        { name },
        { $setOnInsert: { name, category, active, sortOrder } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) {
        created += 1;
      } else {
        existing += 1;
      }
    }

    const total = await DeviceType.countDocuments();
    const activeCount = await DeviceType.countDocuments({ active: true });
    const categoryCount = new Set(rows.map((r) => r.category)).size;

    console.log("");
    log(`created: ${created}`);
    log(`already present (left untouched): ${existing}`);
    log(
      `catalogue total: ${total} across ${categoryCount} categories (${activeCount} active, ${LEGACY_INACTIVE.length} legacy inactive)`,
    );
    console.log("Device type seed complete.");
    process.exit(0);
  } catch (err) {
    console.error("Device type seed failed:", err.message);
    process.exit(1);
  }
})();
