/* ============================================================
   technicians.js — Technician Dashboard & All Technician Pages
    Smart ICT Maintenance Management System
   ============================================================ */

/* JSON.stringify output that is safe to embed in a double-quoted HTML onclick attribute.
   Double-quotes are escaped as &quot; so the browser decodes them back to real quotes
   BEFORE evaluating the inline handler — otherwise the attribute would be truncated and
   the handler would become a JS SyntaxError (the classic source of empty request IDs). */
function jsAttr(v) {
  return JSON.stringify(v === undefined || v === null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ── Reliable Ticket ID helper ──────────────────────────────
   The backend stores the Ticket's Mongo _id in several keys depending on
   endpoint (ticket_id / id / _id / request_id). Always prefer the Mongo _id,
   never the human-readable MAU-XXXX code, for API calls that target /tickets/:id. */
function getTicketId(ticket) {
  if (!ticket) return null;
  /* For assignment-shaped records from /technicians/my/assignments the
     response includes BOTH `_id` (the Assignment ObjectId) and `ticket_id`
     (the Ticket ObjectId). We must send the Ticket _id to /tickets/:id, so
     `ticket_id` takes priority. Plain /tickets/:id responses carry the Ticket
     _id as `_id` / `id` and have no `ticket_id`, so they fall through correctly. */
  const id =
    ticket.ticket_id || ticket._id || ticket.id || ticket.request_id || null;
  if (!id) return null;
  const s = String(id).trim();
  return /^[0-9a-f]{24}$/i.test(s) ? s : null;
}

/* One guard for every technician action — ensures a valid Mongo ticket _id
   is always sent to the backend (never undefined / null / "undefined" / ""). */
function requireTicketId(btn) {
  const id = btn?.dataset?.ticketId || "";
  const clean = String(id).trim();
  if (!clean || clean === "undefined" || clean === "null") {
    showToast(
      "Invalid or missing request ID. Reopen the task from the list.",
      "danger",
    );
    return null;
  }
  if (!/^[0-9a-f]{24}$/i.test(clean)) {
    showToast("Invalid request ID. Reopen the task from the list.", "danger");
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

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.dataset.action === "") return;

    const ticketId = requireTicketId(btn);
    if (!ticketId) {
      e.preventDefault();
      return;
    }
    if (btn.dataset.action === "view") return openViewDetails(ticketId);
    if (btn.dataset.action === "accept") return acceptTask(btn, ticketId);
    if (btn.dataset.action === "start") return startWork(btn, ticketId);
    if (btn.dataset.action === "resolve") return resolveTask(btn, ticketId);
    if (btn.dataset.action === "update") {
      // Dashboard uses #updateTaskModal, assigned-requests uses #taskModal.
      return window.location.pathname.includes("technician/assigned-requests")
        ? openTaskModal(ticketId, btn.dataset.title, btn.dataset.status)
        : openUpdateModal(ticketId, btn.dataset.title, btn.dataset.status);
    }
    if (btn.dataset.action === "report")
      return openFeedbackModal(ticketId, btn.dataset.title);
    if (btn.dataset.action === "view-report")
      return viewFeedbackReport(ticketId);
  });
}

/* ── Helper: render the action buttons for a single ticket row/card ──
   Buttons shown depend on the ticket's current status. */
function renderTechActionButtons(r) {
  const id = getTicketId(r);
  if (!id) return "";
  const status = r.status;

  const btn = (action, label, icon, variant = "primary", title = "") =>
    `<button type="button" class="btn btn-sm btn-${variant} fw-semibold"
             data-action="${action}" data-ticket-id="${escHtml(id)}"
             data-title="${escHtml(r.title || "")}" data-status="${escHtml(status)}"
             title="${title}"><i class="bi ${icon} me-1"></i>${label}</button>`;

  const view = btn("view", "View", "bi-eye", "outline-secondary");

  let extra = "";
  if (status === "assigned") {
    extra += btn("accept", "Accept", "bi-check2-circle", "success");
  } else if (status === "accepted") {
    extra += btn("start", "Start Work", "bi-play-fill", "info");
  } else if (status === "in_progress") {
    extra += btn("update", "Update", "bi-pencil-fill", "warning");
    extra += btn("resolve", "Resolve", "bi-check2-all", "success");
  }

  const report = r.has_feedback
    ? btn("view-report", "Report", "bi-file-earmark-text", "outline-primary")
    : btn("report", "Report", "bi-clipboard-plus", "primary");

  return `<div class="d-flex flex-wrap gap-1">${view}${extra}${report}</div>`;
}

/* ── Quick status-action (Accept / Start Work / Resolve) ─── */
async function quickStatusAction(btn, ticketId, newStatus, successMsg) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;
  try {
    await apiRequest(`/tickets/${ticketId}/status`, {
      method: "PATCH",
      body: { status: newStatus },
    });
    showToast(successMsg, "success");
    await refreshAfterAction();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = original;
    handleApiError(err);
  }
}

async function acceptTask(btn, ticketId) {
  return quickStatusAction(btn, ticketId, "accepted", "Task accepted.");
}
async function startWork(btn, ticketId) {
  return quickStatusAction(btn, ticketId, "in_progress", "Work started.");
}
async function resolveTask(btn, ticketId) {
  return quickStatusAction(
    btn,
    ticketId,
    "resolved",
    "Task marked as resolved.",
  );
}

/* Refresh the list that is currently visible (dashboard or assigned requests)
   without reloading the whole page. */
async function refreshAfterAction() {
  if (window.location.pathname.includes("technician/dashboard")) {
    await loadDashboardTasks();
    await loadRecentActivity();
  } else if (
    window.location.pathname.includes("technician/assigned-requests")
  ) {
    _assignedAll = await fetchAssignedRequests();
  }
}

/* Map a backend error to a clear, user-friendly message. */
function handleApiError(err) {
  const code =
    (err && err.data && err.data.statusCode) || (err && err.status) || "";
  let msg = (err && err.message) || "Something went wrong.";
  if (
    code === 401 ||
    String(msg).toLowerCase().includes("token") ||
    String(msg).includes("expired")
  ) {
    msg = "Your access token has expired. Please login again.";
  } else if (code === 404) {
    msg = "Request not found.";
  }
  showToast(msg, "danger");
}

document.addEventListener("DOMContentLoaded", async () => {
  await Auth.load();
  if (!requireAuth()) return;
  const p = window.location.pathname;

  if (p.includes("technician/dashboard")) initTechDashboard();
  if (p.includes("technician/assigned-requests")) initAssignedRequests();
  if (p.includes("technician/maintenance")) initMaintenanceLog();
  if (p.includes("technician/history")) initTechHistory();
  if (p.includes("admin/technicians")) initAdminTechnicians();
});

/* ═══════════════════════════════════════════════════════════
   TECHNICIAN DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function initTechDashboard() {
  if (!requireRole("Technician")) return;
  const dateEl = document.getElementById("currentDate");
  if (dateEl) {
    const opts = {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    };
    const tz = (window.__ictPrefs && window.__ictPrefs.timezone()) || null;
    if (tz) opts.timeZone = tz;
    dateEl.textContent = new Intl.DateTimeFormat("en-GB", opts).format(
      new Date(),
    );
  }

  /* allSettled, not all: a single failed panel fetch used to reject here and
     skip the dashboard action handlers entirely. Each panel already renders
     its own error state, so a partial failure must not take the rest of the
     page down with it. */
  await Promise.allSettled([
    loadTechProfile(),
    loadDashboardTasks(),
    loadRecentActivity(),
    loadTechFeedbackReports(),
  ]);

  /* These are interaction wiring, never data. Bind them unconditionally. */
  initTechActionDelegation();
  initFeedbackHandlers();
}

/* ── Load & render "My Technical Reports" on the dashboard ────
   Shows recently submitted maintenance reports (diagnosis, work
   performed, status, resolution, completion date). */
