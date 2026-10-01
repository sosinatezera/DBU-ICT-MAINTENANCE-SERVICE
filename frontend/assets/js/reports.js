/* ============================================================
   reports.js  —  Admin / Manager Dashboard & Reports
    Smart ICT Maintenance Management System
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  await Auth.load();
  if (!requireAuth()) return;
  const p = window.location.pathname;
  if (p.includes("admin/dashboard")) await initAdminDashboard();
  if (p.includes("admin/reports")) await initReports();
});

/* ═══════════════════════════════════════════════════════════
   ADMIN DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function initAdminDashboard() {
  if (!requireRole("ICT Admin")) return;
  document.getElementById("dashErrorBanner")?.remove();
  showSkeletons();

  // Start dashboard API requests in parallel.
  const dashboardRequests = await Promise.allSettled([
    apiRequest("/reports/dashboard"),
    apiRequest("/tickets?limit=8&includeFeedback=true"),
    apiRequest("/reports/requests-by-status"),
    apiRequest("/maintenance/my"),
  ]);

  try {
    /* ── KPI stats ── */
    if (dashboardRequests[0].status === "rejected")
      throw dashboardRequests[0].reason;
    const { data: s } = dashboardRequests[0].value;
    animateCount("kpiUsers", s.total_users);
    animateCount("kpiAssets", s.total_assets);
    animateCount("kpiPending", s.pending);
    animateCount("kpiCompleted", s.completed);
    animateCount("kpiInProgress", s.in_progress);
    animateCount("kpiTechnicians", s.total_technicians);
    animateCount("kpiNetTotal", s.network_total);
    animateCount("kpiNetPending", s.network_pending);
    animateCount("kpiNetInProgress", s.network_in_progress);
    animateCount("kpiNetResolved", s.network_resolved);

    const total = (s.pending || 0) + (s.in_progress || 0) + (s.completed || 0);
    animateCount("kpiTotal", total);
    animateCount("kpiOverdue", s.overdue || 0);

    const pb = document.getElementById("pendingBadge");
    if (pb) {
      pb.textContent = `${s.pending} Pending`;
      pb.className = `badge ${s.pending > 0 ? "bg-danger" : "bg-success"}`;
    }
  } catch (err) {
    [
      "kpiUsers",
      "kpiAssets",
      "kpiPending",
      "kpiCompleted",
      "kpiInProgress",
      "kpiTechnicians",
      "kpiTotal",
      "kpiOverdue",
      "kpiNetTotal",
      "kpiNetPending",
      "kpiNetInProgress",
      "kpiNetResolved",
    ].forEach((id) => setText(id, "—"));
    const holder = document.getElementById("kpiUsers")?.closest(".row");
    if (holder) {
      const banner = document.createElement("div");
      banner.id = "dashErrorBanner";
      banner.className =
        "alert alert-danger d-flex justify-content-between align-items-center";
      banner.innerHTML = `<span><strong>Dashboard stats failed to load.</strong> ${escHtml(err.message || err)}</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="initAdminDashboard()">Retry</button>`;
      holder.parentNode.insertBefore(banner, holder);
    } else {
      showToast("Could not load dashboard stats: " + err.message, "danger");
    }
  }

  /* ── Recent requests table ── */
  try {
    if (dashboardRequests[1].status === "rejected")
      throw dashboardRequests[1].reason;
    const { data: reqs } = dashboardRequests[1].value;
    const tbody = document.getElementById("recentRequestsBody");
    /* A missing table must skip only the table. Returning here previously
       aborted the status chart, the activity feed and the auto-refresh setup,
       leaving those panels frozen on their static spinners. */
    /* Render the Service Feedback panel regardless of whether the ticket
       list is empty, so the Empty / No-requests path (and any failure) never
       leaves the static spinner in place. */
    renderServiceFeedbackPanel(reqs);

    if (tbody) {
      tbody.innerHTML = reqs.length
        ? reqs.slice(0, 8).map(recentRequestRow).join("")
        : emptyRow(7, "No requests yet.");
    }
  } catch (err) {
    const tbody = document.getElementById("recentRequestsBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
        Failed to load recent requests. ${escHtml(err.message || err)}
        <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button>
      </td></tr>`;
    }
    /* Also clear the Service Feedback panel so its static "Loading..." spinner
       is replaced even when the shared /tickets request fails. */
    const fPanel = document.getElementById("serviceFeedbackPanel");
    if (fPanel) {
      fPanel.innerHTML = `<div class="text-center text-muted py-4">
        <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
        <p class="small mb-0">Feedback unavailable.</p>
      </div>`;
    }
  }

  /* ── Status mini chart ── */
  try {
    if (dashboardRequests[2].status === "rejected")
      throw dashboardRequests[2].reason;
    const { data: byStatus } = dashboardRequests[2].value;
    renderMiniBars(
      "statusMiniChart",
      byStatus,
      "status",
      "total",
      statusColour,
    );
  } catch (err) {
    const el = document.getElementById("statusMiniChart");
    if (el)
      el.innerHTML = `<p class="text-muted small text-center py-2">Chart unavailable. ${escHtml(err.message || "")}</p>`;
  }

  /* ── Recent maintenance activity ── */
  try {
    if (dashboardRequests[3].status === "rejected")
      throw dashboardRequests[3].reason;
    renderRecentActivityDash(dashboardRequests[3].value.data);
  } catch (err) {
    const panel = document.getElementById("recentActivityDash");
    if (panel)
      panel.innerHTML = `<p class="text-muted small text-center py-2">Activity feed unavailable. ${escHtml(err.message || "")}</p>`;
  }

  /* Lightweight auto-refresh so a newly submitted requester ticket appears in
     the dashboard without a full browser reload — single guarded interval. */
  startDashboardAutoRefresh();
}

/* ── Render #recentActivityDash ────────────────────────────────
   Shared by the first paint and the 60s auto-refresh so both produce identical
   markup. Kept a no-op when the panel is absent: a template without
   #recentActivityDash must not abort the caller, which is what previously
   stopped startDashboardAutoRefresh() from ever being registered. */
function renderRecentActivityDash(acts) {
  const panel = document.getElementById("recentActivityDash");
  if (!panel) return;

  const list = acts || [];
  if (!list.length) {
    panel.innerHTML = `<p class="text-muted small text-center py-2"><i class="bi bi-inbox me-1"></i>No recent maintenance activity.</p>`;
    return;
  }

  panel.innerHTML = list
    .slice(0, 5)
    .map(
      (a) => `
        <div class="d-flex gap-2 py-2 border-bottom">
          <span class="badge rounded-pill ${a.status === "resolved" ? "bg-success" : "bg-primary"} flex-shrink-0 mt-1" style="width:8px;height:8px;padding:0;border-radius:50%!important;"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="small fw-semibold text-truncate">${escHtml(a.ticketId || "MAU-" + a.ticket_id)}</div>
            <div class="text-muted" style="font-size:.75rem;">${escHtml((a.action_taken || "").substring(0, 50))}…</div>
          </div>
          <small class="text-muted flex-shrink-0">${timeAgo(a.created_at)}</small>
        </div>`,
    )
    .join("");
}

/* ── Render the "Service Feedback" panel on the Admin dashboard ──
   Shows recent tickets that carry feedback, surfacing requester
   satisfaction, technician performance, resolution quality,
   follow-up required, and overall service quality. */
function renderServiceFeedbackPanel(tickets) {
  const panel = document.getElementById("serviceFeedbackPanel");
  if (!panel) return;

  const items = (tickets || []).filter(
    (r) =>
      r.admin_feedback || r.has_requester_feedback || r.has_technician_feedback,
  );
  if (!items.length) {
    panel.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
        <p class="small mb-0">No service feedback yet.</p>
        <a href="admin-feedback.html" class="btn btn-sm btn-outline-primary mt-2">Manage Feedback</a>
      </div>`;
    return;
  }

  panel.innerHTML =
    items
      .slice(0, 6)
      .map((r) => {
        const af = r.admin_feedback || {};
        const rf = r.requester_feedback || {};
        const stars = rf.overallRating
          ? `<span class="text-warning">${"★".repeat(rf.overallRating)}</span><span class="text-muted">${"☆".repeat(5 - rf.overallRating)}</span>`
          : '<span class="text-muted">—</span>';

        const badge = (v) =>
          v
            ? `<span class="badge ${clr(v)} me-1 mb-1">${escHtml(v)}</span>`
            : "";
        const followUp = af.followUpRequired
          ? `<span class="badge bg-danger mb-1"><i class="bi bi-arrow-repeat me-1"></i>Follow-up</span>`
          : "";

        return `
      <div class="border-bottom px-3 py-3">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong class="text-primary small">${escHtml(r.ticketId || r.id)}</strong>
          <span class="ms-auto">${stars}</span>
        </div>
        <div class="d-flex flex-wrap">
          ${badge(af.technicianPerformance)}
          ${badge(af.resolutionQuality)}
          ${af.overallServiceQuality ? `<span class="badge bg-success mb-1">${escHtml(af.overallServiceQuality)}</span>` : ""}
          ${followUp}
        </div>
        ${rf.overallRating && !af.technicianPerformance ? `<div class="small text-muted mt-1">Requester rated ${rf.overallRating}/5</div>` : ""}
      </div>`;
      })
      .join("") +
    `
    <div class="text-center p-2">
      <a href="admin-feedback.html" class="btn btn-sm btn-link">View all feedback</a>
    </div>`;

  function clr(v) {
    if (/excellent/i.test(v)) return "bg-success";
    if (/good/i.test(v)) return "bg-primary";
    if (/needs improvement|poor|slow|non-compliant/i.test(v))
      return "bg-danger";
    return "bg-secondary";
  }
}

