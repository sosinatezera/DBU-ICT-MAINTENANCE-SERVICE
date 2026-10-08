/**
 * scripts/diagnose-forgot-password.js
 * One-shot diagnostic for POST /api/auth/forgot-password answering HTTP 503.
 *
 * Run from backend/:
 *   npm run diagnose:forgot
 *   npm run diagnose:forgot -- you@example.com     <- also checks the user row
 *
 * Produces the entire evidence chain in a single run:
 *   1. Email provider presence — names + yes/no only, never values
 *   2. MongoDB connection       — connected / failed (+ safe reason)
 *   3. User lookup              — found yes/no + status only
 *   4. Provider check            — failure category + HTTP/error code
 *   5. Live POST to the endpoint— HTTP status + `code` + message
 *
 * Step 5 is the decisive one: both 503 sources in authController.js return a
 * distinct `code`, so the exact branch is identified without guessing.
 *
 * NOTHING sensitive is printed: no API key, SMTP password, Mongo URI, JWT or
 * session secret, no verification code, no reset token, and no full address
 * (addresses are reduced to their masked form).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const mongoose = require('mongoose');
const env = require('../config/env');
const {
  emailConfigured,
  verifyEmailProvider,
  maskEmail,
  describeEmailMissing,
} = require('../services/mailer');

const line = (t) =>
  console.log(`\n  ── ${t} ${'─'.repeat(Math.max(2, 44 - t.length))}`);
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const info = (m) => console.log(`  ····  ${m}`);

const PORT = Number(process.env.PORT || 5000);
const targetEmail = String(process.argv[2] || '').trim().toLowerCase();
const yesNo = (v) => (v ? 'yes' : 'NO');

function postJson(port, path, payload) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            data = { message: '(non-JSON body)', _raw: raw.slice(0, 200) };
          }
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      },
    );
    req.on('error', (err) =>
      resolve({ status: 0, data: { code: 'NETWORK', message: err.code || err.message } }),
    );
    req.end(payload);
  });
}

async function main() {
  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('   Forgot Password (503) — diagnostic');
  console.log('  ═══════════════════════════════════════════════════════');

  /* ── 1. Email provider configuration: presence only ─────────── */
  line('1. EMAIL PROVIDER CONFIGURATION');
  info(`NODE_ENV              : ${env.NODE_ENV}`);
  info(`EMAIL_PROVIDER        : ${env.EMAIL_PROVIDER}`);
  info(`RESEND_API_KEY        : ${yesNo(process.env.RESEND_API_KEY)}`);
  info(`EMAIL_FROM            : ${yesNo(env.EMAIL_FROM)}`);
  info(`EMAIL_CONFIGURED      : ${emailConfigured()}`);
  info(`SESSION_SECRET        : ${yesNo(process.env.SESSION_SECRET)}`);
  info(`MONGO_URI             : ${yesNo(process.env.MONGO_URI)}`);
  if (emailConfigured()) {
    pass(`${env.EMAIL_PROVIDER} configuration is complete for this process.`);
  } else {
    fail(
      `EMAIL_CONFIGURATION_ERROR — this process cannot send mail. Missing: ${describeEmailMissing()}.`,
    );
    info('If the variables ARE set in backend/.env, this process is STALE:');
    info('env.js reads the file ONCE at boot, so the backend must be restarted.');
  }

  /* ── 2 + 3. MongoDB and the user row ────────────────────────── */
  line('2. MONGODB');
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is not set — db.js would exit(1) at boot.');
  } else {
    try {
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
      pass(`connected to database "${mongoose.connection.name}"`);

      line('3. USER LOOKUP');
      if (!targetEmail) {
        info('no address supplied — pass one to check the row, e.g.');
        info('  npm run diagnose:forgot -- you@example.com');
      } else {
        const User = require('../models/User');
        const user = await User.findOne({ email: targetEmail })
          .select('status role')
          .lean();
        if (!user) {
          fail(`no account matches ${maskEmail(targetEmail)} — the endpoint will return the generic 200 and send nothing.`);
        } else if (user.status !== 'active') {
          fail(`account exists but status="${user.status}" — a code is never issued for a non-active account.`);
        } else {
          pass(`account found, status="active" — the reset flow will run.`);
        }
      }
    } catch (err) {
      fail(`connection failed (${err.name}) — no user lookup was possible.`);
    } finally {
      await mongoose.connection.close().catch(() => {});
    }
  }

  /* ── 4. Real email-provider check ───────────────────────────── */
  line('4. EMAIL PROVIDER CONNECTIVITY');
  if (!emailConfigured()) {
    fail('skipped — EMAIL_CONFIGURATION_ERROR (nothing to verify).');
  } else {
    try {
      const result = await verifyEmailProvider();
      if (result.ok) {
        pass(`${env.EMAIL_PROVIDER} verification: success — ${result.detail}`);
      } else {
        fail(`${env.EMAIL_PROVIDER} verification: failure — ${result.code}`);
        info(result.detail);
      }
    } catch (err) {
      fail(`verification threw unexpectedly (${err.name}).`);
    }
  }

  /* ── 5. Live endpoint test — the decisive step ──────────────── */
  line('5. LIVE ENDPOINT TEST');
  const probeEmail = targetEmail || 'diagnostic-probe@example.com';
  info(`POST http://localhost:${PORT}/api/auth/forgot-password`);
  info(`body: { "email": "<${maskEmail(probeEmail)}>" }`);
  const res = await postJson(
    PORT,
    '/api/auth/forgot-password',
    JSON.stringify({ email: probeEmail }),
  );

  if (res.status === 0) {
    fail(`no response (${res.data.message}) — is the backend running on port ${PORT}?`);
  } else {
    info(`HTTP status    : ${res.status}`);
    info(`error code     : ${res.data.code || '(none)'}`);
    info(`message        : ${res.data.message || '(none)'}`);
    if (res.headers['retry-after']) {
      info(`Retry-After    : ${res.headers['retry-after']}s (rate limited)`);
    }

    if (res.status === 503) {
      info('');
      info('VERDICT — exact 503 branch:');
      if (res.data.code === 'EMAIL_CONFIGURATION_ERROR') {
        info('  authController.js — provider availability gate.');
        info('  The running process answered emailConfigured() === false.');
        info('');
        /* Compare what THIS process reads from backend/.env against what the
           server answered. The two disagreeing is the stale-process proof:
           env.js loads the file once at boot, so a server started before the
           provider variables were added keeps reporting false forever. */
        const localConfigured = emailConfigured();
        info(`  this diagnostic reads emailConfigured() = ${localConfigured}`);
        info(`  the running server answered      = false`);
        info('');
        if (localConfigured) {
          info('  >> STALE PROCESS DETECTED.');
          info('     backend/.env is complete, but the running server was');
          info('     started before the provider variables were present.');
          info('     FIX: stop node, then `npm start` again. No code change needed.');
        } else {
          info('  >> CONFIGURATION GENUINELY INCOMPLETE on this machine.');
          info(`     Missing: ${describeEmailMissing()}`);
        }
      } else {
        info('  Forgot-password delivery attempt failed.');
        info('  The code was generated and stored, then the send failed.');
        info('  The stored code is rolled back automatically.');
        info('  FIX: see the provider failure category in section 4 above.');
      }
    } else if (res.status === 200) {
      pass('endpoint answered 200 — no 503. Check the mailbox next.');
    } else if (res.status === 429) {
      fail('rate limited (429) — wait for Retry-After, then re-run.');
    } else {
      info(`unclassified status ${res.status}.`);
    }
  }

  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('   End of diagnostic\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n  Unexpected failure: ${err && err.name}: ${err && err.message}`);
    process.exit(1);
  });