async function loadTechFeedbackReports() {
  const panel = document.getElementById("techFeedbackPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="text-center text-muted py-3">
      <div class="spinner-border spinner-border-sm" role="status"></div>
      <span class="visually-hidden">Loading technical reports...</span>
    </div>`;

  try {
    const { data: assignments } = await apiRequest(
      "/technicians/my/assignments",
    );
    if (!Array.isArray(assignments)) {
      throw new Error("The server returned an unexpected assignments response.");
    }

    const items = assignments
      .filter((assignment) => assignment.has_feedback)
      .slice(0, 5)
      .map((assignment) => ({
        ticket: assignment.ticketId || assignment.ticket_id || "Ticket",
        report: assignment.technician_report,
      }));
    if (items.some((item) => !item.report)) {
      throw new Error("The server returned incomplete technical report data.");
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

    panel.innerHTML = items
      .map(({ ticket, report }) => {
        const statusBadgeHtml =
          report.status === "Fixed"
            ? '<span class="badge bg-success">Fixed</span>'
            : report.status === "Not Fixed"
              ? '<span class="badge bg-danger">Not Fixed</span>'
              : '<span class="badge bg-warning text-dark">In Progress</span>';
        const row = (label, value) =>
          value
            ? `
        <div class="d-flex gap-2 mb-1">
          <span class="text-muted small text-nowrap" style="min-width:110px;">${escHtml(label)}</span>
          <span class="small">${escHtml(value)}</span>
        </div>`
            : "";
        return `
        <div class="border-bottom p-3">
          <div class="d-flex align-items-center gap-2 mb-2">
            <strong class="text-primary small">${escHtml(ticket)}</strong>
            ${statusBadgeHtml}
            ${report.completionDate ? `<span class="ms-auto small text-muted"><i class="bi bi-calendar-check me-1"></i>${formatDate(report.completionDate)}</span>` : ""}
          </div>
          ${row("Diagnosis", report.diagnosis)}
          ${row("Work Performed", report.workPerformed)}
          ${row("Resolution", report.resolution)}
        </div>`;
      })
      .join("");
  } catch (err) {
    panel.innerHTML = `
      <div class="text-center text-muted small p-3">
        <p class="mb-2">${escHtml(dashboardLoadErrorMessage(err, "technical reports"))}</p>
        <button type="button" class="btn btn-sm btn-outline-primary" onclick="loadTechFeedbackReports()">Retry</button>
      </div>`;
  }
}

/* ── Load & display technician profile ─────────────────────── */
async function loadTechProfile() {
  const user = Auth.getUser();
  if (!user) return;

  const initial = (user.fullName || "T").charAt(0).toUpperCase();
  ["avatarInitial", "bannerInitial"].forEach((id) => {
    const avatar = document.getElementById(id);
    if (avatar && typeof applyProfileAvatar === "function") {
      applyProfileAvatar(user, avatar);
    } else {
      setText(id, initial);
    }
  });
  setText("topUserName", user.fullName);

  const myTech = await resolveMyTech();
  if (!myTech) return;

  setText("sidebarSpec", myTech.specialization || "ICT Support");
  setText("bannerSpec", myTech.specialization || "ICT Support");
  updateAvailabilityUI(myTech.available !== false);
}

/* Resolve the authenticated technician's profile deterministically via
   /technicians/me (keyed on the logged-in user's id — immune to duplicate or
   renamed fullNames). Falls back to the legacy list + fullName match only so
   the frontend still works against older backends. */
async function resolveMyTech() {
  try {
    const { data: me } = await apiRequest("/technicians/me");
    if (me) return me;
  } catch (_) {
    /* fall back to the list-based lookup */
  }

  try {
    const user = Auth.getUser();
    const { data: techs } = await apiRequest("/technicians");
    return techs.find((t) => t.fullName === user?.fullName) || null;
  } catch (_) {
    return null;
  }
}

/* ── Load tasks and populate dashboard ─────────────────────── */
async function loadDashboardTasks() {
  const tbody = document.getElementById("activeTasksBody");

  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="text-center py-4">
        <span class="spinner-border spinner-border-sm text-primary me-2" role="status"></span>
        Loading active tasks...
      </td></tr>`;
  }

  try {
    const { data } = await apiRequest("/technicians/my/assignments");
    if (!Array.isArray(data)) {
      throw new Error("The server returned an unexpected assignments response.");
    }

    const counts = {
      total: data.length,
      pending: 0,
      in_progress: 0,
      completed: 0,
    };
    data.forEach((r) => {
      if (
        ["submitted", "under_review", "assigned", "accepted"].includes(r.status)
      )
        counts.pending++;
      if (r.status === "in_progress") counts.in_progress++;
      if (["resolved", "closed"].includes(r.status)) counts.completed++;
    });

    setText("totalAssigned", counts.total);
    setText("pendingTasks", counts.pending);
    setText("inProgressTasks", counts.in_progress);
    setText("completedTasks", counts.completed);

    const pBadge = document.getElementById("pendingCount");
    if (pBadge) pBadge.textContent = counts.pending;

    setText("activeBannerCount", counts.pending + counts.in_progress);

    const activeTasks = data
      .filter((r) => !["resolved", "closed"].includes(r.status))
      .slice(0, 8);

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

    tbody.innerHTML = activeTasks
      .map(
        (r) => `
      <tr>
        <td class="ps-3"><strong class="text-primary">${escHtml(r.ticketId || r.ticket_id)}</strong></td>
        <td>
          <div class="fw-semibold" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
               title="${escHtml(r.title || "")}">
            ${escHtml(r.title || `Ticket ${r.ticketId}`)}
          </div>
          <small class="text-muted">${escHtml(r.equipmentType || "—")}${r.category ? ` · ${escHtml(r.category)}` : ""}</small>
          <div class="small"><span class="text-muted">Issue Type:</span> ${escHtml(r.issueType || r.serviceType || "—")}</div>
        </td>
        <td>${priorityBadge(r.priority || "medium")}</td>
        <td>${statusBadge(r.status)}</td>
        <td><small class="text-muted">${formatDate(r.assigned_at)}</small></td>
        <td class="pe-3">${renderTechActionButtons(r)}</td>
      </tr>`,
      )
      .join("");
  } catch (err) {
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">
      ${escHtml(dashboardLoadErrorMessage(err, "active tasks"))}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadDashboardTasks()">Retry</button>
    </td></tr>`;
  }
}

function dashboardLoadErrorMessage(err, section) {
  if (err?.status === 403) {
    return `You do not have permission to view ${section}.`;
  }
  if (err?.status === 503 && err?.data?.code === "MAINTENANCE_MODE") {
    return "The system is undergoing scheduled maintenance. Please try again later.";
  }
  if ([502, 503, 504].includes(err?.status)) {
    return `The service is temporarily unavailable, so ${section} could not be loaded. Your access token has not been cleared; please retry.`;
  }
  if (err?.network) {
    return `Unable to connect to the server to load ${section}. Check your connection and retry.`;
  }
  return `Unable to load ${section}. Please retry.`;
}

/* ── Recent activity panel ──────────────────────────────────── */
async function loadRecentActivity() {
  const panel = document.getElementById("recentActivityPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="text-center text-muted py-3">
      <span class="spinner-border spinner-border-sm" role="status"></span>
      <span class="visually-hidden">Loading recent activity...</span>
    </div>`;

  try {
    const data = await loadMyMaintenanceLog();

    if (!data || data.length === 0) {
      panel.innerHTML = `
        <div class="text-center text-muted py-3">
          <i class="bi bi-journal-x fs-2 d-block mb-2 opacity-50"></i>
          <small>No activity logged yet.</small>
        </div>`;
      return;
    }

    panel.innerHTML = data
      .slice(0, 5)
      .map(
        (a) => `
      <div class="d-flex gap-2 mb-3 pb-3 border-bottom">
        <div class="flex-shrink-0 mt-1">
          <span class="badge rounded-circle p-2 ${a.status === "resolved" ? "bg-success" : "bg-primary"}" style="width:10px;height:10px;"></span>
        </div>
        <div class="flex-grow-1">
          <div class="fw-semibold small">${escHtml(a.ticketId || `Ticket ${a.ticket_id || ""}`.trim())}</div>
          <div class="text-muted" style="font-size:.78rem;">${escHtml((a.action_taken || "").substring(0, 60))}${(a.action_taken || "").length > 60 ? "..." : ""}</div>
          <div class="text-muted" style="font-size:.72rem;">${timeAgo(a.created_at)}</div>
        </div>
        <div class="flex-shrink-0">${statusBadge(a.status)}</div>
      </div>`,
      )
      .join("");
  } catch (err) {
    panel.innerHTML = `<p class="text-muted small text-center py-2">
      ${escHtml(dashboardLoadErrorMessage(err, "recent activity"))}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadRecentActivity()">Retry</button></p>`;
  }
}

function updateAvailabilityUI(isAvailable) {
  const badge = document.getElementById("availabilityBadge");
  const sideBar = document.getElementById("availBadgeSidebar");
  const label = document.getElementById("availLabel");
  if (badge) {
    badge.innerHTML = `<i class="bi bi-circle-fill me-1" style="font-size:.5rem;"></i>${isAvailable ? "Available" : "Unavailable"}`;
    badge.className = `badge px-3 py-2 ${isAvailable ? "bg-success" : "bg-secondary"}`;
  }
  if (sideBar) {
    sideBar.textContent = "●";
    sideBar.className = `badge ms-auto ${isAvailable ? "bg-success" : "bg-secondary"}`;
  }
  if (label) label.textContent = isAvailable ? "Available" : "Unavailable";
}

/* ── View Ticket Details ────────────────────────────────────── */
function ticketErrorMessage(err) {
  if (!err) return "Unable to load ticket details. Please try again.";
  if (err.status === 404) return "Ticket details could not be found.";
  if (err.status === 403)
    return "Ticket details are no longer available or you are no longer assigned to this ticket.";
  return "Unable to load ticket details. Please try again.";
}

function renderAdminFeedbackForTechnician(feedback) {
  if (!feedback) return "";
  return `
    <div class="border-top mt-3 pt-3">
      <div class="d-flex align-items-center gap-2 mb-2">
        <i class="bi bi-clipboard2-check text-primary"></i>
        <strong class="small">Admin Feedback</strong>
        ${feedback.ticketStatus ? statusBadge(feedback.ticketStatus) : ""}
      </div>
      <div class="small p-3 bg-light rounded" style="white-space:pre-wrap;">${escHtml(feedback.adminComment || "No feedback message provided.")}</div>
      <div class="d-flex flex-wrap gap-3 mt-2 text-muted" style="font-size:.75rem;">
        <span><i class="bi bi-person-badge me-1"></i>${escHtml(feedback.admin_name || "ICT Admin")}</span>
        <span><i class="bi bi-ticket-detailed me-1"></i>${escHtml(feedback.ticketId || "Ticket")}</span>
        <span><i class="bi bi-clock me-1"></i>${feedback.submittedAt ? formatDateTime(feedback.submittedAt) : "—"}</span>
      </div>
      ${feedback.relatedAction ? `<div class="small text-muted mt-2"><strong>Related action:</strong> ${escHtml(feedback.relatedAction)}</div>` : ""}
      ${feedback.followUpRequired ? `<div class="alert alert-warning py-2 px-3 mt-2 mb-0 small"><i class="bi bi-arrow-repeat me-1"></i>Follow-up required${feedback.followUpNotes ? `: ${escHtml(feedback.followUpNotes)}` : ""}</div>` : ""}
    </div>`;
}

async function openViewDetails(requestId) {
  requestId = String(requestId || "").trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast(
      "Invalid or missing request ID. Reopen the task from the list.",
      "danger",
    );
    return;
  }

  const modalEl = document.getElementById("viewTicketModal");
  if (!modalEl) {
    showToast("View details window is not available on this page.", "warning");
    return;
  }

  const body = document.getElementById("viewTicketBody");
  if (body)
    body.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>`;

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
      ${r.title ? row("Title", escHtml(r.title)) : ""}
      ${row("Requester", escHtml(r.requester_name))}
      ${row("Department", escHtml(r.department))}
      ${row("Location", `<i class="bi bi-geo-alt me-1"></i>${escHtml(r.location || "Not provided")}`)}
      ${row("Equipment", escHtml(r.equipmentType))}
      ${r.category ? row("Category", escHtml(r.category)) : ""}
      ${r.issueType || r.serviceType ? row("Issue Type / Service Type", `<i class="bi bi-tools me-1"></i>${escHtml(r.issueType || r.serviceType)}`) : ""}
      ${r.asset_tag ? row("ICT Asset", `<i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}`) : ""}
      ${r.serialNumber ? row("Serial Number", escHtml(r.serialNumber)) : ""}
      ${row("Description", `<div style="white-space:pre-wrap;">${escHtml(r.problemDescription)}</div>`)}
      ${row("Assigned Technician", escHtml(r.assignedTechnician || "—"))}
      ${row("Priority", priorityBadge(r.priority))}
      ${row("Status", statusBadge(r.status))}
      ${row("Created", escHtml(formatDate(r.created_at)))}
      ${renderAdminFeedbackForTechnician(r.admin_feedback)}`;
  } catch (err) {
    if (body)
      body.innerHTML = `<div class="alert alert-danger mb-0">${escHtml(ticketErrorMessage(err))}</div>`;
  }
}

/* ── Update Task Modal ──────────────────────────────────────── */
async function openUpdateModal(requestId, title, currentStatus) {
  requestId = String(requestId || "").trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast(
      "Invalid or missing request ID. Reopen the task from the list.",
      "danger",
    );
    return;
  }

  document.getElementById("modalRequestId").value = requestId;
  document.getElementById("updateTaskModalLabel").textContent = title
    ? `Update: ${title}`
    : `Update Request #${requestId}`;

  /* Only show valid next statuses given the current ticket status. */
  const statusSel = document.getElementById("modalStatus");
  const validNext = {
    assigned: ["accepted", "in_progress"],
    accepted: ["in_progress"],
    in_progress: ["resolved"],
  };
  const allowed = validNext[currentStatus] || [];
  statusSel.innerHTML = allowed
    .map(
      (s) =>
        `<option value="${s}">${{ accepted: "Accept Task", in_progress: "Mark In Progress", resolved: "Mark as Resolved" }[s] || s}</option>`,
    )
    .join("") +
    `<option value="unchanged">Log work without changing status</option>`;
  statusSel.value = allowed.length
    ? allowed[allowed.length - 1]
    : "unchanged";
  statusSel.onchange = () => {
    if (statusSel.value === "unchanged") {
      showAlert(
        "updateTaskAlert",
        "Work will be logged without changing the ticket status.",
        "info",
      );
    } else {
      document.getElementById("updateTaskAlert")?.classList.add("d-none");
    }
  };

  document.getElementById("modalAction").value = "";
  document.getElementById("modalParts").value = "";
  document.getElementById("modalNotes").value = "";

  const alert = document.getElementById("updateTaskAlert");
  if (alert) alert.classList.add("d-none");

  const info = document.getElementById("modalTaskInfo");
  if (info) {
    info.innerHTML = `<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading request details...`;
    try {
      const { data: r } = await apiRequest(`/tickets/${requestId}`);
      const actualStatus = normalizeTicketStatus(r.status);
      const actualAllowed = validNext[actualStatus] || [];
      statusSel.innerHTML =
        actualAllowed
          .map(
            (s) =>
              `<option value="${s}">${{ accepted: "Accept Task", in_progress: "Mark In Progress", resolved: "Mark as Resolved" }[s] || s}</option>`,
          )
          .join("") +
        `<option value="unchanged">Log work without changing status</option>`;
      statusSel.value = actualAllowed.length
        ? actualAllowed[actualAllowed.length - 1]
        : "unchanged";
      info.innerHTML = `
        <div class="row g-2">
          <div class="col-sm-6"><span class="text-muted small d-block">Title</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
          <div class="col-sm-3"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
          <div class="col-sm-3"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
          ${r.asset_tag ? `<div class="col-sm-6"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}</strong></div>` : ""}
          <div class="col-sm-6"><span class="text-muted small d-block"><i class="bi bi-geo-alt me-1"></i>Location</span><strong>${escHtml(r.location || "Not provided")}</strong></div>
          
          ${r.category ? `<div class="col-sm-6"><span class="text-muted small d-block">Category</span><strong>${escHtml(r.category)}</strong></div>` : ""}
          ${r.issueType || r.serviceType ? `<div class="col-sm-6"><span class="text-muted small d-block">Issue Type / Service Type</span><strong>${escHtml(r.issueType || r.serviceType)}</strong></div>` : ""}
          <div class="col-12"><span class="text-muted small d-block">Reported problem</span>
            <div class="small p-2 bg-white border rounded" style="max-height:80px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
        </div>`;
    } catch (_) {
      info.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
    }
  }

  const saveBtn = document.getElementById("saveUpdateBtn");
  saveBtn.onclick = () => saveTaskUpdate(requestId);

  const modalEl = document.getElementById("updateTaskModal");
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();
}

async function saveTaskUpdate(requestId) {
  const status = document.getElementById("modalStatus").value;
  const action = document.getElementById("modalAction").value.trim();
  const parts = document.getElementById("modalParts").value.trim();
  const notes = document.getElementById("modalNotes").value.trim();

  if (!requestId || !/^[0-9a-f]{24}$/i.test(String(requestId).trim())) {
    showAlert(
      "updateTaskAlert",
      "Invalid or missing request ID. Please reopen the task and try again.",
      "warning",
    );
    return;
  }

  if (!status || !action) {
    showAlert(
      "updateTaskAlert",
      !status ? "Please select a status." : "Please describe the action taken.",
      "warning",
    );
    return;
  }
  if (document.getElementById("saveUpdateBtn").disabled) return;

  setLoading("saveUpdateBtn", "saveUpdateSpinner", true);

  try {
    await updateTicketStatusWithMaintenanceDetails(requestId, status, {
      actionTaken: action,
      partsUsed: parts || null,
      notes: notes || null,
    });
    invalidateMyMaintenanceCache();

    showToast("Task updated successfully!", "success");
    bootstrap.Modal.getInstance(
      document.getElementById("updateTaskModal"),
    )?.hide();
    await loadDashboardTasks();
    await loadRecentActivity();
  } catch (err) {
    showAlert("updateTaskAlert", err.message, "danger");
  } finally {
    setLoading("saveUpdateBtn", "saveUpdateSpinner", false);
  }
}

