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
  } catch (err) { showToast('Could not load dashboard stats: ' + err.message, 'danger'); }

  /* ── Recent requests table ── */
  try {
    const { data: reqs } = await apiRequest('/tickets');
    const tbody = document.getElementById('recentRequestsBody');
    if (!tbody) return;

    if (!reqs.length) {
      tbody.innerHTML = emptyRow(6, 'No requests yet.');
      return;
    }

    tbody.innerHTML = reqs.slice(0, 8).map(r => `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
        <td>
          <div style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
               title="${escHtml(r.problemDescription)}">${escHtml(r.problemDescription)}</div>
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
      </tr>`).join('');
  } catch (err) { console.error('Recent requests:', err); }

  /* ── Status mini chart ── */
  try {
    const { data: byStatus } = await apiRequest('/reports/requests-by-status');
    renderMiniBars('statusMiniChart', byStatus, 'status', 'total', statusColour);
  } catch (_) {}

  /* ── Recent maintenance activity ── */
  try {
    const { data: acts } = await apiRequest('/maintenance/my');
    const panel = document.getElementById('recentActivityDash');
    if (panel && acts.length) {
      panel.innerHTML = acts.slice(0,5).map(a => `
        <div class="d-flex gap-2 py-2 border-bottom">
          <span class="badge rounded-pill ${a.status==='resolved'?'bg-success':'bg-primary'} flex-shrink-0 mt-1" style="width:8px;height:8px;padding:0;border-radius:50%!important;"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="small fw-semibold text-truncate">${escHtml(a.ticketId||'TK-'+a.ticket_id)}</div>
            <div class="text-muted" style="font-size:.75rem;">${escHtml((a.action_taken||'').substring(0,50))}…</div>
          </div>
          <small class="text-muted flex-shrink-0">${timeAgo(a.created_at)}</small>
        </div>`).join('');
    }
  } catch (_) {}
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
    setSectionError('rptTotal'); setSectionError('rptCompleted');
    setSectionError('rptPending'); setSectionError('rptAvgTime');
  }

  /* ── By Status ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-status${qs}`);
    renderBarBreakdown('statusBreakdown', data, 'status', 'total', statusColour);
    _reportCache.byStatus = data;
  } catch (err) { _reportCache.byStatus = []; setSectionError('statusBreakdown'); }

  /* ── By Category ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-equipment${qs}`);
    renderBarBreakdown('categoryBreakdown', data, 'equipmentType', 'total');
    _reportCache.byCategory = data;
  } catch (err) { _reportCache.byCategory = []; setSectionError('categoryBreakdown'); }

  /* ── Technician performance ── */
  try {
    const { data } = await apiRequest(`/reports/technician-performance${qs}`);
    renderTechPerformance(data);
    _reportCache.techPerf = data;
  } catch (err) { _reportCache.techPerf = []; setTableError('techPerformanceBody', 6); }

  /* ── By Department ── */
  try {
    const { data } = await apiRequest(`/reports/requests-by-department${qs}`);
    renderDeptReport(data);
    _reportCache.byDept = data;
  } catch (err) { _reportCache.byDept = []; setTableError('deptReportBody', 5); }
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
    const colour = colourFn ? colourFn(item[labelKey]) : '#0d6efd';
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
      const colour = colourFn ? colourFn(item[labelKey]) : '#0d6efd';
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
    const rate = d.total>0 ? Math.round(((d.completed||0)/d.total)*100) : 0;
    return `
      <tr>
        <td class="fw-semibold">${escHtml(d.department||'Unknown')}</td>
        <td>${d.total}</td>
        <td class="text-success">${d.completed||0}</td>
        <td class="text-warning">${d.total-(d.completed||0)}</td>
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
  rows.push(['Generated', new Date().toLocaleString()]);
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
    _reportCache.byCategory.forEach(r => rows.push([r.category, r.total]));
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
      const rate = d.total > 0 ? Math.round(((d.completed||0)/d.total)*100) : 0;
      rows.push([d.department, d.total, d.completed||0, d.total-(d.completed||0), `${rate}%`]);
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
function setSectionError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === 'DIV') el.innerHTML = '<p class="text-muted small text-center py-2">Failed to load report data.</p>';
  else el.textContent = '—';
}
function setTableError(tbodyId, cols) {
  const tbody = document.getElementById(tbodyId);
  if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center text-muted py-4">Failed to load report data.</td></tr>`;
}
function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="text-center text-muted py-4">
    <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>${msg}</td></tr>`;
}
function setText(id, v) { const e=document.getElementById(id); if(e) e.textContent=v??'0'; }
function escHtml(s) {
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
