/* ============================================================
   notifications.js — Bell Dropdown + Full Notification Page
    Smart ICT Maintenance Management System
   ============================================================ */

// ============================================================
// SAFETY NET: Ensure notification visual helpers exist globally
// even if a parsing error occurs later in this file.
// This prevents "getTypeIcon is not defined" errors due to
// caching, network errors, or syntax errors later in the file.
// ============================================================
(function () {
  const FALLBACK_VISUALS = {
    success: { icon: "bi-check-circle", colour: "#16A34A" },
    warning: { icon: "bi-exclamation-triangle", colour: "#D97706" },
    danger: { icon: "bi-exclamation-octagon", colour: "#DC2626" },
    info: { icon: "bi-info-circle", colour: "#2563EB" },
  };

  function getVisual(type) {
    const v =
      (window.NOTIFICATION_VISUALS && window.NOTIFICATION_VISUALS[type]) ||
      (window.NOTIFICATION_TYPE_FALLBACKS &&
        window.NOTIFICATION_TYPE_FALLBACKS[type]) ||
      FALLBACK_VISUALS[type] ||
      FALLBACK_VISUALS.info;
    return v;
  }

  window.getNotificationVisual =
    window.getNotificationVisual ||
    function (type) {
      return getVisual(type);
    };
  window.getTypeIcon =
    window.getTypeIcon ||
    function (type) {
      return getVisual(type).icon;
    };
  window.getTypeColour =
    window.getTypeColour ||
    function (type) {
      return getVisual(type).colour;
    };
  window.getTypeColourSoft =
    window.getTypeColourSoft ||
    function (type) {
      return (
        {
          success: "#DCFCE7",
          warning: "#FEF3C7",
          danger: "#FEE2E2",
          info: "#EFF6FF",
        }[type] || "#EFF6FF"
      );
    };
})();

// ============================================================
// NOTIFICATION VISUAL HELPERS — defined early for global access
// ============================================================
const NOTIFICATION_VISUALS = {
  request_submitted: { icon: "bi-inbox", colour: "#2563EB" },
  request_received: { icon: "bi-inbox", colour: "#2563EB" },
  new_service_request: { icon: "bi-inbox", colour: "#2563EB" },
  new_request_assigned: { icon: "bi-person-check", colour: "#2563EB" },
  technician_assigned: { icon: "bi-person-check", colour: "#2563EB" },
  request_accepted: { icon: "bi-check2-circle", colour: "#16A34A" },
  request_in_progress: { icon: "bi-hourglass-split", colour: "#D97706" },
  request_updated: { icon: "bi-arrow-repeat", colour: "#2563EB" },
  request_status_changed: { icon: "bi-arrow-repeat", colour: "#2563EB" },
  request_completed: { icon: "bi-check2-all", colour: "#16A34A" },
  request_completed_admin: { icon: "bi-check2-all", colour: "#16A34A" },
  request_resolved: { icon: "bi-check2-circle", colour: "#16A34A" },
  request_reopened: { icon: "bi-arrow-counterclockwise", colour: "#D97706" },
  request_reassigned: { icon: "bi-arrow-left-right", colour: "#D97706" },
  request_reassigned_admin: { icon: "bi-arrow-left-right", colour: "#D97706" },
  new_comment: { icon: "bi-chat-left-text", colour: "#2563EB" },
  feedback_available: { icon: "bi-star", colour: "#D97706" },
  priority_changed: { icon: "bi-flag", colour: "#D97706" },
  high_priority_request: { icon: "bi-exclamation-triangle", colour: "#EA580C" },
  critical_request: { icon: "bi-exclamation-octagon", colour: "#DC2626" },
  request_escalated: { icon: "bi-arrow-up-circle", colour: "#EA580C" },
  request_escalated_admin: { icon: "bi-arrow-up-circle", colour: "#EA580C" },
  request_cancelled: { icon: "bi-x-circle", colour: "#DC2626" },
  technician_activity: { icon: "bi-tools", colour: "#2563EB" },
  system_notification: { icon: "bi-info-circle", colour: "#64748B" },
};

const NOTIFICATION_TYPE_FALLBACKS = {
  success: { icon: "bi-check-circle", colour: "#16A34A" },
  warning: { icon: "bi-exclamation-triangle", colour: "#D97706" },
  danger: { icon: "bi-exclamation-octagon", colour: "#DC2626" },
  info: { icon: "bi-info-circle", colour: "#2563EB" },
};

