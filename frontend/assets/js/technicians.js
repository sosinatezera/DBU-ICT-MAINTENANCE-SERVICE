/* ============================================================
   technicians.js — Technician Dashboard & All Technician Pages
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

/* Map Ticket statuses → MaintenanceRecord statuses for /maintenance POST */
function ticketStatusToMaintenance(s) {
  return { assigned: 'accepted', accepted: 'in_progress', in_progress: 'in_progress', resolved: 'resolved', closed: 'resolved' }[s] || 'in_progress';
}

/* JSON.stringify output that is safe to embed in a double-quoted HTML onclick attribute.
   Double-quotes are escaped as &quot; so the browser decodes them back to real quotes
   BEFORE evaluating the inline handler — otherwise the attribute would be truncated and
   the handler would become a JS SyntaxError (the classic source of empty request IDs). */
function jsAttr(v) {
  return JSON.stringify(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── Reliable Ticket ID helper ──────────────────────────────
   The backend stores the Ticket's Mongo _id in several keys depending on
   endpoint (ticket_id / id / _id / request_id). Always prefer the Mongo _id,
   never the human-readable TK-XXXX code, for API calls that target /tickets/:id. */
function getTicketId(ticket) {
  if (!ticket) return null;
  /* For assignment-shaped records from /technicians/my/assignments the
     response includes BOTH `_id` (the Assignment ObjectId) and `ticket_id`
     (the Ticket ObjectId). We must send the Ticket _id to /tickets/:id, so
     `ticket_id` takes priority. Plain /tickets/:id responses carry the Ticket
     _id as `_id` / `id` and have no `ticket_id`, so they fall through correctly. */
  const id = ticket.ticket_id || ticket._id || ticket.id || ticket.request_id || null;
  if (!id) return null;
  const s = String(id).trim();
  return /^[0-9a-f]{24}$/i.test(s) ? s : null;
}

/* One guard for every technician action — ensures a valid Mongo ticket _id
   is always sent to the backend (never undefined / null / "undefined" / ""). */
function requireTicketId(btn) {
  const id = btn?.dataset?.ticketId || '';
  const clean = String(id).trim();
  if (!clean || clean === 'undefined' || clean === 'null') {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return null;
  }
  if (!/^[0-9a-f]{24}$/i.test(clean)) {
    showToast('Invalid request ID. Reopen the task from the list.', 'danger');
    return null;
  }
  return clean;
}

/* ── Single delegated click handler for ALL technician action buttons ──
   Bound ONCE on document. Every persistent action button carries:
     data-action   = "view" | "accept" | "start" | "update" | "resolve" | "report" | "view-report"
     data-ticket-id= the Ticket Mongo _id
   This survives dynamic re-renders and guarantees ONE CLICK = ONE handler. */
let _techActionBound = false;
function initTechActionDelegation() {
  if (_techActionBound) return;
  _techActionBound = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.dataset.action === '') return;

    const ticketId = requireTicketId(btn);
    if (!ticketId) {
      e.preventDefault();
      return;
    }
    if (btn.dataset.action === 'view')         return openViewDetails(ticketId);
    if (btn.dataset.action === 'accept')       return acceptTask(btn, ticketId);
    if (btn.dataset.action === 'start')        return startWork(btn, ticketId);
    if (btn.dataset.action === 'resolve')      return resolveTask(btn, ticketId);
    if (btn.dataset.action === 'update') {
      // Dashboard uses #updateTaskModal, assigned-requests uses #taskModal.
      return window.location.pathname.includes('technician/assigned-requests')
        ? openTaskModal(ticketId, btn.dataset.title, btn.dataset.status)
        : openUpdateModal(ticketId, btn.dataset.title, btn.dataset.status);
    }
    if (btn.dataset.action === 'report')       return openFeedbackModal(ticketId, btn.dataset.title);
    if (btn.dataset.action === 'view-report')  return viewFeedbackReport(ticketId);
  });
}

/* ── Helper: render the action buttons for a single ticket row/card ──
   Buttons shown depend on the ticket's current status. */
function renderTechActionButtons(r) {
  const id = getTicketId(r);
  if (!id) return '';
  const status = r.status;

  const btn = (action, label, icon, variant = 'primary', title = '') =>
    `<button type="button" class="btn btn-sm btn-${variant} fw-semibold"
             data-action="${action}" data-ticket-id="${escHtml(id)}"
             data-title="${escHtml(r.title || '')}" data-status="${escHtml(status)}"
             title="${title}"><i class="bi ${icon} me-1"></i>${label}</button>`;

  const view = btn('view', 'View', 'bi-eye', 'outline-secondary');

  let extra = '';
  if (status === 'assigned') {
    extra += btn('accept', 'Accept', 'bi-check2-circle', 'success');
  } else if (status === 'accepted') {
    extra += btn('start', 'Start Work', 'bi-play-fill', 'info');
  } else if (status === 'in_progress') {
    extra += btn('update', 'Update', 'bi-pencil-fill', 'warning');
    extra += btn('resolve', 'Resolve', 'bi-check2-all', 'success');
  }

  const report = r.has_feedback
    ? btn('view-report', 'Report', 'bi-file-earmark-text', 'outline-primary')
    : btn('report', 'Report', 'bi-clipboard-plus', 'primary');

  return `<div class="d-flex flex-wrap gap-1">${view}${extra}${report}</div>`;
}

/* ── Quick status-action (Accept / Start Work / Resolve) ─── */
async function quickStatusAction(btn, ticketId, newStatus, successMsg) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;
  try {
    await apiRequest(`/tickets/${ticketId}/status`, { method: 'PATCH', body: { status: newStatus } });
    showToast(successMsg, 'success');
    await refreshAfterAction();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = original;
    handleApiError(err);
  }
}

async function acceptTask(btn, ticketId)     { return quickStatusAction(btn, ticketId, 'accepted', 'Task accepted.'); }
async function startWork(btn, ticketId)      { return quickStatusAction(btn, ticketId, 'in_progress', 'Work started.'); }
async function resolveTask(btn, ticketId)    { return quickStatusAction(btn, ticketId, 'resolved', 'Task marked as resolved.'); }

/* Refresh the list that is currently visible (dashboard or assigned requests)
   without reloading the whole page. */
async function refreshAfterAction() {
  if (window.location.pathname.includes('technician/dashboard')) {
    await loadDashboardTasks();
    await loadRecentActivity();
  } else if (window.location.pathname.includes('technician/assigned-requests')) {
    await fetchAssignedRequests();
  } else if (window.location.pathname.includes('technician/technician-feedback')) {
    const { data } = await apiRequest('/technicians/my/assignments');
    renderTechFeedbackCards(data);
  }
}

/* Map a backend error to a clear, user-friendly message. */
function handleApiError(err) {
  const code = (err && err.data && err.data.statusCode) || (err && err.status) || '';
  let msg = (err && err.message) || 'Something went wrong.';
  if (code === 401 || String(msg).includes('jwt') || String(msg).includes('expired')) {
    msg = 'Your session has expired. Please login again.';
  } else if (code === 403 || String((err && err.message) || '').toLowerCase().includes('not authorized') || String((err && err.message) || '').toLowerCase().includes('assigned to you')) {
    msg = 'You are not authorized to modify this request.';
  } else if (code === 404) {
    msg = 'Request not found.';
  }
  showToast(msg, 'danger');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  const p = window.location.pathname;

  if (p.includes('technician/dashboard'))          initTechDashboard();
  if (p.includes('technician/assigned-requests'))  initAssignedRequests();
  if (p.includes('technician/maintenance'))        initMaintenanceLog();
  if (p.includes('technician/history'))            initTechHistory();
  if (p.includes('technician/technician-feedback')) initTechFeedbackPage();
  if (p.includes('admin/technicians'))             initAdminTechnicians();
});

/* ═══════════════════════════════════════════════════════════
   TECHNICIAN DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function initTechDashboard() {
  if (!requireRole('Technician')) return;
  const dateEl = document.getElementById('currentDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

  await loadTechProfile();
  await loadDashboardTasks();
  await loadRecentActivity();
  await loadTechFeedbackReports();
  initAvailabilityToggle();
  initTechActionDelegation();
  initFeedbackHandlers();
}

/* ── Load & render "My Technical Reports" on the dashboard ────
   Shows recently submitted maintenance reports (diagnosis, work
   performed, status, resolution, completion date). */
