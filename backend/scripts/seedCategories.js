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