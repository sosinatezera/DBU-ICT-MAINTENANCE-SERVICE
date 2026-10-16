(() => {
  const API_PATH = "/requester-feedback";
  const form = document.getElementById("requesterFeedbackForm");
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const requestSelect = $("requesterFeedbackRequestSelect");
  const ticketIdInput = $("requesterFeedbackTicketId");
  const technicianInput = $("requesterFeedbackTechnician");
  const fixedSelect = $("requesterFeedbackFixed");
  const equipmentSelect = $("requesterFeedbackEquipment");
  const commentsInput = $("requesterFeedbackComments");
  const commentsRequired = $("requesterFeedbackCommentsRequired");
  const submitButton = $("requesterFeedbackSubmit");
  const notice = $("requesterFeedbackNotice");
  const historyBody = $("requesterFeedbackHistory");
  let eligibleRequests = [];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  function showNotice(message, type) {
    notice.className = `alert alert-${type}`;
    notice.textContent = message;
    notice.classList.remove("d-none");
    notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function requiresComments() {
    return fixedSelect.value === "Partially" ||
      fixedSelect.value === "No" ||
      equipmentSelect.value === "No";
  }

  function updateFormState() {
    const selected = eligibleRequests.find((request) => request.id === requestSelect.value);
    ticketIdInput.value = selected?.ticketId || "";
    technicianInput.value = selected?.technician?.name || "";
    commentsRequired.classList.toggle("d-none", !requiresComments());
    commentsInput.required = requiresComments();
    submitButton.disabled = !selected;
    $("requesterFeedbackSubmitHelp").textContent = selected
      ? `Feedback will be linked to ${selected.ticketId}.`
      : "Select an eligible request to begin.";
  }

  function selectedRating(name) {
    const selected = form.querySelector(`input[name="${name}"]:checked`);
    return selected ? Number(selected.value) : null;
  }

  function ratingText(value) {
    return value ? `${"★".repeat(value)}${"☆".repeat(5 - value)} (${value}/5)` : "—";
  }

  function statusBadge(status) {
    const classes = {
      Submitted: "text-bg-primary",
      Reviewed: "text-bg-success",
      "Follow-up Required": "text-bg-warning",
    };
    const badge = document.createElement("span");
    badge.className = `badge ${classes[status] || "text-bg-secondary"}`;
    badge.textContent = status || "Submitted";
    return badge.outerHTML;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  }

  async function loadEligibleRequests() {
    const result = await apiRequest(`${API_PATH}/eligible-requests`);
    eligibleRequests = Array.isArray(result.data) ? result.data : [];
    requestSelect.replaceChildren(new Option(
      eligibleRequests.length ? "Select a completed request" : "No completed requests available",
      "",
    ));
    eligibleRequests.forEach((request) => {
      const option = new Option(
        `${request.ticketId} — ${request.title}`,
        request.id,
      );
      requestSelect.add(option);
    });
    requestSelect.disabled = eligibleRequests.length === 0;
    if (!eligibleRequests.length) {
      $("requesterFeedbackSubmitHelp").textContent =
        "Feedback becomes available when a completed request with an assigned technician is recorded.";
    }
    updateFormState();
  }

  async function loadHistory() {
    const result = await apiRequest(`${API_PATH}/mine`);
    const records = Array.isArray(result.data) ? result.data : [];
    if (!records.length) {
      historyBody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted py-4">You have not submitted feedback yet.</td></tr>';
      return;
    }
    historyBody.innerHTML = records.map((record) => `
      <tr>
        <td><strong>${escapeHtml(record.ticket?.ticketId || "Request")}</strong><div class="small text-muted">${escapeHtml(record.ticket?.title || "")}</div></td>
        <td>${escapeHtml(record.technician?.fullName || "—")}</td>
        <td class="small">Problem fixed: ${escapeHtml(record.problemFixed)}<br>Equipment working: ${escapeHtml(record.equipmentWorkingProperly)}<br>Comments: ${escapeHtml(record.comments || "—")}<br>Suggestions: ${escapeHtml(record.improvementSuggestions || "—")}</td>
        <td class="small">Technician: ${ratingText(record.technicianRating)}<br>Satisfaction: ${ratingText(record.satisfactionRating)}</td>
        <td>${formatDate(record.createdAt)}</td>
        <td>${statusBadge(record.status)}</td>
        <td>${escapeHtml(record.adminReviewComments || "No update yet.")}</td>
      </tr>`).join("");
  }

  async function initialize() {
    await Auth.load();
    const user = requireRole("Requester");
    if (!user) return;
    const name = $("topUserName");
    if (name) name.textContent = user.fullName || "";
    await Promise.all([loadEligibleRequests(), loadHistory()]);
  }

  requestSelect.addEventListener("change", updateFormState);
  fixedSelect.addEventListener("change", updateFormState);
  equipmentSelect.addEventListener("change", updateFormState);
  ["technicianRating", "satisfactionRating"].forEach((name) => {
    form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.addEventListener("change", () => {
        const target = $(name === "technicianRating" ? "technicianRatingValue" : "satisfactionRatingValue");
        if (target) target.textContent = `${input.value} out of 5 stars`;
      });
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    notice.classList.add("d-none");
    if (!form.reportValidity()) return;
    const payload = {
      ticketId: ticketIdInput.value,
      problemFixed: fixedSelect.value,
      equipmentWorkingProperly: equipmentSelect.value,
      technicianRating: selectedRating("technicianRating"),
      satisfactionRating: selectedRating("satisfactionRating"),
      comments: commentsInput.value,
      improvementSuggestions: $("requesterFeedbackSuggestions").value,
    };
    if (!payload.technicianRating || !payload.satisfactionRating) {
      showNotice("Please select both required star ratings.", "warning");
      return;
    }
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Submitting…';
    try {
      const result = await apiRequest(API_PATH, {
        method: "POST",
        body: payload,
      });
      form.reset();
      $("technicianRatingValue").textContent = "No rating selected";
      $("satisfactionRatingValue").textContent = "No rating selected";
      const refreshResults = await Promise.allSettled([
        loadEligibleRequests(),
        loadHistory(),
      ]);
      const refreshFailed = refreshResults.some(
        (refreshResult) => refreshResult.status === "rejected",
      );
      if (refreshFailed) {
        console.error("Feedback was saved, but the page could not refresh.");
        showNotice(
          "Your feedback was submitted, but the page could not refresh its lists. Reload to see the latest status.",
          "warning",
        );
      } else {
        showNotice(result.message || "Your feedback has been submitted.", "success");
      }
    } catch (error) {
      showNotice(error.message || "Feedback could not be submitted. Please try again.", "danger");
      submitButton.disabled = false;
    } finally {
      submitButton.innerHTML = '<i class="bi bi-send me-1" aria-hidden="true"></i>Submit Feedback';
      updateFormState();
    }
  });

  initialize().catch((error) => {
    console.error("Requester feedback initialization failed:", error);
    showNotice(error.message || "Unable to load Requester Feedback.", "danger");
    historyBody.innerHTML =
      '<tr><td colspan="7" class="text-center text-danger py-4">Could not load feedback. Refresh the page to try again.</td></tr>';
  });
})();
