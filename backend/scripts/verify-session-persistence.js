/**
 * scripts/verify-session-persistence.js
 * Runtime evidence for activity-based session persistence.
 *
 * Run from backend/ (backend MUST already be listening, and the frontend
 * static server must be up for the navigation checks):
 *   npm run verify:session
 *
 * Covers, with real HTTP traffic and real status codes:
 *   1. CORS preflight + credentialed actual request from the frontend origin
 *      (asserts NO wildcard, which is illegal with credentials)
 *   2. Login -> Set-Cookie issued
 *   3. GET /api/auth/me -> 200 with the expected role
 *   4. Dashboard navigation -> 200 from the frontend server
 *   5. Authenticated API request -> still 200
 *   6. ROLLING PROOF: two consecutive authenticated requests must return a
 *      Set-Cookie whose Expires moves FORWARD in time. This is the objective
 *      test for `rolling: true` + `resave: true` and needs no 24h wait.
 *   7. Idle pause, then continue -> session still valid
 *   8. Logout -> /api/auth/me must then be 401
 * Repeated for Requester, Technician and ICT Admin.
 *
 * Credentials come from the environment, never from arguments, so they do not
 * land in shell history. NOTHING sensitive is printed: no passwords, no cookie
 * values (only a truncated SHA-256 fingerprint so a rotated cookie is visible),
 * no tokens, no Mongo URI, no session secret, and no unmasked email address.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');

const line = (t) =>
  console.log(`\n  ── ${t} ${'─'.repeat(Math.max(2, 44 - t.length))}`);
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const info = (m) => console.log(`  ····  ${m}`);
const skip = (m) => console.log(`  SKIP  ${m}`);

const API = String(process.env.VERIFY_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const WEB = String(process.env.VERIFY_WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ORIGIN = String(process.env.VERIFY_ORIGIN || WEB).replace(/\/+$/, '');
const PROTECTED = process.env.VERIFY_PROTECTED_PATH || '/api/auth/me';
const IDLE_MS = Number(process.env.VERIFY_IDLE_MS || 20000);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  return ok;
};

const maskEmail = (e) => {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '(unset)';
  return `${s[0]}***${s.slice(at)}`;
};

const fingerprint = (v) =>
  v ? crypto.createHash('sha256').update(v).digest('hex').slice(0, 8) : '(none)';

/* Read every Set-Cookie without logging any of its values. */
const readSetCookies = (res) => {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
};

const findCookie = (setCookies, name) => {
  for (const c of setCookies) {
    const first = String(c).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0 && first.slice(0, eq).trim() === name) {
      const attrs = String(c)
        .split(';')
        .slice(1)
        .map((s) => s.trim().toLowerCase());
      const expires = (String(c).match(/expires=([^;]+)/i) || [])[1];
      const maxAge = (String(c).match(/max-age=([^;]+)/i) || [])[1];
      return { value: first.slice(eq + 1), attrs, expires, maxAge };
    }
  }
  return null;
};

const jar = { value: '' };
const cookieHeader = () => (jar.value ? `ict_session=${jar.value}` : '');

const apiFetch = (path, opts = {}) =>
  fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/json',
      Origin: ORIGIN,
      ...(jar.value ? { Cookie: cookieHeader() } : {}),
      ...(opts.headers || {}),
    },
  });

