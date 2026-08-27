/**
 * reset-passwords.js — Reset ALL user passwords in the database
 *
 * WARNING: This is a destructive operation. All users will get the same password.
 *
 * Usage:
 *   node scripts/reset-passwords.js              → random password (printed to console)
 *   node scripts/reset-passwords.js <password>   → specific password
 *   RESET_PASSWORD=<password> node scripts/reset-passwords.js
 *
 * Note: For targeted admin/technician account resets, use `npm run reset:users` instead.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const connectDB = require('../config/db');
const mongoose  = require('mongoose');
const User      = require('../models/User');

const PASSWORD = process.argv[2] || process.env.RESET_PASSWORD || crypto.randomBytes(9).toString('base64url');

(async () => {
  console.log('\n  Resetting ALL user passwords...');
  await connectDB();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const result = await User.updateMany({}, { password: hash });
  console.log(`  Updated ${result.modifiedCount} user(s) → new password: "${PASSWORD}"`);
  console.log('  ⚠ Store this password securely. Do not commit it to source control.');
  await mongoose.disconnect();
  console.log('  Done.\n');
  process.exit(0);
})();
