/* Shared Requester, Technician, and ICT Admin feedback workflows. */
const FEEDBACK_CATEGORIES = [
  "Service Quality",
  "Technician Performance",
  "System Improvement",
  "Complaint",
  "Suggestion",
  "Other",
];
const FEEDBACK_STATUSES = [
  "Pending",
  "In Progress",
  "Replied",
  "Resolved",
  "Closed",
];
const FEEDBACK_ROLE_CATEGORIES = {
  Requester: FEEDBACK_CATEGORIES,
  Technician: [
    "Work Challenges",
    "Equipment Request",
    "Technical Issue",
    "Resource Request",
    "System Improvement",
    "Process Improvement",
    "Suggestion",
    "Other",
  ],
};
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
  const userForm = document.getElementById("feedbackSubmissionForm");
  const technicianForm = document.getElementById("technicianFeedbackForm");
  const adminPanel = document.getElementById("feedbackSubmissionManager");
  const serviceFeedbackPanel = document.getElementById(
    "requesterServiceFeedbackPanel",
  );
  if (!userForm && !technicianForm && !adminPanel && !serviceFeedbackPanel) return;

  try {
    await Auth.load();
    const user = requireAuth();
    if (!user) return;
    const nameElement = document.getElementById("topUserName");
    if (nameElement) nameElement.textContent = user.fullName || "";
    if (userForm && requireRole("Requester")) {
      populateFeedbackIdentity(user, "Requester");
      populateTechnicianSelect("feedbackSubmissionTechnician");
      initSubmitterFeedbackForm(userForm, "Requester");
      initSubmitterHistory("feedbackSubmissionHistory", "Requester");
    } else if (technicianForm && requireRole("Technician")) {
      populateFeedbackIdentity(user, "Technician");
      initSubmitterFeedbackForm(technicianForm, "Technician");
      initSubmitterHistory("technicianFeedbackHistory", "Technician");
    } else if (adminPanel && requireRole("ICT Admin")) {
      initAdminFeedbackManager(adminPanel);
    }
    if (serviceFeedbackPanel && requireRole("ICT Admin")) {
      initRequesterServiceFeedbackManager(serviceFeedbackPanel);
    }
  } catch (err) {
    console.error("Feedback page initialization failed:", err);
    showToast(err.message || "Unable to initialize feedback.", "danger");
  }
});

function populateFeedbackIdentity(user, role) {
  const name = document.getElementById(
    role === "Requester" ? "feedbackSubmissionUser" : "technicianFeedbackUser",
  );
  const department = document.getElementById(
    role === "Requester" ? "feedbackSubmissionDepartment" : "technicianFeedbackDepartment",
  );
  if (name) name.value = user.fullName || "";
  if (department) department.value = user.department || "";
}

async function populateTechnicianSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  try {
    const result = await apiRequest("/technicians");
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load technicians.");
    }
    result.data
      .filter((technician) => technician.status === "active" && technician.fullName)
      .forEach((technician) => {
        select.add(new Option(technician.fullName, technician._id || technician.id));
      });
  } catch (err) {
    console.error("Feedback technician list failed to load:", err);
    showToast(err.message || "Unable to load the optional technician list.", "warning");
  }
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