/* ═══════════════════════════════════════════════════════════
   ASSIGNED REQUESTS PAGE
   ═══════════════════════════════════════════════════════════ */
let _assignedRequestsBound = false;
/* Module scope, not function scope. The filter listener below is bound exactly
   once but is re-entered by the Retry button, so a function-local `all` would
   keep pointing at the first (possibly empty) fetch while later loads replaced
   the list on screen — the Filter button would then blank a list that was
   visibly populated. */
let _assignedAll = [];

async function initAssignedRequests() {
  if (!requireRole("Technician")) return;

  try {
    _assignedAll = await fetchAssignedRequests();
  } catch (err) {
    const container = document.getElementById("assignedRequestsList");
    if (container) {
      container.innerHTML = `<div class="col-12 text-center text-muted py-5">
        <i class="bi bi-exclamation-triangle fs-1 text-danger d-block mb-2"></i>
        <p>Failed to load assigned requests. ${escHtml(err.message || "")}</p>
        <button type="button" class="btn btn-outline-primary" onclick="initAssignedRequests()">Retry</button>
      </div>`;
    }
  }

  /* The Retry button above re-enters this function, so bind the save handler
     once to prevent duplicate status updates and maintenance records. */
  if (_assignedRequestsBound) {
    const deepLinkId = new URLSearchParams(window.location.search).get("id");
    if (deepLinkId && /^[0-9a-f]{24}$/i.test(deepLinkId))
      openViewDetails(deepLinkId);
    return;
  }
  _assignedRequestsBound = true;

  document.getElementById("filterBtn")?.addEventListener("click", () => {
    const q = document.getElementById("searchInput")?.value.toLowerCase() || "";
    const st = document.getElementById("statusFilter")?.value || "";
    const pr = document.getElementById("priorityFilter")?.value || "";
    renderAssignedCards(
      _assignedAll.filter(
        (r) =>
          (!q ||
            (r.title || "").toLowerCase().includes(q) ||
            String(r.ticket_id).includes(q)) &&
          (!st || r.status === st) &&
          (!pr || (r.priority || "medium") === pr),
      ),
    );
  });

  document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("filterBtn")?.click();
  });

  initTechActionDelegation();
  initFeedbackHandlers();

  document
    .getElementById("saveTaskUpdateBtn")
    ?.addEventListener("click", async () => {
      const requestId = (
        document.getElementById("taskRequestId").value || ""
      ).trim();
      const status = document.getElementById("newStatus").value;
      const action = document.getElementById("actionTaken").value.trim();
      const parts = document.getElementById("partsUsed").value.trim();
      const notes = document.getElementById("techNotes").value.trim();

      if (document.getElementById("saveTaskUpdateBtn").disabled) return;
      if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
        showAlert(
          "taskUpdateAlert",
          "Invalid or missing request ID. Please reopen the task and try again.",
          "warning",
        );
        return;
      }

      if (!status || !action) {
        showAlert(
          "taskUpdateAlert",
          "Status and action taken are required.",
          "warning",
        );
        return;
      }
      setLoading("saveTaskUpdateBtn", "saveTaskSpinner", true);
      try {
        await updateTicketStatusWithMaintenanceDetails(requestId, status, {
          actionTaken: action,
          partsUsed: parts || null,
          notes: notes || null,
        });
        invalidateMyMaintenanceCache();
        showToast("Task updated!", "success");
        bootstrap.Modal.getInstance(
          document.getElementById("taskModal"),
        )?.hide();
        _assignedAll = await fetchAssignedRequests();
      } catch (err) {
        showAlert("taskUpdateAlert", err.message, "danger");
      } finally {
        setLoading("saveTaskUpdateBtn", "saveTaskSpinner", false);
      }
    });

  /* Deep link support: assigned-requests.html?id=<ticketId> (used by the
     notification bell/page so the related ticket opens automatically). */
  const deepLinkId = new URLSearchParams(window.location.search).get("id");
  if (deepLinkId && /^[0-9a-f]{24}$/i.test(deepLinkId))
    openViewDetails(deepLinkId);
}

async function initTechFeedbackPage() {
  if (!requireRole("Technician")) return;
  initTechnicianSuggestionForm();
  await loadTechProfile();

  await loadMyTechnicianFeedback();
}

const TECHNICIAN_FEEDBACK_CATEGORY_GROUPS = [
  {
    group: "ICT Support",
    categories: [
      "Hardware",
      "Software",
      "Network",
      "Printer & Scanner",
      "Account & Access",
      "Email",
      "Internet",
      "Security",
      "System & Operating System",
      "Application",
      "Data & Storage",
      "Mobile & Device",
      "Audio & Video",
      "ICT Infrastructure",
      "Other",
      "Computer & End-User Services",
    ],
  },
  {
    group: "Feedback",
    categories: [
      "Technical Issues",
      "Maintenance Process",
      "Equipment and Tools",
      "System Usability",
      "Resource Requests",
      "Workload and Scheduling",
      "Security Concerns",
      "Suggestions for Improvement",
      "Other",
    ],
  },
];

function initTechnicianSuggestionForm() {
  const form = document.getElementById("technicianFeedbackForm");
  const button = document.getElementById("submitTechnicianFeedbackBtn");
  const notice = document.getElementById("technicianFeedbackNotice");
  const categorySelect = document.getElementById("technicianFeedbackCategory");
  if (
    !form ||
    !button ||
    !notice ||
    !categorySelect ||
    form.dataset.bound === "true"
  )
    return;
  form.dataset.bound = "true";

  const ratingInputs = Array.from(
    form.querySelectorAll('input[name="technicianFeedbackRating"]'),
  );
  const ratingDescription = document.getElementById(
    "technicianFeedbackRatingDescription",
  );
  const clearRatingButton = document.getElementById(
    "clearTechnicianFeedbackRating",
  );
  const messageInput = document.getElementById("technicianFeedbackMessage");
  const characterCount = document.getElementById(
    "technicianFeedbackCharacterCount",
  );

  TECHNICIAN_FEEDBACK_CATEGORY_GROUPS.forEach(({ group, categories }) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = `${group}::${category}`;
      option.textContent = category;
      optgroup.appendChild(option);
    });
    categorySelect.appendChild(optgroup);
  });

  const ratingLabels = [
    "",
    "Very Poor",
    "Poor",
    "Average",
    "Good",
    "Excellent",
  ];
  const updateStarRating = () => {
    const selectedRating = Number(
      ratingInputs.find((input) => input.checked)?.value || 0,
    );
    form.querySelectorAll(".technician-feedback-star").forEach((star, index) => {
      star.classList.toggle("is-selected", index < selectedRating);
    });
    if (ratingDescription) {
      ratingDescription.textContent = selectedRating
        ? `${selectedRating} star${selectedRating === 1 ? "" : "s"} — ${ratingLabels[selectedRating]}`
        : "No rating selected. Rating is optional.";
    }
  };
  ratingInputs.forEach((input) =>
    input.addEventListener("change", updateStarRating),
  );
  clearRatingButton?.addEventListener("click", () => {
    ratingInputs.forEach((input) => {
      input.checked = false;
    });
    updateStarRating();
  });

  const updateCharacterCount = () => {
    const length = messageInput.value.length;
    characterCount.textContent = `${length.toLocaleString()} / 2,000`;
    characterCount.classList.toggle("is-near-limit", length >= 1800);
  };
  messageInput.addEventListener("input", updateCharacterCount);
  form.addEventListener("reset", () => requestAnimationFrame(updateCharacterCount));

  let submitting = false;
  let noticeTimer;
  const showNotice = (message, type) => {
    clearTimeout(noticeTimer);
    notice.className = `alert alert-${type}`;
    notice.textContent = message;
    if (type === "success") {
      noticeTimer = setTimeout(() => notice.classList.add("d-none"), 4000);
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    const selectedCategory = categorySelect.value;
    const separatorIndex = selectedCategory.indexOf("::");
    const categoryGroup =
      separatorIndex < 0 ? "" : selectedCategory.slice(0, separatorIndex);
    const category =
      separatorIndex < 0 ? "" : selectedCategory.slice(separatorIndex + 2);
    const message = document
      .getElementById("technicianFeedbackMessage")
      .value.trim();
    const rating = ratingInputs.find((input) => input.checked)?.value || "";
    if (!category || !message) {
      showNotice("Choose a category and enter a feedback message.", "warning");
      return;
    }
    if (message.length > 2000) {
      showNotice("Feedback must be no more than 2,000 characters.", "warning");
      return;
    }

    submitting = true;
    button.disabled = true;
    button.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Submitting...';
    button.setAttribute("aria-busy", "true");
    notice.classList.add("d-none");

    try {
      const result = await apiRequest("/feedback/technician", {
        method: "POST",
        body: {
          categoryGroup,
          category,
          message,
          ...(rating ? { rating: Number(rating) } : {}),
        },
      });
      if (result?.success !== true || !result.data?.id) {
        throw new Error(
          result?.message || "The feedback was not confirmed as saved.",
        );
      }
      form.reset();
      updateStarRating();
      showNotice("Feedback submitted successfully!", "success");
      await loadMyTechnicianFeedback();
    } catch (err) {
      showNotice(
        err.message || "Unable to submit feedback. Please try again.",
        "danger",
      );
    } finally {
      submitting = false;
      button.disabled = false;
      button.innerHTML =
        '<i class="bi bi-send me-1" aria-hidden="true"></i>Submit Feedback';
      button.removeAttribute("aria-busy");
    }
  });
}

