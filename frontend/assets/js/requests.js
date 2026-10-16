/* ============================================================
   requests.js  —  All User/Admin Request Logic
    Smart ICT Maintenance Management System
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const p = window.location.pathname;

  try {
    await Auth.load();
    if (!requireAuth()) return;
    if (p.includes("user/dashboard")) await initUserDashboard();
    if (p.includes("user/request")) await initSubmitRequest();
    if (p.includes("user/tracking")) await initTracking();
    if (p.includes("user/history")) await initUserHistory();
    if (p.includes("admin/requests")) await initAdminRequests();
    if (p.includes("admin/admin-feedback"))
      await initAdminTechnicianFeedbackPage();
    if (p.includes("admin/categories")) await initCategories();
    if (p.includes("admin/users")) await initUserManagement();
  } catch (err) {
    console.error("Page initialization failed:", err);
    if (err && err.message) showToast(err.message, "danger");
  } finally {
    /* Only run settleStoppedLoaders if we're still on the same page (no redirect happened).
       Check if the page is still visible and not navigating away. */
    /* NOTE: the document.visibilityState check that used to guard this call
       is gone. A tab backgrounded during page init would skip the safety net
       entirely and come back to permanently stuck "Loading..." placeholders. */
    /* The dashboard owns its recent-request placeholder in reports.js.
       Running this unrelated script's safety net here races the dashboard's
       requests and can replace the spinner before its API call has completed. */
    if (!window.__authRedirecting && !p.includes("admin/dashboard")) {
      settleStoppedLoaders();
    }
  }
});

/* ── Safety net for static "Loading ..." placeholders ─────────
   Any data area still showing its original loading text after the init
   chain has finished has clearly never been reached (guard bail, uncaught
   throw, etc.). Replace it with an error state + Retry so the UI can never be
   stuck on an infinite spinner.
   IMPORTANT: Only replace if the content is STILL the original loading text.
   Do NOT overwrite content that was already replaced by error handlers. */
function settleStoppedLoaders() {
  /* Every static "Loading ..." placeholder in every page, so none can be left
     behind when initialisation throws or a request times out.

     kind "table" -> replace with a single error row of `cols` columns.
     kind "block" -> replace with a plain error block (used for <div> lists).

     The previous list covered only 7 ids, so technician assigned-requests,
     technician dashboard, technician maintenance, user notifications and all
     three report tables could still hang on their placeholder with no error
     and no way to retry. */
  const areas = [
    ["categoriesTableBody", "table", 5],
    ["requestsTableBody", "table", 14],
    ["usersTableBody", "table", 8],
    ["historyTableBody", "table", 9],
    ["recentRequestsBody", "table", 7],
    ["assetsTableBody", "table", 9],
    /* Added — previously uncovered, so these could stick indefinitely. */
    ["issueTypeReportBody", "table", 5],
    ["assignedRequestsList", "block", 0],
    ["activityTimeline", "block", 0],
    ["pendingFeedbackList", "block", 0],
  ];

  /* Generic "is this still an untouched loading placeholder?" test.
     Matching the "Loading …" shape rather than a fixed word list keeps this
     correct as pages are added, and the spinner check covers the no-text
     variant. */
  const isStuckText = (label) =>
    /^loading\b[\s\S]{0,120}?(\.\.\.|…)$/i.test((label || "").trim());
  const isSpinnerOnly = (el) =>
    !!el.querySelector(".spinner-border, .spinner-grow");

  const retryButton =
    '<button class="btn btn-sm btn-outline-primary" onclick="window.location.reload()">' +
    '<i class="bi bi-arrow-clockwise me-1"></i>Retry</button>';

  areas.forEach(([id, kind, cols]) => {
    const el = document.getElementById(id);
    if (!el || el.querySelector("button")) return;
    if (!isStuckText(el.textContent) && !isSpinnerOnly(el)) return;
    if (kind === "table") {
      el.innerHTML = `<tr><td colspan="${cols}" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load data — the page did not finish initializing.</p>
        ${retryButton}
      </td></tr>`;
    } else {
      el.innerHTML = `<div class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load data — the page did not finish initializing.</p>
        ${retryButton}
      </div>`;
    }
  });

  const stats = document.getElementById("categoryStats");
  if (stats && isStuckText(stats.textContent)) {
    stats.innerHTML = `<div class="text-center text-muted py-4">Category statistics are unavailable.</div>`;
  }

  const trackingList = document.getElementById("requestsList");
  if (trackingList) {
    const isStuck =
      isStuckText(trackingList.textContent) ||
      !!trackingList.querySelector(".tk-skeleton-line");

    if (isStuck) {
      trackingList.innerHTML = `<div class="col-12 text-center py-5">
        <i class="bi bi-cloud-slash text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Unable to load your requests.</p>
        <button class="btn btn-sm btn-outline-primary" onclick="loadTrackingRequests()">
          <i class="bi bi-arrow-clockwise me-1"></i>Try Again
        </button>
      </div>`;
    }
  }

  const notificationsList = document.getElementById("notificationsList");
  if (notificationsList && isStuckText(notificationsList.textContent)) {
    notificationsList.innerHTML = `<div class="text-center py-5">
      <i class="bi bi-cloud-slash text-danger d-block mb-2 fs-3"></i>
      <p class="text-danger mb-2">Unable to load notifications.</p>
      <button class="btn btn-sm btn-outline-primary" onclick="initNotificationsPage()">
        <i class="bi bi-arrow-clockwise me-1"></i>Try Again
      </button>
    </div>`;
  }

  /* These three dashboard card bodies ship a bare spinner with NO text, so a
     textContent match could never fire and the spinner stayed forever if the
     dashboard init chain aborted early. Detect the spinner itself. */
  const statusMiniChart = document.getElementById("statusMiniChart");
  if (statusMiniChart && isSpinnerOnly(statusMiniChart)) {
    statusMiniChart.innerHTML = `<p class="text-muted small text-center py-2">Chart unavailable. <button class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button></p>`;
  }

  const recentActivityDash = document.getElementById("recentActivityDash");
  if (recentActivityDash && isSpinnerOnly(recentActivityDash)) {
    recentActivityDash.innerHTML = `<p class="text-muted small text-center py-2">Activity feed unavailable. <button class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button></p>`;
  }

  /* ── The New Request dropdowns ──────────────────────────────
     Neither select has a table cell to host the generic "failed to load"
     markup above, so they get their own treatment: if a dropdown is still
     showing its untouched "Loading ..." placeholder *after* its request has
     finished, the init chain aborted before it could replace it — swap in a
     non-submittable error option so the requester never faces a dropdown
     stuck mid-load.

     `stillHealthy` must mean "a request for this is genuinely still in
     flight and inside its grace period". It used to be
     `_pendingAt && Date.now() - _pendingAt < GRACE`, which is ALSO false once
     the request has COMPLETED, because the loader resets the timestamp to 0
     in its finally block. A completed-and-rendered dropdown therefore landed
     in the failure branch and was only spared by isStuckText() not matching
     the real placeholder text. Compare against the loader's own status
     instead, so a finished load can never be mistaken for a stuck one. */
  [
    [
      "category",
      _requestCategoryPendingAt &&
        _requestCategoryStatus === "loading" &&
        Date.now() - _requestCategoryPendingAt < REQUEST_LOADER_GRACE_MS,
      "req.category.error",
      "Unable to load categories. Please try again.",
    ],
    [
      "asset",
      _requestAssetsPendingAt &&
        Date.now() - _requestAssetsPendingAt < REQUEST_LOADER_GRACE_MS,
      "req.assetsError",
      "Unable to load ICT assets. Please try again.",
    ],
  ].forEach(([id, stillHealthy, key, fallback]) => {
    if (stillHealthy) return;
    const el = document.getElementById(id);
    if (!el) return;
    const label = el.selectedOptions?.[0]?.textContent?.trim() || "";
    if (!isStuckText(label)) return;
    el.replaceChildren(new Option(shellI18n(key, fallback), ""));
    /* Left enabled: a disabled select cannot be opened at all, which turns a
       recoverable load failure into a permanently unusable field. The value
       stays empty, so validateRequestFormFields still blocks the submit and
       the requester gets the retry affordance rendered above the select. */
    el.disabled = false;
    if (id === "category") {
      _requestCategoryStatus = "error";
      setCategoryStatus(
        shellI18n(key, fallback) + " Use Try again to reload them.",
        "error",
      );
      renderIssueTypeOptions("");
    }
  });

  const serviceFeedbackPanel = document.getElementById("serviceFeedbackPanel");
  if (serviceFeedbackPanel && isSpinnerOnly(serviceFeedbackPanel)) {
    serviceFeedbackPanel.innerHTML = `<div class="text-center text-muted py-4">
      <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
      <p class="small mb-0">Feedback unavailable.</p>
      <a href="admin-feedback.html" class="btn btn-sm btn-outline-primary mt-2">Manage Feedback</a>
    </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ISSUE TYPE / SERVICE TYPE.

   Mirror of ICT_ISSUE_TYPES in
   backend/utils/ictCategoryHierarchy.js — the single source of truth. This
   copy exists only because the client is plain <script> tags with no
   bundler; backend/scripts/verify-issue-type.js asserts the two are
   identical, so they cannot drift apart.

   One catalogue of 85 values shared by every Category. Category and Issue
   Type stay two separate fields throughout: neither is ever written into the
   other, and no Category name appears in the Issue Type list.
   ═══════════════════════════════════════════════════════════════ */
async function initUserDashboard() {
  if (!requireRole("Requester")) return;
  const user = Auth.getUser();

  const w = document.getElementById("welcomeName");
  if (w) w.textContent = user?.fullName || "User";

  const tbody = document.getElementById("requestsTableBody");

  try {
    const { data } = await apiRequest("/tickets/my");

    let pending = 0,
      inProg = 0,
      completed = 0;
    data.forEach((r) => {
      if (
        ["submitted", "under_review", "assigned", "accepted"].includes(r.status)
      )
        pending++;
      if (r.status === "in_progress") inProg++;
      if (["resolved", "closed"].includes(r.status)) completed++;
    });

    animNum("totalRequests", data.length);
    animNum("pendingRequests", pending);
    animNum("inProgressRequests", inProg);
    animNum("completedRequests", completed);

    if (!tbody) return;

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="text-center py-5">
          <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i>
          <p class="text-muted mb-3">No requests yet.</p>
          <a href="request.html" class="btn btn-primary btn-sm">Submit your first request</a>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = data
      .slice(0, 6)
      .map(
        (r) => `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
        <td>
          <div style="max-width:180px;" class="text-truncate" title="${escHtml(r.problemDescription)}">${escHtml(r.problemDescription)}</div>
        </td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.equipmentType || "—")}</span>${r.category ? `<div class="small text-muted mt-1">${escHtml(r.category)}</div>` : ""}</td>
        <td>${priorityBadge(r.priority)}</td>
        <td>${statusBadge(r.status)}</td>
        <td><small class="text-muted">${formatDate(r.created_at)}</small></td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-primary py-0 px-2"
                  onclick="openDetailModal('${r.id}')"
                  data-bs-toggle="modal" data-bs-target="#requestDetailModal"
                  title="View request details">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>`,
      )
      .join("");
  } catch (err) {
    console.error("Load requests failed:", err);
    showToast(err.message, "danger");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load requests: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initUserDashboard()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry</button>
      </td></tr>`;
    }
  }
}

const OTHER_ISSUE_OPTION = "Other ICT Issue";

/* ISSUE TYPE / SERVICE TYPE — the client mirror.

   Exactly 85 values, in catalogue order, matching
   ICT_ISSUE_TYPES in backend/utils/ictCategoryHierarchy.js entry for entry.
   backend/scripts/verify-issue-type.js asserts the two are identical so they
   cannot drift apart. The mirror exists only because the client is plain
   <script> tags with no bundler.

   The catalogue is independent of Category: choosing a Category never
   narrows or reorders it. The per-category map below exists purely because
   that is the shape GET /api/categories/maintenance sends. */
const REQUEST_ISSUE_TYPES = [
  "Hardware Failure",
  "Hardware Installation",
  "Hardware Replacement",
  "Hardware Inspection",
  "Computer Not Starting",
  "Laptop Problem",
  "Desktop Problem",
  "Printer Problem",
  "Scanner Problem",
  "Monitor Problem",
  "Keyboard / Mouse Problem",
  "Hard Disk / SSD Problem",
  "RAM / Memory Problem",
  "Power Supply Problem",
  "Battery / Charging Problem",
  "Overheating Problem",
  "USB / Port Problem",
  "Network Adapter Problem",
  "Software Installation",
  "Software Update",
  "Software Configuration",
  "Software Error",
  "Application Not Opening",
  "Application Crashing",
  "Operating System Problem",
  "Driver Problem",
  "License / Activation Problem",
  "Antivirus / Security Software Problem",
  "Software Compatibility Problem",
  "No Internet Connection",
  "Slow Internet",
  "Wi-Fi Problem",
  "LAN / Ethernet Problem",
  "Network Connection Problem",
  "Network Configuration Problem",
  "IP Address Problem",
  "DNS Problem",
  "VPN Problem",
  "Network Access Problem",
  "Password Reset",
  "Account Locked",
  "Login Problem",
  "Email Access Problem",
  "System Access Problem",
  "Permission / Access Rights Problem",
  "User Account Creation",
  "User Account Deactivation",
  "Email Not Sending",
  "Email Not Receiving",
  "Email Configuration",
  "Email Synchronization Problem",
  "Email Storage Problem",
  "Cannot Print",
  "Printer Offline",
  "Print Quality Problem",
  "Printer Configuration",
  "Printer Driver Problem",
  "Scanner Not Working",
  "Scanner Configuration",
  "Malware / Virus Problem",
  "Suspicious Activity",
  "Security Alert",
  "Unauthorized Access",
  "Antivirus Problem",
  "Security Configuration",
  "File Access Problem",
  "File Sharing Problem",
  "Data Backup Problem",
  "Data Recovery Request",
  "Storage Full",
  "File Corruption",
  "Database Access Problem",
  "Projector Problem",
  "Projector Installation",
  "Webcam Problem",
  "Speaker / Audio Problem",
  "Microphone Problem",
  "UPS Problem",
  "CCTV / Camera Problem",
  "Other ICT Equipment Problem",
  "System Configuration",
  "ICT Equipment Inspection",
  "Maintenance Request",
  "Technical Support Request",
  "Other ICT Issue",
];

/* Populated only from GET /api/categories/maintenance, which serves the same
   85 values for every category. Kept as a map so the lookup shape matches the
   API exactly; an unknown category still yields no options.

   There is deliberately no client-side fallback list. The catalogue above
   mirrors the backend for the verification script's parity check, not as a
   second source the form could render from: two sources could disagree, and a
   value present in one but not the other would be selectable in the form yet
   rejected by the API. */
let REQUEST_ISSUE_TYPES_BY_CATEGORY = {};

/* ── Field normalisers ─────────────────────────────────────────
   Two separate helpers, so a value is never run through the wrong field's
   rules. These are the client mirror of the identically-named functions in
   backend/utils/ictCategoryHierarchy.js. Defined ONCE here and not repeated
   in any other script. */
function normalizeCategoryValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeIssueTypeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/* Search key for the Issue Type filter.

   Punctuation and spacing are dropped so a typed query still finds the
   obvious option: "wifi" matches "Wi-Fi Problem", "harddisk" matches
   "Hard Disk / SSD Problem", "antivirus" matches "Antivirus Problem".
   Matching on the raw string instead would make those searches silently
   return nothing. */
function issueTypeSearchKey(value) {
  return normalizeIssueTypeValue(value).replace(/[^a-z0-9]+/g, "");
}

/* Category is stored as "<Group> > <Label>"; recover the bare label, which is
   the key used by the maps above. */
function resolveCategoryLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes(">")) return raw.slice(raw.indexOf(">") + 1).trim();
  return raw;
}

/* The Issue Type options for the selected Category. Empty when no usable
   category is chosen — the caller then shows the "Select Category First"
   state and keeps the field disabled.

   Every category maps to the same 85-value catalogue, so the returned list
   does not actually depend on which category was passed. The category is
   still resolved, and still yields [] when missing, so the gating above keeps
   working and an unknown category never silently returns the full list.

   Keys are stored normalised (see loadRequestIssueTypes), so the lookup is
   normalised too: the option value is the "<Group> > <Label>" string and the
   taxonomy key is the bare label, so both sides go through the same rule
   instead of relying on the two agreeing character for character. */
function getAllowedRequestIssueTypes(categoryValue) {
  const key = normalizeCategoryValue(resolveCategoryLabel(categoryValue));
  if (!key) return [];
  const list = REQUEST_ISSUE_TYPES_BY_CATEGORY[key];
  return list ? [...list] : [];
}
/* Device Type is deliberately NOT filtered by Category on this form.

   There is no category -> device-type map anywhere in this project. The only
   map that exists is the opposite direction (device -> categories, in
   backend/utils/deviceTypeCategories.js), and the requester endpoint
   GET /api/categories/maintenance sends categories and issue types only. The
   previous version of this function read a REQUEST_DEVICE_TYPES_BY_CATEGORY
   global that was never defined, so its `typeof` guard quietly produced an
   empty allow-set and it took the "allow everything" branch on every call:
   it looked like it filtered, but it could never do so, and its
   `deviceTypeEl.value = ""` reset was unreachable.

   Keeping the call sites (so the intent stays visible) but making the
   behaviour explicit means no reader can again assume a filter exists. If a
   category -> device-type map is ever added server-side, THIS is the one
   function that has to start honouring it. */
function filterDeviceTypeOptions() {
  const deviceTypeEl = document.getElementById("deviceType");
  if (!deviceTypeEl) return;

  /* Every populated option is offered regardless of the chosen category, so
     undo any option that an earlier revision may have hidden or disabled. */
  Array.from(deviceTypeEl.options).forEach((option) => {
    if (!option.value) return;
    option.hidden = false;
    option.disabled = false;
  });

  deviceTypeEl.disabled = false;
}

/* Rebuild the Issue Type dropdown for the chosen Category.

   The Category -> Issue Type dependency is real business logic, not a UI
   convenience: validateRequestFormFields() rejects any issue type that is not
   in the chosen category's list, and GET /api/categories/maintenance is the
   only source of that list. So this field legitimately stays closed until a
   category is picked.

   What was wrong before is that it reported the SAME dead-end
   ("Select Category First") for every situation in which it could not offer
   options — including the case where the taxonomy request itself had failed
   and no category could ever be picked. The requester had no way to tell a
   genuine dependency from a broken load, and no way to recover. Every
   distinguishable state is now named separately. */
function renderIssueTypeOptions(
  categoryValue = "",
  selectedValue = "",
  searchText = "",
) {
  const issueTypeEl = document.getElementById("issueType");
  if (!issueTypeEl) return;

  const search = issueTypeSearchKey(searchText);
  const allowed = getAllowedRequestIssueTypes(categoryValue);
  const hasCategory = resolveCategoryLabel(categoryValue) !== "";
  const matching = allowed.filter((issueType) =>
    issueTypeSearchKey(issueType).includes(search),
  );

  /* Decide which of the mutually exclusive states applies. Order matters: the
     transport failure is reported even when a category is still selected,
     because the options being shown are then stale and must not be trusted. */
  let placeholderText = "Select Category First";
  let helpText = "Select a category first to see its issue types.";
  let usable = false;

  if (_requestCategoryStatus === "idle") {
    placeholderText = "Select Device Type First";
    helpText = "Select a device type to load categories and issue types.";
  } else if (_requestCategoryStatus === "loading") {
    placeholderText = "Loading categories...";
    helpText = "Loading categories and issue types...";
  } else if (_requestCategoryStatus === "error") {
    placeholderText = "Issue types unavailable";
    helpText =
      "Categories could not be loaded, so issue types are unavailable.";
  } else if (_requestCategoryStatus === "empty") {
    placeholderText = "No issue types available";
    helpText =
      "No categories are configured, so there are no issue types to choose from.";
  } else if (_requestIssueTypeStatus === "loading") {
    placeholderText = "Loading issue types...";
    helpText = "Loading issue types for the selected category...";
  } else if (_requestIssueTypeStatus === "error") {
    placeholderText = "Issue types unavailable";
    helpText =
      _requestIssueTypeError || "Could not load issue types. Try again.";
  } else if (!hasCategory) {
    placeholderText = "Select Category First";
    helpText = "Select a category first to see its issue types.";
  } else if (!allowed.length) {
    placeholderText = "No issue types available";
    helpText = `This category has no issue types configured. ${shellI18n(
      "common.contactICT",
      "Please contact ICT.",
    )}`;
  } else {
    usable = true;
    placeholderText = "Select Issue Type / Service Type";
    helpText =
      search && !matching.length
        ? "No matching issue or service type."
        : search
          ? `${matching.length} of ${allowed.length} issue or service types match.`
          : `Choose the problem or service needed (${allowed.length} options). Search to narrow the list.`;
  }

  issueTypeEl.replaceChildren();
  const placeholder = new Option(placeholderText, "", true, true);
  placeholder.disabled = true;
  issueTypeEl.appendChild(placeholder);

  if (usable) {
    matching.forEach((issueType) => {
      issueTypeEl.appendChild(new Option(issueType, issueType));
    });
    /* Keep the current choice selectable while a search hides it, so typing in
       the search box never silently discards what was already chosen. */
    if (search && selectedValue && !matching.includes(selectedValue)) {
      const retained = new Option(selectedValue, selectedValue);
      retained.hidden = true;
      issueTypeEl.appendChild(retained);
    }
    if (search && !matching.length) {
      const empty = new Option("No matching issue or service type", "");
      empty.disabled = true;
      issueTypeEl.appendChild(empty);
    }
  }

  issueTypeEl.disabled = !usable;
  /* Preserve the selection whenever it is still legal for this category;
     drop it only when the category changed or the list went away. */
  issueTypeEl.value =
    usable && allowed.includes(selectedValue) ? selectedValue : "";

  const searchInput = document.getElementById("issueTypeSearch");
  const clearButton = document.getElementById("clearIssueType");
  const help = document.getElementById("issueTypeHelp");
  const retry = document.getElementById("issueTypeRetry");
  if (searchInput) searchInput.disabled = !usable;
  if (clearButton) clearButton.disabled = !issueTypeEl.value;
  if (help) help.textContent = helpText;
  if (retry)
    retry.classList.toggle("d-none", _requestIssueTypeStatus !== "error");

  toggleOtherIssueField();
}

/* Stored category values use the "Group > Label" form returned by the API. */
const NETWORK_CATEGORIES = new Set([
  "Network",
  "Internet",
  "ICT Infrastructure",
  "ICT Support > Network",
  "ICT Support > Internet",
  "ICT Support > ICT Infrastructure",
]);

/* ── Show/hide extra fields for network-related categories ─── */
function toggleNetworkSection() {
  const cat = document.getElementById("category")?.value;
  const sec = document.getElementById("networkDetailsSection");
  if (!sec) return;
  sec.classList.toggle("d-none", !isNetworkRequestCategory(cat));
}

function isNetworkRequestCategory(category) {
  return (
    NETWORK_CATEGORIES.has(category) ||
    [
      "Network & Connectivity >",
      "ICT Infrastructure >",
      "Internet & Network Services >",
    ].some((prefix) => String(category || "").startsWith(prefix))
  );
}

/* ── Device Type dropdown ───────────────────────────────────── */
let _requestCategoryLoadSequence = 0;
let _requestCategories = [];
/* Lifecycle of the single call that populates BOTH classification dropdowns.
   "idle"     nothing requested yet
   "loading"  request in flight
   "ready"    taxonomy received and rendered
   "empty"    server answered, but returned no categories at all
   "error"    request failed; Issue Type is unusable until it is retried */
