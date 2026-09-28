/**
 * scripts/seedCategories.js — Idempotent category seed
 * Adds the "Network Maintenance" request category used by the Network
 * Maintenance module without touching existing categories.
 *
 * Usage:  node scripts/seedCategories.js
 * Runs:   npm run seed:categories
 *
 * The category list drives the admin "Requests by Category" report, so every
 * category a requester can pick must exist here with an identical name.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Category = require('../models/Category');

const CATEGORIES = [
  {
    name: 'Network Maintenance',
    description: 'Network equipment and connectivity maintenance — Wi-Fi and LAN issues, routers, switches, access points, IP/DNS/DHCP problems, and cabling.',
  },
  {
    name: 'Networking',
    description: 'Networking-focused service requests — network cables, switches, routers, access points, firewalls, patch panels, network racks, and modems.',
  },
  {
    name: 'Router',
    description: 'Router-related maintenance requests — configuration, firmware, connectivity, and hardware issues.',
  },
  {
    name: 'Switch',
    description: 'Switch-related maintenance requests — port issues, VLAN configuration, POE problems, and hardware failures.',
  },
  {
    name: 'Hub',
    description: 'Network hub maintenance requests — connectivity, port failures, and replacement.',
  },
  {
    name: 'Modem',
    description: 'Modem-related maintenance requests — ISP connectivity, configuration, and hardware issues.',
  },
  {
    name: 'Access Point',
    description: 'Wireless access point maintenance — Wi-Fi coverage, authentication, roaming, and hardware issues.',
  },
  {
    name: 'Firewall',
    description: 'Firewall maintenance — rule management, intrusion detection, VPN configuration, and firmware updates.',
  },
  {
    name: 'Network Cable',
    description: 'Network cabling maintenance — patch cables, fiber runs, termination, testing, and cable management.',
  },
];

const log = (msg) => console.log(`  ✔  ${msg}`);

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    for (const { name, description } of CATEGORIES) {
      /* Idempotent upsert: never changes an existing category's description. */
      await Category.updateOne(
        { name },
        { $setOnInsert: { name, description } },
        { upsert: true }
      );
      log(`category ready: "${name}"`);
    }

    console.log('Category seed complete.');
    process.exit(0);
  } catch (err) {
    console.error('Category seed failed:', err.message);
    process.exit(1);
  }
})();