async function loadMyTechnicianFeedback() {
  const container = document.getElementById("technicianFeedbackHistory");
  if (!container) return;
  if (container.dataset.retryBound !== "true") {
    container.dataset.retryBound = "true";
    container.addEventListener("click", (event) => {
      if (event.target.closest("[data-retry-feedback-history]"))
        loadMyTechnicianFeedback();
    });
  }
  container.setAttribute("aria-busy", "true");
  container.innerHTML = '<p class="text-muted mb-0">Loading your feedback history...</p>';

  try {
    const result = await apiRequest("/feedback/technician/mine");
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load your feedback history.");
    }
    if (!result.data.length) {
      container.innerHTML = `
        <div class="text-center py-4">
          <i class="bi bi-chat-square-text fs-2 text-muted d-block mb-2" aria-hidden="true"></i>
          <p class="fw-semibold mb-1">No feedback submitted yet</p>
          <p class="small text-muted mb-0">Your feedback submissions will appear here.</p>
        </div>`;
      return;
    }

    const ratingNames = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];
    container.innerHTML = result.data
      .map((item) => {
        const ticket = item.ticket;
        const rating =
          Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5
            ? `<span role="img" aria-label="${item.rating} out of 5 stars: ${ratingNames[item.rating]}">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</span><span class="small text-muted ms-1">${item.rating}/5 · ${escHtml(ratingNames[item.rating])}</span>`
            : '<span class="small text-muted">Not rated</span>';
        const fullMessage = String(item.message || "");
        const messagePreview =
            fullMessage.length > 220
              ? `${fullMessage.slice(0, 217).trimEnd()}...`
              : fullMessage;
        const request = ticket
          ? `<strong>${escHtml(ticket.ticketId || "Maintenance request")}</strong>${
              ticket.title ? `<span class="d-block small">${escHtml(ticket.title)}</span>` : ""
            }${
              ticket.category
                ? `<span class="d-block small text-muted">Request category: ${escHtml(ticket.category.split(">").pop().trim())}</span>`
                : ""
            }`
          : "No related request";
        const submitted = item.createdAt
          ? new Date(item.createdAt).toLocaleString()
          : "—";
        const reference = item._id
          ? `FB-${String(item._id).slice(-8).toUpperCase()}`
          : "Feedback reference unavailable";
        const status = item.status || "Pending";
        const statusClass = status === "Reviewed" ? "text-bg-success" : "text-bg-warning";
        const priority = ticket?.priority
          ? `<span class="badge text-bg-${{
              low: "success",
              medium: "primary",
              high: "warning",
              critical: "danger",
            }[ticket.priority] || "secondary"}">${escHtml(ticket.priority)} priority</span>`
          : "";
        const adminResponse =
          item.adminResponse || item.adminComment || item.response || "";
        return `<article class="technician-feedback-record">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div class="min-w-0">
              <div class="small text-muted feedback-reference">${escHtml(reference)}</div>
              <h3 class="h6 fw-bold mb-0">${escHtml(item.category || "Feedback")}</h3>
            </div>
            <div class="d-flex flex-wrap align-items-center justify-content-end gap-2">
              ${priority}
              <span class="badge ${statusClass}">${escHtml(status)}</span>
            </div>
          </div>
          <p class="mb-0">${escHtml(messagePreview || "No message provided.")}</p>
          <dl class="feedback-record-meta mb-0 small">
            <div>
              <dt class="text-muted fw-normal">Rating</dt>
              <dd>${rating}</dd>
            </div>
            <div>
              <dt class="text-muted fw-normal">Submitted</dt>
              <dd><time>${escHtml(submitted)}</time></dd>
            </div>
          </dl>
          <details class="technician-feedback-details">
            <summary>View details</summary>
            <div class="technician-feedback-message-full">${escHtml(fullMessage || "No message provided.")}</div>
            <dl class="feedback-record-meta mb-0 small">
              <div>
                <dt class="text-muted fw-normal">Related Maintenance Request</dt>
                <dd>${request}</dd>
              </div>
              ${adminResponse ? `<div><dt class="text-muted fw-normal">ICT Admin response</dt><dd>${escHtml(adminResponse)}</dd></div>` : ""}
            </dl>
          </details>
        </article>`;
      })
      .join("");
  } catch (err) {
    const message =
      err.status === 404
        ? "The configured API returned 404 for the technician feedback history route. The backend deployment may be missing this route."
        : err.status === 401 || err.status === 403
          ? err.message || "Your account is not authorized to view this feedback history."
          : err.message || "A network or server error prevented feedback history from loading.";
    container.innerHTML = `<div class="alert alert-danger mb-0" role="alert">
      <p class="mb-2"><strong>Unable to load your feedback history.</strong> ${escHtml(message)}</p>
      <button type="button" class="btn btn-sm btn-outline-danger" data-retry-feedback-history>
        <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Try again
      </button>
    </div>`;
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

async function fetchAssignedRequests() {
  const { data } = await apiRequest("/technicians/my/assignments");
  renderAssignedCards(data);

  setText("totalAssigned", data.length);
  setText(
    "pendingTasks",
    data.filter((r) =>
      ["submitted", "under_review", "assigned", "accepted"].includes(r.status),
    ).length,
  );
  setText(
    "inProgressTasks",
    data.filter((r) => r.status === "in_progress").length,
  );
  setText(
    "completedTasks",
    data.filter((r) => ["resolved", "closed"].includes(r.status)).length,
  );
  return data;
}

function renderAssignedCards(assignments) {
  const container = document.getElementById("assignedRequestsList");
  if (!container) return;

  if (!assignments.length) {
    container.innerHTML = `
      <div class="col-12 text-center py-5">
        <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i>
        <p class="text-muted">No assigned requests found.</p>
      </div>`;
    return;
  }

  const borderColours = {
    critical: "#dc3545",
    high: "#fd7e14",
    medium: "#2563eb",
    low: "#198754",
  };

  container.innerHTML = assignments
    .map(
      (r) => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100"
           style="border-left:4px solid ${borderColours[r.priority || "medium"]}!important;">
        <div class="card-body p-3">
          <div class="d-flex justify_content-between align-items-start mb-2">
            <span class="text-muted small fw-semibold">${escHtml(r.ticketId || r.ticket_id)}</span>
            ${priorityBadge(r.priority || "medium")}
          </div>
          <h6 class="fw-semibold mb-1" style="line-height:1.3;">
            ${escHtml(r.title || `Ticket ${r.ticketId}`)}
          </h6>
          <div class="text-muted small mb-2">
            <i class="bi bi-tag me-1"></i>${escHtml(r.equipmentType || "—")}${r.category ? ` · ${escHtml(r.category)}` : ""}
            ${r.department ? `&nbsp;·&nbsp;<i class="bi bi-building me-1"></i>${escHtml(r.department)}` : ""}
          </div>
          <div class="small mb-2"><span class="text-muted">Issue Type:</span> ${escHtml(r.issueType || r.serviceType || "—")}</div>
          <div class="text-muted small mb-2"><i class="bi bi-geo-alt me-1"></i>${escHtml(r.location || "Not provided")}</div>
          <div class="mb-2">${statusBadge(r.status)}</div>
          <div class="text-muted" style="font-size:.78rem;">
            <i class="bi bi-calendar3 me-1"></i>Assigned: ${formatDate(r.assigned_at)}
          </div>
        </div>
        <div class="card-footer bg-transparent border-top-0 px-3 pb-3">
          <div class="d-grid gap-2">${renderTechActionButtons(r)}</div>
        </div>
      </div>
    </div>`,
    )
    .join("");
}

function openTaskModal(requestId, title, currentStatus) {
  requestId = String(requestId || "").trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast(
      "Invalid or missing request ID. Reopen the task from the list.",
      "danger",
    );
    return;
  }

  document.getElementById("taskRequestId").value = requestId;
  document.getElementById("taskModalLabel").textContent =
    `Update: ${title || `Request #${requestId}`}`;
  document.getElementById("newStatus").value =
    currentStatus === "in_progress" || currentStatus === "accepted"
      ? "resolved"
      : "in_progress";
  document.getElementById("actionTaken").value = "";
  document.getElementById("partsUsed").value = "";
  document.getElementById("techNotes").value = "";
  const alert = document.getElementById("taskUpdateAlert");
  if (alert) alert.classList.add("d-none");
  loadTaskInfoSection(requestId, "taskInfoSection").then((ticket) => {
    if (
      !ticket ||
      document.getElementById("taskRequestId").value !== requestId
    ) {
      return;
    }

    const actualStatus = normalizeTicketStatus(ticket.status);
    const nextStatuses = {
      assigned: ["accepted", "in_progress"],
      accepted: ["in_progress"],
      in_progress: ["resolved"],
    }[actualStatus] || [];
    const labels = {
      accepted: "Accept Task",
      in_progress: "Mark In Progress",
      resolved: "Mark as Resolved",
    };
    const statusSelect = document.getElementById("newStatus");
    statusSelect.innerHTML =
      nextStatuses
        .map(
          (status) =>
            `<option value="${status}">${labels[status] || status}</option>`,
        )
        .join("") +
      `<option value="unchanged">Log work without changing status</option>`;
    statusSelect.value = nextStatuses.length
      ? nextStatuses[nextStatuses.length - 1]
      : "unchanged";
  });

  const statusSelect = document.getElementById("newStatus");
  statusSelect.onchange = () => {
    if (statusSelect.value === "unchanged") {
      showAlert(
        "taskUpdateAlert",
        "Work will be logged without changing the ticket status.",
        "info",
      );
    } else {
      document.getElementById("taskUpdateAlert")?.classList.add("d-none");
    }
  };

  const modalEl = document.getElementById("taskModal");
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();
}

async function loadTaskInfoSection(requestId, sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return null;
  section.innerHTML = `<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;
  try {
    const { data: r } = await apiRequest(`/tickets/${requestId}`);
    section.innerHTML = `
      <div class="row g-2">
        <div class="col-6"><span class="text-muted small d-block">Title</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
        <div class="col-3"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
        <div class="col-3"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
        <div class="col-sm-6"><span class="text-muted small d-block">Equipment</span>${escHtml(r.equipmentType || "—")}</div>
        <div class="col-sm-6"><span class="text-muted small d-block">Category</span>${escHtml(r.category || "—")}</div>
        <div class="col-sm-6"><span class="text-muted small d-block">Issue Type / Service Type</span>${escHtml(r.issueType || r.serviceType || "—")}</div>
        ${r.asset_tag ? `<div class="col-sm-6"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}</strong></div>` : ""}
        <div class="col-sm-6"><span class="text-muted small d-block"><i class="bi bi-geo-alt me-1"></i>Location</span><strong>${escHtml(r.location || "Not provided")}</strong></div>
        <div class="col-12"><span class="text-muted small d-block">Description</span>
          <div class="small p-2 bg-light rounded" style="max-height:70px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
        </div>
      </div>`;
    return r;
  } catch (_) {
    section.innerHTML = `<span class="text-muted small">Request #${requestId}</span>`;
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════
   MAINTENANCE REPORT (Technician Feedback)
   ═══════════════════════════════════════════════════════════ */
let _fbMode = "add"; // 'add' | 'edit'
let _fbRequestId = null;
let _fbSubmitting = false;

function getFeedbackStatusSelect() {
  return (
    document.getElementById("fbRepairResult") ||
    document.getElementById("fbResultStatus") ||
    document.getElementById("fbStatus")
  );
}

function feedbackRepairResult(report) {
  const result =
    report?.repairResult ||
    ({
      Fixed: "Resolved",
      "In Progress": "Partially Resolved",
      "Not Fixed": "Not Resolved",
    }[report?.status] || "")
  return result === "Unresolved" ? "Not Resolved" : result;
}

function feedbackLegacyStatus(result) {
  return (
    {
      Resolved: "Fixed",
      "Partially Resolved": "In Progress",
      "Not Resolved": "Not Fixed",
      Unresolved: "Not Fixed",
      "Pending Further Action": "In Progress",
    }[result] || ""
  );
}

let _fbHandlersBound = false;
function initFeedbackHandlers() {
  if (_fbHandlersBound) return;
  _fbHandlersBound = true;

  const saveBtn = document.getElementById("saveFeedbackBtn");
  if (saveBtn) saveBtn.addEventListener("click", () => submitFeedback());

  const statusSel = getFeedbackStatusSelect();
  if (statusSel)
    statusSel.addEventListener("change", () => {
      statusSel.classList.remove("is-invalid");
      updateFeedbackReasonVisibility();
      updateFeedbackPreview();
    });

  // Live preview updates
  ["fbDiagnosis", "fbWorkPerformed", "fbResolution"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateFeedbackPreview);
  });

  // Warn before closing the form if it has unsaved changes
  const modalEl = document.getElementById("feedbackModal");
  if (modalEl) {
    modalEl.addEventListener("hide.bs.modal", (e) => {
      const dirty = [
        "fbDiagnosis",
        "fbWorkPerformed",
        "fbResolution",
        "fbPartsUsed",
        "fbTimeSpent",
        "fbRepairResult",
        "fbFollowUpRequired",
        "fbReasonNotFixed",
        "fbRecommendation",
        "fbTechnicianNotes",
      ].some((id) => {
        const field = document.getElementById(id);
        return field && String(field.value || "").trim() !== "";
      });
      if (_fbSubmitting || !dirty) return;
      if (!confirm("This report has unsaved changes. Discard and close?")) {
        e.preventDefault();
      }
    });
  }
}

function updateFeedbackPreview() {
  const diagnosis = document.getElementById("fbDiagnosis")?.value.trim() || "";
  const actionTaken =
    document.getElementById("fbWorkPerformed")?.value.trim() || "";
  const result = getFeedbackStatusSelect()?.value || "";
  const resolution =
    document.getElementById("fbResolution")?.value.trim() || "";
  const previewEl = document.getElementById("feedbackPreview");

  if (!previewEl) return;

  const parts = [];
  if (diagnosis) parts.push(`Diagnosis: ${diagnosis}`);
  if (actionTaken) parts.push(`Action: ${actionTaken}`);
  if (result) parts.push(`Status: ${result}`);
  if (resolution) parts.push(`Result: ${resolution}`);

  previewEl.textContent =
    parts.join(" | ") ||
    "Fill in the fields above to see a live preview of your feedback.";
}

function updateFeedbackReasonVisibility() {
  const status = getFeedbackStatusSelect()?.value;
  const wrap = document.getElementById("fbReasonWrap");
  const reason = document.getElementById("fbReasonNotFixed");
  if (!wrap || !reason) return;
  const required =
    status === "Not Resolved" ||
    status === "Unresolved" ||
    status === "Not Fixed";
  wrap.classList.toggle("d-none", !required);
  reason.required = required;
  if (!required) reason.value = "";
}

function resetFeedbackForm() {
  [
    "fbDiagnosis",
    "fbWorkPerformed",
    "fbResolution",
    "fbPartsUsed",
    "fbTimeSpent",
    "fbRepairResult",
    "fbFollowUpRequired",
    "fbReasonNotFixed",
    "fbRecommendation",
    "fbTechnicianNotes",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const status = getFeedbackStatusSelect();
  if (status) {
    status.value = status.querySelector('option[value=""]')
      ? ""
      : status.options[0]?.value || "";
  }
  const confirmed = document.getElementById("fbConfirmed");
  if (confirmed) confirmed.checked = false;
  const alert = document.getElementById("feedbackAlert");
  if (alert) {
    alert.classList.add("d-none");
    alert.textContent = "";
  }
  updateFeedbackReasonVisibility();
  updateFeedbackPreview();
}

async function openFeedbackModal(requestId, title) {
  requestId = String(requestId || "").trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast(
      "Invalid or missing request ID. Reopen the task from the list.",
      "danger",
    );
    return;
  }
  _fbMode = "add";
  _fbRequestId = requestId;
  resetFeedbackForm();
  // Store the RAW Ticket _id (never the "#..." display reference) so the
  // submit handler can only ever target the real MongoDB document.
  document.getElementById("feedbackRequestId").value = requestId;
  const modalEl = document.getElementById("feedbackModal");
  if (modalEl) modalEl.dataset.ticketId = requestId;
  // "#..." is purely cosmetic — it is never parsed back to build an API call.
  const label = document.getElementById("feedbackModalLabel");
  if (label)
    label.textContent = `Add Technician Feedback: ${title || `#${requestId}`}`;

  const info = document.getElementById("feedbackTaskInfo");
  if (info) {
    info.innerHTML = `<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading request details...`;
    try {
      const { data: r } = await apiRequest(
        `/tickets/${encodeURIComponent(requestId)}`,
      );
      info.innerHTML = `
        <div class="row g-2">
          <div class="col-sm-4"><span class="text-muted small d-block">Ticket</span><strong>${escHtml(r.ticketId || r.id)}</strong></div>
          <div class="col-sm-4"><span class="text-muted small d-block">Priority</span>${priorityBadge(r.priority)}</div>
          <div class="col-sm-4"><span class="text-muted small d-block">Status</span>${statusBadge(r.status)}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Equipment</span>${escHtml(r.equipmentType || "—")}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Category</span>${escHtml(r.category || "—")}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Issue Type / Service Type</span>${escHtml(r.issueType || r.serviceType || "—")}</div>
          <div class="col-sm-6"><span class="text-muted small d-block">Requester</span>${escHtml(r.requester_name || "—")}</div>
          <div class="col-sm-6"><span class="text-muted small d-block"><i class="bi bi-geo-alt me-1"></i>Location</span><strong>${escHtml(r.location || "Not provided")}</strong></div>
          ${r.asset_tag ? `<div class="col-12"><span class="text-muted small d-block">ICT Asset</span><strong><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}</strong></div>` : ""}
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

  const m = bootstrap.Modal.getInstance(
    document.getElementById("feedbackModal"),
  );
  if (!m) new bootstrap.Modal(document.getElementById("feedbackModal")).show();
  else m.show();

  // Initialize live preview after modal is shown
  setTimeout(updateFeedbackPreview, 100);
}

async function openEditFeedbackModal(requestId, title, report) {
  requestId = String(requestId || "").trim();
  _fbMode = "edit";
  _fbRequestId = requestId;
  document.getElementById("feedbackRequestId").value = requestId;
  const modalEl = document.getElementById("feedbackModal");
  if (modalEl) modalEl.dataset.ticketId = requestId;

  resetFeedbackForm();

  if (!report) {
    try {
      const { data } = await apiRequest(
        `/tickets/${encodeURIComponent(requestId)}/technician-feedback`,
      );
      report = data;
    } catch (_) {
      report = null;
    }
  }
  if (!report) {
    showToast("Could not load the report to edit.", "warning");
    return;
  }

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || "";
  };
  set("fbDiagnosis", report.diagnosis);
  set("fbWorkPerformed", report.workPerformed);
  set("fbResolution", report.resolution);
  set("fbPartsUsed", report.partsUsed);
  set("fbReasonNotFixed", report.reasonNotFixed);
  set("fbRecommendation", report.recommendation);
  set("fbTechnicianNotes", report.technicianNotes);
  const status = getFeedbackStatusSelect();
  if (status) status.value = feedbackRepairResult(report);
  const timeSpent = document.getElementById("fbTimeSpent");
  if (timeSpent) timeSpent.value = report.timeSpentMinutes ?? "";
  const followUp = document.getElementById("fbFollowUpRequired");
  if (followUp) {
    followUp.value =
      report.followUpRequired === true
        ? "yes"
        : report.followUpRequired === false
          ? "no"
          : "";
  }
  const confirmed = document.getElementById("fbConfirmed");
  if (confirmed) confirmed.checked = true;
  updateFeedbackReasonVisibility();
  const label = document.getElementById("feedbackModalLabel");
  if (label)
    label.textContent = `Edit Technician Feedback: ${title || `#${requestId}`}`;

  const m = bootstrap.Modal.getInstance(
    document.getElementById("feedbackModal"),
  );
  if (!m) new bootstrap.Modal(document.getElementById("feedbackModal")).show();
  else m.show();

  // Initialize live preview after modal is shown and form is populated
  setTimeout(updateFeedbackPreview, 100);
}

async function submitFeedback() {
  if (_fbSubmitting) return;

  const id = (document.getElementById("feedbackRequestId").value || "").trim();
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) {
    showAlert(
      "feedbackAlert",
      "Invalid or missing request ID. Please reopen the task.",
      "warning",
    );
    return;
  }

  const statusSelect = getFeedbackStatusSelect();
  const confirmation = document.getElementById("fbConfirmed");
  const repairResult = statusSelect?.value || "";
  const timeSpentMinutes = Number(
    document.getElementById("fbTimeSpent")?.value,
  );
  const followUpValue =
    document.getElementById("fbFollowUpRequired")?.value || "";
  const body = {
    diagnosis: document.getElementById("fbDiagnosis").value.trim(),
    workPerformed: document.getElementById("fbWorkPerformed").value.trim(),
    repairResult,
    status: feedbackLegacyStatus(repairResult),
    timeSpentMinutes,
    followUpRequired: followUpValue === "yes",
    resolution: document.getElementById("fbResolution").value.trim(),
    partsUsed: document.getElementById("fbPartsUsed")?.value.trim() || "",
    reasonNotFixed:
      document.getElementById("fbReasonNotFixed")?.value.trim() || "",
    recommendation:
      document.getElementById("fbRecommendation")?.value.trim() || "",
    technicianNotes:
      document.getElementById("fbTechnicianNotes")?.value.trim() || "",
  };

  if (!body.diagnosis)
    return showAlert(
      "feedbackAlert",
      "Diagnosis / identified problem is required.",
      "warning",
    );
  if (!body.workPerformed)
    return showAlert("feedbackAlert", "Work performed is required.", "warning");
  if (!body.resolution)
    return showAlert(
      "feedbackAlert",
      "Resolution summary is required.",
      "warning",
    );
  if (!repairResult) {
    statusSelect?.classList.add("is-invalid");
    statusSelect?.focus();
    return showAlert(
      "feedbackAlert",
      "Current result/status is required.",
      "warning",
    );
  }
  statusSelect?.classList.remove("is-invalid");
  if (
    !Number.isInteger(timeSpentMinutes) ||
    timeSpentMinutes < 1 ||
    timeSpentMinutes > 10080
  )
    return showAlert(
      "feedbackAlert",
      "Enter time spent as a whole number of minutes between 1 and 10080.",
      "warning",
    );
  if (!followUpValue)
    return showAlert(
      "feedbackAlert",
      "Please select whether follow-up is required.",
      "warning",
    );
  if (
    ["Not Resolved", "Unresolved"].includes(repairResult) &&
    !body.reasonNotFixed
  )
    return showAlert(
      "feedbackAlert",
      "Please provide a reason why the issue is not fixed.",
      "warning",
    );
  if (confirmation && !confirmation.checked)
    return showAlert(
      "feedbackAlert",
      "Please confirm that this report accurately reflects the work performed.",
      "warning",
    );

  _fbSubmitting = true;
  setLoading("saveFeedbackBtn", "saveFeedbackSpinner", true);
  try {
    const method = _fbMode === "edit" ? "PUT" : "POST";
    // `id` is the raw MongoDB Ticket _id read from the hidden input. encode &
    // re-validate so a malformed "#.." / display value can never reach the API.
    const ticketId = (
      document.getElementById("feedbackRequestId").value || ""
    ).trim();
    if (!/^[0-9a-f]{24}$/i.test(ticketId)) {
      throw new Error(
        "Invalid or missing ticket ID. Please reopen the report and try again.",
      );
    }
    await apiRequest(
      `/tickets/${encodeURIComponent(ticketId)}/technician-feedback`,
      { method, body },
    );
    showToast(
      _fbMode === "edit"
      ? "Maintenance report updated."
      : "Maintenance report submitted.",
      "success",
    );
    bootstrap.Modal.getInstance(
      document.getElementById("feedbackModal"),
    )?.hide();
    _fbMode = "add";
    _fbRequestId = null;

    // A refresh failure must not turn a saved report into a submission error.
    try {
      if (window.location.pathname.includes("technician/dashboard")) {
        await loadDashboardTasks();
      } else {
        const listEl = document.getElementById("assignedRequestsList");
        const newData = await apiRequest("/technicians/my/assignments");
        if (listEl) renderAssignedCards(newData.data);
      }
    } catch (refreshError) {
      console.error(
        "Report saved, but refreshing the list failed:",
        refreshError,
      );
      showToast(
        "Report submitted successfully. Refresh the page to update the task list.",
        "warning",
      );
    }
  } catch (err) {
    showAlert("feedbackAlert", err.message, "danger");
  } finally {
    _fbSubmitting = false;
    setLoading("saveFeedbackBtn", "saveFeedbackSpinner", false);
  }
}

async function viewFeedbackReport(requestId) {
  requestId = String(requestId || "").trim();
  if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
    showToast("Invalid or missing request ID.", "danger");
    return;
  }

  const body = document.getElementById("viewReportBody");
  if (body)
    body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;
  const modalEl = document.getElementById("viewReportModal");
  const m = bootstrap.Modal.getInstance(modalEl);
  if (!m) new bootstrap.Modal(modalEl).show();
  else m.show();

  let title = "";
  let ticketLabel = requestId;
  try {
    const { data: r } = await apiRequest(
      `/tickets/${encodeURIComponent(requestId)}`,
    );
    title = r.title || r.ticketId || requestId;
    ticketLabel = r.ticketId || r.id || requestId;
  } catch (_) {}

  try {
    const { data: report } = await apiRequest(
      `/tickets/${encodeURIComponent(requestId)}/technician-feedback`,
    );
    if (body) body.innerHTML = renderReportView(report, title, ticketLabel);
    const editBtn = document.getElementById("editReportBtn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        bootstrap.Modal.getInstance(
          document.getElementById("viewReportModal"),
        )?.hide();
        setTimeout(() => openEditFeedbackModal(requestId, title), 200);
      });
    }
  } catch (err) {
    if (body)
      body.innerHTML = `<div class="alert alert-danger mb-0">${escHtml(err.message)}</div>`;
  }
}

function renderReportView(report, title, requestId) {
  const result = feedbackRepairResult(report);
  const statusBadgeHtml =
    result === "Resolved"
      ? '<span class="badge bg-success">Resolved</span>'
      : result === "Not Resolved"
        ? '<span class="badge bg-danger">Not Resolved</span>'
        : '<span class="badge bg-warning text-dark">Partially Resolved</span>';

  const message = [report.diagnosis, report.workPerformed, report.resolution]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="feedback-card">
      <div class="feedback-card-header">
        <h6 class="feedback-card-title">${escHtml(title || "Maintenance Report")}</h6>
        ${statusBadgeHtml}
      </div>
      <div class="feedback-card-body">
        <div class="text-muted small fw-semibold mb-1">Maintenance report summary</div>
        <div class="feedback-message">${escHtml(message || "No feedback message available.")}</div>
        <div class="feedback-meta">
          <span class="feedback-meta-item"><i class="bi bi-person"></i>${escHtml(report.technician_name || "Technician")}</span>
          <span class="feedback-meta-item"><i class="bi bi-calendar3"></i>${report.submittedAt ? formatDateTime(report.submittedAt) : "—"}</span>
          <span class="feedback-meta-item"><i class="bi bi-ticket-detailed"></i>${escHtml(requestId)}</span>
          <span class="feedback-meta-item"><i class="bi bi-stopwatch"></i>${report.timeSpentMinutes == null ? "—" : `${escHtml(report.timeSpentMinutes)} minutes`}</span>
        </div>
        <div class="feedback-detail-list mt-3">
          <div><strong>Reported problem</strong><span>${escHtml(report.reportedProblem || "—")}</span></div>
          <div><strong>Equipment / asset</strong><span>${escHtml(report.equipment_name || report.asset_tag || "—")}${report.asset_tag && report.equipment_name ? ` (${escHtml(report.asset_tag)})` : ""}</span></div>
          <div><strong>Diagnosis</strong><span>${escHtml(report.diagnosis || "—")}</span></div>
          <div><strong>Action taken</strong><span>${escHtml(report.workPerformed || "—")}</span></div>
          <div><strong>Repair result</strong><span>${escHtml(result || "—")}</span></div>
          <div><strong>Resolution summary</strong><span>${escHtml(report.resolution || "—")}</span></div>
          <div><strong>Parts / materials used</strong><span>${escHtml(report.partsUsed || "—")}</span></div>
          <div><strong>Follow-up required</strong><span>${report.followUpRequired ? "Yes" : "No"}</span></div>
          <div><strong>Additional notes</strong><span>${escHtml(report.technicianNotes || "—")}</span></div>
        </div>
      </div>
    </div>
    <div class="d-flex justify-content-end border-top pt-3 mt-3">
      <button type="button" class="btn btn-outline-primary btn-sm" id="editReportBtn">
        <i class="bi bi-pencil me-1"></i>Edit Maintenance Report
      </button>
    </div>
  `;
}

/* Ticket workflow transitions must be sent one validated step at a time. */
const _TICKET_STATUS_CHAIN = [
  "submitted",
  "under_review",
  "assigned",
  "accepted",
  "in_progress",
  "resolved",
  "closed",
];

function normalizeTicketStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

async function updateTicketStatusWithMaintenanceDetails(
  requestId,
  status,
  workDetails,
  currentStatus = null,
) {
  const actionTaken = String(workDetails.actionTaken || "").trim();
  if (!actionTaken) throw new Error("Action taken is required.");
  if (actionTaken.length > 1000)
    throw new Error("Action taken must be no more than 1,000 characters.");
  if (String(workDetails.partsUsed || "").length > 500)
    throw new Error("Parts / materials used must be no more than 500 characters.");
  if (String(workDetails.notes || "").length > 2000)
    throw new Error("Notes must be no more than 2,000 characters.");

  let normalizedCurrentStatus = currentStatus
    ? normalizeTicketStatus(currentStatus)
    : "";
  if (!normalizedCurrentStatus) {
    const { data: ticket } = await apiRequest(`/tickets/${requestId}`);
    normalizedCurrentStatus = normalizeTicketStatus(ticket.status);
  }
  const targetStatus =
    status === "unchanged"
      ? normalizedCurrentStatus
      : normalizeTicketStatus(status);
  const fromIdx = _TICKET_STATUS_CHAIN.indexOf(normalizedCurrentStatus);
  const toIdx = _TICKET_STATUS_CHAIN.indexOf(targetStatus);
  if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) {
    throw new Error("The selected status is not a valid forward transition.");
  }

  for (let i = fromIdx + 1; i <= toIdx; i++) {
    const step = _TICKET_STATUS_CHAIN[i];
    await apiRequest(`/tickets/${requestId}/status`, {
      method: "PATCH",
      body: {
        status: step,
        ...(i === toIdx ? workDetails : {}),
      },
    });
  }

  if (fromIdx === toIdx) {
    return apiRequest(`/tickets/${requestId}/status`, {
      method: "PATCH",
      body: { status: targetStatus, ...workDetails },
    });
  }
}

/* Bind the form + filter handlers once to prevent duplicate submissions. */
let _maintenanceLogBound = false;
let _maintenanceStatusRequestId = "";
let _maintenanceCurrentStatus = "";

function renderMaintenanceStatusHint() {
  const hint = document.getElementById("activityStatusMessage");
  const selectedStatus = document.getElementById("activityStatus")?.value || "";
  if (!hint) return;

  if (!_maintenanceCurrentStatus || !_maintenanceStatusRequestId) {
    hint.textContent = "";
    hint.classList.add("d-none");
    return;
  }

  const statusName =
    {
      submitted: "Submitted",
      under_review: "Under Review",
      assigned: "Assigned",
      accepted: "Accepted",
      in_progress: "In Progress",
      resolved: "Resolved",
      closed: "Closed",
    }[_maintenanceCurrentStatus] || _maintenanceCurrentStatus;
  if (
    selectedStatus === "unchanged" ||
    selectedStatus === _maintenanceCurrentStatus
  ) {
    hint.textContent = ["resolved", "closed"].includes(
      _maintenanceCurrentStatus,
    )
      ? `This request is already ${statusName}; no new activity can be logged.`
      : selectedStatus === "unchanged"
        ? `Activity will be logged without changing the current status (${statusName}).`
        : `This request is already ${statusName}; activity will be logged without changing its status.`;
    hint.classList.remove("d-none");
    return;
  }

  hint.textContent = "";
  hint.classList.add("d-none");
}

async function initMaintenanceLog() {
  if (!requireRole("Technician")) return;
  try {
    const { data } = await apiRequest("/technicians/my/assignments");
    const active = data.filter(
      (r) => !["resolved", "closed"].includes(r.status),
    );

    const sel = document.getElementById("requestSelect");
    const selFil = document.getElementById("activityRequestFilter");

    if (sel) {
      sel.innerHTML =
        `<option value="">-- Select Active Request --</option>` +
        active
          .map(
            (r) =>
              `<option value="${r.ticket_id}">${escHtml(r.ticketId || r.ticket_id)} — ${escHtml(r.title || "Ticket " + r.ticketId)}</option>`,
          )
          .join("");
    }
    if (selFil) {
      selFil.innerHTML =
        `<option value="">All Requests</option>` +
        data
          .map(
            (r) =>
              `<option value="${r.ticket_id}">${escHtml(r.ticketId || r.ticket_id)} — ${escHtml(r.title || "Ticket " + r.ticketId)}</option>`,
          )
          .join("");
    }
  } catch (err) {
    showToast(err.message, "danger");
    /* Leave the select empty rather than letting a submit post against a
       requestId that was never loaded. */
    const sel = document.getElementById("requestSelect");
    if (sel) sel.innerHTML = `<option value="">-- Unavailable --</option>`;
  }

  await loadActivityTimeline();

  if (_maintenanceLogBound) return;
  _maintenanceLogBound = true;

  document
    .getElementById("activityRequestFilter")
    ?.addEventListener("change", loadActivityTimeline);

  const requestSelect = document.getElementById("requestSelect");
  requestSelect?.addEventListener("change", async () => {
    const requestId = requestSelect.value;
    _maintenanceStatusRequestId = requestId;
    _maintenanceCurrentStatus = "";
    renderMaintenanceStatusHint();
    if (!requestId) return;

    try {
      const { data: ticket } = await apiRequest(`/tickets/${requestId}`);
      if (_maintenanceStatusRequestId !== requestId) return;
      _maintenanceCurrentStatus = normalizeTicketStatus(ticket.status);
      renderMaintenanceStatusHint();
    } catch (_) {
      if (_maintenanceStatusRequestId !== requestId) return;
      const hint = document.getElementById("activityStatusMessage");
      if (hint) {
        hint.textContent =
          "The current status will be checked again when the activity is saved.";
        hint.classList.remove("d-none");
      }
    }
  });
  document
    .getElementById("activityStatus")
    ?.addEventListener("change", renderMaintenanceStatusHint);

  document
    .getElementById("maintenanceForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!e.target.checkValidity()) {
        e.target.classList.add("was-validated");
        return;
      }

      const requestId = document.getElementById("requestSelect").value;
      const selectedStatus = document.getElementById("activityStatus").value;
      const action = document.getElementById("actionTaken").value.trim();
      const parts = document.getElementById("partsUsed").value.trim();
      const notes = document.getElementById("techNotes").value.trim();

      if (!requestId || !/^[0-9a-f]{24}$/i.test(requestId)) {
        showAlert(
          "maintenanceAlert",
          "Please select a valid request.",
          "warning",
        );
        return;
      }

      if (document.getElementById("logSubmitBtn").disabled) return;
      setLoading("logSubmitBtn", "logSpinner", true);
      try {
        // Read the ticket's REAL current status — never assume the workflow step.
        const { data: ticket } = await apiRequest(`/tickets/${requestId}`);
        const current = normalizeTicketStatus(ticket.status);
        _maintenanceStatusRequestId = requestId;
        _maintenanceCurrentStatus = current;
        renderMaintenanceStatusHint();

        // Resolved / closed tickets reject new maintenance activity (per the
        // backend workflow: resolved → closed only, no new activity).
        if (current === "closed") {
          showAlert(
            "maintenanceAlert",
            "This ticket is closed. No new activity can be logged.",
            "warning",
          );
          return;
        }
        if (current === "resolved") {
          showAlert(
            "maintenanceAlert",
            "This ticket is already resolved. No new activity can be logged.",
            "warning",
          );
          return;
        }

        await updateTicketStatusWithMaintenanceDetails(
          requestId,
          selectedStatus,
          {
            actionTaken: action,
            partsUsed: parts || null,
            notes: notes || null,
          },
          current,
        );
        invalidateMyMaintenanceCache();
        showToast("Activity logged successfully!", "success");
        e.target.reset();
        e.target.classList.remove("was-validated");
        _maintenanceStatusRequestId = "";
        _maintenanceCurrentStatus = "";
        renderMaintenanceStatusHint();
        await loadActivityTimeline();
      } catch (err) {
        showAlert("maintenanceAlert", err.message, "danger");
      } finally {
        setLoading("logSubmitBtn", "logSpinner", false);
      }
    });
}

