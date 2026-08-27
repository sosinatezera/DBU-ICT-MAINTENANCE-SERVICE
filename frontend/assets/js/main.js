/* ============================================================
   main.js — Core Utilities, Auth Guards, API Helper
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

const API_BASE = 'http://localhost:5000/api';

/* ── Auth Helpers ─────────────────────────────────────────── */
const Auth = {
  setToken:   (t) => localStorage.setItem('ict_token', t),
  getToken:   ()  => localStorage.getItem('ict_token'),
  setUser:    (u) => localStorage.setItem('ict_user', JSON.stringify(u)),
  getUser:    ()  => JSON.parse(localStorage.getItem('ict_user') || 'null'),
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

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, opts);
  } catch (_) {
    showOfflineBanner();
    throw new Error('Cannot reach server. Is the backend running on port 5000?');
  }

  hideOfflineBanner();
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    Auth.clear();
    window.location.href = '/views/login.html';
    return;
  }

  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
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
  toast.style.cssText = `background:#fff;border-left:4px solid ${colours[type]||colours.info};border-radius:6px;
    box-shadow:0 4px 16px rgba(0,0,0,.15);padding:12px 16px;min-width:280px;max-width:380px;
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

/* ── Auth Guards ──────────────────────────────────────────── */
function logout() {
  Auth.clear();
  window.location.href = '/views/login.html';
}
function requireAuth() {
  if (!Auth.isLoggedIn()) { window.location.href = '/views/login.html'; return null; }
  return Auth.getUser();
}
function requireRole(...roles) {
  const user = requireAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) {
    showToast('Access denied. Your role is: ' + user.role, 'danger');
    const dashboards = {
      'ICT Admin':   '/views/admin/dashboard.html',
      'Technician':  '/views/technician/dashboard.html',
      'Requester':   '/views/user/dashboard.html',
      'student':     '/views/user/dashboard.html',
    };
    setTimeout(() => { window.location.href = dashboards[user.role] || '/views/login.html'; }, 1500);
    return null;
  }
  return user;
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
  } catch (_) {}
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
