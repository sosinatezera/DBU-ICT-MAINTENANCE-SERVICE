/* ============================================================
   networking.js — Networking & Messages page (all three roles)
   Smart Computer Maintenance Service Request and Tracking System

   Real-time is implemented as lightweight polling (see POLL_MS below)
   against the REST endpoints. This keeps the feature dependency-free
   and deployable as-is (no WebSocket/Socket.io server, no extra deps).

   Security notes:
   - The page requires an authenticated session (requireAuth, JWT in header).
   - All dynamic text rendered via escHtml(); message bodies are stored as
     plain text and escaped on render (no innerHTML with raw content).
   - The sender is always taken from the backend (req.user.id), never trusted
     from the client.
   ============================================================ */

const POLL_MS = 5000;

let currentUser   = null;   /* requireAuth() result (session) */
let activeConvId  = null;   /* selected conversation id        */
let contacts      = [];     /* full contact list               */
let conversations = [];     /* latest conversation list        */
let timer         = null;

/* ── Auth + ready ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  currentUser = requireAuth();
  if (!currentUser) return;
  buildRoleNav(currentUser.role);
  initLogout();
  initComposer();
  bindContactSearch();
  loadContacts();
  loadConversations();

  /* Poll-based real-time refresh. */
  timer = setInterval(async () => {
    await refreshConversationsAndBadge();
    if (activeConvId) refreshActiveThread();
  }, POLL_MS);
});

/* ── Role-aware sidebar ───────────────────────────────────── */
function buildRoleNav(role) {
  const nav = document.getElementById('roleNav');
  if (!nav) return;

  const items = {
    'Requester': [
      ['dashboard.html', 'bi-speedometer2', 'side.dashboard', 'Dashboard'],
      ['request.html', 'bi-plus-circle', 'side.new', 'New Request'],
      ['tracking.html', 'bi-search', 'side.track', 'Track Request'],
      ['history.html', 'bi-clock-history', 'side.history', 'History'],
      ['networking.html', 'bi-chat-dots', 'side.networking', 'Networking', true],
      ['notifications.html', 'bi-bell', 'side.notifications', 'Notifications'],
      ['feedback.html', 'bi-star', 'side.feedback', 'Feedback'],
      ['profile.html', 'bi-person-circle', 'side.profile', 'My Profile'],
    ],
    'Technician': [
      ['dashboard.html', 'bi-speedometer2', 'side.dashboard', 'Dashboard'],
      ['assigned-requests.html', 'bi-list-task', 'side.assigned', 'Assigned Requests'],
      ['maintenance.html', 'bi-tools', 'side.maintenance', 'Maintenance Activity'],
      ['history.html', 'bi-clock-history', 'side.history', 'History'],
      ['networking.html', 'bi-chat-dots', 'side.networking', 'Networking', true],
      ['notifications.html', 'bi-bell', 'side.notifications', 'Notifications'],
      ['profile.html', 'bi-person-circle', 'side.profile', 'My Profile'],
    ],
    'ICT Admin': [
      ['dashboard.html', 'bi-speedometer2', 'side.dashboard', 'Dashboard'],
      ['users.html', 'bi-people', 'side.users', 'Users'],
      ['technicians.html', 'bi-wrench', 'side.technicians', 'Technicians'],
      ['assets.html', 'bi-pc-display', 'side.assets', 'ICT Assets'],
      ['requests.html', 'bi-clipboard-check', 'side.requests', 'Requests'],
      ['categories.html', 'bi-tags', 'side.categories', 'Categories'],
      ['reports.html', 'bi-bar-chart-line', 'side.reports', 'Reports'],
      ['admin-feedback.html', 'bi-chat-dots', 'side.feedback', 'Feedback'],
      ['networking.html', 'bi-chat-dots', 'side.networking', 'Networking', true],
      ['notifications.html', 'bi-bell', 'side.notifications', 'Notifications'],
      ['settings.html', 'bi-gear', 'side.settings', 'Settings'],
    ],
  };

  const list = (items[role] || []).map(([href, icon, key, fallback, active]) => `
    <li><a href="javascript:void(0)" data-href="${href}"
           class="nav-link ${active ? 'text-white active bg-white bg-opacity-25 rounded' : 'text-white-50'}">
        <i class="bi ${icon} me-2"></i><span>${keyLabel(key, fallback)}</span></a></li>`).join('');
  nav.innerHTML = list;

  /* Relative nav targets resolve to this role's folder. */
  const base = { 'Requester': '/views/user/', 'Technician': '/views/technician/', 'ICT Admin': '/views/admin/' }[role] || '/views/user/';
  nav.querySelectorAll('a[data-href]').forEach(a => {
    a.addEventListener('click', () => { window.location.href = base + a.dataset.href; });
  });
}

function initLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); if (typeof logout === 'function') logout(); });
}

/* data-i18n + English fallback (lang.js may have swapped the visible text late). */
function keyLabel(key, fallback) {
  if (typeof window.t === 'function') {
    const v = window.t(key);
    if (typeof v === 'string' && v) return v;
  }
  return fallback;
}

/* ── Composer (send + char counter + Enter handling) ──────── */
function initComposer() {
  const form = document.getElementById('composerForm');
  const input = document.getElementById('messageInput');
  const count = document.getElementById('charCount');

  if (input) input.addEventListener('input', () => {
    if (count) count.textContent = `${input.value.length} / 2000`;
  });

  if (input && !window.__netComposerBound) {
    window.__netComposerBound = true;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeConvId) return;
    const body = input.value.trim();
    if (!body) return;
    sendMessage(activeConvId, body);
  });
}

/* ── Contacts ─────────────────────────────────────────────── */
async function loadContacts() {
  const list = document.getElementById('contactsList');
  list.innerHTML = `<div class="text-center text-muted py-4 small">${loadingHtml()}<span data-i18n="net.loading">Loading...</span></div>`;
  try {
    const { data } = await apiRequest('/networking/contacts');
    contacts = Array.isArray(data) ? data : [];
    renderContacts();
  } catch (err) {
    const msg = typeof escHtml === 'function' ? escHtml(err.message) : err.message;
    list.innerHTML = `<div class="alert alert-danger m-2 small">${msg}</div>`;
  }
}

function bindContactSearch() {
  const input = document.getElementById('contactSearch');
  if (!input) return;
  input.addEventListener('input', () => renderContacts(input.value.trim().toLowerCase()));
}