function initSubmitterFeedbackForm(form, role) {
  const categorySelect = document.getElementById(
    role === "Requester" ? "feedbackSubmissionCategory" : "technicianFeedbackCategory",
  );
  const subjectInput = document.getElementById(
    role === "Requester" ? "feedbackSubmissionSubject" : "technicianFeedbackSubject",
  );
  const descriptionInput = document.getElementById(
    role === "Requester" ? "feedbackSubmissionDescription" : "technicianFeedbackMessage",
  );
  const notice = document.getElementById(
    role === "Requester" ? "feedbackSubmissionNotice" : "technicianFeedbackNotice",
  );
  const submitButton = form.querySelector('[data-feedback-submit], [type="submit"]');
  if (!categorySelect || !subjectInput || !descriptionInput || !submitButton) return;
  if (form.dataset.feedbackBound === "true") return;

  if (role === "Technician") {
    FEEDBACK_ROLE_CATEGORIES.Technician.forEach((category) => {
      categorySelect.add(new Option(category, category));
    });
    const historyCategory = document.getElementById("technicianFeedbackHistoryCategory");
    FEEDBACK_ROLE_CATEGORIES.Technician.forEach((category) => {
      if (historyCategory && !Array.from(historyCategory.options).some((option) => option.value === category)) {
        historyCategory.add(new Option(category, category));
      }
    });
    initOptionalFeedbackRating(form, "technicianFeedbackRating", "clearTechnicianFeedbackRating", "technicianFeedbackRatingDescription", ".technician-feedback-star");
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
  } else {
    initOptionalFeedbackRating(form, "feedbackRating", "clearFeedbackRating", "feedbackRatingDescription", ".feedback-star");
  }
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
    const priority = role === "Technician"
      ? document.getElementById("technicianFeedbackPriority")?.value
      : "";
    const relatedRequestId = role === "Technician"
      ? document.getElementById("technicianFeedbackRelatedRequest")?.value.trim()
      : "";
    if (role === "Technician" && !FEEDBACK_PRIORITIES.includes(priority)) {
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
    const ratingName = role === "Technician" ? "technicianFeedbackRating" : "feedbackRating";
    const rating = form.querySelector(`input[name="${ratingName}"]:checked`)?.value;
    const technicianSelect = role === "Requester"
      ? document.getElementById("feedbackSubmissionTechnician")
      : null;
    const payload = new FormData();
    payload.append("category", category);
    payload.append("subject", subject);
    payload.append("description", description);
    if (technicianSelect?.value) payload.append("technicianId", technicianSelect.value);
    if (role === "Technician") {
      if (relatedRequestId) payload.append("relatedRequestId", relatedRequestId);
      payload.append("priority", priority);
    }
    if (rating) payload.append("rating", rating);
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
      if (user) populateFeedbackIdentity(user, role);
      if (role === "Technician") {
        form.querySelectorAll('input[name="technicianFeedbackRating"]').forEach((input) => {
          input.checked = false;
        });
        updateOptionalFeedbackRating(form, "technicianFeedbackRating", "technicianFeedbackRatingDescription", ".technician-feedback-star");
        const count = document.getElementById("technicianFeedbackCharacterCount");
        if (count) count.textContent = "0 / 5,000";
        count?.classList.remove("is-near-limit");
      } else {
        updateOptionalFeedbackRating(form, "feedbackRating", "feedbackRatingDescription", ".feedback-star");
      }
      showFeedbackNotice(
        notice,
        `Feedback ${result.data.feedbackNumber || ""} submitted successfully.`,
        "success",
      );
      await loadSubmitterFeedbackHistory(
        role === "Requester" ? "feedbackSubmissionHistory" : "technicianFeedbackHistory",
      );
    } catch (err) {
      showFeedbackNotice(notice, err.message || "Unable to submit feedback. Please try again.");
    } finally {
      form.dataset.submitting = "false";
      setFeedbackButtonBusy(submitButton, false, buttonText);
    }
  });
}

function initOptionalFeedbackRating(form, inputName, clearButtonId, descriptionId, starSelector) {
  const inputs = Array.from(form.querySelectorAll(`input[name="${inputName}"]`));
  const description = document.getElementById(descriptionId);
  const clearButton = document.getElementById(clearButtonId);
  const labels = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];
  const update = () => {
    const selected = Number(inputs.find((input) => input.checked)?.value || 0);
    form.querySelectorAll(starSelector).forEach((star, index) => {
      star.classList.toggle("is-selected", index < selected);
    });
    if (description) {
      description.textContent = selected
        ? `${selected} star${selected === 1 ? "" : "s"} — ${labels[selected]}`
        : "No rating selected. Rating is optional.";
    }
  };
  inputs.forEach((input) => input.addEventListener("change", update));
  clearButton?.addEventListener("click", () => {
    inputs.forEach((input) => { input.checked = false; });
    update();
  });
}

