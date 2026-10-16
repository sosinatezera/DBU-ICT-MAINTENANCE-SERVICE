/* Technician feedback submission and ICT Admin review workflows. */
const FEEDBACK_STATUSES = [
  "Pending",
  "In Progress",
  "Replied",
  "Resolved",
  "Closed",
];
const TECHNICIAN_FEEDBACK_CATEGORIES = [
  "Work Challenges",
  "Equipment Request",
  "Technical Issue",
  "Resource Request",
  "System Improvement",
  "Process Improvement",
  "Suggestion",
  "Other",
];
const FEEDBACK_PRIORITIES = ["Low", "Medium", "High"];
const FEEDBACK_ATTACHMENT_TYPES = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".txt": ["text/plain"],
};

document.addEventListener("DOMContentLoaded", async () => {
  const technicianForm = document.getElementById("technicianFeedbackForm");
  const adminPanel = document.getElementById("feedbackSubmissionManager");
  if (!technicianForm && !adminPanel) return;

  try {
    await Auth.load();
    const user = requireAuth();
    if (!user) return;
    const nameElement = document.getElementById("topUserName");
    if (nameElement) nameElement.textContent = user.fullName || "";
    if (technicianForm && requireRole("Technician")) {
      populateFeedbackIdentity(user);
      initSubmitterFeedbackForm(technicianForm);
      initSubmitterHistory("technicianFeedbackHistory");
    } else if (adminPanel && requireRole("ICT Admin")) {
      initAdminFeedbackManager(adminPanel);
    }
  } catch (err) {
    console.error("Feedback page initialization failed:", err);
    showToast(err.message || "Unable to initialize feedback.", "danger");
  }
});

function populateFeedbackIdentity(user) {
  const name = document.getElementById("technicianFeedbackUser");
  const department = document.getElementById("technicianFeedbackDepartment");
  if (name) name.value = user.fullName || "";
  if (department) department.value = user.department || "";
}

function feedbackEscape(value) {
  return typeof escHtml === "function"
    ? escHtml(String(value ?? ""))
    : String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]);
}

function feedbackDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const timezone =
    window.__ictPrefs && typeof window.__ictPrefs.timezone === "function"
      ? window.__ictPrefs.timezone()
      : undefined;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function feedbackStatusClass(status) {
  return {
    Pending: "text-bg-warning",
    "In Progress": "text-bg-info",
    Replied: "text-bg-primary",
    Resolved: "text-bg-success",
    Closed: "text-bg-secondary",
  }[status] || "text-bg-secondary";
}

function feedbackAttachmentUrl(id) {
  return `${API_BASE}/feedback/submissions/${encodeURIComponent(id)}/attachment`;
}

function showFeedbackNotice(element, message, type = "danger") {
  if (!element) return;
  element.className = `alert alert-${type}`;
  element.textContent = message;
  element.classList.remove("d-none");
}

function setFeedbackButtonBusy(button, busy, originalText) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.setAttribute("aria-busy", "true");
    button.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Submitting...';
  } else {
    button.innerHTML = originalText || button.dataset.originalHtml || "Submit Feedback";
    button.removeAttribute("aria-busy");
    delete button.dataset.originalHtml;
  }
}

function initSubmitterFeedbackForm(form) {
  const categorySelect = document.getElementById("technicianFeedbackCategory");
  const subjectInput = document.getElementById("technicianFeedbackSubject");
  const descriptionInput = document.getElementById("technicianFeedbackMessage");
  const notice = document.getElementById("technicianFeedbackNotice");
  const submitButton = form.querySelector('[data-feedback-submit], [type="submit"]');
  if (!categorySelect || !subjectInput || !descriptionInput || !submitButton) return;
  if (form.dataset.feedbackBound === "true") return;

  TECHNICIAN_FEEDBACK_CATEGORIES.forEach((category) => {
    categorySelect.add(new Option(category, category));
  });
  const historyCategory = document.getElementById("technicianFeedbackHistoryCategory");
  TECHNICIAN_FEEDBACK_CATEGORIES.forEach((category) => {
    if (historyCategory && !Array.from(historyCategory.options).some((option) => option.value === category)) {
      historyCategory.add(new Option(category, category));
    }
  });
  const prioritySelect = document.getElementById("technicianFeedbackPriority");
  FEEDBACK_PRIORITIES.forEach((priority) => {
    if (prioritySelect && !Array.from(prioritySelect.options).some((option) => option.value === priority)) {
      prioritySelect.add(new Option(priority, priority));
    }
  });
  const characterCount = document.getElementById("technicianFeedbackCharacterCount");
  descriptionInput.addEventListener("input", () => {
    if (!characterCount) return;
    characterCount.textContent = `${descriptionInput.value.length.toLocaleString()} / 5,000`;
    characterCount.classList.toggle("is-near-limit", descriptionInput.value.length >= 4500);
  });
  form.dataset.feedbackBound = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    const category = categorySelect.value;
    const subject = subjectInput.value.trim();
    const description = descriptionInput.value.trim();
    if (!category || !subject || !description) {
      showFeedbackNotice(notice, "Choose a category and enter a subject and description.", "warning");
      return;
    }
    if (subject.length > 160 || description.length > 5000) {
      showFeedbackNotice(notice, "Subject must be 160 characters or fewer and description must be 5,000 characters or fewer.", "warning");
      return;
    }
    const priority = document.getElementById("technicianFeedbackPriority")?.value;
    const relatedRequestId = document.getElementById("technicianFeedbackRelatedRequest")?.value.trim();
    if (!FEEDBACK_PRIORITIES.includes(priority)) {
      showFeedbackNotice(notice, "Choose a feedback priority.", "warning");
      return;
    }
    if (relatedRequestId && !/^(?:[0-9a-f]{24}|MAU-\d{4,})$/i.test(relatedRequestId)) {
      showFeedbackNotice(notice, "Enter a valid service request ID, such as MAU-1001.", "warning");
      return;
    }
    const fileInput = form.querySelector('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (file && file.size > 5 * 1024 * 1024) {
      showFeedbackNotice(notice, "Attachment must be 5 MB or smaller.", "warning");
      return;
    }
    if (file) {
      const extension = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
      if (!FEEDBACK_ATTACHMENT_TYPES[extension]?.includes(file.type)) {
        showFeedbackNotice(notice, "Choose a supported image, PDF, Office document, or TXT file.", "warning");
        return;
      }
    }
    const payload = new FormData();
    payload.append("category", category);
    payload.append("subject", subject);
    payload.append("description", description);
    if (relatedRequestId) payload.append("relatedRequestId", relatedRequestId);
    payload.append("priority", priority);
    if (file) payload.append("attachment", file);

    form.dataset.submitting = "true";
    const buttonText = submitButton.innerHTML;
    setFeedbackButtonBusy(submitButton, true);
    notice?.classList.add("d-none");
    try {
      const result = await apiRequest("/feedback/submissions", {
        method: "POST",
        body: payload,
        isFormData: true,
      });
      if (result?.success !== true || !result.data?.id) {
        throw new Error(result?.message || "The feedback was not confirmed as saved.");
      }
      form.reset();
      const user = Auth.getUser();
      if (user) populateFeedbackIdentity(user);
      const count = document.getElementById("technicianFeedbackCharacterCount");
      if (count) count.textContent = "0 / 5,000";
      count?.classList.remove("is-near-limit");
      showFeedbackNotice(
        notice,
        `Feedback ${result.data.feedbackNumber || ""} submitted successfully.`,
        "success",
      );
      await loadSubmitterFeedbackHistory(
        "technicianFeedbackHistory",
      );
    } catch (err) {
      showFeedbackNotice(notice, err.message || "Unable to submit feedback. Please try again.");
    } finally {
      form.dataset.submitting = "false";
      setFeedbackButtonBusy(submitButton, false, buttonText);
    }
  });
}

function initSubmitterHistory(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  initSubmitterHistoryFilters(containerId);
  initSubmitterHistoryPagination(containerId);
  loadSubmitterFeedbackHistory(containerId);
}

function initSubmitterHistoryPagination(containerId) {
  const prefix = "technicianFeedbackHistory";
  const container = document.getElementById(containerId);
  const previous = document.getElementById(`${prefix}Prev`);
  const next = document.getElementById(`${prefix}Next`);
  previous?.addEventListener("click", () => {
    const page = Number(container?.dataset.page || 1);
    if (page > 1) {
      container.dataset.page = String(page - 1);
      loadSubmitterFeedbackHistory(containerId);
    }
  });
  next?.addEventListener("click", () => {
    const page = Number(container?.dataset.page || 1);
    if (page < Number(container?.dataset.totalPages || 1)) {
      container.dataset.page = String(page + 1);
      loadSubmitterFeedbackHistory(containerId);
    }
  });
}

function initSubmitterHistoryFilters(containerId) {
  const container = document.getElementById(containerId);
  const search = document.getElementById("technicianFeedbackHistorySearch");
  const status = document.getElementById("technicianFeedbackHistoryStatus");
  const category = document.getElementById("technicianFeedbackHistoryCategory");
  const from = document.getElementById("technicianFeedbackHistoryFrom");
  const to = document.getElementById("technicianFeedbackHistoryTo");
  if (!container || container.dataset.filtersBound === "true") return;
  container.dataset.filtersBound = "true";
  const priority = document.getElementById("technicianFeedbackHistoryPriority");
  [search, status, category, priority, from, to].filter(Boolean).forEach((filter) => {
    filter.addEventListener(filter === search ? "input" : "change", () => {
      container.dataset.page = "1";
      clearTimeout(container._feedbackSearchTimer);
      container._feedbackSearchTimer = setTimeout(
        () => loadSubmitterFeedbackHistory(containerId),
        filter === search ? 250 : 0,
      );
    });
  });
  container.addEventListener("submit", async (event) => {
    const replyForm = event.target.closest("[data-feedback-reply]");
    if (!replyForm) return;
    event.preventDefault();
    const feedbackId = replyForm.dataset.feedbackReply;
    const input = replyForm.querySelector("textarea");
    const button = replyForm.querySelector("button[type=submit]");
    const message = input?.value.trim() || "";
    if (!message) {
      input?.focus();
      return;
    }
    button.disabled = true;
    try {
      const result = await apiRequest(`/feedback/submissions/${encodeURIComponent(feedbackId)}/replies`, {
        method: "POST",
        body: { message },
      });
      if (result?.success !== true) throw new Error(result?.message || "Reply was not saved.");
      await loadSubmitterFeedbackHistory(containerId);
      showToast("Reply sent successfully.", "success");
    } catch (err) {
      button.disabled = false;
      showToast(err.message || "Unable to send the reply.", "danger");
    }
  });
}

