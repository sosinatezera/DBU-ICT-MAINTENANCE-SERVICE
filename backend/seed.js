/**
 * seed.js — Test account seed (Requester / Technician / ICT Admin)
 * Smart Computer Maintenance Service Request and Tracking System
 *
 * Database : ict_maintenance_db (from .env MONGO_URI / MONGO_DB_NAME)
 * Usage    :  node seed.js        (run from backend/)
 *             npm run seed:auth
 *
 * Safely creates the three test accounts if they do not exist, and repairs
 * (re-hashes password / fixes role / reactivates) any account that already
 * exists. It never creates duplicates and NEVER stores plaintext passwords.
 *
 * Never logs passwords or password hashes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const connectDB  = require('./config/db');
const User       = require('./models/User');
const Technician = require('./models/Technician');
const ACCOUNTS   = require('./scripts/accounts');

const SALT_ROUNDS = 12;
const BC_PREFIX   = /^\$2[aby]?\$\d{2}\$/;

/* ── Accounts to ensure (single source of truth: scripts/accounts.js) ── */

/* ── Helpers ────────────────────────────────────────────────── */
const log  = (msg) => console.log(`  ✔  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);
const hr   = ()    => console.log('─'.repeat(52));

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findByEmail(email) {
  /* Case-insensitive lookup so legacy mixed-case emails are also repaired.
     +password: needed by hashMatches() for the existing-hash comparison. */
  return User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') }).select('+password');
}

async function hashMatches(plain, storedHash) {
  if (!storedHash || !BC_PREFIX.test(storedHash)) return false;
  try {
    return await bcrypt.compare(plain, storedHash);
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════ */
async function seed() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Smart Computer Maintenance Service — Test         ║');
  console.log('║   Account Seed                                     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  await connectDB();
  console.log(`  [MongoDB] Connected → database: ${mongoose.connection.name}\n`);
  hr();

  for (const acc of ACCOUNTS) {
    const email = acc.email.trim().toLowerCase();

    const existing = await findByEmail(email);

    if (existing) {
      warn(`${email} exists (role: "${existing.role}")`);

      const update = { status: 'active' };
      let changed = false;

      if (existing.role !== acc.role) {
        update.role = acc.role;
        changed = true;
      }
      if (existing.fullName !== acc.fullName) {
        update.fullName = acc.fullName;
        changed = true;
      }
      if (existing.department !== acc.department) {
        update.department = acc.department;
        changed = true;
      }
      if (existing.status !== 'active') {
        changed = true;
      }
      if (!(await hashMatches(acc.password, existing.password))) {
        update.password = await bcrypt.hash(acc.password, SALT_ROUNDS);
        changed = true;
      }

      if (changed) {
        await User.findByIdAndUpdate(existing._id, update, { new: true });
        log(`${email} → repaired (role: ${acc.role}, status: active, password hash updated)`);
      } else {
        log(`${email} → unchanged (already correct)`);
      }
    } else {
      await User.create({
        fullName: acc.fullName,
        email,
        password: await bcrypt.hash(acc.password, SALT_ROUNDS),
        role: acc.role,
        department: acc.department,
        status: 'active',
      });
      log(`${email} → created (role: ${acc.role})`);
    }

    /* Ensure the Technician profile exists (required for assignments). */
    if (acc.isTechnician) {
      const user = await findByEmail(email);
      if (user) {
        const profile = await Technician.findOne({ user: user._id });
        if (!profile) {
          await Technician.create({
            user: user._id,
            specialization: 'General ICT Support',
            available: true,
          });
          log(`Technician profile created for ${email}`);
        }
      }
    }
  }

  /* ── Verification (never logs the password) ─────────────── */
  hr();
  console.log('  VERIFICATION\n');

  let allOk = true;
  for (const acc of ACCOUNTS) {
    const email    = acc.email.trim().toLowerCase();
    const user     = await findByEmail(email);
    const verified = await hashMatches(acc.password, user && user.password);

    if (user && user.role === acc.role && user.status === 'active' && verified) {
      log(`${email} | role: ${user.role} | status: ${user.status} | password: OK`);
    } else {
      warn(`${email} | role: ${user ? user.role : 'MISSING'} | password: ${verified ? 'OK' : 'MISMATCH'}`);
      if (user && user.role !== acc.role) warn(`  expected role "${acc.role}"`);
      if (user && !verified) warn(`  stored hash does NOT match — re-run the seed.`);
      allOk = false;
    }
  }

  /* ── Summary ────────────────────────────────────────────── */
  hr();
  if (allOk) {
    console.log('\n  All test accounts verified. Login should now work.\n');
  } else {
    console.log('\n  Some accounts failed verification. Re-run: npm run seed:auth\n');
  }

  console.log('  Credentials are defined in backend/scripts/accounts.js (not exposed in logs).');
  console.log('');
}

/* ══════════════════════════════════════════════════════════════ */
seed()
  .then(async () => {
    await mongoose.connection.close();
    console.log('  MongoDB connection closed. Done.\n');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n  ✖  Seed failed: ${err.message}`);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });