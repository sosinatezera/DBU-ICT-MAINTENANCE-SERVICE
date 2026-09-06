/* ============================================================
   notifications.js — Bell Dropdown + Full Notification Page
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

/* ── Auto-init on DOMContentLoaded ─────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;

  // Always start the live bell (works on every page that includes this file)
  initNotificationBell();

  // Full-page view (admin/notifications.html or technician/notifications.html)
  const p = window.location.pathname;
  if (p.includes('notifications.html')) {
    initNotificationsPage();
  }
});

/* ═══════════════════════════════════════════════════════════
   BELL — live badge + dropdown (injected into #notifBellContainer)
   ═══════════════════════════════════════════════════════════ */
let _pollTimer = null;

function initNotificationBell() {
  const container = document.getElementById('notifBellContainer');
  if (!container) return;

  // Inject the bell button + dropdown
  container.innerHTML = `
    <div class="dropdown">
      <button class="btn btn-sm btn-light position-relative border-0 shadow-none p-2"
              id="notifBellBtn" data-bs-toggle="dropdown" aria-expanded="false"
              title="Notifications" style="background:transparent;"
              onclick="loadBellDropdown()">
        <i class="bi bi-bell fs-5 text-secondary"></i>
        <span id="notifBadge"
              class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style="font-size:.6rem;min-width:18px;display:none;">0</span>
      </button>
      <div class="dropdown-menu dropdown-menu-end shadow border-0 p-0"
           id="notifDropdown"
           style="width:360px;max-height:480px;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <div class="d-flex align-items-center justify-content-between px-3 py-2 border-bottom bg-white">
          <span class="fw-bold small">Notifications</span>
          <div class="d-flex gap-2 align-items-center">
            <span id="notifUnreadLabel" class="badge bg-danger rounded-pill" style="display:none;">0</span>
            <button class="btn btn-link btn-sm text-muted p-0 text-decoration-none"
                    onclick="markAllReadBell(event)" title="Mark all as read">
              <i class="bi bi-check2-all"></i>
            </button>
            <a href="notifications.html" class="btn btn-link btn-sm text-primary p-0 text-decoration-none small">
              View all
            </a>
          </div>
        </div>
        <!-- List -->
        <div id="notifDropList" style="max-height:360px;overflow-y:auto;">
          <div class="text-center text-muted py-4 small">
            <div class="spinner-border spinner-border-sm me-1" role="status"></div>Loading…
          </div>
        </div>
      </div>
    </div>`;

  // Load count immediately
  refreshBellBadge();

  // Poll every 30 seconds
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(refreshBellBadge, 30000);
}

async function refreshBellBadge() {
  try {
    const { unread } = await apiRequest('/notifications');
    const badge = document.getElementById('notifBadge');
    const label = document.getElementById('notifUnreadLabel');
    if (badge) {
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = unread > 0 ? '' : 'none';
    }
    if (label) {
      label.textContent = unread;
      label.style.display = unread > 0 ? '' : 'none';
    }
  } catch (_) {}
}