async function loadTechFeedbackReports() {
  const panel = document.getElementById('techFeedbackPanel');
  if (!panel) return;

  try {
    const { data: assignments } = await apiRequest('/technicians/my/assignments');
    const reported = (assignments || []).filter(a => a.has_feedback);

    /* Fetch report details for the most recent few so the panel stays light. */
    const recent = reported.slice(0, 5);
    const items = [];
    for (const a of recent) {
      try {
        const { data: report } = await apiRequest(`/tickets/${encodeURIComponent(a.ticket_id || a.id)}/technician-feedback`);
        items.push({ ticket: a.ticketId || a.ticket_id || 'Ticket', report });
      } catch (_) { /* skip individual failures */ }
    }

    if (!items.length) {
      panel.innerHTML = `
        <div class="text-center text-muted py-4">
          <i class="bi bi-clipboard-x fs-3 d-block mb-2 text-muted"></i>
          <p class="mb-0 small">No technical reports submitted yet.</p>
          <a href="technician-feedback.html" class="btn btn-sm btn-outline-primary mt-2">Submit a report</a>
        </div>`;
      return;
    }

    panel.innerHTML = items.map(({ ticket, report }) => {
      const statusBadgeHtml = report.status === 'Fixed'
        ? '<span class="badge bg-success">Fixed</span>'
        : report.status === 'Not Fixed'
          ? '<span class="badge bg-danger">Not Fixed</span>'
          : '<span class="badge bg-warning text-dark">In Progress</span>';
      const row = (label, value) => value ? `
        <div class="d-flex gap-2 mb-1">
          <span class="text-muted small text-nowrap" style="min-width:110px;">${escHtml(label)}</span>
          <span class="small">${escHtml(value)}</span>
        </div>` : '';
      return `
        <div class="border-bottom p-3">
          <div class="d-flex align-items-center gap-2 mb-2">
            <strong class="text-primary small">${escHtml(ticket)}</strong>
            ${statusBadgeHtml}
            ${report.completionDate ? `<span class="ms-auto small text-muted"><i class="bi bi-calendar-check me-1"></i>${formatDate(report.completionDate)}</span>` : ''}
          </div>
          ${row('Diagnosis', report.diagnosis)}
          ${row('Work Performed', report.workPerformed)}
          ${row('Resolution', report.resolution)}
        </div>`;
    }).join('');
  } catch (err) {
    panel.innerHTML = `<div class="text-danger small p-3">Failed to load technical reports. ${escHtml(err.message || '')}</div>`;
  }
}

/* ── Load & display technician profile ─────────────────────── */
async function loadTechProfile() {
  const user = Auth.getUser();
  if (!user) return;

  const initial = (user.fullName || 'T').charAt(0).toUpperCase();
  ['avatarInitial', 'bannerInitial'].forEach(id => setText(id, initial));
  setText('sidebarUserName', user.fullName);
  setText('welcomeName',     `Welcome, ${user.fullName}`);
  setText('topUserName',     `Hi, ${user.fullName}`);

  const myTech = await resolveMyTech();
  if (!myTech) return;

  setText('sidebarSpec', myTech.specialization || 'ICT Support');
  setText('bannerSpec',  myTech.specialization || 'ICT Support');

  // Restore availability toggle from saved tech state
  const toggle = document.getElementById('availabilityToggle');
  if (toggle) {
    toggle.checked = myTech.available !== false;
    updateAvailabilityUI(toggle.checked);
  }
}

/* Resolve the authenticated technician's profile deterministically via
   /technicians/me (keyed on the logged-in user's id — immune to duplicate or
   renamed fullNames). Falls back to the legacy list + fullName match only so
   the frontend still works against older backends. */
async function resolveMyTech() {
  try {
    const { data: me } = await apiRequest('/technicians/me');
    if (me) return me;
  } catch (_) { /* fall back to the list-based lookup */ }

  try {
    const user    = Auth.getUser();
    const { data: techs } = await apiRequest('/technicians');
    return techs.find(t => t.fullName === user?.fullName) || null;
  } catch (_) { return null; }
}

/* ── Load tasks and populate dashboard ─────────────────────── */
async function loadDashboardTasks() {
  const tbody = document.getElementById('activeTasksBody');

  try {
    const { data } = await apiRequest('/technicians/my/assignments');

    const counts = { total: data.length, pending: 0, in_progress: 0, completed: 0 };
    data.forEach(r => {
      if (['submitted', 'under_review', 'assigned', 'accepted'].includes(r.status))  counts.pending++;
      if (r.status === 'in_progress')                                                  counts.in_progress++;
      if (['resolved', 'closed'].includes(r.status))                                   counts.completed++;
    });

    setText('totalAssigned',   counts.total);
    setText('pendingTasks',    counts.pending);
    setText('inProgressTasks', counts.in_progress);
    setText('completedTasks',  counts.completed);

    const pBadge = document.getElementById('pendingCount');
    if (pBadge) pBadge.textContent = counts.pending;

    setText('activeBannerCount', counts.pending + counts.in_progress);

    const activeTasks = data.filter(r => !['resolved','closed'].includes(r.status)).slice(0, 8);

    if (!tbody) return;

    if (activeTasks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-5">
            <i class="bi bi-check2-all text-success fs-1 d-block mb-2"></i>
            <div class="text-muted">No active tasks — all caught up!</div>
            <a href="assigned-requests.html" class="btn btn-sm btn-outline-primary mt-2">View All Assignments</a>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = activeTasks.map(r => `
      <tr>
        <td class="ps-3"><strong class="text-primary">${escHtml(r.ticketId || r.ticket_id)}</strong></td>
        <td>
          <div class="fw-semibold" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
               title="${escHtml(r.title || '')}">
            ${escHtml(r.title || `Ticket ${r.ticketId}`)}
          </div>
          <small class="text-muted">${escHtml(r.equipmentType || '—')}</small>
        </td>
        <td>${priorityBadge(r.priority || 'medium')}</td>
        <td>${statusBadge(r.status)}</td>
        <td><small class="text-muted">${formatDate(r.assigned_at)}</small></td>
        <td class="pe-3">${renderTechActionButtons(r)}</td>
      </tr>`).join('');

  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">
      Failed to load active tasks. ${escHtml(err.message||'')}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadDashboardTasks()">Retry</button>
    </td></tr>`;
  }
}

/* ── Recent activity panel ──────────────────────────────────── */
async function loadRecentActivity() {
  const panel = document.getElementById('recentActivityPanel');
  if (!panel) return;

  try {
    const { data } = await apiRequest('/maintenance/my');

    if (!data || data.length === 0) {
      panel.innerHTML = `
        <div class="text-center text-muted py-3">
          <i class="bi bi-journal-x fs-2 d-block mb-2 opacity-50"></i>
          <small>No activity logged yet.</small>
        </div>`;
      return;
    }

    panel.innerHTML = data.slice(0, 5).map(a => `
      <div class="d-flex gap-2 mb-3 pb-3 border-bottom">
        <div class="flex-shrink-0 mt-1">
          <span class="badge rounded-circle p-2 ${a.status === 'resolved' ? 'bg-success' : 'bg-primary'}" style="width:10px;height:10px;"></span>
        </div>
        <div class="flex-grow-1">
          <div class="fw-semibold small">${escHtml(a.ticketId || `Ticket ${a.ticket_id || ''}`.trim())}</div>
          <div class="text-muted" style="font-size:.78rem;">${escHtml((a.action_taken||'').substring(0, 60))}${(a.action_taken||'').length > 60 ? '...' : ''}</div>
          <div class="text-muted" style="font-size:.72rem;">${timeAgo(a.created_at)}</div>
        </div>
        <div class="flex-shrink-0">${statusBadge(a.status)}</div>
      </div>`).join('');

  } catch (err) {
    panel.innerHTML = `<p class="text-muted small text-center py-2">Activity unavailable. ${escHtml(err.message||'')}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadRecentActivity()">Retry</button></p>`;
  }
}

/* ── Availability toggle ────────────────────────────────────── */
function initAvailabilityToggle() {
  const toggle = document.getElementById('availabilityToggle');
  if (!toggle) return;

  toggle.addEventListener('change', async () => {
    const desired = toggle.checked;

    // Persist to backend first — no premature success toast.
    try {
      const myTech = await resolveMyTech();
      if (!myTech) {
        toggle.checked = !desired;
        updateAvailabilityUI(toggle.checked);
        showToast('Could not locate your technician profile to save availability.', 'warning');
        return;
      }
      await apiRequest(`/technicians/${myTech.id}`, {
        method: 'PUT',
        body: { specialization: myTech.specialization, available: desired },
      });
      updateAvailabilityUI(desired);
      showToast(`Status set to ${desired ? 'Available' : 'Unavailable'}`, desired ? 'success' : 'info');
    } catch (err) {
      // Revert the toggle since the backend rejected the change.
      toggle.checked = !desired;
      updateAvailabilityUI(toggle.checked);
      showToast('Could not save availability: ' + err.message, 'danger');
    }
  });
}

function updateAvailabilityUI(isAvailable) {
  const badge   = document.getElementById('availabilityBadge');
  const sideBar = document.getElementById('availBadgeSidebar');
  const label   = document.getElementById('availLabel');
  if (badge) {
    badge.innerHTML = `<i class="bi bi-circle-fill me-1" style="font-size:.5rem;"></i>${isAvailable ? 'Available' : 'Unavailable'}`;
    badge.className = `badge px-3 py-2 ${isAvailable ? 'bg-success' : 'bg-secondary'}`;
  }
  if (sideBar) { sideBar.textContent = '●'; sideBar.className = `badge ms-auto ${isAvailable ? 'bg-success' : 'bg-secondary'}`; }
  if (label)   label.textContent = isAvailable ? 'Available' : 'Unavailable';
}

/* ── View Ticket Details ────────────────────────────────────── */
async function openViewDetails(requestId) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return;
  }

  const modalEl = document.getElementById('viewTicketModal');
  if (!modalEl) { showToast('View details window is not available on this page.', 'warning'); return; }

  const body = document.getElementById('viewTicketBody');
  if (body) body.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>`;

  let m = bootstrap.Modal.getInstance(modalEl);
  if (!m) m = new bootstrap.Modal(modalEl);
  m.show();

  try {
    const { data: r } = await apiRequest(`/tickets/${requestId}`);
    if (!body) return;
    const row = (label, value) => `
      <div>
        <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
        <div class="small p-2 bg-light rounded">${value ? value : '<span class="text-muted">—</span>'}</div>
      </div>`;
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-start mb-3">
        <h5 class="mb-0 fw-bold">${escHtml(r.ticketId || r.id)}</h5>
        <div class="d-flex gap-2">${priorityBadge(r.priority)}${statusBadge(r.status)}</div>
      </div>
      ${r.title ? row('Title', escHtml(r.title)) : ''}
      ${row('Requester', escHtml(r.requester_name))}
      ${row('Department', escHtml(r.department))}
      ${row('Equipment', escHtml(r.equipmentType))}
      ${r.asset_tag ? row('ICT Asset', `<i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}`) : ''}
      ${r.serialNumber ? row('Serial Number', escHtml(r.serialNumber)) : ''}
      ${row('Description', `<div style="white-space:pre-wrap;">${escHtml(r.problemDescription)}</div>`)}
      ${row('Assigned Technician', escHtml(r.assignedTechnician || '—'))}
      ${row('Priority', priorityBadge(r.priority))}
      ${row('Status', statusBadge(r.status))}
      ${row('Created', escHtml(formatDate(r.created_at)))}`;
  } catch (err) {
    if (body) body.innerHTML = `<div class="alert alert-danger mb-0">${escHtml(err.message)}</div>`;
  }
}