let _requestCategoryStatus = "idle";
let _requestCategoryError = null;
let _requestIssueTypeStatus = "idle";
let _requestIssueTypeError = null;
let _submittingTicket = false;
let _requestSubmissionKey = "";

function getRequestSubmissionKey() {
  if (!_requestSubmissionKey) {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      _requestSubmissionKey = globalThis.crypto.randomUUID();
    } else {
      const bytes = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256),
      );
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytes
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      _requestSubmissionKey = [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-");
    }
  }
  return _requestSubmissionKey;
}

function clearRequestSubmissionKey() {
  _requestSubmissionKey = "";
}
/* Start time of the in-flight /categories/maintenance request, and how long we
   still consider it healthy. The end-of-init safety net needs this to tell
   three cases apart:
     • not in flight              -> whatever it shows is final
     • in flight, still fresh     -> leave it alone, it is on its way
     • in flight, past the grace  -> the request is hung; show an error
   Treating every in-flight request as a failure is what previously left the
   dropdown disabled and un-openable on a normal slow response. */
let _requestCategoryPendingAt = 0;
const REQUEST_LOADER_GRACE_MS = 10000;

/* Category status line + retry affordance, so a failed taxonomy load is
   recoverable instead of leaving a dead control behind. */
function setCategoryStatus(message = "", kind = "") {
  const status = document.getElementById("categoryStatus");
  const retry = document.getElementById("categoryRetry");
  if (status) {
    status.textContent = message;
    status.className = message
      ? `form-text mt-1 text-${kind === "error" ? "danger" : "muted"}`
      : "form-text mt-1";
  }
  /* Shown by state, not by "is there a message": the loading state also sets a
     message, and a Try again button beside a spinner would be misleading. */
  if (retry) retry.classList.toggle("d-none", kind !== "error");
}

function renderRequestCategoryOptions(selectedValue = "") {
  const categoryEl = document.getElementById("category");
  if (!categoryEl) return;

  const total = _requestCategories.reduce(
    (sum, group) => sum + (group.categories || []).length,
    0,
  );

  const placeholder = new Option(
    shellI18n("req.category.select", "Select Category"),
    "",
    true,
    true,
  );
  placeholder.disabled = true;
  categoryEl.replaceChildren(placeholder);

  /* Every group returned by GET /api/categories/maintenance becomes an
     <optgroup>, so the dropdown is grouped by taxonomy without any search box.
     No filtering is applied — the <select> itself is the control. */
  for (const group of _requestCategories) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.group;
    for (const category of group.categories || []) {
      optgroup.appendChild(new Option(category.label, category.value));
    }
    categoryEl.appendChild(optgroup);
  }

  /* "No categories available" is only ever shown for a REAL empty response
     from the server, never as a stand-in for a failure. */
  if (total === 0) {
    const noCategories = new Option(
      shellI18n("req.noCategories", "No categories available"),
      "",
    );
    noCategories.disabled = true;
    categoryEl.appendChild(noCategories);
  }

  const availableValues = new Set(
    _requestCategories.flatMap((group) =>
      (group.categories || []).map((category) => category.value),
    ),
  );
  /* Keep the requester's choice across a re-render (retry, Clear Form, a
     language switch) when the category still exists in the new taxonomy. */
  categoryEl.value = availableValues.has(selectedValue) ? selectedValue : "";
  _requestCategorySelection = categoryEl.value;
  if (selectedValue && categoryEl.value !== selectedValue) {
    clearCategoryError();
    toggleNetworkSection();
    /* The category they had is gone, so its issue types are no longer
       selectable — drop the now-illegal issue type too. */
    const issueTypeEl = document.getElementById("issueType");
    if (issueTypeEl && issueTypeEl.value) {
      issueTypeEl.value = "";
      clearIssueTypeError();
    }
  }

  /* Always leave the control openable once we have rendered. It is only
     disabled while a request is genuinely in flight. */
  categoryEl.disabled = false;

  if (total === 0) {
    setCategoryStatus(
      shellI18n(
        "req.category.empty",
        "No categories are configured yet. Please contact ICT.",
      ),
      "muted",
    );
  } else {
    setCategoryStatus();
  }

  renderIssueTypeOptions(categoryEl.value, issueTypeSelection());
}

/* The issue type currently chosen, so a re-render can put it back. */
function issueTypeSelection() {
  return document.getElementById("issueType")?.value || "";
}

function selectedDeviceType() {
  return document.getElementById("deviceType")?.value || "";
}

/* ── Device Type validation (self-contained) ──────────────────────
   The shared helpers in validation.js locate a field's message node with
   `field.parentNode.querySelector('.invalid-feedback')`. On the New Request
   form #deviceType is the ONE field whose parent (.section-body) holds more
   than one .invalid-feedback: the node belonging to the conditional
   "Specify Device Name" input sits between the select and #deviceTypeError,
   so it comes FIRST in document order. A plain showFieldError("deviceType")
   therefore wrote the Device Type message into the Specify Device Name box —
   which is hidden unless "Other ICT Device" was picked, so the requester saw
   no error at all — and clearFieldValidation() could delete that node
   outright, leaving a genuinely valid selection still flagged invalid.

   These helpers address the dropdown's OWN message node by id and re-create
   it in place if it is gone (Clear Form removes every .invalid-feedback), so
   the message always renders where aria-describedby points and the Bootstrap
   `~` sibling selector can reveal it. No other field is touched. */
const DEVICE_TYPE_ERROR_ID = "deviceTypeError";
const DEVICE_TYPE_ERROR_TEXT = "Please select a device type.";
const ISSUE_TYPE_ERROR_ID = "issueTypeFeedback";
const ISSUE_TYPE_ERROR_TEXT = "Please select an issue type or service.";

function resolveIssueTypeValue() {
  const issueTypeEl = document.getElementById("issueType");
  const otherIssueInput = document.getElementById("otherIssue");
  const currentValue = String(issueTypeEl?.value || "").trim();
  if (currentValue === OTHER_ISSUE_OPTION) {
    return String(otherIssueInput?.value || "").trim();
  }
  return currentValue;
}

function toggleOtherIssueField() {
  const issueTypeEl = document.getElementById("issueType");
  const container = document.getElementById("otherIssueContainer");
  const input = document.getElementById("otherIssue");
  const show = issueTypeEl && issueTypeEl.value === OTHER_ISSUE_OPTION;

  if (container) container.hidden = !show;
  if (input) {
    input.required = show;
    if (!show) {
      input.value = "";
      clearFieldValidation("otherIssue");
    }
  }
}

function deviceTypeFeedbackNode() {
  const field = document.getElementById("deviceType");
  if (!field) return null;

  let feedback = document.getElementById(DEVICE_TYPE_ERROR_ID);
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.id = DEVICE_TYPE_ERROR_ID;
    feedback.className = "invalid-feedback";
    feedback.setAttribute("role", "alert");
    /* Must be a following sibling of the select — Bootstrap only reveals an
       .invalid-feedback through the `~` combinator. */
    if (field.parentNode) field.parentNode.appendChild(feedback);
  }
  return feedback;
}

/* Mark the dropdown invalid and publish the message on its own node. */
function setDeviceTypeError(message) {
  const field = document.getElementById("deviceType");
  if (!field) return;
  field.classList.add("is-invalid");
  field.classList.remove("is-valid");
  const feedback = deviceTypeFeedbackNode();
  if (feedback) feedback.textContent = message || DEVICE_TYPE_ERROR_TEXT;
}

/* Drop the invalid state and reset the message. Leaves the valid state to the
   caller so this is safe to use from both the change and submit paths. */
function clearDeviceTypeError() {
  const field = document.getElementById("deviceType");
  if (!field) return;
  field.classList.remove("is-invalid");
  const feedback = deviceTypeFeedbackNode();
  if (feedback) feedback.textContent = DEVICE_TYPE_ERROR_TEXT;
}

/* Category validation, addressed by id.

   #category has the same problem as #deviceType: clearFieldValidation() looks
   the message node up with `field.parentNode.querySelector('.invalid-feedback')`
   and then REMOVES it (validation.js:142-143). The first .invalid-feedback it
   finds under #category's wrapper is the authored
   <div class="invalid-feedback" id="categoryFeedback"> that the select points
   at with aria-describedby. So every clearFieldValidation("category") call —
   and there are several, including one on every category change — destroyed
   that node, after which showFieldError() rebuilt an anonymous one with no id
   and aria-describedby="categoryFeedback" pointed at nothing for the rest of
   the page visit.

   These helpers address the node by id and re-create it in place if it is
   gone, so the aria reference survives. Same approach, same reason, as the
   device-type helpers above. */
const CATEGORY_ERROR_ID = "categoryFeedback";
const CATEGORY_ERROR_TEXT = "Please select a category.";

function categoryFeedbackNode() {
  const field = document.getElementById("category");
  if (!field) return null;

  let feedback = document.getElementById(CATEGORY_ERROR_ID);
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.id = CATEGORY_ERROR_ID;
    feedback.className = "invalid-feedback";
    feedback.setAttribute("role", "alert");
    feedback.textContent = CATEGORY_ERROR_TEXT;
    /* Must be a following sibling of the select so Bootstrap reveals it via
       the `~` combinator, and so it stays inside the wrapper the id lookup
       above expects. */
    if (field.parentNode) field.parentNode.appendChild(feedback);
  }
  return feedback;
}

function setCategoryError(message) {
  const field = document.getElementById("category");
  if (!field) return;
  field.classList.add("is-invalid");
  field.classList.remove("is-valid");
  const feedback = categoryFeedbackNode();
  if (feedback) feedback.textContent = message || CATEGORY_ERROR_TEXT;
}

function clearCategoryError() {
  const field = document.getElementById("category");
  if (!field) return;
  field.classList.remove("is-invalid", "is-valid");
  const feedback = categoryFeedbackNode();
  if (feedback) feedback.textContent = CATEGORY_ERROR_TEXT;
}

function issueTypeFeedbackNode() {
  const field = document.getElementById("issueType");
  if (!field) return null;

  let feedback = document.getElementById(ISSUE_TYPE_ERROR_ID);
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.id = ISSUE_TYPE_ERROR_ID;
    feedback.className = "invalid-feedback";
    feedback.setAttribute("role", "alert");
    field.insertAdjacentElement("afterend", feedback);
  }
  return feedback;
}

function setIssueTypeError(message = ISSUE_TYPE_ERROR_TEXT) {
  const field = document.getElementById("issueType");
  if (!field) return;
  field.classList.add("is-invalid");
  field.classList.remove("is-valid");
  const feedback = issueTypeFeedbackNode();
  if (feedback) feedback.textContent = message;
}

function clearIssueTypeError() {
  const field = document.getElementById("issueType");
  if (!field) return;
  field.classList.remove("is-invalid", "is-valid");
  const feedback = issueTypeFeedbackNode();
  if (feedback) feedback.textContent = ISSUE_TYPE_ERROR_TEXT;
}

/* Human-readable reason for a failed taxonomy load. The raw cause is always
   logged as well — the previous version threw the reason away entirely
   (`catch {`, no binding, no console output), which is why "Categories
   unavailable" could never be traced back to its cause. */