async function loadActivityTimeline() {
  const container = document.getElementById("activityTimeline");
  const filterVal =
    document.getElementById("activityRequestFilter")?.value || "";
  if (!container) return;
  container.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary" role="status"></div></div>`;

  try {
    const data = await loadMyMaintenanceLog();
    const filtered = filterVal
      ? data.filter((a) => String(a.ticket_id) === filterVal)
      : data;

    if (!filtered || !filtered.length) {
      container.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-journal-x fs-2 d-block mb-2 opacity-50"></i><small>No activity yet.</small></div>`;
      return;
    }

    container.innerHTML =
      `<div class="timeline">` +
      filtered
        .map(
          (a) => `
        <div class="timeline-item mb-3 pb-3 border-bottom">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <span class="fw-semibold small">${escHtml(a.ticketId || `Ticket ${a.ticket_id}`)}</span>
            ${statusBadge(a.status)}
          </div>
          <p class="text-muted small mb-1">${escHtml(a.action_taken)}</p>
          ${a.parts_used ? `<div class="small text-muted"><i class="bi bi-box me-1"></i>${escHtml(a.parts_used)}</div>` : ""}
          ${a.notes ? `<div class="small text-muted fst-italic"><i class="bi bi-chat-left-text me-1"></i>${escHtml(a.notes)}</div>` : ""}
          <div class="text-muted" style="font-size:.72rem;">${formatDateTime(a.created_at)}</div>
        </div>`,
        )
        .join("") +
      `</div>`;
  } catch (err) {
    container.innerHTML = `<p class="text-muted small text-center">Activity log unavailable. ${escHtml(err.message || "")}
      <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="loadActivityTimeline()">Retry</button></p>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   TECHNICIAN HISTORY PAGE  (Task #4 — complete)
   ═══════════════════════════════════════════════════════════ */
let _historyAll = [];
/* Date-filter and CSV-export listeners must be bound once. The Retry button in
   the error row re-enters this function; without a guard each retry stacked
   another export listener, so one click exported the history N times over. */
let _techHistoryBound = false;

async function initTechHistory() {
  if (!requireRole("Technician")) return;
  try {
    /* allSettled, not all: a maintenance-log failure should not also discard
       the completed-tasks list, and vice versa. Only a genuine failure of the
       assignments call (the source of the table) escalates to the error row. */
    const [assignRes, maintRes] = await Promise.allSettled([
      apiRequest("/technicians/my/assignments"),
      loadMyMaintenanceLog(),
    ]);
    if (assignRes.status === "rejected") throw assignRes.reason;

    const completed = assignRes.value.data.filter((r) =>
      ["resolved", "closed"].includes(r.status),
    );
    _historyAll = completed;

    // The endpoint sorts newest first; keep the first record per ticket.
    const maintMap = {};
    (maintRes.status === "fulfilled" ? maintRes.value : []).forEach((m) => {
      const key = String(m.ticket_id);
      if (!maintMap[key]) maintMap[key] = m;
    });

    // Stats
    setText("totalResolved", completed.length);
    setText(
      "thisMonth",
      completed.filter((r) => {
        const d = new Date(r.assigned_at),
          n = new Date();
        return (
          d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear()
        );
      }).length,
    );

    // Avg resolution time — diff between assignment and latest maintenance record
    const times = completed
      .map((r) => {
        const m = maintMap[String(r.ticket_id)];
        if (!m || !r.assigned_at || !m.created_at) return null;
        return (new Date(m.created_at) - new Date(r.assigned_at)) / 3600000;
      })
      .filter((v) => v !== null && v >= 0);
    const avgHours = times.length
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;
    setText("avgResolutionTime", avgHours !== null ? `${avgHours}h` : "—");

    // Average rating — placeholder (feedback endpoint not yet available)
    setText("avgRating", "—");

    renderHistoryTable(completed, maintMap);
  } catch (err) {
    ["totalResolved", "thisMonth", "avgRating", "avgResolutionTime"].forEach(
      (id) => setText(id, "—"),
    );
    const tbody = document.getElementById("historyTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
        Failed to load history. ${escHtml(err.message || "")}
        <button type="button" class="btn btn-sm btn-outline-primary ms-2" onclick="initTechHistory()">Retry</button>
      </td></tr>`;
    }
  }

  // Date filter
  if (_techHistoryBound) return;
  _techHistoryBound = true;

  document.getElementById("filterBtn")?.addEventListener("click", () => {
    const from = document.getElementById("dateFrom")?.value;
    const to = document.getElementById("dateTo")?.value;
    const filtered = _historyAll.filter((r) => {
      const d = new Date(r.assigned_at);
      return (
        (!from || d >= new Date(from)) &&
        (!to || d <= new Date(to + "T23:59:59"))
      );
    });
    renderHistoryTable(filtered, {});
  });

  // Export
  document
    .getElementById("exportBtn")
    ?.addEventListener("click", exportHistoryCSV);
}