/* ── Update Task Modal ──────────────────────────────────────── */
async function openUpdateModal(requestId, title, currentStatus) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return;
  }

  document.getElementById('modalRequestId').value = requestId;
  document.getElementById('updateTaskModalLabel').textContent = title ? `Update: ${title}` : `Update Request #${requestId}`;

  /* Only show valid next statuses given the current ticket status. */
  const statusSel = document.getElementById('modalStatus');
  const validNext = { assigned: ['accepted','in_progress'], accepted: ['in_progress'], in_progress: ['resolved'] };
  const allowed = validNext[currentStatus] || ['in_progress', 'resolved'];
  statusSel.innerHTML = allowed.map(s =>
    `<option value="${s}">${({accepted:'Accept Task', in_progress:'Mark In Progress', resolved:'Mark as Resolved'})[s] || s}</option>`
  ).join('');
  statusSel.value = allowed[allowed.length - 1];

  document.getElementById('modalAction').value = '';
  document.getElementById('modalParts').value  = '';
  document.getElementById('modalNotes').value  = '';

  const alert = document.getElementById('updateTaskAlert');
  if (alert) alert.classList.add('d-none');

  const info = document.getElementById('modalTaskInfo');
  if (info) {
    info.innerHTML = `<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading request details...`;
    try {
      const { data: r } = await apiRequest(`/tickets/${requestId}`);
      info.innerHTML = `
        <div class="row g-2">
          <div class="col-sm-6"><span class="text-muted small d-block">Title</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
          <div class="col-sm-3"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
          <div class="col-sm-3"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
          ${r.asset_tag ? `<div class="col-sm-6"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}</strong></div>` : ''}
          <div class="col-12"><span class="text-muted small d-block">Description</span>
            <div class="small p-2 bg-white border rounded" style="max-height:80px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
        </div>`;
    } catch (_) {
      info.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
    }
  }

  const saveBtn = document.getElementById('saveUpdateBtn');
  saveBtn.onclick = () => saveTaskUpdate(requestId);

  const modalEl = document.getElementById('updateTaskModal');
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();
}

async function saveTaskUpdate(requestId) {
  const status = document.getElementById('modalStatus').value;
  const action = document.getElementById('modalAction').value.trim();
  const parts  = document.getElementById('modalParts').value.trim();
  const notes  = document.getElementById('modalNotes').value.trim();

  if (!requestId || !/^[0-9a-f]{24}$/i.test(String(requestId).trim())) {
    showAlert('updateTaskAlert', 'Invalid or missing request ID. Please reopen the task and try again.', 'warning');
    return;
  }

  if (!action) {
    showAlert('updateTaskAlert', 'Please describe the action taken.', 'warning');
    return;
  }

  setLoading('saveUpdateBtn', 'saveUpdateSpinner', true);

  try {
    await apiRequest(`/tickets/${requestId}/status`, { method: 'PATCH', body: { status } });
    await apiRequest('/maintenance', {
      method: 'POST',
      body: { request_id: requestId, action_taken: action, parts_used: parts || null, notes: notes || null, status: ticketStatusToMaintenance(status) },
    });

    showToast('Task updated successfully!', 'success');
    bootstrap.Modal.getInstance(document.getElementById('updateTaskModal'))?.hide();
    await loadDashboardTasks();
    await loadRecentActivity();

  } catch (err) {
    showAlert('updateTaskAlert', err.message, 'danger');
  } finally {
    setLoading('saveUpdateBtn', 'saveUpdateSpinner', false);
  }
}

/* ═══════════════════════════════════════════════════════════
   ASSIGNED REQUESTS PAGE
   ═══════════════════════════════════════════════════════════ */
async function initAssignedRequests() {
  if (!requireRole('Technician')) return;
  let all = [];

  try {
    all = await fetchAssignedRequests();
  } catch (err) {
    const container = document.getElementById('assignedRequestsList');
    if (container) {
      container.innerHTML = `<div class="col-12 text-center text-muted py-5">
        <i class="bi bi-exclamation-triangle fs-1 text-danger d-block mb-2"></i>
        <p>Failed to load assigned requests. ${escHtml(err.message||'')}</p>
        <button type="button" class="btn btn-outline-primary" onclick="initAssignedRequests()">Retry</button>
      </div>`;
    }
  }

  document.getElementById('filterBtn')?.addEventListener('click', () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const st = document.getElementById('statusFilter')?.value || '';
    const pr = document.getElementById('priorityFilter')?.value || '';
    renderAssignedCards(all.filter(r =>
      (!q  || (r.title||'').toLowerCase().includes(q) || String(r.ticket_id).includes(q)) &&
      (!st || r.status === st) &&
      (!pr || (r.priority||'medium') === pr)
    ));
  });

  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('filterBtn')?.click();
  });

  initTechActionDelegation();
  initFeedbackHandlers();

  document.getElementById('saveTaskUpdateBtn')?.addEventListener('click', async () => {
    const requestId = (document.getElementById('taskRequestId').value || '').trim();
    const status    = document.getElementById('newStatus').value;
    const action    = document.getElementById('actionTaken').value.trim();
    const parts     = document.getElementById('partsUsed').value.trim();
    const notes     = document.getElementById('techNotes').value.trim();

    if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
      showAlert('taskUpdateAlert', 'Invalid or missing request ID. Please reopen the task and try again.', 'warning');
      return;
    }

    if (!status || !action) {
      showAlert('taskUpdateAlert', 'Status and action taken are required.', 'warning');
      return;
    }
    setLoading('saveTaskUpdateBtn', 'saveTaskSpinner', true);
    try {
      await apiRequest(`/tickets/${requestId}/status`, { method: 'PATCH', body: { status } });
      await apiRequest('/maintenance', {
        method: 'POST',
        body: { request_id: requestId, action_taken: action, parts_used: parts||null, notes: notes||null, status: ticketStatusToMaintenance(status) },
      });
      showToast('Task updated!', 'success');
      bootstrap.Modal.getInstance(document.getElementById('taskModal'))?.hide();
      all = await fetchAssignedRequests();
    } catch (err) {
      showAlert('taskUpdateAlert', err.message, 'danger');
    } finally {
      setLoading('saveTaskUpdateBtn', 'saveTaskSpinner', false);
    }
  });
}

async function initTechFeedbackPage() {
  if (!requireRole('Technician')) return;
  await loadTechProfile();
  initFeedbackHandlers();

  const listEl = document.getElementById('techFeedbackList');
  if (listEl) listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-open-feedback, .btn-view-report');
    if (!btn) return;
    if (btn.classList.contains('btn-open-feedback')) {
      openFeedbackModal(btn.dataset.id, btn.dataset.title);
    } else if (btn.classList.contains('btn-view-report')) {
      viewFeedbackReport(btn.dataset.id);
    }
  });

  try {
    const { data } = await apiRequest('/technicians/my/assignments');
    renderTechFeedbackCards(data);
  } catch (err) { showToast(err.message, 'danger'); }
}