/* ── 1. CORS ─────────────────────────────────────────────── */
async function checkCors() {
  line('CORS (credentialed, from ' + ORIGIN + ')');

  try {
    const pre = await fetch(`${API}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const acao = pre.headers.get('access-control-allow-origin');
    const acac = pre.headers.get('access-control-allow-credentials');

    record('CORS preflight status', pre.status === 204 || pre.status === 200,
      `OPTIONS /api/auth/login -> ${pre.status}`);
    pre.status === 204 || pre.status === 200
      ? pass(`preflight answered ${pre.status}`)
      : fail(`preflight answered ${pre.status}, expected 204/200`);

    if (acao === '*') {
      record('CORS not wildcard', false, 'ACAO: * with credentials is illegal');
      fail('Access-Control-Allow-Origin is "*" — illegal with credentials');
    } else if (acao === ORIGIN) {
      record('CORS not wildcard', true, 'exact origin echoed');
      pass(`Allow-Origin echoes the exact origin (${acao})`);
    } else {
      record('CORS not wildcard', true, acao ? `got ${acao}` : 'header absent');
      fail(
        acao
          ? `Allow-Origin "${acao}" does not match Origin "${ORIGIN}"`
          : 'Access-Control-Allow-Origin header ABSENT — this is exactly what ' +
            'produces a browser CORS error. A stale process on this port is the ' +
            'usual cause: it predates the current allow-list.',
      );
    }

    record('CORS credentials allowed', acac === 'true', `ACAC: ${acac}`);
    acac === 'true'
      ? pass('Access-Control-Allow-Credentials: true')
      : fail(`Access-Control-Allow-Credentials is "${acac}", expected "true"`);
  } catch (e) {
    record('CORS reachable', false, e.message);
    fail(`cannot reach ${API} — ${e.message}`);
    console.log('\n  Backend is not answering. Start it, then re-run.');
    return false;
  }

  const live = await apiFetch('/api/auth/me');
  const liveAc = live.headers.get('access-control-allow-origin');
  record('CORS on actual request', liveAc === ORIGIN, `ACAO: ${liveAc}`);
  liveAc === ORIGIN
    ? pass('actual GET /auth/me carries the correct Allow-Origin')
    : fail(`actual GET /auth/me Allow-Origin is "${liveAc}"`);
  return true;
}

/* ── 2..8 per role ───────────────────────────────────────── */
async function checkRole(label, email, password, dashboardPath) {
  line(`${label} — full session lifecycle`);

  if (!email || !password) {
    record(`${label} configured`, false, 'env vars missing');
    skip(`${label}: set VERIFY_${label.toUpperCase()}_EMAIL / _PASSWORD to test`);
    return;
  }
  info(`account ${maskEmail(email)}`);

  jar.value = '';

  const login = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const setCookies = readSetCookies(login);
  const sid = findCookie(setCookies, 'ict_session');

  record(`${label} login`, login.ok, `status ${login.status}`);
  login.ok
    ? pass(`login succeeded (${login.status})`)
    : fail(`login returned ${login.status}`);

  if (!sid) {
    record(`${label} Set-Cookie`, false, 'ict_session absent');
    fail('NO ict_session cookie in the response — session was never established');
    return;
  }
  jar.value = sid.value;
  record(`${label} Set-Cookie`, true, 'ict_session present');
  pass(`ict_session issued (fingerprint ${fingerprint(sid.value)})`);

  record(`${label} httpOnly`, sid.attrs.includes('httponly'), sid.attrs.join(','));
  sid.attrs.includes('httponly')
    ? pass('cookie httpOnly')
    : fail('cookie is NOT httpOnly');

  record(`${label} sameSite`, sid.attrs.some((a) => a.startsWith('samesite=')), sid.attrs.join(','));
  const ss = (sid.attrs.find((a) => a.startsWith('samesite=')) || '').split('=')[1];
  info(`sameSite=${ss}  max-age=${sid.maxAge || 'n/a'}`);

  const firstExpires = sid.expires ? Date.parse(sid.expires) : null;
  if (sid.maxAge) {
    const secs = Number(sid.maxAge);
    record(`${label} cookie maxAge`, secs > 0, `max-age=${secs}s`);
    pass(`cookie max-age = ${secs}s (${(secs / 3600).toFixed(2)} h)`);
  }

  const me1 = await apiFetch(PROTECTED);
  const me1body = await me1.json().catch(() => ({}));
  record(`${label} /auth/me immediately after login`, me1.status === 200, `status ${me1.status}`);
  me1.status === 200
    ? pass(`/auth/me -> 200, role=${me1body.user && me1body.user.role}`)
    : fail(`/auth/me -> ${me1.status} (expected 200)`);

  const expectedRole = label.toLowerCase().replace(/\s+/g, '');
  if (me1body.user && me1body.user.role) {
    const okRole = String(me1body.user.role).toLowerCase().replace(/\s+/g, '') === expectedRole;
    record(`${label} role`, okRole, `got ${me1body.user.role}, want ${expectedRole}`);
    okRole ? pass(`role is ${me1body.user.role}`) : fail(`role is ${me1body.user.role}, expected ${expectedRole}`);
  }

  try {
    const page = await fetch(`${WEB}${dashboardPath}`);
    record(`${label} dashboard navigation`, page.ok, `status ${page.status}`);
    page.ok
      ? pass(`dashboard reachable (${dashboardPath})`)
      : fail(`dashboard returned ${page.status}`);
  } catch (e) {
    record(`${label} dashboard navigation`, false, e.message);
    fail(`dashboard unreachable — ${e.message}`);
  }

  const me2 = await apiFetch(PROTECTED);
  const me2set = findCookie(readSetCookies(me2), 'ict_session');
  record(`${label} repeated authenticated request`, me2.status === 200, `status ${me2.status}`);
  me2.status === 200
    ? pass(`repeat request still 200`)
    : fail(`repeat request -> ${me2.status} (expected 200)`);

  record(`${label} rolling cookie re-issued`, !!me2set, me2set ? 'Set-Cookie present' : 'no Set-Cookie');
  if (me2set && me2set.expires) {
    const secondExpires = Date.parse(me2set.expires);
    if (firstExpires && secondExpires > firstExpires) {
      record(`${label} rolling expiry advances`, true, `${secondExpires - firstExpires}ms forward`);
      pass(`expiry moved FORWARD ${Math.round((secondExpires - firstExpires) / 1000)}s — activity refreshes the session`);
    } else {
      record(`${label} rolling expiry advances`, false, 'expiry did not advance');
      fail('expiry did NOT move forward — rolling is not refreshing the session');
    }
  } else if (!me2set) {
    fail('no Set-Cookie on the repeat request — with rolling:true a refreshed cookie should be sent');
  }

  info(`pausing ${Math.round(IDLE_MS / 1000)}s, then continuing (idle check)`);
  await new Promise((r) => setTimeout(r, IDLE_MS));
  const me3 = await apiFetch(PROTECTED);
  record(`${label} session after idle pause`, me3.status === 200, `status ${me3.status}`);
  me3.status === 200
    ? pass(`still authenticated after the pause (${me3.status})`)
    : fail(`after the pause -> ${me3.status} (expected 200)`);

  const logout = await apiFetch('/api/auth/logout', { method: 'POST' });
  record(`${label} logout`, logout.ok, `status ${logout.status}`);
  logout.ok ? pass(`logout returned ${logout.status}`) : fail(`logout returned ${logout.status}`);

  jar.value = '';
  const after = await apiFetch(PROTECTED);
  record(`${label} protected after logout is 401`, after.status === 401, `status ${after.status}`);
  after.status === 401
    ? pass(`after logout the protected endpoint correctly returns 401`)
    : fail(`after logout expected 401, got ${after.status} — session may still be usable`);
}

(async () => {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('  SESSION PERSISTENCE VERIFICATION');
  console.log(`  API ${API}   WEB ${WEB}   ORIGIN ${ORIGIN}`);
  console.log('════════════════════════════════════════════════════════');

  const corsOk = await checkCors();
  if (corsOk) {
    await checkRole('Requester', process.env.VERIFY_REQUESTER_EMAIL, process.env.VERIFY_REQUESTER_PASSWORD, '/views/user/dashboard.html');
    await checkRole('Technician', process.env.VERIFY_TECHNICIAN_EMAIL, process.env.VERIFY_TECHNICIAN_PASSWORD, '/views/technician/dashboard.html');
    await checkRole('ICTAdmin', process.env.VERIFY_ADMIN_EMAIL, process.env.VERIFY_ADMIN_PASSWORD, '/views/admin/dashboard.html');
  }

  line('SUMMARY');
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.detail && r.detail.startsWith('env vars missing'));
  results.forEach((r) => console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`));
  console.log(`\n  executed ${results.length}  passed ${results.length - failed.length}  failed ${failed.length}  skipped ${skipped.length}`);

  if (failed.length) {
    console.log('\n  Do NOT report these as passing. Fix the FAILs above first.');
  }
  console.log('');
  process.exit(failed.length ? 1 : 0);
})();
