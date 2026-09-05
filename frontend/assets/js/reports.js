/* ============================================================
   reports.js  —  Admin / Manager Dashboard & Reports
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  const p = window.location.pathname;
  if (p.includes('admin/dashboard')) await initAdminDashboard();
  if (p.includes('admin/reports'))   await initReports();
});

/* ═══════════════════════════════════════════════════════════
   ADMIN DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function initAdminDashboard() {
  if (!requireRole('ICT Admin')) return;
  document.getElementById('dashErrorBanner')?.remove();
  showSkeletons();

  try {
    /* ── KPI stats ── */
    const { data: s } = await apiRequest('/reports/dashboard');
    animateCount('kpiUsers',       s.total_users);
    animateCount('kpiAssets',      s.total_assets);
    animateCount('kpiPending',     s.pending);
    animateCount('kpiCompleted',   s.completed);
    animateCount('kpiInProgress',  s.in_progress);
    animateCount('kpiTechnicians', s.total_technicians);

    const total = (s.pending||0) + (s.in_progress||0) + (s.completed||0);
    animateCount('kpiTotal',       total);
    animateCount('kpiOverdue',     0);   // placeholder – can extend later

    const pb = document.getElementById('pendingBadge');
    if (pb) {
      pb.textContent = `${s.pending} Pending`;
      pb.className   = `badge ${s.pending > 0 ? 'bg-danger' : 'bg-success'}`;
    }
  } catch (err) {
    ['kpiUsers','kpiAssets','kpiPending','kpiCompleted','kpiInProgress','kpiTechnicians','kpiTotal','kpiOverdue']
      .forEach(id => setText(id,'—'));
    const holder = document.getElementById('kpiUsers')?.closest('.row');
    if (holder) {
      const banner = document.createElement('div');
      banner.id = 'dashErrorBanner';
      banner.className = 'alert alert-danger d-flex justify-content-between align-items-center';
      banner.innerHTML = `<span><strong>Dashboard stats failed to load.</strong> ${escHtml(err.message||err)}</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="initAdminDashboard()">Retry</button>`;
      holder.parentNode.insertBefore(banner, holder);
    } else {
      showToast('Could not load dashboard stats: ' + err.message, 'danger');
    }
  }

  /* ── Recent requests table ── */
  try {
    const { data: reqs } = await apiRequest('/tickets');
    const tbody = document.getElementById('recentRequestsBody');
    if (!tbody) return;

    /* Render the Service Feedback panel regardless of whether the ticket
       list is empty. Previously it was only reached when reqs.length > 0,
       so the Empty / No-requests path (and any failure) left the static
       "Loading..." spinner in place forever. */
    renderServiceFeedbackPanel(reqs);

    if (!reqs.length) {
      tbody.innerHTML = emptyRow(6, 'No requests yet.');
      return;
    }

    tbody.innerHTML = reqs.slice(0, 8).map(recentRequestRow).join('');
  } catch (err) {
    const tbody = document.getElementById('recentRequestsBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
        Failed to load recent requests. ${escHtml(err.message||err)}
        <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button>
      </td></tr>`;
    }
    /* Also clear the Service Feedback panel so its static "Loading..." spinner
       is replaced even when the shared /tickets request fails. */
    const fPanel = document.getElementById('serviceFeedbackPanel');
    if (fPanel) {
      fPanel.innerHTML = `<div class="text-center text-muted py-4">
        <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
        <p class="small mb-0">Feedback unavailable.</p>
      </div>`;
    }
  }

  /* ── Status mini chart ── */
  try {
    const { data: byStatus } = await apiRequest('/reports/requests-by-status');
    renderMiniBars('statusMiniChart', byStatus, 'status', 'total', statusColour);
  } catch (err) {
    const el = document.getElementById('statusMiniChart');
    if (el) el.innerHTML = `<p class="text-muted small text-center py-2">Chart unavailable. ${escHtml(err.message||'')}</p>`;
  }

  /* ── Recent maintenance activity ── */
  try {
    const { data: acts } = await apiRequest('/maintenance/my');
    const panel = document.getElementById('recentActivityDash');
    if (!panel) return;
    if (!acts.length) {
      panel.innerHTML = `<p class="text-muted small text-center py-2"><i class="bi bi-inbox me-1"></i>No recent maintenance activity.</p>`;
      return;
    }
    panel.innerHTML = acts.slice(0,5).map(a => `
        <div class="d-flex gap-2 py-2 border-bottom">
          <span class="badge rounded-pill ${a.status==='resolved'?'bg-success':'bg-primary'} flex-shrink-0 mt-1" style="width:8px;height:8px;padding:0;border-radius:50%!important;"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="small fw-semibold text-truncate">${escHtml(a.ticketId||'TK-'+a.ticket_id)}</div>
            <div class="text-muted" style="font-size:.75rem;">${escHtml((a.action_taken||'').substring(0,50))}…</div>
          </div>
          <small class="text-muted flex-shrink-0">${timeAgo(a.created_at)}</small>
        </div>`).join('');
  } catch (err) {
    const panel = document.getElementById('recentActivityDash');
    if (panel) panel.innerHTML = `<p class="text-muted small text-center py-2">Activity feed unavailable. ${escHtml(err.message||'')}</p>`;
  }

  /* Lightweight auto-refresh so a newly submitted requester ticket appears in
     the dashboard without a full browser reload — single guarded interval. */
  startDashboardAutoRefresh();
}

/* ── Render the "Service Feedback" panel on the Admin dashboard ──
   Shows recent tickets that carry feedback, surfacing requester
   satisfaction, technician performance, resolution quality,
   follow-up required, and overall service quality. */
function renderServiceFeedbackPanel(tickets) {
  const panel = document.getElementById('serviceFeedbackPanel');
  if (!panel) return;

  const items = (tickets || []).filter(r => r.admin_feedback || r.has_requester_feedback || r.has_technician_feedback);
  if (!items.length) {
    panel.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
        <p class="small mb-0">No service feedback yet.</p>
        <a href="admin-feedback.html" class="btn btn-sm btn-outline-primary mt-2">Manage Feedback</a>
      </div>`;
    return;
  }

  panel.innerHTML = items.slice(0, 6).map(r => {
    const af = r.admin_feedback || {};
    const rf = r.requester_feedback || {};
    const stars = rf.overallRating
      ? `<span class="text-warning">${'★'.repeat(rf.overallRating)}</span><span class="text-muted">${'☆'.repeat(5 - rf.overallRating)}</span>`
      : '<span class="text-muted">—</span>';

    const badge = (v) => v ? `<span class="badge ${clr(v)} me-1 mb-1">${escHtml(v)}</span>` : '';
    const followUp = af.followUpRequired
      ? `<span class="badge bg-danger mb-1"><i class="bi bi-arrow-repeat me-1"></i>Follow-up</span>` : '';

    return `
      <div class="border-bottom px-3 py-3">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong class="text-primary small">${escHtml(r.ticketId || r.id)}</strong>
          <span class="ms-auto">${stars}</span>
        </div>
        <div class="d-flex flex-wrap">
          ${badge(af.technicianPerformance)}
          ${badge(af.resolutionQuality)}
          ${af.overallServiceQuality ? `<span class="badge bg-success mb-1">${escHtml(af.overallServiceQuality)}</span>` : ''}
          ${followUp}
        </div>
        ${rf.overallRating && !af.technicianPerformance ? `<div class="small text-muted mt-1">Requester rated ${rf.overallRating}/5</div>` : ''}
      </div>`;
  }).join('') + `
    <div class="text-center p-2">
      <a href="admin-feedback.html" class="btn btn-sm btn-link">View all feedback</a>
    </div>`;

  function clr(v) {
    if (/excellent/i.test(v)) return 'bg-success';
    if (/good/i.test(v)) return 'bg-primary';
    if (/needs improvement|poor|slow|non-compliant/i.test(v)) return 'bg-danger';
    return 'bg-secondary';
  }
}

/* ═══════════════════════════════════════════════════════════
   REPORTS PAGE
   ═══════════════════════════════════════════════════════════ */

// Cache of the most recently loaded report data (for CSV export)
let _reportCache = { summary: null, byStatus: [], byCategory: [], techPerf: [], byDept: [] };
let _reportFilter = { dateFrom: '', dateTo: '', type: 'all' };

async function initReports() {
  await loadReportData();
  document.getElementById('generateReportBtn')?.addEventListener('click', loadReportData);
  document.getElementById('exportReportBtn')?.addEventListener('click', exportReportCSV);
  document.getElementById('printReportBtn')?.addEventListener('click', () => window.print());
}

function currentReportParams() {
  _reportFilter.dateFrom = document.getElementById('reportDateFrom')?.value || '';
  _reportFilter.dateTo   = document.getElementById('reportDateTo')?.value || '';
  _reportFilter.type     = document.getElementById('reportType')?.value || 'all';

  const params = new URLSearchParams();
  if (_reportFilter.dateFrom) params.set('dateFrom', _reportFilter.dateFrom);
  if (_reportFilter.dateTo)   params.set('dateTo',   _reportFilter.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function applyReportTypeFilter() {
  const type = _reportFilter.type;
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };
  show('sectionByStatus',   type === 'all' || type === 'requests');
  show('sectionByCategory', type === 'all' || type === 'requests' || type === 'category');
  show('sectionTechPerf',   type === 'all' || type === 'technician');
  show('sectionByDept',     type === 'all' || type === 'requests' || type === 'department');
}

async function loadReportData() {
  const qs = currentReportParams();
  applyReportTypeFilter();

  /* ── Summary KPIs ── */
  try {
    const { data: s } = await apiRequest(`/reports/dashboard${qs}`);
    const total = (s.pending||0) + (s.in_progress||0) + (s.completed||0);
    animateCount('rptTotal',     total);
    animateCount('rptCompleted', s.completed);
    animateCount('rptPending',   s.pending);
    setText('rptAvgTime', '—');
    _reportCache.summary = { total, completed: s.completed, pending: s.pending };
  } catch (err) {
    _reportCache.summary = null;
    setSectionError('rptTotal', err.message); setSectionError('rptCompleted', err.message);
    setSectionError('rptPending', err.message); setSectionError('rptAvgTime', err.message);
  }

  /* ── By Status ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-status${qs}`);
    renderBarBreakdown('statusBreakdown', data, 'status', 'total', statusColour);
    _reportCache.byStatus = data;
  } catch (err) { _reportCache.byStatus = []; setSectionError('statusBreakdown', err.message); }

  /* ── By Category ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-equipment${qs}`);
    renderBarBreakdown('categoryBreakdown', data, 'equipmentType', 'total');
    _reportCache.byCategory = data;
  } catch (err) { _reportCache.byCategory = []; setSectionError('categoryBreakdown', err.message); }

  /* ── Technician performance ── */
  try {
    const { data } = await apiRequest(`/reports/technician-performance${qs}`);
    renderTechPerformance(data);
    _reportCache.techPerf = data;
  } catch (err) { _reportCache.techPerf = []; setTableError('techPerformanceBody', 6, err.message); }

  /* ── By Department ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-department${qs}`);
    renderDeptReport(data);
    _reportCache.byDept = data;
  } catch (err) { _reportCache.byDept = []; setTableError('deptReportBody', 5, err.message); }
}

/* ── Bar chart breakdown ──────────────────────────────────── */
function renderBarBreakdown(id, data, labelKey, valueKey, colourFn) {
  const el = document.getElementById(id);
  if (!el || !data?.length) {
    if (el) el.innerHTML = '<p class="text-muted small text-center py-2">No data in the selected range.</p>';
    return;
  }
  const max = Math.max(...data.map(d => Number(d[valueKey])||0), 1);
  el.innerHTML = data.map(item => {
    const pct    = Math.round((Number(item[valueKey])/max)*100);
    const colour = colourFn ? colourFn(item[labelKey]) : '#2563eb';
    const label  = String(item[labelKey]).replace(/_/g,' ');
    return `
      <div class="mb-3">
        <div class="d-flex justify-content-between mb-1">
          <span class="small text-capitalize fw-semibold">${escHtml(label)}</span>
          <span class="small fw-bold">${item[valueKey]}</span>
        </div>
        <div class="rounded-pill overflow-hidden" style="height:10px;background:#e9ecef;">
          <div class="rounded-pill" style="height:100%;width:${pct}%;background:${colour};transition:width .8s ease;"></div>
        </div>
      </div>`;
  }).join('');
}

function renderMiniBars(id, data, labelKey, valueKey, colourFn) {
  const el = document.getElementById(id);
  if (!el || !data?.length) return;
  const max = Math.max(...data.map(d => Number(d[valueKey])||0), 1);
  el.innerHTML = `<div class="d-flex gap-2 align-items-end" style="height:60px;">` +
    data.map(item => {
      const h      = Math.max(Math.round((Number(item[valueKey])/max)*55), 4);
      const colour = colourFn ? colourFn(item[labelKey]) : '#2563eb';
      return `<div class="rounded-top flex-grow-1" title="${item[labelKey]}: ${item[valueKey]}"
                   style="height:${h}px;background:${colour};opacity:.85;cursor:default;"></div>`;
    }).join('') + `</div>`;
}

/* ── Technician performance table ────────────────────────── */
function renderTechPerformance(data) {
  const tbody = document.getElementById('techPerformanceBody');
  if (!tbody) return;
  if (!data?.length) { tbody.innerHTML = emptyRow(6,'No performance data in the selected range.'); return; }
  tbody.innerHTML = data.map(t => {
    const rate = t.assigned>0 ? Math.round((t.resolved/t.assigned)*100) : 0;
    const barC = rate>=80?'#198754':rate>=50?'#ffc107':'#dc3545';
    return `
      <tr>
        <td class="fw-semibold">${escHtml(t.name)}</td>
        <td>${t.assigned}</td>
        <td class="text-success fw-semibold">${t.resolved}</td>
        <td>${Number(t.assigned)-Number(t.resolved)}</td>
        <td>—</td>
        <td style="min-width:120px;">
          <div class="d-flex align-items-center gap-2">
            <div class="flex-grow-1 rounded-pill overflow-hidden" style="height:8px;background:#e9ecef;">
              <div class="rounded-pill" style="height:100%;width:${rate}%;background:${barC};transition:width .8s ease;"></div>
            </div>
            <small class="fw-semibold" style="color:${barC};">${rate}%</small>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ── Department report table ─────────────────────────────── */
function renderDeptReport(data) {
  const tbody = document.getElementById('deptReportBody');
  if (!tbody) return;
  if (!data?.length) { tbody.innerHTML = emptyRow(5,'No department data in the selected range.'); return; }
  tbody.innerHTML = data.map(d => {
    const completed = (d.completed ?? ((d.resolved||0) + (d.closed||0)));
    const pending   = d.total - completed;
    const rate = d.total>0 ? Math.round((completed/d.total)*100) : 0;
    return `
      <tr>
        <td class="fw-semibold">${escHtml(d.department||'Unknown')}</td>
        <td>${d.total}</td>
        <td class="text-success">${completed}</td>
        <td class="text-warning">${pending}</td>
        <td><span class="badge ${rate>=80?'bg-success':rate>=50?'bg-warning text-dark':'bg-danger'}">${rate}%</span></td>
      </tr>`;
  }).join('');
}

/* ── CSV Export ───────────────────────────────────────────── */
function exportReportCSV() {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [];
  const rangeLabel = (_reportFilter.dateFrom || _reportFilter.dateTo)
    ? `${_reportFilter.dateFrom || 'start'} → ${_reportFilter.dateTo || 'now'}`
    : 'All time';

  rows.push(['Smart Computer Maintenance Service — Report']);
  rows.push(['Generated', formatDateTime(new Date())]);
  rows.push(['Date Range', rangeLabel]);
  rows.push(['']);

  if (_reportCache.summary) {
    rows.push(['Summary']);
    rows.push(['Total Requests', _reportCache.summary.total]);
    rows.push(['Completed', _reportCache.summary.completed]);
    rows.push(['Pending', _reportCache.summary.pending]);
    rows.push(['']);
  }

  if (_reportCache.byStatus.length) {
    rows.push(['Requests by Status']);
    rows.push(['Status', 'Total']);
    _reportCache.byStatus.forEach(r => rows.push([r.status, r.total]));
    rows.push(['']);
  }

  if (_reportCache.byCategory.length) {
    rows.push(['Requests by Category']);
    rows.push(['Category', 'Total']);
    _reportCache.byCategory.forEach(r => rows.push([r.equipmentType, r.total]));
    rows.push(['']);
  }

  if (_reportCache.techPerf.length) {
    rows.push(['Technician Performance']);
    rows.push(['Technician', 'Assigned', 'Resolved', 'In Progress']);
    _reportCache.techPerf.forEach(t => rows.push([t.name, t.assigned, t.resolved, Number(t.assigned)-Number(t.resolved)]));
    rows.push(['']);
  }

  if (_reportCache.byDept.length) {
    rows.push(['Requests by Department']);
    rows.push(['Department', 'Total', 'Completed', 'Pending', '% Resolved']);
    _reportCache.byDept.forEach(d => {
      const completed = (d.completed ?? ((d.resolved||0) + (d.closed||0)));
      const rate = d.total > 0 ? Math.round((completed/d.total)*100) : 0;
      rows.push([d.department, d.total, completed, d.total-completed, `${rate}%`]);
    });
  }

  if (rows.length <= 4) {
    showToast('No report data to export yet.', 'warning');
    return;
  }

  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `maintenance-report-${_reportFilter.dateFrom || 'all'}-${_reportFilter.dateTo || 'all'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Helpers ──────────────────────────────────────────────── */
function statusColour(s) {
  return ({'submitted':'#6c757d','under_review':'#ffc107','assigned':'#6f42c1','accepted':'#0dcaf0','in_progress':'#20c997','resolved':'#198754','closed':'#343a40'})[s]||'#adb5bd';
}
function showSkeletons() {
  ['kpiUsers','kpiAssets','kpiPending','kpiCompleted','kpiInProgress','kpiTechnicians','kpiTotal','kpiOverdue']
    .forEach(id => setText(id,'…'));
}
function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(target)||0;
  let cur = 0;
  const step = Math.max(1, Math.ceil(n/30));
  const timer = setInterval(() => {
    cur = Math.min(cur+step, n);
    el.textContent = cur;
    if (cur >= n) clearInterval(timer);
  }, 30);
}
function setSectionError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = msg ? escHtml(msg) : '';
  if (el.tagName === 'DIV') {
    el.innerHTML = `<p class="text-muted small text-center py-2">Failed to load report data. ${text}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadReportData()">Retry</button></p>`;
  } else {
    el.textContent = '—';
  }
}
function setTableError(tbodyId, cols, msg) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const text = msg ? escHtml(msg) : '';
  tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center text-muted py-4">
    Failed to load report data. ${text}
    <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadReportData()">Retry</button>
  </td></tr>`;
}
function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="text-center text-muted py-4">
    <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>${msg}</td></tr>`;
}

/* ── Recent requests table row (shared by initial load and auto-refresh) ── */
function recentRequestRow(r) {
  return `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
        <td>
          <div class="text-break" title="${escHtml(r.problemDescription)}">${escHtml(r.problemDescription)}</div>
          <small class="text-muted">${escHtml(r.requester_name||'—')}</small>
        </td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.department||'—')}</span></td>
        <td>${priorityBadge(r.priority)}</td>
        <td>${statusBadge(r.status)}</td>
        <td><small class="text-muted">${formatDate(r.created_at)}</small></td>
        <td>
          <a href="requests.html" class="btn btn-sm btn-outline-primary py-0 px-2">
            <i class="bi bi-eye"></i>
          </a>
        </td>
      </tr>`;
}

/* ── Lightweight dashboard auto-refresh ──────────────────────
   Re-fetches the same endpoints used on load and updates the panels in
   place. Never triggers a browser reload and never polls twice (single
   guarded interval, started once by initAdminDashboard). */
let _dashAutoRefreshStarted = false;

function startDashboardAutoRefresh() {
  if (_dashAutoRefreshStarted) return;
  _dashAutoRefreshStarted = true;
  setInterval(async () => {
    /* Stay harmless if the admin has navigated away from the dashboard. */
    if (!window.location.pathname.includes('admin/dashboard')) return;
    try { await refreshAdminDashboard(); }
    catch (_) { /* keep the next tick; panels simply stay as-is */ }
  }, 60000);
}

async function refreshAdminDashboard() {
  /* ── KPI stats + pending badge ── */
  try {
    const { data: s } = await apiRequest('/reports/dashboard');
    animateCount('kpiUsers',       s.total_users);
    animateCount('kpiAssets',      s.total_assets);
    animateCount('kpiPending',     s.pending);
    animateCount('kpiCompleted',   s.completed);
    animateCount('kpiInProgress',  s.in_progress);
    animateCount('kpiTechnicians', s.total_technicians);
    const total = (s.pending||0) + (s.in_progress||0) + (s.completed||0);
    animateCount('kpiTotal',       total);
    const pb = document.getElementById('pendingBadge');
    if (pb) {
      pb.textContent = `${s.pending} Pending`;
      pb.className   = `badge ${s.pending > 0 ? 'bg-danger' : 'bg-success'}`;
    }
  } catch (_) {}

  /* ── Recent requests table + service feedback panel ── */
  try {
    const { data: reqs } = await apiRequest('/tickets');
    renderServiceFeedbackPanel(reqs);
    const tbody = document.getElementById('recentRequestsBody');
    if (tbody) {
      tbody.innerHTML = reqs.length
        ? reqs.slice(0, 8).map(recentRequestRow).join('')
        : emptyRow(6, 'No requests yet.');
    }
  } catch (_) {}

  /* ── Status mini chart ── */
  try {
    const { data: byStatus } = await apiRequest('/reports/requests-by-status');
    renderMiniBars('statusMiniChart', byStatus, 'status', 'total', statusColour);
  } catch (_) {}
}
