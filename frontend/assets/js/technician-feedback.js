const TECHNICIAN_FEEDBACK_STATUS_VALUES = [
  "Submitted",
  "Under Review",
  "Action Required",
  "Resolved",
];

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.querySelector(".technician-feedback-page");
  if (!page) return;

  const pageHeader = page.querySelector(".technician-feedback-page-header");
  page.innerHTML = `${pageHeader?.outerHTML || ""}
    <div class="row g-3 mb-4" id="technicianFeedbackStats" aria-live="polite"></div>
    <div class="technician-feedback-workspace mb-4">
      <section class="card technician-feedback-panel mb-4" aria-labelledby="submitTechnicianFeedbackTitle">
        <div class="card-header bg-white border-bottom py-3">
          <h2 class="h6 fw-bold mb-1" id="submitTechnicianFeedbackTitle">Share technician feedback</h2>
          <p class="small text-muted mb-0">Report technical difficulties and maintenance improvement opportunities to ICT Administration.</p>
        </div>
        <div class="card-body">
          <div id="technicianFeedbackNotice" class="alert d-none" role="status" aria-live="polite"></div>
          <form id="technicianMaintenanceFeedbackForm" novalidate>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label" for="technicianFeedbackUser">Technician name</label>
                <input class="form-control" id="technicianFeedbackUser" readonly aria-readonly="true">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="technicianFeedbackId">Technician ID</label>
                <input class="form-control" id="technicianFeedbackId" readonly aria-readonly="true">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="technicianFeedbackTicket">Related maintenance request <span class="text-muted fw-normal">(optional)</span></label>
                <select class="form-select" id="technicianFeedbackTicket">
                  <option value="">Not linked to a specific request</option>
                </select>
                <div class="form-text">Only maintenance requests assigned to you are available.</div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="technicianFeedbackAsset">Equipment or asset <span class="text-muted fw-normal">(optional)</span></label>
                <select class="form-select" id="technicianFeedbackAsset">
                  <option value="">Not linked to a specific asset</option>
                </select>
                <div class="form-text">Assets are listed from your assigned maintenance work.</div>
              </div>
              <div class="col-12">
                <label class="form-label" for="technicianFeedbackCategory">Feedback category <span class="text-danger">*</span></label>
                <select class="form-select" id="technicianFeedbackCategory" required>
                  <option value="">Choose a feedback category</option>
                  <option>Technical Difficulty</option>
                  <option>Spare Parts Shortage</option>
                  <option>Recurring Fault</option>
                  <option>Resource Problem</option>
                  <option>Safety Concern</option>
                  <option>Improvement Suggestion</option>
                </select>
              </div>
              <div class="col-12">
                <label class="form-label" for="technicianFeedbackDescription">Feedback description <span class="text-danger">*</span></label>
                <textarea class="form-control" id="technicianFeedbackDescription" rows="5" maxlength="2000" required
                  placeholder="Describe the difficulty, recurring fault, shortage, safety concern, or improvement opportunity."></textarea>
                <div class="form-text">Required. Maximum 2,000 characters. Do not include passwords or other credentials.</div>
              </div>
              <div class="col-12">
                <label class="form-label" for="technicianFeedbackRecommendation">Recommendation or proposed solution</label>
                <textarea class="form-control" id="technicianFeedbackRecommendation" rows="3" maxlength="2000"
                  placeholder="Suggest a repair, resource, preventive action, or service improvement."></textarea>
                <div class="form-text">Optional. Maximum 2,000 characters.</div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for="technicianFeedbackFollowUp">Follow-up required <span class="text-danger">*</span></label>
                <select class="form-select" id="technicianFeedbackFollowUp" required>
                  <option value="">Choose Yes or No</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div class="col-12">
                <button class="btn btn-primary" id="submitTechnicianMaintenanceFeedbackBtn" type="submit">
                  <i class="bi bi-send me-1" aria-hidden="true"></i>Submit Feedback
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
      <section class="card technician-feedback-panel" aria-labelledby="technicianFeedbackHistoryTitle">
        <div class="card-header bg-white border-bottom py-3">
          <h2 class="h6 fw-bold mb-1" id="technicianFeedbackHistoryTitle">My Feedback History</h2>
          <p class="small text-muted mb-0">Review your submissions, current status, and reviewer comments.</p>
        </div>
        <div class="card-body" id="technicianFeedbackHistory" aria-live="polite" aria-busy="true">
          <p class="text-muted mb-0">Loading your feedback history...</p>
        </div>
      </section>
    </div>`;

  try {
    await Auth.load();
    const user = requireRole("Technician");
    if (!user) return;
    document.getElementById("topUserName").textContent = user.fullName || "";
    document.getElementById("technicianFeedbackUser").value =
      user.fullName || "";
    document.getElementById("technicianFeedbackId").value =
      user.id || user._id || "";

    const [assignments] = await Promise.all([
      loadTechnicianFeedbackAssignments(),
      loadOwnTechnicianFeedback(),
    ]);
    populateTechnicianFeedbackRelations(assignments);
    bindTechnicianFeedbackForm();
  } catch (error) {
    console.error("Technician feedback initialization failed:", error);
    showTechnicianFeedbackNotice(
      error.message || "Unable to initialize technician feedback.",
    );
  }
});

function escapeTechnicianFeedbackHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showTechnicianFeedbackNotice(message, type = "danger") {
  const notice = document.getElementById("technicianFeedbackNotice");
  if (!notice) return;
  notice.className = `alert alert-${type}`;
  notice.textContent = message;
  notice.classList.remove("d-none");
}

async function loadTechnicianFeedbackAssignments() {
  try {
    const result = await apiRequest("/technicians/my/assignments");
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load assigned maintenance work.");
    }
    return result.data;
  } catch (error) {
    showToast(
      error.message || "Unable to load assigned maintenance work.",
      "warning",
    );
    return [];
  }
}

function populateTechnicianFeedbackRelations(assignments) {
  const requestSelect = document.getElementById("technicianFeedbackTicket");
  const assetSelect = document.getElementById("technicianFeedbackAsset");
  const tickets = new Map();
  const assets = new Map();
  assignments.forEach((assignment) => {
    if (!assignment.ticket_id) return;
    tickets.set(String(assignment.ticket_id), assignment);
    if (assignment.assetId) {
      assets.set(String(assignment.assetId), {
        id: String(assignment.assetId),
        tag: assignment.assetTag || "",
        name: assignment.assetName || "",
      });
    }
  });
  tickets.forEach((assignment, id) => {
    const label = [
      assignment.ticketId || "Maintenance request",
      assignment.title,
    ]
      .filter(Boolean)
      .join(" — ");
    requestSelect.add(new Option(label, id));
  });
  assets.forEach((asset) => {
    const label = [asset.tag, asset.name].filter(Boolean).join(" — ");
    assetSelect.add(new Option(label || "Assigned asset", asset.id));
  });
  requestSelect.addEventListener("change", () => {
    const assignment = tickets.get(requestSelect.value);
    assetSelect.value = assignment?.assetId
      ? String(assignment.assetId)
      : "";
  });
}

function bindTechnicianFeedbackForm() {
  const form = document.getElementById("technicianMaintenanceFeedbackForm");
  const submitButton = document.getElementById(
    "submitTechnicianMaintenanceFeedbackBtn",
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const description = document
      .getElementById("technicianFeedbackDescription")
      .value.trim();
    const recommendation = document
      .getElementById("technicianFeedbackRecommendation")
      .value.trim();
    if (!form.reportValidity()) return;
    if (!description || description.length > 2000 || recommendation.length > 2000) {
      showTechnicianFeedbackNotice(
        "Enter a description and keep the description and recommendation within 2,000 characters.",
      );
      return;
    }

    submitButton.disabled = true;
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Submitting...';
    try {
      const result = await apiRequest("/feedback/technician", {
        method: "POST",
        body: {
          ticketId:
            document.getElementById("technicianFeedbackTicket").value || null,
          assetId:
            document.getElementById("technicianFeedbackAsset").value || null,
          category: document.getElementById("technicianFeedbackCategory").value,
          description,
          recommendation,
          followUpRequired:
            document.getElementById("technicianFeedbackFollowUp").value ===
            "true",
        },
      });
      if (result?.success !== true || !result.data?.id) {
        throw new Error(result?.message || "Feedback submission was not confirmed.");
      }
      showTechnicianFeedbackNotice(
        `Feedback submitted successfully. Feedback ID: ${result.data.id}`,
        "success",
      );
      form.reset();
      await loadOwnTechnicianFeedback();
      showToast("Technician feedback submitted successfully.", "success");
    } catch (error) {
      showTechnicianFeedbackNotice(
        error.message || "Unable to submit technician feedback.",
      );
      showToast(error.message || "Unable to submit technician feedback.", "danger");
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = originalHtml;
    }
  });
}

