/* ============================================================
   main.js — Core Utilities, Auth Guards, API Helper
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

/* API base is declared exactly once, globally, by the shared api-config.js
   (safe for all pages). NEVER redeclare the `API_BASE` identifier in this
   file: a `var API_BASE` of the same name collides with the existing global
   `const API_BASE` and throws "Identifier 'API_BASE' has already been
   declared" at script instantiation, which kills this entire file so
   apiRequest, escHtml, showToast, requireAuth, formatDate … all become
   undefined and every page that calls them breaks. We only fall back to a
   differently-named constant when api-config.js was not included. */
const DEFAULT_API_BASE = 'http://localhost:5000/api';
function resolveApiBase() {
  return (typeof API_BASE !== 'undefined') ? API_BASE : DEFAULT_API_BASE;
}

/* ── Auth Helpers ─────────────────────────────────────────── */
const Auth = {
  setToken:   (t) => localStorage.setItem('ict_token', t),
  getToken:   ()  => localStorage.getItem('ict_token'),
  setUser:    (u) => localStorage.setItem('ict_user', JSON.stringify(u)),
  getUser:    ()  => {
    try { return JSON.parse(localStorage.getItem('ict_user') || 'null'); }
    catch (_) { return null; }
  },
  clear:      ()  => { localStorage.removeItem('ict_token'); localStorage.removeItem('ict_user'); },
  isLoggedIn: ()  => !!localStorage.getItem('ict_token'),
};

/* ── API Request ──────────────────────────────────────────── */
async function apiRequest(endpoint, { method = 'GET', body = null, isFormData = false } = {}) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  /* Abort requests that never settle so the UI can never be stuck on an
     infinite "Loading..." state (e.g. backend hung, Mongo slow, or a proxy
     that neither responds nor closes). The timeout fires as a normal error
     so page handlers show a real message and a Retry button. */
  const controller = new AbortController();
  opts.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(resolveApiBase() + endpoint, opts);
  } catch (err) {
    clearTimeout(timer);
    /* A genuine network-layer failure: the browser could not reach the server
       at all (DNS, connection refused, CORS preflight failure, or a malformed
       URL). Only show the offline banner here — NOT for real HTTP error
       responses, which are handled below with their exact status. */
    if (err && typeof err.status === 'number') {
      throw err;
    }
    if (err && err.name === 'AbortError') {
      throw new Error('Request timed out. The server did not respond. Please retry.');
    }
    showOfflineBanner();
    const e = new Error('Cannot reach server.');
    e.network = true;
    throw e;
  }
  clearTimeout(timer);

  hideOfflineBanner();

  /* Parse the body defensively — some endpoints may return non-JSON. */
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }

  if (res.status === 401) {
    Auth.clear();
    if (!window.__authRedirecting) {
      window.__authRedirecting = true;
      window.location.href = '/views/login.html';
    }
    const e = new Error(data.message || 'Session expired. Please log in again.');
    e.status = res.status;
    e.data = data;
    e.redirected = true;
    throw e;
  }

  if (!res.ok) {
    const friendly = {
      403: 'You do not have permission to perform this action.',
      404: `Endpoint not found: ${endpoint}`,
      422: data.message || 'The submitted data is invalid.',
      500: data.message || 'A server error occurred. Please try again.',
    };
    const e = new Error(data.message || friendly[res.status] || `Error ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

/* ── Offline Banner ───────────────────────────────────────── */
function showOfflineBanner() {
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc3545;color:#fff;
                  text-align:center;padding:10px 16px;font-size:.875rem;font-weight:500;">
        <i class="bi bi-wifi-off me-2"></i>
        Cannot connect to the backend API. 
        Make sure the backend server is running and reachable.
        <button onclick="document.getElementById('offlineBanner').remove()" 
                style="background:none;border:none;color:#fff;margin-left:12px;font-size:1rem;cursor:pointer;">✕</button>
      </div>`;
    document.body.prepend(banner);
  }
}
function hideOfflineBanner() {
  const b = document.getElementById('offlineBanner');
  if (b) b.remove();
}

