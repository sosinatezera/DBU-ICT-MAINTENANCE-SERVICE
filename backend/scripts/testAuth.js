/**
 * scripts/testAuth.js — End-to-end authentication verification.
 * Smart ICT Maintenance Management System
 *
 * Checks for every seeded account:
 *   1. Database:   user exists, correct role, active status,
 *                  password hash verifies with bcrypt.compare(),
 *                  Technician profile exists (for the technician role).
 *   2. API (live)  correct credentials  → 200 + bearer token + role + redirect
 *                  wrong password       → 401 "Invalid email or password."
 *                  unknown email        → 401 "Invalid email or password."
 *                  missing fields       → 422 "Email and password are required."
 *
 * Run from backend/:   npm run verify:auth
 * Requires the backend server to be RUNNING for the API section
 * (start it with `npm start` first). The database checks run regardless.
 *
 * Never logs passwords or password hashes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http      = require('http');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');
const connectDB = require('../config/db');
const User       = require('../models/User');
const Technician = require('../models/Technician');
const ACCOUNTS   = require('./accounts');

const API_HOST = process.env.LOGIN_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.PORT || 5000);
const AUTH_URL = `http://${API_HOST}:${API_PORT}/api/auth`;
const LOGIN_URL = `${AUTH_URL}/login`;

let failCount = 0, passCount = 0;
const ok   = (msg) => { passCount++; console.log(`  ✔  ${msg}`); };
const bad  = (msg) => { failCount++; console.log(`  ✖  ${msg}`); };

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requestJson(url, { method = 'GET', payload, token } = {}) {
  return new Promise((resolve, reject) => {
    const { protocol, hostname, port, pathname } = new URL(url);
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const headers = {};
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request({
      protocol, hostname, port, path: pathname,
      method,
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(raw); } catch (_) { /* non-JSON body */ }
        resolve({
          status: res.statusCode,
          json,
          setCookies: res.headers['set-cookie'] || [],
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function loginTest(label, payload, expect) {
  let res;
  try {
    res = await requestJson(LOGIN_URL, { method: 'POST', payload });
  } catch (err) {
    bad(`${label}: could NOT reach the API (${err.message})`);
    return null;
  }

  if (res.status !== expect.status) {
    bad(`${label}: expected HTTP ${expect.status}, got ${res.status} (${res.json.message || 'no message'})`);
    return res;
  }
  ok(`${label}: HTTP ${res.status} → "${res.json.message || 'no message'}"`);
  return res;
}

async function verifyDatabase() {
  console.log('\n  [1] DATABASE CHECK\n');
  for (const acc of ACCOUNTS) {
    const email = acc.email.trim().toLowerCase();
    const user  = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') }).select('+password');

    if (!user) { bad(`Account "${email}" is MISSING from database — run: npm run seed:auth`); continue; }

    if (user.role !== acc.role) bad(`${email}: role is "${user.role}", expected "${acc.role}" — run seed:auth to repair`);
    else                       ok(`${email}: role = ${user.role}`);

    if (user.status !== 'active') bad(`${email}: status is "${user.status}", expected "active" — run seed:auth to repair`);
    else                          ok(`${email}: status = active`);

    const hashOk = user.password && /^\$2[aby]?\$\d{2}\$/.test(user.password)
      ? await bcrypt.compare(acc.password, user.password).catch(() => false)
      : false;
    if (!user.password)                  bad(`${email}: password field is EMPTY — run seed:auth`);
    else if (!/^\$2[aby]?\$\d{2}\$/.test(user.password)) bad(`${email}: password is NOT a bcrypt hash — run seed:auth`);
    else if (!hashOk)                    bad(`${email}: stored hash does NOT match the seed password — run seed:auth`);
    else                                 ok(`${email}: password hash verifies with bcrypt.compare()`);

    if (acc.isTechnician) {
      const prof = await Technician.findOne({ user: user._id });
      if (!prof) bad(`${email}: has role Technician but NO Technician profile — run seed:auth to create one`);
      else       ok(`${email}: Technician profile exists (id: ${prof._id})`);
    }
  }
}

async function verifyApi() {
  console.log('\n  [2] LIVE API CHECK  (POST ' + LOGIN_URL + ')\n');

  const anonymousMe = await requestJson(`${AUTH_URL}/me`);
  if (anonymousMe.status === 401) {
    ok('unauthenticated /me correctly returns HTTP 401');
  } else {
    bad(`unauthenticated /me returned ${anonymousMe.status}, expected 401`);
  }
  if (anonymousMe.setCookies.length) bad("unauthenticated /me issued a cookie");
  else ok("unauthenticated /me did not issue an authentication cookie");

  let reachable = false;
  for (const acc of ACCOUNTS) {
    const label = `${acc.email}`;

    const success = await loginTest(`${label} correct credentials`, { email: acc.email, password: acc.password }, { status: 200 });
    if (!success) continue;
    reachable = true;

    const token = success.json.token;
    if (typeof token !== "string" || !token) {
      bad(`${label}: 200 but NO bearer token was issued`);
      continue;
    }
    if (success.setCookies.length) {
      bad(`${label}: login unexpectedly issued an authentication cookie`);
      continue;
    }
    ok(`${label}: bearer token issued without a session cookie`);

    if (!success.json.user || success.json.user.role !== acc.role)
      bad(`${label}: role in response is "${success.json.user?.role}", expected "${acc.role}"`);
    else ok(`${label}: role preserved in response (${acc.role})`);

    const expectedRedirect = { 'ICT Admin': '/views/admin/dashboard.html', 'Technician': '/views/technician/dashboard.html', 'Requester': '/views/user/dashboard.html' }[acc.role];
    if (success.json.redirect !== expectedRedirect)
      bad(`${label}: redirect is "${success.json.redirect}", expected "${expectedRedirect}"`);
    else ok(`${label}: redirect = ${expectedRedirect}`);

    const me = await requestJson(`${AUTH_URL}/me`, { token });
    if (me.status !== 200 || me.json.user?.role !== acc.role) {
      bad(`${label}: authenticated /me returned ${me.status} or the wrong role`);
    } else {
      ok(`${label}: authenticated /me confirms role ${acc.role}`);
      const sensitiveFields = [
        'password',
        'resetPasswordCodeHash',
        'resetPasswordCodeExpires',
        'resetPasswordCodeAttempts',
        'resetPasswordDeliveryMethod',
        'resetPasswordRequestId',
        'resetPasswordCodeSentAt',
        'resetPasswordVerifiedHash',
        'resetPasswordVerifiedExpires',
      ];
      const exposedFields = sensitiveFields.filter((field) =>
        Object.prototype.hasOwnProperty.call(me.json.user, field),
      );
      if (exposedFields.length) {
        bad(`${label}: authenticated /me exposed sensitive fields: ${exposedFields.join(', ')}`);
      } else {
        ok(`${label}: authenticated /me excludes password and password-reset fields`);
      }
    }

    const logout = await requestJson(`${AUTH_URL}/logout`, {
      method: 'POST',
    });
    if (logout.status !== 200) {
      bad(`${label}: logout returned HTTP ${logout.status}`);
    } else ok(`${label}: stateless logout endpoint responds successfully`);

    /* Negative cases */
    await loginTest(`${label} WRONG password`, { email: acc.email, password: 'WrongPass!999' }, { status: 401 });
    await loginTest(`${label} UNKNOWN email`,    { email: 'nobody@dbu.edu.et', password: acc.password }, { status: 401 });
  }

  await loginTest('MISSING fields', { email: '', password: '' }, { status: 422 });
  await loginTest('MALFORMED fields (numbers)', { email: 123, password: 456 }, { status: 422 });

  if (!reachable) {
    bad('API is not responding. Start the backend first (`npm start`), then re-run npm run verify:auth.');
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Authentication Verification Tool                ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    await connectDB();
    console.log(`  [MongoDB] Connected → database: ${mongoose.connection.name}`);
  } catch (err) {
    console.error(`\n  ✖  Could not connect to MongoDB: ${err.message}`);
    process.exit(1);
  }

  await verifyDatabase();
  await verifyApi();

  console.log('\n' + '─'.repeat(52));
  console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount === 0) console.log('  All authentication checks passed.\n');
  else console.log('  Fix the failures above (usually: npm run seed:auth), then re-run.\n');

  await mongoose.connection.close().catch(() => {});
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\n  ✖  Verification failed: ${err.message}`);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});