function renderTechFeedbackCards(assignments) {
  const container = document.getElementById('techFeedbackList');
  if (!container) return;

  if (!assignments.length) {
    container.innerHTML = `
      <div class="col-12 text-center py-5">
        <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i>
        <p class="text-muted">No assigned requests found.</p>
      </div>`;
    return;
  }

  const borderColours = { critical:'#dc3545', high:'#fd7e14', medium:'#2563eb', low:'#198754' };

  container.innerHTML = assignments.map(r => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100"
           style="border-left:4px solid ${borderColours[r.priority||'medium']}!important;">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="text-muted small fw-semibold">${escHtml(r.ticketId || r.ticket_id)}</span>
            ${priorityBadge(r.priority||'medium')}
          </div>
          <h6 class="fw-semibold mb-1" style="line-height:1.3;">
            ${escHtml(r.title || `Ticket ${r.ticketId}`)}
          </h6>
          <div class="text-muted small mb-2">
            <i class="bi bi-tag me-1"></i>${escHtml(r.equipmentType || '—')}
            ${r.department ? `&nbsp;·&nbsp;<i class="bi bi-building me-1"></i>${escHtml(r.department)}` : ''}
          </div>
          <div class="mb-2">
            ${statusBadge(r.status)}
            ${r.has_feedback
              ? `<span class="badge bg-success ms-1">Reported</span>`
              : `<span class="badge bg-light text-dark border ms-1">No report yet</span>`}
          </div>
          <div class="text-muted" style="font-size:.78rem;">
            <i class="bi bi-calendar3 me-1"></i>Assigned: ${formatDate(r.assigned_at)}
          </div>
        </div>
        <div class="card-footer bg-transparent border-top-0 px-3 pb-3">
          <div class="d-grid gap-2">
            ${r.has_feedback
              ? `<button class="btn btn-outline-primary btn-sm fw-semibold btn-view-report"
                         data-id="${escHtml(r.ticket_id)}" data-title="${escHtml(r.title || '')}"
                         data-bs-toggle="modal" data-bs-target="#viewReportModal">
                   <i class="bi bi-file-earmark-text me-1"></i>View Report
                 </button>
                 <button class="btn btn-primary btn-sm fw-semibold btn-open-feedback"
                         data-id="${escHtml(r.ticket_id)}" data-title="${escHtml(r.title || '')}"
                         data-bs-toggle="modal" data-bs-target="#feedbackModal">
                   <i class="bi bi-pencil-square me-1"></i>Edit Report
                 </button>`
              : `<button class="btn btn-primary btn-sm fw-semibold btn-open-feedback"
                         data-id="${escHtml(r.ticket_id)}" data-title="${escHtml(r.title || '')}"
                         data-bs-toggle="modal" data-bs-target="#feedbackModal">
                   <i class="bi bi-clipboard-plus me-1"></i>Add Report
                 </button>`}
          </div>
        </div>
      </div>
    </div>`).join('');
}

async function fetchAssignedRequests() {
  const { data } = await apiRequest('/technicians/my/assignments');
  renderAssignedCards(data);

  setText('totalAssigned',   data.length);
  setText('pendingTasks',    data.filter(r => ['submitted', 'under_review', 'assigned', 'accepted'].includes(r.status)).length);
  setText('inProgressTasks', data.filter(r => r.status === 'in_progress').length);
  setText('completedTasks',  data.filter(r => ['resolved', 'closed'].includes(r.status)).length);
  return data;
}

function renderAssignedCards(assignments) {
  const container = document.getElementById('assignedRequestsList');
  if (!container) return;

  if (!assignments.length) {
    container.innerHTML = `
      <div class="col-12 text-center py-5">
        <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i>
        <p class="text-muted">No assigned requests found.</p>
      </div>`;
    return;
  }

  const borderColours = { critical:'#dc3545', high:'#fd7e14', medium:'#2563eb', low:'#198754' };

  container.innerHTML = assignments.map(r => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100"
           style="border-left:4px solid ${borderColours[r.priority||'medium']}!important;">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="text-muted small fw-semibold">${escHtml(r.ticketId || r.ticket_id)}</span>
            ${priorityBadge(r.priority||'medium')}
          </div>
          <h6 class="fw-semibold mb-1" style="line-height:1.3;">
            ${escHtml(r.title || `Ticket ${r.ticketId}`)}
          </h6>
          <div class="text-muted small mb-2">
            <i class="bi bi-tag me-1"></i>${escHtml(r.equipmentType || '—')}
            ${r.department ? `&nbsp;·&nbsp;<i class="bi bi-building me-1"></i>${escHtml(r.department)}` : ''}
          </div>
          <div class="mb-2">${statusBadge(r.status)}</div>
          <div class="text-muted" style="font-size:.78rem;">
            <i class="bi bi-calendar3 me-1"></i>Assigned: ${formatDate(r.assigned_at)}
          </div>
        </div>
        <div class="card-footer bg-transparent border-top-0 px-3 pb-3">
          <div class="d-grid gap-2">${renderTechActionButtons(r)}</div>
        </div>
      </div>
    </div>`).join('');
}

function openTaskModal(requestId, title, currentStatus) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return;
  }

  document.getElementById('taskRequestId').value = requestId;
  document.getElementById('taskModalLabel').textContent = `Update: ${title || `Request #${requestId}`}`;
  document.getElementById('newStatus').value =
    (currentStatus === 'in_progress' || currentStatus === 'accepted') ? 'resolved' : 'in_progress';
  document.getElementById('actionTaken').value = '';
  document.getElementById('partsUsed').value   = '';
  document.getElementById('techNotes').value   = '';
  const alert = document.getElementById('taskUpdateAlert');
  if (alert) alert.classList.add('d-none');
  loadTaskInfoSection(requestId, 'taskInfoSection');

  const modalEl = document.getElementById('taskModal');
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();
}