async function loadOwnTechnicianFeedback() {
  const container = document.getElementById("technicianFeedbackHistory");
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  container.innerHTML =
    '<p class="text-muted mb-0">Loading your feedback history...</p>';
  try {
    const result = await apiRequest("/feedback/technician/mine");
    if (result?.success !== true || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to load your feedback.");
    }
    renderOwnTechnicianFeedback(result.data);
  } catch (error) {
    container.innerHTML = `<div class="alert alert-danger mb-0">${escapeTechnicianFeedbackHtml(error.message || "Unable to load your feedback.")}</div>`;
    showToast(error.message || "Unable to load your feedback.", "danger");
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

function renderOwnTechnicianFeedback(records) {
  const container = document.getElementById("technicianFeedbackHistory");
  const stats = document.getElementById("technicianFeedbackStats");
  const counts = Object.fromEntries(
    TECHNICIAN_FEEDBACK_STATUS_VALUES.map((status) => [
      status,
      records.filter((record) => record.status === status).length,
    ]),
  );
  stats.innerHTML = `
    <div class="col-6 col-lg"><div class="card border-0 shadow-sm p-3"><div class="small text-muted">Total feedback</div><strong class="fs-4">${records.length}</strong></div></div>
    ${TECHNICIAN_FEEDBACK_STATUS_VALUES.map((status) => `
      <div class="col-6 col-lg"><div class="card border-0 shadow-sm p-3"><div class="small text-muted">${escapeTechnicianFeedbackHtml(status)}</div><strong class="fs-4">${counts[status]}</strong></div></div>
    `).join("")}`;
  if (!records.length) {
    container.innerHTML =
      '<p class="text-muted mb-0">You have not submitted technician feedback yet.</p>';
    return;
  }
  container.innerHTML = records
    .map((record) => {
      const ticket = record.ticket;
      const asset = record.asset;
      const reference = [
        ticket?.ticketId ? `Request ${ticket.ticketId}` : "",
        asset?.asset_tag || asset?.asset_name
          ? `Asset ${asset.asset_tag || asset.asset_name}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const submittedAt = record.submittedAt || record.createdAt;
      const formattedDate = submittedAt
        ? new Date(submittedAt).toLocaleString()
        : "—";
      return `<article class="technician-feedback-record">
        <div class="d-flex flex-wrap justify-content-between gap-2">
          <div>
            <h3 class="h6 fw-bold mb-1">${escapeTechnicianFeedbackHtml(record.category || "Technician feedback")}</h3>
            <div class="small text-muted">Feedback ID: ${escapeTechnicianFeedbackHtml(record._id || record.id || "—")}</div>
          </div>
          <span class="badge text-bg-${record.status === "Resolved" ? "success" : record.status === "Action Required" ? "danger" : record.status === "Under Review" ? "info" : "secondary"}">${escapeTechnicianFeedbackHtml(record.status || "Submitted")}</span>
        </div>
        ${reference ? `<div class="small text-muted mt-2">${escapeTechnicianFeedbackHtml(reference)}</div>` : ""}
        <p class="mt-3">${escapeTechnicianFeedbackHtml(record.description || record.message || "")}</p>
        ${record.recommendation ? `<div class="technician-feedback-details"><strong class="small">Recommendation</strong><p class="technician-feedback-message-full mt-1">${escapeTechnicianFeedbackHtml(record.recommendation)}</p></div>` : ""}
        <div class="feedback-record-meta">
          <div><div class="small text-muted">Follow-up required</div><strong>${record.followUpRequired === true ? "Yes" : record.followUpRequired === false ? "No" : "—"}</strong></div>
          <div><div class="small text-muted">Submitted</div><strong>${escapeTechnicianFeedbackHtml(formattedDate)}</strong></div>
        </div>
        ${record.reviewComments ? `<div class="alert alert-light border mt-3 mb-0"><strong>Reviewer comments</strong><p class="mb-0 mt-1">${escapeTechnicianFeedbackHtml(record.reviewComments)}</p></div>` : ""}
      </article>`;
    })
    .join("");
}