function describeCategoryLoadError(err) {
  const status = err?.status;
  if (err?.network || typeof status !== "number") {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (status === 401 || status === 403) {
    return "Your access token is not authorised for this list. Please sign in again.";
  }
  if (status === 404) {
    return "The category service was not found. Please contact ICT.";
  }
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  return "Unable to load categories. Please try again.";
}

/* Remembered across a failed load so Try again can put the requester's choice
   back. The error path replaces the option list with a single empty-valued
   option, which would otherwise discard the selection for good. */
let _requestCategorySelection = "";

function renderRequestCategoryError() {
  const categoryEl = document.getElementById("category");
  if (!categoryEl) return;

  if (categoryEl.value) _requestCategorySelection = categoryEl.value;

  /* The control is left ENABLED on purpose. Disabling it here is what made the
     field impossible to open at all, and there is nothing to interact with
     while a retry button exists beside it. */
  const option = new Option(
    shellI18n("req.category.failed", "Categories could not be loaded"),
    "",
    true,
    true,
  );
  option.disabled = true;
  categoryEl.replaceChildren(option);
  categoryEl.disabled = false;

  setCategoryStatus(describeCategoryLoadError(_requestCategoryError), "error");
  renderIssueTypeOptions(categoryEl.value);
}

function resetRequestClassification() {
  const categoryEl = document.getElementById("category");
  if (!categoryEl) return;

  _requestCategories = [];
  _requestCategoryError = null;
  _requestCategoryStatus = "idle";
  _requestIssueTypeStatus = "idle";
  _requestIssueTypeError = null;
  _requestCategorySelection = "";

  const placeholder = new Option("Select Device Type First", "", true, true);
  placeholder.disabled = true;
  categoryEl.replaceChildren(placeholder);
  categoryEl.disabled = true;
  setCategoryStatus("Select a device type to load categories.", "muted");
  renderIssueTypeOptions();
  toggleNetworkSection();
}

function isValidRequestCategoryGroups(groups) {
  return (
    Array.isArray(groups) &&
    groups.every(
      (group) =>
        typeof group.group === "string" &&
        Array.isArray(group.categories) &&
        group.categories.every(
          (category) =>
            typeof category.label === "string" &&
            typeof category.value === "string",
        ),
    )
  );
}

function isValidRequestIssueTypeMap(issueTypes) {
  return (
    !!issueTypes &&
    typeof issueTypes === "object" &&
    !Array.isArray(issueTypes) &&
    Object.keys(issueTypes).length > 0 &&
    Object.values(issueTypes).every(
      (list) =>
        Array.isArray(list) &&
        list.every((issueType) => typeof issueType === "string"),
    )
  );
}

async function loadRequestIssueTypes(issueTypes) {
  _requestIssueTypeStatus = "loading";
  _requestIssueTypeError = null;
  renderIssueTypeOptions(
    document.getElementById("category")?.value || "",
    issueTypeSelection(),
  );

  const issueTypeMap = isValidRequestIssueTypeMap(issueTypes)
    ? issueTypes
    : null;
  if (!isValidRequestIssueTypeMap(issueTypeMap)) {
    _requestIssueTypeStatus = "error";
    _requestIssueTypeError =
      "Issue types could not be loaded. Please try again.";
    renderIssueTypeOptions(
      document.getElementById("category")?.value || "",
      issueTypeSelection(),
    );
    return;
  }

  REQUEST_ISSUE_TYPES_BY_CATEGORY = Object.fromEntries(
    Object.entries(issueTypeMap).map(([label, list]) => [
      normalizeCategoryValue(label),
      [...new Set(list)],
    ]),
  );
  _requestIssueTypeStatus = "ready";
  renderIssueTypeOptions(
    document.getElementById("category")?.value || "",
    issueTypeSelection(),
    document.getElementById("issueTypeSearch")?.value || "",
  );
}

async function loadRequestCategories() {
  const categoryEl = document.getElementById("category");
  if (!categoryEl) return;
  if (!selectedDeviceType()) {
    resetRequestClassification();
    return;
  }

  const sequence = ++_requestCategoryLoadSequence;
  const previousSelection = categoryEl.value || _requestCategorySelection || "";

  _requestCategories = [];
  _requestCategoryError = null;
  _requestCategoryStatus = "loading";
  _requestIssueTypeStatus = "loading";
  _requestIssueTypeError = null;
  _requestCategoryPendingAt = Date.now();

  const loadingOption = new Option(
    shellI18n("req.category.loading", "Loading categories..."),
    "",
    true,
    true,
  );
  loadingOption.disabled = true;
  categoryEl.replaceChildren(loadingOption);
  /* Disabled only while the request is genuinely in flight, so a half-drawn
     list can never be picked. Every exit path below re-enables it. */
  categoryEl.disabled = true;
  clearCategoryError();
  setCategoryStatus(
    shellI18n("req.category.loading", "Loading categories..."),
    "muted",
  );
  renderIssueTypeOptions();
  toggleNetworkSection();

  /* ── Fetch. Rendering is deliberately OUTSIDE this try: a fault while
        drawing the list used to be reported to the requester as "categories
        unavailable", which is both wrong and undiagnosable. ─────────────── */
  let response;
  try {
    response = await apiRequest("/categories/maintenance");
    if (sequence !== _requestCategoryLoadSequence) return;

    if (!response?.success || !isValidRequestCategoryGroups(response.data)) {
      const err = new Error("The server returned an unusable category list.");
      err.status = 502;
      throw err;
    }
  } catch (err) {
    if (sequence !== _requestCategoryLoadSequence) return;
    _requestCategoryError = err;
    _requestCategoryStatus = "error";
    _requestIssueTypeStatus = "error";
    _requestIssueTypeError =
      "Categories could not be loaded, so issue types are unavailable.";
    console.error(
      "[New Request] GET /categories/maintenance failed; Category and Issue " +
        "Type are unavailable.",
      err,
    );
    renderRequestCategoryError();
    return;
  } finally {
    if (sequence === _requestCategoryLoadSequence)
      _requestCategoryPendingAt = 0;
  }

  if (sequence !== _requestCategoryLoadSequence) return;

  let total;
  try {
    _requestCategories = response.data;
    total = _requestCategories.reduce(
      (sum, group) => sum + (group.categories || []).length,
      0,
    );
    _requestCategoryStatus = total === 0 ? "empty" : "ready";
    if (total === 0) _requestIssueTypeStatus = "empty";

    renderRequestCategoryOptions(previousSelection);
    bindRequestCategoryField(categoryEl);
  } catch (err) {
    _requestCategoryError = err;
    _requestCategoryStatus = "error";
    _requestIssueTypeStatus = "error";
    _requestIssueTypeError =
      "Categories could not be loaded, so issue types are unavailable.";
    console.error("[New Request] Category list could not be rendered.", err);
    renderRequestCategoryError();
    return;
  }

  if (total > 0) await loadRequestIssueTypes(response.issueTypes);
}

function syncOtherDeviceNameField() {
  const group = document.getElementById("otherDeviceNameGroup");
  const input = document.getElementById("otherDeviceName");
  if (!group || !input) return;

  const required = selectedDeviceType() === "Other ICT Device";
  group.classList.toggle("d-none", !required);
  input.required = required;
  if (!required) {
    input.value = "";
    clearFieldValidation("otherDeviceName");
  }
}

async function loadDeviceTypeOptions() {
  const select = document.getElementById("deviceType");
  if (!select || !window.DeviceTypeSelect) return;

  try {
    const groups = await window.DeviceTypeSelect.fetch();
    const existingValues = new Set(
      Array.from(select.options, (option) => option.value),
    );

    for (const group of groups) {
      const optionGroup = document.createElement("optgroup");
      optionGroup.label = group.category;

      for (const device of group.devices || []) {
        if (existingValues.has(device.name)) continue;
        const option = document.createElement("option");
        option.value = device.name;
        option.textContent = device.name;
        optionGroup.appendChild(option);
        existingValues.add(device.name);
      }

      if (optionGroup.children.length) select.appendChild(optionGroup);
    }
  } catch {
    /* The built-in options keep the dropdown usable if the catalogue is offline. */
  }
}

function bindRequestCategoryField(categoryEl) {
  if (!categoryEl) return;
  /* Only the select's own listeners are guarded by the dataset flag, because
     the retry button is bound outside initSubmitRequest and must survive a
     re-render of the option list. */
  if (categoryEl.dataset.requestCategoryBound === "true") return;
  categoryEl.dataset.requestCategoryBound = "true";

  categoryEl.addEventListener("change", () => {
    /* A real selection clears the error and is marked valid, so a valid value
       can never still be flagged. clearCategoryError is used instead of
       clearFieldValidation because the latter deletes the node that
       aria-describedby points at. */
    if (categoryEl.value) {
      clearCategoryError();
      showFieldValid("category");
    }
    _requestCategorySelection = categoryEl.value;
    filterDeviceTypeOptions();

    /* The issue type belonging to the previous category is no longer legal,
       so start clean for the new one. */
    const issueTypeEl = document.getElementById("issueType");
    if (issueTypeEl) issueTypeEl.value = "";
    const issueSearch = document.getElementById("issueTypeSearch");
    if (issueSearch) issueSearch.value = "";

    renderIssueTypeOptions(categoryEl.value);
    clearIssueTypeError();
    toggleNetworkSection();
  });

  categoryEl.addEventListener("blur", () => {
    if (!categoryEl.value && !categoryEl.disabled) {
      setCategoryError(
        shellI18n("req.err.category", "Please select a category."),
      );
    }
  });
}

/* Idempotent: safe to call on every page init and after every retry. */
function bindRequestCategoryRetry() {
  const retry = document.getElementById("categoryRetry");
  if (!retry || retry.dataset.requestCategoryRetryBound === "true") return;
  retry.dataset.requestCategoryRetryBound = "true";
  retry.addEventListener("click", () => {
    /* The button hid itself the moment the list loaded, so only the error
       path can reach this. */
    void loadRequestCategories();
  });
}

function bindRequestIssueTypeRetry() {
  const retry = document.getElementById("issueTypeRetry");
  if (!retry || retry.dataset.requestIssueTypeRetryBound === "true") return;
  retry.dataset.requestIssueTypeRetryBound = "true";
  retry.addEventListener("click", async () => {
    _requestIssueTypeStatus = "loading";
    _requestIssueTypeError = null;
    renderIssueTypeOptions(
      document.getElementById("category")?.value || "",
      issueTypeSelection(),
    );
    try {
      const response = await apiRequest("/categories/maintenance");
      await loadRequestIssueTypes(response?.issueTypes);
    } catch (err) {
      _requestIssueTypeStatus = "error";
      _requestIssueTypeError =
        err?.message || "Issue types could not be loaded. Please try again.";
      console.error(
        "[New Request] Retry GET /categories/maintenance failed; Issue Type is unavailable.",
        err,
      );
      renderIssueTypeOptions(
        document.getElementById("category")?.value || "",
        issueTypeSelection(),
      );
    }
  });
}

function syncDeviceTypeCardSelection() {
  const value = selectedDeviceType();
  document.querySelectorAll("#deviceTypeCards .device-pick").forEach((card) => {
    const selected = card.dataset.deviceType === value;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
}

function bindDeviceTypeCards() {
  const container = document.getElementById("deviceTypeCards");
  const select = document.getElementById("deviceType");
  if (!container || !select) return;

  container.addEventListener("click", (event) => {
    const card = event.target.closest(".device-pick[data-device-type]");
    if (!card) return;
    select.value = card.dataset.deviceType;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  syncDeviceTypeCardSelection();
}

async function initSubmitRequest() {
  if (!requireRole("Requester")) return;
  const user = Auth.getUser();
  const nameEl = document.getElementById("requesterName");
  if (nameEl) {
    nameEl.value = user?.fullName || "";
    nameEl.readOnly = true;
  }

  /* Attach real-time validation */
  attachRealTimeValidation("requestForm", [
    {
      fieldId: "requesterName",
      checks: [(v) => Validators.name(v, "Full name")],
    },
    {
      fieldId: "title",
      checks: [(v) => Validators.length(v, "Title", 5, 200)],
    },
    {
      fieldId: "requestLocation",
      checks: [
        (v) => Validators.required(v, "Location"),
        (v) => Validators.length(v, "Location", 2, 200),
      ],
    },
    {
      fieldId: "description",
      checks: [(v) => Validators.length(v, "Description", 20, 1000)],
    },
    { fieldId: "requesterPhone", checks: [Validators.phone] },
  ]);

  /* Real-time validation for the category dropdown. */
  bindRequestCategoryField(document.getElementById("category"));
  bindRequestCategoryRetry();
  bindRequestIssueTypeRetry();

  const issueTypeEl = document.getElementById("issueType");
  issueTypeEl?.addEventListener("change", () => {
    clearIssueTypeError();
    if (issueTypeEl.value) showFieldValid("issueType");
    toggleOtherIssueField();
  });
  document.getElementById("issueTypeSearch")?.addEventListener("input", (e) => {
    renderIssueTypeOptions(
      document.getElementById("category")?.value || "",
      issueTypeSelection(),
      e.target.value,
    );
  });
  document.getElementById("clearIssueType")?.addEventListener("click", () => {
    const search = document.getElementById("issueTypeSearch");
    if (search) search.value = "";
    renderIssueTypeOptions(document.getElementById("category")?.value || "");
    clearIssueTypeError();
  });
  document.getElementById("otherIssue")?.addEventListener("input", () => {
    clearFieldValidation("otherIssue");
  });

  const deviceTypeEl = document.getElementById("deviceType");
  if (deviceTypeEl) {
    deviceTypeEl.addEventListener("change", () => {
      /* A valid selection must clear the error straight away, keep the value,
         and leave the field submittable. The placeholder "" does not count
         as a selection, so nothing is marked valid in that case. */
      if (deviceTypeEl.value) {
        clearDeviceTypeError();
        showFieldValid("deviceType");
      }
      syncOtherDeviceNameField();
      syncDeviceTypeCardSelection();
      filterRequestAssets();
      if (deviceTypeEl.value) void loadRequestCategories();
      else resetRequestClassification();
    });
    deviceTypeEl.addEventListener("blur", () => {
      if (!deviceTypeEl.value) setDeviceTypeError();
    });
  }
  syncOtherDeviceNameField();
  filterDeviceTypeOptions();
  /* Device Type starts the authenticated category/taxonomy request. */
  if (deviceTypeEl?.value) void loadRequestCategories();
  else resetRequestClassification();
  bindDeviceTypeCards();
  void loadDeviceTypeOptions();

  /* Real-time validation for asset dropdown */
  const assetEl = document.getElementById("asset");
  if (assetEl) {
    assetEl.addEventListener("change", () => {
      clearFieldValidation("asset");
      if (assetEl.value) {
        showFieldValid("asset");
      }
    });
  }

  document.getElementById("assetRetry")?.addEventListener("click", loadAssets);

  await loadAssets();

  document
    .getElementById("description")
    ?.addEventListener("input", function () {
      const el = document.getElementById("descCount");
      if (el) el.textContent = `${this.value.length} / 1000`;
    });

  document.getElementById("previewBtn")?.addEventListener("click", showPreview);
  document
    .getElementById("closePreviewBtn")
    ?.addEventListener("click", closePreview);
  document
    .getElementById("editPreviewBtn")
    ?.addEventListener("click", editPreview);
  document
    .getElementById("clearBtn")
    ?.addEventListener("click", clearRequestFormConfirm);
  document
    .getElementById("clearFormConfirmBtn")
    ?.addEventListener("click", clearRequestForm);

  document
    .getElementById("requestForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const form = e.target;
      const submitBtn = document.getElementById("submitBtn");

      /* ── Duplicate-submission guard ──
       While a request is in flight, or after it has already been successfully
       saved, repeated clicks must never create a second database record. */
      if (_submittingTicket) return;
      if (submitBtn && submitBtn.disabled) return;

      /* Validate every required field once — the same checks & messages used by the
       * Preview button, so Submit and Preview always agree on what is required. */
      const {
        hasError,
        deviceType,
        otherDeviceName,
        catValue,
        selectedIssueType,
        file,
      } = validateRequestFormFields();

      if (hasError) {
        /* Scroll to first error */
        const firstInvalid = form.querySelector(".is-invalid");
        if (firstInvalid)
          firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      /* Build the multipart body — field names match the backend exactly:
       title, equipmentType, problemDescription, phone, category, issueType,
       location, asset_id, attachment.
       NOTE: priority is deliberately NOT sent. It is admin-assigned only
       (createTicket forces "medium" for requester tickets), so the requester
       has no priority control to read from. */
      const fd = new FormData();
      fd.append("title", document.getElementById("title").value.trim());
      fd.append("equipmentType", deviceType);
      fd.append("deviceType", deviceType);
      if (otherDeviceName) fd.append("otherDeviceName", otherDeviceName);
      fd.append(
        "problemDescription",
        document.getElementById("description").value.trim(),
      );
      fd.append(
        "phone",
        document.getElementById("requesterPhone").value.trim(),
      );
      fd.append("category", catValue);
      fd.append("issueType", selectedIssueType);
      if (selectedIssueType === OTHER_ISSUE_OPTION) {
        fd.append(
          "otherIssue",
          document.getElementById("otherIssue").value.trim(),
        );
      }
      fd.append(
        "location",
        document.getElementById("requestLocation").value.trim(),
      );

      /* Append asset selection */
      const assetValue = document.getElementById("asset")?.value;
      fd.append("asset_id", assetValue || "");

      /* Network Maintenance details — appended only when the category is
       "Network Maintenance". All values are optional; empty strings become
       null on the backend. */
      if (isNetworkRequestCategory(catValue)) {
        fd.append(
          "serviceType",
          document.getElementById("networkServiceType")?.value || "",
        );
        fd.append(
          "networkDevice",
          (document.getElementById("networkDevice")?.value || "").trim(),
        );
        fd.append(
          "ipAddress",
          (document.getElementById("ipAddress")?.value || "").trim(),
        );
        fd.append(
          "macAddress",
          (document.getElementById("macAddress")?.value || "").trim(),
        );
        fd.append(
          "affectedUsers",
          document.getElementById("affectedUsers")?.value || "",
        );
      }

      if (file) fd.append("attachment", file);
      fd.append("submissionKey", getRequestSubmissionKey());

      /* Lock submit — disabled immediately while processing. Re-enabled ONLY on a
       FAILED submission so retry is possible; after success the page redirects
       to Track Request, so a duplicate database record can never be created. */
      _submittingTicket = true;
      setSubmitButtonLoading(true);
      let _submitted = false;

      try {
        /* apiRequest only resolves on a 2xx response — i.e. AFTER the backend
         validated the request and saved it to MongoDB via POST /api/tickets.
         The ticketId/date below are therefore the real stored values, never a
         fake frontend-generated ID. */
        const res = await apiRequest("/tickets", {
          method: "POST",
          body: fd,
          isFormData: true,
        });

        const mongoId = res?.data?.id || "";
        const ticketId = res?.data?.ticketId || "";
        const created = res?.data?.created_at || res?.data?.createdAt || "";
        clearRequestSubmissionKey();

        /* Professional success notification with the real Request ID. */
        showToast(
          `Maintenance request submitted successfully. Request ID: ${ticketId}.`,
          "success",
        );
        const alert = document.getElementById("requestAlert");
        if (alert) {
          alert.className =
            "alert alert-success d-flex align-items-start gap-2";
          alert.innerHTML = `
          <i class="bi bi-check-circle-fill fs-4 flex-shrink-0"></i>
          <div>
            <div><strong>Maintenance request submitted successfully.</strong></div>
            <div class="small mt-1">Request ID: <strong>${escHtml(ticketId)}</strong></div>
            ${created ? `<div class="small text-muted mt-1">Submitted: ${formatDateTime(created)}</div>` : ""}
            <div class="small text-muted mt-1"><i class="bi bi-box-arrow-right me-1"></i>Redirecting to Track Request...</div>
          </div>`;
        }

        /* Auto-redirect to the Track Request page and deep-link the new request
         using its real MongoDB ID. loadTrackingRequests() already auto-opens
         the detail modal for any ?id=<mongoId> in the URL. */
        const trackUrl = mongoId
          ? `tracking.html?id=${encodeURIComponent(mongoId)}`
          : "tracking.html";
        /* _submitted = true, so the finally below knows the ticket really was
           stored and the button must stay locked until the redirect. */
        _submitted = true;
        setTimeout(() => {
          window.location.href = trackUrl;
        }, 2500);
      } catch (err) {
        console.error("Submit request failed:", err);
        showAlert(
          "requestAlert",
          err?.message ||
            "Unable to submit request. Please review your details and try again.",
          "danger",
        );
        /* Re-enable only here — the attempt failed, so the user may retry.
           Their entered form data is left untouched. */
        _submittingTicket = false;
      } finally {
        /* Previously the re-enable lived only in the catch, so any throw
           between the POST and the redirect left the form permanently
           disabled with a live spinner. Success keeps the lock (the redirect
           is coming); every other path releases it. */
        if (!_submitted) setSubmitButtonLoading(false);
      }
    });
}

/* ── Submit button state (New Request form) ────────────────
   idle → [ send icon ] Submit Request          (enabled)
   busy → [ spinner ] Submitting Request...     (disabled) */
function setSubmitButtonLoading(isLoading) {
  const btn = document.getElementById("submitBtn");
  const sp = document.getElementById("submitSpinner");
  const icon = document.getElementById("submitIcon");
  const label = document.getElementById("submitBtnLabel");
  if (btn) btn.disabled = isLoading;
  if (sp) sp.classList.toggle("d-none", !isLoading);
  if (icon) icon.classList.toggle("d-none", isLoading);
  if (label)
    label.textContent = isLoading ? "Submitting Request..." : "Submit Request";
  /* While the request is in flight the whole action area is locked so no
     secondary click can interfere with (or duplicate) the submission. */
  ["previewBtn", "clearBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = isLoading;
  });
}

/* ── Shared New Request field validation ───────────────────
   Used by BOTH the Preview button and the Submit handler so the two actions
   always agree on what is required and which messages to show. Returns the
   vetted values so callers do not re-read the DOM. */
function validateRequestFormFields() {
  let hasError = false;

  const nameErr = Validators.name(
    document.getElementById("requesterName")?.value,
    "Full name",
  );
  if (nameErr) {
    showFieldError("requesterName", nameErr);
    hasError = true;
  } else {
    showFieldValid("requesterName");
  }

  const titleErr = Validators.length(
    document.getElementById("title")?.value,
    "Title",
    5,
    200,
  );
  if (titleErr) {
    showFieldError("title", titleErr);
    hasError = true;
  } else {
    showFieldValid("title");
  }

  const locationVal = document.getElementById("requestLocation")?.value;
  const locationErr =
    Validators.required(locationVal, "Location") ||
    Validators.length(locationVal, "Location", 2, 200);
  if (locationErr) {
    showFieldError("requestLocation", locationErr);
    hasError = true;
  } else {
    showFieldValid("requestLocation");
  }

  const deviceType = selectedDeviceType();
  const assetValue = document.getElementById("asset")?.value || "";
  if (!assetValue) {
    showFieldError(
      "asset",
      shellI18n("req.err.asset", "Please select an ICT asset."),
    );
    hasError = true;
  } else {
    clearFieldValidation("asset");
  }

  if (!deviceType) {
    setDeviceTypeError();
    hasError = true;
  } else {
    /* A real selection is never treated as empty: clear the error and mark
       the dropdown valid so the requester can submit. */
    clearDeviceTypeError();
    showFieldValid("deviceType");
  }

  const otherDeviceName =
    document.getElementById("otherDeviceName")?.value.trim() || "";
  if (deviceType === "Other ICT Device") {
    const otherDeviceNameError =
      Validators.required(otherDeviceName, "Device name") ||
      Validators.length(otherDeviceName, "Device name", 2, 120);
    if (otherDeviceNameError) {
      showFieldError("otherDeviceName", otherDeviceNameError);
      hasError = true;
    } else {
      showFieldValid("otherDeviceName");
    }
  } else {
    clearFieldValidation("otherDeviceName");
  }

  const categoryEl = document.getElementById("category");
  const catValue = categoryEl?.value || "";
  const categoryIsAllowed = Array.from(categoryEl?.options || []).some(
    (option) => option.value === catValue && !option.disabled,
  );
  if (!categoryIsAllowed) {
    /* Distinct message when the taxonomy itself never arrived, so the requester
       is told to retry rather than being told they forgot to pick a category
       they had no way of picking. */
    setCategoryError(
      _requestCategoryStatus === "error"
        ? "Categories could not be loaded. Use Try again above, then select a category."
        : shellI18n("req.err.category", "Please select a category."),
    );
    hasError = true;
  } else {
    clearCategoryError();
    showFieldValid("category");
  }

  const issueTypeEl = document.getElementById("issueType");
  const selectedIssueType = issueTypeEl?.value || "";
  const allowedIssueTypes = getAllowedRequestIssueTypes(catValue);
  let issueTypeErr = null;
  if (_requestIssueTypeStatus === "error") {
    issueTypeErr =
      _requestIssueTypeError ||
      "Issue types could not be loaded. Please try again.";
  } else if (_requestIssueTypeStatus === "loading") {
    issueTypeErr = "Issue types are still loading. Please wait.";
  } else if (!categoryIsAllowed) {
    issueTypeErr = "Select a category first to load issue types.";
  } else if (!allowedIssueTypes.length) {
    issueTypeErr =
      "No issue types are configured for this category. Please contact ICT.";
  } else if (
    !selectedIssueType ||
    !allowedIssueTypes.includes(selectedIssueType)
  ) {
    issueTypeErr = ISSUE_TYPE_ERROR_TEXT;
  }
  if (issueTypeErr) {
    setIssueTypeError(issueTypeErr);
    hasError = true;
  } else {
    clearIssueTypeError();
    showFieldValid("issueType");
  }

  const otherIssueValue =
    document.getElementById("otherIssue")?.value.trim() || "";
  if (selectedIssueType === OTHER_ISSUE_OPTION) {
    const otherIssueErr =
      Validators.required(otherIssueValue, "Issue or service") ||
      Validators.length(otherIssueValue, "Issue or service", 2, 150);
    if (otherIssueErr) {
      showFieldError("otherIssue", otherIssueErr);
      hasError = true;
    } else {
      showFieldValid("otherIssue");
    }
  } else {
    clearFieldValidation("otherIssue");
  }

  /* Priority is intentionally not validated: it is admin-assigned only, and
     the requester form has no priority control (see createTicket in
     backend/controllers/ticketController.js). */

  const descErr = Validators.length(
    document.getElementById("description")?.value,
    "Description",
    20,
    1000,
  );
  if (descErr) {
    showFieldError("description", descErr);
    hasError = true;
  } else {
    showFieldValid("description");
  }

  const phoneErr = Validators.phone(
    document.getElementById("requesterPhone")?.value,
  );
  if (phoneErr) {
    showFieldError("requesterPhone", phoneErr);
    hasError = true;
  } else {
    clearFieldValidation("requesterPhone");
  }

  /* Validate attachment: max 5 MB and allowed types (JPG, PNG, GIF, PDF, DOC, DOCX, XLSX, TXT). */
  const file = document.getElementById("attachment")?.files[0];
  if (file) {
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showFieldError("attachment", "Attachment must be no larger than 5MB.");
      hasError = true;
    } else if (
      !/\.(jpeg|jpg|png|gif|pdf|doc|docx|xlsx|txt)$/i.test(file.name)
    ) {
      showFieldError(
        "attachment",
        "Invalid file type. Allowed: JPG, PNG, PDF, DOC.",
      );
      hasError = true;
    } else {
      clearFieldValidation("attachment");
    }
  }

  return {
    hasError,
    deviceType,
    otherDeviceName,
    catValue,
    selectedIssueType,
    file,
  };
}

/* ── Clear form action ─────────────────────────────────────
   The trash button wipes the unsaved New Request form ONLY — nothing has been
   saved yet, so there is NO database operation of any kind. A Bootstrap modal
   confirms the intent first; [Clear Form] then resets the form to pristine. */
function clearRequestFormConfirm() {
  const modal = document.getElementById("clearFormModal");
  if (modal) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
  } else {
    clearRequestForm();
  }
}

function clearRequestForm() {
  const form = document.getElementById("requestForm");
  if (form) form.reset();
  _requestCategorySelection = "";
  clearRequestSubmissionKey();
  resetRequestClassification();
  syncDeviceTypeCardSelection();
  syncOtherDeviceNameField();

  /* Remove every validation class and dynamically-added .invalid-feedback */
  clearAllFieldValidations("requestForm");
  /* The sweep also deletes #categoryFeedback, which aria-describedby points
     at, so restore it before anything can write to it. */
  categoryFeedbackNode();

  /* Reset the description character counter */
  const cnt = document.getElementById("descCount");
  if (cnt) cnt.textContent = "0 / 1000";

  /* Hide the preview / summary card and any status alert */
  const summary = document.getElementById("summaryCard");
  if (summary) summary.classList.add("d-none");
  const content = document.getElementById("summaryContent");
  if (content) content.innerHTML = "";
  const alert = document.getElementById("requestAlert");
  if (alert) {
    alert.className = "alert d-none";
    alert.innerHTML = "";
  }

  /* Hide the network detail block after resetting its fields. */
  const netSec = document.getElementById("networkDetailsSection");
  if (netSec) netSec.classList.add("d-none");

  /* Restore the submit button to idle — nothing is in flight anymore */
  _submittingTicket = false;
  setSubmitButtonLoading(false);

  /* Close the confirmation modal if it was the entry point */
  const modal = document.getElementById("clearFormModal");
  if (modal && bootstrap.Modal.getInstance(modal))
    bootstrap.Modal.getInstance(modal).hide();

  showToast("Form cleared.", "info");
}

/* ── Live summary — never saved, reflects the form's current values ── */
function showPreview() {
  /* Preview must NOT create a MongoDB record. Block the summary when required
     fields are missing so the user is never shown a half-empty preview. */
  const { hasError, deviceType } = validateRequestFormFields();
  if (hasError) {
    const card = document.getElementById("summaryCard");
    if (card) card.classList.add("d-none");
    showAlert(
      "requestAlert",
      "Please complete the required fields before previewing.",
      "warning",
    );
    const firstInvalid = document.querySelector(".is-invalid");
    if (firstInvalid)
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const name = document.getElementById("requesterName")?.value || "—";
  const phone = document.getElementById("requesterPhone")?.value || "—";
  const title = document.getElementById("title")?.value || "—";
  const loc = document.getElementById("requestLocation")?.value || "—";
  const catEl = document.getElementById("category");
  const cat = catEl?.value || "—";
  /* Priority is admin-assigned (always "medium" for a new requester ticket),
     so it is shown read-only rather than as a requester-chosen value. */
  const pri = "Medium";
  const desc = document.getElementById("description")?.value || "—";
  const assetEl = document.getElementById("asset");
  const asset =
    assetEl?.value === "none"
      ? shellI18n("req.assetNone", "No Asset / Not Applicable")
      : assetEl?.selectedOptions[0]?.text || "—";
  const file = document.getElementById("attachment")?.files[0];
  const attach = file ? file.name : "No attachment attached";
  const priC = "secondary";
  const devI = deviceType ? "bi-pc-display" : "bi-cpu";
  const devLabel = deviceType || "Not Specified";

  /* Network Maintenance summary rows — shown only when the requester picked
     the "Network Maintenance" category, so non-network requests stay clean. */
  const networkRows = isNetworkRequestCategory(cat)
    ? `
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Service Type</div><div>${escHtml(document.getElementById("networkServiceType")?.value || "—")}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Network Device</div><div>${escHtml(document.getElementById("networkDevice")?.value || "—")}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">IP Address</div><div>${escHtml(document.getElementById("ipAddress")?.value || "—")}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">MAC Address</div><div>${escHtml(document.getElementById("macAddress")?.value || "—")}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Affected Users</div><div>${escHtml(document.getElementById("affectedUsers")?.value || "—")}</div></div>`
    : "";

  const card = document.getElementById("summaryCard");
  const content = document.getElementById("summaryContent");
  if (!card || !content) return;

  content.innerHTML = `
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Requester</div><div class="fw-semibold">${escHtml(name)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Phone</div><div class="fw-semibold">${escHtml(phone)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Device</div>
      <div class="fw-semibold text-capitalize"><i class="bi ${devI} me-1"></i>${escHtml(devLabel)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Priority</div>
      <span class="badge bg-${priC}">${escHtml(pri)}</span>
      <span class="text-muted small ms-1">set by admin</span></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Category</div><div>${escHtml(cat)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1"><i class="bi bi-geo-alt me-1"></i>Location</div><div class="fw-semibold">${escHtml(loc)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">ICT Asset</div><div>${escHtml(asset)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Attachment</div>
      <div class="small text-truncate" title="${escHtml(attach)}"><i class="bi bi-paperclip me-1"></i>${escHtml(attach)}</div></div>
    <div class="col-12"><div class="text-muted small mb-1">Title</div><div class="fw-semibold">${escHtml(title)}</div></div>
    <div class="col-12"><div class="text-muted small mb-1">Problem Description</div>
      <div class="p-2 bg-white border rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(desc)}</div></div>
    ${networkRows}`;

  card.classList.remove("d-none");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePreview() {
  document.getElementById("summaryCard")?.classList.add("d-none");
}

function editPreview() {
  closePreview();
  document
    .getElementById("requestForm")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("title")?.focus();
}

/* ═══════════════════════════════════════════════════════════
   TRACKING PAGE  —  real request tracking (Requester)
   Flow: auth → GET /api/tickets/my → skeleton while the request is
   actually in flight → cards rendered from the database records.
   Authorization is enforced by the backend, which only ever returns the
   authenticated user's own tickets.
   ═══════════════════════════════════════════════════════════ */

let _tracking = { all: [], controlsBound: false };

async function initTracking() {
  if (!requireRole("Requester")) return;
  if (!_tracking.controlsBound) {
    _tracking.controlsBound = true;
    bindTrackingControls();
  }
  await loadTrackingRequests();
}

/* Fetch the authenticated requester's requests from the backend.
   Always re-runnable so "Try Again" performs a real fresh API request. */
async function loadTrackingRequests() {
  renderTrackingSkeleton();

  let data;
  try {
    ({ data } = await apiRequest("/tickets/my"));
  } catch (err) {
    console.error("Load tracking failed:", err);
    showToast(err.message, "danger");
    renderTrackingError(err);
    return;
  }

  _tracking.all = Array.isArray(data) ? data : [];
  applyTrackingFilter();

  /* Arrived from a notification click (tracking.html?id=...) → open it directly */
  const focusId = new URLSearchParams(window.location.search).get("id");
  if (focusId) openDetailModal(focusId);
}

function bindTrackingControls() {
  const byId = (id) => document.getElementById(id);
  const doFilter = () => applyTrackingFilter();

  byId("searchBtn")?.addEventListener("click", doFilter);
  byId("searchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFilter();
  });
  byId("searchInput")?.addEventListener("input", () => toggleClearFilters());
  byId("statusFilter")?.addEventListener("change", doFilter);
  byId("priorityFilter")?.addEventListener("change", doFilter);
  byId("sortFilter")?.addEventListener("change", doFilter);
  byId("clearFiltersBtn")?.addEventListener("click", () => {
    ["searchInput", "statusFilter", "priorityFilter"].forEach((id) => {
      const el = byId(id);
      if (el) el.value = "";
    });
    byId("sortFilter").value = "newest";
    applyTrackingFilter();
  });
}

/* Normalise a search term so "TK-0049", "tk-0049" and "MAU-0049" all match the
   MAU-XXXX codes returned by the API (legacy + new tickets). */
function normalizeSearchTerm(v) {
  return (v || "").toString().trim().toLowerCase().replace(/^tk-/i, "mau-");
}

function toggleClearFilters() {
  const btn = document.getElementById("clearFiltersBtn");
  if (!btn) return;
  const active =
    !!document.getElementById("searchInput")?.value.trim() ||
    !!document.getElementById("statusFilter")?.value ||
    !!document.getElementById("priorityFilter")?.value;
  btn.classList.toggle("d-none", !active);
}

function currentTrackingFilters() {
  return {
    q: normalizeSearchTerm(document.getElementById("searchInput")?.value),
    status: document.getElementById("statusFilter")?.value || "",
    priority: document.getElementById("priorityFilter")?.value || "",
    sort: document.getElementById("sortFilter")?.value || "newest",
  };
}

/* Search (including Category) + status + priority + sort. */
function applyTrackingFilter() {
  toggleClearFilters();
  const { q, status, priority, sort } = currentTrackingFilters();

  let list = _tracking.all.filter(
    (r) =>
      (!q ||
        `${r.ticketId || ""} ${r.title || ""} ${r.equipmentType || ""} ${r.device || ""} ${r.category || ""} ${r.problemDescription || ""}`
          .toLowerCase()
          .includes(q)) &&
      (!status || r.status === status) &&
      (!priority || r.priority === priority),
  );

  list.sort((a, b) =>
    sort === "oldest"
      ? new Date(a.created_at) - new Date(b.created_at)
      : new Date(b.created_at) - new Date(a.created_at),
  );

  renderTrackingCards(list);
}

/* LOADING — skeleton shown only while the API request is running. */
function renderTrackingSkeleton() {
  const container = document.getElementById("requestsList");
  if (!container) return;
  const countEl = document.getElementById("trackingCount");
  if (countEl) countEl.textContent = "…";

  const card = (i) => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100 p-3">
        <div class="tk-skeleton-line mb-2" style="height:14px;width:45%;animation-delay:${i * 0.08}s;"></div>
        <div class="tk-skeleton-line mb-2" style="height:16px;width:80%;animation-delay:${i * 0.08}s;"></div>
        <div class="tk-skeleton-line mb-2" style="height:12px;width:60%;animation-delay:${i * 0.08}s;"></div>
        <div class="tk-skeleton-line mb-3" style="height:14px;width:30%;animation-delay:${i * 0.08}s;"></div>
        <div class="tk-skeleton-line" style="height:34px;width:100%;animation-delay:${i * 0.08}s;"></div>
      </div>
    </div>`;
  container.innerHTML = Array.from({ length: 6 }, (_, i) => card(i)).join("");
}

/* SUCCESS — real requests returned from the database. */
function renderTrackingCards(list) {
  const container = document.getElementById("requestsList");
  if (!container) return;
  const countEl = document.getElementById("trackingCount");
  const countWrap = countEl?.closest(".d-flex");
  /* Count = TOTAL submissions from the DB, never the filtered subset. */
  if (countEl) countEl.textContent = _tracking.all.length;

  /* EMPTY — the authenticated requester has no requests at all. */
  if (!_tracking.all.length) {
    if (countWrap) countWrap.style.display = "none";
    container.innerHTML = `
      <div class="col-12">
        <div class="card border-0 shadow-sm text-center py-5">
          <div class="card-body">
            <i class="bi bi-inbox fs-1 text-muted d-block mb-3"></i>
            <h6 class="fw-bold mb-1">No requests found</h6>
            <p class="text-muted mb-3">You haven't submitted any maintenance requests yet.</p>
            <a href="request.html" class="btn btn-primary">
              <i class="bi bi-plus-circle me-1"></i>Submit your first request
            </a>
          </div>
        </div>
      </div>`;
    return;
  }

  /* Has requests — ensure count wrapper is visible */
  if (countWrap) countWrap.style.display = "";

  /* Filters removed every visible request → offer to clear them. */
  if (!list.length) {
    container.innerHTML = `
      <div class="col-12">
        <div class="card border-0 shadow-sm text-center py-5">
          <div class="card-body">
            <i class="bi bi-funnel fs-1 text-muted d-block mb-3"></i>
            <h6 class="fw-bold mb-1">No requests match your filters</h6>
            <p class="text-muted mb-3">Try a different search term, status or priority.</p>
            <button class="btn btn-outline-primary" id="retryClearFiltersBtn">
              <i class="bi bi-arrow-counterclockwise me-1"></i>Clear filters
            </button>
          </div>
        </div>
      </div>`;
    container
      .querySelector("#retryClearFiltersBtn")
      ?.addEventListener("click", () => {
        ["searchInput", "statusFilter", "priorityFilter"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        document.getElementById("sortFilter").value = "newest";
        applyTrackingFilter();
      });
    return;
  }

  const priColour = {
    critical: "#dc3545",
    high: "#fd7e14",
    medium: "#2563eb",
    low: "#198754",
  };
  container.innerHTML = list
    .map((r) => {
      const heading = (r.title || r.problemDescription || "").trim();
      return `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100" style="border-left:4px solid ${priColour[r.priority] || "#6c757d"}!important;">
        <div class="card-body p-3 d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
            <span class="fw-bold text-primary small">${escHtml(r.ticketId || r.id)}</span>
            ${priorityBadge(r.priority)}
          </div>
          <h6 class="fw-semibold mb-1" title="${escHtml(r.problemDescription)}">${escHtml(heading)}</h6>
          ${r.requester_name ? `<div class="small text-muted mb-2"><i class="bi bi-person me-1"></i>${escHtml(r.requester_name)}</div>` : ""}
          <div class="small text-muted mb-2">${escHtml(r.equipmentType || "Uncategorised")}${r.category ? " · " + escHtml(r.category) : ""}${r.device ? " · " + escHtml(r.device) : ""}</div>
          <div class="small mb-2"><span class="text-muted">Issue Type:</span> ${escHtml(r.issueType || r.serviceType || "—")}</div>
          <div class="small text-muted mb-2"><i class="bi bi-geo-alt me-1"></i>${escHtml(r.location || "Not provided")}</div>
          <div class="mb-2">${statusBadge(r.status)}</div>
          <div class="mt-auto pt-3 small text-muted">
            <div><i class="bi bi-calendar3 me-1"></i>Submitted ${formatDateTime(r.created_at)}</div>
            ${r.assignedTechnician ? `<div><i class="bi bi-wrench me-1"></i>Technician: ${escHtml(r.assignedTechnician)}</div>` : ""}
            <div><i class="bi bi-arrow-repeat me-1"></i>Updated ${timeAgo(r.updated_at)}</div>
          </div>
        </div>
        <div class="card-footer bg-transparent border-0 pb-3 px-3">
          <button class="btn btn-outline-primary btn-sm w-100"
                  onclick="openDetailModal('${r.id}')"
                  data-bs-toggle="modal" data-bs-target="#requestDetailModal">
            <i class="bi bi-eye me-1"></i>View Details
          </button>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

/* ERROR — the API/database call failed. Shows the real reason too, but the
   primary message is the user-facing headline, with a live "Try Again". */
function renderTrackingError(err) {
  const container = document.getElementById("requestsList");
  if (!container) return;
  const countEl = document.getElementById("trackingCount");
  if (countEl) countEl.textContent = "—";

  /* Give users an accurate headline based on the real failure type instead of
     always claiming the server is unreachable:
       - err.network   → genuine network/connection failure
       - err.status    → real HTTP error from the backend (401/403/404/422/500)
       - otherwise     → timeout or unexpected error */
  const isNetwork = !!err.network;
  const isHttp = typeof err.status === "number";
  const icon = isNetwork
    ? "bi-cloud-slash"
    : isHttp
      ? "bi-exclamation-triangle"
      : "bi-hourglass-split";
  const headline = isNetwork
    ? "Unable to reach the server."
    : isHttp
      ? `Request failed (${err.status}).`
      : "The request did not complete.";
  const subtitle = isNetwork
    ? "The server could not be reached right now. Your requests are safe — check the connection and try again."
    : isHttp
      ? "The server responded with an error. Your requests are unchanged."
      : "The request timed out or did not complete. Please try again.";

  container.innerHTML = `
    <div class="col-12">
      <div class="card border-0 shadow-sm text-center py-5">
        <div class="card-body">
          <i class="bi ${icon} fs-1 text-danger d-block mb-3"></i>
          <h6 class="fw-bold text-danger mb-1">Unable to load your requests.</h6>
          <p class="text-muted mb-1">${escHtml(subtitle)}</p>
          <p class="small text-muted mb-3"><span class="text-danger">Reason:</span> ${escHtml(err.message)}</p>
          <button class="btn btn-primary" id="retryTrackingBtn">
            <i class="bi bi-arrow-clockwise me-1"></i>Try Again
          </button>
          <a href="request.html" class="btn btn-outline-secondary">
            <i class="bi bi-plus-circle me-1"></i>Submit a Request
          </a>
        </div>
      </div>
    </div>`;
  container
    .querySelector("#retryTrackingBtn")
    ?.addEventListener("click", () => loadTrackingRequests());
}

/* ═══════════════════════════════════════════════════════════
   REQUEST DETAIL MODAL (shared — user tracking + admin)
   ═══════════════════════════════════════════════════════════ */
function ticketErrorMessage(err) {
  if (!err) return "Unable to load ticket details. Please try again.";
  if (err.status === 404)
    return "Request details are unavailable. The service request may have been removed or is no longer accessible.";
  if (err.status === 403) return "You are not authorized to view this ticket.";
  return "Unable to load ticket details. Please try again.";
}

function renderAdminFeedbackSummary(feedback) {
  if (!feedback) return "";
  return `
    <div class="border-top mt-3 pt-3">
      <div class="d-flex align-items-center gap-2 mb-2">
        <i class="bi bi-clipboard2-check text-primary"></i>
        <strong class="small">Admin Feedback</strong>
        ${feedback.reportReviewDecision ? `<span class="badge text-bg-primary">${escHtml(feedback.reportReviewDecision)}</span>` : ""}
        ${feedback.evaluationStatus ? `<span class="badge text-bg-secondary">${escHtml(feedback.evaluationStatus)}</span>` : ""}
        ${feedback.ticketStatus ? statusBadge(feedback.ticketStatus) : ""}
      </div>
      <div class="small p-3 bg-light rounded" style="white-space:pre-wrap;">${escHtml(feedback.adminComment || "No feedback message provided.")}</div>
      <div class="small text-muted mt-2">Work quality: ${escHtml(feedback.workQuality || "—")} · Technical accuracy: ${escHtml(feedback.technicalAccuracy || "—")} · Repair effectiveness: ${escHtml(feedback.repairEffectiveness || "—")} · Report completeness: ${escHtml(feedback.reportCompleteness || "—")} · Safety compliance: ${escHtml(feedback.safetyProcedureCompliance || "—")}</div>
      <div class="d-flex flex-wrap gap-3 mt-2 text-muted" style="font-size:.75rem;">
        <span><i class="bi bi-person-badge me-1"></i>${escHtml(feedback.admin_name || "ICT Admin")}</span>
        <span><i class="bi bi-ticket-detailed me-1"></i>${escHtml(feedback.ticketId || "Ticket")}</span>
        <span><i class="bi bi-clock me-1"></i>${feedback.submittedAt ? formatDateTime(feedback.submittedAt) : "—"}</span>
      </div>
      ${feedback.relatedAction ? `<div class="small text-muted mt-2"><strong>Related action:</strong> ${escHtml(feedback.relatedAction)}</div>` : ""}
      ${feedback.followUpRequired ? `<div class="alert alert-warning py-2 px-3 mt-2 mb-0 small"><i class="bi bi-arrow-repeat me-1"></i>Follow-up required${feedback.followUpNotes ? `: ${escHtml(feedback.followUpNotes)}` : ""}</div>` : ""}
    </div>`;
}

async function openDetailModal(id) {
  const body = document.getElementById("requestDetailBody");
  if (body)
    body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;

  const modal = document.getElementById("requestDetailModal");
  if (modal && !bootstrap.Modal.getInstance(modal))
    new bootstrap.Modal(modal).show();

  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);
    const adminFeedbackHtml = renderAdminFeedbackSummary(r.admin_feedback);
    const mLabel = document.getElementById("requestDetailModalLabel");
    if (mLabel) mLabel.textContent = r.ticketId || "Request Details";
    if (body) {
      body.innerHTML = `
        <div class="row g-3">
          <div class="col-md-8">
            <div class="text-muted small fw-bold text-uppercase mb-1">Ticket</div>
            <h5 class="mb-2">${escHtml(r.ticketId || r.id)}</h5>
            ${r.title ? `<h6 class="fw-semibold mb-3">${escHtml(r.title)}</h6>` : ""}
            ${
              r.requester_name
                ? `<div class="d-flex gap-3 mb-2 flex-wrap">
              <span class="text-muted small"><i class="bi bi-person me-1"></i><strong>${escHtml(r.requester_name)}</strong></span>
              ${r.phone ? `<span class="text-muted small"><i class="bi bi-telephone me-1"></i>${escHtml(r.phone)}</span>` : ""}
              ${r.equipmentType ? `<span class="text-muted small"><i class="bi bi-laptop me-1"></i>${escHtml(r.equipmentType)}</span>` : ""}
            </div>`
                : ""
            }
            <div class="text-muted small fw-bold text-uppercase mb-1 mt-2">Description</div>
            <div class="p-3 bg-light rounded" style="white-space:pre-wrap;font-size:.875rem;">${escHtml(r.problemDescription)}</div>
          </div>
          <div class="col-md-4">
            <div class="card bg-light border-0 p-3 h-100">
              <div class="mb-2"><div class="text-muted small mb-1">Status</div>${statusBadge(r.status)}</div>
              <div class="mb-2"><div class="text-muted small mb-1">Priority</div>${priorityBadge(r.priority)}</div>
              <div class="mb-2"><div class="text-muted small mb-1">Equipment</div><span class="small">${escHtml(r.equipmentType || "—")}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1">Category</div><span class="small">${escHtml(r.category || "—")}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1">Issue Type / Service Type</div><span class="small">${escHtml(r.issueType || r.serviceType || "—")}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1"><i class="bi bi-geo-alt me-1"></i>Location</div><span class="small fw-semibold">${escHtml(r.location || "Not provided")}</span></div>
              ${r.asset_tag ? `<div class="mb-2"><div class="text-muted small mb-1">ICT Asset</div><span class="small fw-semibold"><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}</span></div>` : ""}
              ${r.attachment ? `<div class="mb-2"><div class="text-muted small mb-1">Attachment</div><a class="small" href="${escHtml(uploadUrl(r.attachment))}" target="_blank" rel="noopener"><i class="bi bi-paperclip me-1"></i>View attachment</a></div>` : ""}
              <div class="mb-2"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1">Last Updated</div><span class="small">${formatDateTime(r.updated_at)}</span></div>
              ${r.assignedTechnician ? `<div><div class="text-muted small mb-1">Technician</div><span class="small fw-semibold text-success"><i class="bi bi-wrench me-1"></i>${escHtml(r.assignedTechnician)}</span></div>` : ""}
              ${r.resolutionResponse ? `<div class="mt-2 pt-2 border-top"><div class="text-muted small mb-1">Latest Update</div><span class="small">${escHtml(r.resolutionResponse)}</span></div>` : ""}
            </div>
          </div>
        </div>
        ${adminFeedbackHtml}`;
    }

    const tl = document.getElementById("statusTimeline");
    if (tl) {
      const steps = [
        "submitted",
        "under_review",
        "assigned",
        "accepted",
        "in_progress",
        "resolved",
        "closed",
      ];
      const labels = [
        "Submitted",
        "Under Review",
        "Assigned",
        "Accepted",
        "In Progress",
        "Resolved",
        "Closed",
      ];
      const current = steps.indexOf(r.status);
      tl.innerHTML = steps
        .map((s, i) => {
          const done = i < current;
          const cur = i === current;
          const bg = done
            ? "bg-success text-white"
            : cur
              ? "bg-primary text-white"
              : "bg-light text-muted border";
          return `
          <div class="d-flex flex-column align-items-center">
            <div class="rounded-circle d-flex align-items-center justify-content-center ${bg}"
                 style="width:32px;height:32px;font-size:.65rem;font-weight:700;">
              ${done ? '<i class="bi bi-check-lg"></i>' : i + 1}
            </div>
            <div style="font-size:.65rem;" class="mt-1 text-center ${cur ? "fw-bold text-primary" : done ? "text-success" : "text-muted"}">${labels[i]}</div>
          </div>
          ${i < steps.length - 1 ? `<div class="flex-grow-1 mt-3" style="height:2px;background:${done ? "#198754" : "#dee2e6"};margin:0 4px;"></div>` : ""}`;
        })
        .join("");
    }
  } catch (err) {
    if (body)
      body.innerHTML = `<div class="alert alert-danger">${escHtml(ticketErrorMessage(err))}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   USER HISTORY
   ════════════════════════════════════════════════════════════ */
async function initUserHistory() {
  if (!requireRole("Requester")) return;
  try {
    /* The full request history comes straight from MongoDB (GET /api/tickets/my).
       Every request the user has ever submitted appears here — newly submitted
       ones included — using the same record, ID and created date as everywhere
       else in the system. */
    const { data } = await apiRequest("/tickets/my");
    renderHistoryTable(data);

    document.getElementById("filterBtn")?.addEventListener("click", () => {
      const from = document.getElementById("dateFrom")?.value;
      const to = document.getElementById("dateTo")?.value;
      const filtered = data.filter((r) => {
        const d = new Date(r.created_at);
        return (
          (!from || d >= new Date(from)) &&
          (!to || d <= new Date(to + "T23:59:59"))
        );
      });
      renderHistoryTable(filtered);
    });

    document
      .getElementById("exportBtn")
      ?.addEventListener("click", () => window.print());
  } catch (err) {
    console.error("Load history failed:", err);
    showToast(err.message, "danger");
    const tbody = document.getElementById("historyTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load history: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initUserHistory()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
  }
}

function renderHistoryTable(requests) {
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;
  if (!requests.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="text-center py-5">
      <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i><p class="text-muted">No history yet.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = requests
    .map(
      (r) => `
    <tr>
      <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
      <td>${escHtml(r.requester_name || "—")}</td>
      <td class="text-truncate" style="max-width:160px;">${escHtml(r.problemDescription)}</td>
      <td>${escHtml(r.equipmentType || "—")}${r.category ? `<div class="small text-muted">${escHtml(r.category)}</div>` : ""}</td>
      <td>${escHtml(r.issueType || r.serviceType || "—")}</td>
      <td>${escHtml(r.assignedTechnician || "—")}</td>
      <td>${formatDate(r.updated_at)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary py-0 px-2"
                onclick="openDetailModal('${r.id}')"
                data-bs-toggle="modal" data-bs-target="#requestDetailModal">
          <i class="bi bi-eye"></i>
        </button>
      </td>
    </tr>`,
    )
    .join("");
}

/* ═══════════════════════════════════════════════════════════
   ADMIN REQUESTS PAGE
   ═══════════════════════════════════════════════════════════ */
async function initAdminTechnicianFeedbackPage() {
  if (!requireRole("ICT Admin")) return;
  initTechnicianFeedbackReview();
  initAdminTechnicianFeedbackFilters();
  await loadAdminTechnicianFeedback();
}

let _adminTechnicianFeedbackRecords = [];

function initAdminTechnicianFeedbackFilters() {
  const search = document.getElementById("adminTechnicianFeedbackSearch");
  const status = document.getElementById(
    "adminTechnicianFeedbackStatusFilter",
  );
  const category = document.getElementById(
    "adminTechnicianFeedbackCategoryFilter",
  );
  if (search && search.dataset.filterBound !== "true") {
    search.dataset.filterBound = "true";
    search.addEventListener("input", renderAdminTechnicianFeedbackRows);
  }
  [status, category].filter(Boolean).forEach((filter) => {
    if (filter.dataset.filterBound === "true") return;
    filter.dataset.filterBound = "true";
    filter.addEventListener("change", loadAdminTechnicianFeedback);
  });
}

function initTechnicianFeedbackReview() {
  const tbody = document.getElementById("adminTechnicianFeedbackBody");
  if (!tbody || tbody.dataset.reviewBound === "true") return;
  tbody.dataset.reviewBound = "true";

  tbody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-technician-feedback]");
    if (!button || button.disabled) return;
    const row = button.closest("tr");
    const feedbackId = button.dataset.saveTechnicianFeedback;
    const responseInput = row?.querySelector("[data-admin-feedback-response]");
    const statusSelect = row?.querySelector("[data-admin-feedback-status]");
    const reviewComments = responseInput?.value.trim() || "";
    if (reviewComments.length > 2000) {
      showToast("Review comments must be no more than 2,000 characters.", "warning");
      return;
    }

    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
      '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Saving...';
    try {
      const result = await apiRequest(
        `/feedback/technician/${encodeURIComponent(feedbackId)}`,
        {
          method: "PATCH",
          body: {
            status: statusSelect?.value || "Submitted",
            reviewComments,
          },
        },
      );
      if (result?.success !== true || !(result.data?._id || result.data?.id)) {
        throw new Error(result?.message || "The feedback update was not confirmed.");
      }
      showToast("Technician feedback updated successfully.", "success");
      await loadAdminTechnicianFeedback();
    } catch (err) {
      button.disabled = false;
      button.innerHTML = originalText;
      showToast(
        `Unable to update technician feedback: ${err.message || "Please try again."}`,
        "danger",
      );
    }
  });
}

async function loadAdminTechnicianFeedback() {
  const tbody = document.getElementById("adminTechnicianFeedbackBody");
  const summary = document.getElementById(
    "adminTechnicianFeedbackSummary",
  );
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="9" class="text-center text-muted py-4">Loading technician feedback...</td></tr>';

  try {
    const params = new URLSearchParams();
    const status = document.getElementById(
      "adminTechnicianFeedbackStatusFilter",
    )?.value;
    const category = document.getElementById(
      "adminTechnicianFeedbackCategoryFilter",
    )?.value;
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    const query = params.toString();
    const result = await apiRequest(
      `/feedback/technician${query ? `?${query}` : ""}`,
    );
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load technician feedback.");
    }
    if (summary) {
      summary.textContent = `${result.data.length} technician feedback item${result.data.length === 1 ? "" : "s"} match the selected category and status.`;
    }
    _adminTechnicianFeedbackRecords = result.data;
    renderAdminTechnicianFeedbackRows();
  } catch (err) {
    if (summary) {
      summary.textContent = `Unable to load technician feedback summary: ${err.message || "Please try again."}`;
    }
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">
      Unable to load technician feedback: ${escHtml(err.message || "Please try again.")}
      <div class="mt-2"><button type="button" class="btn btn-sm btn-outline-primary" onclick="loadAdminTechnicianFeedback()">Retry</button></div>
    </td></tr>`;
  }
}

function renderAdminTechnicianFeedbackRows() {
  const tbody = document.getElementById("adminTechnicianFeedbackBody");
  if (!tbody) return;
  const query = (
    document.getElementById("adminTechnicianFeedbackSearch")?.value || ""
  )
    .trim()
    .toLowerCase();
  const statusFilter =
    document.getElementById("adminTechnicianFeedbackStatusFilter")?.value || "";
  const categoryFilter =
    document.getElementById("adminTechnicianFeedbackCategoryFilter")?.value || "";
  const filtered = _adminTechnicianFeedbackRecords.filter((item) => {
    if (statusFilter && (item.status || "Submitted") !== statusFilter) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (!query) return true;
    const searchable = [
      item.technician?.fullName,
      item.technician?.email,
      item.categoryGroup,
      item.category,
      item.description || item.message,
      item.recommendation,
      item.ticket?.ticketId,
      item.ticket?.title,
      item.asset?.asset_tag,
      item.asset?.asset_name,
      item.reviewComments || item.adminResponse,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(query);
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">${
      _adminTechnicianFeedbackRecords.length
        ? "No technician feedback matches these filters."
        : "No technician feedback has been submitted yet."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const technician = item.technician || {};
      const feedbackId = String(item._id || item.id || "");
      const status = item.status || "Submitted";
      const asset = item.asset || {};
      const related = [
        item.ticket
          ? `${escHtml(item.ticket.ticketId || "Maintenance request")}<div class="small text-muted">${escHtml(item.ticket.title || "")}</div>`
          : "",
        asset.asset_tag || asset.asset_name
          ? `<div class="small">${escHtml(asset.asset_tag || "")}${asset.asset_name ? ` — ${escHtml(asset.asset_name)}` : ""}</div>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      const submitted = item.submittedAt || item.createdAt
        ? new Date(item.submittedAt || item.createdAt).toLocaleString()
        : "—";
      return `<tr>
        <td>${escHtml(technician.fullName || item.technicianName || "Unknown technician")}<div class="small text-muted">${escHtml(technician.email || "")}</div><div class="small text-muted">Feedback ID: ${escHtml(feedbackId)}</div></td>
        <td>${escHtml(item.category || "—")}</td>
        <td>${related || "—"}</td>
        <td class="text-break" style="min-width:220px;white-space:pre-wrap">${escHtml(item.description || item.message || "")}</td>
        <td class="text-break" style="min-width:180px;white-space:pre-wrap">${escHtml(item.recommendation || "—")}</td>
        <td>${item.followUpRequired === true ? "Yes" : item.followUpRequired === false ? "No" : "—"}</td>
        <td class="text-nowrap">${escHtml(submitted)}</td>
        <td>
          <label class="visually-hidden" for="technician-feedback-status-${escHtml(feedbackId)}">Status for ${escHtml(technician.fullName || "technician")} feedback</label>
          <select id="technician-feedback-status-${escHtml(feedbackId)}" class="form-select form-select-sm" data-admin-feedback-status>
            ${["Submitted", "Under Review", "Action Required", "Resolved"]
              .map((option) => `<option${status === option ? " selected" : ""}>${option}</option>`)
              .join("")}
          </select>
        </td>
        <td style="min-width:240px">
          <label class="visually-hidden" for="technician-feedback-review-${escHtml(feedbackId)}">Review comments for ${escHtml(technician.fullName || "technician")} feedback</label>
          <textarea id="technician-feedback-review-${escHtml(feedbackId)}" class="form-control form-control-sm mb-2" rows="3" maxlength="2000" placeholder="Add review comments" data-admin-feedback-response>${escHtml(item.reviewComments || item.adminResponse || "")}</textarea>
          <button type="button" class="btn btn-sm btn-primary" data-save-technician-feedback="${escHtml(feedbackId)}">
            <i class="bi bi-send me-1" aria-hidden="true"></i>Save review
          </button>
        </td>
      </tr>`;
    })
    .join("");
}

/* Cached admin requests used by the search / status / priority filters. */
let _allAdminRequests = [];
let _filteredAdminRequests = [];
let _adminRequestsPage = 1;
const ADMIN_REQUESTS_PAGE_SIZE = 50;

async function loadAdminRequests() {
  const tbody = document.getElementById("requestsTableBody");
  if (tbody)
    tbody.innerHTML = `<tr><td colspan="14" class="text-center text-muted py-4">Loading requests...</td></tr>`;

  try {
    const { data } = await apiRequest("/tickets");
    _allAdminRequests = data || [];
    renderAdminTable(_allAdminRequests);
  } catch (err) {
    console.error("Load admin requests failed:", err);
    showToast(err.message, "danger");
    /* Never leave the loader hanging: show the real error + a Retry action. */
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="14" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load requests: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="loadAdminRequests()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
  }
}

async function initAdminRequests() {
  if (!requireRole("ICT Admin")) return;
  initAdminFeedbackModal();
  await Promise.all([
    populateAdminRequestCategoryFilter(),
    loadAdminRequests(),
  ]);
  populateDepartmentFilter();

  const doFilter = () => {
    const q = normalizeSearchTerm(
      document.getElementById("searchInput")?.value,
    );
    const st = document.getElementById("statusFilter")?.value || "";
    const pr = document.getElementById("priorityFilter")?.value || "";
    const cat = document.getElementById("categoryFilter")?.value || "";
    const dept = document.getElementById("departmentFilter")?.value || "";
    const dtFrom = document.getElementById("dateFromFilter")?.value || "";
    const dtTo = document.getElementById("dateToFilter")?.value || "";
    const fromDate = dtFrom ? new Date(dtFrom) : null;
    const toDate = dtTo ? new Date(dtTo + "T23:59:59") : null;
    renderAdminTable(
      _allAdminRequests.filter((r) => {
        /* Network Maintenance records are filtered by their own category value,
         so a technician-equipment match is never mistaken for category. */
        const created = new Date(r.created_at);
        const okDate =
          (!fromDate || created >= fromDate) && (!toDate || created <= toDate);
        return (
          (!q ||
            (r.problemDescription || "").toLowerCase().includes(q) ||
            (r.category || "").toLowerCase().includes(q) ||
            (r.requester_name || "").toLowerCase().includes(q) ||
            (r.title || "").toLowerCase().includes(q) ||
            (r.ticketId || "").toLowerCase().includes(q)) &&
          (!st || r.status === st) &&
          (!pr || r.priority === pr) &&
          (!cat ||
            resolveCategoryLabel(r.category || "").toLowerCase() ===
              resolveCategoryLabel(cat).toLowerCase()) &&
          (!dept || r.department === dept) &&
          okDate
        );
      }),
    );
  };

  document.getElementById("searchBtn")?.addEventListener("click", doFilter);
  document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFilter();
  });
  document.getElementById("statusFilter")?.addEventListener("change", doFilter);
  document
    .getElementById("priorityFilter")
    ?.addEventListener("change", doFilter);
  document
    .getElementById("categoryFilter")
    ?.addEventListener("change", doFilter);
  document
    .getElementById("departmentFilter")
    ?.addEventListener("change", doFilter);
  document
    .getElementById("dateFromFilter")
    ?.addEventListener("change", doFilter);
  document.getElementById("dateToFilter")?.addEventListener("change", doFilter);

  const previousPage = document.getElementById("adminRequestsPreviousPage");
  const nextPage = document.getElementById("adminRequestsNextPage");
  previousPage?.addEventListener("click", () => {
    if (_adminRequestsPage <= 1) return;
    _adminRequestsPage--;
    renderAdminTable(_filteredAdminRequests, false);
  });
  nextPage?.addEventListener("click", () => {
    const pageCount = Math.ceil(
      _filteredAdminRequests.length / ADMIN_REQUESTS_PAGE_SIZE,
    );
    if (_adminRequestsPage >= pageCount) return;
    _adminRequestsPage++;
    renderAdminTable(_filteredAdminRequests, false);
  });

  /* Event delegation for the dynamically rendered Actions buttons.
     Binds once on the tbody so it survives every table re-render. */
  const tbody = document.getElementById("requestsTableBody");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      const viewBtn = e.target.closest(".btn-view-ticket");
      if (viewBtn) {
        const id = viewBtn.getAttribute("data-id");
        if (!id) {
          console.error("Open ticket: missing ticket id.");
          showToast("Could not identify the request.", "danger");
          return;
        }
        openAdminRequestModal(id);
      }
    });
  }

  /* Deep link support: admin/requests.html?id=<ticketId> (used by the
     notification bell/page so the related ticket opens automatically). */
  const deepLinkId = new URLSearchParams(window.location.search).get("id");
  if (deepLinkId && /^[0-9a-f]{24}$/i.test(deepLinkId))
    openAdminRequestModal(deepLinkId);
}

async function populateAdminRequestCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  if (!select) return;

  try {
    const [maintenanceResponse, categoryResponse] = await Promise.all([
      apiRequest("/categories/maintenance"),
      apiRequest("/categories"),
    ]);
    if (
      maintenanceResponse?.success !== true ||
      !isValidRequestCategoryGroups(maintenanceResponse.data) ||
      categoryResponse?.success !== true ||
      !Array.isArray(categoryResponse.data)
    ) {
      throw new Error("The category list returned an invalid response.");
    }

    select.replaceChildren(new Option("All Categories", ""));
    const knownNames = new Set();
    maintenanceResponse.data.forEach((group) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.group;
      group.categories.forEach((category) => {
        const normalizedName = category.label.trim().toLowerCase();
        if (knownNames.has(normalizedName)) return;
        knownNames.add(normalizedName);
        optgroup.appendChild(new Option(category.label, category.value));
      });
      if (optgroup.children.length) select.appendChild(optgroup);
    });

    const legacy = categoryResponse.data.filter((category) => {
      const name = String(category.name || "").trim();
      const key = name.toLowerCase();
      if (!name || knownNames.has(key)) return false;
      knownNames.add(key);
      return true;
    });
    if (legacy.length) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = "Legacy / inactive categories";
      legacy.forEach((category) =>
        optgroup.appendChild(new Option(category.name, category.name)),
      );
      select.appendChild(optgroup);
    }
  } catch (err) {
    showToast(err.message || "Unable to load request categories.", "danger");
  }
}

/* Fill the Department filter with the departments found in the loaded requests. */
function populateDepartmentFilter() {
  const sel = document.getElementById("departmentFilter");
  if (!sel) return;
  const departments = new Set();
  _allAdminRequests.forEach((r) => {
    const d = (r.department || "").trim();
    if (d) departments.add(d);
  });
  const depts = Array.from(departments).sort((a, b) => a.localeCompare(b));
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">All Departments</option>` +
    depts
      .map((d) => `<option value="${escHtml(d)}">${escHtml(d)}</option>`)
      .join("");
  sel.value = cur;
}

function renderAdminTable(requests, resetPage = true) {
  const tbody = document.getElementById("requestsTableBody");
  if (!tbody) return;
  _filteredAdminRequests = Array.isArray(requests) ? requests : [];
  if (resetPage) _adminRequestsPage = 1;
  const pagination = document.getElementById("adminRequestsPagination");
  const pageInfo = document.getElementById("adminRequestsPageInfo");
  const previousPage = document.getElementById("adminRequestsPreviousPage");
  const nextPage = document.getElementById("adminRequestsNextPage");

  if (!_filteredAdminRequests.length) {
    tbody.innerHTML = `<tr><td colspan="14"><div class="text-center py-5">
      <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i><p class="text-muted">No requests found.</p>
    </div></td></tr>`;
    if (pagination) {
      pagination.classList.add("d-none");
      pagination.classList.remove("d-flex");
    }
    return;
  }

  const pageCount = Math.ceil(
    _filteredAdminRequests.length / ADMIN_REQUESTS_PAGE_SIZE,
  );
  _adminRequestsPage = Math.min(_adminRequestsPage, pageCount);
  const start = (_adminRequestsPage - 1) * ADMIN_REQUESTS_PAGE_SIZE;
  const page = _filteredAdminRequests.slice(
    start,
    start + ADMIN_REQUESTS_PAGE_SIZE,
  );
  if (pagination) {
    pagination.classList.toggle("d-none", pageCount <= 1);
    pagination.classList.toggle("d-flex", pageCount > 1);
  }
  if (pageInfo) {
    pageInfo.textContent = `Showing ${start + 1}-${Math.min(
      start + page.length,
      _filteredAdminRequests.length,
    )} of ${_filteredAdminRequests.length} requests`;
  }
  if (previousPage) previousPage.disabled = _adminRequestsPage <= 1;
  if (nextPage) nextPage.disabled = _adminRequestsPage >= pageCount;

  tbody.innerHTML = page
    .map(
      (r) => `
    <tr>
      <td class="c-id"><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
      <td class="c-title" title="${escHtml(r.problemDescription || "")}">${escHtml(r.problemDescription || "—")}</td>
      <td class="c-requester" title="${escHtml(r.requester_name || "")}">${escHtml(r.requester_name || "—")}</td>
      <td class="c-department" title="${escHtml(r.department || "")}"><span class="badge bg-light text-dark border department-text">${escHtml(r.department || "—")}</span></td>
      <td class="c-location" title="${escHtml(r.location || "")}"><span class="small location-text"><i class="bi bi-geo-alt me-1 text-muted"></i>${escHtml(r.location || "—")}</span></td>
      <td class="c-equipment" title="${escHtml(r.equipmentType || "")}"><span class="small fw-semibold equipment-text">${escHtml(r.equipmentType || "—")}</span></td>
      <td class="c-category" title="${escHtml(r.category || "")}"><span class="badge bg-light text-dark border category-text">${escHtml(r.category || "—")}</span></td>
      <td class="c-issue-type" title="${escHtml(r.issueType || r.serviceType || "")}"><span class="small issue-type-text">${escHtml(r.issueType || r.serviceType || "—")}</span></td>
      <td class="c-priority">${priorityBadge(r.priority)}</td>
      <td class="c-technician" title="${escHtml(r.technician_name || "")}">${escHtml(r.technician_name || "—")}</td>
      <td class="c-assignment-status">${r.assignment_status ? statusBadge(r.assignment_status) : '<span class="text-muted">—</span>'}</td>
      <td class="c-status">${statusBadge(r.status)}</td>
      <td class="c-date"><small class="text-muted">${formatDate(r.created_at)}</small></td>
      <td class="c-actions">
        <button class="btn btn-sm btn-primary py-0 px-2 btn-view-ticket"
                data-id="${escHtml(r._id || r.id)}" title="View / Assign technician"
                data-bs-toggle="modal" data-bs-target="#requestDetailModal">
          <i class="bi bi-eye"></i>
        </button>
      </td>
    </tr>`,
    )
    .join("");
}

async function openAdminRequestModal(id) {
  document.getElementById("modalRequestId").value = id;
  const modal = document.getElementById("requestDetailModal");
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  const section = document.getElementById("requestInfoSection");
  if (section)
    section.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status" aria-label="Loading request details"></div><div class="small text-muted mt-2">Loading request details...</div></div>`;

  try {
    /* Fetch the ticket, the technician list and the assignments in parallel.
       The ticket is required (failure aborts the modal, as before); the other
       two degrade gracefully if they fail. */
    const [ticketRes, techsRes, assignmentsRes] = await Promise.allSettled([
      apiRequest(`/tickets/${id}`),
      apiRequest("/technicians"),
      apiRequest("/assignments"),
    ]);
    const r = ticketRes.status === "fulfilled" ? ticketRes.value.data : null;
    if (!r) throw ticketRes.reason;

    if (section) {
      const reportHtml = r.technician_feedback
        ? renderAdminReport(r.technician_feedback)
        : "";
      const adminFeedHtml = r.admin_feedback
        ? renderAdminFeedbackCard(r.admin_feedback)
        : "";
      section.innerHTML = `
        <h6 class="fw-bold mb-3">${escHtml(r.ticketId || r.id)}</h6>
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="text-muted small mb-1">Status</div>${statusBadge(r.status)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Priority</div>${priorityBadge(r.priority)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Requester</div><span class="small">${escHtml(r.requester_name || "—")}</span></div>
          ${r.requester_email ? `<div class="col-6"><div class="text-muted small mb-1">Requester Email</div><span class="small text-break">${escHtml(r.requester_email)}</span></div>` : ""}
          <div class="col-6"><div class="text-muted small mb-1">Technician</div><span class="small">${escHtml(r.technician_name || "—")}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Request Title</div><span class="small fw-semibold">${escHtml(r.title || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Phone</div><span class="small">${escHtml(r.phone || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Equipment</div><span class="small">${escHtml(r.equipmentType || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Category</div><span class="small">${escHtml(r.category || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Issue Type / Service Type</div><span class="small">${escHtml(r.issueType || r.serviceType || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">ICT Asset</div><span class="small">${r.asset_tag ? escHtml(r.asset_tag) + (r.asset_name ? ` — ${escHtml(r.asset_name)}` : "") : "—"}</span></div>
          ${r.serialNumber ? `<div class="col-6"><div class="text-muted small mb-1">Serial Number</div><span class="small">${escHtml(r.serialNumber)}</span></div>` : ""}
          <div class="col-6"><div class="text-muted small mb-1">Department</div><span class="small">${escHtml(r.department || "—")}</span></div>
          <div class="col-6"><div class="text-muted small mb-1"><i class="bi bi-geo-alt me-1"></i>Location</div><span class="small fw-semibold">${escHtml(r.location || "Not provided")}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Last Updated</div><span class="small">${r.updated_at ? formatDateTime(r.updated_at) : "—"}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Description</div>
            <div class="p-2 bg-light rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
          ${r.attachment ? `<div class="col-12"><div class="text-muted small mb-1">Attachment</div><a class="small" href="${escHtml(uploadUrl(r.attachment))}" target="_blank" rel="noopener"><i class="bi bi-paperclip me-1"></i>View attachment</a></div>` : ""}
          ${r.identifiedProblem ? `<div class="col-12"><div class="text-muted small mb-1">Identified Problem</div><div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${escHtml(r.identifiedProblem)}</div></div>` : ""}
          ${r.resolutionResponse ? `<div class="col-12"><div class="text-muted small mb-1">Resolution</div><div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${escHtml(r.resolutionResponse)}</div></div>` : ""}
          ${r.reasonIfNotFixed ? `<div class="col-12"><div class="text-muted small mb-1">Reason Not Fixed</div><div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${escHtml(r.reasonIfNotFixed)}</div></div>` : ""}
          ${
            isNetworkRequestCategory(r.category)
              ? `
          <div class="col-12"><div class="text-muted small mb-1">Network Maintenance Details</div>
            <div class="p-2 bg-light rounded small">
              <div class="row g-2">
                <div class="col-md-6"><i class="bi bi-router me-1 text-primary"></i>Service Type: <span class="fw-semibold">${escHtml(r.serviceType || "—")}</span></div>
                <div class="col-md-6"><i class="bi bi-hdd-network me-1 text-primary"></i>Network Device: <span class="fw-semibold">${escHtml(r.networkDevice || "—")}</span></div>
                <div class="col-md-6"><i class="bi bi-ip me-1 text-primary"></i>IP Address: <span class="fw-semibold">${escHtml(r.ipAddress || "—")}</span></div>
                <div class="col-md-6"><i class="bi bi-hexagon me-1 text-primary"></i>MAC Address: <span class="fw-semibold">${escHtml(r.macAddress || "—")}</span></div>
                <div class="col-md-6"><i class="bi bi-people me-1 text-primary"></i>Affected Users: <span class="fw-semibold">${escHtml(r.affectedUsers || "—")}</span></div>
              </div>
            </div>
          </div>`
              : ""
          }
        </div>
        ${reportHtml}${adminFeedHtml}`;
    }

    const sel = document.getElementById("assignTechSelect");
    if (sel) {
      if (techsRes.status === "fulfilled") {
        const techs = techsRes.value.data || [];
        const activeTechs = techs.filter((t) => t.status === "active");
        sel.innerHTML =
          `<option value="">-- Select Technician --</option>` +
          activeTechs
            .map(
              (t) =>
                `<option value="${escHtml(t._id || t.id)}">${escHtml(t.fullName)} — ${escHtml(t.specialization || "General")} ${t.available ? "✓" : ""}</option>`,
            )
            .join("");
      } else {
        sel.innerHTML = `<option value="">-- Select Technician --</option>`;
      }
    }

    /* Load the current assignment for this ticket (if any) */
    let activeAssignment = null;
    let completedAssignment = null;
    if (assignmentsRes.status === "fulfilled") {
      const assignments = assignmentsRes.value.data || [];
      const ticketAssignments = assignments.filter(
        (a) => String(a.ticket_id) === String(id),
      );
      activeAssignment =
        ticketAssignments.find((a) =>
          ["assigned", "accepted", "in_progress"].includes(a.status),
        ) || null;
      completedAssignment =
        ticketAssignments.find((a) => a.status === "completed") || null;
    }
    const displayedAssignment = activeAssignment || completedAssignment;

    const currentBox = document.getElementById("currentAssignment");
    if (currentBox) {
      if (displayedAssignment) {
        const handledLabel = activeAssignment
          ? "Currently assigned:"
          : "Handled by:";
        currentBox.innerHTML = `
          <div class="alert alert-info py-2 small mb-0">
            <i class="bi bi-person-check-fill me-1"></i>
            <strong>${handledLabel}</strong> ${escHtml(displayedAssignment.technician_name || "Unknown technician")}
            ${displayedAssignment.technician_email ? `<span class="text-muted">(${escHtml(displayedAssignment.technician_email)})</span>` : ""}
            ${displayedAssignment.status ? `<div class="mt-1">Assignment status: ${escHtml(displayedAssignment.status)}</div>` : ""}
            ${displayedAssignment.assigned_at ? `<div class="text-muted mt-1">Assigned ${formatDateTime(displayedAssignment.assigned_at)}</div>` : ""}
            ${displayedAssignment.notes ? `<div class="mt-1">Assignment notes: ${escHtml(displayedAssignment.notes)}</div>` : ""}
          </div>`;
      } else {
        currentBox.innerHTML = `<div class="text-muted small mb-0">No technician assigned yet.</div>`;
      }
    }

    const removeBtn = document.getElementById("removeAssignmentBtn");
    if (removeBtn) {
      if (activeAssignment) {
        removeBtn.classList.remove("d-none");
        removeBtn.onclick = async () => {
          if (
            !confirm(
              `Are you sure you want to remove the technician from "${r.ticketId || r.id}"?`,
            )
          )
            return;
          setLoading("removeAssignmentBtn", "removeAssignmentSpinner", true);
          try {
            await apiRequest(`/assignments/${activeAssignment._id}`, {
              method: "DELETE",
            });
            showToast("Assignment removed successfully.", "success");
            await openAdminRequestModal(id);
          } catch (err) {
            console.error("Remove assignment failed:", err);
            showAlert("assignAlert", err.message, "danger");
          } finally {
            setLoading("removeAssignmentBtn", "removeAssignmentSpinner", false);
          }
        };
      } else {
        removeBtn.classList.add("d-none");
      }
    }

    const assignBtn = document.getElementById("doAssignBtn");
    if (assignBtn) {
      const label = activeAssignment
        ? "Reassign Technician"
        : "Assign Technician";
      assignBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2 d-none" id="doAssignSpinner"></span>${label}`;
      assignBtn.onclick = async () => {
        const techId = document.getElementById("assignTechSelect")?.value;
        const priority =
          document.getElementById("assignPrioritySelect")?.value || "medium";
        const notes = document.getElementById("assignNotes")?.value || "";
        if (!techId) {
          showAlert("assignAlert", "Please select a technician.", "warning");
          return;
        }
        const spin = document.getElementById("doAssignSpinner");
        if (spin) spin.classList.remove("d-none");
        assignBtn.disabled = true;
        try {
          await apiRequest("/assignments", {
            method: "POST",
            body: { ticket_id: id, technician_id: techId, notes, priority },
          });
          showToast(
            activeAssignment
              ? "Technician reassigned successfully."
              : "Technician assigned successfully.",
            "success",
          );
          await openAdminRequestModal(id);
        } catch (err) {
          console.error("Assign technician failed:", err);
          showAlert("assignAlert", err.message, "danger");
        } finally {
          if (spin) spin.classList.add("d-none");
          assignBtn.disabled = false;
        }
      };
    }

    const updateBtn = document.getElementById("updateStatusBtn");
    if (updateBtn) {
      updateBtn.onclick = async () => {
        const status = document.getElementById("newStatusSelect")?.value;
        try {
          await apiRequest(`/tickets/${id}/status`, {
            method: "PATCH",
            body: { status },
          });
          showToast(`Status updated to "${status}"`, "success");
          await openAdminRequestModal(id);
        } catch (err) {
          showAlert("assignAlert", err.message, "danger");
        }
      };
    }

    const prioritySelect = document.getElementById("newPrioritySelect");
    if (prioritySelect) {
      prioritySelect.value = r.priority || "medium";
    }
    /* Set priority in assignment panel dropdown */
    const assignPrioritySelect = document.getElementById(
      "assignPrioritySelect",
    );
    if (assignPrioritySelect) {
      assignPrioritySelect.value = r.priority || "medium";
    }
    const priorityBtn = document.getElementById("updatePriorityBtn");
    if (priorityBtn) {
      priorityBtn.onclick = async () => {
        const priority = document.getElementById("newPrioritySelect")?.value;
        if (!priority) {
          showAlert("priorityAlert", "Please select a priority.", "warning");
          return;
        }
        try {
          await apiRequest(`/tickets/${id}`, {
            method: "PUT",
            body: { priority },
          });
          showToast(`Priority updated to "${priority}"`, "success");
          await openAdminRequestModal(id);
        } catch (err) {
          showAlert("priorityAlert", err.message, "danger");
        }
      };
    }
  } catch (err) {
    if (section)
      section.innerHTML = `<div class="alert alert-danger">${escHtml(ticketErrorMessage(err))}</div>`;
  }
}

/* ── Render the technician maintenance report for admins ───── */
function renderAdminReport(report) {
  const statusBadgeHtml =
    report.status === "Fixed"
      ? '<span class="badge bg-success">Fixed</span>'
      : report.status === "Not Fixed"
        ? '<span class="badge bg-danger">Not Fixed</span>'
        : '<span class="badge bg-warning text-dark">In Progress</span>';

  const row = (label, value) => `
    <div class="mb-3">
      <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
      <div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${value ? escHtml(value) : '<span class="text-muted">—</span>'}</div>
    </div>`;

  return `
    <div class="border-top pt-3">
      <h6 class="fw-bold mb-2">
        <i class="bi bi-clipboard2-check text-primary me-1"></i>Technician Maintenance Report
      </h6>
      <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
        ${statusBadgeHtml}
        ${report.technician_name ? `<span class="small text-muted"><i class="bi bi-wrench me-1"></i>${escHtml(report.technician_name)}</span>` : ""}
        ${report.submittedAt ? `<span class="small text-muted">· Submitted ${formatDateTime(report.submittedAt)}</span>` : ""}
        ${report.completionDate ? `<span class="small text-muted">· Completed ${formatDateTime(report.completionDate)}</span>` : ""}
      </div>
      ${row("Diagnosis / Identified Problem", report.diagnosis)}
      ${row("Work Performed", report.workPerformed)}
      ${row("Parts / Materials Used", report.partsUsed)}
      ${row("Resolution Summary", report.resolution)}
      ${report.status === "Not Fixed" ? row("Reason Not Fixed", report.reasonNotFixed) : ""}
      ${row("Recommendation", report.recommendation)}
      ${row("Technician Notes (internal)", report.technicianNotes)}
    </div>`;
}

/* ── Render the admin service feedback card for admins ──────── */
function renderAdminFeedbackCard(report) {
  const base = () => `
    <div class="text-muted small fw-bold text-uppercase mb-2">
      <i class="bi bi-clipboard2-check text-primary me-1"></i>Admin Service Feedback
    </div>`;

  const field = (label, value) =>
    value
      ? `
    <div class="mb-3">
      <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
      <div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${escHtml(value)}</div>
    </div>`
      : "";

  const defaultBadge = (v, cls) =>
    v ? `<span class="badge ${cls} me-1">${escHtml(v)}</span>` : "";

  const metaLine = `
    <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
      ${defaultBadge(report.serviceHandlingQuality, "bg-primary")}
      ${defaultBadge(report.overallServiceQuality, "bg-success")}
      ${defaultBadge(report.responseTime, "bg-warning text-dark")}
      ${defaultBadge(report.policyCompliance, "bg-light text-dark border")}
      ${report.admin_name ? `<span class="small text-muted"><i class="bi bi-person-badge me-1"></i>${escHtml(report.admin_name)}</span>` : ""}
      ${report.submittedAt ? `<span class="small text-muted">· Submitted ${formatDateTime(report.submittedAt)}</span>` : ""}
    </div>`;

  return `
    <div class="border-top pt-3 mt-3">
      ${base()}
      ${metaLine}
      ${report.reportReviewDecision ? field("Report Review Decision", report.reportReviewDecision) : ""}
      ${report.evaluationStatus ? field("Feedback Status", report.evaluationStatus) : ""}
      ${field("Work Quality", report.workQuality)}
      ${field("Technical Accuracy", report.technicalAccuracy)}
      ${field("Repair Effectiveness", report.repairEffectiveness)}
      ${field("Report Completeness", report.reportCompleteness)}
      ${field("Safety & Procedure Compliance", report.safetyProcedureCompliance)}
      ${field("Technician Performance", report.technicianPerformance)}
      ${field("Resolution Quality", report.resolutionQuality)}
      ${field("Documentation Quality", report.documentationQuality)}
      ${field("Administrative Recommendation", report.administrativeRecommendation)}
      ${field("Admin Comment", report.adminComment)}
      ${
        report.followUpRequired
          ? `
        <div class="mb-2">
          <span class="badge bg-danger"><i class="bi bi-arrow-repeat me-1"></i>Follow-up Required</span>
        </div>
        ${field("Follow-up Notes", report.followUpNotes)}
      `
          : ""
      }
    </div>`;
}

/* ── Open the Admin Service Feedback form (add or edit) ────── */
async function openAdminFeedbackForm(id) {
  const body = document.getElementById("adminFbRequestId");
  const info = document.getElementById("adminFbTaskInfo");
  if (body) body.value = id;
  const evaluationModal = document.getElementById("adminFeedbackModal");
  if (evaluationModal && window.bootstrap?.Modal) {
    window.bootstrap.Modal.getOrCreateInstance(evaluationModal).show();
  }

  /* Reset the form */
  [
    "afReportReviewDecision",
    "afWorkQuality",
    "afTechnicalAccuracy",
    "afRepairEffectiveness",
    "afReportCompleteness",
    "afSafetyCompliance",
    "afFeedbackStatus",
    "afAdminComment",
    "afFollowUpNotes",
    "afAdminRecommendation",
  ].forEach((el) => {
    const node = document.getElementById(el);
    if (node) node.value = "";
  });
  const fbReq = document.getElementById("afFollowUpRequired");
  if (fbReq) fbReq.value = "No";
  const statusSelect = document.getElementById("afFeedbackStatus");
  if (statusSelect) statusSelect.value = "Pending";
  const wrap = document.getElementById("afFollowUpWrap");
  if (wrap) wrap.classList.add("d-none");
  const alert = document.getElementById("adminFbAlert");
  if (alert) {
    alert.classList.add("d-none");
    alert.innerHTML = "";
  }

  const saveButton = document.getElementById("saveAdminFbBtn");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.dataset.reportAvailable = "loading";
  }
  const saveLabel = document.getElementById("saveAdminFbLabel");
  if (saveLabel) saveLabel.textContent = "Save Evaluation";
  const requestDisplay = document.getElementById("afMaintenanceRequest");
  if (requestDisplay) requestDisplay.value = "Loading request…";
  const reportDisplay = document.getElementById("afTechnicianReport");
  if (reportDisplay) reportDisplay.textContent = "Loading technician report…";
  const reviewerDisplay = document.getElementById("afReviewedBy");
  if (reviewerDisplay) reviewerDisplay.value = Auth.getUser()?.fullName || "Authenticated administrator";
  const dateDisplay = document.getElementById("afFeedbackDate");
  if (dateDisplay) dateDisplay.value = "Set by server on save";

  if (info) {
    info.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>`;
  }

  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);
    if (requestDisplay) requestDisplay.value = r.ticketId || r.id || id;
    const hasTechnicianReport = Boolean(r.technician_feedback);
    if (saveButton) {
      saveButton.dataset.reportAvailable = String(hasTechnicianReport || Boolean(r.admin_feedback));
      saveButton.disabled = !hasTechnicianReport && !r.admin_feedback;
    }
    if (info) {
      /* Build a read-only REVIEW panel so the admin can evaluate the full
         maintenance lifecycle without modifying the original records. */
      const metaLine = `<div class="small">
        <strong>${escHtml(r.ticketId || r.id)}</strong>
        ${r.requester_name ? ` — ${escHtml(r.requester_name)}` : ""}
        ${r.equipmentType ? `<span class="ms-2"><i class="bi bi-laptop me-1"></i>${escHtml(r.equipmentType)}</span>` : ""}
        ${r.asset_tag ? `<span class="ms-2"><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ""}</span>` : ""}
        ${r.assignedTechnician ? `<span class="ms-2"><i class="bi bi-wrench me-1"></i>${escHtml(r.assignedTechnician)}</span>` : ""}
        ${r.device ? `<span class="ms-2"><i class="bi bi-pc-display-horizontal me-1"></i>${escHtml(r.device)}</span>` : ""}
        ${r.category ? `<span class="ms-2"><i class="bi bi-tags me-1"></i>${escHtml(r.category)}</span>` : ""}
        <span class="ms-2">${statusBadge(r.status)}</span>
      </div>`;

      const technicianPanel = r.technician_feedback
        ? renderAdminReport(r.technician_feedback)
        : `<div class="small p-2 bg-light rounded text-muted">No technician maintenance report submitted yet.</div>`;

      info.innerHTML = `
        ${metaLine}
        <div class="border-top pt-2 mt-2">
          <div class="small fw-bold text-uppercase text-muted mb-1 mt-3">
            <i class="bi bi-clipboard2-check text-primary me-1"></i>Technician Maintenance Report (review only)
          </div>
          ${technicianPanel}
        </div>`;
    }
    if (reportDisplay) {
      reportDisplay.innerHTML = hasTechnicianReport
        ? renderAdminReport(r.technician_feedback)
        : `<span class="text-danger">No technician maintenance report is available. Submit an evaluation after the assigned technician has completed the report.</span>`;
    }

    if (r.admin_feedback) {
      /* Prefill for editing */
      document.getElementById("afReportReviewDecision").value =
        r.admin_feedback.reportReviewDecision || "";
      document.getElementById("afWorkQuality").value =
        r.admin_feedback.workQuality || r.admin_feedback.serviceHandlingQuality || "";
      document.getElementById("afTechnicalAccuracy").value =
        r.admin_feedback.technicalAccuracy || "";
      document.getElementById("afRepairEffectiveness").value =
        r.admin_feedback.repairEffectiveness || r.admin_feedback.resolutionQuality || "";
      document.getElementById("afReportCompleteness").value =
        r.admin_feedback.reportCompleteness || r.admin_feedback.documentationQuality || "";
      document.getElementById("afSafetyCompliance").value =
        r.admin_feedback.safetyProcedureCompliance || "";
      document.getElementById("afFeedbackStatus").value =
        r.admin_feedback.evaluationStatus || "Pending";
      document.getElementById("afAdminComment").value =
        r.admin_feedback.adminComment || "";
      document.getElementById("afFollowUpNotes").value =
        r.admin_feedback.followUpNotes || "";
      document.getElementById("afAdminRecommendation").value =
        r.admin_feedback.administrativeRecommendation || "";
      const fbReq2 = document.getElementById("afFollowUpRequired");
      if (fbReq2) {
        fbReq2.value = r.admin_feedback.followUpRequired ? "Yes" : "No";
        wrap?.classList.toggle("d-none", fbReq2.value !== "Yes");
      }
      if (saveLabel) saveLabel.textContent = "Update Evaluation";
      if (reviewerDisplay) reviewerDisplay.value = r.admin_feedback.admin_name || "Previously reviewed";
      if (dateDisplay) dateDisplay.value = r.admin_feedback.submittedAt ? formatDateTime(r.admin_feedback.submittedAt) : "Set by server on save";
    }
  } catch (err) {
    if (info)
      info.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${escHtml(err.message)}</div>`;
  }
}

/* ── Submit or update Admin Service Feedback ───────────────── */
async function submitAdminFeedback() {
  const id = document.getElementById("adminFbRequestId").value;
  if (!id) {
    showAlert("adminFbAlert", "Could not identify the request.", "warning");
    return;
  }

  const reportReviewDecision = document.getElementById("afReportReviewDecision").value;
  const workQuality = document.getElementById("afWorkQuality").value;
  const technicalAccuracy = document.getElementById("afTechnicalAccuracy").value;
  const repairEffectiveness = document.getElementById("afRepairEffectiveness").value;
  const reportCompleteness = document.getElementById("afReportCompleteness").value;
  const safetyProcedureCompliance = document.getElementById("afSafetyCompliance").value;
  const evaluationStatus = document.getElementById("afFeedbackStatus").value;
  const adminComment = document.getElementById("afAdminComment").value.trim();
  const followUpRequired = document.getElementById("afFollowUpRequired").value === "Yes";
  const followUpNotes = document.getElementById("afFollowUpNotes").value.trim();
  const administrativeRecommendation = document
    .getElementById("afAdminRecommendation")
    .value.trim();
  const saveButton = document.getElementById("saveAdminFbBtn");
  const failValidation = (message) => {
    showAlert("adminFbAlert", message, "warning");
    document.getElementById("adminFbAlert")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  if (saveButton?.dataset.reportAvailable !== "true" && saveButton?.dataset.reportAvailable !== "false") {
    failValidation("Wait for the maintenance request and technician report to finish loading.");
    return;
  }
  if (saveButton?.dataset.reportAvailable === "false") {
    failValidation("A technician report is required before this evaluation can be saved.");
    return;
  }
  if (!reportReviewDecision || !workQuality || !technicalAccuracy ||
      !repairEffectiveness || !reportCompleteness || !safetyProcedureCompliance ||
      !evaluationStatus || !adminComment) {
    failValidation("Complete the report decision, all evaluation ratings, feedback status, and required Admin Comments.");
    return;
  }
  if (reportReviewDecision === "Needs Correction" && !administrativeRecommendation && !followUpNotes) {
    failValidation("Provide a clear corrective action or recommendation for a report that needs correction.");
    return;
  }
  if (reportReviewDecision === "Rejected" && !adminComment) {
    failValidation("Explain why the technician report was rejected in Admin Comments.");
    return;
  }
  if (followUpRequired && !followUpNotes && !administrativeRecommendation) {
    failValidation("Provide a follow-up recommendation or required action.");
    return;
  }

  setLoading("saveAdminFbBtn", "saveAdminFbSpinner", true);
  const alert = document.getElementById("adminFbAlert");
  if (alert) {
    alert.classList.add("d-none");
  }

  try {
    const isEdit = document.getElementById("saveAdminFbLabel").textContent.includes("Update");
    const payload = {
      reportReviewDecision,
      workQuality,
      technicalAccuracy,
      repairEffectiveness,
      reportCompleteness,
      safetyProcedureCompliance,
      evaluationStatus,
      adminComment,
      followUpRequired,
      followUpNotes: followUpNotes || null,
      administrativeRecommendation: administrativeRecommendation || null,
    };
    const res = await apiRequest(`/tickets/${id}/admin-feedback`, {
      method: isEdit ? "PUT" : "POST",
      body: payload,
    });
    showToast(
      res.message ||
        (isEdit ? "Evaluation updated." : "Evaluation saved."),
      "success",
    );
    if (res.data?.admin_name) document.getElementById("afReviewedBy").value = res.data.admin_name;
    if (res.data?.submittedAt) document.getElementById("afFeedbackDate").value = formatDateTime(res.data.submittedAt);
    const modal = document.getElementById("adminFeedbackModal");
    if (modal && bootstrap.Modal.getInstance(modal))
      bootstrap.Modal.getInstance(modal).hide();
    /* refresh the detail modal so the new feedback card appears */
    openAdminRequestModal(id);
  } catch (err) {
    showAlert("adminFbAlert", err.message, "danger");
  } finally {
    setLoading("saveAdminFbBtn", "saveAdminFbSpinner", false);
  }
}

/* ── Delete (clear) Admin Service Feedback for a ticket ────── */
async function deleteAdminFeedback(id, title) {
  if (!id) {
    showToast("Could not identify the request.", "danger");
    return;
  }
  if (
    !confirm(
      `Delete the admin service feedback for "${title}"? This cannot be undone.`,
    )
  )
    return;

  try {
    const res = await apiRequest(
      `/tickets/${encodeURIComponent(id)}/admin-feedback`,
      { method: "DELETE" },
    );
    showToast(res.message || "Admin service feedback deleted.", "success");
    openAdminRequestModal(id);
  } catch (err) {
    showToast(err.message, "danger");
  }
}

/* ── Wire up the Admin Service Feedback modal ──────────────── */
function initAdminFeedbackModal() {
  document.getElementById("afFollowUpRequired")?.addEventListener("change", (event) => {
    const required = event.target.value === "Yes";
    document.getElementById("afFollowUpWrap")?.classList.toggle("d-none", !required);
    document.getElementById("afFollowUpNotes").required = required;
  });
  document.getElementById("afReportReviewDecision")?.addEventListener("change", (event) => {
    const showCorrectiveAction = event.target.value === "Needs Correction";
    document.getElementById("afAdminRecommendation")?.setAttribute(
      "aria-required",
      String(showCorrectiveAction),
    );
  });
  document.getElementById("createAdminFeedbackAction")?.addEventListener("click", () => {
    const requestId = document.getElementById("modalRequestId")?.value;
    if (!requestId) {
      showToast("Open a maintenance request before creating its evaluation.", "warning");
      return;
    }
    const requestModal = document.getElementById("requestDetailModal");
    const openEvaluation = () => void openAdminFeedbackForm(requestId);
    if (requestModal?.classList.contains("show")) {
      requestModal.addEventListener("hidden.bs.modal", openEvaluation, { once: true });
      bootstrap.Modal.getInstance(requestModal)?.hide();
    } else {
      openEvaluation();
    }
  });
  document
    .getElementById("saveAdminFbBtn")
    ?.addEventListener("click", submitAdminFeedback);

  /* Event delegation so dynamically rendered buttons work */
  document.addEventListener("click", (e) => {
    const delBtn = e.target.closest(".btn-admin-feedback-delete");
    if (delBtn) {
      const id = delBtn.getAttribute("data-id");
      const title = delBtn.getAttribute("data-title") || id;
      if (!id) {
        console.error("Admin feedback: missing ticket id.");
        showToast("Could not identify the request.", "danger");
        return;
      }
      deleteAdminFeedback(id, title);
      return;
    }

    const btn = e.target.closest(".btn-admin-feedback");
    if (btn) {
      const id = btn.getAttribute("data-id");
      if (!id) {
        console.error("Admin feedback: missing ticket id.");
        showToast("Could not identify the request.", "danger");
        return;
      }
      openAdminFeedbackForm(id);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   CATEGORIES (Admin)
   ═══════════════════════════════════════════════════════════ */
let _pendingDelete = null; /* { id, name, total } awaiting confirmation */

async function initCategories() {
  if (!requireRole("ICT Admin")) return;
  wireCategoryModalActions();
  await loadCategories();
}

/* Reset the Add/Edit modal to its clean state (used by the header
   "Add Category" button and the empty-state CTA). Bootstrap shows the
   modal via the buttons' data-bs-toggle/data-bs-target attributes. */
function openAddCategoryModal() {
  document.getElementById("categoryForm")?.reset();
  document.getElementById("categoryId").value = "";
  document.getElementById("categoryModalLabel").textContent = "Add Category";
  const alert = document.getElementById("categoryModalAlert");
  if (alert) {
    alert.className = "alert d-none";
    alert.innerHTML = "";
  }
}

/* One-time wiring of modals + event delegation for the dynamic action
   buttons. Binds once so it survives every table re-render. */
function wireCategoryModalActions() {
  document
    .getElementById("saveCategoryBtn")
    ?.addEventListener("click", saveCategory);
  document
    .getElementById("addCategoryBtn")
    ?.addEventListener("click", openAddCategoryModal);
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn-add-category")) openAddCategoryModal();
  });

  const deleteModal = document.getElementById("deleteCategoryModal");
  if (deleteModal) {
    deleteModal.addEventListener("hidden.bs.modal", () => {
      _pendingDelete = null;
    });
    document
      .getElementById("deleteCategoryConfirmBtn")
      ?.addEventListener("click", executeDeleteCategory);
  }

  const tbody = document.getElementById("categoriesTableBody");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      const viewBtn = e.target.closest(".btn-cat-view");
      const editBtn = e.target.closest(".btn-cat-edit");
      const deleteBtn = e.target.closest(".btn-cat-delete");

      if (viewBtn) {
        const id = viewBtn.getAttribute("data-id");
        if (!id) {
          console.error("View category: missing id.");
          showToast("Could not identify the category.", "danger");
          return;
        }
        viewCategory(
          id,
          Number(viewBtn.getAttribute("data-total")) || 0,
          viewBtn,
        );
      } else if (editBtn) {
        const id = editBtn.getAttribute("data-id");
        if (!id) {
          console.error("Edit category: missing id.");
          showToast("Could not identify the category to edit.", "danger");
          return;
        }
        editCategory(id, editBtn);
      } else if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-id");
        if (!id) {
          console.error("Delete category: missing id.");
          showToast("Could not identify the category to delete.", "danger");
          return;
        }
        confirmDeleteCategory(
          id,
          deleteBtn.getAttribute("data-name") || "this category",
          Number(deleteBtn.getAttribute("data-total")) || 0,
        );
      }
    });
  }
}

/* Disable all action buttons in a row and swap the clicked one for a
   spinner (or restore them when the operation settles). */
function setRowBusy(btn, isBusy) {
  const tr = btn?.closest("tr");
  const group = tr
    ? tr.querySelectorAll(".btn-cat-view, .btn-cat-edit, .btn-cat-delete")
    : [btn];
  group.forEach((b) => {
    if (!b) return;
    if (isBusy) {
      if (!b.dataset.idleHtml) b.dataset.idleHtml = b.innerHTML;
      b.disabled = true;
    } else {
      if (b.dataset.idleHtml) {
        b.innerHTML = b.dataset.idleHtml;
        delete b.dataset.idleHtml;
      }
      b.disabled = false;
    }
  });
}

/* ── Load + render (single source of truth: /reports/requests-by-category) ── */
async function loadCategories() {
  const tbody = document.getElementById("categoriesTableBody");
  const stats = document.getElementById("categoryStats");
  if (!tbody && !stats) return;

  renderCategorySkeleton(tbody, stats);

  try {
    const { data } = await apiRequest("/reports/requests-by-category");
    const rows = Array.isArray(data) ? data : [];
    renderCategoryRows(rows);
    renderCategoryStats(rows);
  } catch (err) {
    console.error(
      "[Categories] Failed to load category data:",
      err && err.message ? err.message : err,
    );
    showToast(err.message, "danger");
    renderCategoryInError(tbody, stats);
  }
}

function renderCategorySkeleton(tbody, stats) {
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 5 })
      .map(
        () => `
      <tr>
        <td><span class="skeleton-line" style="width:24px"></span></td>
        <td><span class="skeleton-line" style="width:55%"></span></td>
        <td><span class="skeleton-line" style="width:75%"></span></td>
        <td><span class="skeleton-line" style="width:32px"></span></td>
        <td><span class="skeleton-line" style="width:112px"></span></td>
      </tr>`,
      )
      .join("");
  }
  if (stats) {
    stats.innerHTML = Array.from({ length: 5 })
      .map(
        () => `
      <div class="d-flex align-items-center gap-2 py-2">
        <span class="skeleton-line rounded-circle" style="width:12px;height:12px;flex-shrink:0"></span>
        <span class="skeleton-line" style="width:60%;height:14px"></span>
        <span class="skeleton-line ms-auto" style="width:28px;height:14px"></span>
      </div>`,
      )
      .join("");
  }
}

function categoryActionButtons(c) {
  const total = Number(c.total) || 0;
  return `
    <span class="cat-actions">
      <button type="button" class="btn btn-sm btn-outline-primary btn-icon btn-cat-view"
              data-id="${escHtml(c._id)}" data-total="${total}"
              data-bs-toggle="tooltip" data-bs-placement="top" title="View category"
              aria-label="View ${escHtml(c.name)}">
        <i class="bi bi-eye" aria-hidden="true"></i>
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary btn-icon btn-cat-edit"
              data-id="${escHtml(c._id)}" data-total="${total}"
              data-bs-toggle="tooltip" data-bs-placement="top" title="Edit category"
              aria-label="Edit ${escHtml(c.name)}">
        <i class="bi bi-pencil" aria-hidden="true"></i>
      </button>
      <button type="button" class="btn btn-sm btn-outline-danger btn-icon btn-cat-delete"
              data-id="${escHtml(c._id)}" data-name="${escHtml(c.name)}" data-total="${total}"
              data-bs-toggle="tooltip" data-bs-placement="top" title="Delete category"
              aria-label="Delete ${escHtml(c.name)}">
        <i class="bi bi-trash" aria-hidden="true"></i>
      </button>
    </span>`;
}

function renderCategoryRows(rows) {
  const tbody = document.getElementById("categoriesTableBody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="5" class="text-center py-5">
        <i class="bi bi-tags fs-1 text-muted d-block mb-2" aria-hidden="true"></i>
        <p class="text-muted mb-3">No categories found.</p>
        <button type="button" class="btn btn-primary btn-sm btn-add-category"
                data-bs-toggle="modal" data-bs-target="#categoryModal"
                aria-label="Add the first category">
          <i class="bi bi-plus-circle me-1"></i>Add Category
        </button>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((c, i) => {
      const total = Number(c.total) || 0;
      /* A computed "Uncategorised" row has no _id and is therefore not
       editable/deletable — editing or deleting it would be misleading. */
      const actions = c._id
        ? categoryActionButtons(c)
        : `<span class="badge bg-light text-muted border" title="Requests that have no matching category">Uncategorised</span>`;
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escHtml(c.name)}</strong></td>
        <td class="text-truncate" style="max-width:280px;" title="${escHtml(c.description || "")}">${escHtml(c.description || "—")}</td>
        <td><span class="badge bg-light text-dark border ${total > 0 ? "bg-primary-subtle text-primary-emphasis" : ""}">${total}</span></td>
        <td>${actions}</td>
      </tr>`;
    })
    .join("");

  initCategoryTooltips(tbody);
}

function renderCategoryStats(rows) {
  const stats = document.getElementById("categoryStats");
  if (!stats) return;

  if (!rows.length) {
    stats.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-bar-chart fs-2 text-muted d-block mb-2" aria-hidden="true"></i>
        <p class="text-muted small mb-0">No category data to display yet.</p>
      </div>`;
    return;
  }

  const withRequests = rows.filter((r) => Number(r.total) > 0);
  if (!withRequests.length) {
    stats.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-inbox fs-2 text-muted d-block mb-2" aria-hidden="true"></i>
        <p class="text-muted small mb-0">No requests assigned to a category yet.</p>
        <p class="text-muted small">Statistics will appear here once requests are submitted.</p>
      </div>`;
    return;
  }

  const colours = [
    "#2563eb",
    "#198754",
    "#ffc107",
    "#dc3545",
    "#0dcaf0",
    "#6f42c1",
    "#fd7e14",
    "#20c997",
    "#6c757d",
    "#d63384",
  ];
  const max = Math.max(1, ...withRequests.map((r) => Number(r.total) || 0));
  const totalRequests = withRequests.reduce(
    (s, r) => s + (Number(r.total) || 0),
    0,
  );

  stats.innerHTML =
    `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span class="small fw-semibold text-muted">Total requests</span>
      <span class="badge bg-primary">${totalRequests}</span>
    </div>` +
    withRequests
      .map((c, i) => {
        const total = Number(c.total) || 0;
        const pct = Math.round((total / max) * 100);
        return `
        <div class="d-flex align-items-center gap-2 pt-2 pb-1">
          <span class="stat-dot" style="background:${colours[i % colours.length]}" aria-hidden="true"></span>
          <span class="small flex-grow-1 text-truncate" title="${escHtml(c.name)}">${escHtml(c.name)}</span>
          <span class="badge bg-light text-dark border">${total}</span>
        </div>
        <div class="progress mb-2" style="height:6px;" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar" style="width:${pct}%;background:${colours[i % colours.length]};"></div>
        </div>`;
      })
      .join("");
}

function renderCategoryInError(tbody, stats) {
  if (tbody && !tbody.querySelector("button")) {
    tbody.innerHTML = `
      <tr><td colspan="5" class="text-center py-5">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3" aria-hidden="true"></i>
        <p class="text-danger mb-1">Unable to load categories.</p>
        <p class="text-muted small mb-3">The server did not return category data. Please try again.</p>
        <button type="button" class="btn btn-outline-primary btn-sm" onclick="loadCategories()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
  }
  if (stats) {
    stats.innerHTML = `
      <div class="text-center py-5">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3" aria-hidden="true"></i>
        <p class="text-danger mb-1">Unable to load stats.</p>
        <button type="button" class="btn btn-outline-primary btn-sm" onclick="loadCategories()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>`;
  }
}

/* Bootstrap tooltips are progressive enhancement — never block rendering. */
function initCategoryTooltips(scope) {
  try {
    if (typeof bootstrap === "undefined" || !bootstrap.Tooltip) return;
    (scope || document)
      .querySelectorAll('[data-bs-toggle="tooltip"]')
      .forEach((el) => {
        if (!bootstrap.Tooltip.getInstance(el))
          new bootstrap.Tooltip(el, { container: "body" });
      });
  } catch (_) {
    /* ignore */
  }
}

/* ── VIEW ─────────────────────────────────────────────────── */
async function viewCategory(id, totalFromRow, btn) {
  const modalEl = document.getElementById("categoryViewModal");
  const body = document.getElementById("categoryViewBody");
  const label = document.getElementById("categoryViewLabel");
  if (!modalEl || !body) return;

  if (btn) setRowBusy(btn, true);
  body.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>`;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  try {
    const { data: c } = await apiRequest(
      `/categories/${encodeURIComponent(id)}`,
    );
    body.innerHTML = renderCategoryDetail(c || {}, Number(totalFromRow) || 0);
    if (label)
      label.textContent = c && (c.name || c._id) ? c.name : "Category Details";
  } catch (err) {
    console.error(
      `[Categories] View "${id}" failed:`,
      err && err.message ? err.message : err,
    );
    body.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3" aria-hidden="true"></i>
        <p class="text-danger mb-3">Unable to load category details.</p>
        <button type="button" class="btn btn-outline-primary btn-sm"
                onclick="viewCategory('${escHtml(id)}', ${Number(totalFromRow) || 0}, null)">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>`;
  } finally {
    if (btn) setRowBusy(btn, false);
  }
}

function renderCategoryDetail(c, total) {
  const created = c.createdAt || c.created_at;
  const updated = c.updatedAt || c.updated_at;
  return `
    <div class="text-center mb-3">
      <span class="rounded-circle d-inline-flex align-items-center justify-content-center cat-avatar" aria-hidden="true">
        <i class="bi bi-tags fs-3"></i>
      </span>
    </div>
    <div class="mb-3 text-center">
      <div class="fw-bold fs-5">${escHtml(c.name || "—")}</div>
      <span class="badge bg-success mt-1">Active</span>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-6">
        <div class="text-muted small fw-semibold mb-1">Total Requests</div>
        <span class="badge bg-primary">${total} request${total === 1 ? "" : "s"}</span>
      </div>
      <div class="col-6">
        <div class="text-muted small fw-semibold mb-1">Created</div>
        <span class="small">${created ? formatDateTime(created) : "—"}</span>
      </div>
      <div class="col-12">
        <div class="text-muted small fw-semibold mb-1">Description</div>
        <div class="p-3 rounded bg-light small" style="white-space:pre-wrap;">${escHtml(c.description || "No description provided.")}</div>
      </div>
    </div>`;
}

/* ── EDIT ─────────────────────────────────────────────────── */
function editCategory(id, btn) {
  if (btn) setRowBusy(btn, true);
  (async () => {
    try {
      const { data: c } = await apiRequest(
        `/categories/${encodeURIComponent(id)}`,
      );
      document.getElementById("categoryId").value = c._id || c.id;
      document.getElementById("categoryName").value = c.name || "";
      document.getElementById("categoryDescription").value =
        c.description || "";
      document.getElementById("categoryModalLabel").textContent =
        "Edit Category";
      const alert = document.getElementById("categoryModalAlert");
      if (alert) {
        alert.className = "alert d-none";
        alert.innerHTML = "";
      }
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("categoryModal"),
      ).show();
    } catch (err) {
      console.error(
        "Load category for edit failed:",
        err && err.message ? err.message : err,
      );
      showToast(err.message, "danger");
    } finally {
      if (btn) setRowBusy(btn, false);
    }
  })();
}

