/**
 * scripts/verify-password-reset.js — Password-reset security verification.
 * Smart ICT Maintenance Management System
 *
 * Verifies the server-side password-reset machinery through the LIVE API:
 *
 *   [A] enum-safety / validation surface of POST /api/auth/forgot-password
 *   [B] OTP hash verification (wrong code rejected, correct code accepted)
 *   [C] OTP attempt budget (brute-force lockout, even for the correct code)
 *   [D] OTP expiration (server-enforced; client timers are irrelevant)
 *   [E] single-use reset authorization (token cannot be replayed)
 *   [F] reset-session expiry
 *   [G] password updated securely + role preserved + login with new password
 *   [H] rate limiting: a legitimate request is never blocked, and the limit
 *       eventually engages with a usable Retry-After (skipped with
 *       SKIP_RATE_LIMIT_TEST=1, because it deliberately exhausts the
 *       per-IP bucket for RATE_LIMIT_WINDOW_MS)
 *
 * Why direct DB seeding for the OTP: the real code is emailed via the provider and is
 * deliberately never persisted in plaintext, so an automated run cannot read
 * it. To exercise the OTP logic we write the exact SAME fields the controller
 * writes after a successful send (hash = sha256 of a known code) and then call
 * the real endpoints. Live email delivery is checked separately with
 * scripts/verify-email-provider.js.
 *
 * Run from backend/:   node scripts/verify-password-reset.js
 * Requires the backend server to be RUNNING (npm start first).
 * Creates temporary @gmail.com test accounts and always deletes them.
 *
 * Never logs passwords, codes, reset tokens, or password hashes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');
const User = require('../models/User');
const { RATE_LIMIT } = require('../config/env');

const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.PORT || 5000);
const BASE = `http://${API_HOST}:${API_PORT}/api/auth`;

const RUN_ID = Date.now().toString(36);
const TEST_EMAILS = {
  happy: `pwdreset.happy.${RUN_ID}@gmail.com`,
  expiredCode: `pwdreset.expcode.${RUN_ID}@gmail.com`,
  lockout: `pwdreset.lockout.${RUN_ID}@gmail.com`,
  expiredSession: `pwdreset.expsess.${RUN_ID}@gmail.com`,
  rateLimit: `pwdreset.ratelimit.${RUN_ID}@gmail.com`,
};
const SKIP_RATE_LIMIT_TEST = process.env.SKIP_RATE_LIMIT_TEST === '1';
const ORIGINAL_PASSWORD = 'OrigPass123!';
const NEW_PASSWORD = 'NewPass456!';
const HAPPY_CODE = '123456';
const EXPIRED_CODE = '654321';
const LOCK_CODE = '111111';
const SESSION_CODE = '222222';

let failCount = 0, passCount = 0;
const ok = (msg) => { passCount++; console.log(`  ✔  ${msg}`); };
const bad = (msg) => { failCount++; console.log(`  ✖  ${msg}`); };

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function postJson(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      protocol: 'http:', hostname: API_HOST, port: API_PORT,
      path: BASE + urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(raw); } catch (_) { /* non-JSON body */ }
        resolve({ status: res.statusCode, json, headers: res.headers || {} });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function seedUser(email, code, { expiresAheadMs = 10 * 60 * 1000, attempts = 0 } = {}) {
  const user = await User.create({
    fullName: 'Password Reset Test',
    email,
    password: await bcrypt.hash(ORIGINAL_PASSWORD, 12),
    role: 'Requester',
    department: 'Test Only',
    status: 'active',
  });
  user.resetPasswordCodeHash = sha256(code);
  user.resetPasswordCodeExpires = new Date(Date.now() + expiresAheadMs);
  user.resetPasswordCodeAttempts = attempts;
  user.resetPasswordDeliveryMethod = 'email';
  user.resetPasswordRequestId = crypto.randomUUID();
  user.resetPasswordCodeSentAt = new Date();
  await user.save({ validateBeforeSave: false });
  return user;
}