function updateOptionalFeedbackRating(form, inputName, descriptionId, starSelector) {
  const selected = Number(form.querySelector(`input[name="${inputName}"]:checked`)?.value || 0);
  const labels = ["", "Very Poor", "Poor", "Average", "Good", "Excellent"];
  const description = document.getElementById(descriptionId);
  if (description) {
    description.textContent = selected
      ? `${selected} star${selected === 1 ? "" : "s"} — ${labels[selected]}`
      : "No rating selected. Rating is optional.";
  }
  form.querySelectorAll(starSelector).forEach((star, index) => {
    star.classList.toggle("is-selected", index < selected);
  });
}

function initSubmitterHistory(containerId, role) {
  const container = document.getElementById(containerId);
  if (!container) return;
  initSubmitterHistoryFilters(containerId, role);
  initSubmitterHistoryPagination(containerId, role);
  loadSubmitterFeedbackHistory(containerId);
}

function initSubmitterHistoryPagination(containerId, role) {
  const prefix = role === "Requester" ? "feedbackHistory" : "technicianFeedbackHistory";
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

function initSubmitterHistoryFilters(containerId, role) {
  const container = document.getElementById(containerId);
  const search = document.getElementById(
    role === "Requester" ? "feedbackHistorySearch" : "technicianFeedbackHistorySearch",
  );
  const status = document.getElementById(
    role === "Requester" ? "feedbackHistoryStatus" : "technicianFeedbackHistoryStatus",
  );
  const category = role === "Technician"
    ? document.getElementById("technicianFeedbackHistoryCategory")
    : document.getElementById("feedbackHistoryCategory");
  const from = document.getElementById(
    role === "Requester" ? "feedbackHistoryFrom" : "technicianFeedbackHistoryFrom",
  );
  const to = document.getElementById(
    role === "Requester" ? "feedbackHistoryTo" : "technicianFeedbackHistoryTo",
  );
  if (!container || container.dataset.filtersBound === "true") return;
  container.dataset.filtersBound = "true";
  const priority = role === "Technician"
    ? document.getElementById("technicianFeedbackHistoryPriority")
    : null;
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
    const role = containerId === "technicianFeedbackHistory" ? "Technician" : "Requester";
    const params = new URLSearchParams({
      page: container.dataset.page || "1",
      limit: "20",
    });
    const searchId = role === "Requester" ? "feedbackHistorySearch" : "technicianFeedbackHistorySearch";
    const statusId = role === "Requester" ? "feedbackHistoryStatus" : "technicianFeedbackHistoryStatus";
    const search = document.getElementById(searchId)?.value.trim();
    const status = document.getElementById(statusId)?.value;
    const priority = role === "Technician"
      ? document.getElementById("technicianFeedbackHistoryPriority")?.value
      : "";
    const category = role === "Technician"
      ? document.getElementById("technicianFeedbackHistoryCategory")?.value
      : document.getElementById("feedbackHistoryCategory")?.value;
    const from = document.getElementById(
      role === "Requester" ? "feedbackHistoryFrom" : "technicianFeedbackHistoryFrom",
    )?.value;
    const to = document.getElementById(
      role === "Requester" ? "feedbackHistoryTo" : "technicianFeedbackHistoryTo",
    )?.value;
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
    const pageInfoId = role === "Requester"
      ? "feedbackHistoryPageInfo"
      : "technicianFeedbackHistoryPageInfo";
    const pageInfo = document.getElementById(pageInfoId);
    if (pageInfo) {
      const total = pagination.total || 0;
      pageInfo.textContent = `${total} submission${total === 1 ? "" : "s"} · Page ${page} of ${totalPages}`;
    }
    const prefix = role === "Requester" ? "feedbackHistory" : "technicianFeedbackHistory";
    const previous = document.getElementById(`${prefix}Prev`);
    const next = document.getElementById(`${prefix}Next`);
    if (previous) previous.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
    Object.entries(result.summary || {}).forEach(([key, value]) => {
      const element = document.querySelector(`[data-own-feedback-stat="${key}"]`);
      if (element) element.textContent = String(value ?? 0);
    });
    renderSubmitterFeedbackHistory(containerId, result.data, role);
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

function renderSubmitterFeedbackHistory(containerId, records, role) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const searchId = role === "Requester" ? "feedbackHistorySearch" : "technicianFeedbackHistorySearch";
  const statusId = role === "Requester" ? "feedbackHistoryStatus" : "technicianFeedbackHistoryStatus";
  const search = (document.getElementById(searchId)?.value || "").trim().toLowerCase();
  const status = document.getElementById(statusId)?.value || "";
  const category = role === "Technician"
    ? document.getElementById("technicianFeedbackHistoryCategory")?.value || ""
    : document.getElementById("feedbackHistoryCategory")?.value || "";
  const priority = role === "Technician"
    ? document.getElementById("technicianFeedbackHistoryPriority")?.value || ""
    : "";
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
    const rating = Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5
      ? `<span class="small text-warning" aria-label="${item.rating} out of 5 stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</span>`
      : "";
    const attachment = item.attachment?.storageName
      ? `<a class="small" href="${feedbackEscape(feedbackAttachmentUrl(item._id))}">Download ${feedbackEscape(item.attachment.originalName || "attachment")}</a>`
      : "";
    const technicianName = item.technician?.user?.fullName || "";
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
        ${role === "Technician" && item.priority ? `<span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)} priority</span>` : ""}
        ${rating}
      </div>
      ${technicianName ? `<div class="small mt-2">Technician: ${feedbackEscape(technicianName)}</div>` : ""}
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
  const roleFilter = document.getElementById("feedbackAdminRole");
  const technicianFilter = document.getElementById("feedbackAdminTechnician");
  const syncTechnicianFilter = () => {
    const requesterOnly = roleFilter?.value === "Requester";
    if (requesterOnly && technicianFilter) technicianFilter.value = "";
    if (technicianFilter) technicianFilter.disabled = requesterOnly;
  };
  syncTechnicianFilter();
  roleFilter?.addEventListener("change", syncTechnicianFilter);
  populateAdminFeedbackTechnicians();
  const reload = () => {
    adminFeedbackState.page = 1;
    loadAdminFeedbackSubmissions();
  };
  ["feedbackAdminRole", "feedbackAdminTechnician", "feedbackAdminDepartment", "feedbackAdminStatus", "feedbackAdminCategory", "feedbackAdminPriority", "feedbackAdminReplyStatus", "feedbackAdminFrom", "feedbackAdminTo", "feedbackAdminSort"]
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
    const button = event.target.closest("[data-open-feedback]");
    if (button) openAdminFeedbackSubmission(button.dataset.openFeedback);
    const statusButton = event.target.closest("[data-feedback-set-status]");
    if (statusButton) {
      setAdminFeedbackStatus(
        statusButton.dataset.feedbackSetStatus,
        statusButton.dataset.status,
      );
    }
  });
  const modalBody = document.getElementById("feedbackSubmissionModalBody");
  modalBody?.addEventListener("submit", async (event) => {
    const replyForm = event.target.closest("[data-admin-feedback-reply]");
    const statusForm = event.target.closest("[data-admin-feedback-status-form]");
    if (!replyForm && !statusForm) return;
    event.preventDefault();
    if (replyForm) {
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
        await openAdminFeedbackSubmission(replyForm.dataset.adminFeedbackReply);
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
        await openAdminFeedbackSubmission(id);
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
    if (id && /^[0-9a-f]{24}$/i.test(id)) openAdminFeedbackSubmission(id);
  });
}