async function loadSubmitterFeedbackHistory(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  container.innerHTML = '<p class="text-muted mb-0">Loading your feedback...</p>';
  try {
    const params = new URLSearchParams({
      page: container.dataset.page || "1",
      limit: "20",
    });
    const search = document.getElementById("technicianFeedbackHistorySearch")?.value.trim();
    const status = document.getElementById("technicianFeedbackHistoryStatus")?.value;
    const priority = document.getElementById("technicianFeedbackHistoryPriority")?.value;
    const category = document.getElementById("technicianFeedbackHistoryCategory")?.value;
    const from = document.getElementById("technicianFeedbackHistoryFrom")?.value;
    const to = document.getElementById("technicianFeedbackHistoryTo")?.value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const result = await apiRequest(`/feedback/submissions/mine?${params.toString()}`);
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load your feedback history.");
    }
    const linkedId = new URLSearchParams(window.location.search).get("feedback");
    if (linkedId && /^[0-9a-f]{24}$/i.test(linkedId) && !result.data.some((item) => String(item._id) === linkedId)) {
      const linked = await apiRequest(`/feedback/submissions/${encodeURIComponent(linkedId)}`);
      if (linked?.success === true && linked.data) result.data.unshift(linked.data);
    }
    const pagination = result.pagination || {};
    const page = pagination.page || 1;
    const totalPages = Math.max(1, pagination.totalPages || 1);
    container.dataset.page = String(page);
    container.dataset.totalPages = String(totalPages);
    const pageInfo = document.getElementById("technicianFeedbackHistoryPageInfo");
    if (pageInfo) {
      const total = pagination.total || 0;
      pageInfo.textContent = `${total} submission${total === 1 ? "" : "s"} · Page ${page} of ${totalPages}`;
    }
    const prefix = "technicianFeedbackHistory";
    const previous = document.getElementById(`${prefix}Prev`);
    const next = document.getElementById(`${prefix}Next`);
    if (previous) previous.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
    Object.entries(result.summary || {}).forEach(([key, value]) => {
      const element = document.querySelector(`[data-own-feedback-stat="${key}"]`);
      if (element) element.textContent = String(value ?? 0);
    });
    renderSubmitterFeedbackHistory(containerId, result.data);
    const id = new URLSearchParams(window.location.search).get("feedback");
    if (id) {
      requestAnimationFrame(() => {
        const card = document.getElementById(`feedback-${id}`);
        if (card) {
          card.querySelector("details")?.setAttribute("open", "");
          card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger mb-0" role="alert">
      <p class="mb-2"><strong>Unable to load your feedback.</strong> ${feedbackEscape(err.message || "Please try again.")}</p>
      <button type="button" class="btn btn-sm btn-outline-danger" data-retry-submitter-feedback>Try again</button>
    </div>`;
    if (!container.dataset.retryBound) {
      container.dataset.retryBound = "true";
      container.addEventListener("click", (event) => {
        if (event.target.closest("[data-retry-submitter-feedback]")) {
          loadSubmitterFeedbackHistory(containerId);
        }
      });
    }
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

function renderSubmitterFeedbackHistory(containerId, records) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const search = (document.getElementById("technicianFeedbackHistorySearch")?.value || "").trim().toLowerCase();
  const status = document.getElementById("technicianFeedbackHistoryStatus")?.value || "";
  const category = document.getElementById("technicianFeedbackHistoryCategory")?.value || "";
  const priority = document.getElementById("technicianFeedbackHistoryPriority")?.value || "";
  const filtered = records.filter((item) => {
    if (status && item.status !== status) return false;
    if (category && item.category !== category) return false;
    if (priority && item.priority !== priority) return false;
    const text = [item.feedbackNumber, item.subject, item.category, item.description]
      .concat((item.messages || []).map((message) => message.message))
      .join(" ")
      .toLowerCase();
    return !search || text.includes(search);
  });
  if (!filtered.length) {
    const hasFilter = Boolean(search || status || category || priority);
    container.innerHTML = `<div class="text-center py-4 text-muted">
      <i class="bi bi-chat-square-text fs-2 d-block mb-2" aria-hidden="true"></i>
      ${hasFilter ? "No feedback matches these filters." : "No feedback submitted yet."}
    </div>`;
    return;
  }
  container.innerHTML = filtered.map((item) => {
    const statusLabel = item.status || "Pending";
    const replies = (item.messages || []).map((entry) => `
      <div class="border-start border-3 ${entry.senderRole === "ICT Admin" ? "border-primary" : "border-secondary"} ps-3 py-2 mb-2">
        <div class="d-flex justify-content-between flex-wrap gap-2">
          <strong class="small">${feedbackEscape(entry.sender?.fullName || entry.senderRole || "Participant")}
            <span class="text-muted fw-normal">· ${feedbackEscape(entry.senderRole || "")}</span></strong>
          <time class="small text-muted">${feedbackEscape(feedbackDate(entry.createdAt))}</time>
        </div>
        <p class="mb-0 mt-1" style="white-space:pre-wrap">${feedbackEscape(entry.message)}</p>
        ${entry.actionTaken ? `<div class="small mt-1"><strong>Action taken:</strong> ${feedbackEscape(entry.actionTaken)}</div>` : ""}
      </div>`).join("");
    const statusHistory = (item.statusHistory || []).map((entry) => `
      <li class="mb-1"><strong>${feedbackEscape(entry.oldStatus || "New")} → ${feedbackEscape(entry.newStatus)}</strong>
        <span class="text-muted">· ${feedbackEscape(feedbackDate(entry.createdAt))}</span>
        ${entry.comment ? `<div>${feedbackEscape(entry.comment)}</div>` : ""}
        ${entry.actionTaken ? `<div><strong>Action taken:</strong> ${feedbackEscape(entry.actionTaken)}</div>` : ""}</li>`).join("");
    const replyForm = statusLabel === "Closed" ? "" : `
      <form class="mt-3" data-feedback-reply="${feedbackEscape(item._id)}">
        <label class="form-label small" for="feedback-reply-${feedbackEscape(item._id)}">Add information or reply</label>
        <textarea class="form-control mb-2" id="feedback-reply-${feedbackEscape(item._id)}" rows="3" maxlength="2000" required></textarea>
        <button class="btn btn-sm btn-outline-primary" type="submit">Send reply</button>
      </form>`;
    const attachment = item.attachment?.storageName
      ? `<a class="small" href="${feedbackEscape(feedbackAttachmentUrl(item._id))}">Download ${feedbackEscape(item.attachment.originalName || "attachment")}</a>`
      : "";
    const relatedRequest = item.relatedRequest?.ticketId || "";
    return `<article id="feedback-${feedbackEscape(item._id)}" class="border rounded-3 p-3 mb-3">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
        <div><div class="small text-muted">${feedbackEscape(item.feedbackNumber || "")} · ${feedbackEscape(item.category || "")}</div>
          <h3 class="h6 fw-bold mb-0">${feedbackEscape(item.subject || "")}</h3>
          <a class="small" href="?feedback=${encodeURIComponent(item._id)}#feedback-${encodeURIComponent(item._id)}">Open details</a></div>
        <span class="badge ${feedbackStatusClass(statusLabel)}">${feedbackEscape(statusLabel)}</span>
      </div>
      <p class="mb-2" style="white-space:pre-wrap">${feedbackEscape(item.description || "")}</p>
      <div class="d-flex flex-wrap justify-content-between gap-2 small text-muted">
        <span>${feedbackEscape(item.sender?.fullName || "You")} · ${feedbackEscape(item.department || item.sender?.department || "Department not provided")}</span>
        <time>Submitted ${feedbackEscape(feedbackDate(item.createdAt))}</time>
        ${item.priority ? `<span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)} priority</span>` : ""}
      </div>
      ${relatedRequest ? `<div class="small mt-2"><strong>Related service request:</strong> ${feedbackEscape(relatedRequest)}</div>` : ""}
      ${attachment ? `<div class="mt-2">${attachment}</div>` : ""}
      <details class="mt-3">
        <summary class="fw-semibold">Conversation (${(item.messages || []).length} ${item.messages?.length === 1 ? "reply" : "replies"})</summary>
        <div class="pt-3">${replies || '<p class="small text-muted">No replies yet.</p>'}
          ${statusHistory ? `<h4 class="small fw-bold mt-3">Status history</h4><ul class="small ps-3">${statusHistory}</ul>` : ""}
          ${replyForm}</div>
      </details>
    </article>`;
  }).join("");
}

function initAdminFeedbackManager(panel) {
  const rows = document.getElementById("feedbackAdminRows");
  if (!rows) return;
  initAdminEvaluationSection();
  populateAdminFeedbackTechnicians();
  const reload = () => {
    adminFeedbackState.page = 1;
    void loadAdminFeedbackSubmissions();
  };
  ["feedbackAdminTechnician", "feedbackAdminRole", "feedbackAdminDepartment", "feedbackAdminStatus", "feedbackAdminCategory", "feedbackAdminPriority", "feedbackAdminReplyStatus", "feedbackAdminFrom", "feedbackAdminTo", "feedbackAdminSort"]
    .forEach((id) => document.getElementById(id)?.addEventListener("change", reload));
  let searchTimer;
  document.getElementById("feedbackAdminSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, 250);
  });
  document.getElementById("feedbackAdminPrev")?.addEventListener("click", () => {
    if (adminFeedbackState.page > 1) {
      adminFeedbackState.page -= 1;
      loadAdminFeedbackSubmissions();
    }
  });
  document.getElementById("feedbackAdminNext")?.addEventListener("click", () => {
    if (adminFeedbackState.page < adminFeedbackState.totalPages) {
      adminFeedbackState.page += 1;
      loadAdminFeedbackSubmissions();
    }
  });
  panel.addEventListener("click", (event) => {
    const evalButton = event.target.closest("[data-admin-eval-open]");
    if (evalButton) {
      void openAdminEvalForm(evalButton.dataset.adminEvalOpen);
      return;
    }
    const button = event.target.closest("[data-open-feedback]");
    if (button) void openAdminFeedbackSubmission(button.dataset.openFeedback);
  });
  const modalBody = document.getElementById("feedbackSubmissionModalBody");
  modalBody?.addEventListener("submit", async (event) => {
    const updateForm = event.target.closest("[data-admin-feedback-update]");
    const replyForm = event.target.closest("[data-admin-feedback-reply]");
    const statusForm = event.target.closest("[data-admin-feedback-status-form]");
    if (!updateForm && !replyForm && !statusForm) return;
    event.preventDefault();
    if (updateForm) {
      const [source, id] = updateForm.dataset.adminFeedbackUpdate.split(":", 2);
      const button = updateForm.querySelector('button[type="submit"]');
      const status = updateForm.querySelector('[name="status"]')?.value || "";
      const response = updateForm.querySelector('[name="response"]')?.value.trim() || "";
      if (button.disabled) return;
      button.disabled = true;
      try {
        const endpoint = source === "requester"
          ? `/requester-feedback/${encodeURIComponent(id)}/review`
          : `/feedback/technician/${encodeURIComponent(id)}`;
        const body = source === "requester"
          ? { status, adminReviewComments: response }
          : { status, reviewComments: response };
        const result = await apiRequest(endpoint, { method: "PATCH", body });
        if (result?.success !== true) throw new Error(result?.message || "Feedback update was not saved.");
        await loadAdminFeedbackSubmissions();
        await openAdminFeedbackSubmission(`${source}:${id}`);
        showToast("Feedback response and status saved.", "success");
      } catch (err) {
        button.disabled = false;
        showToast(err.message || "Unable to save the feedback update.", "danger");
      }
    } else if (replyForm) {
      const message = replyForm.querySelector('[name="replyMessage"]')?.value.trim() || "";
      const actionTaken = replyForm.querySelector('[name="actionTaken"]')?.value.trim() || "";
      const status = replyForm.querySelector('[name="status"]')?.value || "Replied";
      const button = replyForm.querySelector("button[type=submit]");
      if (!message || button.disabled) return;
      if (status === "Closed" && !window.confirm("Close this feedback after sending your reply?")) return;
      button.disabled = true;
      try {
        const result = await apiRequest(`/feedback/submissions/${encodeURIComponent(replyForm.dataset.adminFeedbackReply)}/replies`, {
          method: "POST",
          body: { message, actionTaken, status },
        });
        if (result?.success !== true) throw new Error(result?.message || "Reply was not saved.");
        await openAdminFeedbackSubmission(`submission:${replyForm.dataset.adminFeedbackReply}`);
        await loadAdminFeedbackSubmissions();
        showToast("Reply sent successfully.", "success");
      } catch (err) {
        button.disabled = false;
        showToast(err.message || "Unable to send the reply.", "danger");
      }
    } else {
      const id = statusForm.dataset.adminFeedbackStatusForm;
      const button = statusForm.querySelector("button[type=submit]");
      const status = statusForm.querySelector("select")?.value;
      const comment = statusForm.querySelector('[name="comment"]')?.value.trim() || "";
      const actionTaken = statusForm.querySelector('[name="actionTaken"]')?.value.trim() || "";
      if (status === "Closed" && !window.confirm("Close this feedback? This marks the feedback process complete.")) return;
      button.disabled = true;
      try {
        const result = await apiRequest(`/feedback/submissions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { status, comment, actionTaken },
        });
        if (result?.success !== true) throw new Error(result?.message || "Status update was not saved.");
        await openAdminFeedbackSubmission(`submission:${id}`);
        await loadAdminFeedbackSubmissions();
        showToast("Feedback status updated.", "success");
      } catch (err) {
        button.disabled = false;
        showToast(err.message || "Unable to update feedback status.", "danger");
      }
    }
  });
  loadAdminFeedbackSubmissions().then(() => {
    const id = new URLSearchParams(window.location.search).get("feedback");
    if (id && /^[0-9a-f]{24}$/i.test(id)) void openAdminFeedbackSubmission(`submission:${id}`);
  });
  window.setInterval(() => {
    if (!document.hidden) void loadAdminFeedbackSubmissions();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void loadAdminFeedbackSubmissions();
  });
}