/* ═══════════════════════════════════════════════════════════
   REPORTS PAGE
   ═══════════════════════════════════════════════════════════ */

// Cache of the most recently loaded report data (for CSV export)
let _reportCache = {
  summary: null,
  byStatus: [],
  byCategory: [],
  techPerf: [],
  byDept: [],
  network: null,
};
let _reportFilter = { dateFrom: "", dateTo: "", type: "all" };

async function initReports() {
  /* Bind the buttons BEFORE awaiting the data. A user who clicks "Generate"
     while the first load is still running used to have the click ignored
     entirely, because the listener was not attached yet. */
  document
    .getElementById("generateReportBtn")
    ?.addEventListener("click", loadReportData);
  document
    .getElementById("exportReportBtn")
    ?.addEventListener("click", exportReportCSV);
  document
    .getElementById("printReportBtn")
    ?.addEventListener("click", () => window.print());

  await loadReportData();
}

function currentReportParams() {
  _reportFilter.dateFrom =
    document.getElementById("reportDateFrom")?.value || "";
  _reportFilter.dateTo = document.getElementById("reportDateTo")?.value || "";
  _reportFilter.type = document.getElementById("reportType")?.value || "all";

  const params = new URLSearchParams();
  if (_reportFilter.dateFrom) params.set("dateFrom", _reportFilter.dateFrom);
  if (_reportFilter.dateTo) params.set("dateTo", _reportFilter.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function applyReportTypeFilter() {
  const type = _reportFilter.type;
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  };
  show("sectionByStatus", type === "all" || type === "requests");
  show(
    "sectionByCategory",
    type === "all" || type === "requests" || type === "category",
  );
  show("sectionTechPerf", type === "all" || type === "technician");
  show(
    "sectionByDept",
    type === "all" || type === "requests" || type === "department",
  );
  show("sectionNetwork", type === "all" || type === "network");
}

async function loadReportData() {
  const qs = currentReportParams();
  applyReportTypeFilter();

  /* All six report endpoints are independent of each other, but were awaited
     one after another. On a slow connection that is up to 6 sequential
     round-trips (~90s worst case at the 15s request timeout) with no visible
     progress. Fan them out in parallel instead: the wall time becomes that of
     the slowest single request, and each section still gets its own error
     state, so partial failures behave exactly as before. */
  const [
    summaryRes,
    byStatusRes,
    byCategoryRes,
    techPerfRes,
    byDeptRes,
    byIssueTypeRes,
    netRes,
  ] = await Promise.allSettled([
    apiRequest(`/reports/dashboard${qs}`),
    apiRequest(`/reports/requests-by-status${qs}`),
    apiRequest(`/reports/requests-by-equipment${qs}`),
    apiRequest(`/reports/technician-performance${qs}`),
    apiRequest(`/reports/requests-by-department${qs}`),
    apiRequest(`/reports/requests-by-issue-type${qs}`),
    apiRequest(`/reports/network${qs}`),
  ]);
  const settleError = (r) => (r.status === "rejected" ? r.reason : null);

  /* ── Summary KPIs ── */
  try {
    const summaryErr = settleError(summaryRes);
    if (summaryErr) throw summaryErr;
    const { data: s } = summaryRes.value;
    const total = (s.pending || 0) + (s.in_progress || 0) + (s.completed || 0);
    animateCount("rptTotal", total);
    animateCount("rptCompleted", s.completed);
    animateCount("rptPending", s.pending);
    setText(
      "rptAvgTime",
      s.avg_resolution_hours != null ? `${s.avg_resolution_hours} hrs` : "—",
    );
    _reportCache.summary = {
      total,
      completed: s.completed,
      pending: s.pending,
      avgResHours: s.avg_resolution_hours,
    };
  } catch (err) {
    _reportCache.summary = null;
    setSectionError("rptTotal", err.message);
    setSectionError("rptCompleted", err.message);
    setSectionError("rptPending", err.message);
    setSectionError("rptAvgTime", err.message);
  }

  /* ── By Status ── */
  try {
    const err0 = settleError(byStatusRes);
    if (err0) throw err0;
    const { data } = byStatusRes.value;
    renderBarBreakdown(
      "statusBreakdown",
      data,
      "status",
      "total",
      statusColour,
    );
    _reportCache.byStatus = data;
  } catch (err) {
    _reportCache.byStatus = [];
    setSectionError("statusBreakdown", err.message);
  }

  /* ── By Category ── */
  try {
    const err0 = settleError(byCategoryRes);
    if (err0) throw err0;
    const { data } = byCategoryRes.value;
    renderBarBreakdown("categoryBreakdown", data, "equipmentType", "total");
    _reportCache.byCategory = data;
  } catch (err) {
    _reportCache.byCategory = [];
    setSectionError("categoryBreakdown", err.message);
  }

  /* ── Technician performance ── */
  try {
    const err0 = settleError(techPerfRes);
    if (err0) throw err0;
    const { data } = techPerfRes.value;
    renderTechPerformance(data);
    _reportCache.techPerf = data;
  } catch (err) {
    _reportCache.techPerf = [];
    setTableError("techPerformanceBody", 6, err.message);
  }

  /* ── By Department ── */
  try {
    const err0 = settleError(byDeptRes);
    if (err0) throw err0;
    const { data } = byDeptRes.value;
    renderDeptReport(data);
    _reportCache.byDept = data;
  } catch (err) {
    _reportCache.byDept = [];
    setTableError("deptReportBody", 5, err.message);
  }

  /* ── By Issue Type / Service Type ── */
  try {
    const err0 = settleError(byIssueTypeRes);
    if (err0) throw err0;
    const { data } = byIssueTypeRes.value;
    renderIssueTypeReport(data);
    _reportCache.byIssueType = data;
  } catch (err) {
    _reportCache.byIssueType = [];
    setTableError("issueTypeReportBody", 4, err.message);
  }

  /* ── Network Maintenance ── */
  try {
    const err0 = settleError(netRes);
    if (err0) throw err0;
    const { data } = netRes.value;
    renderNetworkReport(data);
    _reportCache.network = data;
  } catch (err) {
    _reportCache.network = null;
    renderNetworkError(err.message);
  }
}

/* ── Bar chart breakdown ──────────────────────────────────── */
function renderBarBreakdown(id, data, labelKey, valueKey, colourFn) {
  const el = document.getElementById(id);
  if (!el || !data?.length) {
    if (el)
      el.innerHTML =
        '<p class="text-muted small text-center py-2">No data in the selected range.</p>';
    return;
  }
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  el.innerHTML = data
    .map((item) => {
      const pct = Math.round((Number(item[valueKey]) / max) * 100);
      const colour = colourFn ? colourFn(item[labelKey]) : "#2563eb";
      const label = String(item[labelKey]).replace(/_/g, " ");
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
    })
    .join("");
}

function renderMiniBars(id, data, labelKey, valueKey, colourFn) {
  const el = document.getElementById(id);
  /* An empty result set previously returned early and left the previous bars
     on screen, so the chart showed stale data instead of an empty state. */
  if (!el) return;
  if (!data?.length) {
    el.innerHTML =
      '<p class="text-muted small text-center py-2">No data in the selected range.</p>';
    return;
  }
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  el.innerHTML =
    `<div class="d-flex gap-2 align-items-end" style="height:60px;">` +
    data
      .map((item) => {
        const h = Math.max(Math.round((Number(item[valueKey]) / max) * 55), 4);
        const colour = colourFn ? colourFn(item[labelKey]) : "#2563eb";
        return `<div class="rounded-top flex-grow-1" title="${item[labelKey]}: ${item[valueKey]}"
                   style="height:${h}px;background:${colour};opacity:.85;cursor:default;"></div>`;
      })
      .join("") +
    `</div>`;
}

/* ── Technician performance table ────────────────────────── */
function renderTechPerformance(data) {
  const tbody = document.getElementById("techPerformanceBody");
  if (!tbody) return;
  if (!data?.length) {
    tbody.innerHTML = emptyRow(6, "No performance data in the selected range.");
    return;
  }
  tbody.innerHTML = data
    .map((t) => {
      const rate =
        t.assigned > 0 ? Math.round((t.resolved / t.assigned) * 100) : 0;
      const barC = rate >= 80 ? "#198754" : rate >= 50 ? "#ffc107" : "#dc3545";
      return `
      <tr>
        <td class="fw-semibold">${escHtml(t.name)}</td>
        <td>${t.assigned}</td>
        <td class="text-success fw-semibold">${t.resolved}</td>
        <td>${Number(t.assigned) - Number(t.resolved)}</td>
        <td class="fw-semibold">${t.avgRating != null ? Number(t.avgRating).toFixed(1) : "—"}</td>
        <td style="min-width:120px;">
          <div class="d-flex align-items-center gap-2">
            <div class="flex-grow-1 rounded-pill overflow-hidden" style="height:8px;background:#e9ecef;">
              <div class="rounded-pill" style="height:100%;width:${rate}%;background:${barC};transition:width .8s ease;"></div>
            </div>
            <small class="fw-semibold" style="color:${barC};">${rate}%</small>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

/* ── Department report table ─────────────────────────────── */
function renderDeptReport(data) {
  const tbody = document.getElementById("deptReportBody");
  if (!tbody) return;
  if (!data?.length) {
    tbody.innerHTML = emptyRow(5, "No department data in the selected range.");
    return;
  }
  tbody.innerHTML = data
    .map((d) => {
      const completed = d.completed ?? (d.resolved || 0) + (d.closed || 0);
      const pending = d.total - completed;
      const rate = d.total > 0 ? Math.round((completed / d.total) * 100) : 0;
      return `
      <tr>
        <td class="fw-semibold">${escHtml(d.department || "Unknown")}</td>
        <td>${d.total}</td>
        <td class="text-success">${completed}</td>
        <td class="text-warning">${pending}</td>
        <td><span class="badge ${rate >= 80 ? "bg-success" : rate >= 50 ? "bg-warning text-dark" : "bg-danger"}">${rate}%</span></td>
      </tr>`;
    })
    .join("");
}

/* ── Issue Type / Service Type report table ──────────────────
   Reports the "what problem or service is required?" field on its own.
   It is never folded into Category, Device Type or ICT Asset — those stay
   in their own tables. */
function renderIssueTypeReport(data) {
  const tbody = document.getElementById("issueTypeReportBody");
  if (!tbody) return;
  if (!data?.length) {
    tbody.innerHTML = emptyRow(
      4,
      "No issue type data in the selected range.",
    );
    return;
  }
  tbody.innerHTML = data
    .map((d) => {
      const total = Number(d.total || 0);
      const resolved = Number(d.resolved || 0);
      const open = Number(d.open || 0);
      const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
      return `
      <tr>
        <td class="fw-semibold">${escHtml(d.issueType || "Unspecified")}</td>
        <td>${total}</td>
        <td class="text-success">${resolved}</td>
        <td class="text-warning">${open}</td>
        <td><span class="badge ${rate >= 80 ? "bg-success" : rate >= 50 ? "bg-warning text-dark" : "bg-danger"}">${rate}%</span></td>
      </tr>`;
    })
    .join("");
}

/* ── Network Maintenance report ───────────────────────────── */
const NETWORK_SERVICE_COLOURS = {
  "Internet / Wi-Fi": "#2563eb",
  "LAN / Wired Network": "#0ea5e9",
  "Router / Access Point": "#7c3aed",
  "Switch / Hub": "#f59e0b",
  "Firewall / Security": "#dc3545",
  "Server Network": "#198754",
  "Network Configuration / IP / DNS / DHCP": "#64748b",
  "Cabling / Physical Infrastructure": "#14b8a6",
  Other: "#adb5bd",
};

function renderNetworkReport(data) {
  if (!data) {
    renderNetworkError("No network maintenance data.");
    return;
  }

  /* By service type */
  renderBarBreakdown(
    "netServiceBreakdown",
    data.byServiceType,
    "serviceType",
    "total",
    (s) => NETWORK_SERVICE_COLOURS[s] || "#2563eb",
  );

  /* By status */
  renderBarBreakdown(
    "netStatusBreakdown",
    data.byStatus,
    "status",
    "total",
    statusColour,
  );

  /* By network device */
  renderBarBreakdown("netDeviceBreakdown", data.byDevice, "device", "total");

  /* By department table */
  const deptBody = document.getElementById("netDeptBody");
  if (deptBody) {
    if (!data.byDepartment?.length) {
      deptBody.innerHTML = emptyRow(
        3,
        "No department data in the selected range.",
      );
    } else {
      deptBody.innerHTML = data.byDepartment
        .map(
          (d) => `
        <tr>
          <td class="fw-semibold">${escHtml(d.department || "Unknown")}</td>
          <td>${d.total}</td>
          <td class="text-success fw-semibold">${d.resolved}</td>
        </tr>`,
        )
        .join("");
    }
  }

  /* Recent network requests table */
  const histBody = document.getElementById("netHistoryBody");
  if (histBody) {
    if (!data.history?.length) {
      histBody.innerHTML = emptyRow(7, "No network maintenance requests yet.");
    } else {
      histBody.innerHTML = data.history
        .map(
          (h) => `
        <tr>
          <td><strong class="text-primary">${escHtml(h.ticketId || h.id)}</strong></td>
          <td class="text-truncate" style="max-width:220px;">${escHtml(h.title || h.problemDescription || "—")}</td>
          <td>${escHtml(h.serviceType || "—")}</td>
          <td>${escHtml(h.networkDevice || "—")}</td>
          <td>${priorityBadge(h.priority)}</td>
          <td>${statusBadge(h.status)}</td>
          <td><small class="text-muted">${formatDate(h.created_at || h.createdAt)}</small></td>
        </tr>`,
        )
        .join("");
    }
  }
}

function renderNetworkError(msg) {
  ["netServiceBreakdown", "netStatusBreakdown", "netDeviceBreakdown"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el)
        el.innerHTML = `<p class="text-muted small text-center py-2">${escHtml(msg || "")}</p>`;
    },
  );
  const deptBody = document.getElementById("netDeptBody");
  if (deptBody)
    deptBody.innerHTML = emptyRow(3, msg || "Network report unavailable.");
  const histBody = document.getElementById("netHistoryBody");
  if (histBody)
    histBody.innerHTML = emptyRow(7, msg || "Network report unavailable.");
}

/* ── CSV Export ───────────────────────────────────────────── */
function exportReportCSV() {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [];
  const rangeLabel =
    _reportFilter.dateFrom || _reportFilter.dateTo
      ? `${_reportFilter.dateFrom || "start"} → ${_reportFilter.dateTo || "now"}`
      : "All time";

  rows.push(["Smart Computer Maintenance Service — Report"]);
  rows.push(["Generated", formatDateTime(new Date())]);
  rows.push(["Date Range", rangeLabel]);
  rows.push([""]);

  if (_reportCache.summary) {
    rows.push(["Summary"]);
    rows.push(["Total Requests", _reportCache.summary.total]);
    rows.push(["Completed", _reportCache.summary.completed]);
    rows.push(["Pending", _reportCache.summary.pending]);
    rows.push([
      "Avg. Resolution Time (hrs)",
      _reportCache.summary.avgResHours ?? "—",
    ]);
    rows.push([""]);
  }

  if (_reportCache.byStatus.length) {
    rows.push(["Requests by Status"]);
    rows.push(["Status", "Total"]);
    _reportCache.byStatus.forEach((r) => rows.push([r.status, r.total]));
    rows.push([""]);
  }

  if (_reportCache.byCategory.length) {
    rows.push(["Requests by Category"]);
    rows.push(["Category", "Total"]);
    _reportCache.byCategory.forEach((r) =>
      rows.push([r.equipmentType, r.total]),
    );
    rows.push([""]);
  }

  if (_reportCache.techPerf.length) {
    rows.push(["Technician Performance"]);
    rows.push([
      "Technician",
      "Assigned",
      "Resolved",
      "In Progress",
      "Avg. Rating",
    ]);
    _reportCache.techPerf.forEach((t) =>
      rows.push([
        t.name,
        t.assigned,
        t.resolved,
        Number(t.assigned) - Number(t.resolved),
        t.avgRating != null ? Number(t.avgRating).toFixed(1) : "",
      ]),
    );
    rows.push([""]);
  }

  if (_reportCache.byDept.length) {
    rows.push(["Requests by Department"]);
    rows.push(["Department", "Total", "Completed", "Pending", "% Resolved"]);
    _reportCache.byDept.forEach((d) => {
      const completed = d.completed ?? (d.resolved || 0) + (d.closed || 0);
      const rate = d.total > 0 ? Math.round((completed / d.total) * 100) : 0;
      rows.push([
        d.department,
        d.total,
        completed,
        d.total - completed,
        `${rate}%`,
      ]);
    });
  }

  if (_reportCache.byIssueType?.length) {
    rows.push([""]);
    rows.push(["Requests by Issue Type / Service Type"]);
    rows.push([
      "Issue Type / Service Type",
      "Total",
      "Resolved",
      "Open",
      "% Resolved",
    ]);
    _reportCache.byIssueType.forEach((r) => {
      const total = Number(r.total || 0);
      const resolved = Number(r.resolved || 0);
      const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
      rows.push([
        r.issueType,
        total,
        resolved,
        Number(r.open || 0),
        `${rate}%`,
      ]);
    });
    rows.push([""]);
  }

  if (_reportCache.network?.byServiceType?.length) {
    rows.push(["Network Maintenance — Requests by Service Type"]);
    rows.push(["Service Type", "Total", "Resolved"]);
    _reportCache.network.byServiceType.forEach((r) =>
      rows.push([r.serviceType, r.total, r.resolved]),
    );
    rows.push([""]);
    rows.push(["Network Maintenance — Requests by Status"]);
    rows.push(["Status", "Total"]);
    _reportCache.network.byStatus.forEach((r) =>
      rows.push([r.status, r.total]),
    );
  }

  if (rows.length <= 4) {
    showToast("No report data to export yet.", "warning");
    return;
  }

  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `maintenance-report-${_reportFilter.dateFrom || "all"}-${_reportFilter.dateTo || "all"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Helpers ──────────────────────────────────────────────── */
function statusColour(s) {
  return (
    {
      submitted: "#6c757d",
      under_review: "#ffc107",
      assigned: "#6f42c1",
      accepted: "#0dcaf0",
      in_progress: "#20c997",
      resolved: "#198754",
      closed: "#343a40",
    }[s] || "#adb5bd"
  );
}
function showSkeletons() {
  [
    "kpiUsers",
    "kpiAssets",
    "kpiPending",
    "kpiCompleted",
    "kpiInProgress",
    "kpiTechnicians",
    "kpiTotal",
    "kpiOverdue",
    "kpiNetTotal",
    "kpiNetPending",
    "kpiNetInProgress",
    "kpiNetResolved",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    /* A skeleton write must also stop any roll that is still running, or the
       interval would paint a number back over the "…" placeholder. */
    stopCount(el);
    setText(id, "…");
  });
}
/* Cancel any count-up still running on this element. The interval handle is
   kept ON the element, not in a closure, so an instant write can always stop
   it. Otherwise a background refresh would paint a fresh KPI and then have the
   older animation interval overwrite it for the rest of the roll. */
function stopCount(el) {
  if (el._countTimer) {
    clearInterval(el._countTimer);
    el._countTimer = null;
  }
  el.dataset.counting = "0";
}

/* Instant set — used for background refreshes where re-animating would look
   like a reload. */
function setCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  stopCount(el);
  el.textContent = Number(target) || 0;
}

/* Count-up used only for the FIRST paint, so a number is never left mid-roll. */
function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  /* A second call (banner Retry re-entering initAdminDashboard) replaces the
     old roll rather than running beside it. */
  stopCount(el);
  const n = Number(target) || 0;
  if (n <= 0) {
    el.textContent = 0;
    return;
  }
  el.dataset.counting = "1";
  let cur = 0;
  const step = Math.max(1, Math.ceil(n / 30));
  el._countTimer = setInterval(() => {
    cur = Math.min(cur + step, n);
    el.textContent = cur;
    if (cur >= n) stopCount(el);
  }, 30);
}
function setSectionError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = msg ? escHtml(msg) : "";
  if (el.tagName === "DIV") {
    el.innerHTML = `<p class="text-muted small text-center py-2">Failed to load report data. ${text}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadReportData()">Retry</button></p>`;
  } else {
    el.textContent = "—";
  }
}
function setTableError(tbodyId, cols, msg) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const text = msg ? escHtml(msg) : "";
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
          <small class="text-muted">${escHtml(r.requester_name || "—")}</small>
        </td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.department || "—")}</span></td>
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