/* ── Toast Notification ───────────────────────────────────── */
function showToast(message, type = 'success') {
  const icons = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const colours = { success: '#198754', danger: '#dc3545', warning: '#fd7e14', info: '#0dcaf0' };

  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.style.cssText = `border-left:4px solid ${colours[type]||colours.info};border-radius:6px;
    padding:12px 16px;min-width:280px;max-width:380px;color:var(--ink);
    display:flex;align-items:flex-start;gap:10px;animation:slideIn .2s ease;font-size:.875rem;`;
  toast.innerHTML = `
    <i class="bi ${icons[type]||icons.info}" style="color:${colours[type]};font-size:1.1rem;margin-top:1px;flex-shrink:0;"></i>
    <span style="flex:1;line-height:1.4;">${escHtml(message)}</span>
    <button onclick="this.closest('div').remove()" style="background:none;border:none;color:#999;cursor:pointer;font-size:.9rem;padding:0;">✕</button>`;

  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

/* ── Alert Helper ─────────────────────────────────────────── */
function showAlert(elementId, message, type = 'danger') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type} d-flex align-items-center gap-2`;
  const iconMap = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-triangle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  el.innerHTML = `<i class="bi ${iconMap[type]||'bi-info-circle-fill'}"></i><span>${escHtml(message)}</span>`;
  el.classList.remove('d-none');
  if (type !== 'success') setTimeout(() => el.classList.add('d-none'), 6000);
}

/* ── Loading Button ───────────────────────────────────────── */
function setLoading(btnId, spinnerId, isLoading) {
  const btn = document.getElementById(btnId);
  const sp  = document.getElementById(spinnerId);
  if (btn) btn.disabled = isLoading;
  if (sp)  sp.classList.toggle('d-none', !isLoading);
}

/* ── Badges ───────────────────────────────────────────────── */
function statusBadge(status) {
  const map = {
    'submitted':    ['Submitted',    'secondary'],
    'under_review': ['Under Review', 'warning'],
    'assigned':     ['Assigned',     'info'],
    'accepted':     ['Accepted',     'info'],
    'in_progress':  ['In Progress',  'primary'],
    'resolved':     ['Resolved',     'success'],
    'closed':       ['Closed',       'dark'],
  };
  const [label, colour] = map[status] || [status, 'secondary'];
  return `<span class="badge bg-${colour}">${label}</span>`;
}

function priorityBadge(priority) {
  const map = { critical: ['Critical','danger'], high: ['High','warning'], medium: ['Medium','primary'], low: ['Low','success'] };
  const [label, colour] = map[priority] || [priority, 'secondary'];
  return `<span class="badge bg-${colour}">${label}</span>`;
}

/* ── System preferences (time zone + date format) ──────────
   The ICT Admin chooses Ethiopian Time (EAT) / Ethiopian Calendar (EC) in
   Settings → General → Regional & Format. The values are persisted in the
   MongoDB Settings singleton, so after saving and refreshing the dashboard
   the choice stays active. Non-admin pages cannot read /settings (admin-only
   route → 403), so they keep the previous browser-local formatting, which for
   Ethiopian users is already UTC+03:00. */
let __sysTimezone   = null;   /* IANA zone, e.g. 'Africa/Addis_Ababa'          */
let __sysDateFormat = null;   /* e.g. 'EC' = Ethiopian Calendar               */
let __sysPrefsCached = false;

function loadSystemPrefs() {
  if (__sysPrefsCached) return;
  __sysPrefsCached = true;
  apiRequest('/settings')
    .then(r => {
      if (r && r.data) {
        __sysTimezone   = r.data.timezone   || null;
        __sysDateFormat = r.data.dateFormat || null;
      }
    })
    .catch(() => { /* non-admin (403) or offline → keep previous defaults */ });
}

/* Hook used by the Settings page to refresh the cached prefs right after the
   admin saves the General tab, so current-page formatting follows instantly. */
window.__ictPrefs = {
  timezone:   () => __sysTimezone,
  dateFormat: () => __sysDateFormat,
  refresh:    () => { __sysPrefsCached = false; loadSystemPrefs(); },
};

/* Ethiopian calendar — month names (Ge'ez/Amharic, English transliteration). */
const EC_MONTHS = ['Meskerem', 'Tikemet', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];

/* Gregorian wall-clock date/time parts in a given IANA time zone (falls back
   to the browser's local time when `tz` is missing/invalid). */
function wallClockParts(date, tz) {
  const d = new Date(date);
  if (isNaN(d)) return null;
  const fallback = {
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(),
  };
  if (!tz) return fallback;
  try {
    const opts = {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    };
    const parts = {};
    new Intl.DateTimeFormat('en-GB', opts).formatToParts(d).forEach(p => {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
    if (!parts.year || !parts.month || !parts.day) return fallback;
    return {
      year: +parts.year, month: +parts.month, day: +parts.day,
      hour: +parts.hour, minute: +parts.minute,
    };
  } catch (_) {
    return fallback;
  }
}

/* Convert a Gregorian (y, m, d) date to the Ethiopian calendar.
   Meskerem 1 (Enkutatash) begins 11 September (or 12 September when the EC
   year is divisible by 4); the 13th month Pagume has 5 days (6 in a leap
   year). Valid for Gregorian years ~1900–2099 where that correspondence is
   fixed. Cross-checked against published reference dates, e.g. 4 September
   2026 (UTC) = Nehase 29, 2018 EC, and Enkutatash 2019 EC = 11 September
   2026. The year offset is −7 from September onwards and −8 until then. */
function gregorianToEthiopian(y, m, d) {
  const enkutDay = ecYear => (ecYear % 4 === 0 ? 12 : 11);
  let ecYear;
  if (m < 9)      { ecYear = y - 8; }
  else if (m > 9) { ecYear = y - 7; }
  else            { ecYear = (d >= enkutDay(y - 7)) ? y - 7 : y - 8; }
  const startUTC = Date.UTC(ecYear + 7, 8, enkutDay(ecYear));
  const dayIndex = Math.floor((Date.UTC(y, m - 1, d) - startUTC) / 86400000) + 1;
  const month = Math.min(13, Math.floor((dayIndex - 1) / 30) + 1);
  const day   = dayIndex - (month - 1) * 30;
  return { year: ecYear, month, day };
}

/* ── Formatters ─────────────────────────────────────────────
   Rendering honours the saved time zone (Ethiopian Time EAT = UTC+03:00) and,
   when enabled, the Ethiopian Calendar. With no setting available the previous
   browser-local behaviour is preserved exactly. */
function formatEthiopianDate(parts) {
  const e = gregorianToEthiopian(parts.year, parts.month, parts.day);
  const mo = EC_MONTHS[(e.month - 1)] || `Month ${e.month}`;
  return `${e.day} ${mo} ${e.year}`;
}

function formatDate(d) {
  if (!d) return '—';
  const c = wallClockParts(d, __sysTimezone);
  if (!c) return '—';
  if (__sysDateFormat === 'EC') return formatEthiopianDate(c);
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (__sysTimezone) opts.timeZone = __sysTimezone;
  return new Intl.DateTimeFormat('en-GB', opts).format(new Date(d));
}

function formatDateTime(d) {
  if (!d) return '—';
  const c = wallClockParts(d, __sysTimezone);
  if (!c) return '—';
  if (__sysDateFormat === 'EC') {
    const hh = String(c.hour).padStart(2, '0');
    const mm = String(c.minute).padStart(2, '0');
    return `${formatEthiopianDate(c)}, ${hh}:${mm}`;
  }
  const opts = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (__sysTimezone) opts.timeZone = __sysTimezone;
  return new Intl.DateTimeFormat('en-GB', opts).format(new Date(d));
}

/* Relative time is elapsed real time, so it is identical in every time zone —
   e.g. "2h ago" is the same instant whether viewed in UTC or EAT. */
function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

/* ── Attachment URL ────────────────────────────────────────
   Uploaded files are stored by the backend in /uploads and served from
   the backend origin (e.g. http://localhost:5000/uploads/<filename>). */
function uploadUrl(filename) {
  if (!filename) return '#';
  const base = typeof apiOrigin === 'function' ? apiOrigin() : resolveApiBase().replace(/\/api\/?$/, '');
  return `${base}/uploads/${encodeURIComponent(String(filename))}`;
}

/* ── Canonical role values (must match backend User model exactly) ── */
const VALID_ROLES = ['Requester', 'Technician', 'ICT Admin'];

/* ── Role normalization (lowercase input -> canonical) ── */
const ROLE_MAP = {
  'requester': 'Requester',
  'technician': 'Technician',
  'admin': 'ICT Admin',
  'ict admin': 'ICT Admin',
};

function normalizeRole(role) {
  if (!role) return null;
  return ROLE_MAP[role.toLowerCase()] || role;
}

function isValidRole(role) {
  return VALID_ROLES.includes(normalizeRole(role));
}

/* ── Auth Guards ──────────────────────────────────────────── */
function logout() {
  Auth.clear();
  window.location.href = '/views/login.html';
}
function requireAuth() {
  if (!Auth.isLoggedIn()) { 
    window.__authRedirecting = true;
    window.location.href = '/views/login.html'; 
    return null; 
  }
  const user = Auth.getUser();
  /* Validate role - if invalid/obsolete, clear session and force re-login */
  if (!isValidRole(user.role)) {
    console.warn('[Auth] Invalid/obsolete role in session:', user.role);
    Auth.clear();
    window.__authRedirecting = true;
    window.location.href = '/views/login.html';
    return null;
  }
  /* Normalize role to canonical format for consistent downstream use */
  user.role = normalizeRole(user.role);
  return user;
}
function requireRole(...roles) {
  const user = requireAuth();
  if (!user) return null;
  /* User role is already canonical (validated + normalized in requireAuth).
     Perform case-insensitive comparison against allowed roles. */
  const allowed = roles.map(r => r.toLowerCase());
  if (!allowed.includes(user.role.toLowerCase())) {
    showToast('Access denied. Your role is: ' + user.role, 'danger');
    const dashboards = {
      'Requester':   '/views/user/dashboard.html',
      'Technician':  '/views/technician/dashboard.html',
      'ICT Admin':   '/views/admin/dashboard.html',
    };
    setTimeout(() => { window.location.href = dashboards[user.role] || '/views/login.html'; }, 1500);
    return null;
  }
  return user;
}

/* ── Profile Image (Avatar) ────────────────────────────────── */
const DEFAULT_ADMIN_IMAGE = '/assets/images/admin.jpg';
const DEFAULT_REQUESTER_IMAGE = '/assets/images/user.jpg';
const PROFILE_IMAGE_PREFS_KEY = 'ict_profile_image_prefs';

function getProfileImagePrefs(user) {
  if (!user) return {};
  try {
    const all = JSON.parse(localStorage.getItem(PROFILE_IMAGE_PREFS_KEY) || '{}');
    const key = String(user.email || user.id || 'default').toLowerCase();
    return all[key] || {};
  } catch (_) { return {}; }
}

function setProfileImagePrefs(user, prefs) {
  if (!user) return false;
  try {
    const all = JSON.parse(localStorage.getItem(PROFILE_IMAGE_PREFS_KEY) || '{}');
    const key = String(user.email || user.id || 'default').toLowerCase();
    all[key] = prefs || {};
    localStorage.setItem(PROFILE_IMAGE_PREFS_KEY, JSON.stringify(all));
    return true;
  } catch (_) { return false; }
}

/* Build an absolute uploads URL that always points to the backend origin,
   regardless of which port the frontend is served from. */
function profileUploadUrl(filename) {
  if (!filename) return null;
  var base = (typeof apiOrigin === 'function') ? apiOrigin() : resolveApiBase().replace(/\/api\/?$/, '');
  /* filename may already contain '/uploads/' prefix from the backend response. */
  if (filename.indexOf('/uploads/') === 0) return base + filename;
  return base + '/uploads/' + encodeURIComponent(String(filename));
}

/* Priority: Uploaded photo (localStorage) > DB profileImage > Image URL > default ADMIN image > initials */
function resolveProfileAvatar(user) {
  if (!user) return null;
  var prefs = getProfileImagePrefs(user);
  if (prefs.uploaded) return prefs.uploaded;
  if (prefs.url)      return prefs.url;
  /* Fall back to the profileImage stored in the database. */
  if (user.profileImage) return profileUploadUrl(user.profileImage);
  if (user.role === 'ICT Admin') return DEFAULT_ADMIN_IMAGE;
  if (user.role === 'Requester') return DEFAULT_REQUESTER_IMAGE;
  return null;
}

/* Fill a `.profile-avatar` container with the best available image.
   Falls back to the user's initial when no image can be shown. */
function applyProfileAvatar(user, container) {
  if (!user || !container) return;
  const img = container.querySelector('.profile-avatar-image');
  const ini = container.querySelector('.profile-avatar-initials');
  if (!img || !ini) return;

  ini.textContent = (user.fullName || 'A').charAt(0).toUpperCase();

  const src = resolveProfileAvatar(user);
  if (!src) {
    img.hidden = true;
    ini.hidden = false;
    return;
  }

  img.onload  = () => { img.hidden = false; ini.hidden = true; };
  img.onerror = () => { img.hidden = true;  ini.hidden = false; };

  /* Resolve relative URLs against the API origin (backend), not the page
     origin, so profile images served from localhost:5000 load correctly
     when the frontend runs on a different port. */
  var abs = src;
  try { abs = new URL(src, (typeof apiOrigin === 'function' ? apiOrigin() : window.location.origin)).href; } catch (_) {}
  if (img.src !== abs) img.src = src;
}

/* ── Populate User Info ───────────────────────────────────── */
function populateUserInfo() {
  const user = Auth.getUser();
  if (!user) return;
  ['sidebarUserName','welcomeName'].forEach(id => setText(id, user.fullName));
  setText('topUserName', `Welcome, ${user.fullName}`);

  const panelLabel = document.getElementById('panelLabel');
  if (panelLabel) {
    panelLabel.textContent = 'Admin Panel';
  }

  /* Apply the profile photo to every avatar marked with [data-avatar] */
  document.querySelectorAll('[data-avatar]').forEach(el => applyProfileAvatar(user, el));
}

/* ── Sidebar Toggle (mobile) ──────────────────────────────── */
function initSidebarToggle() {
  const btn     = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;

  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }
  btn.addEventListener('click', () => { sidebar.classList.toggle('show'); overlay.classList.toggle('show'); });
  overlay.addEventListener('click', () => { sidebar.classList.remove('show'); overlay.classList.remove('show'); });
}

/* ── Notification Badge ───────────────────────────────────── */
async function loadNotificationCount() {
  try {
    const { unread } = await apiRequest('/notifications');
    ['notifBadge','topNotifBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = unread || 0; el.style.display = unread > 0 ? '' : 'none'; }
    });
  } catch (err) {
    console.warn('Failed to load notification count:', err.message);
    /* Keep badges hidden on error rather than showing stale data */
    ['notifBadge','topNotifBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
}

/* ── Professional App Shell ─────────────────────────────────
   Client-side polish so every dashboard shares a professional
   structure — sticky topbar with page title + subtitle, a mobile
   hamburger, and a bottom-anchored footer — without per-page
   HTML edits. */

const PAGE_TOPBAR_SUBTITLES = {
  'admin/dashboard':             'Overview of requests, assets, technicians and system activity.',
  'admin/users':                 'Manage registered users and their access.',
  'admin/technicians':           'Manage technician accounts, specializations and workloads.',
  'admin/assets':                'Track ICT assets, ownership and maintenance state.',
  'admin/requests':              'Review, assign and manage maintenance requests.',
  'admin/categories':            'Organize request categories and service types.',
  'admin/reports':               'Analyze request trends and team performance.',
  'admin/admin-feedback':        'Review feedback and ratings submitted by users.',
  'admin/notifications':         'View and manage system notifications.',
  'admin/settings':              'System, notification, security and profile settings.',

  'technician/dashboard':        'Your assigned requests, performance and recent activity.',
  'technician/assigned-requests': 'Requests awaiting your review and action.',
  'technician/maintenance':      'Record and update maintenance activities.',
  'technician/history':          'Completed requests and past maintenance work.',
  'technician/technician-feedback': 'Ratings and feedback left by requesters.',
  'technician/notifications':    'Updates and alerts addressed to you.',
  'technician/profile':          'Your profile, specialization and preferences.',

  'user/dashboard':              'Track your requests and recent activity.',
  'user/request':                'Submit a new maintenance request.',
  'user/tracking':               'Check the live status of your requests.',
  'user/history':                'View your past and completed requests.',
  'user/feedback':               'Rate and review the service you received.',
  'user/notifications':          'Updates on your requests.',
  'user/profile':                'Your profile and preferences.',
};

function getCurrentRoleAndFile() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const file  = (parts.pop() || 'dashboard.html').replace(/\.html$/i, '');
  const role  = (parts.slice(-1)[0] || '').toLowerCase();
  return { role, file };
}

function shellI18n(key, fallback) {
  try {
    if (typeof window.t === 'function') {
      const v = window.t(key);
      if (typeof v === 'string' && v && v !== key) return v;
    }
  } catch (_) { /* fall through to the English default */ }
  return fallback;
}

function ensureTopbarHeaderStructure() {
  const header = document.querySelector('.topbar');
  if (!header) return;
  const h5 = header.querySelector('h5');
  if (!h5 || h5.closest('.topbar-title-stack')) return;

  const { role, file } = getCurrentRoleAndFile();

  /* A subtitle already sits right under the title on this page — move it
     into the new stack instead of duplicating it. */
  const adjacent = h5.nextElementSibling;
  const hasDropSub = !!adjacent &&
    (adjacent.matches('small') || (adjacent.classList && adjacent.classList.contains('text-muted')));

  const stack = document.createElement('div');
  stack.className = 'topbar-title-stack';

  h5.parentNode.insertBefore(stack, h5);
  stack.appendChild(h5);
  if (hasDropSub && adjacent.parentNode === stack.parentNode) stack.appendChild(adjacent);

  const subtitle = PAGE_TOPBAR_SUBTITLES[`${role}/${file}`];
  if (subtitle && !stack.querySelector('.topbar-subtitle')) {
    const sub = document.createElement('div');
    sub.className = 'topbar-subtitle';
    sub.textContent = subtitle;
    stack.appendChild(sub);
  }

  /* Pages without a hamburger get one so the mobile drawer always opens */
  if (!header.querySelector('#sidebarToggle')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sidebarToggle';
    btn.className = 'btn btn-sm btn-outline-secondary d-inline-flex d-lg-none';
    btn.setAttribute('aria-label', 'Toggle navigation');
    btn.innerHTML = '<i class="bi bi-list fs-5"></i>';
    stack.insertAdjacentElement('beforebegin', btn);
  }
}

function injectAppFooter() {
  const column = document.querySelector('body.dashboard-body > .d-flex > .flex-grow-1');
  if (!column || column.querySelector('.app-footer')) return;

  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="app-footer-inner">
      <div class="app-footer-brand">${escHtml(shellI18n('footer.brand', 'Smart Computer Maintenance Service'))}</div>
      <div class="app-footer-copy">${escHtml(shellI18n('footer.rights', 'All rights reserved.'))} &copy; ${new Date().getFullYear()}</div>
    </div>`;
  column.appendChild(footer);
}

/* ── DOM Ready ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  ensureTopbarHeaderStructure();
  injectAppFooter();
  populateUserInfo();
  initSidebarToggle();
  loadSystemPrefs();

  // Add toast slide-in animation
  if (!document.getElementById('toastStyle')) {
    const style = document.createElement('style');
    style.id = 'toastStyle';
    style.textContent = '@keyframes slideIn{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}';
    document.head.appendChild(style);
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); logout(); });

  if (Auth.isLoggedIn()) loadNotificationCount();
});