function renderHistoryTable(completed, maintMap) {
  maintMap = maintMap || {};
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;

  if (!completed.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-5">
      <i class="bi bi-inbox fs-2 text-muted d-block mb-2"></i>
      <span class="text-muted">No completed tasks found.</span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = completed
    .map((r) => {
      const m = maintMap[String(r.ticket_id)];
      const resolvedLog = m?.status === "resolved" ? m : null;
      const completedAt =
        r.completed_at || resolvedLog?.created_at || null;
      const rating = r.rating ?? r.feedbackRating ?? null;
      return `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.ticket_id)}</strong></td>
        <td>${escHtml(r.title || "N/A")}</td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.equipmentType || "N/A")}</span>${r.device ? `<div class="small text-muted">${escHtml(r.device)}</div>` : ""}${r.issueType || r.serviceType ? `<div class="small mt-1"><span class="text-muted">Issue Type:</span> ${escHtml(r.issueType || r.serviceType)}</div>` : ""}</td>
        <td>${escHtml(r.requester_name || "N/A")}</td>
        <td>${completedAt ? escHtml(formatDate(completedAt)) : "N/A"}</td>
        <td>${rating == null ? "N/A" : `<span class="text-warning" aria-label="${escHtml(rating)} out of 5">${escHtml(rating)} <i class="bi bi-star-fill"></i></span>`}</td>
        <td>
          <button class="btn btn-sm btn-outline-secondary" title="View details"
                  onclick="viewHistoryDetail(${jsAttr(r.ticket_id)}, this)">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>`;
    })
    .join("");
}

/* Cached accessor for the technician's own maintenance log.
   The history page filters this whole collection down to a single ticket on
   every row expansion, and re-fetched it each time. It changes only when a log
   is written, so cache it for this page visit and invalidate after a write. */
let _myMaintenanceCache = null;
let _myMaintenanceInFlight = null;

async function loadMyMaintenanceLog() {
  if (_myMaintenanceCache) return _myMaintenanceCache;
  if (!_myMaintenanceInFlight) {
    _myMaintenanceInFlight = apiRequest("/maintenance/my")
      .then((res) => {
        if (!Array.isArray(res.data)) {
          throw new Error("The server returned an unexpected activity response.");
        }
        _myMaintenanceCache = res.data;
        return _myMaintenanceCache;
      })
      .finally(() => {
        _myMaintenanceInFlight = null;
      });
  }
  return _myMaintenanceInFlight;
}

function invalidateMyMaintenanceCache() {
  _myMaintenanceCache = null;
}

async function viewHistoryDetail(requestId, btn) {
  const ticketId = String(requestId || "").trim();
  if (!/^[0-9a-f]{24}$/i.test(ticketId)) {
    showToast("This task has an invalid request ID. Refresh the page and try again.", "danger");
    return;
  }

  // Toggle inline detail row
  const existingRow = document.getElementById(`detail-row-${ticketId}`);
  if (existingRow) {
    existingRow.remove();
    return;
  }

  const tr = btn.closest("tr");
  const colCount = tr.querySelectorAll("td").length;
  const detailRow = document.createElement("tr");
  detailRow.id = `detail-row-${ticketId}`;
  detailRow.innerHTML = `<td colspan="${colCount}" class="bg-light p-0">
    <div id="detail-content-${ticketId}" class="p-3" role="status" aria-live="polite">
      <div class="text-center py-2"><div class="spinner-border spinner-border-sm text-primary" aria-hidden="true"></div><span class="visually-hidden">Loading task details...</span></div>
    </div>
  </td>`;
  tr.insertAdjacentElement("afterend", detailRow);

  try {
    /* allSettled: previously one rejection (e.g. /maintenance/my failing) threw
       away the request details too, so a maintenance glitch blanked the whole
       expanded row. Each half now degrades on its own. */
    const [reqRes, maintRes] = await Promise.allSettled([
      apiRequest(`/tickets/${encodeURIComponent(ticketId)}`),
      loadMyMaintenanceLog(),
    ]);
    if (reqRes.status === "rejected") throw reqRes.reason;
    const r = reqRes.data;
    const logs = (maintRes.status === "fulfilled" ? maintRes.value : []).filter(
      (m) => String(m.ticket_id) === ticketId,
    );
    const maintUnavailable = maintRes.status === "rejected";
    const fallbackRow = _historyAll.find(
      (task) => String(task.ticket_id) === ticketId,
    );
    const resolvedLog = logs.find((log) => log.status === "resolved");
    const completedAt =
      r.technician_feedback?.completionDate ||
      fallbackRow?.completed_at ||
      resolvedLog?.created_at ||
      null;
    const rating =
      r.requester_feedback?.overallRating ??
      r.feedbackRating ??
      fallbackRow?.rating ??
      null;
    const detailValue = (value) =>
      value === null || value === undefined || value === ""
        ? "N/A"
        : String(value);
    const field = (label, value) =>
      `<div class="small mt-1"><strong>${label}:</strong> ${escHtml(detailValue(value))}</div>`;

    const content = document.getElementById(`detail-content-${ticketId}`);
    if (!content) return;
    content.removeAttribute("role");
    content.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="fw-semibold mb-1">Task Details</div>
          ${field("Ticket ID", r.ticketId || fallbackRow?.ticketId)}
          ${field("Title", r.title || fallbackRow?.title)}
          ${field("Category", r.category || fallbackRow?.category)}
          ${field("Issue Type", r.issueType || r.serviceType || fallbackRow?.issueType || fallbackRow?.serviceType)}
          ${field("Requester", r.requester_name || fallbackRow?.requester_name)}
          ${field("Description", r.problemDescription || fallbackRow?.problemDescription)}
          ${field("Status", r.status || fallbackRow?.status)}
          ${field("Completed Date", completedAt ? formatDateTime(completedAt) : null)}
          ${field("Rating", rating == null ? null : `${rating} / 5`)}
          ${field("Technician", r.technician_name || fallbackRow?.technician_name)}
          ${field("Created", r.created_at)}
          ${field("Last Updated", r.updated_at)}
        </div>
        <div class="col-md-6">
          <div class="fw-semibold mb-1">Maintenance Activity</div>
          ${
            maintUnavailable
              ? '<span class="text-muted small">Maintenance activity is temporarily unavailable.</span>'
              : logs.length
                ? logs
                    .map(
                      (l) => `
            <div class="small border-start border-2 border-success ps-2 mb-2">
              <div class="fw-semibold">${escHtml(detailValue(l.action_taken))}</div>
              <div class="text-muted"><i class="bi bi-box me-1"></i><strong>Parts / Materials:</strong> ${escHtml(detailValue(l.parts_used))}</div>
              <div class="text-muted fst-italic"><strong>Notes:</strong> ${escHtml(detailValue(l.notes))}</div>
              <div class="text-muted" style="font-size:.7rem;">${escHtml(l.created_at ? formatDateTime(l.created_at) : "N/A")}</div>
            </div>`,
                    )
                    .join("")
                : '<span class="text-muted small">No logs recorded.</span>'
          }
        </div>
      </div>`;
  } catch (err) {
    console.error("[Technician History] Ticket details request failed.", {
      ticketId,
      status: err.status || null,
      message: err.message,
    });
    const content = document.getElementById(`detail-content-${ticketId}`);
    if (!content) return;
    const message =
      err.status === 404
        ? "This ticket could not be found. It may have been removed."
        : err.status === 403
          ? err.message
          : err.status >= 500 || err.network
            ? "The server is unavailable. Please try again shortly."
            : err.message || "Please refresh the page and try again.";
    content.removeAttribute("role");
    content.innerHTML = `<div class="alert alert-danger mb-0 py-2" role="alert"><strong>Unable to load task details.</strong> ${escHtml(message)}</div>`;
  }
}

function exportHistoryCSV() {
  if (!_historyAll.length) {
    showToast("No data to export.", "warning");
    return;
  }

  const headers = [
    "ID",
    "Title",
    "Equipment Type",
    "Device / Equipment",
    "Category",
    "Issue Type / Service Type",
    "Requester",
    "Department",
    "Assigned Date",
    "Status",
  ];
  const rows = _historyAll.map((r) => [
    r.ticketId,
    `"${(r.title || "").replace(/"/g, '""')}"`,
    `"${(r.equipmentType || "").replace(/"/g, '""')}"`,
    `"${(r.device || "").replace(/"/g, '""')}"`,
    `"${(r.category || "").replace(/"/g, '""')}"`,
    `"${(r.issueType || r.serviceType || "").replace(/"/g, '""')}"`,
    `"${(r.requester_name || "").replace(/"/g, '""')}"`,
    `"${(r.department || "").replace(/"/g, '""')}"`,
    formatDate(r.assigned_at),
    r.status,
  ]);

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `maintenance-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV exported!", "success");
}

/* ═══════════════════════════════════════════════════════════
   ADMIN TECHNICIANS PAGE  (Tasks #1, #2, #3, #6)
   ═══════════════════════════════════════════════════════════ */
let _techAll = [];
let _editUserId = null; // User._id for the technician being edited (separate from Technician._id)

/* ── Populate the "Select Request" dropdown with assignable requests ──
   Only requests that are still awaiting assignment can be picked.
   Calls GET /api/tickets (returns Ticket._id as `id`) and filters to the
   pre-assignment statuses so the backend "already assigned" checks hold. */
let _assignRequestsLoaded = false;

/* Populates the "Assign Request" dropdown.

   Deliberately NOT part of page load: the request list is the heaviest
   payload on this page and is only needed once an admin actually opens the
   Assign dialog. `_assignRequestsLoaded` makes it a one-shot fetch, and
   loadAdminTechnicians() resets that flag so a freshly assigned request
   shows up next time the dialog is opened. */
async function populateAssignRequestSelect({ force = false } = {}) {
  const sel = document.getElementById("assignRequest");
  if (!sel) return;
  if (_assignRequestsLoaded && !force) return;
  _assignRequestsLoaded = true;
  let options = `<option value="">-- Select Request --</option>`;

  // Remember the previously selected value across refreshes
  const prev = sel.value;

  try {
    const { data: reqs } = await apiRequest("/tickets");
    const pending = reqs.filter((r) =>
      ["submitted", "under_review"].includes(r.status),
    );
    if (!pending.length) {
      options += `<option value="" disabled>No pending requests to assign</option>`;
    } else {
      options += pending
        .map((r) => {
          const id = String(r.id || r._id || "");
          if (!id || !/^[0-9a-f]{24}$/i.test(id)) return "";
          return `<option value="${id}" data-priority="${escHtml(r.priority || "medium")}">${escHtml(r.ticketId || id)} — ${escHtml((r.problemDescription || "").substring(0, 60))}</option>`;
        })
        .join("");
    }
  } catch (_) {
    options += `<option value="" disabled>Could not load requests</option>`;
  }

  sel.innerHTML = options;
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  updateAssignPriority();
}

function updateAssignPriority() {
  const requestSelect = document.getElementById("assignRequest");
  const prioritySelect = document.getElementById("assignPriority");
  if (!requestSelect || !prioritySelect) return;
  const selected = requestSelect.options[requestSelect.selectedIndex];
  const priority = selected?.dataset.priority || "";
  prioritySelect.value = priority;
  updateAssignPriorityStyle();
}

function updateAssignPriorityStyle() {
  const prioritySelect = document.getElementById("assignPriority");
  if (!prioritySelect) return;
  const priority = prioritySelect.value;
  prioritySelect.className = `form-select${priority ? ` priority-${priority}` : ""}`;
}

/* One-shot binding. In particular confirmAssignBtn must not gain a second
   listener, or a single click issues two POST /assignments. */
let _adminTechBound = false;

async function initAdminTechnicians() {
  if (!requireRole("ICT Admin")) return;

  /* Render the grid. The assign dropdown is populated lazily on modal open,
     so page load is one round trip instead of three. */
  await loadAdminTechnicians();
  updateAssignPriority();

  if (_adminTechBound) return;
  _adminTechBound = true;

  // Search / filter
  document
    .getElementById("techSearchInput")
    ?.addEventListener("input", filterTechCards);
  document
    .getElementById("techAvailFilter")
    ?.addEventListener("change", filterTechCards);

  // Assign request modal dropdown (options already populated above)
  document
    .getElementById("assignRequest")
    ?.addEventListener("change", updateAssignPriority);
  document
    .getElementById("assignPriority")
    ?.addEventListener("change", updateAssignPriorityStyle);

  document
    .getElementById("confirmAssignBtn")
    ?.addEventListener("click", async () => {
      const techId = document.getElementById("assignTechId").value;
      const requestId = document.getElementById("assignRequest").value;
      const priority = document.getElementById("assignPriority").value;
      const notes = document.getElementById("assignNotes")?.value || "";

      if (!techId) {
        showAlert(
          "assignAlert",
          "Please select a technician first.",
          "warning",
        );
        return;
      }
      if (!requestId) {
        const noReqs = [
          ...(document.getElementById("assignRequest")?.options || []),
        ].some((o) => o.disabled);
        showAlert(
          "assignAlert",
          noReqs
            ? "There are no pending requests available to assign."
            : "Please select a request.",
          "warning",
        );
        return;
      }
      if (!priority) {
        showAlert("assignAlert", "Please select a priority.", "warning");
        return;
      }
      if (
        !/^[0-9a-f]{24}$/i.test(techId) ||
        !/^[0-9a-f]{24}$/i.test(requestId)
      ) {
        showAlert("assignAlert", "Invalid technician or request ID.", "danger");
        return;
      }

      setLoading("confirmAssignBtn", "assignSpinner", true);
      try {
        await apiRequest("/assignments", {
          method: "POST",
          body: {
            ticket_id: requestId,
            technician_id: techId,
            notes,
            priority,
          },
        });
        showToast("Technician assigned successfully.", "success");
        bootstrap.Modal.getInstance(
          document.getElementById("assignModal"),
        )?.hide();
        await loadAdminTechnicians();
        await populateAssignRequestSelect();
      } catch (err) {
        console.error("Assign technician failed:", err);
        showAlert("assignAlert", err.message || "Assignment failed.", "danger");
      } finally {
        setLoading("confirmAssignBtn", "assignSpinner", false);
      }
    });

  // Add technician form
  document
    .getElementById("saveTechBtn")
    ?.addEventListener("click", saveTechnician);

  // Delete confirmation
  document
    .getElementById("confirmDeleteBtn")
    ?.addEventListener("click", deleteTechnician);
}

async function loadAdminTechnicians() {
  try {
    /* Technicians and their workload are independent, so they are fetched in
       parallel rather than in sequence.

       The previous code also fetched the FULL ticket list here and never read
       the result — a wasted round trip that measured ~3.1 s / 74 KB over the
       Atlas link and was the main reason this page felt stuck on
       "Loading technicians...". The assign-request dropdown that genuinely
       needs /tickets is now populated lazily, when the modal is opened. */
    const [techRes, perfRes] = await Promise.all([
      apiRequest("/technicians"),
      apiRequest("/reports/technician-performance").catch(() => ({ data: [] })),
    ]);

    _techAll = techRes.data;

    /* Build workload map: technician name → assigned / resolved counts.
       A failure here is non-fatal: the cards still render, just without the
       workload bars, instead of leaving the whole page in an error state. */
    const workloadMap = {};
    (perfRes?.data || []).forEach((p) => {
      workloadMap[p.name] = { assigned: p.assigned, resolved: p.resolved };
    });

    // Summary stats
    const available = _techAll.filter((t) => t.available).length;
    setText("totalTechs", _techAll.length);
    setText("availableTechs", available);
    setText("busyTechs", _techAll.length - available);

    // Task #1 fix: real avg tasks per technician
    const totalActive = Object.values(workloadMap).reduce(
      (sum, p) => sum + (p.assigned - p.resolved),
      0,
    );
    const avgTasks = _techAll.length
      ? Math.round((totalActive / _techAll.length) * 10) / 10
      : 0;
    setText("avgTasks", avgTasks);

    renderTechnicianCards(_techAll, workloadMap);
    filterTechCards();
    /* The assignable-request list may have changed (a request was assigned,
       or the cache window elapsed), so the next dialog open refetches it. */
    _assignRequestsLoaded = false;
  } catch (err) {
    ["totalTechs", "availableTechs", "busyTechs", "avgTasks"].forEach((id) =>
      setText(id, "—"),
    );
    const grid = document.getElementById("techniciansGrid");
    if (grid) {
      grid.innerHTML = `<div class="col-12 text-center text-muted py-5">
        <i class="bi bi-exclamation-triangle fs-1 text-danger d-block mb-2"></i>
        <p>Failed to load technicians. ${escHtml(err.message || "")}</p>
        <button type="button" class="btn btn-outline-primary" onclick="loadAdminTechnicians()">Retry</button>
      </div>`;
    }
  }
}

function filterTechCards() {
  const q = (
    document.getElementById("techSearchInput")?.value || ""
  ).toLowerCase();
  const avail = document.getElementById("techAvailFilter")?.value || "";
  const grid = document.getElementById("techniciansGrid");
  if (!grid) return;

  let visibleCount = 0;
  grid.querySelectorAll(".tech-card").forEach((card) => {
    const matchesSearch = !q || card.dataset.search.includes(q);
    const matchesAvailability =
      !avail ||
      (avail === "available"
        ? card.dataset.available === "true"
        : card.dataset.available !== "true");
    const visible = matchesSearch && matchesAvailability;
    card.classList.toggle("d-none", !visible);
    if (visible) visibleCount++;
  });
  const emptyState = grid.querySelector("[data-tech-empty]");
  if (emptyState) emptyState.classList.toggle("d-none", visibleCount > 0);

  const count = document.getElementById("techCount");
  if (count)
    count.textContent = `${visibleCount} technician${visibleCount !== 1 ? "s" : ""}`;
}

function renderTechnicianCards(technicians, workloadMap) {
  const grid = document.getElementById("techniciansGrid");
  if (!grid) return;

  grid.innerHTML = technicians
    .map((t) => {
      const wl = workloadMap[t.fullName] || {};
      const active = (wl.assigned || 0) - (wl.resolved || 0);
      const rate = wl.assigned
        ? Math.round((wl.resolved / wl.assigned) * 100)
        : 0;
      const barC = rate >= 80 ? "#198754" : rate >= 50 ? "#ffc107" : "#dc3545";

      return `
    <div class="col-md-6 col-lg-4 tech-card"
         data-search="${escHtml(`${t.fullName || ""} ${t.specialization || ""} ${t.email || ""}`.toLowerCase())}"
         data-available="${Boolean(t.available)}">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body p-3">
          <div class="d-flex align-items-center gap-3 mb-3">
            <div class="rounded-circle bg-dark d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                 style="width:46px;height:46px;font-size:1.15rem;">
              ${escHtml((t.fullName || "T").charAt(0).toUpperCase())}
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">${escHtml(t.fullName || "—")}</div>
              <div class="text-muted small">${escHtml(t.specialization || "General")}</div>
            </div>
            <span class="badge ${t.available ? "bg-success" : "bg-secondary"} flex-shrink-0">
              ${t.available ? "Available" : "Busy"}
            </span>
          </div>

          <div class="small text-muted mb-1"><i class="bi bi-envelope me-1"></i>${escHtml(t.email || "—")}</div>
          <div class="small text-muted mb-2"><i class="bi bi-telephone me-1"></i>${escHtml(t.phone || "—")}</div>

          <!-- Task #6: workload bar -->
          ${
            wl.assigned
              ? `
          <div class="mb-2">
            <div class="d-flex justify-content-between mb-1">
              <span class="small text-muted">Workload</span>
              <span class="small fw-semibold">${active} active · ${wl.resolved || 0} resolved</span>
            </div>
            <div class="rounded-pill overflow-hidden" style="height:6px;background:#e9ecef;">
              <div class="rounded-pill" style="height:100%;width:${rate}%;background:${barC};transition:width .8s ease;"></div>
            </div>
          </div>`
              : `<div class="small text-muted mb-2"><i class="bi bi-inbox me-1"></i>No tasks assigned yet</div>`
          }
        </div>
        <div class="card-footer bg-transparent border-top-0 px-3 pb-3 d-flex gap-2 flex-wrap">
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
              title="Deactivate" aria-label="Deactivate ${escHtml(t.fullName || "technician")}">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
    })
    .join("") +
    `<div class="col-12 text-center py-5${technicians.length ? " d-none" : ""}" data-tech-empty>
      <i class="bi bi-wrench fs-2 text-muted d-block mb-2"></i>
      <p class="text-muted">No technicians found.</p>
    </div>`;
}