/* ── SAVE (create + update) ───────────────────────────────── */
async function saveCategory() {
  const id = document.getElementById("categoryId").value;
  const name = document.getElementById("categoryName").value.trim();
  const desc = document.getElementById("categoryDescription").value.trim();

  const alert = document.getElementById("categoryModalAlert");
  if (alert) {
    alert.className = "alert d-none";
    alert.innerHTML = "";
  }

  if (!name || name.length < 2) {
    showAlert(
      "categoryModalAlert",
      "Category name must be at least 2 characters.",
      "warning",
    );
    return;
  }
  if (name.length > 100) {
    showAlert(
      "categoryModalAlert",
      "Category name must be no more than 100 characters.",
      "warning",
    );
    return;
  }
  if (desc.length > 500) {
    showAlert(
      "categoryModalAlert",
      "Description must be no more than 500 characters.",
      "warning",
    );
    return;
  }

  setLoading("saveCategoryBtn", "saveCategorySpinner", true);
  try {
    if (id)
      await apiRequest(`/categories/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: { name, description: desc },
      });
    else
      await apiRequest("/categories", {
        method: "POST",
        body: { name, description: desc },
      });

    const modal = document.getElementById("categoryModal");
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    document.getElementById("categoryForm").reset();
    document.getElementById("categoryId").value = "";
    document.getElementById("categoryModalLabel").textContent = "Add Category";
    if (alert) {
      alert.className = "alert d-none";
      alert.innerHTML = "";
    }

    showToast(
      id ? "Category updated successfully." : "Category added successfully.",
      "success",
    );
    await loadCategories();
  } catch (err) {
    console.error(
      "Save category failed:",
      err && err.message ? err.message : err,
    );
    showAlert("categoryModalAlert", err.message, "danger");
  } finally {
    setLoading("saveCategoryBtn", "saveCategorySpinner", false);
  }
}

/* ── DELETE (confirm → execute) ────────────────────────────── */
function confirmDeleteCategory(id, name, total) {
  _pendingDelete = { id, name, total: Number(total) || 0 };

  const nameEl = document.getElementById("categoryDeleteName");
  if (nameEl) nameEl.textContent = _pendingDelete.name;

  const info = document.getElementById("categoryDeleteInfo");
  if (info) {
    info.innerHTML =
      _pendingDelete.total > 0
        ? `<div class="alert alert-warning py-2 small mb-0">
           <i class="bi bi-inbox me-1"></i><strong>${_pendingDelete.total}</strong>
           request${_pendingDelete.total === 1 ? "" : "s"} reference this category. They will NOT be deleted —
           they will be reclassified as <strong>Uncategorised</strong>.
         </div>`
        : "";
    info.classList.toggle("d-none", _pendingDelete.total === 0);
  }

  const alert = document.getElementById("deleteCategoryAlert");
  if (alert) {
    alert.className = "alert d-none";
    alert.innerHTML = "";
  }

  const modal = document.getElementById("deleteCategoryModal");
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function executeDeleteCategory() {
  if (!_pendingDelete || !_pendingDelete.id) return;

  const confirmBtn = document.getElementById("deleteCategoryConfirmBtn");
  const spinner = document.getElementById("deleteCategorySpinner");
  if (confirmBtn) confirmBtn.disabled = true;
  if (spinner) spinner.classList.remove("d-none");

  const alert = document.getElementById("deleteCategoryAlert");
  if (alert) {
    alert.className = "alert d-none";
    alert.innerHTML = "";
  }

  try {
    await apiRequest(`/categories/${encodeURIComponent(_pendingDelete.id)}`, {
      method: "DELETE",
    });
    showToast("Category deleted successfully.", "success");
    const modal = document.getElementById("deleteCategoryModal");
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    _pendingDelete = null;
    await loadCategories();
  } catch (err) {
    console.error(
      "Delete category failed:",
      err && err.message ? err.message : err,
    );
    showAlert(
      "deleteCategoryAlert",
      `Unable to delete the category: ${err.message}`,
      "danger",
    );
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
    if (spinner) spinner.classList.add("d-none");
  }
}

/* ═══════════════════════════════════════════════════════════
   USER MANAGEMENT (Admin)
   ═══════════════════════════════════════════════════════════ */
let _allUsers = [];
let _allUsersQuery = { q: "", role: "", status: "" };
let _usersPage = 1;
const _USERS_PAGE_SIZE = 10;

/* Human-readable role/status labels derived from the stored DB value
   (we always keep and display the real database value as the source of truth). */
function userRoleLabel(role) {
  if (role === "ICT Admin") return "Admin";
  if (role === "Technician") return "Technician";
  return "Requester";
}
function userRoleBadge(role) {
  const cls =
    role === "ICT Admin"
      ? "danger"
      : role === "Technician"
        ? "warning text-dark"
        : "primary";
  return `<span class="badge bg-${cls}">${escHtml(userRoleLabel(role))}</span>`;
}
function userStatusBadge(status) {
  return status === "active"
    ? `<span class="badge bg-success"><i class="bi bi-circle-fill me-1" style="font-size:.5rem;"></i>Active</span>`
    : `<span class="badge bg-secondary"><i class="bi bi-circle me-1" style="font-size:.5rem;"></i>Inactive</span>`;
}

/* Re-fetch the full user list from the backend and re-render the table,
   re-applying the currently active search/role/status filters. Called on
   every load and after create / update / delete. */
async function refreshUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (tbody) {
    /* Professional loading state — spinner only while the request is pending. */
    tbody.innerHTML = `
      <tr><td colspan="8" class="text-center text-muted py-4">
        <div class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></div>
        Loading users...
      </td></tr>`;
  }

  try {
    const { data } = await apiRequest("/users");
    _allUsers = Array.isArray(data) ? data : [];
    _usersPage = 1;
    captureUserFilters();
    renderUsersTable();
    wireUserManagementFilters();
    return _allUsers;
  } catch (err) {
    console.error("Load users failed:", err);
    showToast(err.message, "danger");
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="8" class="text-center py-4">
          <i class="bi bi-people fs-1 text-danger d-block mb-2"></i>
          <p class="text-danger mb-2">Unable to load users.</p>
          <p class="text-muted small mb-3">Please try again.</p>
          <button class="btn btn-sm btn-outline-primary" onclick="refreshUsersTable()">
            <i class="bi bi-arrow-clockwise me-1"></i>Retry
          </button>
        </td></tr>`;
    }
    return [];
  }
}