function feedbackPriorityClass(priority) {
  return {
    Low: "text-bg-success",
    Medium: "text-bg-warning",
    High: "text-bg-danger",
  }[priority] || "text-bg-secondary";
}

async function populateAdminFeedbackTechnicians() {
  const select = document.getElementById("feedbackAdminTechnician");
  if (!select) return;
  try {
    const result = await apiRequest("/technicians");
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load technician filters.");
    }
    result.data
      .filter((technician) => technician.user_id && technician.fullName)
      .forEach((technician) => select.add(new Option(technician.fullName, technician.user_id)));
  } catch (err) {
    console.error("Admin feedback technician filters failed to load:", err);
    showToast(err.message || "Unable to load technician filters.", "warning");
  }
}

const adminFeedbackState = {
  page: 1,
  totalPages: 1,
  records: [],
  loadPromise: null,
  reloadRequested: false,
};

async function loadFeedbackPages(path, limit) {
  const records = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await apiRequest(`${path}?page=${page}&limit=${limit}`);
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || `Unable to load feedback from ${path}.`);
    }
    records.push(...result.data);
    totalPages = result.pagination?.totalPages || result.pagination?.pages || 1;
    page += 1;
  } while (page <= totalPages);
  return records;
}

function normalizeAdminFeedback(item, source) {
  const linkedTicketId = (ticket) => {
    if (!ticket) return "";
    if (typeof ticket === "object") return String(ticket._id || ticket.id || "");
    return String(ticket);
  };
  if (source === "requester") {
    const response = item.adminReviewComments || "";
    return {
      source,
      id: String(item._id),
      ticketMongoId: linkedTicketId(item.ticket),
      feedbackNumber: item.ticket?.ticketId || String(item._id).slice(-8),
      senderName: item.requester?.fullName || "Unknown requester",
      senderRole: "Requester",
      department: item.requester?.department || "",
      category: "Service feedback",
      subject: item.ticket?.title || item.ticket?.problemDescription || "Completed maintenance request",
      message: [
        `Problem fixed: ${item.problemFixed}`,
        `Equipment working properly: ${item.equipmentWorkingProperly}`,
        `Technician rating: ${item.technicianRating}/5`,
        `Satisfaction rating: ${item.satisfactionRating}/5`,
        item.comments ? `Comments: ${item.comments}` : "",
        item.improvementSuggestions ? `Improvement suggestions: ${item.improvementSuggestions}` : "",
      ].filter(Boolean).join("\n"),
      status: item.status || "Submitted",
      createdAt: item.createdAt,
      lastReplyAt: response ? item.reviewedAt : null,
      response,
      hasResponse: Boolean(response),
      sourceRecord: item,
    };
  }
  if (source === "technician") {
    const response = item.reviewComments || item.adminResponse || "";
    return {
      source,
      id: String(item._id),
      ticketMongoId: linkedTicketId(item.ticket),
      feedbackNumber: String(item._id).slice(-8),
      senderName: item.technicianName || item.technician?.fullName || "Unknown technician",
      senderRole: "Technician",
      senderId: String(item.technicianId || item.technician?._id || item.technician || ""),
      department: item.technician?.department || "",
      category: item.category || "Technician feedback",
      subject: item.ticket?.title || item.asset?.asset_name || "Technician feedback",
      message: [
        item.description || item.message || "",
        item.recommendation ? `Recommendation: ${item.recommendation}` : "",
        item.followUpRequired === true ? "Follow-up required: Yes" :
          item.followUpRequired === false ? "Follow-up required: No" : "",
      ].filter(Boolean).join("\n"),
      status: item.status || "Submitted",
      createdAt: item.submittedAt || item.createdAt,
      lastReplyAt: response ? item.reviewedAt : null,
      response,
      hasResponse: Boolean(response),
      sourceRecord: item,
    };
  }
  const lastAdminMessage = [...(item.messages || [])].reverse()
    .find((message) => message.senderRole === "ICT Admin");
  return {
    source,
    id: String(item._id),
    ticketMongoId: linkedTicketId(item.ticket),
    feedbackNumber: item.feedbackNumber || String(item._id).slice(-8),
    senderName: item.sender?.fullName || "Unknown technician",
    senderRole: item.senderRole || "Technician",
    senderId: String(item.sender?._id || item.sender || ""),
    department: item.department || item.sender?.department || "",
    category: item.category || "",
    subject: item.subject || "",
    message: item.description || "",
    status: item.status || "Pending",
    priority: item.priority,
    createdAt: item.createdAt,
    lastReplyAt: item.lastReplyAt || lastAdminMessage?.createdAt || null,
    response: lastAdminMessage?.message || "",
    hasResponse: Boolean(lastAdminMessage),
    sourceRecord: item,
  };
}