function openAssignModal(techId) {
  document.getElementById("assignTechId").value = techId;
  void populateAssignRequestSelect();
  const alert = document.getElementById("assignAlert");
  if (alert) alert.classList.add("d-none");
  document.getElementById("assignNotes").value = "";
  updateAssignPriority();
}

function openAddTechModal() {
  document.getElementById("techModalTitle").textContent = "Add Technician";
  document.getElementById("techForm").reset();
  document.getElementById("techId").value = "";
  _editUserId = "";
  document.getElementById("techPassword").required = true;
  document.getElementById("techPasswordHint").classList.remove("d-none");
  const alert = document.getElementById("techAlert");
  if (alert) alert.classList.add("d-none");
}

function openEditTechModal(tech) {
  document.getElementById("techModalTitle").textContent = "Edit Technician";
  // `tech.id` / `tech._id` is the Technician._id (separate collection).
  // `tech.user_id` is the linked User._id — used for the /users update.
  document.getElementById("techId").value = tech.id || tech._id;
  _editUserId = String(tech.user_id || tech.id || tech._id || "");
  document.getElementById("techName").value = tech.fullName || "";
  document.getElementById("techEmail").value = tech.email || "";
  document.getElementById("techPhone").value = tech.phone || "";
  document.getElementById("techSpec").value = tech.specialization || "";
  document.getElementById("techPassword").value = "";
  document.getElementById("techPassword").required = false;
  document.getElementById("techPasswordHint").classList.add("d-none");
  const alert = document.getElementById("techAlert");
  if (alert) alert.classList.add("d-none");
}