function captureUserFilters() {
  _allUsersQuery.q = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();
  _allUsersQuery.role = document.getElementById("roleFilter")?.value || "";
  _allUsersQuery.status = document.getElementById("statusFilter")?.value || "";
}

function filteredUsers() {
  const { q, role, status } = _allUsersQuery;
  return _allUsers.filter(
    (u) =>
      (!q ||
        (u.fullName || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.role || "").toLowerCase().includes(q) ||
        (u.department || "").toLowerCase().includes(q)) &&
      (!role || u.role === role) &&
      (!status || u.status === status),
  );
}

function _usersMaxPages() {
  return Math.max(1, Math.ceil(filteredUsers().length / _USERS_PAGE_SIZE));
}

/* Idempotent wiring (guarded so reloads / retries never stack listeners). */
let _usersWired = false;
function wireUserManagementFilters() {
  if (_usersWired) return;
  _usersWired = true;

  const apply = () => {
    captureUserFilters();
    _usersPage = 1;
    renderUsersTable();
  };

  document.getElementById("searchInput")?.addEventListener("input", apply);
  document.getElementById("roleFilter")?.addEventListener("change", apply);
  document.getElementById("statusFilter")?.addEventListener("change", apply);
  document.getElementById("searchBtn")?.addEventListener("click", apply);
  document
    .getElementById("resetUserFiltersBtn")
    ?.addEventListener("click", () => {
      document.getElementById("searchInput").value = "";
      document.getElementById("roleFilter").value = "";
      document.getElementById("statusFilter").value = "";
      apply();
    });
  document
    .getElementById("adminUsersPrevBtn")
    ?.addEventListener("click", () => {
      if (_usersPage > 1) {
        _usersPage--;
        renderUsersTable();
      }
    });
  document
    .getElementById("adminUsersNextBtn")
    ?.addEventListener("click", () => {
      if (_usersPage < _usersMaxPages()) _usersPage++;
      renderUsersTable();
    });
}

