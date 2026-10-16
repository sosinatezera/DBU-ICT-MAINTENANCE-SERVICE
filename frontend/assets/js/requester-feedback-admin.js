(() => {
  const body = document.getElementById("adminRequesterFeedbackBody");
  if (!body) return;

  const API_PATH = "/requester-feedback/admin";
  const pageSize = 50;
  const statusFilter = document.getElementById("adminRequesterFeedbackStatus");
  const notice = document.getElementById("adminRequesterFeedbackNotice");
  const previousButton = document.getElementById("adminRequesterFeedbackPrevious");
  const nextButton = document.getElementById("adminRequesterFeedbackNext");
  let page = 1;
  let pages = 1;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  function notify(message, type = "danger") {
    notice.className = `alert alert-${type} mb-0`;
    notice.textContent = message;
    notice.classList.remove("d-none");
  }

  function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }

  function render(records) {
    if (!records.length) {
      body.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No Requester Feedback found.</td></tr>';
      return;
    }
    body.innerHTML = records.map((record) => `
      <tr data-requester-feedback-row="${esc(record._id)}">
        <td>${esc(record.requester?.fullName || "—")}<div class="small text-muted">${esc(record.requester?.department || "")}</div></td>
        <td><strong>${esc(record.ticket?.ticketId || "—")}</strong><div class="small text-muted">${esc(record.ticket?.title || "")}</div></td>
        <td>${esc(record.technician?.fullName || "—")}</td>
        <td>Problem fixed: ${esc(record.problemFixed)}<br>Equipment working: ${esc(record.equipmentWorkingProperly)}</td>
        <td>Technician: ${esc(record.technicianRating)}/5<br>Satisfaction: ${esc(record.satisfactionRating)}/5</td>
        <td class="requester-feedback-text">${esc(record.comments || "—")}</td>
        <td class="requester-feedback-text">${esc(record.improvementSuggestions || "—")}</td>
        <td>${dateText(record.createdAt)}</td>
        <td>
          <label class="visually-hidden" for="reviewStatus-${esc(record._id)}">Review status</label>
          <select class="form-select form-select-sm mb-2" id="reviewStatus-${esc(record._id)}" data-review-status>
            ${["Submitted", "Reviewed", "Follow-up Required"].map((status) =>
              `<option${status === record.status ? " selected" : ""}>${status}</option>`).join("")}
          </select>
          <label class="visually-hidden" for="reviewNotes-${esc(record._id)}">Admin review notes</label>
          <textarea class="form-control form-control-sm mb-2" id="reviewNotes-${esc(record._id)}" rows="2" maxlength="2000" data-review-notes placeholder="Optional update for requester">${esc(record.adminReviewComments || "")}</textarea>
          <button class="btn btn-sm btn-primary" type="button" data-save-review="${esc(record._id)}">Save review</button>
          ${record.reviewedAt ? `<div class="small text-muted mt-1">Updated ${dateText(record.reviewedAt)}</div>` : ""}
        </td>
      </tr>`).join("");
  }

  async function load() {
    body.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">Loading Requester Feedback…</td></tr>';
    notice.classList.add("d-none");
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (statusFilter.value) params.set("status", statusFilter.value);
    try {
      const result = await apiRequest(`${API_PATH}?${params}`);
      render(Array.isArray(result.data) ? result.data : []);
      const pagination = result.pagination || {};
      pages = Math.max(1, Number(pagination.pages) || 1);
      page = Math.min(page, pages);
      const total = Number(pagination.total) || 0;
      document.getElementById("adminRequesterFeedbackPageInfo").textContent =
        `Page ${page} of ${pages} · ${total} submission${total === 1 ? "" : "s"}`;
      previousButton.disabled = page <= 1;
      nextButton.disabled = page >= pages;
    } catch (error) {
      body.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-4">Could not load Requester Feedback.</td></tr>';
      notify(error.message || "Unable to load Requester Feedback.");
    }
  }

  body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-review]");
    if (!button) return;
    button.disabled = true;
    try {
      const row = button.closest("[data-requester-feedback-row]");
      const id = button.dataset.saveReview;
      await apiRequest(`${API_PATH}/${encodeURIComponent(id)}/review`, {
        method: "PATCH",
        body: {
          status: row.querySelector("[data-review-status]").value,
          adminReviewComments: row.querySelector("[data-review-notes]").value,
        },
      });
      notify("Requester feedback review was saved.", "success");
      await load();
    } catch (error) {
      notify(error.message || "Unable to save the feedback review.");
    } finally {
      button.disabled = false;
    }
  });

  statusFilter.addEventListener("change", () => {
    page = 1;
    void load();
  });
  document.getElementById("adminRequesterFeedbackRefresh").addEventListener("click", () => void load());
  previousButton.addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      void load();
    }
  });
  nextButton.addEventListener("click", () => {
    if (page < pages) {
      page += 1;
      void load();
    }
  });

  (async () => {
    await Auth.load();
    if (!requireRole("ICT Admin")) return;
    void load();
  })().catch((error) => {
    console.error("Admin Requester Feedback initialization failed:", error);
    notify(error.message || "Unable to initialize Requester Feedback.");
  });
})();