async function saveTechnician() {
  const id = document.getElementById("techId").value; // Technician._id (may be empty when adding)
  const userId = _editUserId; // User._id for existing technicians
  const name = document.getElementById("techName").value.trim();
  const email = document.getElementById("techEmail").value.trim();
  const phone = document.getElementById("techPhone").value.trim();
  const spec = document.getElementById("techSpec").value.trim();
  const password = document.getElementById("techPassword").value;

  if (!name || !email) {
    showAlert("techAlert", "Name and email are required.", "warning");
    return;
  }
  if (!id && !password) {
    showAlert(
      "techAlert",
      "Password is required for new technician.",
      "warning",
    );
    return;
  }

  setLoading("saveTechBtn", "saveTechSpinner", true);
  try {
    if (!id) {
      // Create via admin endpoint (creates user + technician profile atomically)
      await apiRequest("/users", {
        method: "POST",
        body: {
          fullName: name,
          email,
          password,
          role: "Technician",
          phone,
          department: "ICT",
          specialization: spec,
        },
      });
      showToast("Technician added!", "success");
    } else {
      if (!userId || !/^[0-9a-f]{24}$/i.test(userId)) {
        throw new Error(
          "Could not determine the technician's user account. Reopen Edit and try again.",
        );
      }
      // Update the User record (email/name/phone) using the correct User._id
      await apiRequest(`/users/${userId}`, {
        method: "PUT",
        body: { fullName: name, email, phone, role: "Technician" },
      });
      // Update the Technician profile (specialization) using Technician._id
      await apiRequest(`/technicians/${id}`, {
        method: "PUT",
        body: { specialization: spec },
      });
      showToast("Technician updated!", "success");
    }

    bootstrap.Modal.getInstance(document.getElementById("techModal"))?.hide();
    _editUserId = "";
    await loadAdminTechnicians();
  } catch (err) {
    console.error("Save technician failed:", err);
    showAlert(
      "techAlert",
      err.message || "Could not save technician.",
      "danger",
    );
  } finally {
    setLoading("saveTechBtn", "saveTechSpinner", false);
  }
}

/* ── Delete (deactivate) Technician ────────────────────────── */
let _deleteTechId = null; // Technician._id
let _deleteUserId = null; // linked User._id

function openDeleteModal(techId, techName) {
  _deleteTechId = techId;
  // Resolve the linked User._id now (the card only passes Technician._id)
  const tech = (_techAll || []).find(
    (t) => String(t.id || t._id) === String(techId),
  );
  _deleteUserId = (tech && String(tech.user_id)) || "";
  const nameEl = document.getElementById("deleteTechName");
  if (nameEl)
    nameEl.textContent =
      techName || (tech && tech.fullName) || "this technician";
}

async function deleteTechnician() {
  if (!_deleteTechId) return;

  if (!_deleteUserId || !/^[0-9a-f]{24}$/i.test(_deleteUserId)) {
    showToast(
      "Could not identify this technician's user account. Reopen the confirm dialog and try again.",
      "danger",
    );
    return;
  }

  setLoading("confirmDeleteBtn", "deleteSpinner", true);
  try {
    // Do not silently delete a technician who still has active assigned tasks.
    const { data: assignments } = await apiRequest("/assignments");
    const active = assignments.some(
      (a) =>
        ["assigned", "accepted", "in_progress"].includes(a.status) &&
        String(a.technician_id) === String(_deleteTechId),
    );
    if (active) {
      showToast(
        "Cannot deactivate this technician: they still have active assigned requests.",
        "warning",
      );
      bootstrap.Modal.getInstance(
        document.getElementById("deleteTechModal"),
      )?.hide();
      _deleteTechId = null;
      _deleteUserId = "";
      return;
    }

    // Soft-deactivate the linked User account (also disables their login).
    await apiRequest(`/users/${_deleteUserId}`, { method: "DELETE" });
    showToast("Technician deactivated.", "success");
    bootstrap.Modal.getInstance(
      document.getElementById("deleteTechModal"),
    )?.hide();
    await loadAdminTechnicians();
  } catch (err) {
    console.error("Delete technician failed:", err);
    showToast(err.message || "Could not delete technician.", "danger");
  } finally {
    setLoading("confirmDeleteBtn", "deleteSpinner", false);
    _deleteTechId = null;
    _deleteUserId = "";
  }
}