async function loadTaskInfoSection(requestId, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.innerHTML = `<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;
  try {
    const { data: r } = await apiRequest(`/tickets/${requestId}`);
    section.innerHTML = `
      <div class="row g-2">
        <div class="col-6"><span class="text-muted small d-block">Title</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
        <div class="col-3"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
        <div class="col-3"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
        <div class="col-sm-6"><span class="text-muted small d-block">Equipment</span>${escHtml(r.equipmentType||'—')}</div>
        ${r.asset_tag ? `<div class="col-sm-6"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}</strong></div>` : ''}
        <div class="col-12"><span class="text-muted small d-block">Description</span>
          <div class="small p-2 bg-light rounded" style="max-height:70px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
        </div>
      </div>`;
  } catch (_) {
    section.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   MAINTENANCE REPORT (Technician Feedback)
   ═══════════════════════════════════════════════════════════ */
let _fbMode = 'add';   // 'add' | 'edit'
let _fbRequestId = null;

let _fbHandlersBound = false;
function initFeedbackHandlers() {
  if (_fbHandlersBound) return;
  _fbHandlersBound = true;

  const saveBtn = document.getElementById('saveFeedbackBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => submitFeedback());

  const statusSel = document.getElementById('fbStatus');
  if (statusSel) statusSel.addEventListener('change', updateFeedbackReasonVisibility);

  const reasonWrap = document.getElementById('fbReasonWrap');
  if (reasonWrap) reasonWrap.addEventListener('change', updateFeedbackReasonVisibility);

  // Warn before closing the form if it has unsaved changes
  const modalEl = document.getElementById('feedbackModal');
  if (modalEl) {
    modalEl.addEventListener('hide.bs.modal', (e) => {
      if (_fbMode !== 'edit' && !_feedbackDirty()) return;
      if (!confirm('This report has unsaved changes. Discard and close?')) {
        e.preventDefault();
      }
    });
  }
}

function _feedbackDirty() {
  if (!document.getElementById('feedbackRequestId')?.value) return false;
  const f = id => document.getElementById(id)?.value.trim() || '';
  return !!(f('fbDiagnosis') || f('fbWorkPerformed') || f('fbPartsUsed') || f('fbResolution') ||
            f('fbReasonNotFixed') || f('fbRecommendation') || f('fbTechnicianNotes'));
}

function updateFeedbackReasonVisibility() {
  const status = document.getElementById('fbStatus')?.value;
  const wrap   = document.getElementById('fbReasonWrap');
  if (!wrap) return;
  if (status === 'Not Fixed') {
    wrap.classList.remove('d-none');
  } else {
    wrap.classList.add('d-none');
  }
}

function resetFeedbackForm() {
  ['fbDiagnosis','fbWorkPerformed','fbPartsUsed','fbResolution','fbReasonNotFixed','fbRecommendation','fbTechnicianNotes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const status = document.getElementById('fbStatus');
  if (status) status.value = 'Fixed';
  const conf = document.getElementById('fbConfirmed');
  if (conf) conf.checked = false;
  const alert = document.getElementById('feedbackAlert');
  if (alert) { alert.classList.add('d-none'); alert.textContent = ''; }
  updateFeedbackReasonVisibility();
}

async function openFeedbackModal(requestId, title) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return;
  }
  _fbMode = 'add';
  _fbRequestId = requestId;
  resetFeedbackForm();
  // Store the RAW Ticket _id (never the "#..." display reference) so the
  // submit handler can only ever target the real MongoDB document.
  document.getElementById('feedbackRequestId').value = requestId;
  const modalEl = document.getElementById('feedbackModal');
  if (modalEl) modalEl.dataset.ticketId = requestId;
  // "#..." is purely cosmetic — it is never parsed back to build an API call.
  const label = document.getElementById('feedbackModalLabel');
  if (label) label.textContent = `Add Maintenance Report: ${title || `#${requestId}`}`;

  const info = document.getElementById('feedbackTaskInfo');
  if (info) {
    info.innerHTML = `<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading request details...`;
    try {
      const { data: r } = await apiRequest(`/tickets/${encodeURIComponent(requestId)}`);
      info.innerHTML = `
        <div class="row g-2">
          <div class="col-sm-4"><span class="text-muted small d-block">Ticket</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
          <div class="col-sm-4"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
          <div class="col-sm-4"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Equipment</span>${escHtml(r.equipmentType||'—')}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Requester</span>${escHtml(r.requester_name||'—')}</div>
          ${r.asset_tag ? `<div class="col-12"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}</strong></div>` : ''}
          <div class="col-12"><span class="text-muted small d-block">Description</span>
            <div class="small p-2 bg-light rounded" style="max-height:70px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
        </div>`;

      // If a report already exists, pre-fill in edit mode
      if (r.has_technician_feedback && r.technician_feedback) {
        openEditFeedbackModal(requestId, title, r.technician_feedback);
        return;
      }
    } catch (_) {
      info.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
    }
  }

  const m = bootstrap.Modal.getInstance(document.getElementById('feedbackModal'));
  if (!m) new bootstrap.Modal(document.getElementById('feedbackModal')).show();
  else m.show();
}

async function openEditFeedbackModal(requestId, title, report) {
  requestId = String(requestId || '').trim();
  _fbMode = 'edit';
  _fbRequestId = requestId;
  document.getElementById('feedbackRequestId').value = requestId;
  const modalEl = document.getElementById('feedbackModal');
  if (modalEl) modalEl.dataset.ticketId = requestId;

  resetFeedbackForm();

  if (!report) {
    try {
      const { data } = await apiRequest(`/tickets/${encodeURIComponent(requestId)}/technician-feedback`);
      report = data;
    } catch (_) { report = null; }
  }
  if (!report) {
    showToast('Could not load the report to edit.', 'warning');
    return;
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('fbDiagnosis', report.diagnosis);
  set('fbWorkPerformed', report.workPerformed);
  set('fbPartsUsed', report.partsUsed);
  set('fbResolution', report.resolution);
  set('fbStatus', report.status || 'Fixed');
  set('fbReasonNotFixed', report.reasonNotFixed);
  set('fbRecommendation', report.recommendation);
  set('fbTechnicianNotes', report.technicianNotes);
  updateFeedbackReasonVisibility();

  const label = document.getElementById('feedbackModalLabel');
  if (label) label.textContent = `Edit Maintenance Report: ${title || `#${requestId}`}`;

  const m = bootstrap.Modal.getInstance(document.getElementById('feedbackModal'));
  if (!m) new bootstrap.Modal(document.getElementById('feedbackModal')).show();
  else m.show();
}

async function submitFeedback() {
  const id = (document.getElementById('feedbackRequestId').value || '').trim();
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) {
    showAlert('feedbackAlert', 'Invalid or missing request ID. Please reopen the task.', 'warning');
    return;
  }

  const body = {
    diagnosis:       document.getElementById('fbDiagnosis').value.trim(),
    workPerformed:   document.getElementById('fbWorkPerformed').value.trim(),
    partsUsed:       document.getElementById('fbPartsUsed').value.trim() || null,
    status:          document.getElementById('fbStatus').value,
    resolution:      document.getElementById('fbResolution').value.trim(),
    reasonNotFixed:  document.getElementById('fbReasonNotFixed').value.trim() || null,
    recommendation:  document.getElementById('fbRecommendation').value.trim() || null,
    technicianNotes: document.getElementById('fbTechnicianNotes').value.trim() || null,
    technicianConfirmed: document.getElementById('fbConfirmed').checked,
  };

  if (!body.diagnosis)    return showAlert('feedbackAlert', 'Diagnosis / identified problem is required.', 'warning');
  if (!body.workPerformed) return showAlert('feedbackAlert', 'Work performed is required.', 'warning');
  if (!body.resolution)   return showAlert('feedbackAlert', 'Resolution summary is required.', 'warning');
  if (body.status === 'Not Fixed' && !body.reasonNotFixed) {
    return showAlert('feedbackAlert', 'Please provide a reason why the issue is not fixed.', 'warning');
  }
  if (!body.technicianConfirmed) {
    return showAlert('feedbackAlert', 'Please confirm that this report accurately reflects the work performed.', 'warning');
  }

  setLoading('saveFeedbackBtn', 'saveFeedbackSpinner', true);
  try {
    const method = _fbMode === 'edit' ? 'PUT' : 'POST';
    // `id` is the raw MongoDB Ticket _id read from the hidden input. encode &
    // re-validate so a malformed "#.." / display value can never reach the API.
    const ticketId = (document.getElementById('feedbackRequestId').value || '').trim();
    if (!/^[0-9a-f]{24}$/i.test(ticketId)) {
      throw new Error('Invalid or missing ticket ID. Please reopen the report and try again.');
    }
    await apiRequest(`/tickets/${encodeURIComponent(ticketId)}/technician-feedback`, { method, body });
    showToast(_fbMode === 'edit' ? 'Maintenance report updated.' : 'Maintenance report submitted.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('feedbackModal'))?.hide();
    _fbMode = 'add';
    _fbRequestId = null;

    // Refresh whichever page is active
    if (window.location.pathname.includes('technician/dashboard')) {
      await loadDashboardTasks();
    } else {
      const listEl = document.getElementById('assignedRequestsList');
      const fbListEl = document.getElementById('techFeedbackList');
      const newData = await apiRequest('/technicians/my/assignments');
      if (listEl) renderAssignedCards(newData.data);
      if (fbListEl) renderTechFeedbackCards(newData.data);
    }
  } catch (err) {
    showAlert('feedbackAlert', err.message, 'danger');
  } finally {
    setLoading('saveFeedbackBtn', 'saveFeedbackSpinner', false);
  }
}

async function viewFeedbackReport(requestId) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID.', 'danger');
    return;
  }

  const body = document.getElementById('viewReportBody');
  if (body) body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;
  const modalEl = document.getElementById('viewReportModal');
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();

  let title = '';
  try {
    const { data: r } = await apiRequest(`/tickets/${encodeURIComponent(requestId)}`);
    title = r.title || r.ticketId || requestId;
  } catch (_) {}

  try {
    const { data: report } = await apiRequest(`/tickets/${encodeURIComponent(requestId)}/technician-feedback`);
    if (body) body.innerHTML = renderReportView(report, title, requestId);
    const editBtn = document.getElementById('editReportBtn');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('viewReportModal'))?.hide();
        setTimeout(() => openEditFeedbackModal(requestId, title), 200);
      });
    }
  } catch (err) {
    if (body) body.innerHTML = `<div class="alert alert-danger mb-0">${escHtml(err.message)}</div>`;
  }
}

function renderReportView(report, title, requestId) {
  const statusBadgeHtml = report.status === 'Fixed'
    ? '<span class="badge bg-success">Fixed</span>'
    : report.status === 'Not Fixed'
      ? '<span class="badge bg-danger">Not Fixed</span>'
      : '<span class="badge bg-warning text-dark">In Progress</span>';

  const row = (label, value, isBlock = false) => `
    <div class="mb-3">
      <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
      <div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${value ? escHtml(value) : '<span class="text-muted">—</span>'}</div>
    </div>`;

  return `
    <h6 class="fw-bold mb-1">${escHtml(title || `Request #${requestId}`)}</h6>
    <div class="d-flex gap-2 align-items-center mb-3">${statusBadgeHtml}
      <span class="text-muted small">Submitted ${report.submittedAt ? formatDateTime(report.submittedAt) : '—'}</span>
      ${report.completionDate ? `<span class="text-muted small">· Completed ${formatDateTime(report.completionDate)}</span>` : ''}
    </div>
    ${row('Diagnosis / Identified Problem', report.diagnosis)}
    ${row('Work Performed', report.workPerformed)}
    ${row('Parts / Materials Used', report.partsUsed)}
    ${row('Resolution Summary', report.resolution)}
    ${report.status === 'Not Fixed' ? row('Reason Not Fixed', report.reasonNotFixed) : ''}
    ${row('Recommendation', report.recommendation)}
    ${row('Technician Notes (internal)', report.technicianNotes)}
    <div class="d-flex justify-content-end border-top pt-3">
      <button type="button" class="btn btn-outline-primary btn-sm" id="editReportBtn">
        <i class="bi bi-pencil me-1"></i>Edit Report
      </button>
    </div>`;
}


/* ── Advance a ticket through the real backend transition chain.
   Reuses the existing PATCH /tickets/:id/status endpoint one valid step at a
   time, so it NEVER performs an invalid single jump (e.g. assigned → in_progress).
   The backend's own workflow validation is preserved for every step. */
const _TICKET_STATUS_CHAIN = ['submitted', 'under_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed'];

async function advanceTicketStatus(requestId, fromStatus, toStatus) {
  const fromIdx = _TICKET_STATUS_CHAIN.indexOf(fromStatus);
  const toIdx   = _TICKET_STATUS_CHAIN.indexOf(toStatus);
  if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) return;
  // Step through every intermediate status so each PATCH is a valid transition.
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    const step = _TICKET_STATUS_CHAIN[i];
    await apiRequest(`/tickets/${requestId}/status`, { method: 'PATCH', body: { status: step } });
  }
}

async function initMaintenanceLog() {
  if (!requireRole('Technician')) return;
  try {
    const { data } = await apiRequest('/technicians/my/assignments');
    const active   = data.filter(r => !['resolved', 'closed'].includes(r.status));

    const sel    = document.getElementById('requestSelect');
    const selFil = document.getElementById('activityRequestFilter');

    if (sel) {
      sel.innerHTML = `<option value="">-- Select Active Request --</option>` +
        active.map(r => `<option value="${r.ticket_id}">${escHtml(r.ticketId||r.ticket_id)} — ${escHtml(r.title||'Ticket '+r.ticketId)}</option>`).join('');
    }
    if (selFil) {
      selFil.innerHTML = `<option value="">All Requests</option>` +
        data.map(r => `<option value="${r.ticket_id}">${escHtml(r.ticketId||r.ticket_id)} — ${escHtml(r.title||'Ticket '+r.ticketId)}</option>`).join('');
    }
  } catch (err) { showToast(err.message, 'danger'); }

  await loadActivityTimeline();

  document.getElementById('activityRequestFilter')?.addEventListener('change', loadActivityTimeline);

  document.getElementById('maintenanceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.target.checkValidity()) { e.target.classList.add('was-validated'); return; }

    const requestId = document.getElementById('requestSelect').value;
    const status    = document.getElementById('activityStatus').value;
    const action    = document.getElementById('actionTaken').value.trim();
    const parts     = document.getElementById('partsUsed').value.trim();
    const notes     = document.getElementById('techNotes').value.trim();

    if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
      showAlert('maintenanceAlert', 'Please select a valid request.', 'warning');
      return;
    }

    setLoading('logSubmitBtn', 'logSpinner', true);
    try {
      // Read the ticket's REAL current status — never assume the workflow step.
      const { data: ticket } = await apiRequest(`/tickets/${requestId}`);
      const current = ticket.status;

      // Resolved / closed tickets reject new maintenance activity (per the
      // backend workflow: resolved → closed only, no new activity).
      if (current === 'closed') {
        showAlert('maintenanceAlert', 'This ticket is closed. No new activity can be logged.', 'warning');
        return;
      }
      if (current === 'resolved') {
        showAlert('maintenanceAlert', 'This ticket is already resolved. No new activity can be logged.', 'warning');
        return;
      }

      // Walk the real transition chain to the selected target status. For an
      // "assigned" ticket this performs assigned → accepted → in_progress
      // through the existing validated updateStatus endpoint (never a single
      // invalid assigned → in_progress jump). For an already "in_progress"
      // ticket selecting in_progress this performs no status change at all.
      await advanceTicketStatus(requestId, current, status);

      await apiRequest('/maintenance', {
        method: 'POST',
        body: { request_id: requestId, action_taken: action, parts_used: parts||null, notes: notes||null, status: ticketStatusToMaintenance(status) },
      });
      showToast('Activity logged successfully!', 'success');
      e.target.reset();
      e.target.classList.remove('was-validated');
      await loadActivityTimeline();
    } catch (err) {
      showAlert('maintenanceAlert', err.message, 'danger');
    } finally {
      setLoading('logSubmitBtn', 'logSpinner', false);
    }
  });
}

async function loadActivityTimeline() {
  const container  = document.getElementById('activityTimeline');
  const filterVal  = document.getElementById('activityRequestFilter')?.value || '';
  if (!container) return;
  container.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;

  try {
    const { data } = await apiRequest('/maintenance/my');
    const filtered = filterVal ? data.filter(a => String(a.ticket_id) === filterVal) : data;

    if (!filtered || !filtered.length) {
      container.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-journal-x fs-2 d-block mb-2 opacity-50"></i><small>No activity yet.</small></div>`;
      return;
    }

    container.innerHTML = `<div class="timeline">` +
      filtered.map(a => `
        <div class="timeline-item mb-3 pb-3 border-bottom">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <span class="fw-semibold small">${escHtml(a.ticketId||`Ticket ${a.ticket_id}`)}</span>
            ${statusBadge(a.status)}
          </div>
          <p class="text-muted small mb-1">${escHtml(a.action_taken)}</p>
          ${a.parts_used ? `<div class="small text-muted"><i class="bi bi-box me-1"></i>${escHtml(a.parts_used)}</div>` : ''}
          ${a.notes ? `<div class="small text-muted fst-italic"><i class="bi bi-chat-left-text me-1"></i>${escHtml(a.notes)}</div>` : ''}
          <div class="text-muted" style="font-size:.72rem;">${formatDateTime(a.created_at)}</div>
        </div>`).join('') + `</div>`;
  } catch (err) {
    container.innerHTML = `<p class="text-muted small text-center">Activity log unavailable. ${escHtml(err.message||'')}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadActivityTimeline()">Retry</button></p>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   TECHNICIAN HISTORY PAGE  (Task #4 — complete)
   ═══════════════════════════════════════════════════════════ */
let _historyAll = [];

async function initTechHistory() {
  if (!requireRole('Technician')) return;
  try {
    const [assignRes, maintRes] = await Promise.all([
      apiRequest('/technicians/my/assignments'),
      apiRequest('/maintenance/my'),
    ]);

    const completed = assignRes.data.filter(r => ['resolved', 'closed'].includes(r.status));
    _historyAll = completed;

    // Build maintenance lookup: request_id → latest record
    const maintMap = {};
    (maintRes.data || []).forEach(m => { maintMap[String(m.ticket_id)] = m; });

    // Stats
    setText('totalResolved', completed.length);
    setText('thisMonth', completed.filter(r => {
      const d = new Date(r.assigned_at), n = new Date();
      return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
    }).length);

    // Avg resolution time — diff between assignment and latest maintenance record
    const times = completed
      .map(r => {
        const m = maintMap[String(r.ticket_id)];
        if (!m || !r.assigned_at || !m.created_at) return null;
        return (new Date(m.created_at) - new Date(r.assigned_at)) / 3600000;
      })
      .filter(v => v !== null && v >= 0);
    const avgHours = times.length ? Math.round(times.reduce((a,b) => a+b, 0) / times.length) : null;
    setText('avgResolutionTime', avgHours !== null ? `${avgHours}h` : '—');

    // Average rating — placeholder (feedback endpoint not yet available)
    setText('avgRating', '—');

    renderHistoryTable(completed, maintMap);
  } catch (err) {
    ['totalResolved','thisMonth','avgRating','avgResolutionTime'].forEach(id => setText(id,'—'));
    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
        Failed to load history. ${escHtml(err.message||'')}
        <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="initTechHistory()">Retry</button>
      </td></tr>`;
    }
  }

  // Date filter
  document.getElementById('filterBtn')?.addEventListener('click', () => {
    const from = document.getElementById('dateFrom')?.value;
    const to   = document.getElementById('dateTo')?.value;
    const filtered = _historyAll.filter(r => {
      const d = new Date(r.assigned_at);
      return (!from || d >= new Date(from)) && (!to || d <= new Date(to + 'T23:59:59'));
    });
    renderHistoryTable(filtered, {});
  });

  // Export
  document.getElementById('exportBtn')?.addEventListener('click', exportHistoryCSV);
}