function getNotificationVisual(type) {
  return (
    NOTIFICATION_VISUALS[type] ||
    NOTIFICATION_TYPE_FALLBACKS[type] ||
    NOTIFICATION_TYPE_FALLBACKS.info
  );
}

function getTypeIcon(type) {
  return getNotificationVisual(type).icon;
}

function getTypeColour(type) {
  return getNotificationVisual(type).colour;
}

function getTypeColourSoft(type) {
  return (
    {
      success: "#DCFCE7",
      warning: "#FEF3C7",
      danger: "#FEE2E2",
      info: "#EFF6FF",
    }[type] || "#EFF6FF"
  );
}

/* ============================================================
   MAIN NOTIFICATION LOGIC
   ============================================================ */

/* ── Auto-init on DOMContentLoaded ─────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  await Auth.load();
  if (!requireAuth()) return;

  // Full-page view (admin/notifications.html or technician/notifications.html or user/notifications.html)
  const p = window.location.pathname;
  const isNotificationsPage = p.includes("notifications.html");
  initNotificationBell(false);
  if (isNotificationsPage) {
    initNotificationsPage();
  }
});

/* Restore timers only when the notification list is already loaded for display. */
function restoreExpirationTimers(notifications = []) {
  const expired = getExpiredNotifications();
  for (const notification of notifications) {
    if (
      notification.is_read &&
      !expired.has(notification.id) &&
      !_expirationTimers.has(notification.id)
    ) {
      startExpirationTimer(notification.id);
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   BELL — live badge + dropdown (injected into #notifBellContainer)
   ═══════════════════════════════════════════════════════════ */
function initNotificationBell(refreshCount = true) {
  const container = document.getElementById("notifBellContainer");
  if (!container) return;

  // Inject the bell button + dropdown
  container.innerHTML = `
    <div class="dropdown">
      <button class="btn btn-sm btn-light position-relative border-0 shadow-none p-2"
              id="notifBellBtn" data-bs-toggle="dropdown" aria-expanded="false"
              aria-label="Notifications" title="Notifications" style="background:transparent;"
              onclick="loadBellDropdown()">
        <i class="bi bi-bell fs-5 text-secondary"></i>
        <span id="notifBadge"
              class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
            aria-live="polite" aria-atomic="true"
              style="font-size:.6rem;min-width:18px;display:none;">0</span>
      </button>
      <div class="dropdown-menu dropdown-menu-end shadow border-0 p-0"
           id="notifDropdown"
           style="width:380px;max-height:480px;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <div class="d-flex align-items-center justify-content-between px-3 py-2 border-bottom bg-white">
          <span class="fw-bold small">Notifications</span>
          <div class="d-flex gap-2 align-items-center">
            <label class="d-flex align-items-center gap-1 text-muted mb-0" title="Notification sound">
              <i class="bi bi-volume-up" style="font-size:.75rem;"></i>
              <input class="form-check-input mt-0" type="checkbox" id="notifSoundToggle"
                     aria-label="Notification sound" />
            </label>
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

  const soundToggle = document.getElementById("notifSoundToggle");
  if (soundToggle && window.NotificationSound) {
    soundToggle.checked = window.NotificationSound.isEnabled();
    soundToggle.addEventListener("change", (event) => {
      event.stopPropagation();
      window.NotificationSound.setEnabled(soundToggle.checked);
    });
  }

  if (refreshCount) refreshBellBadge();
}

function renderBellUnreadCount(unread) {
  const count = Number(unread) || 0;
  const badge = document.getElementById("notifBadge");
  const label = document.getElementById("notifUnreadLabel");
  if (badge) {
    badge.textContent = count > 9 ? "9+" : count;
    badge.style.display = count > 0 ? "" : "none";
  }
  if (label) {
    label.textContent = count;
    label.style.display = count > 0 ? "" : "none";
  }
  updateSidebarBadge(count);
  return count;
}

/* NOTE: refreshBellBadge() is defined once in main.js, which is the single
   owner of every notification badge. It was previously duplicated here, and
   because both files declare a global function the one loaded last silently
   won — so on some pages the sidebar badge never updated. Do not re-declare
   it here; add any new badge target to the main.js implementation. */

function updateSidebarBadge(unread) {
  const sidebarBadge = document.getElementById("sidebarNotifBadge");
  if (sidebarBadge) {
    sidebarBadge.textContent = unread > 9 ? "9+" : unread;
    sidebarBadge.style.display = unread > 0 ? "" : "none";
  }
}

function renderNotificationDetailsButton(notification) {
  if (Auth.getUser()?.role !== "ICT Admin") return "";

  const ticketId = String(notification.ticket_id || "").trim();
  const hasTicket = /^[0-9a-f]{24}$/i.test(ticketId);
  const unavailable =
    "Request details are unavailable. The service request may have been removed or is no longer accessible.";

  return `<div class="notif-view-actions">
    <button type="button" class="btn btn-sm btn-outline-primary notif-view-details"
            data-notification-id="${escHtml(notification.id)}"
            data-ticket-id="${escHtml(ticketId)}"
            aria-label="View details for ${escHtml(notification.ticketId || notification.title || "service request")}"
            ${hasTicket ? 'onclick="viewNotificationDetails(event, this)"' : `disabled aria-disabled="true" title="${unavailable}"`}>
      <i class="bi bi-eye me-1" aria-hidden="true"></i>View Details
    </button>
    ${hasTicket ? "" : `<span class="small text-muted" role="status">Request details are unavailable.</span>`}
  </div>`;
}

async function loadBellDropdown() {
  const list = document.getElementById("notifDropList");
  if (!list) return;

  list.innerHTML = `<div class="text-center text-muted py-4 small">
    <div class="spinner-border spinner-border-sm me-1" role="status"></div>Loading…</div>`;

  try {
    const { data, unread } = await apiRequest("/notifications");
    restoreExpirationTimers(data);

    // Update badge
    renderBellUnreadCount(unread);

    if (!data || !data.length) {
      list.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-bell-slash fs-2 d-block mb-2 opacity-50"></i>
          <small>No notifications yet.</small>
        </div>`;
      return;
    }

    list.innerHTML = data
      .slice(0, 10)
      .map(
        (n) => `
      <div class="notif-drop-item p-3 border-bottom ${n.is_read ? "" : "unread"}"
           id="bell-notif-${n.id}"
           data-id="${n.id}"
           data-ticket="${n.ticket_id || ""}"
           role="button" tabindex="0"
           aria-label="${escHtml(n.title)}"
           style="cursor:pointer;transition:background .15s;"
           onclick="openNotif(this)"
           onkeydown="notifBellKeydown(event, this)">
        <div class="d-flex gap-2">
          <div class="flex-shrink-0 mt-1">
            <span class="rounded-circle d-inline-flex align-items-center justify-content-center"
                  style="width:36px;height:36px;background:${getTypeColourSoft(n.type)};">
                  <i class="bi ${getTypeIcon(n.notificationType || n.type)}" style="color:${getTypeColour(n.notificationType || n.type)};font-size:.9rem;"></i>
            </span>
          </div>
          <div class="flex-grow-1 min-w-0">
            <div class="small fw-semibold text-truncate ${n.is_read ? "text-muted" : ""}">${escHtml(n.title)}</div>
            <div class="text-muted text-truncate" style="font-size:.75rem;">${escHtml(n.message)}</div>
            <div class="text-muted" style="font-size:.7rem;">${timeAgo(n.created_at)}</div>
            ${renderNotificationDetailsButton(n)}
          </div>
          ${
            !n.is_read
              ? `<div class="flex-shrink-0 d-flex align-items-center">
                 <span class="notif-dot" style="width:8px;height:8px;border-radius:50%;background:${getTypeColour(n.notificationType || n.type)};display:inline-block;flex-shrink:0;"></span>
               </div>`
              : ""
          }
        </div>
      </div>`,
      )
      .join("");

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
  if (el.classList.contains("unread") === false) return; // already read
  try {
    await apiRequest(`/notifications/${id}/read`, { method: "PATCH" });
    el.classList.remove("unread");
    el.classList.add("read");
    el.querySelector(".notif-dot")?.remove();
    refreshBellBadge();
  } catch (_) {}
}

/* Click a bell item → mark read + take the user to the ticket details */
async function openNotif(el) {
  const id = el.getAttribute("data-id") || "";
  const ticket = el.getAttribute("data-ticket") || "";
  /* Stop notification sound when opened */
  if (
    window.NotificationSound &&
    typeof window.NotificationSound.stopSound === "function"
  ) {
    window.NotificationSound.stopSound();
  }
  await markReadBell(id, el);
  startExpirationTimer(id);
  openNotificationTicket(ticket);
}

async function markAllReadBell(e) {
  e.stopPropagation();
  try {
    await apiRequest("/notifications/read-all", { method: "PATCH" });
    showToast("All notifications marked as read.", "success");
    /* Cancel all expiration timers since all are now read */
    _expirationTimers.forEach((timerId) => clearTimeout(timerId));
    _expirationTimers.clear();
    loadBellDropdown();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

/* ═══════════════════════════════════════════════════════════
   FULL NOTIFICATIONS PAGE
   ═══════════════════════════════════════════════════════════ */
/* One-shot binding: a second markAllReadBtn listener would fire
   PATCH /notifications/read-all twice and clear the timer set twice. */
let _notificationsPageBound = false;

async function initNotificationsPage() {
  /* Guard is set BEFORE the await. Placed after it, two concurrent invocations
     would both suspend on the fetch and then both pass the check, so the
     "one-shot" guarantee would not actually hold. */
  if (_notificationsPageBound) return;
  _notificationsPageBound = true;

  await loadNotificationsPage();

  document
    .getElementById("markAllReadBtn")
    ?.addEventListener("click", async () => {
      try {
        await apiRequest("/notifications/read-all", { method: "PATCH" });
        showToast("All notifications marked as read.", "success");
        /* Cancel all expiration timers since all are now read */
        _expirationTimers.forEach((timerId) => clearTimeout(timerId));
        _expirationTimers.clear();
        await loadNotificationsPage();
      } catch (err) {
        showToast(err.message, "danger");
      }
    });

  document
    .getElementById("filterUnread")
    ?.addEventListener("change", loadNotificationsPage);
}

async function loadNotificationsPage() {
  const container = document.getElementById("notificationsList");
  if (!container) return;

  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner-border text-primary" role="status"></div></div>`;

  try {
    const { data, unread } = await apiRequest("/notifications");
    restoreExpirationTimers(data);
    const filterEl = document.getElementById("filterUnread");
    const filtered = filterEl?.checked ? data.filter((n) => !n.is_read) : data;

    // Update counts
    const countEl = document.getElementById("unreadCount");
    if (countEl)
      countEl.textContent = unread > 0 ? `${unread} unread` : "All read";

    renderBellUnreadCount(unread);

    if (!filtered || !filtered.length) {
      container.innerHTML = `
        <div class="text-center py-5">
          <i class="bi bi-bell-slash fs-1 text-muted d-block mb-3"></i>
          <h6 class="text-muted">${filterEl?.checked ? "No unread notifications." : "No notifications yet."}</h6>
        </div>`;
      return;
    }

    container.innerHTML = filtered
      .map(
        (n) => `
      <div class="notif-card ${n.is_read ? "read" : "unread"}"
           id="notif-${n.id}"
           data-ticket="${n.ticket_id || ""}"
           role="button" tabindex="0"
           aria-label="Open ${escHtml(n.title)}"
           onclick="markReadPage('${n.id}', this)"
           onkeydown="notifCardKeydown(event, '${n.id}', this)">
        <div class="notif-card-body">
          <div class="d-flex align-items-start gap-3">
            <div class="flex-shrink-0 mt-1">
              <span style="width:40px;height:40px;border-radius:50%;background:${getTypeColourSoft(n.type)};
                           display:inline-flex;align-items:center;justify-content:center;">
                <i class="bi ${getTypeIcon(n.notificationType || n.type)}" style="color:${getTypeColour(n.notificationType || n.type)};font-size:1.1rem;"></i>
              </span>
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <h6 class="mb-1 fw-semibold ${n.is_read ? "text-muted" : ""}" style="font-size:.9rem;">
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
              <p class="mb-0 text-muted" style="font-size:.825rem;line-height:1.4;">${escHtml(n.message)}</p>
            </div>
            ${
              !n.is_read
                ? `<div class="flex-shrink-0 mt-2">
                   <span class="notif-dot" style="width:10px;height:10px;border-radius:50%;background:${getTypeColour(n.notificationType || n.type)};display:inline-block;"></span>
                 </div>`
                : ""
            }
          </div>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">${escHtml(err.message)}</div>`;
  }
}

async function markReadPage(id, element) {
  const ticket = element.getAttribute("data-ticket") || "";
  if (element.classList.contains("unread")) {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH" });
      element.classList.remove("unread");
      element.classList.add("read");
      element.querySelectorAll(".notif-dot").forEach((s) => s.remove());
      element.querySelector("h6")?.classList.add("text-muted");
      const unread = await refreshBellBadge();
      const countEl = document.getElementById("unreadCount");
      if (countEl)
        countEl.textContent = unread > 0 ? `${unread} unread` : "All read";
    } catch (_) {}
  }

  /* Stop notification sound when opened */
  if (
    window.NotificationSound &&
    typeof window.NotificationSound.stopSound === "function"
  ) {
    window.NotificationSound.stopSound();
  }
  startExpirationTimer(id);

  /* Open the related ticket using this role's existing detail interface */
  openNotificationTicket(ticket);
}

async function deleteNotif(id, e) {
  e.stopPropagation();
  try {
    await apiRequest(`/notifications/${id}`, { method: "DELETE" });
    document.getElementById(`notif-${id}`)?.remove();
    document.getElementById(`bell-notif-${id}`)?.remove();
    /* Clean up expiration tracking */
    cancelExpirationTimer(id);
    removeExpiredNotification(id);
    refreshBellBadge();
  } catch (err) {
    showToast(err.message, "danger");
  }
}

/* ═══════════════════════════════════════════════════════════
   OPEN THE RELATED TICKET — role-aware. Reuses each role's
   existing detail interface when it exists on the current page,
   otherwise navigates to that role's detail page (which auto-
   opens the ticket). Tickets without a valid related id are
   left alone (legacy notifications never pretend to open). ═══ */
function openNotificationTicket(ticketId) {
  const raw = String(ticketId || "").trim();
  if (!raw || !/^[0-9a-f]{24}$/i.test(raw)) {
    console.warn(
      "Notification has no valid related ticket id; skipping navigation.",
      raw,
    );
    /* Stale or malformed notification (ticket deleted, legacy seed, or no ticket
       reference). Never guess an id — surface a clear message instead so the user
       is not left wondering why nothing happened. */
    if (typeof showToast === "function") {
      showToast(
        "Ticket details are no longer available or you are no longer assigned to this ticket.",
        "warning",
      );
    }
    return;
  }

  const path = window.location.pathname;
  const sessionUser =
    (typeof Auth !== "undefined" && Auth.getUser && Auth.getUser()) || null;
  /* Normalize so a stale/non-canonical role in the session never falls through
     to the wrong role branch (which would silently do nothing or open the wrong
     modal). Roles in main.js are canonical: Requester / Technician / ICT Admin. */
  const role = normalizeRole(sessionUser?.role) || "";

  /* Technician — use the view-ticket modal when present on this page. */
  if (role === "Technician") {
    if (
      document.getElementById("viewTicketBody") &&
      typeof openViewDetails === "function"
    ) {
      openViewDetails(raw);
    } else if (
      document.getElementById("requestDetailBody") &&
      typeof openDetailModal === "function"
    ) {
      openDetailModal(raw);
    } else {
      window.location.href =
        "assigned-requests.html?id=" + encodeURIComponent(raw);
    }
    return;
  }

  /* ICT Admin — use the request info / assign modal when present. */
  if (role === "ICT Admin") {
    if (
      document.getElementById("requestInfoSection") &&
      typeof openAdminRequestModal === "function"
    ) {
      openAdminRequestModal(raw);
    } else if (
      document.getElementById("requestDetailBody") &&
      typeof openDetailModal === "function"
    ) {
      openDetailModal(raw);
    } else {
      window.location.href = "requests.html?id=" + encodeURIComponent(raw);
    }
    return;
  }

  /* Requester / any other authenticated user */
  if (
    document.getElementById("requestDetailBody") &&
    typeof openDetailModal === "function"
  ) {
    openDetailModal(raw);
  } else if (path.includes("/user/")) {
    window.location.href = "tracking.html?id=" + encodeURIComponent(raw);
  } else if (typeof openDetailModal === "function") {
    openDetailModal(raw);
  }
}

async function viewNotificationDetails(event, button) {
  event.preventDefault();
  event.stopPropagation();
  if (button.disabled) return;

  const ticketId = String(button.dataset.ticketId || "").trim();
  const notificationId = button.dataset.notificationId || "";
  const card = button.closest(".notif-card, .notif-drop-item");
  const cardTicketId = String(card?.dataset.ticket || "").trim();
  if (
    !/^[0-9a-f]{24}$/i.test(ticketId) ||
    !notificationId ||
    cardTicketId !== ticketId
  ) {
    showToast(
      "Request details are unavailable. The service request may have been removed or is no longer accessible.",
      "warning",
    );
    return;
  }

  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading request details...';

  const stopSound = () => {
    if (window.NotificationSound?.stopSound) {
      window.NotificationSound.stopSound();
    }
  };

  if (
    document.getElementById("requestInfoSection") &&
    typeof openAdminRequestModal === "function"
  ) {
    stopSound();
    await markReadBell(notificationId, card);
    startExpirationTimer(notificationId);
    await openAdminRequestModal(ticketId);
    button.innerHTML = originalLabel;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    return;
  }

  if (card?.classList.contains("notif-card")) {
    await markReadPage(notificationId, card);
    return;
  }

  if (card?.classList.contains("notif-drop-item")) {
    await openNotif(card);
    return;
  }

  button.innerHTML = originalLabel;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  openNotificationTicket(ticketId);
}

/* Keyboard activation for notification cards (Enter / Space). */
function notifCardKeydown(e, id, el) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    markReadPage(id, el);
  }
}
function notifBellKeydown(e, el) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openNotif(el);
  }
}

/* ════════════════════════════════════════════════════════════
   NOTIFICATION EXPIRATION SYSTEM
   ═══════════════════════════════════════════════════════════
   - After a notification is marked READ, start a 60-second timer
   - After 60 seconds, hide the notification from active list
   - Expired notifications stay in database (not deleted)
   - Unread notifications NEVER expire
   ════════════════════════════════════════════════════════════ */

const EXPIRATION_DELAY_MS = 60000; // 60 seconds
const EXPIRED_NOTIFICATIONS_KEY = "ict_expired_notifications";

let _expirationTimers = new Map(); // notificationId -> timerId

function getExpiredNotificationsKey() {
  const user = Auth.getUser();
  return `${EXPIRED_NOTIFICATIONS_KEY}:${String(user?.id || user?._id || user?.email || "anonymous")}`;
}

function getExpiredNotifications() {
  try {
    const stored = localStorage.getItem(getExpiredNotificationsKey());
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function addExpiredNotification(notificationId) {
  const expired = getExpiredNotifications();
  expired.add(notificationId);
  try {
    localStorage.setItem(
      getExpiredNotificationsKey(),
      JSON.stringify(Array.from(expired)),
    );
  } catch (_) {}
}

function isNotificationExpired(notificationId) {
  return getExpiredNotifications().has(notificationId);
}

function removeExpiredNotification(notificationId) {
  const expired = getExpiredNotifications();
  expired.delete(notificationId);
  try {
    localStorage.setItem(
      getExpiredNotificationsKey(),
      JSON.stringify(Array.from(expired)),
    );
  } catch (_) {}
}

function clearAllExpiredNotifications() {
  try {
    localStorage.removeItem(getExpiredNotificationsKey());
  } catch (_) {}
}

/* Start 60-second expiration timer for a notification that was just marked read */
function startExpirationTimer(notificationId) {
  /* Clear any existing timer for this notification */
  if (_expirationTimers.has(notificationId)) {
    clearTimeout(_expirationTimers.get(notificationId));
  }

  const timerId = setTimeout(() => {
    addExpiredNotification(notificationId);
    _expirationTimers.delete(notificationId);

    /* Refresh UI to hide expired notification */
    if (typeof loadBellDropdown === "function") {
      const dropdown = document.getElementById("notifDropdown");
      if (dropdown && dropdown.classList.contains("show")) {
        loadBellDropdown();
      }
    }
    if (
      typeof loadNotificationsPage === "function" &&
      window.location.pathname.includes("notifications.html")
    ) {
      loadNotificationsPage();
    }
  }, EXPIRATION_DELAY_MS);

  _expirationTimers.set(notificationId, timerId);
}

/* Cancel expiration timer if notification becomes unread again (e.g., manual unread) */
function cancelExpirationTimer(notificationId) {
  if (_expirationTimers.has(notificationId)) {
    clearTimeout(_expirationTimers.get(notificationId));
    _expirationTimers.delete(notificationId);
    removeExpiredNotification(notificationId);
  }
}

/* Check if a notification should be shown in active list */
function isNotificationActive(notification) {
  /* Never hide unread notifications */
  if (!notification.is_read) return true;
  /* Hide expired notifications */
  return !isNotificationExpired(notification.id);
}

/* Filter notifications to show only active ones in dropdown/page */
function filterActiveNotifications(notifications) {
  return notifications.filter(isNotificationActive);
}

/* ── Modified Bell Dropdown Loader ─────────────────────────── */
/* The original loadBellDropdown is kept but we add filtering */
const _originalLoadBellDropdown = loadBellDropdown;
loadBellDropdown = async function () {
  const list = document.getElementById("notifDropList");
  if (!list) return;

  list.innerHTML = `<div class="text-center text-muted py-4 small">
    <div class="spinner-border spinner-border-sm me-1" role="status"></div>Loading…</div>`;

  try {
    const { data, unread } = await apiRequest("/notifications");
    window.__lastNotificationsPayload = { data, unread };
    /* Start the 60s expiry timers for read notifications. Without this they
       stayed in the list forever, since nothing else arms them for rows that
       were already read when the dropdown was rendered. */
    restoreExpirationTimers(data);

    // Update badge
    const badge = document.getElementById("notifBadge");
    const label = document.getElementById("notifUnreadLabel");
    if (badge) {
      badge.textContent = unread > 9 ? "9+" : unread;
      badge.style.display = unread > 0 ? "" : "none";
    }
    if (label) {
      label.textContent = unread;
      label.style.display = unread > 0 ? "" : "none";
    }
    updateSidebarBadge(unread);

    const activeData = filterActiveNotifications(data);

    if (!activeData || !activeData.length) {
      list.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-bell-slash fs-2 d-block mb-2 opacity-50"></i>
          <small>No active notifications.</small>
        </div>`;
      return;
    }

    list.innerHTML = activeData
      .slice(0, 10)
      .map(
        (n) => `
      <div class="notif-drop-item p-3 border-bottom ${n.is_read ? "" : "unread"}"
           id="bell-notif-${n.id}"
           data-id="${n.id}"
           data-ticket="${n.ticket_id || ""}"
           role="button" tabindex="0"
           aria-label="${escHtml(n.title)}"
           style="cursor:pointer;transition:background .15s;"
           onclick="openNotif(this)"
           onkeydown="notifBellKeydown(event, this)">
        <div class="d-flex gap-2">
          <div class="flex-shrink-0 mt-1">
            <span class="rounded-circle d-inline-flex align-items-center justify-content-center"
                  style="width:36px;height:36px;background:${getTypeColourSoft(n.type)};">
                  <i class="bi ${getTypeIcon(n.notificationType || n.type)}" style="color:${getTypeColour(n.notificationType || n.type)};font-size:.9rem;"></i>
            </span>
          </div>
          <div class="flex-grow-1 min-w-0">
            <div class="small fw-semibold text-truncate ${n.is_read ? "text-muted" : ""}">${escHtml(n.title)}</div>
            <div class="text-muted text-truncate" style="font-size:.75rem;">${escHtml(n.message)}</div>
            <div class="text-muted" style="font-size:.7rem;">${timeAgo(n.created_at)}</div>
          </div>
          ${
            !n.is_read
              ? `<div class="flex-shrink-0 d-flex align-items-center">
                 <span class="notif-dot" style="width:8px;height:8px;border-radius:50%;background:${getTypeColour(n.notificationType || n.type)};display:inline-block;flex-shrink:0;"></span>
               </div>`
              : ""
          }
        </div>
      </div>`,
      )
      .join("");

    if (data.length > 10) {
      list.innerHTML += `<div class="text-center py-2 border-top">
        <a href="notifications.html" class="small text-primary text-decoration-none">
          View all ${data.length} notifications →
        </a></div>`;
    }
  } catch (err) {
    list.innerHTML = `<div class="text-center text-danger py-3 small">${escHtml(err.message)}</div>`;
  }
};

/* ── Modified Full Page Loader ─────────────────────────────── */
const _originalLoadNotificationsPage = loadNotificationsPage;
loadNotificationsPage = async function () {
  const container = document.getElementById("notificationsList");
  if (!container) return;

  container.innerHTML = `<div class="text-center py-5">
    <div class="spinner-border text-primary" role="status"></div></div>`;

  try {
    const { data, unread } = await apiRequest("/notifications");
    /* Published so the summary strip in admin/notifications.html can read the
       same payload instead of issuing its own duplicate GET /notifications. */
    window.__lastNotificationsPayload = { data, unread };
    /* Arm the 60s expiry timers for already-read rows. This is the patched
       page loader, which fully replaces the original — the original's call was
       dead code, so read notifications on notifications.html never aged out
       until a full page reload. Runs on the unfiltered list so a hidden
       (expired) row still gets its timer. */
    restoreExpirationTimers(data);
    const filterEl = document.getElementById("filterUnread");
    const allData = filterEl?.checked ? data.filter((n) => !n.is_read) : data;
    const filtered = filterActiveNotifications(allData);

    // Update counts
    const countEl = document.getElementById("unreadCount");
    if (countEl)
      countEl.textContent = unread > 0 ? `${unread} unread` : "All read";

    // Update bell badge on this page too
    refreshBellBadge();

    if (!filtered || !filtered.length) {
      container.innerHTML = `
        <div class="text-center py-5">
          <i class="bi bi-bell-slash fs-1 text-muted d-block mb-3"></i>
          <h6 class="text-muted">${filterEl?.checked ? "No unread notifications." : "No active notifications."}</h6>
        </div>`;
      return;
    }

    container.innerHTML = filtered
      .map(
        (n) => `
      <div class="notif-card ${n.is_read ? "read" : "unread"}"
           id="notif-${n.id}"
           data-ticket="${n.ticket_id || ""}"
           role="button" tabindex="0"
           aria-label="Open ${escHtml(n.title)}"
           onclick="markReadPage('${n.id}', this)"
           onkeydown="notifCardKeydown(event, '${n.id}', this)">
        <div class="notif-card-body">
          <div class="d-flex align-items-start gap-3">
            <div class="flex-shrink-0 mt-1">
              <span style="width:40px;height:40px;border-radius:50%;background:${getTypeColourSoft(n.type)};
                           display:inline-flex;align-items:center;justify-content:center;">
                <i class="bi ${getTypeIcon(n.notificationType || n.type)}" style="color:${getTypeColour(n.notificationType || n.type)};font-size:1.1rem;"></i>
              </span>
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <h6 class="mb-1 fw-semibold ${n.is_read ? "text-muted" : ""}" style="font-size:.9rem;">
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
              <p class="mb-0 text-muted" style="font-size:.825rem;line-height:1.4;">${escHtml(n.message)}</p>
              ${renderNotificationDetailsButton(n)}
            </div>
            ${
              !n.is_read
                ? `<div class="flex-shrink-0 mt-2">
                   <span class="notif-dot" style="width:10px;height:10px;border-radius:50%;background:${getTypeColour(n.notificationType || n.type)};display:inline-block;"></span>
                 </div>`
                : ""
            }
          </div>
        </div>
      </div>`,
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger m-3">${escHtml(err.message)}</div>`;
  }
};

/* ── Modified markReadBell to cancel expiration if manually marked read again ─────── */
const _originalMarkReadBell = markReadBell;
markReadBell = async function (id, el) {
  if (el.classList.contains("unread") === false) return; // already read
  try {
    await apiRequest(`/notifications/${id}/read`, { method: "PATCH" });
    el.classList.remove("unread");
    el.classList.add("read");
    el.querySelector(".notif-dot")?.remove();
    refreshBellBadge();
    /* Cancel any expiration timer since user manually marked read */
    cancelExpirationTimer(id);
  } catch (_) {}
};

/* ── Modified markReadPage to cancel expiration if manually marked read again ─────── */
const _originalMarkReadPage = markReadPage;
markReadPage = async function (id, element) {
  const ticket = element.getAttribute("data-ticket") || "";
  if (element.classList.contains("unread")) {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH" });
      element.classList.remove("unread");
      element.classList.add("read");
      element.querySelectorAll(".notif-dot").forEach((s) => s.remove());
      element.querySelector("h6")?.classList.add("text-muted");
      const unread = await refreshBellBadge();
      const countEl = document.getElementById("unreadCount");
      if (countEl)
        countEl.textContent = unread > 0 ? `${unread} unread` : "All read";
    } catch (_) {}
  }

  /* Stop notification sound when opened */
  if (
    window.NotificationSound &&
    typeof window.NotificationSound.stopSound === "function"
  ) {
    window.NotificationSound.stopSound();
  }
  startExpirationTimer(id);

  /* Open the related ticket using this role's existing detail interface */
  openNotificationTicket(ticket);
};

/* ── Modified deleteNotif to clean up expiration tracking ─────── */
const _originalDeleteNotif = deleteNotif;
deleteNotif = async function (id, e) {
  e.stopPropagation();
  try {
    await apiRequest(`/notifications/${id}`, { method: "DELETE" });
    document.getElementById(`notif-${id}`)?.remove();
    document.getElementById(`bell-notif-${id}`)?.remove();
    /* Clean up expiration tracking */
    cancelExpirationTimer(id);
    removeExpiredNotification(id);
    refreshBellBadge();
  } catch (err) {
    showToast(err.message, "danger");
  }
};