async function initUserManagement() {
  if (!requireRole("ICT Admin")) return;

  await refreshUsersTable();

  document.getElementById("addUserBtn")?.addEventListener("click", () => {
    document.getElementById("userForm").reset();
    document.getElementById("userId").value = "";
    document.getElementById("userModalLabel").textContent = "Add New User";
    document.getElementById("passwordField").style.display = "";
    document.getElementById("userModalAlert").classList.add("d-none");
  });
  /* Real submit handler — the Save button is `type="submit"` (associated via
     form="userForm"). Intercepting the form submit event covers BOTH the button
     click and pressing Enter in a field, with a single guaranteed trigger. */
  document.getElementById("userForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveUser();
  });
  document
    .getElementById("confirmDeleteUserBtn")
    ?.addEventListener("click", doDeleteUser);
  document
    .getElementById("confirmChangeRoleBtn")
    ?.addEventListener("click", doChangeRole);
  document
    .getElementById("confirmPermanentDeleteBtn")
    ?.addEventListener("click", executePermanentDelete);

  /* Permanent-delete modal close → always clear the selected-id/name state so a
     stale row can never be reported as "this user" the next time the modal opens. */
  const pmModalEl = document.getElementById("permanentDeleteModal");
  if (pmModalEl) {
    pmModalEl.addEventListener("hidden.bs.modal", () => {
      _pendingPermanentDelete = null;
      _permanentDeleting = false;
      setLoading("confirmPermanentDeleteBtn", "permanentDeleteSpinner", false);
      resetPermanentDeleteModalViews();
    });
  }

  /* Event delegation for the dynamically rendered Actions dropdown.
     Since the table is re-rendered on refresh/filter, we bind one listener
     on the tbody that survives every render. Clicks land on the dropdown
     menu items (still DOM children of the row cell). */
  const tbody = document.getElementById("usersTableBody");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      const item = e.target.closest("[data-user-action]");
      if (item) {
        e.preventDefault(); // <a href="#"> must not jump the page
        const id =
          item.getAttribute("data-id") ||
          item.closest("tr[data-user-id]")?.getAttribute("data-user-id") ||
          "";
        if (!id) {
          console.error("User action: missing user id.");
          showToast("Could not identify the user.", "danger");
          return;
        }
        const what = item.getAttribute("data-user-action");
        const name = item.getAttribute("data-name") || "this user";
        const toc = item
          .closest(".dropdown")
          ?.querySelector(".dropdown-toggle");
        if (what === "view") viewUser(id);
        else if (what === "edit") editUser(id);
        else if (what === "role")
          openChangeRole(id, name, item.getAttribute("data-role") || "");
        else if (what === "deactivate") {
          prepDeleteUser(id, name);
          const modal = document.getElementById("deleteUserModal");
          if (modal) new bootstrap.Modal(modal).show();
        }
        /* Close the opened dropdown after an action */
        if (toc) {
          const inst = bootstrap.Dropdown.getInstance(toc);
          if (inst) inst.hide();
        }
      }
    });
  }
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  const filtered = filteredUsers();

  const countEl = document.getElementById("adminUsersCount");
  if (countEl) {
    if (filtered.length) {
      countEl.textContent = `Showing ${filtered.length} user${filtered.length === 1 ? "" : "s"}`;
    } else {
      countEl.textContent = "0 users";
    }
  }

  const resetBtn = document.getElementById("resetUserFiltersBtn");
  if (resetBtn)
    resetBtn.style.display =
      _allUsersQuery.q || _allUsersQuery.role || _allUsersQuery.status
        ? "inline-flex"
        : "none";

  const pageWrap = document.getElementById("adminUsersPaginationWrap");
  const pageInfo = document.getElementById("adminUsersPageInfo");
  const maxPages = _usersMaxPages();
  if (_usersPage > maxPages) _usersPage = maxPages;
  const start = (_usersPage - 1) * _USERS_PAGE_SIZE;
  const page = filtered.slice(start, start + _USERS_PAGE_SIZE);

  if (pageWrap)
    pageWrap.style.display = filtered.length > _USERS_PAGE_SIZE ? "" : "none";
  if (pageInfo)
    pageInfo.textContent = filtered.length
      ? `Showing ${start + 1}–${Math.min(start + _USERS_PAGE_SIZE, filtered.length)} of ${filtered.length} users`
      : "";

  const prevBtn = document.getElementById("adminUsersPrevBtn");
  const nextBtn = document.getElementById("adminUsersNextBtn");
  if (prevBtn) prevBtn.disabled = _usersPage <= 1;
  if (nextBtn) nextBtn.disabled = _usersPage >= maxPages;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="text-center py-5">
      <i class="bi bi-people fs-1 text-muted d-block mb-2"></i>
      <p class="text-muted mb-0">${_allUsersQuery.q ? "No users match your search." : "No users found."}</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = page
    .map(
      (u, i) => `
    <tr data-user-id="${escHtml(u._id || "")}">
      <td class="text-muted">${escHtml(start + i + 1)}</td>
      <td><strong>${escHtml(u.fullName)}</strong></td>
      <td class="text-muted small">${escHtml(u.email)}</td>
      <td>${userRoleBadge(u.role)}</td>
      <td>${escHtml(u.department || "—")}</td>
      <td>${userStatusBadge(u.status)}</td>
      <td><small class="text-muted">${formatDate(u.createdAt || u.created_at)}</small></td>
      <td class="text-nowrap">
        ${
          u._id
            ? `
        <div class="dropdown">
          <button class="btn btn-sm btn-outline-secondary dropdown-toggle py-0 px-2" type="button"
                  data-bs-toggle="dropdown" data-bs-boundary="viewport" aria-expanded="false"
                  title="Actions">
            <i class="bi bi-three-dots-vertical"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow-sm">
            <li><a class="dropdown-item" href="#" data-user-action="view" data-id="${escHtml(u._id)}"><i class="bi bi-eye me-2"></i>View</a></li>
            <li><a class="dropdown-item" href="#" data-user-action="edit" data-id="${escHtml(u._id)}"><i class="bi bi-pencil me-2"></i>Edit</a></li>
            <li><a class="dropdown-item" href="#" data-user-action="role" data-id="${escHtml(u._id)}" data-name="${escHtml(u.fullName)}" data-role="${escHtml(u.role)}"><i class="bi bi-person-gear me-2"></i>Change Role</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" data-user-action="deactivate" data-id="${escHtml(u._id)}" data-name="${escHtml(u.fullName)}"><i class="bi bi-person-dash me-2"></i>Deactivate</a></li>
          </ul>
        </div>`
            : `<span class="text-muted small">—</span>`
        }
      </td>
    </tr>`,
    )
    .join("");
}