function filterAdminFeedback(records) {
  const value = (id) => document.getElementById(id)?.value.trim() || "";
  const search = value("feedbackAdminSearch").toLowerCase();
  const technician = value("feedbackAdminTechnician");
  const department = value("feedbackAdminDepartment").toLowerCase();
  const role = value("feedbackAdminRole");
  const status = value("feedbackAdminStatus");
  const category = value("feedbackAdminCategory");
  const priority = value("feedbackAdminPriority");
  const replyStatus = value("feedbackAdminReplyStatus");
  const from = value("feedbackAdminFrom");
  const to = value("feedbackAdminTo");
  const sort = value("feedbackAdminSort");
  const filtered = records.filter((item) => {
    const haystack = [item.feedbackNumber, item.senderName, item.subject, item.category, item.message]
      .join(" ").toLowerCase();
    const date = new Date(item.createdAt || 0);
    const dateText = Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    return (!search || haystack.includes(search)) &&
      (!technician || item.senderId === technician) &&
      (!department || item.department.toLowerCase().includes(department)) &&
      (!role || item.senderRole === role) &&
      (!status || item.status === status) &&
      (!category || item.category === category) &&
      (!priority || item.priority === priority) &&
      (!replyStatus || (replyStatus === "replied" ? item.hasResponse : !item.hasResponse)) &&
      (!from || dateText >= from) && (!to || dateText <= to);
  });
  if (sort === "oldest") filtered.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  else if (sort === "status") filtered.sort((a, b) => a.status.localeCompare(b.status));
  else filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return filtered;
}

async function loadAdminFeedbackSubmissions() {
  const rows = document.getElementById("feedbackAdminRows");
  if (!rows) return;
  if (adminFeedbackState.loadPromise) {
    adminFeedbackState.reloadRequested = true;
    return adminFeedbackState.loadPromise;
  }
  const errorAlert = document.getElementById("feedbackAdminLoadError");
  const errorMessage = document.getElementById("feedbackAdminLoadErrorMessage");
  errorAlert?.classList.add("d-none");
  if (errorMessage) errorMessage.textContent = "";
  rows.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2" role="status" aria-label="Loading"></span>Loading feedback submissions...</td></tr>';
  adminFeedbackState.loadPromise = (async () => {
   try {
    const [requesterItems, technicianItems, submissionItems] = await Promise.all([
      loadFeedbackPages("/requester-feedback/admin", 100),
      apiRequest("/feedback/technician").then((result) => {
        if (result?.success !== true || !Array.isArray(result.data)) throw new Error(result?.message || "Unable to load technician feedback.");
        return result.data;
      }),
      loadFeedbackPages("/feedback/submissions/admin", 50),
    ]);
    const records = [
      ...requesterItems.map((item) => normalizeAdminFeedback(item, "requester")),
      ...technicianItems.map((item) => normalizeAdminFeedback(item, "technician")),
      ...submissionItems.map((item) => normalizeAdminFeedback(item, "submission")),
    ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    adminFeedbackState.records = records;
    const categories = [...new Set(records.map((item) => item.category).filter(Boolean))].sort();
    const categorySelect = document.getElementById("feedbackAdminCategory");
    if (categorySelect) {
      categories.forEach((category) => {
        if (!Array.from(categorySelect.options).some((option) => option.value === category)) {
          categorySelect.add(new Option(category, category));
        }
      });
    }
    const count = (predicate) => records.filter(predicate).length;
    const statusCounts = {
      total: records.length,
      pending: count((item) => ["Pending", "Submitted"].includes(item.status)),
      inProgress: count((item) => ["In Progress", "Under Review", "Action Required", "Follow-up Required"].includes(item.status)),
      replied: count((item) => ["Replied", "Responded"].includes(item.status) || item.hasResponse),
      resolved: count((item) => ["Resolved", "Reviewed"].includes(item.status)),
      closed: count((item) => item.status === "Closed"),
      technicians: count((item) => item.senderRole === "Technician"),
      requesters: count((item) => item.senderRole === "Requester"),
    };
    Object.entries(statusCounts).forEach(([key, value]) => {
      const element = document.querySelector(`[data-feedback-stat="${key}"]`);
      if (element) element.textContent = String(value);
    });

    const filtered = filterAdminFeedback(records);
    const pageSize = 20;
    adminFeedbackState.totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    adminFeedbackState.page = Math.min(adminFeedbackState.page, adminFeedbackState.totalPages);
    const pageRecords = filtered.slice((adminFeedbackState.page - 1) * pageSize, adminFeedbackState.page * pageSize);
    const first = filtered.length ? (adminFeedbackState.page - 1) * pageSize + 1 : 0;
    const last = Math.min(filtered.length, adminFeedbackState.page * pageSize);
    document.getElementById("feedbackAdminPageInfo").textContent = `Showing ${first}–${last} of ${filtered.length}`;
    document.getElementById("feedbackAdminPrev").disabled = adminFeedbackState.page <= 1;
    document.getElementById("feedbackAdminNext").disabled = adminFeedbackState.page >= adminFeedbackState.totalPages;
    rows.innerHTML = pageRecords.length
      ? pageRecords.map((item) => `<tr>
          <td class="text-nowrap"><strong>${feedbackEscape(item.feedbackNumber || item.id)}</strong></td>
          <td>${feedbackEscape(item.senderName || "Unknown sender")}</td>
          <td><span class="badge ${item.senderRole === "Requester" ? "text-bg-secondary" : "text-bg-info"}">${feedbackEscape(item.senderRole)}</span></td>
          <td>${feedbackEscape(item.department || "—")}</td>
          <td>${feedbackEscape(item.category || "—")}<div class="fw-semibold">${feedbackEscape(item.subject || "")}</div></td>
          <td class="feedback-message-cell">${feedbackEscape(item.message || "—")}</td>
          <td>${item.priority ? `<span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)}</span>` : "—"}</td>
          <td class="text-nowrap">${feedbackEscape(feedbackDate(item.createdAt))}</td>
          <td class="text-nowrap">${item.lastReplyAt ? feedbackEscape(feedbackDate(item.lastReplyAt)) : '<span class="text-muted">No replies</span>'}</td>
          <td><span class="badge ${feedbackStatusClass(item.status)}">${feedbackEscape(item.status || "Pending")}</span></td>
          <td class="text-nowrap">
            <button class="btn btn-sm btn-outline-primary" type="button" data-open-feedback="${feedbackEscape(item.source)}:${feedbackEscape(item.id)}">View / respond</button>
            ${item.ticketMongoId ? `<button class="btn btn-sm btn-outline-secondary ms-1" type="button" data-admin-eval-open="${feedbackEscape(item.ticketMongoId)}">Evaluate Admin Feedback</button>` : ""}
          </td>
        </tr>`).join("")
      : '<tr><td colspan="11" class="text-center text-muted py-4">No feedback matches these filters.</td></tr>';
   } catch (err) {
    rows.innerHTML = "";
    if (errorMessage) {
          errorMessage.textContent = `Unable to load feedback: ${err.message || "Please try again."}`;
    }
    errorAlert?.classList.remove("d-none");
    document.getElementById("feedbackAdminPageInfo").textContent =
          "Feedback list unavailable.";
    document.getElementById("feedbackAdminPrev").disabled = true;
    document.getElementById("feedbackAdminNext").disabled = true;
   } finally {
    adminFeedbackState.loadPromise = null;
    if (adminFeedbackState.reloadRequested) {
      adminFeedbackState.reloadRequested = false;
      void loadAdminFeedbackSubmissions();
    }
   }
  })();
  return adminFeedbackState.loadPromise;
}

document.getElementById("feedbackAdminRetry")?.addEventListener("click", () => {
  void loadAdminFeedbackSubmissions();
});