async function setAdminFeedbackStatus(id, status) {
  if (status === "Closed" && !window.confirm("Close this feedback? This marks the feedback process complete.")) {
    return;
  }
  try {
    const result = await apiRequest(`/feedback/submissions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        status,
        comment: status === "Resolved" ? "Marked as resolved by Admin." : "Closed by Admin.",
      },
    });
    if (result?.success !== true) throw new Error(result?.message || "Status update was not saved.");
    await loadAdminFeedbackSubmissions();
    showToast(status === "Resolved" ? "Feedback marked as resolved." : "Feedback closed.", "success");
  } catch (err) {
    showToast(err.message || "Unable to update feedback status.", "danger");
  }
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

const adminFeedbackState = { page: 1, totalPages: 1, categoriesLoaded: false };

function initRequesterServiceFeedbackManager(panel) {
  if (panel.dataset.serviceFeedbackBound === "true") return;
  panel.dataset.serviceFeedbackBound = "true";
  document
    .getElementById("serviceFeedbackApplyFilters")
    ?.addEventListener("click", () => loadRequesterServiceFeedback());
  document
    .getElementById("serviceFeedbackClearFilters")
    ?.addEventListener("click", () => {
      [
        "serviceFeedbackFrom",
        "serviceFeedbackTo",
        "serviceFeedbackRating",
        "serviceFeedbackRepairQuality",
        "serviceFeedbackFollowUp",
      ].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.value = "";
      });
      loadRequesterServiceFeedback();
    });
  loadRequesterServiceFeedback();
}

async function loadRequesterServiceFeedback() {
  const rows = document.getElementById("requesterServiceFeedbackRows");
  const error = document.getElementById("serviceFeedbackLoadError");
  if (!rows) return;
  if (error) error.classList.add("d-none");
  rows.innerHTML =
    '<tr><td colspan="10" class="text-center text-muted py-4">Loading requester service feedback...</td></tr>';

  const params = new URLSearchParams();
  const filters = [
    ["from", "serviceFeedbackFrom"],
    ["to", "serviceFeedbackTo"],
    ["rating", "serviceFeedbackRating"],
    ["repairQuality", "serviceFeedbackRepairQuality"],
    ["followUpRequested", "serviceFeedbackFollowUp"],
  ];
  filters.forEach(([key, id]) => {
    const value = document.getElementById(id)?.value;
    if (value) params.set(key, value);
  });

  try {
    const result = await apiRequest(`/feedback?${params.toString()}`);
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load requester feedback.");
    }
    const summary = result.summary || {};
    document.getElementById("serviceFeedbackTotal").textContent =
      String(summary.totalFeedback ?? result.data.length);
    document.getElementById("serviceFeedbackAverage").textContent =
      Number(summary.averageRating || 0).toFixed(1);
    document.getElementById("serviceFeedbackLowRatings").textContent =
      String(summary.lowRatings || 0);
    document.getElementById("serviceFeedbackFollowUps").textContent =
      String(summary.followUpRequests || 0);

    const qualityCounts = { "Fully Fixed": 0, "Partially Fixed": 0, "Not Fixed": 0 };
    result.data.forEach((item) => {
      if (Object.prototype.hasOwnProperty.call(qualityCounts, item.repairQuality)) {
        qualityCounts[item.repairQuality] += 1;
      }
    });
    const qualitySummary = document.getElementById(
      "serviceFeedbackQualitySummary",
    );
    if (qualitySummary) {
      qualitySummary.textContent = `Repair outcomes: Fully Fixed ${qualityCounts["Fully Fixed"]} · Partially Fixed ${qualityCounts["Partially Fixed"]} · Not Fixed ${qualityCounts["Not Fixed"]}`;
    }

    if (!result.data.length) {
      rows.innerHTML =
        '<tr><td colspan="10" class="text-center text-muted py-4">No requester service feedback matches these filters.</td></tr>';
      return;
    }
    rows.innerHTML = result.data
      .map((item) => {
        const ticket = item.request || {};
        const requesterName =
          item.user?.fullName || ticket.requester?.fullName || "Unknown requester";
        const technicianName =
          ticket.assignedTechnician?.fullName || "Not assigned";
        const asset = ticket.assetId || {};
        const equipment =
          asset.asset_name ||
          ticket.otherDeviceName ||
          ticket.device ||
          ticket.equipmentType ||
          "Not specified";
        const assetLabel = asset.asset_tag || "";
        const ticketId = ticket.ticketId || String(ticket._id || "");
        const feedbackId = String(item._id || "");
        const followUp = item.followUpRequested
          ? `Yes — ${item.followUpStatus || "Pending"}`
          : "No";
        const submittedAt = feedbackDate(item.submittedAt || item.createdAt);
        const comment = item.comment || "—";
        const rating = Number(item.rating) || 0;
        return `<tr>
          <td><span class="d-block fw-semibold">${feedbackEscape(feedbackId)}</span><span class="small text-muted">${feedbackEscape(ticketId)}</span></td>
          <td>${feedbackEscape(requesterName)}</td>
          <td>${feedbackEscape(technicianName)}</td>
          <td>${feedbackEscape(equipment)}${assetLabel ? `<span class="small text-muted d-block">${feedbackEscape(assetLabel)}</span>` : ""}</td>
          <td class="text-nowrap"><span class="text-warning" aria-label="${rating} out of 5 stars">${feedbackEscape("★".repeat(Math.max(0, Math.min(5, rating))))}</span><span class="small text-muted"> ${rating}/5</span></td>
          <td>${feedbackEscape(item.repairQuality || "—")}</td>
          <td>${feedbackEscape(item.responseTimeliness || "—")}</td>
          <td><span class="badge ${item.followUpRequested ? "text-bg-warning" : "text-bg-secondary"}">${feedbackEscape(followUp)}</span></td>
          <td><span title="${feedbackEscape(comment)}">${feedbackEscape(comment.length > 120 ? `${comment.slice(0, 117)}...` : comment)}</span></td>
          <td class="text-nowrap">${feedbackEscape(submittedAt)}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    rows.innerHTML =
      '<tr><td colspan="10" class="text-center text-muted py-4">Requester service feedback could not be loaded.</td></tr>';
    if (error) {
      error.textContent = err.message || "Unable to load requester feedback.";
      error.classList.remove("d-none");
    }
    console.error("Requester service feedback report failed to load:", err);
  }
}

function buildAdminFeedbackQuery() {
  const params = new URLSearchParams({
    page: String(adminFeedbackState.page),
    limit: "20",
  });
  const values = {
    search: document.getElementById("feedbackAdminSearch")?.value.trim(),
    role: document.getElementById("feedbackAdminRole")?.value,
    technician: document.getElementById("feedbackAdminTechnician")?.value,
    department: document.getElementById("feedbackAdminDepartment")?.value.trim(),
    status: document.getElementById("feedbackAdminStatus")?.value,
    category: document.getElementById("feedbackAdminCategory")?.value,
    priority: document.getElementById("feedbackAdminPriority")?.value,
    replyStatus: document.getElementById("feedbackAdminReplyStatus")?.value,
    from: document.getElementById("feedbackAdminFrom")?.value,
    to: document.getElementById("feedbackAdminTo")?.value,
    sort: document.getElementById("feedbackAdminSort")?.value || "newest",
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

async function loadAdminFeedbackSubmissions() {
  const rows = document.getElementById("feedbackAdminRows");
  if (!rows) return;
  const errorAlert = document.getElementById("feedbackAdminLoadError");
  const errorMessage = document.getElementById("feedbackAdminLoadErrorMessage");
  errorAlert?.classList.add("d-none");
  if (errorMessage) errorMessage.textContent = "";
  rows.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2" role="status" aria-label="Loading"></span>Loading feedback submissions...</td></tr>';
  try {
    const result = await apiRequest(`/feedback/submissions/admin?${buildAdminFeedbackQuery()}`);
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load feedback submissions.");
    }
    const categorySelect = document.getElementById("feedbackAdminCategory");
    if (!adminFeedbackState.categoriesLoaded && categorySelect && Array.isArray(result.categories)) {
      result.categories.forEach((category) => categorySelect.add(new Option(category, category)));
      adminFeedbackState.categoriesLoaded = true;
    }
    const pagination = result.pagination || {};
    const page = pagination.page || 1;
    const total = pagination.total || 0;
    adminFeedbackState.totalPages = Math.max(1, pagination.totalPages || 1);
    const first = total ? (page - 1) * (pagination.limit || 20) + 1 : 0;
    const last = Math.min(total, page * (pagination.limit || 20));
    document.getElementById("feedbackAdminPageInfo").textContent =
      `Showing ${first}–${last} of ${total}`;
    document.getElementById("feedbackAdminPrev").disabled = page <= 1;
    document.getElementById("feedbackAdminNext").disabled = page >= adminFeedbackState.totalPages;
    Object.entries(result.summary || {}).forEach(([key, value]) => {
      const element = document.querySelector(`[data-feedback-stat="${key}"]`);
      if (element) element.textContent = String(value ?? 0);
    });
    rows.innerHTML = result.data.length
      ? result.data.map((item) => `<tr>
          <td class="text-nowrap"><strong>${feedbackEscape(item.feedbackNumber || "—")}</strong></td>
          <td>${feedbackEscape(item.sender?.fullName || "Unknown sender")}</td>
          <td><span class="badge ${item.senderRole === "Technician" ? "text-bg-info" : "text-bg-secondary"}">${item.senderRole === "Requester" ? "User" : feedbackEscape(item.senderRole || "—")}</span></td>
          <td>${feedbackEscape(item.department || item.sender?.department || "—")}</td>
          <td>${feedbackEscape(item.category || "—")}<div class="fw-semibold">${feedbackEscape(item.subject || "")}</div></td>
          <td>${item.priority ? `<span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)}</span>` : "—"}</td>
          <td class="text-nowrap">${feedbackEscape(feedbackDate(item.createdAt))}</td>
          <td class="text-nowrap">${item.lastReplyAt ? feedbackEscape(feedbackDate(item.lastReplyAt)) : '<span class="text-muted">No replies</span>'}</td>
          <td><span class="badge ${feedbackStatusClass(item.status)}">${feedbackEscape(item.status || "Pending")}</span></td>
          <td class="text-nowrap">
            <button class="btn btn-sm btn-outline-primary" type="button" data-open-feedback="${feedbackEscape(item._id)}">View details / replies</button>
            ${!["Resolved", "Closed"].includes(item.status) ? `<button class="btn btn-sm btn-outline-success mt-1" type="button" data-feedback-set-status="${feedbackEscape(item._id)}" data-status="Resolved">Mark resolved</button>` : ""}
            ${item.status !== "Closed" ? `<button class="btn btn-sm btn-outline-secondary mt-1" type="button" data-feedback-set-status="${feedbackEscape(item._id)}" data-status="Closed">Close</button>` : ""}
          </td>
        </tr>`).join("")
      : '<tr><td colspan="10" class="text-center text-muted py-4">No feedback matches these filters.</td></tr>';
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
  }
}