function renderContacts(query = '') {
  const list = document.getElementById('contactsList');
  if (!list) return;

  const filtered = contacts.filter(c =>
    !query || c.fullName.toLowerCase().includes(query) || (c.department || '').toLowerCase().includes(query) || (c.role || '').toLowerCase().includes(query)
  );

  if (!filtered.length) {
    list.innerHTML = `<div class="text-center text-muted py-4 small"><i class="bi bi-people fs-3 d-block mb-2 opacity-50"></i><span data-i18n="net.noContacts">No contacts found.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(c => `
    <div class="d-flex align-items-center gap-2 px-2 py-2 rounded net-item ${String(c.id) === activeConvId ? 'active' : ''}"
         role="button" tabindex="0"
         data-id="${c.id}"
         onclick="openOrCreateConversation('${c.id}')"
         onkeydown="if(event.key==='Enter')openOrCreateConversation('${c.id}')"
         aria-label="${escHtml(c.fullName)}">
      <span class="avatar-chip" style="background:${avatarBg(c.fullName)};color:#fff;">${avatarLetter(c.fullName)}</span>
      <div class="flex-grow-1 min-w-0">
        <div class="small fw-semibold text-truncate">${escHtml(c.fullName)}</div>
        <div class="text-muted text-truncate" style="font-size:.72rem;">${escHtml(c.role)}${c.department ? ' · ' + escHtml(c.department) : ''}</div>
      </div>
      <i class="bi bi-chat-dots text-muted flex-shrink-0" style="font-size:.8rem;"></i>
    </div>`).join('');
}

async function openOrCreateConversation(contactId) {
  try {
    /* Ensure a thread exists, then open it. */
    const { data } = await apiRequest('/networking/conversations', {
      method: 'POST',
      body: { recipient_id: contactId },
    });
    activeConvId = data.id;
    await loadConversations();
    await openThread(data.id);
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message, 'danger');
  }
}

/* ── Conversations ────────────────────────────────────────── */
async function loadConversations() {
  const list = document.getElementById('conversationsList');
  try {
    const { data } = await apiRequest('/networking/conversations');
    conversations = Array.isArray(data) ? data : [];
    renderConversations(list);
    updateUnreadBadge();
  } catch (err) {
    list.innerHTML = `<div class="alert alert-danger m-2 small">${escHtml(err.message)}</div>`;
  }
}

async function refreshConversationsAndBadge() {
  try {
    const { data } = await apiRequest('/networking/conversations');
    conversations = Array.isArray(data) ? data : [];
    renderConversations(document.getElementById('conversationsList'));
    updateUnreadBadge();
  } catch (_) { /* polling failures are silent */ }
}

function renderConversations(list) {
  if (!list) return;
  if (!conversations.length) {
    list.innerHTML = `<div class="text-center text-muted py-5 small">
      <i class="bi bi-chat-dots fs-2 d-block mb-2 opacity-50"></i>
      <span data-i18n="net.noConversations">No conversations yet. Start one from the contacts list.</span></div>`;
    return;
  }

  list.innerHTML = conversations.map(c => `
    <div class="d-flex align-items-center gap-2 px-2 py-2 rounded net-item ${String(c.id) === activeConvId ? 'active' : ''}"
         role="button" tabindex="0"
         data-id="${c.id}"
         onclick="openThread('${c.id}')"
         onkeydown="if(event.key==='Enter')openThread('${c.id}')"
         aria-label="${c.other ? escHtml(c.other.fullName) : 'Conversation'}">
      <span class="avatar-chip" style="background:${c.other ? avatarBg(c.other.fullName) : '#6c757d'};color:#fff;">${c.other ? avatarLetter(c.other.fullName) : '?'}</span>
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex justify-content-between align-items-center">
          <span class="small fw-semibold text-truncate">${c.other ? escHtml(c.other.fullName) : '—'}</span>
          <span class="text-muted flex-shrink-0" style="font-size:.68rem;">${formatTime(c.last_message_at)}</span>
        </div>
        <div class="d-flex justify-content-between align-items-center gap-2">
          <span class="text-muted text-truncate" style="font-size:.75rem;">
            ${c.last_message_from_me ? '<i class="bi bi-check2 me-1"></i>' : ''}${escHtml(c.last_message) || '—'}</span>
          ${c.unread > 0 ? `<span class="badge bg-danger rounded-pill flex-shrink-0" style="font-size:.65rem;">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
        </div>
      </div>
    </div>`).join('');
}

/* ── Thread ───────────────────────────────────────────────── */
async function openThread(conversationId) {
  activeConvId = conversationId;
  const list = document.getElementById('messagesList');
  const empty = document.getElementById('threadEmpty');
  const composer = document.getElementById('composerForm');
  const withEl = document.getElementById('threadWith');

  /* Immediate visual feedback before the fetch. */
  renderConversations(document.getElementById('conversationsList'));
  renderContacts();

  empty?.classList.add('d-none');
  if (composer) composer.classList.remove('d-none');
  if (list) list.classList.remove('d-none');
  if (withEl) withEl.textContent = tKey('net.loadingThread', 'Loading...');

  list.innerHTML = `<div class="text-center text-muted py-4 small">${loadingHtml()}<span data-i18n="net.loading">Loading...</span></div>`;

  try {
    const { data } = await apiRequest(`/networking/conversations/${conversationId}/messages`);
    if (data.other && withEl) withEl.textContent = data.other.fullName;
    renderMessages(list, data.messages || []);
    updateUnreadBadge();
    scrollThreadToBottom(list, true);
  } catch (err) {
    list.innerHTML = `<div class="text-center text-danger small">${escHtml(err.message)}</div>`;
  }
}

async function refreshActiveThread() {
  if (!activeConvId) return;
  try {
    const { data } = await apiRequest(`/networking/conversations/${activeConvId}/messages`);
    const list = document.getElementById('messagesList');
    renderMessages(list, data.messages || []);
    updateUnreadBadge();
    renderConversations(document.getElementById('conversationsList'));
  } catch (_) { /* silent */ }
}

function renderMessages(list, messages) {
  const prev = list.querySelectorAll('.net-bubble').length;
  list.innerHTML = (messages.length
    ? messages.map(m => messageBubble(m))
    : `<div class="text-center text-muted py-4 small"><i class="bi bi-chat-dots fs-2 d-block mb-2 opacity-50"></i><span data-i18n="net.noMessages">No messages yet. Say hello!</span></div>`).join('');

  /* Scroll only when a new message landed (not on initial load flashes). */
  if (messages.length > prev) scrollThreadToBottom(list, false);
}

function messageBubble(m) {
  const mine = m.is_mine;
  const meta = `${formatTime(m.created_at)}${mine ? (m.read_at ? ' · <i class="bi bi-check2-all"></i>' : ' · <i class="bi bi-check2"></i>') : ''}`;
  return `<div class="net-bubble ${mine ? 'mine' : 'theirs'}" role="listitem">
      ${escHtml(m.body)}
      <div class="t ${mine ? 'text-white-50' : 'text-muted'}">${meta}</div>
    </div>`;
}

/* ── Send ─────────────────────────────────────────────────── */
let sending = false;
async function sendMessage(conversationId, body) {
  if (sending) return;
  sending = true;
  const btn = document.getElementById('sendBtn');
  const input = document.getElementById('messageInput');
  if (btn) btn.disabled = true;

  try {
    const { data } = await apiRequest(`/networking/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { body },
    });
    if (input) input.value = '';
    const count = document.getElementById('charCount');
    if (count) count.textContent = `0 / 2000`;
    const list = document.getElementById('messagesList');
    if (list) list.insertAdjacentHTML('beforeend', messageBubble(data));
    scrollThreadToBottom(list, true);
    loadConversations();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message, 'danger');
  } finally {
    sending = false;
    if (btn) btn.disabled = false;
  }
}

/* ── Unread badge ─────────────────────────────────────────── */
async function updateUnreadBadge() {
  const badge = document.getElementById('netUnreadBadge');
  if (!badge) return;
  const total = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  badge.textContent = total > 9 ? '9+' : String(total);
  badge.style.display = total > 0 ? '' : 'none';
}

/* ── Small utilities ──────────────────────────────────────── */
function tKey(key, fallback) {
  if (typeof window.t === 'function') {
    const v = window.t(key);
    if (typeof v === 'string' && v) return v;
  }
  return fallback;
}

function loadingHtml() {
  return `<span class="spinner-border spinner-border-sm me-1" role="status"></span>`;
}

function avatarLetter(name) {
  return escHtml((name || '?').trim().charAt(0).toUpperCase());
}
function avatarBg(name) {
  const colors = ['#0d6efd', '#198754', '#6f42c1', '#fd7e14', '#0dcaf0', '#d63384', '#20c997', '#6610f2'];
  let h = 0;
  for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}
function formatTime(d) {
  if (!d) return '';
  if (typeof timeAgo === 'function') return timeAgo(d);
  return new Date(d).toLocaleString();
}
function scrollThreadToBottom(list, force) {
  if (!list) return;
  if (force) { list.scrollTop = list.scrollHeight; return; }
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  if (nearBottom) list.scrollTop = list.scrollHeight;
}