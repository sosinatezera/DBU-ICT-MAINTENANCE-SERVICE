/* ============================================================
   main.js — Core Utilities, Auth Guards, API Helper
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

/* API base is provided by the shared api-config.js (safe for all pages).
   Fallback keeps main.js self-sufficient if the config was not included.
   NOTE: using `var` (not `const`) so the fallback binding is function/global
   scoped and actually visible to apiRequest() below. A block-scoped `const`
   here would leave API_BASE undefined and cause a ReferenceError that was
   previously mis-reported as a network failure. */
if (typeof API_BASE === 'undefined') {
  var API_BASE = 'http://localhost:5000/api';
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
    res = await fetch(`${API_BASE}${endpoint}`, opts);
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
        Cannot connect to backend server (port 5000). 
        Start the backend with <code style="background:rgba(255,255,255,.2);padding:1px 6px;border-radius:3px;">node server.js</code>
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

/* ── Formatters ───────────────────────────────────────────── */
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
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
  const base = typeof apiOrigin === 'function' ? apiOrigin() : API_BASE.replace(/\/api\/?$/, '');
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
  var base = (typeof apiOrigin === 'function') ? apiOrigin() : API_BASE.replace(/\/api\/?$/, '');
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

/* ── DOM Ready ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  populateUserInfo();
  initSidebarToggle();

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
