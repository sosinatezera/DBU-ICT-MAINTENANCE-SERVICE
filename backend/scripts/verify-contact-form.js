/**
 * scripts/verify-contact-form.js — End-to-end check of the public contact form.
 * Smart ICT Maintenance Management System
 *
 * Drives the EXACT request the landing page sends, so a pass here means the
 * browser flow passes:
 *
 *   POST <API_BASE>/inquiries
 *   Content-Type: application/json
 *   { fullName, email, subject, message }
 *
 * Stages reported (PASS / FAIL each, then a verdict):
 *   1. ADMIN_EMAIL configured      (the 503 cause: no recipient)
 *   2. SMTP provider configured     (the 503 cause: no transport)
 *   3. Frontend request             (endpoint reachable, correct method/fields)
 *   4. Backend response             (HTTP status + JSON success)
 *   5. Success message present      (a real string, not a fallback)
 *
 * Usage (from backend/):
 *   npm run verify:contact
 *   npm run verify:contact -- --api=http://localhost:5000/api
 *   npm run verify:contact -- --name="Test User" --email=test@example.com
 *
 * Exit codes: 0 = contact form works, 1 = it does not.
 *
 * SECURITY: never prints SMTP_USER in full, never prints any password, and
 * never prints the admin inbox. Recipient presence is reported as a boolean and
 * SMTP_USER is masked, matching services/mailer.js.
 *
 * NOTE: a 503 here means the message was stored in MongoDB but the ICT Admin
 * was NOT emailed. Retrying writes a second inquiry record.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const https = require('https');
const { URL } = require('url');

const env = require('../config/env');
const {
  smtpConfigured,
  describeMissing,
  maskEmail,
  EMAIL_ERROR,
} = require('../services/mailer');

/* ── CLI args ──────────────────────────────────────────────── */
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = hit.slice(name.length + 3).replace(/^["']|["']$/g, '');
  return v || fallback;
}

const API_BASE = arg('api', 'http://localhost:5000/api').replace(/\/+$/, '');
const PAYLOAD = {
  fullName: arg('name', 'Test User'),
  email: arg('email', 'test@example.com'),
  subject: arg('subject', 'Test Contact Message'),
  message: arg('message', 'This is a test message.'),
};

/* ── Tiny reporting helper ──────────────────────────────────── */
let failed = 0;

/* `informational` stages describe the local .env only. They are printed but do
   NOT affect the verdict, because when --api points at a deployed service the
   local file is not what that server is using. */
function stage(label, pass, detail, informational) {
  const mark = informational ? (pass ? 'OK  ' : 'WARN') : pass ? 'PASS' : 'FAIL';
  if (!informational && !pass) failed++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/* ── Minimal JSON POST (no fetch dependency on Node version) ── */
function postJson(urlString, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`Invalid URL: ${urlString}`));
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: 'application/json',
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* non-JSON body is reported by the caller */
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('Request timed out after 30s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ── Run ────────────────────────────────────────────────────── */
async function main() {
  console.log('\n  ── Contact form end-to-end check ─────────────────────');
  console.log(`  Target : POST ${API_BASE}/inquiries`);
  console.log(
    `  Payload: { fullName, email, subject, message } — ${
      Object.keys(PAYLOAD).join(', ')
    }`,
  );
  const remote = !/localhost|127\.0\.0\.1/i.test(API_BASE);
  if (remote) {
    console.log(
      "  Note   : stages 1-2 read the LOCAL backend/.env, which says nothing",
    );
    console.log(
      "           about the remote deployment. Stage 4 is authoritative there.",
    );
  }
  console.log('  ──────────────────────────────────────────────────────');

  /* Stage 1 — recipient configured (the usual root cause of a 503 here). */
  const adminOk = env.ADMIN_EMAIL_STATUS.configured;
  stage(
    '1. ADMIN_EMAIL configured (local .env)',
    adminOk,
    adminOk
      ? 'recipient present (value not shown)'
      : `missing: ${env.ADMIN_EMAIL_STATUS.missing.join(', ')}`,
    remote,
  );

  /* Stage 2 — provider configured. */
  const smtpOk = smtpConfigured();
  stage(
    '2. SMTP provider configured (local .env)',
    smtpOk,
    smtpOk
      ? `${env.SMTP_HOST}:${env.SMTP_PORT} as ${maskEmail(env.SMTP_USER)}`
      : `missing: ${describeMissing()}`,
    remote,
  );

  /* Stage 3/4 — the live request. */
  let res = null;
  try {
    res = await postJson(`${API_BASE}/inquiries`, PAYLOAD);
  } catch (err) {
    stage('3. Frontend request', false, `${err.message} — is the backend running on ${API_BASE}?`);
    report();
    process.exit(1);
  }

  stage(
    '3. Frontend request',
    true,
    `HTTP ${res.status}`,
  );

  const body = res.json;
  /* HTTP 201 only proves the request was handled. `notified:false` means the
     message was STORED but no notification email left the server, which must
     not be reported as a working contact form. */
  const notified = Boolean(body) && body.notified !== false;
  stage(
    '4. Backend response (JSON success + email sent)',
    Boolean(body && body.success === true && notified),
    body
      ? `success=${body.success} notified=${body.notified}${
          body.code ? ` code=${body.code}` : ''
        }${body.message ? ` message="${body.message}"` : ''}`
      : `non-JSON body: ${res.text.slice(0, 200)}`,
  );

  /* Stage 5 — a real message came back for the visitor. */
  const msg = body && typeof body.message === 'string' ? body.message.trim() : '';
  stage(
    '5. Success message present',
    msg.length > 0,
    msg ? msg : 'no message field in response',
  );

  if (res.status === 503) {
    console.log('\n  Diagnosis: the submission WAS stored in MongoDB, but the ICT');
    console.log('  Admin was NOT emailed, so the endpoint refuses to confirm it.');
    console.log('  (Do not retry against a real inbox: each retry writes a new row.)');
    if (body && body.reason === 'contact.notification_unavailable') {
      console.log(`  Cause: ${EMAIL_ERROR.CONFIGURATION} — the server has no usable`);
      console.log('         admin recipient. Set ADMIN_EMAIL where THAT server reads');
      console.log(
        remote
          ? '         its environment (e.g. Render Dashboard -> service -> Environment).'
          : '         it: backend/.env, then restart the backend.',
      );
    } else {
      console.log('  Cause: the provider refused or dropped the message (transient).');
      console.log('  Run  npm run verify:smtp  for the failing stage (no secrets printed).');
    }
  }

  report();
  process.exit(failed > 0 ? 1 : 0);
}

function report() {
  console.log('  ──────────────────────────────────────────────────────');
  console.log(
    `  Verdict: ${failed === 0 ? 'PASS — contact form works' : `FAIL — ${failed} stage(s) failed`}`,
  );
  console.log('');
}

main().catch((err) => {
  console.error('  Unexpected error:', err && err.message ? err.message : err);
  process.exit(1);
});