document.getElementById("feedbackAdminRetry")?.addEventListener("click", () => {
  void loadAdminFeedbackSubmissions();
});

async function openAdminFeedbackSubmission(id) {
  const body = document.getElementById("feedbackSubmissionModalBody");
  if (!body) return;
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
          <span class="badge ${item.senderRole === "Technician" ? "text-bg-info" : "text-bg-secondary"}">${item.senderRole === "Requester" ? "User (Requester)" : feedbackEscape(item.senderRole)}</span></div>
        <span class="small text-muted">Submitted ${feedbackEscape(feedbackDate(item.createdAt))}</span>
      </div>
      <dl class="row small">
        <dt class="col-sm-3">Sender</dt><dd class="col-sm-9">${feedbackEscape(item.sender?.fullName || "Unknown")}
          ${item.sender?.email ? `· ${feedbackEscape(item.sender.email)}` : ""}</dd>
        <dt class="col-sm-3">Department</dt><dd class="col-sm-9">${feedbackEscape(item.department || item.sender?.department || "Not provided")}</dd>
        ${item.technician?.user?.fullName ? `<dt class="col-sm-3">Technician</dt><dd class="col-sm-9">${feedbackEscape(item.technician.user.fullName)}</dd>` : ""}
        <dt class="col-sm-3">Category</dt><dd class="col-sm-9">${feedbackEscape(item.category)}</dd>
        <dt class="col-sm-3">Subject</dt><dd class="col-sm-9">${feedbackEscape(item.subject)}</dd>
        ${item.priority ? `<dt class="col-sm-3">Priority</dt><dd class="col-sm-9"><span class="badge ${feedbackPriorityClass(item.priority)}">${feedbackEscape(item.priority)}</span></dd>` : ""}
        ${item.relatedRequest ? `<dt class="col-sm-3">Related service request</dt><dd class="col-sm-9">${feedbackEscape(item.relatedRequest.ticketId || item.relatedRequest._id)}</dd>` : ""}
        ${Number.isInteger(item.rating) ? `<dt class="col-sm-3">Rating</dt><dd class="col-sm-9">${feedbackEscape(item.rating)} / 5</dd>` : ""}
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