async function getResetState(email) {
  return User.findOne({ email }).select(
    '+resetPasswordCodeHash +resetPasswordCodeExpires +resetPasswordCodeAttempts +resetPasswordVerifiedHash +resetPasswordVerifiedExpires +password',
  );
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Password Reset Security Verification             ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    await connectDB();
    console.log(`  [MongoDB] Connected → database: ${mongoose.connection.name}\n`);
  } catch (err) {
    console.error(`\n  ✖  Could not connect to MongoDB: ${err.message}`);
    process.exit(1);
  }

  const created = [];

  try {
    /* ── [A] Forgot-password enum/validation surface ───────────────── */
    console.log('  [A] FORGOT-PASSWORD API SURFACE\n');

    const noEmail = await postJson('/forgot-password', { email: '' });
    if (noEmail.status !== 422)
      bad(`empty email → expected 422, got ${noEmail.status}`);
    else ok('empty email rejected with 422');

    const badEmail = await postJson('/forgot-password', { email: 'not-an-email' });
    if (badEmail.status !== 422)
      bad(`malformed email → expected 422, got ${badEmail.status}`);
    else ok('malformed email rejected with 422');

    const missing = await postJson('/forgot-password', { email: `nobody.today.${RUN_ID}@gmail.com` });
    const missingMsg = String(missing.json.message || '');
    const enumLeak = /does not exist|not found|not registered|no account/i.test(missingMsg);
    if (missing.status !== 200)
      bad(`unknown email → expected generic 200, got ${missing.status}`);
    else if (enumLeak)
      bad(`unknown email → response LEAKS account state: "${missingMsg}"`);
    else
      ok(`unknown email → generic enumeration-safe response (HTTP ${missing.status})`);

    /* ── [B] Correct / incorrect OTP ──────────────────────────────── */
    console.log('\n  [B] OTP VERIFICATION\n');
    const happy = await seedUser(TEST_EMAILS.happy, HAPPY_CODE);
    created.push(happy._id);

    const wrongCode = await postJson('/verify-reset-code', { email: TEST_EMAILS.happy, code: '000000' });
    if (wrongCode.status !== 400 || !/incorrect/i.test(wrongCode.json.message || ''))
      bad(`wrong OTP → expected 400/incorrect, got ${wrongCode.status} "${wrongCode.json.message}"`);
    else ok('wrong OTP rejected as incorrect');

    const afterWrong = await getResetState(TEST_EMAILS.happy);
    if (afterWrong.resetPasswordCodeAttempts !== 1)
      bad(`wrong OTP → attempts=${afterWrong.resetPasswordCodeAttempts}, expected 1`);
    else ok('wrong OTP increments the attempt counter');

    const verifyOk = await postJson('/verify-reset-code', { email: TEST_EMAILS.happy, code: HAPPY_CODE });
    const token = verifyOk.json.resetToken;
    if (verifyOk.status !== 200)
      bad(`correct OTP → expected 200, got ${verifyOk.status} "${verifyOk.json.message}"`);
    else if (!/^[a-f0-9]{64}$/i.test(token || ''))
      bad('correct OTP → response did not include a valid reset authorization token');
    else ok('correct OTP accepted and reset authorization token issued');

    if (verifyOk.status === 200) {
      const afterOk = await getResetState(TEST_EMAILS.happy);
      if (afterOk.resetPasswordCodeHash !== null)
        bad('after OTP verification the code hash was not cleared');
      else ok('OTP consumed (code hash cleared after verification)');
      if (!afterOk.resetPasswordVerifiedHash || !afterOk.resetPasswordVerifiedExpires || afterOk.resetPasswordVerifiedExpires < new Date())
        bad('reset authorization hash/expiry missing after verification');
      else ok('reset authorization stored (single-use hash + expiry)');
    }

    /* ── [C] Attempt budget / brute-force lockout ─────────────────── */
    console.log('\n  [C] ATTEMPT BUDGET\n');
    const lockUser = await seedUser(TEST_EMAILS.lockout, LOCK_CODE);
    created.push(lockUser._id);

    let lockStatus = 0;
    for (let i = 0; i < 5; i++) {
      const attempt = await postJson('/verify-reset-code', {
        email: TEST_EMAILS.lockout,
        code: String(900000 + i),
      });
      lockStatus = attempt.status;
    }
    if (lockStatus !== 400)
      bad(`5 wrong OTPs → expected the 5th to still be 400, got ${lockStatus}`);
    else ok('each wrong OTP rejected while within the budget');

    const afterLock = await getResetState(TEST_EMAILS.lockout);
    if (afterLock.resetPasswordCodeAttempts !== 5)
      bad(`attempt counter reached ${afterLock.resetPasswordCodeAttempts}, expected 5`);
    else ok('attempt counter reached the limit (5)');

    const locked = await postJson('/verify-reset-code', { email: TEST_EMAILS.lockout, code: LOCK_CODE });
    if (locked.status !== 429)
      bad(`correct OTP after limit → expected 429 lockout, got ${locked.status}`);
    else if (!/too many|attempts/i.test(locked.json.message || ''))
      bad(`lockout message unclear: "${locked.json.message}"`);
    else ok('OTP locked after too many attempts (correct code no longer accepted)');

    /* ── [D] Expired OTP ────────────────────────────────────────── */
    console.log('\n  [D] OTP EXPIRATION\n');
    const expUser = await seedUser(TEST_EMAILS.expiredCode, EXPIRED_CODE, { expiresAheadMs: -60 * 1000 });
    created.push(expUser._id);

    const expired = await postJson('/verify-reset-code', { email: TEST_EMAILS.expiredCode, code: EXPIRED_CODE });
    if (expired.status !== 400 || !/expired/i.test(expired.json.message || ''))
      bad(`expired OTP → expected 400/expired, got ${expired.status} "${expired.json.message}"`);
    else ok('expired OTP rejected by the server (server-enforced)');

    const afterExp = await getResetState(TEST_EMAILS.expiredCode);
    if (afterExp.resetPasswordCodeHash !== null)
      bad('expired OTP → code hash was not cleared on expiry');
    else ok('expired OTP state cleared after rejection');

    /* ── [E] Single-use reset authorization + [G] password update ───── */
    console.log('\n  [E] RESET AUTHORIZATION + PASSWORD UPDATE\n');
    if (verifyOk.status === 200) {
      const roleBefore = happy.role;

      const resetOk = await postJson('/reset-password', {
        resetToken: token,
        password: NEW_PASSWORD,
      });
      if (resetOk.status !== 200)
        bad(`reset with valid token → expected 200, got ${resetOk.status} "${resetOk.json.message}"`);
      else ok('password reset succeeded with a valid authorization token');

      const afterReset = await getResetState(TEST_EMAILS.happy);
      if (afterReset.resetPasswordVerifiedHash !== null)
        bad('reset token hash not consumed (single-use violated)');
      else ok('reset authorization consumed (single-use)');
      if (afterReset.role !== roleBefore)
        bad(`role changed during reset: "${roleBefore}" → "${afterReset.role}"`);
      else ok(`role preserved during reset (${afterReset.role})`);
      const oldPw = await bcrypt.compare(ORIGINAL_PASSWORD, afterReset.password).catch(() => false);
      const newPw = await bcrypt.compare(NEW_PASSWORD, afterReset.password).catch(() => false);
      if (oldPw) bad('old password still matches after reset');
      else ok('old password no longer valid');
      if (!newPw) bad('new password does not match the stored hash');
      else ok('new password stored as a secure (bcrypt) hash');

      const reuse = await postJson('/reset-password', { resetToken: token, password: NEW_PASSWORD });
      if (reuse.status !== 400)
        bad(`replaying the same reset token → expected 400, got ${reuse.status}`);
      else ok('reset token cannot be replayed (single-use)');

      const missingToken = await postJson('/reset-password', { password: NEW_PASSWORD });
      if (missingToken.status !== 400)
        bad(`reset without any token → expected 400, got ${missingToken.status}`);
      else ok('reset without an authorization token rejected');

      const weakPw = await postJson('/reset-password', { resetToken: token, password: 'short' });
      if (weakPw.status !== 400)
        bad(`reset with a weak password → expected 400, got ${weakPw.status}`);
      else ok('weak password rejected by backend policy');
    }

    /* ── [F] Expired reset session ────────────────────────────────── */
    console.log('\n  [F] RESET-SESSION EXPIRY\n');
    const sessUser = await seedUser(TEST_EMAILS.expiredSession, SESSION_CODE);
    created.push(sessUser._id);
    const sessVerify = await postJson('/verify-reset-code', { email: TEST_EMAILS.expiredSession, code: SESSION_CODE });
    if (sessVerify.status === 200 && /^[a-f0-9]{64}$/i.test(sessVerify.json.resetToken || '')) {
      await User.updateOne(
        { email: TEST_EMAILS.expiredSession },
        { resetPasswordVerifiedExpires: new Date(Date.now() - 60 * 1000) },
      );
      const sessReset = await postJson('/reset-password', {
        resetToken: sessVerify.json.resetToken,
        password: NEW_PASSWORD,
      });
      if (sessReset.status !== 400 || !/expired/i.test(sessReset.json.message || ''))
        bad(`expired reset session → expected 400/expired, got ${sessReset.status} "${sessReset.json.message}"`);
      else ok('expired reset authorization rejected by the server');
    } else {
      bad('could not establish a reset session for the expiry test');
    }

    /* ── [G] Login with the new password ─────────────────────────── */
    console.log('\n  [G] LOGIN AFTER RESET\n');
    if (verifyOk.status === 200) {
      const oldLogin = await postJson('/login', { email: TEST_EMAILS.happy, password: ORIGINAL_PASSWORD });
      if (oldLogin.status !== 401)
        bad(`login with the old password → expected 401, got ${oldLogin.status}`);
      else ok('login with the old password rejected');

      const newLogin = await postJson('/login', { email: TEST_EMAILS.happy, password: NEW_PASSWORD });
      if (newLogin.status !== 200 || !newLogin.json.success)
        bad(`login with the new password → expected 200, got ${newLogin.status} "${newLogin.json.message}"`);
      else if (newLogin.json.user && newLogin.json.user.role !== 'Requester')
        bad(`role after reset login is "${newLogin.json.user.role}", expected "Requester"`);
      else ok('login with the new password succeeds with the correct role');
    }

    /* ── [H] Rate limiting ──────────────────────────────────────
       Runs LAST because it deliberately exhausts a bucket. The reported defect
       was a valid forgot-password request being answered with 429, so the first
       assertion is the direct regression guard: a single legitimate request
       for a fresh address must NOT be rate limited. */
    console.log('\n  [H] RATE LIMITING\n');

    if (SKIP_RATE_LIMIT_TEST) {
      console.log('  – skipped (SKIP_RATE_LIMIT_TEST=1)');
    } else {
      const legit = await postJson('/forgot-password', { email: TEST_EMAILS.rateLimit });
      if (legit.status === 429)
        bad(`a single legitimate forgot-password request was rate limited (429 "${legit.json.message}")`);
      else
        ok(`a single legitimate request is never rate limited (HTTP ${legit.status})`);

      /* One address, repeatedly requested, must eventually be throttled — and
         the 429 must carry a usable Retry-After so the UI can show a real
         countdown instead of a generic "try again later". */
      const burstLimit = RATE_LIMIT.forgotAccount;
      let limited = null;
      for (let i = 0; i < burstLimit + 2; i++) {
        const attempt = await postJson('/forgot-password', { email: TEST_EMAILS.rateLimit });
        if (attempt.status === 429) { limited = { attempt, index: i + 1 }; break; }
      }
      if (!limited)
        bad(`repeated requests for one address were never throttled after ${burstLimit + 2} tries`);
      else
        ok(`repeated requests for one address are throttled after ${limited.index} (per-account limit ${burstLimit})`);

      if (limited) {
        const retryAfter = Number(limited.attempt.headers['retry-after']);
        if (!Number.isFinite(retryAfter) || retryAfter <= 0)
          bad('429 response did not include a usable Retry-After header');
        else
          ok(`429 carries Retry-After: ${retryAfter}s`);

        const msg = String(limited.attempt.json.message || '');
        if (!msg || /too many requests\. please try again later\.$/i.test(msg))
          bad(`429 message is not actionable: "${msg}"`);
        else
          ok(`429 message is specific: "${msg}"`);
      }
    }

    console.log('\n' + '─'.repeat(52));
    console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
    if (failCount === 0) console.log('  Password-reset security checks passed.\n');
    else console.log('  Review the failures above.\n');
  } catch (err) {
    console.error(`\n  ✖  Unexpected error: ${err && err.message ? err.message : err}`);
    if (err && err.code === 'ECONNREFUSED') {
      console.error('  → Is the backend running? Start it with `npm start` (backend/) and re-run.');
    }
    failCount++;
  } finally {
    /* Cleanup — never leave test accounts behind. */
    if (created.length) {
      await User.deleteMany({ _id: { $in: created } });
      console.log(`  [cleanup] removed ${created.length} temporary test account(s).`);
    }
    await mongoose.connection.close().catch(() => {});
  }

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`\n  ✖  Verification failed: ${err.message}`);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});