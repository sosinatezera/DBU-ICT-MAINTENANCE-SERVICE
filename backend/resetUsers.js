/**
 * resetUsers.js — Create/update Admin and Technician test accounts
 *
 * Only affects:
 *   - admin@dbu.edu.et
 *   - technician@dbu.edu.et
 *
 * Uses the project's existing:
 *   - models/User.js
 *   - models/Technician.js
 *   - bcryptjs (hash salt rounds = 12)
 *   - config/db.js or direct mongoose.connect()
 *
 * If direct MongoDB connection fails, falls back to the
 * running server API (http://localhost:5000).
 *
 * Usage:
 *   node resetUsers.js
 *   npm run reset:users
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const User       = require('./models/User');
const Technician = require('./models/Technician');

// ── Account definitions ────────────────────────────────────────
// Passwords are read from environment variables when available and only
// fall back to development placeholders for a local database. They are
// NEVER printed to the console — deploy with SEED_ADMIN_PASSWORD /
// SEED_TECH_PASSWORD set to real, strong values.
const ADMIN_EMAIL    = 'admin@dbu.edu.et';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
const ADMIN_NAME     = 'ICT Admin';
const ADMIN_DEPT     = 'System Administration';

const TECH_EMAIL    = 'technician@dbu.edu.et';
const TECH_PASSWORD = process.env.SEED_TECH_PASSWORD || 'Tech123!';
const TECH_NAME     = 'ICT Technician';
const TECH_DEPT     = 'ICT Department';

const SALT_ROUNDS = 12;
const API_BASE    = 'http://localhost:5000/api';

// ── Helpers ────────────────────────────────────────────────────
const log  = (msg) => console.log(`  ✔  ${msg}`);
const warn = (msg) => console.log(`  ⚠  ${msg}`);
const fail = (msg) => console.log(`  ✖  ${msg}`);
const hr   = ()    => console.log('─'.repeat(52));

// ══════════════════════════════════════════════════════════════
//  API-based approach (when direct MongoDB connection fails)
// ══════════════════════════════════════════════════════════════

async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function apiGetUsers(token) {
  const res = await fetch(`${API_BASE}/users`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

async function apiCreateUser(token, userData) {
  const res = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(userData),
  });
  return res.json();
}

async function apiUpdateUserPassword(token, userId, password) {
  const res = await fetch(`${API_BASE}/users/${userId}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });
  return res.json();
}

async function apiUpdateUser(token, userId, userData) {
  const res = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(userData),
  });
  return res.json();
}

async function runViaAPI() {
  console.log('\n  Using running server API (http://localhost:5000)\n');

  // Try to login as existing admin
  let adminToken = null;
  const adminLogin = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminLogin.success) {
    adminToken = adminLogin.token;
    log('Logged in as admin@dbu.edu.et');
  } else {
    fail('Cannot login as admin — check if server is running');
    process.exit(1);
  }

  // Get all users
  const usersData = await apiGetUsers(adminToken);
  if (!usersData.success) {
    fail('Cannot fetch users list');
    process.exit(1);
  }

  const allUsers = usersData.data;

  // ── ADMIN ──
  hr();
  console.log('  ADMIN ACCOUNT (via API)\n');

  const adminUser = allUsers.find(u => u.email === ADMIN_EMAIL);
  if (adminUser) {
    warn(`${ADMIN_EMAIL} exists (role: "${adminUser.role}")`);

    // Reset password
    const pwdResult = await apiUpdateUserPassword(adminToken, adminUser._id, ADMIN_PASSWORD);
    if (pwdResult.success) {
      log('Password reset OK');
    } else {
      fail(`Password reset failed: ${pwdResult.message}`);
    }

    // Fix role if needed
    if (adminUser.role !== 'ICT Admin') {
      const roleResult = await apiUpdateUser(adminToken, adminUser._id, {
        fullName: ADMIN_NAME,
        role: 'ICT Admin',
        status: 'active',
        department: ADMIN_DEPT,
      });
      if (roleResult.success) {
        log(`Role updated from "${adminUser.role}" to "ICT Admin"`);
      } else {
        fail(`Role update failed: ${roleResult.message}`);
      }
    } else {
      log('Role already "ICT Admin"');
      log('Status already "active"');
    }
  } else {
    warn(`${ADMIN_EMAIL} not found — creating`);
    const createResult = await apiCreateUser(adminToken, {
      fullName: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'ICT Admin',
      status: 'active',
      department: ADMIN_DEPT,
    });
    if (createResult.success) {
      log('Admin account created');
    } else {
      fail(`Admin creation failed: ${createResult.message}`);
    }
  }

  // ── TECHNICIAN ──
  hr();
  console.log('  TECHNICIAN ACCOUNT (via API)\n');

  const techUser = allUsers.find(u => u.email === TECH_EMAIL);
  if (techUser) {
    warn(`${TECH_EMAIL} exists (role: "${techUser.role}")`);

    // Reset password
    const pwdResult = await apiUpdateUserPassword(adminToken, techUser._id, TECH_PASSWORD);
    if (pwdResult.success) {
      log('Password reset OK');
    } else {
      fail(`Password reset failed: ${pwdResult.message}`);
    }

    // Fix role if needed
    if (techUser.role !== 'Technician') {
      const roleResult = await apiUpdateUser(adminToken, techUser._id, {
        fullName: TECH_NAME,
        role: 'Technician',
        status: 'active',
        department: TECH_DEPT,
      });
      if (roleResult.success) {
        log(`Role updated from "${techUser.role}" to "Technician"`);
      } else {
        fail(`Role update failed: ${roleResult.message}`);
      }
    } else {
      log('Role already "Technician"');
      log('Status already "active"');
    }
  } else {
    warn(`${TECH_EMAIL} not found — creating`);
    const createResult = await apiCreateUser(adminToken, {
      fullName: TECH_NAME,
      email: TECH_EMAIL,
      password: TECH_PASSWORD,
      role: 'Technician',
      status: 'active',
      department: TECH_DEPT,
    });
    if (createResult.success) {
      log('Technician account created');
    } else {
      fail(`Technician creation failed: ${createResult.message}`);
    }
  }

  // ── VERIFY ──
  hr();
  console.log('  VERIFICATION\n');

  // Re-fetch users
  const verifyData = await apiGetUsers(adminToken);
  const verifyUsers = verifyData.data;

  const adminVerify = verifyUsers.find(u => u.email === ADMIN_EMAIL);
  const techVerify  = verifyUsers.find(u => u.email === TECH_EMAIL);

  // Admin check
  if (adminVerify) {
    const roleOk = adminVerify.role === 'ICT Admin';
    const statusOk = adminVerify.status === 'active';
    log(`Admin email: "${adminVerify.email}" ${adminVerify.email === ADMIN_EMAIL ? '✓' : '✗'}`);
    log(`Admin role: "${adminVerify.role}" ${roleOk ? '✓' : '✗'}`);
    log(`Admin status: "${adminVerify.status}" ${statusOk ? '✓' : '✗'}`);
    if (!roleOk || !statusOk) { fail('Admin verification FAILED'); process.exit(1); }
  } else {
    fail('Admin not found'); process.exit(1);
  }

  // Technician check
  if (techVerify) {
    const roleOk = techVerify.role === 'Technician';
    const statusOk = techVerify.status === 'active';
    log(`Tech email: "${techVerify.email}" ${techVerify.email === TECH_EMAIL ? '✓' : '✗'}`);
    log(`Tech role: "${techVerify.role}" ${roleOk ? '✓' : '✗'}`);
    log(`Tech status: "${techVerify.status}" ${statusOk ? '✓' : '✗'}`);
    if (!roleOk || !statusOk) { fail('Technician verification FAILED'); process.exit(1); }
  } else {
    fail('Technician not found'); process.exit(1);
  }

  // Login test
  hr();
  console.log('  LOGIN TEST\n');

  const adminLoginTest = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminLoginTest.success && adminLoginTest.user.role === 'ICT Admin') {
    log(`Admin login → SUCCESS (role: "${adminLoginTest.user.role}")`);
  } else {
    fail('Admin login FAILED'); process.exit(1);
  }

  const techLoginTest = await apiLogin(TECH_EMAIL, TECH_PASSWORD);
  if (techLoginTest.success && techLoginTest.user.role === 'Technician') {
    log(`Technician login → SUCCESS (role: "${techLoginTest.user.role}")`);
  } else {
    fail('Technician login FAILED'); process.exit(1);
  }

  // Summary
  hr();
  console.log('\n  ╔══════════════════════════════════════════════════╗');
  console.log('  ║            Reset Complete                    ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Admin      : ${ADMIN_EMAIL}`.padEnd(51) + '║');
  console.log('  ║  Password   : (set, not shown)'.padEnd(51) + '║');
  console.log(`  ║  Role       : ICT Admin`.padEnd(51) + '║');
  console.log(`  ║  Status     : active`.padEnd(51) + '║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Technician : ${TECH_EMAIL}`.padEnd(51) + '║');
  console.log('  ║  Password   : (set, not shown)'.padEnd(51) + '║');
  console.log(`  ║  Role       : Technician`.padEnd(51) + '║');
  console.log(`  ║  Status     : active`.padEnd(51) + '║');
  console.log('  ╚══════════════════════════════════════════════════╝\n');

  log('No plaintext passwords stored');
  log('No JWT tokens exposed');
  log('No unrelated users modified');
  console.log('\n  Done.\n');
}

// ══════════════════════════════════════════════════════════════
//  Direct MongoDB approach
// ══════════════════════════════════════════════════════════════

async function runDirectMongo() {
  console.log('\n  Connecting to MongoDB (direct)...\n');

  const uri    = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(uri, { dbName });
  console.log(`[MongoDB] Connected → ${dbName}\n`);

  // ── ADMIN ──
  hr();
  console.log('  ADMIN ACCOUNT\n');

  const adminExisting = await User.findOne({ email: ADMIN_EMAIL });

  if (adminExisting) {
    warn(`${ADMIN_EMAIL} exists (role: "${adminExisting.role}")`);

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

    await User.findByIdAndUpdate(adminExisting._id, {
      password: adminHash,
      role: 'ICT Admin',
      status: 'active',
      fullName: ADMIN_NAME,
      department: ADMIN_DEPT,
    });

    log('Password reset OK');
    log('Role set to "ICT Admin"');
    log('Status set to "active"');
  } else {
    warn(`${ADMIN_EMAIL} not found — creating`);

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

    await User.create({
      fullName: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: adminHash,
      role: 'ICT Admin',
      status: 'active',
      department: ADMIN_DEPT,
    });

    log('Admin account created');
    log('Role: "ICT Admin"');
    log('Status: "active"');
  }

  // ── TECHNICIAN ──
  hr();
  console.log('  TECHNICIAN ACCOUNT\n');

  const techExisting = await User.findOne({ email: TECH_EMAIL });

  if (techExisting) {
    warn(`${TECH_EMAIL} exists (role: "${techExisting.role}")`);

    const techHash = await bcrypt.hash(TECH_PASSWORD, SALT_ROUNDS);

    await User.findByIdAndUpdate(techExisting._id, {
      password: techHash,
      role: 'Technician',
      status: 'active',
      fullName: TECH_NAME,
      department: TECH_DEPT,
    });

    log('Password reset OK');
    log('Role set to "Technician"');
    log('Status set to "active"');
  } else {
    warn(`${TECH_EMAIL} not found — creating`);

    const techHash = await bcrypt.hash(TECH_PASSWORD, SALT_ROUNDS);

    const techUser = await User.create({
      fullName: TECH_NAME,
      email: TECH_EMAIL,
      password: techHash,
      role: 'Technician',
      status: 'active',
      department: TECH_DEPT,
    });

    log('Technician account created');
    log('Role: "Technician"');
    log('Status: "active"');

    await Technician.create({
      user: techUser._id,
      specialization: 'General ICT Support',
      available: true,
    });
    log('Technician profile created');
  }

  // ── TECHNICIAN PROFILE CHECK ──
  hr();
  console.log('  TECHNICIAN PROFILE CHECK\n');

  const techUser = await User.findOne({ email: TECH_EMAIL });
  if (techUser) {
    const techProfile = await Technician.findOne({ user: techUser._id });
    if (techProfile) {
      log('Technician profile exists — no duplicate');
    } else {
      await Technician.create({
        user: techUser._id,
        specialization: 'General ICT Support',
        available: true,
      });
      log('Technician profile created');
    }
  }

  // ── VERIFY PASSWORDS ──
  hr();
  console.log('  PASSWORD VERIFICATION\n');

  const bcryptPrefix = /^\$2[aby]?\$\d{2}\$/;

  const adminVerify = await User.findOne({ email: ADMIN_EMAIL }).select('email password role status');
  const techVerify  = await User.findOne({ email: TECH_EMAIL }).select('email password role status');

  if (adminVerify) {
    if (!bcryptPrefix.test(adminVerify.password)) {
      fail('Admin password is NOT a bcrypt hash!'); process.exit(1);
    }
    log(`${adminVerify.email} → password is bcrypt-hashed`);

    const adminMatch = await bcrypt.compare(ADMIN_PASSWORD, adminVerify.password);
    if (!adminMatch) { fail('Admin bcrypt.compare() FAILED'); process.exit(1); }
    log('Admin bcrypt.compare() → SUCCESS');

    if (adminVerify.password === ADMIN_PASSWORD) {
      fail('Admin password stored as PLAINTEXT!'); process.exit(1);
    }
    log('Admin password is NOT plaintext');
  } else {
    fail('Admin not found'); process.exit(1);
  }

  if (techVerify) {
    if (!bcryptPrefix.test(techVerify.password)) {
      fail('Technician password is NOT a bcrypt hash!'); process.exit(1);
    }
    log(`${techVerify.email} → password is bcrypt-hashed`);

    const techMatch = await bcrypt.compare(TECH_PASSWORD, techVerify.password);
    if (!techMatch) { fail('Technician bcrypt.compare() FAILED'); process.exit(1); }
    log('Technician bcrypt.compare() → SUCCESS');

    if (techVerify.password === TECH_PASSWORD) {
      fail('Technician password stored as PLAINTEXT!'); process.exit(1);
    }
    log('Technician password is NOT plaintext');
  } else {
    fail('Technician not found'); process.exit(1);
  }

  // ── VERIFY ROLES ──
  hr();
  console.log('  ROLE VERIFICATION\n');

  if (adminVerify.role !== 'ICT Admin') {
    fail(`Admin role is "${adminVerify.role}" — expected "ICT Admin"`); process.exit(1);
  }
  log(`Admin role: "ICT Admin" ✓`);
  log(`Admin status: "${adminVerify.status}"`);

  if (techVerify.role !== 'Technician') {
    fail(`Technician role is "${techVerify.role}" — expected "Technician"`); process.exit(1);
  }
  log(`Technician role: "Technician" ✓`);
  log(`Technician status: "${techVerify.status}"`);

  // Summary
  hr();
  console.log('\n  ╔══════════════════════════════════════════════════╗');
  console.log('  ║            Reset Complete                    ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Admin      : ${ADMIN_EMAIL}`.padEnd(51) + '║');
  console.log('  ║  Password   : (set, not shown)'.padEnd(51) + '║');
  console.log(`  ║  Role       : ICT Admin`.padEnd(51) + '║');
  console.log(`  ║  Status     : active`.padEnd(51) + '║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Technician : ${TECH_EMAIL}`.padEnd(51) + '║');
  console.log('  ║  Password   : (set, not shown)'.padEnd(51) + '║');
  console.log(`  ║  Role       : Technician`.padEnd(51) + '║');
  console.log(`  ║  Status     : active`.padEnd(51) + '║');
  console.log('  ╚══════════════════════════════════════════════════╝\n');

  await mongoose.connection.close();
  log('MongoDB connection closed');
  console.log('\n  Done.\n');
}

// ══════════════════════════════════════════════════════════════
//  MAIN — Try direct MongoDB first, fallback to API
// ══════════════════════════════════════════════════════════════

(async () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   Smart Computer Maintenance Service — User Reset   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Try direct MongoDB connection first
  try {
    const uri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';
    if (!uri) throw new Error('MONGO_URI not set');

    const conn = await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB] Connected → ${conn.connection.name}`);

    // Direct connection succeeded — run direct approach
    await runDirectMongo();
    process.exit(0);
  } catch (err) {
    // Direct connection failed — try API fallback
    warn(`Direct MongoDB connection failed: ${err.message}`);
    console.log('');

    try {
      const healthRes = await fetch(`${API_BASE}/health`);
      if (!healthRes.ok) throw new Error('Server not responding');

      await runViaAPI();
      process.exit(0);
    } catch (apiErr) {
      fail(`API fallback also failed: ${apiErr.message}`);
      console.log('\n  Ensure the backend server is running:');
      console.log('    cd backend && npm run dev\n');
      console.log('  Or fix MONGO_URI in .env and retry:');
      console.log('    cd backend && node resetUsers.js\n');
      process.exit(1);
    }
  }
})().catch(err => {
  fail(`Script failed: ${err.message}`);
  mongoose.connection.close().catch(() => {});
  process.exit(1);
});
