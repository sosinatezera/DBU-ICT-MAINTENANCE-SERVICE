/**
 * seedAssets.js — Seed realistic DBU ICT assets for the Requester dropdown
 * Database: ict_maintenance_db
 *
 * Usage:  node scripts/seedAssets.js
 *
 * Safely upserts assets by unique asset_tag (existing tags are skipped),
 * so it can be re-run without creating duplicates.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const ICTAsset = require('../models/ICTAsset');

const log  = (msg) => console.log(`  ✔  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);

const assetsData = [
  // Desktop / Laptop
  { asset_name: 'Dell OptiPlex 7090',        asset_tag: 'DBU-ICT-001', category: 'Desktop Computer',  department: 'ICT Department',   location: 'ICT Office',      status: 'active',            purchase_date: new Date('2022-01-15'), warranty_expiry: new Date('2025-01-15'), description: 'Standard office desktop workstation' },
  { asset_name: 'HP ProBook 450 G8',         asset_tag: 'DBU-ICT-002', category: 'Laptop',            department: 'Academic Affairs', location: 'ACB - Room 201',  status: 'active',            purchase_date: new Date('2021-08-10'), warranty_expiry: new Date('2024-08-10'), description: 'Lecturer laptop' },
  { asset_name: 'Dell Latitude 5520',        asset_tag: 'DBU-ICT-006', category: 'Laptop',            department: 'Finance',         location: 'ADM - Room 101',  status: 'active',            purchase_date: new Date('2022-03-15'), warranty_expiry: new Date('2025-03-15'), description: 'Finance team laptop' },
  { asset_name: 'Lenovo ThinkCentre M720',   asset_tag: 'DBU-ICT-007', category: 'Desktop Computer',  department: 'Human Resources', location: 'ADM - Room 201',  status: 'active',            purchase_date: new Date('2021-09-05'), warranty_expiry: new Date('2024-09-05'), description: 'HR workstation' },
  // Printers / Scanners
  { asset_name: 'HP LaserJet Pro M404dn',    asset_tag: 'DBU-ICT-003', category: 'Printer',           department: 'Registry',        location: 'ADM - Room 102',  status: 'active',            purchase_date: new Date('2021-06-10'), warranty_expiry: new Date('2024-06-10'), description: 'Main office laser printer' },
  { asset_name: 'Canon PIXMA G3020',         asset_tag: 'DBU-ICT-008', category: 'Printer',           department: 'Academic Affairs', location: 'ACB - Room 301',  status: 'active',            purchase_date: new Date('2023-02-28'), warranty_expiry: new Date('2026-02-28'), description: 'Colour inkjet printer' },
  { asset_name: 'Epson Perfection V39',      asset_tag: 'DBU-ICT-009', category: 'Scanner',           department: 'Registry',        location: 'ADM - Room 103',  status: 'active',            purchase_date: new Date('2022-11-01'), warranty_expiry: new Date('2025-11-01'), description: 'Flatbed document scanner' },
  // Projector
  { asset_name: 'Epson EB-X51 Projector',    asset_tag: 'DBU-ICT-004', category: 'Projector',         department: 'Academic Affairs', location: 'ACB - Lecture Hall', status: 'active',           purchase_date: new Date('2020-05-20'), warranty_expiry: new Date('2023-05-20'), description: 'Conference room projector' },
  // UPS
  { asset_name: 'APC Back-UPS 650VA',        asset_tag: 'DBU-ICT-005', category: 'UPS',               department: 'ICT Department',   location: 'Server Room',     status: 'active',            purchase_date: new Date('2022-09-12'), warranty_expiry: new Date('2025-09-12'), description: 'UPS for core network equipment' },
  { asset_name: 'APC Smart-UPS 1500VA',      asset_tag: 'DBU-ICT-010', category: 'UPS',               department: 'ICT Department',   location: 'Server Room',     status: 'active',            purchase_date: new Date('2021-01-08'), warranty_expiry: new Date('2024-01-08'), description: 'Server room UPS' },
  // Server
  { asset_name: 'Dell PowerEdge R740 Server', asset_tag: 'DBU-ICT-011', category: 'Server',           department: 'ICT Department',   location: 'Server Room',     status: 'active',            purchase_date: new Date('2020-02-14'), warranty_expiry: new Date('2023-02-14'), description: 'Main application server' },
  // Network
  { asset_name: 'Cisco Catalyst 2960 Switch', asset_tag: 'DBU-NET-001', category: 'Network Switch',   department: 'ICT Department',   location: 'Server Room',     status: 'active',            purchase_date: new Date('2020-04-22'), warranty_expiry: new Date('2023-04-22'), description: 'Core network switch' },
  { asset_name: 'TP-Link EAP245 Access Point', asset_tag: 'DBU-NET-002', category: 'Access Point',    department: 'ICT Department',   location: 'ACB - Floor 1',   status: 'active',            purchase_date: new Date('2021-12-05'), warranty_expiry: new Date('2024-12-05'), description: 'Wi-Fi access point' },
  { asset_name: 'Cisco ISR 4321 Router',     asset_tag: 'DBU-NET-003', category: 'Router',            department: 'ICT Department',   location: 'Server Room',     status: 'active',            purchase_date: new Date('2020-08-30'), warranty_expiry: new Date('2023-08-30'), description: 'Edge/border router' },
  // Non-available example (should NOT appear in requester dropdown)
  { asset_name: 'Dell OptiPlex 7050 (retired)', asset_tag: 'DBU-ICT-012', category: 'Desktop Computer', department: 'ICT Department', location: 'Stores',          status: 'decommissioned',    purchase_date: new Date('2018-03-01'), warranty_expiry: new Date('2021-03-01'), description: 'Retired decommissioned workstation' },
  { asset_name: 'HP LaserJet P1102',          asset_tag: 'DBU-ICT-013', category: 'Printer',           department: 'Finance',         location: 'ADM - Room 104',  status: 'under_maintenance', purchase_date: new Date('2019-06-20'), warranty_expiry: new Date('2022-06-20'), description: 'Printer currently under maintenance' },
];

async function seedAssets() {
  const uri    = process.env.MONGO_URI    || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

  console.log('\n  Seeding DBU ICT assets…\n');
  await mongoose.connect(uri, { dbName });
  console.log(`  Connected to MongoDB → ${dbName}\n`);

  let created = 0, skipped = 0;
  for (const a of assetsData) {
    const existing = await ICTAsset.findOne({ asset_tag: a.asset_tag });
    if (existing) {
      warn(`Asset already exists: ${a.asset_tag} (skipped)`);
      skipped++;
    } else {
      await ICTAsset.create(a);
      log(`Asset created: ${a.asset_tag} — ${a.asset_name} [${a.category}]`);
      created++;
    }
  }

  const total = await ICTAsset.countDocuments();
  const active = await ICTAsset.countDocuments({ status: 'active' });

  console.log('\n  ──────────────────────────────────────────────');
  console.log(`  Created:  ${created}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Total ICT Assets : ${total}`);
  console.log(`  Active (available): ${active}`);
  console.log('  ──────────────────────────────────────────────\n');

  await mongoose.connection.close();
  console.log('  Done!\n');
  process.exit(0);
}

seedAssets().catch(err => {
  console.error('\n  ✖  Seed failed:', err.message);
  mongoose.connection.close();
  process.exit(1);
});