async function openAdminFeedbackSubmission(id) {
  const body = document.getElementById("feedbackSubmissionModalBody");
  if (!body) return;
  const [source, recordId] = String(id).includes(":")
    ? String(id).split(":", 2)
    : ["submission", String(id)];
  if (source !== "submission") {
    const item = adminFeedbackState.records.find((record) => record.source === source && record.id === recordId);
    if (!item) {
      showFeedbackNotice(body, "This feedback record is not available in the current list. Refresh and try again.");
      return;
    }
    const statuses = source === "requester"
      ? ["Submitted", "Reviewed", "Follow-up Required"]
      : ["Submitted", "Under Review", "Action Required", "Resolved"];
    document.getElementById("feedbackSubmissionModalTitle").textContent =
      `${item.feedbackNumber} · ${item.subject}`;
    body.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between gap-2 mb-3">
        <div><span class="badge ${feedbackStatusClass(item.status)}">${feedbackEscape(item.status)}</span>
          <span class="badge ${item.senderRole === "Requester" ? "text-bg-secondary" : "text-bg-info"}">${feedbackEscape(item.senderRole)}</span></div>
        <span class="small text-muted">Submitted ${feedbackEscape(feedbackDate(item.createdAt))}</span>
      </div>
      <dl class="row small">
        <dt class="col-sm-3">Submitter</dt><dd class="col-sm-9">${feedbackEscape(item.senderName)}</dd>
        <dt class="col-sm-3">Category</dt><dd class="col-sm-9">${feedbackEscape(item.category)}</dd>
        <dt class="col-sm-3">Subject</dt><dd class="col-sm-9">${feedbackEscape(item.subject)}</dd>
      </dl>
      <section class="border rounded p-3 mb-3">
        <h3 class="h6 fw-bold">Feedback</h3>
        <p class="mb-0" style="white-space:pre-wrap">${feedbackEscape(item.message)}</p>
      </section>
      ${item.response ? `<section class="border-start border-3 border-primary ps-3 mb-3">
        <h3 class="h6 fw-bold">Admin response</h3><p class="mb-0" style="white-space:pre-wrap">${feedbackEscape(item.response)}</p>
      </section>` : ""}
      <form class="border-top pt-3" data-admin-feedback-update="${feedbackEscape(source)}:${feedbackEscape(recordId)}">
        <label class="form-label small" for="admin-feedback-unified-status">Status</label>
        <select class="form-select form-select-sm mb-2" id="admin-feedback-unified-status" name="status">
          ${statuses.map((status) => `<option${status === item.status ? " selected" : ""}>${feedbackEscape(status)}</option>`).join("")}
        </select>
        <label class="form-label small" for="admin-feedback-unified-response">Response for submitter</label>
        <textarea class="form-control mb-2" id="admin-feedback-unified-response" name="response" rows="3" maxlength="2000">${feedbackEscape(item.response)}</textarea>
        <button class="btn btn-primary btn-sm" type="submit">Save response and status</button>
      </form>`;
    const modalElement = document.getElementById("feedbackSubmissionModal");
    if (window.bootstrap?.Modal && modalElement) {
      window.bootstrap.Modal.getOrCreateInstance(modalElement).show();
    }
    return;
  }
  id = recordId;
  body.innerHTML = '<div class="text-center py-4"><span class="spinner-border" role="status"></span><span class="visually-hidden">Loading feedback details...</span></div>';
  const modalElement = document.getElementById("feedbackSubmissionModal");
  if (window.bootstrap?.Modal && modalElement) {
    window.bootstrap.Modal.getOrCreateInstance(modalElement).show();
  }
  try {
    const result = await apiRequest(`/feedback/submissions/${encodeURIComponent(id)}`);
    if (result?.success !== true || !result.data) throw new Error(result?.message || "Unable to load feedback.");
    const item = result.data;
    document.getElementById("feedbackSubmissionModalTitle").textContent =
      `${item.feedbackNumber || "Feedback"} · ${item.subject || ""}`;
    const messages = (item.messages || []).map((entry) => `
      <div class="border-start border-3 ${entry.senderRole === "ICT Admin" ? "border-primary" : "border-secondary"} ps-3 py-2 mb-2">
        <div class="d-flex justify-content-between flex-wrap gap-2">
          <strong class="small">${feedbackEscape(entry.sender?.fullName || entry.senderRole || "Participant")}
            <span class="text-muted fw-normal">· ${feedbackEscape(entry.senderRole || "")}</span></strong>
          <time class="small text-muted">${feedbackEscape(feedbackDate(entry.createdAt))}</time>
        </div><p class="mb-0 mt-1" style="white-space:pre-wrap">${feedbackEscape(entry.message)}</p>
        ${entry.actionTaken ? `<div class="small mt-1"><strong>Action taken:</strong> ${feedbackEscape(entry.actionTaken)}</div>` : ""}
      </div>`).join("");
    const history = (item.statusHistory || []).map((entry) => `
      <li class="mb-1"><strong>${feedbackEscape(entry.oldStatus || "New")} → ${feedbackEscape(entry.newStatus)}</strong>
        <span class="text-muted">by ${feedbackEscape(entry.changedBy?.fullName || entry.changedBy?.role || "System")}
        · ${feedbackEscape(feedbackDate(entry.createdAt))}</span>
        ${entry.comment ? `<div>${feedbackEscape(entry.comment)}</div>` : ""}
        ${entry.actionTaken ? `<div><strong>Action taken:</strong> ${feedbackEscape(entry.actionTaken)}</div>` : ""}</li>`).join("");
    body.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between gap-2 mb-3">
        <div><span class="badge ${feedbackStatusClass(item.status)}">${feedbackEscape(item.status)}</span>
          <span class="badge text-bg-info">Technician</span></div>
        <span class="small text-muted">Submitted ${feedbackEscape(feedbackDate(item.createdAt))}</span>
      </div>
      <dl class="row small">
        <dt class="col-sm-3">Sender</dt><dd class="col-sm-9">${feedbackEscape(item.sender?.fullName || "Unknown")}
          ${item.sender?.email ? `· ${feedbackEscape(item.sender.email)}` : ""}</dd>
        <dt class="col-sm-3">Department</dt><dd class="col-sm-9">${feedbackEscape(item.department || item.sender?.department || "Not provided")}</dd>
        <dt class="col-sm-3">Category</dt><dd class="col-sm-9">${feedbackEscape(item.category)}</dd>
        <dt class="col-sm-3">Subject</dt><dd class="col-sm-9">${feedbackEscape(item.subject)}</dd>
        ${item.priority ? `<dt class="col-sm-3">Priority</dt><dd class="col-sm-9"><span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)}</span></dd>` : ""}
        ${item.relatedRequest ? `<dt class="col-sm-3">Related service request</dt><dd class="col-sm-9">${feedbackEscape(item.relatedRequest.ticketId || item.relatedRequest._id)}</dd>` : ""}
      </dl>
      <section class="border rounded p-3 mb-3">
        <h3 class="h6 fw-bold">Original description</h3>
        <p class="mb-0" style="white-space:pre-wrap">${feedbackEscape(item.description)}</p>
      </section>
      ${item.attachment?.storageName ? `<p><a href="${feedbackEscape(feedbackAttachmentUrl(item._id))}">Download ${feedbackEscape(item.attachment.originalName || "attachment")}</a></p>` : ""}
      <section class="mb-4"><h3 class="h6 fw-bold">Conversation</h3>
        ${messages || '<p class="small text-muted">No replies yet.</p>'}
        <form class="mt-3" data-admin-feedback-reply="${feedbackEscape(item._id)}">
          <label class="form-label small" for="admin-feedback-reply">Reply to sender</label>
          <textarea class="form-control mb-2" id="admin-feedback-reply" name="replyMessage" rows="3" maxlength="2000" required></textarea>
          <label class="form-label small" for="admin-feedback-reply-action">Action taken (optional)</label>
          <textarea class="form-control mb-2" id="admin-feedback-reply-action" name="actionTaken" rows="2" maxlength="2000"></textarea>
          <label class="form-label small" for="admin-feedback-reply-status">Status</label>
          <select class="form-select form-select-sm mb-2" id="admin-feedback-reply-status" name="status">
            ${["In Progress", "Replied", "Resolved", "Closed"].map((status) =>
              `<option${status === (item.status === "Pending" ? "Replied" : item.status) ? " selected" : ""}>${feedbackEscape(status)}</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm" type="submit">Send reply</button>
        </form>
      </section>
      <section class="border-top pt-3">
        <h3 class="h6 fw-bold">Status history</h3>
        ${history ? `<ul class="small ps-3 mb-3">${history}</ul>` : '<p class="small text-muted">No status changes recorded.</p>'}
        <form class="row g-2 align-items-end" data-admin-feedback-status-form="${feedbackEscape(item._id)}">
          <div class="col-sm-5"><label class="form-label small" for="admin-feedback-status">Update status</label>
            <select class="form-select form-select-sm" id="admin-feedback-status">${FEEDBACK_STATUSES.map((status) =>
              `<option${status === item.status ? " selected" : ""}>${feedbackEscape(status)}</option>`).join("")}</select></div>
          <div class="col-sm-5"><label class="form-label small" for="admin-feedback-status-note">Status note (optional)</label>
            <textarea class="form-control form-control-sm" id="admin-feedback-status-note" name="comment" rows="1" maxlength="2000"></textarea></div>
          <div class="col-sm-5"><label class="form-label small" for="admin-feedback-status-action">Action taken (optional)</label>
            <textarea class="form-control form-control-sm" id="admin-feedback-status-action" name="actionTaken" rows="1" maxlength="2000"></textarea></div>
          <div class="col-sm-2"><button class="btn btn-outline-primary btn-sm w-100" type="submit">Save</button></div>
        </form>
      </section>`;
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger mb-0" role="alert">
      Unable to load feedback details: ${feedbackEscape(err.message || "Please try again.")}
    </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   ADMIN FEEDBACK EVALUATION
   Dedicated evaluation form + Admin Evaluations table on the
   Feedback page. ICT Admin only (wired from
   initAdminFeedbackManager, which requireRole gates).
   Saves through POST/PUT /tickets/:id/admin-feedback — the
   reviewer identity and feedback date come from the server.
   ═══════════════════════════════════════════════════════════ */
const ADMIN_EVAL_DECISIONS = ["Approved", "Needs Correction", "Rejected"];
const ADMIN_EVAL_RATINGS = ["Excellent", "Good", "Fair", "Poor"];
const ADMIN_EVAL_STATUSES = ["Pending", "Reviewed", "Pending Correction", "Resolved"];
const ADMIN_EVAL_FIELD_IDS = [
  "afeDecision",
  "afeWorkQuality",
  "afeTechnicalAccuracy",
  "afeRepairEffectiveness",
  "afeReportCompleteness",
  "afeSafetyCompliance",
  "afeAdminComment",
  "afeRecommendation",
  "afeFollowUpNotes",
];

const adminEvalState = {
  page: 1,
  totalPages: 1,
  pageSize: 20,
  loadPromise: null,
  reloadRequested: false,
  candidates: [],
  candidatesPromise: null,
  candidatesLoaded: false,
  mode: "create",
  currentTicketId: null,
  currentHasEvaluation: false,
  hasTechnicianReport: false,
  detailLoaded: false,
  detailError: false,
  submitting: false,
  bound: false,
};

function adminEvalEl(id) {
  return document.getElementById(id);
}

function adminEvalDecisionClass(decision) {
  return {
    Approved: "text-bg-success",
    "Needs Correction": "text-bg-warning text-dark",
    Rejected: "text-bg-danger",
  }[decision] || "text-bg-secondary";
}

function adminEvalStatusBadge(status) {
  const classes = {
    Pending: "text-bg-warning",
    Reviewed: "text-bg-success",
    "Pending Correction": "text-bg-danger",
    Resolved: "text-bg-info",
  };
  const label = status || "Pending";
  return `<span class="badge ${classes[label] || "text-bg-secondary"}">${feedbackEscape(label)}</span>`;
}

function showAdminEvalNotice(message, type = "danger") {
  const alert = adminEvalEl("adminEvalAlert");
  if (!alert) return;
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alert.classList.remove("d-none");
}

function hideAdminEvalNotice() {
  adminEvalEl("adminEvalAlert")?.classList.add("d-none");
}

function setAdminEvalFieldError(fieldId, message) {
  const field = adminEvalEl(fieldId);
  const error = adminEvalEl(`${fieldId}Error`);
  field?.classList.toggle("is-invalid", Boolean(message));
  if (error) {
    error.textContent = message || "";
    error.classList.toggle("d-none", !message);
  }
}

function clearAdminEvalErrors() {
  const form = adminEvalEl("adminEvalForm");
  if (!form) return;
  ADMIN_EVAL_FIELD_IDS.forEach((id) => setAdminEvalFieldError(id, ""));
  setAdminEvalFieldError("afeRequestSelect", "");
  setAdminEvalFieldError("afeTechnicianReport", "");
  form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  form.querySelectorAll(".invalid-feedback").forEach((el) => {
    el.textContent = "";
    el.classList.add("d-none");
  });
}

function resetAdminEvalEvaluationFields() {
  ADMIN_EVAL_FIELD_IDS.forEach((id) => {
    const el = adminEvalEl(id);
    if (el) el.value = "";
  });
  const status = adminEvalEl("afeFeedbackStatus");
  if (status) status.value = "Pending";
  const followUp = adminEvalEl("afeFollowUpRequired");
  if (followUp) followUp.value = "No";
  adminEvalEl("afeFollowUpWrap")?.classList.add("d-none");
  clearAdminEvalErrors();
}

/* Every reason the current form cannot be saved yet, using the same rules the
   submit-time validator enforces. Returns [] when the form is savable. The
   messages here drive the field-level feedback shown by validateAdminEvalForm. */
function adminEvalRequiredFieldIssues() {
  const issues = [];
  const select = adminEvalEl("afeRequestSelect");
  const ticketId = select?.value || "";
  if (!ticketId) {
    issues.push({
      id: "afeRequestSelect",
      label: "Maintenance Request ID",
      message: "Select a maintenance request.",
    });
  } else if (!adminEvalState.detailLoaded) {
    issues.push({
      id: "afeRequestSelect",
      label: "Maintenance Request ID",
      message: "Wait for the maintenance request and technician report to finish loading.",
    });
  } else if (
    !adminEvalState.hasTechnicianReport &&
    !adminEvalState.currentHasEvaluation
  ) {
    issues.push({
      id: "afeTechnicianReport",
      label: "Completed technician report",
      message: "A completed technician maintenance report is required before an evaluation can be saved.",
    });
  }

  const decision = adminEvalEl("afeDecision")?.value || "";
  if (!ADMIN_EVAL_DECISIONS.includes(decision)) {
    issues.push({
      id: "afeDecision",
      label: "Review Decision",
      message: "Choose a review decision.",
    });
  }

  const workQuality = adminEvalEl("afeWorkQuality")?.value || "";
  if (!ADMIN_EVAL_RATINGS.includes(workQuality)) {
    issues.push({
      id: "afeWorkQuality",
      label: "Work Quality",
      message: "Choose a work quality rating.",
    });
  }

  const adminComment = (adminEvalEl("afeAdminComment")?.value || "").trim();
  if (!adminComment) {
    issues.push({
      id: "afeAdminComment",
      label: "Admin Comments",
      message:
        decision === "Rejected"
          ? "Explain why the technician report was rejected."
          : "Admin comments are required.",
    });
  }

  const recommendation = (adminEvalEl("afeRecommendation")?.value || "").trim();
  const followUpNotes = (adminEvalEl("afeFollowUpNotes")?.value || "").trim();
  if (decision === "Needs Correction" && !recommendation && !followUpNotes) {
    issues.push({
      id: "afeRecommendation",
      label: "Recommendation or Follow-up Action",
      message: "Provide a corrective action or recommendation for a report that needs correction.",
    });
  }
  if (adminEvalEl("afeFollowUpRequired")?.value === "Yes" && !followUpNotes) {
    issues.push({
      id: "afeFollowUpNotes",
      label: "Follow-up Action",
      message: "Describe the follow-up action that is required.",
    });
  }

  return issues;
}

/* The single blocking reason shown next to a disabled Save button. Kept short
   so it fits in the modal footer; the full explanation stays in the report box. */
function adminEvalSaveBlockReason() {
  if (adminEvalState.submitting) return "Saving evaluation…";
  if (adminEvalState.mode === "view") return "";

  const ticketId = adminEvalEl("afeRequestSelect")?.value || "";
  if (!ticketId) return "Select a maintenance request to evaluate.";
  if (!adminEvalState.detailLoaded) {
    return adminEvalState.detailError
      ? "The maintenance request could not be loaded."
      : "Loading the maintenance request…";
  }
  if (!adminEvalState.hasTechnicianReport && !adminEvalState.currentHasEvaluation) {
    return "A completed technician report is required before saving.";
  }

  const missing = adminEvalRequiredFieldIssues()
    .filter(
      (issue) =>
        issue.id !== "afeRequestSelect" && issue.id !== "afeTechnicianReport",
    )
    .map((issue) => issue.label);
  if (missing.length) {
    return `Complete the required fields: ${missing.join(", ")}.`;
  }
  return "";
}

function updateAdminEvalSaveAvailability() {
  const saveButton = adminEvalEl("afeSaveBtn");
  if (!saveButton) return;
  const viewOnly = adminEvalState.mode === "view";
  const reason = adminEvalSaveBlockReason();
  saveButton.disabled = viewOnly || Boolean(reason);
  saveButton.title = reason || "";
  const hint = adminEvalEl("afeSaveHint");
  if (hint) {
    hint.textContent = viewOnly ? "" : reason;
    hint.classList.toggle("d-none", viewOnly || !reason);
  }
}

function setAdminEvalMode(mode) {
  adminEvalState.mode = mode;
  const viewOnly = mode === "view";
  const form = adminEvalEl("adminEvalForm");
  if (form) {
    form
      .querySelectorAll("select, textarea, input:not([readonly])")
      .forEach((el) => {
        el.disabled =
          viewOnly || (el.id === "afeRequestSelect" && mode !== "create");
      });
    form.querySelectorAll("input[readonly]").forEach((el) => {
      el.disabled = viewOnly;
    });
  }
  adminEvalEl("afeSaveBtn")?.classList.toggle("d-none", viewOnly);
  adminEvalEl("afeEditBtn")?.classList.toggle("d-none", !viewOnly);
  const saveLabel = adminEvalEl("afeSaveLabel");
  if (saveLabel) {
    saveLabel.textContent = mode === "edit" ? "Update Evaluation" : "Save Evaluation";
  }
  updateAdminEvalSaveAvailability();
}

function renderTechnicianReportSummary(report) {
  if (!report) {
    return '<span class="text-danger">No technician maintenance report is available for this request yet. A completed technician report is required before an evaluation can be saved.</span>';
  }
  const row = (label, value) =>
    value
      ? `<div class="mb-1"><span class="fw-semibold">${feedbackEscape(label)}:</span> <span style="white-space:pre-wrap">${feedbackEscape(value)}</span></div>`
      : "";
  const body = [
    row("Diagnosis", report.diagnosis),
    row("Work performed", report.workPerformed),
    row("Parts used", report.partsUsed),
    row("Resolution", report.resolution),
    row("Repair result", report.repairResult),
    row("Status", report.status),
    row("Recommendation", report.recommendation),
  ].join("");
  return `<div class="small">${body || '<div class="text-muted">The technician report has no written summary.</div>'}
    <div class="text-muted mt-1">Reported by ${feedbackEscape(report.technician_name || "the assigned technician")}${report.submittedAt ? ` · ${feedbackEscape(feedbackDate(report.submittedAt))}` : ""}</div>
  </div>`;
}

function ensureAdminEvalOption(ticket) {
  const select = adminEvalEl("afeRequestSelect");
  if (!select || !ticket?.id) return;
  const id = String(ticket.id);
  if (!Array.from(select.options).some((option) => option.value === id)) {
    const label = ticket.ticketId
      ? `${ticket.ticketId} — ${ticket.title || ticket.deviceLabel || "Maintenance request"}`
      : `Maintenance request ${id}`;
    select.add(new Option(label, id), 1);
  }
}

function renderAdminEvalCandidates() {
  const select = adminEvalEl("afeRequestSelect");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  if (!adminEvalState.candidates.length) {
    select.add(new Option("No maintenance requests with a technician report yet", ""));
    select.disabled = true;
    return;
  }
  select.add(new Option("Select a maintenance request", ""));
  adminEvalState.candidates.forEach((ticket) => {
    const label = `${ticket.ticketId || ticket.id} — ${ticket.title || ticket.deviceLabel || "Maintenance request"}${ticket.has_admin_feedback ? " (evaluated)" : ""}`;
    select.add(new Option(label, String(ticket.id)));
  });
  if (previous) select.value = previous;
}

async function loadAdminEvalCandidates() {
  if (adminEvalState.candidatesPromise) return adminEvalState.candidatesPromise;
  if (adminEvalState.candidatesLoaded) return adminEvalState.candidates;
  adminEvalState.candidatesPromise = (async () => {
    const select = adminEvalEl("afeRequestSelect");
    try {
      const result = await apiRequest("/tickets");
      if (result?.success !== true || !Array.isArray(result.data)) {
        throw new Error(result?.message || "Unable to load maintenance requests.");
      }
      adminEvalState.candidates = result.data.filter(
        (ticket) => ticket.has_technician_feedback,
      );
      adminEvalState.candidatesLoaded = true;
      renderAdminEvalCandidates();
      return adminEvalState.candidates;
    } catch (err) {
      if (select) {
        select.replaceChildren(new Option("Unable to load maintenance requests.", ""));
        select.disabled = true;
      }
      throw err;
    } finally {
      adminEvalState.candidatesPromise = null;
    }
  })();
  return adminEvalState.candidatesPromise;
}

async function loadAdminEvalDetail(ticketId) {
  const reportBox = adminEvalEl("afeTechnicianReport");
  adminEvalState.detailLoaded = false;
  adminEvalState.detailError = false;
  adminEvalState.hasTechnicianReport = false;
  adminEvalState.currentHasEvaluation = false;
  adminEvalState.currentTicketId = null;
  if (reportBox) {
    reportBox.textContent = "Loading maintenance request and technician report…";
  }
  try {
    const result = await apiRequest(`/tickets/${encodeURIComponent(ticketId)}`);
    if (result?.success !== true || !result.data) {
      throw new Error(result?.message || "Unable to load the maintenance request.");
    }
    const select = adminEvalEl("afeRequestSelect");
    if (select && select.value && select.value !== String(ticketId)) return false;
    const ticket = result.data;
    adminEvalState.currentTicketId = String(ticketId);
    adminEvalState.hasTechnicianReport = Boolean(ticket.technician_feedback);
    adminEvalState.currentHasEvaluation = Boolean(ticket.admin_feedback);
    adminEvalState.detailLoaded = true;
    adminEvalState.detailError = false;

    const ticketIdField = adminEvalEl("afeTicketId");
    if (ticketIdField) ticketIdField.value = ticket.ticketId || ticket.id || String(ticketId);
    const equipmentField = adminEvalEl("afeEquipmentName");
    if (equipmentField) {
      equipmentField.value =
        ticket.deviceLabel || ticket.equipmentType || ticket.asset_name || "Not specified";
    }
    const technicianField = adminEvalEl("afeTechnicianName");
    if (technicianField) {
      technicianField.value =
        ticket.assignedTechnician ||
        ticket.technician_feedback?.technician_name ||
        "Not assigned";
    }
    if (reportBox) {
      reportBox.innerHTML = renderTechnicianReportSummary(ticket.technician_feedback);
    }

    if (ticket.admin_feedback) prefillAdminEvalForm(ticket.admin_feedback);
    updateAdminEvalSaveAvailability();
    return true;
  } catch (err) {
    adminEvalState.detailError = true;
    if (reportBox) {
      reportBox.innerHTML = `<span class="text-danger">${feedbackEscape(err.message || "Unable to load the maintenance request.")}</span>`;
    }
    showAdminEvalNotice(err.message || "Unable to load the maintenance request.", "danger");
    updateAdminEvalSaveAvailability();
    return false;
  }
}

function prefillAdminEvalForm(evaluation) {
  const set = (id, value) => {
    const el = adminEvalEl(id);
    if (el) el.value = value ?? "";
  };
  set("afeDecision", evaluation.reportReviewDecision || "");
  set("afeWorkQuality", evaluation.workQuality || "");
  set("afeTechnicalAccuracy", evaluation.technicalAccuracy || "");
  set("afeRepairEffectiveness", evaluation.repairEffectiveness || "");
  set("afeReportCompleteness", evaluation.reportCompleteness || "");
  set("afeSafetyCompliance", evaluation.safetyProcedureCompliance || "");
  set("afeFeedbackStatus", evaluation.evaluationStatus || "Pending");
  set("afeAdminComment", evaluation.adminComment || "");
  set("afeRecommendation", evaluation.administrativeRecommendation || "");
  set("afeFollowUpNotes", evaluation.followUpNotes || "");
  const followUp = evaluation.followUpRequired ? "Yes" : "No";
  set("afeFollowUpRequired", followUp);
  adminEvalEl("afeFollowUpWrap")?.classList.toggle("d-none", followUp !== "Yes");
  set("afeReviewedBy", evaluation.admin_name || "Previously reviewed");
  set(
    "afeFeedbackDate",
    evaluation.submittedAt
      ? formatDateTime(evaluation.submittedAt)
      : "Set by server on save",
  );
}

async function openAdminEvalForm(ticketId = null, requestedMode = null) {
  const modalElement = adminEvalEl("adminEvalModal");
  if (!modalElement) return;

  resetAdminEvalEvaluationFields();
  hideAdminEvalNotice();
  ["afeTicketId", "afeEquipmentName", "afeTechnicianName"].forEach((id) => {
    const el = adminEvalEl(id);
    if (el) el.value = "";
  });
  const reportBox = adminEvalEl("afeTechnicianReport");
  if (reportBox) reportBox.textContent = "Select a maintenance request to load its report.";
  const reviewedBy = adminEvalEl("afeReviewedBy");
  if (reviewedBy) reviewedBy.value = Auth.getUser()?.fullName || "Authenticated ICT Admin";
  const feedbackDateField = adminEvalEl("afeFeedbackDate");
  if (feedbackDateField) feedbackDateField.value = "Set by server on save";

  adminEvalState.currentTicketId = ticketId ? String(ticketId) : null;
  adminEvalState.currentHasEvaluation = false;
  adminEvalState.hasTechnicianReport = false;
  adminEvalState.detailLoaded = false;
  adminEvalState.detailError = false;
  adminEvalState.submitting = false;
  adminEvalEl("afeSaveSpinner")?.classList.add("d-none");
  setAdminEvalMode(requestedMode === "view" ? "view" : "create");
  const saveLabel = adminEvalEl("afeSaveLabel");
  if (saveLabel) saveLabel.textContent = "Save Evaluation";

  if (window.bootstrap?.Modal) {
    window.bootstrap.Modal.getOrCreateInstance(modalElement).show();
  }

  try {
    await loadAdminEvalCandidates();
  } catch (err) {
    showAdminEvalNotice(
      err.message || "The maintenance request list could not be loaded.",
      "warning",
    );
  }

  if (!ticketId) {
    const select = adminEvalEl("afeRequestSelect");
    if (select && adminEvalState.candidates.length) select.disabled = false;
    setAdminEvalMode("create");
    updateAdminEvalSaveAvailability();
    return;
  }

  ensureAdminEvalOption({ id: ticketId });
  const select = adminEvalEl("afeRequestSelect");
  if (select) select.value = String(ticketId);
  const applied = await loadAdminEvalDetail(ticketId);
  if (!applied) return;
  if (adminEvalState.currentHasEvaluation) {
    setAdminEvalMode(requestedMode === "view" ? "view" : "edit");
    if (requestedMode !== "view") {
      showAdminEvalNotice(
        "This request already has an evaluation. Saving updates the existing record.",
        "info",
      );
    }
  } else {
    setAdminEvalMode("create");
    if (requestedMode === "view" || requestedMode === "edit") {
      showAdminEvalNotice(
        "No evaluation exists for this request yet. You can create one now.",
        "info",
      );
    }
  }
  updateAdminEvalSaveAvailability();
}

async function onAdminEvalRequestChange() {
  const select = adminEvalEl("afeRequestSelect");
  const ticketId = select?.value || "";
  setAdminEvalFieldError("afeRequestSelect", "");
  setAdminEvalFieldError("afeTechnicianReport", "");
  hideAdminEvalNotice();
  resetAdminEvalEvaluationFields();
  ["afeTicketId", "afeEquipmentName", "afeTechnicianName"].forEach((id) => {
    const el = adminEvalEl(id);
    if (el) el.value = "";
  });
  const reportBox = adminEvalEl("afeTechnicianReport");
  if (reportBox) {
    reportBox.textContent = ticketId
      ? "Loading maintenance request and technician report…"
      : "Select a maintenance request to load its report.";
  }
  const reviewedBy = adminEvalEl("afeReviewedBy");
  if (reviewedBy) reviewedBy.value = Auth.getUser()?.fullName || "Authenticated ICT Admin";
  const feedbackDateField = adminEvalEl("afeFeedbackDate");
  if (feedbackDateField) feedbackDateField.value = "Set by server on save";
  setAdminEvalMode("create");
  if (!ticketId) {
    updateAdminEvalSaveAvailability();
    return;
  }
  const applied = await loadAdminEvalDetail(ticketId);
  if (!applied || adminEvalEl("afeRequestSelect")?.value !== ticketId) return;
  if (adminEvalState.currentHasEvaluation) {
    setAdminEvalMode("edit");
    showAdminEvalNotice(
      "This request already has an evaluation. Saving updates the existing record.",
      "info",
    );
  } else {
    setAdminEvalMode("create");
  }
  updateAdminEvalSaveAvailability();
}

function validateAdminEvalForm() {
  clearAdminEvalErrors();
  const issues = adminEvalRequiredFieldIssues();
  if (!issues.length) {
    hideAdminEvalNotice();
    return true;
  }
  issues.forEach((issue) => setAdminEvalFieldError(issue.id, issue.message));
  showAdminEvalNotice("Please correct the highlighted fields.", "warning");
  const firstInvalid = adminEvalEl(issues[0].id);
  if (typeof firstInvalid?.focus === "function") firstInvalid.focus();
  firstInvalid?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  return false;
}

async function submitAdminEvalForm() {
  if (adminEvalState.submitting) return;
  if (!validateAdminEvalForm()) return;
  const ticketId = adminEvalEl("afeRequestSelect")?.value || "";
  if (!ticketId) {
    showAdminEvalNotice("Select a maintenance request.", "warning");
    return;
  }
  const followUpRequired = adminEvalEl("afeFollowUpRequired")?.value === "Yes";
  const payload = {
    reportReviewDecision: adminEvalEl("afeDecision").value,
    workQuality: adminEvalEl("afeWorkQuality").value,
    technicalAccuracy: adminEvalEl("afeTechnicalAccuracy").value || null,
    repairEffectiveness: adminEvalEl("afeRepairEffectiveness").value || null,
    reportCompleteness: adminEvalEl("afeReportCompleteness").value || null,
    safetyProcedureCompliance: adminEvalEl("afeSafetyCompliance").value || null,
    evaluationStatus: adminEvalEl("afeFeedbackStatus").value || "Pending",
    adminComment: (adminEvalEl("afeAdminComment").value || "").trim(),
    administrativeRecommendation:
      (adminEvalEl("afeRecommendation").value || "").trim() || null,
    followUpRequired,
    followUpNotes: (adminEvalEl("afeFollowUpNotes").value || "").trim() || null,
  };
  if (!ADMIN_EVAL_STATUSES.includes(payload.evaluationStatus)) {
    showAdminEvalNotice("Choose a valid feedback status.", "warning");
    return;
  }

  const isEdit = adminEvalState.mode === "edit";
  const saveButton = adminEvalEl("afeSaveBtn");
  adminEvalState.submitting = true;
  if (saveButton) saveButton.disabled = true;
  adminEvalEl("afeSaveSpinner")?.classList.remove("d-none");
  hideAdminEvalNotice();
  try {
    const result = await apiRequest(
      `/tickets/${encodeURIComponent(ticketId)}/admin-feedback`,
      {
        method: isEdit ? "PUT" : "POST",
        body: payload,
      },
    );
    if (result?.success !== true) {
      throw new Error(result?.message || "The evaluation was not saved.");
    }
    showToast(
      result.message || (isEdit ? "Evaluation updated." : "Evaluation saved."),
      "success",
    );
    if (result.data?.admin_name) {
      const reviewedBy = adminEvalEl("afeReviewedBy");
      if (reviewedBy) reviewedBy.value = result.data.admin_name;
    }
    if (result.data?.submittedAt) {
      const feedbackDateField = adminEvalEl("afeFeedbackDate");
      if (feedbackDateField) {
        feedbackDateField.value = formatDateTime(result.data.submittedAt);
      }
    }
    adminEvalState.candidatesLoaded = false;
    adminEvalState.currentHasEvaluation = true;
    const modalElement = adminEvalEl("adminEvalModal");
    if (window.bootstrap?.Modal && modalElement) {
      window.bootstrap.Modal.getInstance(modalElement)?.hide();
    }
    await loadAdminEvaluations();
  } catch (err) {
    showAdminEvalNotice(
      err.message || "The evaluation could not be saved. Please try again.",
      "danger",
    );
  } finally {
    adminEvalState.submitting = false;
    adminEvalEl("afeSaveSpinner")?.classList.add("d-none");
    updateAdminEvalSaveAvailability();
  }
}

function adminEvalFilterValues() {
  return {
    search: (adminEvalEl("adminEvalSearch")?.value || "").trim(),
    decision: adminEvalEl("adminEvalDecision")?.value || "",
    workQuality: adminEvalEl("adminEvalWorkQuality")?.value || "",
    status: adminEvalEl("adminEvalStatus")?.value || "",
    sort: adminEvalEl("adminEvalSort")?.value || "newest",
    from: adminEvalEl("adminEvalFrom")?.value || "",
    to: adminEvalEl("adminEvalTo")?.value || "",
  };
}

function renderAdminEvalRows(records) {
  const rows = adminEvalEl("adminEvalRows");
  if (!rows) return;
  if (!records.length) {
    const filters = adminEvalFilterValues();
    const hasFilters = Boolean(
      filters.search ||
        filters.decision ||
        filters.workQuality ||
        filters.status ||
        filters.from ||
        filters.to,
    );
    rows.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">${
      hasFilters
        ? "No admin evaluations match these filters."
        : "No admin evaluations have been saved yet. Use “Evaluate Admin Feedback” to create one."
    }</td></tr>`;
    return;
  }
  rows.innerHTML = records
    .map(
      (item) => `<tr>
        <td class="text-nowrap"><strong>${feedbackEscape(item.ticketId || "—")}</strong>${
          item.title ? `<div class="small text-muted">${feedbackEscape(item.title)}</div>` : ""
        }</td>
        <td>${feedbackEscape(item.equipmentName || "—")}</td>
        <td>${feedbackEscape(item.technicianName || "—")}</td>
        <td>${
          item.decision
            ? `<span class="badge ${adminEvalDecisionClass(item.decision)}">${feedbackEscape(item.decision)}</span>`
            : "—"
        }</td>
        <td>${feedbackEscape(item.workQuality || "—")}</td>
        <td>${adminEvalStatusBadge(item.evaluationStatus)}</td>
        <td class="text-nowrap">${feedbackEscape(item.reviewedBy || "—")}</td>
        <td class="text-nowrap">${
          item.feedbackDate ? feedbackEscape(feedbackDate(item.feedbackDate)) : "—"
        }</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-secondary me-1" type="button" data-admin-eval-view="${feedbackEscape(item.id)}">View</button>
          <button class="btn btn-sm btn-outline-primary" type="button" data-admin-eval-edit="${feedbackEscape(item.id)}">Edit</button>
        </td>
      </tr>`,
    )
    .join("");
}