async function editUser(id) {
  try {
    const { data: u } = await apiRequest(`/users/${id}`);
    document.getElementById("userId").value = u._id || u.id;
    document.getElementById("userName").value = u.fullName;
    document.getElementById("userEmail").value = u.email;
    document.getElementById("userRole").value = u.role;
    document.getElementById("userStatus").value = u.status;
    document.getElementById("userDepartment").value = u.department || "";
    document.getElementById("userPhone").value = u.phone || "";
    document.getElementById("userPassword").value = "";
    document.getElementById("userModalLabel").textContent = "Edit User";
    document.getElementById("passwordField").style.display = "";
    new bootstrap.Modal(document.getElementById("userModal")).show();
  } catch (err) {
    console.error("Load user for edit failed:", err);
    showToast(err.message, "danger");
  }
}

/* ── View User ───────────────────────────────────────────── */
async function viewUser(id) {
  try {
    const { data: u } = await apiRequest(`/users/${id}`);
    const set = (el, val) => {
      const n = document.getElementById(el);
      if (n) n.textContent = val ?? "—";
    };
    set("viewUserName", u.fullName);
    set("viewUserEmail", u.email);
    set("viewUserRole", u.role);
    set("viewUserStatus", u.status);
    set("viewUserDepartment", u.department || "—");
    set("viewUserPhone", u.phone || "—");
    set("viewUserCreated", formatDate(u.createdAt || u.created_at));
    new bootstrap.Modal(document.getElementById("viewUserModal")).show();
  } catch (err) {
    console.error("[VIEW USER] error:", err);
    showToast(err.message, "danger");
  }
}

