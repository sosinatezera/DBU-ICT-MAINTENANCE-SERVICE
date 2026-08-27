/**
 * update-categories.js
 * This system handles Computer Maintenance ONLY (hardware & software failures)
 * Run: node scripts/update-categories.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose  = require('mongoose');
const connectDB = require('../config/db');
const Category  = require('../models/Category');

const CATEGORIES = [
  // ── HARDWARE ──────────────────────────────────────────
  { name: 'Hardware — Computer / Desktop',  description: 'Desktop computer hardware failures, power issues, components' },
  { name: 'Hardware — Laptop',              description: 'Laptop hardware issues: screen, keyboard, battery, charging' },
  { name: 'Hardware — Printer / Scanner',   description: 'Printer not working, paper jam, toner, scanner faults' },
  { name: 'Hardware — Monitor / Display',   description: 'Screen flickering, no display, monitor not working' },
  { name: 'Hardware — Peripherals',         description: 'Keyboard, mouse, USB devices, external drives, webcam' },
  { name: 'Hardware — Power & Electrical',  description: 'Power supply failure, UPS, electrical faults, no power' },

  // ── SOFTWARE ──────────────────────────────────────────
  { name: 'Software — Operating System',    description: 'Windows/OS errors, crashes, slow performance, boot issues' },
  { name: 'Software — Application Error',   description: 'Office apps, software crashing, not opening, freezing' },
  { name: 'Software — Installation',        description: 'Software installation, update, upgrade or removal requests' },
  { name: 'Software — Virus / Malware',     description: 'Virus detected, malware removal, antivirus issues' },
  { name: 'Software — Data Recovery',       description: 'Lost files, data recovery, accidental deletion' },
];

(async () => {
  await connectDB();
  await Category.deleteMany({});
  console.log('🗑  Old categories removed');

  const inserted = await Category.insertMany(CATEGORIES);
  console.log(`\n✅ ${inserted.length} Computer Maintenance categories created:\n`);

  console.log('  ── HARDWARE ──────────────────────');
  inserted.filter(c => c.name.startsWith('Hardware')).forEach((c,i) => console.log(`  ${i+1}. ${c.name}`));

  console.log('\n  ── SOFTWARE ──────────────────────');
  inserted.filter(c => c.name.startsWith('Software')).forEach((c,i) => console.log(`  ${i+1}. ${c.name}`));

  console.log('\n✅ Done.');
  mongoose.disconnect();
})();