async function loadAdminEvaluations({ resetPage = false } = {}) {
  const rows = adminEvalEl("adminEvalRows");
  if (!rows) return;
  if (resetPage) adminEvalState.page = 1;
  if (adminEvalState.loadPromise) {
    adminEvalState.reloadRequested = true;
    return adminEvalState.loadPromise;
  }
  const errorAlert = adminEvalEl("adminEvalLoadError");
  const errorMessage = adminEvalEl("adminEvalLoadErrorMessage");
  errorAlert?.classList.add("d-none");
  if (errorMessage) errorMessage.textContent = "";
  rows.innerHTML =
    '<tr><td colspan="9" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Loading admin evaluations…</td></tr>';
  adminEvalState.loadPromise = (async () => {
    try {
      const filters = adminEvalFilterValues();
      const params = new URLSearchParams({
        page: String(adminEvalState.page),
        limit: String(adminEvalState.pageSize),
        sort: filters.sort,
      });
      if (filters.search) params.set("search", filters.search);
      if (filters.decision) params.set("decision", filters.decision);
      if (filters.workQuality) params.set("workQuality", filters.workQuality);
      if (filters.status) params.set("status", filters.status);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const result = await apiRequest(`/tickets/admin-feedback?${params.toString()}`);
      if (result?.success !== true || !Array.isArray(result.data)) {
        throw new Error(result?.message || "Unable to load admin evaluations.");
      }
      renderAdminEvalRows(result.data);
      const pagination = result.pagination || {};
      adminEvalState.totalPages = Math.max(1, pagination.pages || 1);
      adminEvalState.page = Math.min(adminEvalState.page, adminEvalState.totalPages);
      const total = Number(pagination.total) || 0;
      const limit = Number(pagination.limit) || adminEvalState.pageSize;
      const first = total ? (adminEvalState.page - 1) * limit + 1 : 0;
      const last = total ? Math.min(total, adminEvalState.page * limit) : 0;
      const pageInfo = adminEvalEl("adminEvalPageInfo");
      if (pageInfo) pageInfo.textContent = `Showing ${first}–${last} of ${total}`;
      const prev = adminEvalEl("adminEvalPrev");
      const next = adminEvalEl("adminEvalNext");
      if (prev) prev.disabled = adminEvalState.page <= 1;
      if (next) next.disabled = adminEvalState.page >= adminEvalState.totalPages;
    } catch (err) {
      rows.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">Admin evaluations could not be loaded.</td></tr>';
      if (errorMessage) {
        errorMessage.textContent = `Unable to load admin evaluations: ${err.message || "Please try again."}`;
      }
      errorAlert?.classList.remove("d-none");
      const pageInfo = adminEvalEl("adminEvalPageInfo");
      if (pageInfo) pageInfo.textContent = "Evaluation list unavailable.";
      const prev = adminEvalEl("adminEvalPrev");
      const next = adminEvalEl("adminEvalNext");
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
    } finally {
      adminEvalState.loadPromise = null;
      if (adminEvalState.reloadRequested) {
        adminEvalState.reloadRequested = false;
        void loadAdminEvaluations();
      }
    }
  })();
  return adminEvalState.loadPromise;
}

function initAdminEvaluationSection() {
  const section = adminEvalEl("adminEvaluationsSection");
  section?.classList.remove("d-none");

  if (adminEvalState.bound) return;
  adminEvalState.bound = true;

  const reload = () => void loadAdminEvaluations({ resetPage: true });
  ["adminEvalDecision", "adminEvalWorkQuality", "adminEvalStatus", "adminEvalSort", "adminEvalFrom", "adminEvalTo"].forEach(
    (id) => adminEvalEl(id)?.addEventListener("change", reload),
  );
  let searchTimer;
  adminEvalEl("adminEvalSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, 300);
  });
  adminEvalEl("adminEvalPrev")?.addEventListener("click", () => {
    if (adminEvalState.page > 1) {
      adminEvalState.page -= 1;
      void loadAdminEvaluations();
    }
  });
  adminEvalEl("adminEvalNext")?.addEventListener("click", () => {
    if (adminEvalState.page < adminEvalState.totalPages) {
      adminEvalState.page += 1;
      void loadAdminEvaluations();
    }
  });
  adminEvalEl("adminEvalRetry")?.addEventListener("click", () => void loadAdminEvaluations());

  section?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-admin-eval-view]");
    if (viewButton) {
      void openAdminEvalForm(viewButton.dataset.adminEvalView, "view");
      return;
    }
    const editButton = event.target.closest("[data-admin-eval-edit]");
    if (editButton) void openAdminEvalForm(editButton.dataset.adminEvalEdit, "edit");
  });

  adminEvalEl("afeRequestSelect")?.addEventListener("change", () =>
    void onAdminEvalRequestChange(),
  );
  adminEvalEl("adminEvalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAdminEvalForm();
  });
  adminEvalEl("afeFollowUpRequired")?.addEventListener("change", (event) => {
    const show = event.target.value === "Yes";
    adminEvalEl("afeFollowUpWrap")?.classList.toggle("d-none", !show);
    if (!show) setAdminEvalFieldError("afeFollowUpNotes", "");
  });
  adminEvalEl("afeSaveBtn")?.addEventListener("click", () => void submitAdminEvalForm());
  adminEvalEl("afeEditBtn")?.addEventListener("click", () => setAdminEvalMode("edit"));

  const form = adminEvalEl("adminEvalForm");
  const refreshField = (target) => {
    const id = target?.id;
    if (!id || !target.matches?.("select, input, textarea")) return;
    /* Request selection / technician report guidance is surfaced by the report
       box and the footer hint, so live field validation only touches the
       evaluation fields themselves. */
    if (id !== "afeRequestSelect" && id !== "afeTechnicianReport") {
      const issue = adminEvalRequiredFieldIssues().find((item) => item.id === id);
      setAdminEvalFieldError(id, issue ? issue.message : "");
    }
    updateAdminEvalSaveAvailability();
  };
  form?.addEventListener("input", (event) => refreshField(event.target));
  form?.addEventListener("change", (event) => refreshField(event.target));
  form?.addEventListener("focusout", (event) => refreshField(event.target));

  void loadAdminEvaluations();
}
