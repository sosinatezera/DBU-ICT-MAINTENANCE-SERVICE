/**
 * migrateStudentToRequester.js — Migration script to convert 'student' role users to 'Requester'
 * Smart Computer Maintenance Service Request and Tracking System
 *
 * This script safely migrates any existing users with role 'student' to 'Requester'.
 * It does NOT delete users - only updates their role.
 *
 * Usage: node migrateStudentToRequester.js
 * Run from: backend/ directory
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const mongoose = require('mongoose');
const User = require('./models/User');

const log = (msg) => console.log(`  ✔  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);
const hr = () => console.log('─'.repeat(52));

async function migrate() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Student → Requester Role Migration             ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

  if (!uri) {
    console.error('  ✖  MONGO_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { dbName });
    console.log(`  [MongoDB] Connected → database: ${mongoose.connection.name}\n`);
    hr();

    // Find all users with role 'student'
    const studentUsers = await User.find({ role: 'student' }).select('fullName email role');

    if (studentUsers.length === 0) {
      log('No users with role "student" found. Nothing to migrate.');
    } else {
      console.log(`  Found ${studentUsers.length} user(s) with role "student":\n`);

      for (const user of studentUsers) {
        console.log(`  - ${user.fullName} (${user.email})`);
      }

      console.log('\n  Migrating...');
      hr();

      const result = await User.updateMany(
        { role: 'student' },
        { $set: { role: 'Requester' } }
      );

      log(`Migration complete: ${result.modifiedCount} user(s) updated from "student" to "Requester"`);
    }

    // Verify no student roles remain
    const remaining = await User.countDocuments({ role: 'student' });
    if (remaining === 0) {
      log('Verification passed: No users with role "student" remain in database.');
    } else {
      warn(`${remaining} user(s) still have role "student" — manual review needed.`);
    }

    hr();
    console.log('\n  Migration script completed.\n');
  } catch (err) {
    console.error(`\n  ✖  Migration failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('  MongoDB connection closed.');
  }
}

migrate();