function renderHistoryTable(completed, maintMap) {
  maintMap = maintMap || {};
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  if (!completed.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-5">
      <i class="bi bi-inbox fs-2 text-muted d-block mb-2"></i>
      <span class="text-muted">No completed tasks found.</span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = completed.map(r => {
    const m            = maintMap[String(r.ticket_id)];
    const completedAt  = m?.created_at ? formatDate(m.created_at) : '—';
    return `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.ticket_id)}</strong></td>
        <td>${escHtml(r.title||'—')}</td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.equipmentType||'—')}</span></td>
        <td>${escHtml(r.requester_name||'—')}</td>
        <td>${completedAt}</td>
        <td><span class="text-muted">—</span></td>
        <td>
          <button class="btn btn-sm btn-outline-secondary" title="View details"
                  onclick="viewHistoryDetail(${JSON.stringify(r.ticket_id)}, this)">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function viewHistoryDetail(requestId, btn) {
  // Toggle inline detail row
  const existingRow = document.getElementById(`detail-row-${requestId}`);
  if (existingRow) { existingRow.remove(); return; }

  const tr = btn.closest('tr');
  const colCount = tr.querySelectorAll('td').length;
  const detailRow = document.createElement('tr');
  detailRow.id = `detail-row-${requestId}`;
  detailRow.innerHTML = `<td colspan="${colCount}" class="bg-light p-0">
    <div id="detail-content-${requestId}" class="p-3">
      <div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary"></div></div>
    </div>
  </td>`;
  tr.insertAdjacentElement('afterend', detailRow);

  try {
    const [reqRes, maintRes] = await Promise.all([
      apiRequest(`/tickets/${requestId}`),
      apiRequest('/maintenance/my'),
    ]);
    const r    = reqRes.data;
    const logs = (maintRes.data || []).filter(m => String(m.ticket_id) === String(requestId));

    document.getElementById(`detail-content-${requestId}`).innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="small text-muted fw-semibold mb-1">Request Details</div>
          <div class="small"><strong>Description:</strong> ${escHtml(r.problemDescription||'—')}</div>
          <div class="small mt-1"><strong>Equipment:</strong> ${escHtml(r.equipmentType||'—')}</div>
          ${r.asset_tag ? `<div class="small mt-1"><strong>ICT Asset:</strong> ${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}</div>` : ''}
          <div class="small mt-1"><strong>Department:</strong> ${escHtml(r.department||'—')}</div>
        </div>
        <div class="col-md-6">
          <div class="small text-muted fw-semibold mb-1">Maintenance Logs</div>
          ${logs.length ? logs.map(l => `
            <div class="small border-start border-2 border-success ps-2 mb-2">
              <div class="fw-semibold">${escHtml(l.action_taken)}</div>
              ${l.parts_used ? `<div class="text-muted"><i class="bi bi-box me-1"></i>${escHtml(l.parts_used)}</div>` : ''}
              ${l.notes      ? `<div class="text-muted fst-italic">${escHtml(l.notes)}</div>` : ''}
              <div class="text-muted" style="font-size:.7rem;">${formatDateTime(l.created_at)}</div>
            </div>`).join('') : '<span class="text-muted small">No logs recorded.</span>'}
        </div>
      </div>`;
  } catch (_) {
    document.getElementById(`detail-content-${requestId}`).innerHTML =
      `<p class="text-muted small mb-0">Could not load details.</p>`;
  }
}

function exportHistoryCSV() {
  if (!_historyAll.length) { showToast('No data to export.', 'warning'); return; }

  const headers = ['ID', 'Title', 'Equipment Type', 'Requester', 'Department', 'Assigned Date', 'Status'];
  const rows = _historyAll.map(r => [
    r.ticketId,
    `"${(r.title||'').replace(/"/g,'""')}"`,
    `"${(r.equipmentType||'').replace(/"/g,'""')}"`,
    `"${(r.requester_name||'').replace(/"/g,'""')}"`,
    `"${(r.department||'').replace(/"/g,'""')}"`,
    formatDate(r.assigned_at),
    r.status,
  ]);

  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `maintenance-history-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!', 'success');
}

/* ═══════════════════════════════════════════════════════════
   ADMIN TECHNICIANS PAGE  (Tasks #1, #2, #3, #6)
   ═══════════════════════════════════════════════════════════ */
let _techAll = [];
let _editUserId = null;   // User._id for the technician being edited (separate from Technician._id)

/* ── Populate the "Select Request" dropdown with assignable requests ──
   Only requests that are still awaiting assignment can be picked.
   Calls GET /api/tickets (returns Ticket._id as `id`) and filters to the
   pre-assignment statuses so the backend "already assigned" checks hold. */
async function populateAssignRequestSelect() {
  const sel = document.getElementById('assignRequest');
  if (!sel) return;
  let options = `<option value="">-- Select Request --</option>`;

  // Remember the previously selected value across refreshes
  const prev = sel.value;

  try {
    const { data: reqs } = await apiRequest('/tickets');
    const pending = reqs.filter(r => ['submitted', 'under_review'].includes(r.status));
    if (!pending.length) {
      options += `<option value="" disabled>No pending requests to assign</option>`;
    } else {
      options += pending.map(r => {
        const id = String(r.id || r._id || '');
        if (!id || !/^[0-9a-f]{24}$/i.test(id)) return '';
        return `<option value="${id}">${escHtml(r.ticketId || id)} — ${escHtml((r.problemDescription||'').substring(0,60))}</option>`;
      }).join('');
    }
  } catch (_) {
    options += `<option value="" disabled>Could not load requests</option>`;
  }

  sel.innerHTML = options;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function initAdminTechnicians() {
  if (!requireRole('ICT Admin')) return;
  await loadAdminTechnicians();

  // Search / filter
  document.getElementById('techSearchInput')?.addEventListener('input', filterTechCards);
  document.getElementById('techAvailFilter')?.addEventListener('change', filterTechCards);

  // Assign request modal dropdown
  await populateAssignRequestSelect();

  document.getElementById('confirmAssignBtn')?.addEventListener('click', async () => {
    const techId    = document.getElementById('assignTechId').value;
    const requestId = document.getElementById('assignRequest').value;
    const notes     = document.getElementById('assignNotes')?.value || '';

    if (!techId) { showAlert('assignAlert', 'Please select a technician first.', 'warning'); return; }
    if (!requestId) {
      const noReqs = [...(document.getElementById('assignRequest')?.options||[])].some(o => o.disabled);
      showAlert('assignAlert', noReqs ? 'There are no pending requests available to assign.' : 'Please select a request.', 'warning');
      return;
    }
    if (!/^[0-9a-f]{24}$/i.test(techId) || !/^[0-9a-f]{24}$/i.test(requestId)) {
      showAlert('assignAlert', 'Invalid technician or request ID.', 'danger');
      return;
    }

    setLoading('confirmAssignBtn', 'assignSpinner', true);
    try {
      await apiRequest('/assignments', { method: 'POST', body: { ticket_id: requestId, technician_id: techId, notes } });
      showToast('Technician assigned successfully.', 'success');
      bootstrap.Modal.getInstance(document.getElementById('assignModal'))?.hide();
      await loadAdminTechnicians();
      await populateAssignRequestSelect();
    } catch (err) {
      console.error('Assign technician failed:', err);
      showAlert('assignAlert', err.message || 'Assignment failed.', 'danger');
    } finally {
      setLoading('confirmAssignBtn', 'assignSpinner', false);
    }
  });

  // Add technician form
  document.getElementById('saveTechBtn')?.addEventListener('click', saveTechnician);

  // Delete confirmation
  document.getElementById('confirmDeleteBtn')?.addEventListener('click', deleteTechnician);
}

async function loadAdminTechnicians() {
  try {
    // Fetch technicians and their workloads in parallel
    const [techRes, reqRes] = await Promise.all([
      apiRequest('/technicians'),
      apiRequest('/tickets'),
    ]);

    _techAll = techRes.data;

    // Build workload map: technician name → active request count
    // (using technician name match since assignments endpoint is technician-scoped)
    const workloadMap = {};
    // We'll use the /reports/technician-performance to get workload
    try {
      const perfRes = await apiRequest('/reports/technician-performance');
      perfRes.data.forEach(p => {
        workloadMap[p.name] = { assigned: p.assigned, resolved: p.resolved };
      });
    } catch (_) {}

    // Summary stats
    const available = _techAll.filter(t => t.available).length;
    setText('totalTechs',     _techAll.length);
    setText('availableTechs', available);
    setText('busyTechs',      _techAll.length - available);

    // Task #1 fix: real avg tasks per technician
    const totalActive = Object.values(workloadMap).reduce((sum, p) => sum + (p.assigned - p.resolved), 0);
    const avgTasks = _techAll.length ? Math.round(totalActive / _techAll.length * 10) / 10 : 0;
    setText('avgTasks', avgTasks);

    renderTechnicianCards(_techAll, workloadMap);
    filterTechCards();
  } catch (err) {
    ['totalTechs','availableTechs','busyTechs','avgTasks'].forEach(id => setText(id,'—'));
    const grid = document.getElementById('techniciansGrid');
    if (grid) {
      grid.innerHTML = `<div class="col-12 text-center text-muted py-5">
        <i class="bi bi-exclamation-triangle fs-1 text-danger d-block mb-2"></i>
        <p>Failed to load technicians. ${escHtml(err.message||'')}</p>
        <button type="button" class="btn btn-outline-primary" onclick="loadAdminTechnicians()">Retry</button>
      </div>`;
    }
  }
}

function filterTechCards() {
  const q    = (document.getElementById('techSearchInput')?.value || '').toLowerCase();
  const avail = document.getElementById('techAvailFilter')?.value || '';
  const filtered = _techAll.filter(t =>
    (!q    || (t.fullName||'').toLowerCase().includes(q) || (t.specialization||'').toLowerCase().includes(q) || (t.email||'').toLowerCase().includes(q)) &&
    (!avail || (avail === 'available' ? t.available : !t.available))
  );
  renderTechnicianCards(filtered, {});
  const count = document.getElementById('techCount');
  if (count) count.textContent = `${filtered.length} technician${filtered.length !== 1 ? 's' : ''}`;
}

function renderTechnicianCards(technicians, workloadMap) {
  const grid = document.getElementById('techniciansGrid');
  if (!grid) return;

  if (!technicians.length) {
    grid.innerHTML = `<div class="col-12 text-center py-5">
      <i class="bi bi-wrench fs-2 text-muted d-block mb-2"></i>
      <p class="text-muted">No technicians found.</p>
    </div>`;
    return;
  }

  grid.innerHTML = technicians.map(t => {
    const wl     = workloadMap[t.fullName] || {};
    const active = (wl.assigned || 0) - (wl.resolved || 0);
    const rate   = wl.assigned ? Math.round((wl.resolved / wl.assigned) * 100) : 0;
    const barC   = rate >= 80 ? '#198754' : rate >= 50 ? '#ffc107' : '#dc3545';

    return `
    <div class="col-md-6 col-lg-4 tech-card">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body p-3">
          <div class="d-flex align-items-center gap-3 mb-3">
            <div class="rounded-circle bg-dark d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                 style="width:46px;height:46px;font-size:1.15rem;">
              ${escHtml((t.fullName||'T').charAt(0).toUpperCase())}
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${escHtml(t.fullName||'—')}</div>
              <div class="text-muted small">${escHtml(t.specialization||'General')}</div>
            </div>
            <span class="badge ${t.available ? 'bg-success' : 'bg-secondary'} flex-shrink-0">
              ${t.available ? 'Available' : 'Busy'}
            </span>
          </div>

          <div class="small text-muted mb-1"><i class="bi bi-envelope me-1"></i>${escHtml(t.email||'—')}</div>
          <div class="small text-muted mb-2"><i class="bi bi-telephone me-1"></i>${escHtml(t.phone||'—')}</div>

          <!-- Task #6: workload bar -->
          ${wl.assigned ? `
          <div class="mb-2">
            <div class="d-flex justify-content-between mb-1">
              <span class="small text-muted">Workload</span>
              <span class="small fw-semibold">${active} active · ${wl.resolved||0} resolved</span>
            </div>
            <div class="rounded-pill overflow-hidden" style="height:6px;background:#e9ecef;">
              <div class="rounded-pill" style="height:100%;width:${rate}%;background:${barC};transition:width .8s ease;"></div>
            </div>
          </div>` : `<div class="small text-muted mb-2"><i class="bi bi-inbox me-1"></i>No tasks assigned yet</div>`}
        </div>
        <div class="card-footer bg-transparent border-top-0 px-3 pb-3 d-flex gap-2">
          <button class="btn btn-outline-primary btn-sm flex-grow-1"
                  onclick="openAssignModal('${t.id}')"
                  data-bs-toggle="modal" data-bs-target="#assignModal">
            <i class="bi bi-plus-circle me-1"></i>Assign
          </button>
          <button class="btn btn-outline-secondary btn-sm"
                  onclick="openEditTechModal(${jsAttr(t)})"
                  data-bs-toggle="modal" data-bs-target="#techModal"
                  title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-outline-danger btn-sm"
                  onclick="openDeleteModal(${jsAttr(t.id)}, ${jsAttr(t.fullName)})"
                  data-bs-toggle="modal" data-bs-target="#deleteTechModal"
                  title="Deactivate">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openAssignModal(techId) {
  document.getElementById('assignTechId').value = techId;
  const alert = document.getElementById('assignAlert');
  if (alert) alert.classList.add('d-none');
  document.getElementById('assignNotes').value = '';
}

/* ── Add / Edit Technician ──────────────────────────────────── */
function openAddTechModal() {
  document.getElementById('techModalTitle').textContent = 'Add Technician';
  document.getElementById('techForm').reset();
  document.getElementById('techId').value        = '';
  _editUserId                                   = '';
  document.getElementById('techPassword').required = true;
  document.getElementById('techPasswordHint').classList.remove('d-none');
  const alert = document.getElementById('techAlert');
  if (alert) alert.classList.add('d-none');
}

function openEditTechModal(tech) {
  document.getElementById('techModalTitle').textContent = 'Edit Technician';
  // `tech.id` / `tech._id` is the Technician._id (separate collection).
  // `tech.user_id` is the linked User._id — used for the /users update.
  document.getElementById('techId').value        = tech.id || tech._id;
  _editUserId                                   = String(tech.user_id || tech.id || tech._id || '');
  document.getElementById('techName').value      = tech.fullName || '';
  document.getElementById('techEmail').value     = tech.email || '';
  document.getElementById('techPhone').value     = tech.phone || '';
  document.getElementById('techSpec').value      = tech.specialization || '';
  document.getElementById('techPassword').value  = '';
  document.getElementById('techPassword').required = false;
  document.getElementById('techPasswordHint').classList.add('d-none');
  const alert = document.getElementById('techAlert');
  if (alert) alert.classList.add('d-none');
}

async function saveTechnician() {
  const id       = document.getElementById('techId').value;   // Technician._id (may be empty when adding)
  const userId   = _editUserId;                               // User._id for existing technicians
  const name     = document.getElementById('techName').value.trim();
  const email    = document.getElementById('techEmail').value.trim();
  const phone    = document.getElementById('techPhone').value.trim();
  const spec     = document.getElementById('techSpec').value.trim();
  const password = document.getElementById('techPassword').value;

  if (!name || !email) { showAlert('techAlert', 'Name and email are required.', 'warning'); return; }
  if (!id && !password) { showAlert('techAlert', 'Password is required for new technician.', 'warning'); return; }

  setLoading('saveTechBtn', 'saveTechSpinner', true);
  try {
    if (!id) {
      // Create via admin endpoint (creates user + technician profile atomically)
      await apiRequest('/users', {
        method: 'POST',
        body: { fullName: name, email, password, role: 'Technician', phone, department: 'ICT', specialization: spec },
      });
      showToast('Technician added!', 'success');
    } else {
      if (!userId || !/^[0-9a-f]{24}$/i.test(userId)) {
        throw new Error('Could not determine the technician\'s user account. Reopen Edit and try again.');
      }
      // Update the User record (email/name/phone) using the correct User._id
      await apiRequest(`/users/${userId}`, {
        method: 'PUT',
        body: { fullName: name, email, phone, role: 'Technician' },
      });
      // Update the Technician profile (specialization) using Technician._id
      await apiRequest(`/technicians/${id}`, {
        method: 'PUT',
        body: { specialization: spec },
      });
      showToast('Technician updated!', 'success');
    }

    bootstrap.Modal.getInstance(document.getElementById('techModal'))?.hide();
    _editUserId = '';
    await loadAdminTechnicians();
  } catch (err) {
    console.error('Save technician failed:', err);
    showAlert('techAlert', err.message || 'Could not save technician.', 'danger');
  } finally {
    setLoading('saveTechBtn', 'saveTechSpinner', false);
  }
}

/* ── Delete (deactivate) Technician ────────────────────────── */
let _deleteTechId = null;    // Technician._id
let _deleteUserId = null;    // linked User._id

function openDeleteModal(techId, techName) {
  _deleteTechId = techId;
  // Resolve the linked User._id now (the card only passes Technician._id)
  const tech   = (_techAll || []).find(t => String(t.id || t._id) === String(techId));
  _deleteUserId = (tech && String(tech.user_id)) || '';
  const nameEl = document.getElementById('deleteTechName');
  if (nameEl) nameEl.textContent = techName || (tech && tech.fullName) || 'this technician';
}

async function deleteTechnician() {
  if (!_deleteTechId) return;

  if (!_deleteUserId || !/^[0-9a-f]{24}$/i.test(_deleteUserId)) {
    showToast('Could not identify this technician\'s user account. Reopen the confirm dialog and try again.', 'danger');
    return;
  }

  setLoading('confirmDeleteBtn', 'deleteSpinner', true);
  try {
    // Do not silently delete a technician who still has active assigned tasks.
    const { data: assignments } = await apiRequest('/assignments');
    const active = assignments.some(a =>
      ['assigned', 'accepted', 'in_progress'].includes(a.status) &&
      String(a.technician_id) === String(_deleteTechId)
    );
    if (active) {
      showToast('Cannot deactivate this technician: they still have active assigned requests.', 'warning');
      bootstrap.Modal.getInstance(document.getElementById('deleteTechModal'))?.hide();
      _deleteTechId = null; _deleteUserId = '';
      return;
    }

    // Soft-deactivate the linked User account (also disables their login).
    await apiRequest(`/users/${_deleteUserId}`, { method: 'DELETE' });
    showToast('Technician deactivated.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('deleteTechModal'))?.hide();
    await loadAdminTechnicians();
  } catch (err) {
    console.error('Delete technician failed:', err);
    showToast(err.message || 'Could not delete technician.', 'danger');
  } finally {
    setLoading('confirmDeleteBtn', 'deleteSpinner', false);
    _deleteTechId = null; _deleteUserId = '';
  }
}
