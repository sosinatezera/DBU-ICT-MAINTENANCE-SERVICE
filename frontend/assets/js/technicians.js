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

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  const p = window.location.pathname;

  if (p.includes('technician/dashboard'))          initTechDashboard();
  if (p.includes('technician/assigned-requests'))  initAssignedRequests();
  if (p.includes('technician/maintenance'))        initMaintenanceLog();
  if (p.includes('technician/history'))            initTechHistory();
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
  initAvailabilityToggle();
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

  try {
    const { data: techs } = await apiRequest('/technicians');
    const myTech = techs.find(t => t.fullName === user.fullName);
    if (myTech) {
      setText('sidebarSpec', myTech.specialization || 'ICT Support');
      setText('bannerSpec',  myTech.specialization || 'ICT Support');

      // Restore availability toggle from saved tech state
      const toggle = document.getElementById('availabilityToggle');
      if (toggle) {
        toggle.checked = myTech.available !== false;
        updateAvailabilityUI(toggle.checked);
      }
    }
  } catch (_) {}
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
        <td class="pe-3">
          <button class="btn btn-sm btn-warning"
                  onclick="openUpdateModal(${jsAttr(r.ticket_id)}, ${jsAttr(r.title || '')}, ${jsAttr(r.status)})"
                  data-bs-toggle="modal" data-bs-target="#updateTaskModal">
            <i class="bi bi-pencil-fill"></i>
          </button>
        </td>
      </tr>`).join('');

  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${escHtml(err.message)}</td></tr>`;
    showToast(err.message, 'danger');
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
          <div class="fw-semibold small">${escHtml(a.request_title || `Request #${a.request_id}`)}</div>
          <div class="text-muted" style="font-size:.78rem;">${escHtml((a.action_taken||'').substring(0, 60))}${(a.action_taken||'').length > 60 ? '...' : ''}</div>
          <div class="text-muted" style="font-size:.72rem;">${timeAgo(a.created_at)}</div>
        </div>
        <div class="flex-shrink-0">${statusBadge(a.status)}</div>
      </div>`).join('');

  } catch (_) {
    panel.innerHTML = `<p class="text-muted small text-center py-2">Activity unavailable.</p>`;
  }
}

/* ── Availability toggle ────────────────────────────────────── */
function initAvailabilityToggle() {
  const toggle = document.getElementById('availabilityToggle');
  if (!toggle) return;

  toggle.addEventListener('change', async () => {
    updateAvailabilityUI(toggle.checked);
    showToast(`Status set to ${toggle.checked ? 'Available' : 'Unavailable'}`, toggle.checked ? 'success' : 'info');

    // Persist to backend
    try {
      const { data: techs } = await apiRequest('/technicians');
      const user   = Auth.getUser();
      const myTech = techs.find(t => t.fullName === user.fullName);
      if (myTech) {
        await apiRequest(`/technicians/${myTech.id}`, {
          method: 'PUT',
          body: { specialization: myTech.specialization, available: toggle.checked },
        });
      }
    } catch (err) {
      showToast('Could not save availability: ' + err.message, 'warning');
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

/* ── Update Task Modal ──────────────────────────────────────── */
async function openUpdateModal(requestId, title, currentStatus) {
  requestId = String(requestId || '').trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast('Invalid or missing request ID. Reopen the task from the list.', 'danger');
    return;
  }

  document.getElementById('modalRequestId').value = requestId;
  document.getElementById('updateTaskModalLabel').textContent = title ? `Update: ${title}` : `Update Request #${requestId}`;
  document.getElementById('modalStatus').value = currentStatus === 'assigned' ? 'in_progress' :
    currentStatus === 'in_progress' ? 'resolved' : 'resolved';
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
  } catch (err) { showToast(err.message, 'danger'); }

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

  const borderColours = { critical:'#dc3545', high:'#fd7e14', medium:'#0d6efd', low:'#198754' };

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
          <button class="btn btn-warning btn-sm w-100 fw-semibold"
                  onclick="openTaskModal(${jsAttr(r.ticket_id)}, ${jsAttr(r.title || '')}, ${jsAttr(r.status)})"
                  data-bs-toggle="modal" data-bs-target="#taskModal">
            <i class="bi bi-pencil-fill me-1"></i>Update Task
          </button>
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
  document.getElementById('newStatus').value   = currentStatus;
  document.getElementById('actionTaken').value = '';
  document.getElementById('partsUsed').value   = '';
  document.getElementById('techNotes').value   = '';
  const alert = document.getElementById('taskUpdateAlert');
  if (alert) alert.classList.add('d-none');
  loadTaskInfoSection(requestId, 'taskInfoSection');
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
        <div class="col-12"><span class="text-muted small d-block">Description</span>
          <div class="small p-2 bg-light rounded" style="max-height:70px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
        </div>
      </div>`;
  } catch (_) {
    section.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   MAINTENANCE LOG PAGE
   ═══════════════════════════════════════════════════════════ */
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
      await apiRequest(`/tickets/${requestId}/status`, { method: 'PATCH', body: { status } });
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
  } catch (_) {
    container.innerHTML = `<p class="text-muted small text-center">Activity log unavailable.</p>`;
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
  } catch (err) { showToast(err.message, 'danger'); }

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

async function initAdminTechnicians() {
  if (!requireRole('ICT Admin')) return;
  await loadAdminTechnicians();

  // Search / filter
  document.getElementById('techSearchInput')?.addEventListener('input', filterTechCards);
  document.getElementById('techAvailFilter')?.addEventListener('change', filterTechCards);

  // Assign request modal
  try {
    const { data: reqs } = await apiRequest('/tickets');
    const pending = reqs.filter(r => ['submitted', 'under_review'].includes(r.status));
    const sel = document.getElementById('assignRequest');
    if (sel) {
      sel.innerHTML = `<option value="">-- Select Request --</option>` +
        pending.map(r => `<option value="${r.id}">${escHtml(r.ticketId || r.id)} — ${escHtml(r.problemDescription||'').substring(0,60)}</option>`).join('');
    }
  } catch (_) {}

  document.getElementById('confirmAssignBtn')?.addEventListener('click', async () => {
    const techId    = document.getElementById('assignTechId').value;
    const requestId = document.getElementById('assignRequest').value;
    const notes     = document.getElementById('assignNotes')?.value || '';
    if (!requestId) { showAlert('assignAlert', 'Please select a request.', 'warning'); return; }

    setLoading('confirmAssignBtn', 'assignSpinner', true);
    try {
      await apiRequest('/assignments', { method: 'POST', body: { ticket_id: requestId, technician_id: techId, notes } });
      showToast('Technician assigned!', 'success');
      bootstrap.Modal.getInstance(document.getElementById('assignModal'))?.hide();
      await loadAdminTechnicians();
    } catch (err) {
      showAlert('assignAlert', err.message, 'danger');
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
  } catch (err) { showToast(err.message, 'danger'); }
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
    const wl     = workloadMap[t.name] || {};
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
                  onclick="openDeleteModal('${t.id}', '${escHtml(t.fullName)}')"
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
  document.getElementById('techPassword').required = true;
  document.getElementById('techPasswordHint').classList.remove('d-none');
  const alert = document.getElementById('techAlert');
  if (alert) alert.classList.add('d-none');
}

function openEditTechModal(tech) {
  document.getElementById('techModalTitle').textContent = 'Edit Technician';
  document.getElementById('techId').value             = tech.id || tech._id;
  document.getElementById('techName').value           = tech.fullName || '';
  document.getElementById('techEmail').value          = tech.email || '';
  document.getElementById('techPhone').value          = tech.phone || '';
  document.getElementById('techSpec').value           = tech.specialization || '';
  document.getElementById('techPassword').value       = '';
  document.getElementById('techPassword').required    = false;
  document.getElementById('techPasswordHint').classList.add('d-none');
  const alert = document.getElementById('techAlert');
  if (alert) alert.classList.add('d-none');
}

async function saveTechnician() {
  const id      = document.getElementById('techId').value;
  const name    = document.getElementById('techName').value.trim();
  const email   = document.getElementById('techEmail').value.trim();
  const phone   = document.getElementById('techPhone').value.trim();
  const spec    = document.getElementById('techSpec').value.trim();
  const password = document.getElementById('techPassword').value;

  if (!name || !email) { showAlert('techAlert', 'Name and email are required.', 'warning'); return; }
  if (!id && !password) { showAlert('techAlert', 'Password is required for new technician.', 'warning'); return; }

  setLoading('saveTechBtn', 'saveTechSpinner', true);
  try {
    if (!id) {
      // Create via admin endpoint (creates user + technician profile)
      await apiRequest('/users', {
        method: 'POST',
        body: { fullName: name, email, password, role: 'Technician', phone, department: 'ICT', specialization: spec },
      });
      showToast('Technician added!', 'success');
    } else {
      // Update user info
      await apiRequest(`/users/${id}`, {
        method: 'PUT',
        body: { fullName: name, email, phone, role: 'Technician' },
      });
      // Update technician record (find by matching tech)
      const myTech = _techAll.find(t => String(t.user_id || t.id) === String(id) || String(t.id) === String(id));
      if (myTech) {
        await apiRequest(`/technicians/${myTech.id}`, {
          method: 'PUT',
          body: { specialization: spec, available: myTech.available },
        });
      }
      showToast('Technician updated!', 'success');
    }

    bootstrap.Modal.getInstance(document.getElementById('techModal'))?.hide();
    await loadAdminTechnicians();
  } catch (err) {
    showAlert('techAlert', err.message, 'danger');
  } finally {
    setLoading('saveTechBtn', 'saveTechSpinner', false);
  }
}

/* ── Delete (deactivate) Technician ────────────────────────── */
let _deleteTechId = null;

function openDeleteModal(techId, techName) {
  _deleteTechId = techId;
  const nameEl = document.getElementById('deleteTechName');
  if (nameEl) nameEl.textContent = techName;
}

async function deleteTechnician() {
  if (!_deleteTechId) return;
  setLoading('confirmDeleteBtn', 'deleteSpinner', true);
  try {
    // Find the user_id for this technician
    const tech = _techAll.find(t => String(t.id) === String(_deleteTechId));
    const userId = tech?.user_id || tech?.id;
    await apiRequest(`/users/${userId}`, { method: 'DELETE' });
    showToast('Technician deactivated.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('deleteTechModal'))?.hide();
    await loadAdminTechnicians();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    setLoading('confirmDeleteBtn', 'deleteSpinner', false);
    _deleteTechId = null;
  }
}

/* ── Shared ────────────────────────────────────────────────── */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