let _dashRefreshInFlight = false;

function startDashboardAutoRefresh() {
  if (_dashAutoRefreshStarted) return;
  _dashAutoRefreshStarted = true;

  const tick = async () => {
    /* Stay harmless if the admin has navigated away from the dashboard. */
    if (!window.location.pathname.includes("admin/dashboard")) return;
    /* Don't refetch a hidden tab, and never let two ticks overlap. */
    if (document.hidden || _dashRefreshInFlight) return;
    _dashRefreshInFlight = true;
    try {
      await refreshAdminDashboard();
    } catch (_) {
      /* keep the next tick; panels simply stay as-is */
    } finally {
      _dashRefreshInFlight = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void tick();
  });
  setInterval(tick, 60000);
}

async function refreshAdminDashboard() {
  /* These four are independent — fetch them concurrently instead of
     serially, and mirror the ?limit=8 the initial load uses. The old
     unbounded GET /tickets pulled the entire ticket table over the wire every
     minute just to render eight rows. */
  const [dashRes, ticketsRes, byStatusRes, maintRes] = await Promise.allSettled([
    apiRequest("/reports/dashboard"),
    apiRequest("/tickets?limit=8&includeFeedback=true"),
    apiRequest("/reports/requests-by-status"),
    apiRequest("/maintenance/my"),
  ]);

  /* ── KPI stats + pending badge ── */
  if (dashRes.status === "fulfilled") {
    const { data: s } = dashRes.value;
    /* setCount, not animateCount: re-running the count-up from zero every
       60s made settled KPIs visibly re-roll, which reads as a loading state
       even though nothing was loading. */
    setCount("kpiUsers", s.total_users);
    setCount("kpiAssets", s.total_assets);
    setCount("kpiPending", s.pending);
    setCount("kpiCompleted", s.completed);
    setCount("kpiInProgress", s.in_progress);
    setCount("kpiTechnicians", s.total_technicians);
    const total = (s.pending || 0) + (s.in_progress || 0) + (s.completed || 0);
    setCount("kpiTotal", total);
    setCount("kpiOverdue", s.overdue || 0);
    setCount("kpiNetTotal", s.network_total);
    setCount("kpiNetPending", s.network_pending);
    setCount("kpiNetInProgress", s.network_in_progress);
    setCount("kpiNetResolved", s.network_resolved);
    const pb = document.getElementById("pendingBadge");
    if (pb) {
      pb.textContent = `${s.pending} Pending`;
      pb.className = `badge ${s.pending > 0 ? "bg-danger" : "bg-success"}`;
    }
  }

  /* ── Recent requests table + service feedback panel ── */
  if (ticketsRes.status === "fulfilled") {
    const { data: reqs } = ticketsRes.value;
    renderServiceFeedbackPanel(reqs);
    const tbody = document.getElementById("recentRequestsBody");
    if (tbody) {
      tbody.innerHTML = reqs.length
        ? reqs.slice(0, 8).map(recentRequestRow).join("")
        : emptyRow(7, "No requests yet.");
    }
  }

  /* ── Status mini chart ── */
  if (byStatusRes.status === "fulfilled") {
    const { data: byStatus } = byStatusRes.value;
    renderMiniBars("statusMiniChart", byStatus, "status", "total", statusColour);
  }

  /* ── Recent maintenance activity ──
     The auto-refresh interval previously left this panel frozen at whatever
     the first paint showed, so a technician's repair logged from another page
     never appeared here. Same renderer as the initial load. */
  if (maintRes.status === "fulfilled") {
    renderRecentActivityDash(maintRes.value.data);
  }
}