/* ── Change Role ─────────────────────────────────────────── */
let _changingRole = false;

function openChangeRole(id, name, currentRole) {
  document.getElementById("changeRoleUserId").value = id;
  const nameEl = document.getElementById("changeRoleUserName");
  if (nameEl) nameEl.textContent = name;
  const sel = document.getElementById("changeRoleSelect");
  if (sel) sel.value = currentRole || "";
  const alertEl = document.getElementById("changeRoleAlert");
  if (alertEl) alertEl.classList.add("d-none");
  new bootstrap.Modal(document.getElementById("changeRoleModal")).show();
}

async function doChangeRole() {
  const id = document.getElementById("changeRoleUserId").value;
  const role = document.getElementById("changeRoleSelect").value;
  if (!id) {
    console.error("Change role: missing user id.");
    showToast("Could not identify the user.", "danger");
    return;
  }
  if (!role) {
    showAlert("changeRoleAlert", "Please select a role.", "warning");
    return;
  }

  if (_changingRole) return; // prevent double submit
  _changingRole = true;
  const label = document.getElementById("changeRoleLabel");
  setLoading("confirmChangeRoleBtn", "changeRoleSpinner", true);
  if (label) label.textContent = "Saving...";

  try {
    await apiRequest(`/users/${id}`, {
      method: "PUT",
      body: { role },
    });
    const modal = document.getElementById("changeRoleModal");
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    showToast("User role updated.", "success");
    await refreshUsersTable();
  } catch (err) {
    console.error("[CHANGE ROLE] error:", err);
    showAlert(
      "changeRoleAlert",
      (err && err.status ? "HTTP " + err.status + " — " : "") +
        (err && err.message ? err.message : "Failed to change role."),
      "danger",
    );
  } finally {
    _changingRole = false;
    setLoading("confirmChangeRoleBtn", "changeRoleSpinner", false);
    if (label) label.textContent = "Change Role";
  }
}

let _savingUser = false;

async function saveUser() {
  const saveBtn = document.getElementById("saveUserBtn");
  const saveLabel = document.getElementById("saveUserLabel");

  /* Prevent duplicate SUBMITs from rapid clicks / Enter key presses. */
  if (_savingUser) return;
  _savingUser = true;
  setLoading("saveUserBtn", "saveUserSpinner", true);
  if (saveLabel) saveLabel.textContent = "Saving...";

  const id = document.getElementById("userId").value;
  const pw = document.getElementById("userPassword").value;
  const body = {
    fullName: document.getElementById("userName").value.trim(),
    email: document.getElementById("userEmail").value.trim(),
    role: document.getElementById("userRole").value,
    status: document.getElementById("userStatus").value,
    department: document.getElementById("userDepartment").value.trim(),
    phone: document.getElementById("userPhone").value.trim(),
  };

  /* Validate fields */
  let hasError = false;

  if (!body.fullName || body.fullName.length < 2) {
    showAlert(
      "userModalAlert",
      "Name must be at least 2 characters.",
      "warning",
    );
    hasError = true;
  }

  if (!body.email || Validators.email(body.email)) {
    showAlert(
      "userModalAlert",
      "Please enter a valid email address.",
      "warning",
    );
    hasError = true;
  }

  if (!body.role) {
    showAlert("userModalAlert", "Role is required.", "warning");
    hasError = true;
  }

  if (!id && !pw) {
    showAlert(
      "userModalAlert",
      "Password is required for new users.",
      "warning",
    );
    hasError = true;
  }

  if (!id && pw && Validators.password(pw)) {
    showAlert(
      "userModalAlert",
      "Password must be at least 8 characters and contain both letters and numbers.",
      "warning",
    );
    hasError = true;
  }

  if (body.phone && Validators.phone(body.phone)) {
    showAlert(
      "userModalAlert",
      "Please enter a valid phone number.",
      "warning",
    );
    hasError = true;
  }

  if (hasError) {
    _savingUser = false;
    setLoading("saveUserBtn", "saveUserSpinner", false);
    if (saveLabel) saveLabel.textContent = "Save User";
    return;
  }

  try {
    if (id) {
      await apiRequest(`/users/${id}`, { method: "PUT", body });
      if (pw)
        await apiRequest(`/users/${id}/password`, {
          method: "PUT",
          body: { password: pw },
        });
    } else {
      await apiRequest("/users", {
        method: "POST",
        body: { ...body, password: pw },
      });
    }

    /* Close the modal, clear the form, then refresh the table in place so the
       newly added/updated user appears immediately (re-fetches GET /api/users). */
    const modalEl = document.getElementById("userModal");
    if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
    document.getElementById("userForm").reset();
    document.getElementById("userModalAlert").classList.add("d-none");

    if (id) {
      showToast("User updated.", "success");
    } else {
      showToast("User added successfully!", "success");
    }
    await refreshUsersTable();
  } catch (err) {
    console.error("[ADD USER] error:", err);
    const backendMsg =
      err && err.message
        ? err.message
        : "Failed to save user. Please try again.";

    if (id) {
      /* For edit mode, show detailed error in modal */
      const parts = [];
      if (err && typeof err.status === "number") {
        parts.push(
          "HTTP " +
            err.status +
            (err.status === 401
              ? " (Unauthorized/access token expired)"
              : err.status === 403
                ? " (Forbidden)"
                : err.status === 404
                  ? " (Not found)"
                  : err.status === 409
                    ? " (Conflict)"
                    : err.status === 500
                      ? " (Server error)"
                      : ""),
        );
      }
      if (err && err.message) {
        parts.push(err.message);
      }
      if (!parts.length) parts.push("Unknown error.");
      showAlert(
        "userModalAlert",
        "Failed to save user: " + parts.join(" — "),
        "danger",
      );
    } else {
      /* For create mode, show the ACTUAL backend error message in the modal alert
         so the user sees it while the modal is still open */
      showAlert("userModalAlert", backendMsg, "danger");
    }
  } finally {
    _savingUser = false;
    setLoading("saveUserBtn", "saveUserSpinner", false);
    if (saveLabel) saveLabel.textContent = "Save User";
  }
}

function prepDeleteUser(id, name) {
  document.getElementById("deleteUserId").value = id;
  document.getElementById("deleteUserName").textContent = name;
}
async function doDeleteUser() {
  const id = document.getElementById("deleteUserId").value;
  if (!id) {
    console.error("Delete user: missing user id.");
    showToast("Could not identify the user to deactivate.", "danger");
    return;
  }
  try {
    await apiRequest(`/users/${id}`, { method: "DELETE" });
    const modal = document.getElementById("deleteUserModal");
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    showToast("User deactivated successfully.", "success");
    await refreshUsersTable();
  } catch (err) {
    console.error("Delete user failed:", err);
    showToast(err.message, "danger");
  }
}

/* ── Hard "Delete" from the Actions menu ───────────────────────
   Truly removes the user (and any linked Technician profile) from MongoDB via
   the dedicated admin endpoint DELETE /api/users/:id/permanent (enforced to
   role 'ICT Admin' on the backend). A dedicated confirmation modal asks for
   explicit consent first; only after it is confirmed is the API called. This
   is completely separate from the Deactivate/Inactive action, which only
   soft-deletes. */
let _permanentDeleting = false;
let _pendingPermanentDelete =
  null; /* { id, name, email, role } — resolved from the current dataset */

function _pmEl(id) {
  return document.getElementById(id);
}

function resetPermanentDeleteModalViews() {
  const confirmView = _pmEl("permanentDeleteConfirmView");
  const stateView = _pmEl("permanentDeleteStateView");
  if (confirmView) confirmView.classList.remove("d-none");
  if (stateView) stateView.classList.add("d-none");
  _pmEl("permanentDeleteCancelBtn")?.classList.remove("d-none");
  _pmEl("permanentDeleteCloseBtn")?.classList.add("d-none");
  _pmEl("confirmPermanentDeleteBtn")?.classList.remove("d-none");
  const alertEl = _pmEl("permanentDeleteAlert");
  if (alertEl) {
    alertEl.className = "alert d-none";
    alertEl.innerHTML = "";
  }
  _pmEl("permanentDeleteUserId").value = "";
  _pmEl("permanentDeleteUserName").textContent = "";
  _pmEl("permanentDeleteUserEmail").textContent = "";
  _pmEl("permanentDeleteUserRole").textContent = "";
  _pmEl("permanentDeleteStateTitle").textContent = "";
  _pmEl("permanentDeleteStateText").textContent = "";
}

function showPermanentDeleteState(title, text) {
  _pmEl("permanentDeleteConfirmView")?.classList.add("d-none");
  _pmEl("permanentDeleteStateView")?.classList.remove("d-none");
  _pmEl("permanentDeleteCancelBtn")?.classList.add("d-none");
  _pmEl("confirmPermanentDeleteBtn")?.classList.add("d-none");
  _pmEl("permanentDeleteCloseBtn")?.classList.remove("d-none");
  _pmEl("permanentDeleteStateTitle").textContent = title;
  _pmEl("permanentDeleteStateText").textContent = text;
}

/* Open the permanent-delete modal for the row that was clicked.
   The id passed in comes from the rendered row; we ALWAYS re-resolve the
   canonical MongoDB _id from the current dataset (never a row index, email,
   or display id) before showing a confirmation. */
function openPermanentDeleteModal(id, name) {
  resetPermanentDeleteModalViews();

  const raw = String(id == null ? "" : id).trim();
  if (!raw) {
    console.error("Delete user: missing user id.");
    showPermanentDeleteState(
      "Invalid user reference",
      "No user ID was found for the selected row. Please refresh the list and try again.",
    );
    new bootstrap.Modal(_pmEl("permanentDeleteModal")).show();
    return;
  }

  const user = _allUsers.find((u) => String(u._id || u.id) === raw);
  console.log(
    "[PERM DELETE] row id:",
    raw,
    "→ resolved:",
    user ? user._id : "(not in current dataset)",
  );

  if (!user) {
    showPermanentDeleteState(
      "User not found in list",
      "This user could not be found in the current list. The list may be outdated — refresh it and try again.",
    );
    new bootstrap.Modal(_pmEl("permanentDeleteModal")).show();
    return;
  }

  _pendingPermanentDelete = {
    id: String(user._id || user.id),
    name: user.fullName || name || "this user",
    email: user.email || "",
    role: user.role || "",
  };

  _pmEl("permanentDeleteUserId").value = _pendingPermanentDelete.id;
  _pmEl("permanentDeleteUserName").textContent = _pendingPermanentDelete.name;
  _pmEl("permanentDeleteUserEmail").textContent = _pendingPermanentDelete.email;
  _pmEl("permanentDeleteUserRole").textContent = _pendingPermanentDelete.role;
  resetPermanentDeleteModalViews();
  new bootstrap.Modal(_pmEl("permanentDeleteModal")).show();
}

async function executePermanentDelete() {
  const id = _pmEl("permanentDeleteUserId")?.value;
  if (!id) {
    console.error("Delete user: missing user id.");
    showPermanentDeleteState(
      "Invalid user reference",
      "No user ID is set for deletion. Please close and try again.",
    );
    return;
  }
  if (_permanentDeleting) return; // prevent duplicate requests

  /* Re-verify the selected user against the CURRENT dataset so we can NEVER
     delete the wrong record (stale DOM, duplicate names, wrong email, etc.). */
  const user = _allUsers.find((u) => String(u._id || u.id) === String(id));
  if (!user) {
    console.error(
      "Permanent delete: requested user not in current dataset:",
      id,
    );
    showPermanentDeleteState(
      "User not found in list",
      "This user could not be found in the current list. The list may be outdated — refresh it and try again.",
    );
    return;
  }

  _permanentDeleting = true;
  setLoading("confirmPermanentDeleteBtn", "permanentDeleteSpinner", true);

  const alertEl = _pmEl("permanentDeleteAlert");
  if (alertEl) {
    alertEl.className = "alert d-none";
    alertEl.innerHTML = "";
  }

  try {
    await apiRequest(`/users/${encodeURIComponent(id)}/permanent`, {
      method: "DELETE",
    });
    showToast("User permanently deleted.", "success");
    const modal = _pmEl("permanentDeleteModal");
    if (modal && bootstrap.Modal.getInstance(modal))
      bootstrap.Modal.getInstance(modal).hide();
    _pendingPermanentDelete = null;
    /* Re-fetch GET /api/users → the deleted user disappears from the table and
       the on-screen user count is recomputed from the fresh server response. */
    await refreshUsersTable();
  } catch (err) {
    console.error("Permanent delete failed:", err);
    const status = err && typeof err.status === "number" ? err.status : null;
    const serverMsg =
      /* friendly HTTP message echoed by apiRequest, if any */
      (err && err.data && err.data.message) || (err && err.message) || "";

    if (status === 404 && serverMsg === "Route not found.") {
      /* Diagnostic: the running backend predates DELETE /:id/permanent and the
         express fallthrough (server.js) answered. NOT evidence the user is gone. */
      console.error(
        "Permanent delete: endpoint not registered in backend (stale server). Restart the backend.",
      );
      showPermanentDeleteState(
        "Delete service unavailable",
        "The backend is running an outdated build that does not expose the permanent-delete endpoint. Restart the backend server, then try again.",
      );
    } else if (status === 404) {
      showPermanentDeleteState(
        "User could not be found",
        "This user could not be found on the server — it may already have been removed. The list will be refreshed.",
      );
      await refreshUsersTable();
    } else if (status === 403) {
      showPermanentDeleteState(
        "Permission denied",
        "You do not have permission to permanently delete users.",
      );
    } else if (status === 400) {
      showPermanentDeleteState(
        "Invalid user ID",
        serverMsg ||
          "The user ID is invalid. Please refresh the list and try again.",
      );
    } else if (status === 409) {
      if (alertEl) {
        alertEl.className =
          "alert alert-warning d-flex align-items-center gap-2";
        alertEl.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i><span>${escHtml(serverMsg || "This user cannot be permanently deleted while they still have active assigned requests.")}</span>`;
      } else {
        showToast(serverMsg, "warning");
      }
    } else {
      showPermanentDeleteState(
        "Unable to verify this user",
        "There was a problem reaching the server. Please try again.",
      );
    }
  } finally {
    _permanentDeleting = false;
    setLoading("confirmPermanentDeleteBtn", "permanentDeleteSpinner", false);
  }
}

/* ═══════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════ */
async function populateSelect(id, endpoint, allOpt = false) {
  try {
    const { data } = await apiRequest(endpoint);
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = "";
    if (first) sel.appendChild(first);
    if (allOpt) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "All Categories";
      sel.appendChild(o);
    }
    data.forEach((item) => {
      const o = document.createElement("option");
      // Support both MySQL (id) and MongoDB (_id)
      o.value = item._id || item.id || "";
      o.textContent = item.name;
      sel.appendChild(o);
    });
  } catch (_) {}
}

async function populateAssetSelect(id) {
  try {
    const { data } = await apiRequest("/assets");
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = "";
    if (first) sel.appendChild(first);
    data.forEach((a) => {
      const o = document.createElement("option");
      o.value = a._id || a.id || "";
      o.textContent = `${a.asset_tag} — ${a.asset_name}`;
      sel.appendChild(o);
    });
  } catch (_) {}
}

const REQUEST_ASSET_DEVICE_CATEGORIES = {
  "Desktop Computer": ["computer"],
  Laptop: ["computer"],
  Tablet: ["computer", "peripheral"],
  "All-in-One Computer": ["computer"],
  "Thin Client": ["computer"],
  Workstation: ["computer", "server"],
  Monitor: ["peripheral"],
  Keyboard: ["peripheral"],
  Mouse: ["peripheral"],
  Webcam: ["peripheral"],
  Speakers: ["peripheral"],
  Headset: ["peripheral"],
  Printer: ["printer"],
  Scanner: ["printer"],
  Photocopier: ["printer"],
  "Multifunction Printer (MFP)": ["printer"],
  Plotter: ["printer"],
  Projector: ["peripheral", "other"],
  "Interactive Display": ["peripheral", "other"],
  "Smart Board": ["peripheral", "other"],
  "Digital Display": ["peripheral", "other"],
  Router: ["network"],
  Switch: ["network"],
  Hub: ["network"],
  Modem: ["network"],
  "Access Point": ["network"],
  Firewall: ["network"],
  "Network Cable": ["network"],
  "Patch Panel": ["network"],
  "Network Rack": ["network"],
  "Network Adapter / NIC": ["network", "peripheral"],
  "Wi-Fi Device": ["network"],
  "Network Repeater / Extender": ["network"],
  "Load Balancer": ["network", "server"],
  Server: ["server"],
  "Server Rack": ["server"],
  "NAS Storage": ["server", "other"],
  "Storage Device": ["server", "peripheral", "other"],
  UPS: ["other"],
  "UPS / Power Supply": ["other"],
  "Power Supply Unit (PSU)": ["other"],
  "PoE Device": ["network", "other"],
  "IP Phone": ["other", "peripheral"],
  Telephone: ["other", "peripheral"],
  "VoIP Phone": ["other", "peripheral"],
  "Video Conferencing Device": ["peripheral", "other"],
  Intercom: ["other"],
  "CCTV Camera": ["other", "network"],
  "CCTV DVR": ["other", "server"],
  "CCTV NVR": ["other", "server"],
  "Biometric/Fingerprint Device": ["other", "peripheral"],
  "Access Control Device": ["other", "network"],
  "Door Access Controller": ["other", "network"],
  "RFID/Card Reader": ["other", "peripheral"],
  "External Hard Drive": ["peripheral", "other"],
  "USB Flash Drive": ["peripheral", "other"],
  "CD/DVD Drive": ["peripheral", "other"],
  "Barcode Scanner": ["peripheral", "printer", "other"],
  "Card Printer": ["printer"],
  Network: ["network"],
  "Keyboard / Mouse": ["peripheral"],
  "Computer / Desktop": ["computer"],
  "Other Network Device": ["network"],
  "Other ICT Device": ["other"],
  Other: ["other"],
};

let _requestAssets = [];
/* Same in-flight timestamp guard as _requestCategoryPendingAt. */
let _requestAssetsPendingAt = 0;

/* Option label for the ICT Asset dropdown:
   "Asset Tag — Device Type — Location [— Brand Model] [— Serial]".
   Built only from real ICTAsset fields returned by GET /api/assets, and empty
   parts are dropped so the label never renders stray separators. */
function requestAssetLabel(asset) {
  const deviceType = asset.category || asset.asset_name;
  const brandModel = [asset.manufacturer, asset.model]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  return [
    asset.asset_tag,
    deviceType,
    asset.location,
    brandModel,
    asset.serial_number,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" — ");
}

function filterRequestAssets() {
  const select = document.getElementById("asset");
  if (!select) return;

  const deviceType = selectedDeviceType();
  const categories = REQUEST_ASSET_DEVICE_CATEGORIES[deviceType];
  let assets = _requestAssets;
  let usedTypeFallback = false;

  if (deviceType && categories?.length) {
    const compatible = assets.filter((asset) =>
      categories.includes(
        String(asset.category || "")
          .trim()
          .toLowerCase(),
      ),
    );
    if (compatible.length) assets = compatible;
    else usedTypeFallback = true;
  }

  const selectedId = select.value;
  const placeholder = new Option(
    shellI18n("req.selectAsset", "Select ICT Asset"),
    "",
    true,
    true,
  );
  placeholder.disabled = true;
  select.replaceChildren(placeholder);

  const noAssetLabel = shellI18n("req.assetNone", "No Asset / Not Applicable");

  if (_requestAssets.length === 0) {
    /* Empty state: an explanatory option, never a blank-looking dropdown.
       "No Asset / Not Applicable" stays selectable so a request can still
       be raised for a device that is not in the asset register. */
    select.appendChild(new Option(noAssetLabel, "none", true, true));
    const emptyOption = new Option(
      shellI18n("req.noAssets", "No ICT assets available"),
      "",
    );
    emptyOption.disabled = true;
    select.appendChild(emptyOption);
    select.value = "none";
    const status = document.getElementById("assetStatus");
    if (status)
      status.textContent = shellI18n("req.noAssets", "No ICT assets available");
    return;
  }

  select.appendChild(new Option(noAssetLabel, "none"));
  for (const asset of assets) {
    select.appendChild(
      new Option(requestAssetLabel(asset), String(asset._id || asset.id)),
    );
  }

  if (assets.length === 0) {
    /* No asset is compatible with the chosen Device Type — fall back to the
       full active list rather than presenting an unusable empty dropdown. */
    const message = "No matching ICT assets; showing all active assets";
    const emptyOption = new Option(message, "");
    emptyOption.disabled = true;
    select.appendChild(emptyOption);
    for (const asset of _requestAssets) {
      select.appendChild(
        new Option(requestAssetLabel(asset), String(asset._id || asset.id)),
      );
    }
  }

  if (
    Array.from(select.options).some((option) => option.value === selectedId)
  ) {
    select.value = selectedId;
  }

  const status = document.getElementById("assetStatus");
  if (status) {
    status.textContent = usedTypeFallback
      ? "No assets match this device type; showing all active ICT assets."
      : `${assets.length} ICT assets available.`;
  }
}

async function loadAssets() {
  const select = document.getElementById("asset");
  const status = document.getElementById("assetStatus");
  const retry = document.getElementById("assetRetry");
  if (!select) return;

  _requestAssets = [];
  _requestAssetsPendingAt = Date.now();
  select.replaceChildren(
    new Option(shellI18n("req.loadingAssets", "Loading ICT assets..."), ""),
  );
  select.disabled = true;
  if (status)
    status.textContent = shellI18n(
      "req.loadingAssets",
      "Loading ICT assets...",
    );
  retry?.classList.add("d-none");

  try {
    const result = await apiRequest("/assets?status=active");
    const data = Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result)
        ? result
        : [];
    _requestAssets = data.filter((asset) => {
      const id = asset?._id || asset?.id;
      const identifiable = [asset?.asset_tag, asset?.asset_name].some(
        (value) => typeof value === "string" && value.trim(),
      );
      return id && asset.status === "active" && identifiable;
    });

    filterRequestAssets();
    select.disabled = false;
  } catch {
    /* Never surface the raw backend error — the select shows a plain,
       retryable message instead. */
    const message = shellI18n(
      "req.assetsError",
      "Unable to load ICT assets. Please try again.",
    );
    select.replaceChildren(new Option(message, ""));
    select.disabled = true;
    if (status) status.textContent = message;
    retry?.classList.remove("d-none");
  } finally {
    _requestAssetsPendingAt = 0;
  }
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(target) || 0;
  let cur = 0;
  const step = Math.max(1, Math.ceil(n / 30));
  const t = setInterval(() => {
    cur = Math.min(cur + step, n);
    el.textContent = cur;
    if (cur >= n) clearInterval(t);
  }, 30);
}