async function loadBellDropdown() {
  const list = document.getElementById('notifDropList');
  if (!list) return;

  list.innerHTML = `<div class="text-center text-muted py-4 small">
    <div class="spinner-border spinner-border-sm me-1" role="status"></div>Loading…</div>`;

  try {
    const { data, unread } = await apiRequest('/notifications');

    // Update badge
    const badge = document.getElementById('notifBadge');
    const label = document.getElementById('notifUnreadLabel');
    if (badge) { badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = unread > 0 ? '' : 'none'; }
    if (label) { label.textContent = unread; label.style.display = unread > 0 ? '' : 'none'; }

    if (!data || !data.length) {
      list.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-bell-slash fs-2 d-block mb-2 opacity-50"></i>
          <small>No notifications yet.</small>
        </div>`;
      return;
    }

    list.innerHTML = data.slice(0, 10).map(n => `
      <div class="d-flex gap-2 px-3 py-2 border-bottom notif-drop-item ${n.is_read ? '' : 'bg-light'}"
           id="bell-notif-${n.id}"
           data-id="${n.id}"
           data-ticket="${n.ticket_id || ''}"
           role="button" tabindex="0"
           aria-label="${escHtml(n.title)}"
           style="cursor:pointer;transition:background .15s;"
           onclick="openNotif(this)"
           onkeydown="notifBellKeydown(event, this)">
        <div class="flex-shrink-0 mt-1">
          <span class="rounded-circle d-inline-flex align-items-center justify-content-center"
                style="width:32px;height:32px;background:${typeColourSoft(n.type)};">
            <i class="bi ${typeIcon(n.type)}" style="color:${typeColour(n.type)};font-size:.85rem;"></i>
          </span>
        </div>
        <div class="flex-grow-1 min-w-0">
          <div class="small fw-semibold text-truncate ${n.is_read ? 'text-muted' : ''}">${escHtml(n.title)}</div>
          <div class="text-muted text-truncate" style="font-size:.75rem;">${escHtml(n.message)}</div>
          <div class="text-muted" style="font-size:.7rem;">${timeAgo(n.created_at)}</div>
        </div>
        ${!n.is_read
          ? `<div class="flex-shrink-0 d-flex align-items-center">
               <span class="notif-dot" style="width:8px;height:8px;border-radius:50%;background:${typeColour(n.type)};display:inline-block;flex-shrink:0;"></span>
             </div>` : ''}
      </div>`).join('');

    if (data.length > 10) {
      list.innerHTML += `<div class="text-center py-2 border-top">
        <a href="notifications.html" class="small text-primary text-decoration-none">
          View all ${data.length} notifications →
        </a></div>`;
    }

  } catch (err) {
    list.innerHTML = `<div class="text-center text-danger py-3 small">${escHtml(err.message)}</div>`;
  }
}

async function markReadBell(id, el) {
  if (!el.classList.contains('bg-light')) return; // already read
  try {
    await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
    el.classList.remove('bg-light');
    el.querySelector('.notif-dot')?.remove();
    refreshBellBadge();
  } catch (_) {}
}

/* Click a bell item → mark read + take the user to the ticket details */
async function openNotif(el) {
  const id     = el.getAttribute('data-id')     || '';
  const ticket = el.getAttribute('data-ticket') || '';
  await markReadBell(id, el);
  openNotificationTicket(ticket);
}

async function markAllReadBell(e) {
  e.stopPropagation();
  try {
    await apiRequest('/notifications/read-all', { method: 'PATCH' });
    showToast('All notifications marked as read.', 'success');
    loadBellDropdown();
  } catch (err) { showToast(err.message, 'danger'); }
}

/* ═══════════════════════════════════════════════════════════
   FULL NOTIFICATIONS PAGE
   ═══════════════════════════════════════════════════════════ */
async function initNotificationsPage() {
  await loadNotificationsPage();

  document.getElementById('markAllReadBtn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'PATCH' });
      showToast('All notifications marked as read.', 'success');
      await loadNotificationsPage();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  document.getElementById('filterUnread')?.addEventListener('change', loadNotificationsPage);
}

async function loadNotificationsPage() {
  const container = document.getElementById('notificationsList');
  if (!container) return;

  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner-border text-primary" role="status"></div></div>`;

  try {
    const { data, unread } = await apiRequest('/notifications');
    const filterEl = document.getElementById('filterUnread');
    const filtered = filterEl?.checked ? data.filter(n => !n.is_read) : data;

    // Update counts
    const countEl = document.getElementById('unreadCount');
    if (countEl) countEl.textContent = unread > 0 ? `${unread} unread` : 'All read';

    // Update bell badge on this page too
    refreshBellBadge();

    if (!filtered || !filtered.length) {
      container.innerHTML = `
        <div class="text-center py-5">
          <i class="bi bi-bell-slash fs-1 text-muted d-block mb-3"></i>
          <h6 class="text-muted">${filterEl?.checked ? 'No unread notifications.' : 'No notifications yet.'}</h6>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(n => `
      <div class="card border-0 shadow-sm mb-2 ${n.is_read ? '' : 'border-start border-3'}"
           id="notif-${n.id}"
           data-ticket="${n.ticket_id || ''}"
           role="button" tabindex="0"
           aria-label="Open ${escHtml(n.title)}"
           style="border-left:4px solid ${typeColour(n.type)}!important;cursor:pointer;"
           onclick="markReadPage('${n.id}', this)"
           onkeydown="notifCardKeydown(event, '${n.id}', this)">
        <div class="card-body py-2 px-3">
          <div class="d-flex align-items-start gap-3">
            <div class="flex-shrink-0 mt-1">
              <span style="width:38px;height:38px;border-radius:50%;background:${typeColourSoft(n.type)};
                           display:inline-flex;align-items:center;justify-content:center;">
                <i class="bi ${typeIcon(n.type)}" style="color:${typeColour(n.type)};font-size:1rem;"></i>
              </span>
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <h6 class="mb-1 fw-semibold ${n.is_read ? 'text-muted' : ''}" style="font-size:.875rem;">
                  ${escHtml(n.title)}
                </h6>
                <div class="d-flex align-items-center gap-2 flex-shrink-0">
                  <small class="text-muted">${timeAgo(n.created_at)}</small>
                  <button class="btn btn-sm p-0 text-muted" style="line-height:1;"
                          onclick="deleteNotif('${n.id}', event)"
                          title="Delete">
                    <i class="bi bi-x-lg" style="font-size:.75rem;"></i>
                  </button>
                </div>
              </div>
              <p class="mb-0 text-muted" style="font-size:.8rem;line-height:1.4;">${escHtml(n.message)}</p>
            </div>
            ${!n.is_read
              ? `<div class="flex-shrink-0 mt-2">
                   <span class="notif-dot" style="width:8px;height:8px;border-radius:50%;background:${typeColour(n.type)};display:inline-block;"></span>
                 </div>`
              : ''}
          </div>
        </div>
      </div>`).join('');

  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">${escHtml(err.message)}</div>`;
  }
}

async function markReadPage(id, element) {
  const ticket = element.getAttribute('data-ticket') || '';
  if (element.querySelector('.notif-dot')) {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
      element.style.borderLeftColor = '#adb5bd';
      element.querySelectorAll('.notif-dot').forEach(s => s.remove());
      element.querySelector('h6')?.classList.add('text-muted');
      refreshBellBadge();
      const { unread } = await apiRequest('/notifications');
      const countEl = document.getElementById('unreadCount');
      if (countEl) countEl.textContent = unread > 0 ? `${unread} unread` : 'All read';
    } catch (_) {}
  }

  /* Open the related ticket using this role's existing detail interface */
  openNotificationTicket(ticket);
}

async function deleteNotif(id, e) {
  e.stopPropagation();
  try {
    await apiRequest(`/notifications/${id}`, { method: 'DELETE' });
    document.getElementById(`notif-${id}`)?.remove();
    refreshBellBadge();
  } catch (err) { showToast(err.message, 'danger'); }
}

/* ═══════════════════════════════════════════════════════════
   OPEN THE RELATED TICKET — role-aware. Reuses each role's
   existing detail interface when it exists on the current page,
   otherwise navigates to that role's detail page (which auto-
   opens the ticket). Tickets without a valid related id are
   left alone (legacy notifications never pretend to open). ═══ */
function openNotificationTicket(ticketId) {
  const raw = String(ticketId || '').trim();
  if (!raw || !/^[0-9a-f]{24}$/i.test(raw)) {
    console.warn('Notification has no valid related ticket id; skipping navigation.', raw);
    return;
  }

  const path = window.location.pathname;
  const sessionUser = (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser()) || null;
  /* Normalize so a stale/non-canonical role in the session never falls through
     to the wrong role branch (which would silently do nothing or open the wrong
     modal). Roles in main.js are canonical: Requester / Technician / ICT Admin. */
  const role = normalizeRole(sessionUser?.role) || '';

  /* Technician — use the view-ticket modal when present on this page. */
  if (role === 'Technician') {
    if (document.getElementById('viewTicketBody') && typeof openViewDetails === 'function') {
      openViewDetails(raw);
    } else if (document.getElementById('requestDetailBody') && typeof openDetailModal === 'function') {
      openDetailModal(raw);
    } else {
      window.location.href = 'assigned-requests.html?id=' + encodeURIComponent(raw);
    }
    return;
  }

  /* ICT Admin — use the request info / assign modal when present. */
  if (role === 'ICT Admin') {
    if (document.getElementById('requestInfoSection') && typeof openAdminRequestModal === 'function') {
      openAdminRequestModal(raw);
    } else if (document.getElementById('requestDetailBody') && typeof openDetailModal === 'function') {
      openDetailModal(raw);
    } else {
      window.location.href = 'requests.html?id=' + encodeURIComponent(raw);
    }
    return;
  }

  /* Requester / any other authenticated user */
  if (document.getElementById('requestDetailBody') && typeof openDetailModal === 'function') {
    openDetailModal(raw);
  } else if (path.includes('/user/')) {
    window.location.href = 'tracking.html?id=' + encodeURIComponent(raw);
  } else if (typeof openDetailModal === 'function') {
    openDetailModal(raw);
  }
}

/* Keyboard activation for notification cards (Enter / Space). */
function notifCardKeydown(e, id, el) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    markReadPage(id, el);
  }
}
function notifBellKeydown(e, el) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openNotif(el);
  }
}

/* ── Helpers ──────────────────────────────────────────────── */
function typeIcon(type) {
  return { success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill',
           danger:  'bi-x-circle-fill',     info:    'bi-bell-fill' }[type] || 'bi-bell-fill';
}
function typeColour(type) {
  return { success: '#198754', warning: '#fd7e14', danger: '#dc3545', info: '#2563eb' }[type] || '#2563eb';
}
function typeColourSoft(type) {
  return { success: '#d1e7dd', warning: '#fff3cd', danger: '#f8d7da', info: '#cfe2ff' }[type] || '#cfe2ff';
}
