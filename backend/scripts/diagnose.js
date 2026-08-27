/**
 * scripts/diagnose.js — Deep MongoDB Atlas connection diagnostics
 *
 * Usage:  node scripts/diagnose.js
 *
 * This script does NOT print your password. It validates everything
 * it can before attempting the connection.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dns = require('dns');
const { URL } = require('url');

const uri = (process.env.MONGO_URI || '').trim();
const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

console.log('');
console.log('=== MongoDB Atlas Diagnostics ===');
console.log('');

/* ── 1. URI format validation ────────────────────────────── */
console.log('[1] URI Format Check');
console.log('    Length:', uri.length);
console.log('    Starts with mongodb+srv://', uri.startsWith('mongodb+srv://'));

if (!uri.startsWith('mongodb+srv://')) {
  console.error('    FATAL: URI must start with mongodb+srv://');
  process.exit(1);
}

const without = uri.replace('mongodb+srv://', '');
const atIdx = without.indexOf('@');
if (atIdx === -1) {
  console.error('    FATAL: No @ found — URI format is wrong');
  process.exit(1);
}

const credPart = without.substring(0, atIdx);
const restPart = without.substring(atIdx + 1);
const colonIdx = credPart.indexOf(':');
const username = colonIdx > -1 ? credPart.substring(0, colonIdx) : credPart;
const password = colonIdx > -1 ? credPart.substring(colonIdx + 1) : '';

console.log('    Username:', username);
console.log('    Password length:', password.length);
console.log('    Password is empty:', password.length === 0);
console.log('    Password has unescaped @:', password.includes('@'));
console.log('    Password has unescaped /:', password.includes('/'));
console.log('    Password has unescaped #:', password.includes('#'));

const hostPart = restPart.split('?')[0];
const params = restPart.includes('?') ? restPart.substring(restPart.indexOf('?') + 1) : '';
console.log('    Host:', hostPart);
console.log('    Has retryWrites:', params.includes('retryWrites'));
console.log('    Has w=majority:', params.includes('w=majority'));
console.log('    Database in path:', hostPart.replace(hostPart.split('/')[0], '') || '(none)');
console.log('    dbName option:', dbName);
console.log('');

/* ── 2. DNS SRV resolution from Node.js ──────────────────── */
console.log('[2] DNS SRV Resolution (from Node.js)');

const srvHost = '_mongodb._tcp.' + hostPart;
console.log('    Querying:', srvHost);

const srvPromise = new Promise((resolve) => {
  dns.resolveSrv(srvHost, (err, records) => {
    if (err) {
      console.error('    FAILED:', err.code || err.message);
      console.log('    This means Node.js cannot resolve SRV records.');
      console.log('    Possible fix: check DNS settings or try a different DNS server (e.g. 8.8.8.8)');
      resolve(false);
    } else {
      console.log('    Resolved', records.length, 'server(s):');
      records.forEach((r, i) => console.log(`      ${i + 1}. ${r.name}:${r.port} (priority=${r.priority}, weight=${r.weight})`));
      resolve(true);
    }
  });
});

srvPromise.then((dnsOk) => {
  if (!dnsOk) {
    console.log('');
    console.log('DNS SRV resolution failed. Cannot proceed with connection test.');
    process.exit(1);
  }

  /* ── 3. Check current public IP ──────────────────────────── */
  console.log('');
  console.log('[3] Public IP Check');
  console.log('    (Please verify your current IP is whitelisted in Atlas)');
  console.log('    Run this in another terminal:  curl -s https://api.ipify.org');
  console.log('');

  /* ── 4. Attempt connection ───────────────────────────────── */
  console.log('[4] Connection Attempt (15s timeout)');

  mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 15000,
    heartbeatFrequencyMS: 10000,
  })
  .then(() => {
    console.log('');
    console.log('    SUCCESS! Connected to MongoDB Atlas.');
    console.log('    Host:', mongoose.connection.host);
    console.log('    Database:', mongoose.connection.name);
    return mongoose.disconnect();
  })
  .then(() => {
    console.log('    Disconnected. All tests passed.');
    process.exit(0);
  })
  .catch((err) => {
    console.log('');
    console.error('    FAILED:', err.message);
    console.log('');
    console.log('    Error name:', err.name);
    if (err.reason) {
      console.log('    Error reason:', JSON.stringify(err.reason, null, 2));
    }
    if (err.errorLabels) {
      console.log('    Error labels:', err.errorLabels);
    }
    if (err.cause) {
      console.log('    Error cause:', err.cause.message || err.cause);
    }
    console.log('');
    console.log('[5] Troubleshooting (in order of likelihood):');
    console.log('');
    console.log('    A) WRONG PASSWORD');
    console.log('       Atlas > Database Access > Edit user > Reset Password');
    console.log('       Then update MONGO_URI in .env');
    console.log('');
    console.log('    B) IP NOT WHITELISTED');
    console.log('       Run: curl -s https://api.ipify.org');
    console.log('       Compare with Atlas > Network Access IP list');
    console.log('');
    console.log('    C) CLUSTER PAUSED (Atlas free tier)');
    console.log('       Atlas > Cluster overview > Resume if paused');
    process.exit(1);
  });
});
