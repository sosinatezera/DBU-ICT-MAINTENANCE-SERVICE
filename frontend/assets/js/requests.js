/* ============================================================
   requests.js  —  All User/Admin Request Logic
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const p = window.location.pathname;

  try {
    if (!requireAuth()) return;
    if (p.includes('user/dashboard'))    await initUserDashboard();
    if (p.includes('user/request'))      await initSubmitRequest();
    if (p.includes('user/tracking'))     await initTracking();
    if (p.includes('user/history'))      await initUserHistory();
    if (p.includes('user/feedback'))     await initFeedback();
    if (p.includes('admin/requests'))    await initAdminRequests();
    if (p.includes('admin/admin-feedback')) await initAdminFeedbackPage();
    if (p.includes('admin/categories'))  await initCategories();
    if (p.includes('admin/users'))       await initUserManagement();
  } catch (err) {
    console.error('Page initialization failed:', err);
    if (err && err.message) showToast(err.message, 'danger');
  } finally {
    /* Only run settleStoppedLoaders if we're still on the same page (no redirect happened).
       Check if the page is still visible and not navigating away. */
    if (!window.__authRedirecting && document.visibilityState !== 'hidden') {
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
  const areas = [
    ['categoriesTableBody', 5],
    ['requestsTableBody', 9],
    ['adminFeedbackTableBody', 7],
    ['usersTableBody', 8],
    ['historyTableBody', 8],
    ['recentRequestsBody', 7],
  ];
  const isStuck = (label) => /^Loading\s+(categories|requests|users|history|stats)\.\.\.$/i.test((label || '').trim());

  areas.forEach(([id, cols]) => {
    const el = document.getElementById(id);
    if (el && isStuck(el.textContent) && !el.querySelector('button')) {
      el.innerHTML = `<tr><td colspan="${cols}" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load data — the page did not finish initializing.</p>
        <button class="btn btn-sm btn-outline-primary" onclick="window.location.reload()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
  });

  const adminFbWrap = document.getElementById('adminFeedbackWrap') || document.getElementById('adminFeedbackList');
  const stats = document.getElementById('categoryStats');
  if (stats && /^Loading\s+stats\.\.\.$/i.test((stats.textContent || '').trim())) {
    stats.innerHTML = `<div class="text-center text-danger py-3">Failed to load stats.</div>`;
  }
  if (adminFbWrap) {
    const wrapText = (adminFbWrap.textContent || '').trim();
    if (/^Loading\s+feedback\.\.\.$/i.test(wrapText)) {
      adminFbWrap.innerHTML = `<div class="text-center text-danger py-4">Failed to load feedback.</div>`;
    }
  }

  const trackingList = document.getElementById('requestsList');
  if (trackingList) {
    const isStuck = /^Loading\s+requests?\.\.\.$/i.test((trackingList.textContent || '').trim())
      || !!trackingList.querySelector('.tk-skeleton-line');
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

  /* ── Additional placeholders not covered above ─────────────── */
  const myFeedbackBody = document.getElementById('myFeedbackBody');
  if (myFeedbackBody && /^Loading\s+feedback\.\.\.$/i.test((myFeedbackBody.textContent || '').trim())) {
    myFeedbackBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">
      <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
      <p class="text-danger mb-2">Failed to load feedback.</p>
      <button class="btn btn-sm btn-outline-primary" onclick="initUserDashboard()">
        <i class="bi bi-arrow-clockwise me-1"></i>Retry
      </button>
    </td></tr>`;
  }

  const pendingFeedbackList = document.getElementById('pendingFeedbackList');
  if (pendingFeedbackList && /^Loading\.\.\.$/i.test((pendingFeedbackList.textContent || '').trim())) {
    pendingFeedbackList.innerHTML = `<div class="text-center py-4">
      <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
      <p class="text-danger mb-2">Failed to load requests for feedback.</p>
      <button class="btn btn-sm btn-outline-primary" onclick="initFeedback()">
        <i class="bi bi-arrow-clockwise me-1"></i>Retry
      </button>
    </div>`;
  }

  const notificationsList = document.getElementById('notificationsList');
  if (notificationsList && /^Loading\s+notifications\.\.\.$/i.test((notificationsList.textContent || '').trim())) {
    notificationsList.innerHTML = `<div class="text-center py-5">
      <i class="bi bi-cloud-slash text-danger d-block mb-2 fs-3"></i>
      <p class="text-danger mb-2">Unable to load notifications.</p>
      <button class="btn btn-sm btn-outline-primary" onclick="initNotificationsPage()">
        <i class="bi bi-arrow-clockwise me-1"></i>Try Again
      </button>
    </div>`;
  }

  const statusMiniChart = document.getElementById('statusMiniChart');
  if (statusMiniChart && /^Loading\.\.\.$/i.test((statusMiniChart.textContent || '').trim())) {
    statusMiniChart.innerHTML = `<p class="text-muted small text-center py-2">Chart unavailable. <button class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button></p>`;
  }

  const recentActivityDash = document.getElementById('recentActivityDash');
  if (recentActivityDash && /^Loading\.\.\.$/i.test((recentActivityDash.textContent || '').trim())) {
    recentActivityDash.innerHTML = `<p class="text-muted small text-center py-2">Activity feed unavailable. <button class="btn btn-sm btn-outline-primary ms-2" onclick="initAdminDashboard()">Retry</button></p>`;
  }

  const serviceFeedbackPanel = document.getElementById('serviceFeedbackPanel');
  if (serviceFeedbackPanel && /^Loading\.\.\.$/i.test((serviceFeedbackPanel.textContent || '').trim())) {
    serviceFeedbackPanel.innerHTML = `<div class="text-center text-muted py-4">
      <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
      <p class="small mb-0">Feedback unavailable.</p>
      <a href="admin-feedback.html" class="btn btn-sm btn-outline-primary mt-2">Manage Feedback</a>
    </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   USER DASHBOARD
   ════════════════════════════════════════════════════════════ */
async function initUserDashboard() {
  if (!requireRole('Requester')) return;
  const user = Auth.getUser();

  const w = document.getElementById('welcomeName');
  if (w) w.textContent = user?.fullName || 'User';

  const tbody = document.getElementById('requestsTableBody');
  const fbBody = document.getElementById('myFeedbackBody');

  try {
    const { data } = await apiRequest('/tickets/my');

    let pending = 0, inProg = 0, completed = 0;
    data.forEach(r => {
      if (['submitted', 'under_review', 'assigned', 'accepted'].includes(r.status)) pending++;
      if (r.status === 'in_progress') inProg++;
      if (['resolved', 'closed'].includes(r.status)) completed++;
    });

    animNum('totalRequests',      data.length);
    animNum('pendingRequests',    pending);
    animNum('inProgressRequests', inProg);
    animNum('completedRequests',  completed);

    if (!tbody) return;

    /* Render the "My Feedback" panel regardless of how many tickets exist
       (renderMyFeedback handles the empty case, so it must run even when
       there are no tickets — otherwise the panel stays stuck on its loader). */
    renderMyFeedback(data);

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="text-center py-5">
          <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i>
          <p class="text-muted mb-3">No requests yet.</p>
          <a href="request.html" class="btn btn-primary btn-sm">Submit your first request</a>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = data.slice(0, 6).map(r => `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
        <td>
          <div style="max-width:180px;" class="text-truncate" title="${escHtml(r.problemDescription)}">${escHtml(r.problemDescription)}</div>
        </td>
        <td><span class="badge bg-light text-dark border">${escHtml(r.equipmentType||'—')}</span></td>
        <td>${priorityBadge(r.priority)}</td>
        <td>${statusBadge(r.status)}</td>
        <td><small class="text-muted">${formatDate(r.created_at)}</small></td>
        <td class="text-nowrap">
          <div class="d-flex gap-1 align-items-center">
            <button class="btn btn-sm btn-outline-primary py-0 px-2"
                    onclick="openDetailModal('${r.id}')"
                    data-bs-toggle="modal" data-bs-target="#requestDetailModal"
                    title="View request details">
              <i class="bi bi-eye"></i>
            </button>
            ${requesterFeedbackAction(r)}
          </div>
        </td>
      </tr>`).join('');

  } catch (err) {
    console.error('Load requests failed:', err);
    showToast(err.message, 'danger');
    /* Never leave the loader hanging — show the real error + a Retry action. */
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load requests: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initUserDashboard()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
    /* Also handle the My Feedback panel so its loader is never left hanging. */
    if (fbBody) {
      fbBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load feedback: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initUserDashboard()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
  }
}

/* ── Dashboard "Submit Feedback" action per completed request ─
   The button deep-links with the real MongoDB _id in the query string. The
   visible Ticket ID (e.g. TK-0019) is display-only and is never used as the
   API id. When the backend reports feedback exists (has_requester_feedback /
   feedbackRating) a "Feedback Submitted" badge replaces the button so a
   request can never be rated twice from the dashboard. */
function requesterFeedbackAction(r) {
  if (!r) return '';
  if (r.has_requester_feedback || r.feedbackRating) {
    return `<span class="badge bg-success align-self-center" title="Feedback already submitted for ${escHtml(r.ticketId || r.id)}">
      <i class="bi bi-check2-circle me-1"></i>Feedback Submitted</span>`;
  }
  if (['resolved', 'closed'].includes(r.status)) {
    return `<a class="btn btn-sm btn-primary py-0 px-2 submit-feedback-btn"
            href="feedback.html?ticketId=${encodeURIComponent(r.id)}"
            title="Submit feedback for ${escHtml(r.ticketId || r.id)}">
      <i class="bi bi-star me-1"></i>Submit Feedback</a>`;
  }
  return '';
}

/* ── Render "My Feedback" panel on the Requester dashboard ──── */
function renderMyFeedback(tickets) {
  const body = document.getElementById('myFeedbackBody');
  if (!body) return;

  const feedbackList = (tickets || [])
    .filter(r => r.has_requester_feedback || r.feedbackRating)
    .sort((a, b) => new Date((b.requester_feedback && b.requester_feedback.submittedAt) || b.updated_at || 0) -
                      new Date((a.requester_feedback && a.requester_feedback.submittedAt) || a.updated_at || 0));

  const pendingCount = (tickets || []).filter(r =>
    ['resolved', 'closed'].includes(r.status) && !r.has_requester_feedback
  ).length;

  if (!feedbackList.length && !pendingCount) {
    body.innerHTML = `<tr><td colspan="5">
      <div class="text-center py-4 text-muted">
        <i class="bi bi-star fs-3 d-block mb-2 text-warning"></i>
        <p class="mb-0">No feedback yet. Rate your resolved requests to help improve our service.</p>
      </div>
    </td></tr>`;
    return;
  }

  const rows = feedbackList.slice(0, 6).map(r => {
    const fb = r.requester_feedback || {};
    const rating = fb.overallRating != null ? fb.overallRating : r.feedbackRating;
    let stars = '<span class="text-muted">—</span>';
    if (rating) stars = '<span class="text-warning">' + '★'.repeat(rating) + '</span><span class="text-muted">' + '☆'.repeat(5 - rating) + '</span>';
    const service = fb.serviceQuality ? escHtml(fb.serviceQuality) : '—';
    const status = '<span class="badge bg-success">Submitted</span>';
    const date = fb.submittedAt ? formatDate(fb.submittedAt) : '—';
    return `
      <tr>
        <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
        <td>${service}</td>
        <td>${stars}</td>
        <td>${status}</td>
        <td><small class="text-muted">${date}</small></td>
      </tr>`;
  }).join('');

  const pendingRow = pendingCount && !feedbackList.length ? `
    <tr>
      <td colspan="5">
        <div class="alert alert-info py-2 small mb-0">
          <i class="bi bi-info-circle me-1"></i>
          You have <strong>${pendingCount}</strong> resolved request${pendingCount > 1 ? 's' : ''} awaiting your feedback.
          <a href="feedback.html" class="alert-link">Rate now</a>
        </div>
      </td>
    </tr>` : '';

  body.innerHTML = rows + pendingRow;
}

/* ═══════════════════════════════════════════════════════════
   SUBMIT REQUEST
   ═══════════════════════════════════════════════════════════ */

/* Lock flag to guarantee a request is sent to the backend exactly once —
   prevents duplicate database records from repeated clicks. */
let _submittingTicket = false;

async function initSubmitRequest() {
  if (!requireRole('Requester')) return;
  const user = Auth.getUser();
  const nameEl = document.getElementById('requesterName');
  if (nameEl && !nameEl.value && user?.fullName) nameEl.value = user.fullName;

  /* Attach real-time validation */
  attachRealTimeValidation('requestForm', [
    { fieldId: 'requesterName', checks: [v => Validators.name(v, 'Full name')] },
    { fieldId: 'title', checks: [v => Validators.length(v, 'Title', 5, 200)] },
    { fieldId: 'description', checks: [v => Validators.length(v, 'Description', 20, 1000)] },
    { fieldId: 'requesterPhone', checks: [Validators.phone] },
  ]);

  /* Real-time validation for category dropdown */
  const categoryEl = document.getElementById('category');
  if (categoryEl) {
    categoryEl.addEventListener('change', () => {
      if (categoryEl.value) {
        clearFieldValidation('category');
        showFieldValid('category');
      }
    });
    categoryEl.addEventListener('blur', () => {
      if (!categoryEl.value) {
        showFieldError('category', 'Please select a request category.');
      }
    });
  }

  /* Real-time validation for asset dropdown */
  const assetEl = document.getElementById('asset');
  if (assetEl) {
    assetEl.addEventListener('change', () => {
      clearFieldValidation('asset');
      if (assetEl.value) {
        showFieldValid('asset');
      }
    });
  }

  await loadAssets();

  document.getElementById('description')?.addEventListener('input', function () {
    const el = document.getElementById('descCount');
    if (el) el.textContent = `${this.value.length} / 1000`;
  });

  document.querySelectorAll('input[name="deviceType"]').forEach(r => {
    r.addEventListener('change', () => {
      document.querySelectorAll('input[name="deviceType"]+label').forEach(l => {
        l.style.cssText = '';
      });
      const lbl = r.nextElementSibling;
      if (lbl) { lbl.style.borderColor='#2563eb'; lbl.style.background='#e8f0fe'; lbl.style.color='#2563eb'; }
    });
  });

  document.getElementById('previewBtn')?.addEventListener('click', showPreview);
  document.getElementById('clearBtn')?.addEventListener('click', clearRequestFormConfirm);
  document.getElementById('clearFormConfirmBtn')?.addEventListener('click', clearRequestForm);

  document.getElementById('requestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const form      = e.target;
    const submitBtn = document.getElementById('submitBtn');

    /* ── Duplicate-submission guard ──
       While a request is in flight, or after it has already been successfully
       saved, repeated clicks must never create a second database record. */
    if (_submittingTicket) return;
    if (submitBtn && submitBtn.disabled) return;

    /* Validate every required field once — the same checks & messages used by the
       Preview button, so Submit and Preview always agree on what is required. */
    const { hasError, deviceType, catValue, file } = validateRequestFormFields();

    if (hasError) {
      /* Scroll to first error */
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    /* Build the multipart body — field names match the backend exactly:
       title, equipmentType, problemDescription, priority, phone, category,
       asset_id, attachment. */
    const fd = new FormData();
    fd.append('title',              document.getElementById('title').value.trim());
    fd.append('equipmentType',      deviceType);
    fd.append('problemDescription', document.getElementById('description').value.trim());
    fd.append('priority',           document.getElementById('priority').value);
    fd.append('phone',              document.getElementById('requesterPhone').value.trim());
    fd.append('category',           catValue);

    /* Append asset selection */
    const assetValue = document.getElementById('asset')?.value;
    if (assetValue && assetValue !== 'none') {
      fd.append('asset_id', assetValue);
    }

    if (file) fd.append('attachment', file);

    /* Lock submit — disabled immediately while processing. Re-enabled ONLY on a
       FAILED submission so retry is possible; after success the page redirects
       to Track Request, so a duplicate database record can never be created. */
    _submittingTicket = true;
    setSubmitButtonLoading(true);

    try {
      /* apiRequest only resolves on a 2xx response — i.e. AFTER the backend
         validated the request and saved it to MongoDB via POST /api/tickets.
         The ticketId/date below are therefore the real stored values, never a
         fake frontend-generated ID. */
      const res = await apiRequest('/tickets', { method: 'POST', body: fd, isFormData: true });

      const mongoId  = res?.data?.id       || '';
      const ticketId = res?.data?.ticketId || '';
      const created  = res?.data?.created_at || res?.data?.createdAt || '';

      /* Professional success notification with the real Request ID. */
      showToast(`Maintenance request submitted successfully. Request ID: ${ticketId}.`, 'success');
      const alert = document.getElementById('requestAlert');
      if (alert) {
        alert.className = 'alert alert-success d-flex align-items-start gap-2';
        alert.innerHTML = `
          <i class="bi bi-check-circle-fill fs-4 flex-shrink-0"></i>
          <div>
            <div><strong>Maintenance request submitted successfully.</strong></div>
            <div class="small mt-1">Request ID: <strong>${escHtml(ticketId)}</strong></div>
            ${created ? `<div class="small text-muted mt-1">Submitted: ${formatDateTime(created)}</div>` : ''}
            <div class="small text-muted mt-1"><i class="bi bi-box-arrow-right me-1"></i>Redirecting to Track Request...</div>
          </div>`;
      }

      /* Auto-redirect to the Track Request page and deep-link the new request
         using its real MongoDB ID. loadTrackingRequests() already auto-opens
         the detail modal for any ?id=<mongoId> in the URL. */
      const trackUrl = mongoId
        ? `tracking.html?id=${encodeURIComponent(mongoId)}`
        : 'tracking.html';
      setTimeout(() => { window.location.href = trackUrl; }, 2500);
    } catch (err) {
      console.error('Submit request failed:', err);
      /* Show the real backend error without hiding it — no redirect. */
      showAlert('requestAlert', `Unable to submit request. Please try again. (${err.message})`, 'danger');
      /* Re-enable only here — the attempt failed, so the user may retry.
         Their entered form data is left untouched. */
      _submittingTicket = false;
      setSubmitButtonLoading(false);
    }
  });
}

/* ── Submit button state (New Request form) ────────────────
   idle → [ send icon ] Submit Request          (enabled)
   busy → [ spinner ] Submitting Request...     (disabled) */
function setSubmitButtonLoading(isLoading) {
  const btn   = document.getElementById('submitBtn');
  const sp    = document.getElementById('submitSpinner');
  const icon  = document.getElementById('submitIcon');
  const label = document.getElementById('submitBtnLabel');
  if (btn)   btn.disabled = isLoading;
  if (sp)    sp.classList.toggle('d-none', !isLoading);
  if (icon)  icon.classList.toggle('d-none', isLoading);
  if (label) label.textContent = isLoading ? 'Submitting Request...' : 'Submit Request';
  /* While the request is in flight the whole action area is locked so no
     secondary click can interfere with (or duplicate) the submission. */
  ['previewBtn', 'clearBtn'].forEach(id => {
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

  const nameErr = Validators.name(document.getElementById('requesterName')?.value, 'Full name');
  if (nameErr) { showFieldError('requesterName', nameErr); hasError = true; } else { showFieldValid('requesterName'); }

  const titleErr = Validators.length(document.getElementById('title')?.value, 'Title', 5, 200);
  if (titleErr) { showFieldError('title', titleErr); hasError = true; } else { showFieldValid('title'); }

  const deviceType = document.querySelector('input[name="deviceType"]:checked')?.value;
  const devErr     = document.getElementById('deviceTypeError');
  if (!deviceType) {
    if (devErr) { devErr.textContent = 'Please select a device type.'; devErr.style.display = 'block'; }
    hasError = true;
  } else if (devErr) { devErr.style.display = 'none'; }

  const catValue = document.getElementById('category')?.value;
  if (!catValue) {
    showFieldError('category', 'Please select a request category.');
    hasError = true;
  } else { showFieldValid('category'); }

  if (!document.getElementById('priority')?.value) {
    showFieldError('priority', 'Please select a priority.');
    hasError = true;
  } else { clearFieldValidation('priority'); }

  const descErr = Validators.length(document.getElementById('description')?.value, 'Description', 20, 1000);
  if (descErr) { showFieldError('description', descErr); hasError = true; } else { showFieldValid('description'); }

  const phoneErr = Validators.phone(document.getElementById('requesterPhone')?.value);
  if (phoneErr) { showFieldError('requesterPhone', phoneErr); hasError = true; } else { clearFieldValidation('requesterPhone'); }

  /* Validate attachment: max 5 MB and allowed types (JPG, PNG, GIF, PDF, DOC, DOCX, XLSX, TXT). */
  const file = document.getElementById('attachment')?.files[0];
  if (file) {
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showFieldError('attachment', 'Attachment must be no larger than 5MB.');
      hasError = true;
    } else if (!/\.(jpeg|jpg|png|gif|pdf|doc|docx|xlsx|txt)$/i.test(file.name)) {
      showFieldError('attachment', 'Invalid file type. Allowed: JPG, PNG, PDF, DOC.');
      hasError = true;
    } else { clearFieldValidation('attachment'); }
  }

  return { hasError, deviceType, catValue, file };
}

/* ── Clear form action ─────────────────────────────────────
   The trash button wipes the unsaved New Request form ONLY — nothing has been
   saved yet, so there is NO database operation of any kind. A Bootstrap modal
   confirms the intent first; [Clear Form] then resets the form to pristine. */
function clearRequestFormConfirm() {
  const modal = document.getElementById('clearFormModal');
  if (modal) { bootstrap.Modal.getOrCreateInstance(modal).show(); }
  else { clearRequestForm(); }
}

function clearRequestForm() {
  const form = document.getElementById('requestForm');
  if (form) form.reset();

  /* Remove every validation class and dynamically-added .invalid-feedback */
  clearAllFieldValidations('requestForm');

  const devErr = document.getElementById('deviceTypeError');
  if (devErr) { devErr.textContent = ''; devErr.style.display = 'none'; }

  /* Undo the device-type radio highlight so the form looks idle again */
  document.querySelectorAll('input[name="deviceType"] + label').forEach(l => {
    l.style.borderColor = ''; l.style.background = ''; l.style.color = '';
  });

  /* Reset the description character counter */
  const cnt = document.getElementById('descCount');
  if (cnt) cnt.textContent = '0 / 1000';

  /* Hide the preview / summary card and any status alert */
  const summary = document.getElementById('summaryCard');
  if (summary) summary.classList.add('d-none');
  const content = document.getElementById('summaryContent');
  if (content) content.innerHTML = '';
  const alert = document.getElementById('requestAlert');
  if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }

  /* Re-run the priority border-colour handler (reset restored "medium") */
  const pri = document.getElementById('priority');
  if (pri) pri.dispatchEvent(new Event('change'));

  /* Restore the submit button to idle — nothing is in flight anymore */
  _submittingTicket = false;
  setSubmitButtonLoading(false);

  /* Close the confirmation modal if it was the entry point */
  const modal = document.getElementById('clearFormModal');
  if (modal && bootstrap.Modal.getInstance(modal)) bootstrap.Modal.getInstance(modal).hide();

  showToast('Form cleared.', 'info');
}

/* ── Live summary — never saved, reflects the form's current values ── */
function showPreview() {
  /* Preview must NOT create a MongoDB record. Block the summary when required
     fields are missing so the user is never shown a half-empty preview. */
  const { hasError, deviceType } = validateRequestFormFields();
  if (hasError) {
    const card = document.getElementById('summaryCard');
    if (card) card.classList.add('d-none');
    showAlert('requestAlert', 'Please complete the required fields before previewing.', 'warning');
    const firstInvalid = document.querySelector('.is-invalid');
    if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const name    = document.getElementById('requesterName')?.value || '—';
  const phone   = document.getElementById('requesterPhone')?.value || '—';
  const title   = document.getElementById('title')?.value || '—';
  const catEl   = document.getElementById('category');
  const cat     = catEl?.value || '—';
  const pri     = document.getElementById('priority')?.value || '—';
  const desc    = document.getElementById('description')?.value || '—';
  const assetEl = document.getElementById('asset');
  const asset   = assetEl?.value === 'none' ? 'No Asset / Not Applicable' : (assetEl?.selectedOptions[0]?.text || '—');
  const file    = document.getElementById('attachment')?.files[0];
  const attach  = file ? file.name : 'No attachment attached';
  const priC    = {low:'success',medium:'primary',high:'warning',critical:'danger'}[pri]||'secondary';
  const devI    = {'Desktop Computer':'bi-pc-display','Laptop':'bi-laptop','Printer':'bi-printer',
                   'Scanner':'bi-scanner','Monitor':'bi-tv','Projector':'bi-projector',
                   'UPS / Power Supply':'bi-battery-charging','Keyboard / Mouse':'bi-keyboard',
                   'Other':'bi-hdd-stack'}[deviceType] || 'bi-hdd-stack';

  const card    = document.getElementById('summaryCard');
  const content = document.getElementById('summaryContent');
  if (!card || !content) return;

  content.innerHTML = `
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Requester</div><div class="fw-semibold">${escHtml(name)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Phone</div><div class="fw-semibold">${escHtml(phone)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Device</div>
      <div class="fw-semibold text-capitalize"><i class="bi ${devI} me-1"></i>${escHtml(deviceType)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Priority</div>
      <span class="badge bg-${priC} text-capitalize">${pri}</span></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Category</div><div>${escHtml(cat)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">ICT Asset</div><div>${escHtml(asset)}</div></div>
    <div class="col-sm-6 col-md-4"><div class="text-muted small mb-1">Attachment</div>
      <div class="small text-truncate" title="${escHtml(attach)}"><i class="bi bi-paperclip me-1"></i>${escHtml(attach)}</div></div>
    <div class="col-12"><div class="text-muted small mb-1">Title</div><div class="fw-semibold">${escHtml(title)}</div></div>
    <div class="col-12"><div class="text-muted small mb-1">Problem Description</div>
      <div class="p-2 bg-white border rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(desc)}</div></div>`;

  card.classList.remove('d-none');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  if (!requireRole('Requester')) return;
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
    ({ data } = await apiRequest('/tickets/my'));
  } catch (err) {
    console.error('Load tracking failed:', err);
    showToast(err.message, 'danger');
    renderTrackingError(err);
    return;
  }

  _tracking.all = Array.isArray(data) ? data : [];
  /* Diagnostic — confirms exactly what the API returned for the logged-in user,
     so a "tracking shows 0" report can be traced immediately. */
  console.log('[Tracking] GET /api/tickets/my ->', data);
  applyTrackingFilter();

  /* Arrived from a notification click (tracking.html?id=...) → open it directly */
  const focusId = new URLSearchParams(window.location.search).get('id');
  if (focusId) openDetailModal(focusId);
}

function bindTrackingControls() {
  const byId = id => document.getElementById(id);
  const doFilter = () => applyTrackingFilter();

  byId('searchBtn')?.addEventListener('click', doFilter);
  byId('searchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doFilter(); });
  byId('searchInput')?.addEventListener('input', () => toggleClearFilters());
  byId('statusFilter')?.addEventListener('change', doFilter);
  byId('priorityFilter')?.addEventListener('change', doFilter);
  byId('sortFilter')?.addEventListener('change', doFilter);
  byId('clearFiltersBtn')?.addEventListener('click', () => {
    ['searchInput', 'statusFilter', 'priorityFilter'].forEach(id => { const el = byId(id); if (el) el.value = ''; });
    byId('sortFilter').value = 'newest';
    applyTrackingFilter();
  });
}

function toggleClearFilters() {
  const btn = document.getElementById('clearFiltersBtn');
  if (!btn) return;
  const active = !!document.getElementById('searchInput')?.value.trim()
    || !!document.getElementById('statusFilter')?.value
    || !!document.getElementById('priorityFilter')?.value;
  btn.classList.toggle('d-none', !active);
}

function currentTrackingFilters() {
  return {
    q:       (document.getElementById('searchInput')?.value || '').trim().toLowerCase(),
    status:   document.getElementById('statusFilter')?.value || '',
    priority: document.getElementById('priorityFilter')?.value || '',
    sort:     document.getElementById('sortFilter')?.value || 'newest',
  };
}

/* Search (by ID/title/device/description) + status + priority + sort. */
function applyTrackingFilter() {
  toggleClearFilters();
  const { q, status, priority, sort } = currentTrackingFilters();

  let list = _tracking.all.filter(r =>
    (!q  || `${r.ticketId||''} ${r.title||''} ${r.equipmentType||''} ${r.problemDescription||''}`.toLowerCase().includes(q)) &&
    (!status   || r.status === status) &&
    (!priority || r.priority === priority)
  );

  list.sort((a, b) => sort === 'oldest'
    ? new Date(a.created_at) - new Date(b.created_at)
    : new Date(b.created_at) - new Date(a.created_at));

  renderTrackingCards(list);
}

/* LOADING — skeleton shown only while the API request is running. */
function renderTrackingSkeleton() {
  const container = document.getElementById('requestsList');
  if (!container) return;
  const countEl = document.getElementById('trackingCount');
  if (countEl) countEl.textContent = '…';

  const card = i => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100 p-3">
        <div class="tk-skeleton-line mb-2" style="height:14px;width:45%;animation-delay:${i*0.08}s;"></div>
        <div class="tk-skeleton-line mb-2" style="height:16px;width:80%;animation-delay:${i*0.08}s;"></div>
        <div class="tk-skeleton-line mb-2" style="height:12px;width:60%;animation-delay:${i*0.08}s;"></div>
        <div class="tk-skeleton-line mb-3" style="height:14px;width:30%;animation-delay:${i*0.08}s;"></div>
        <div class="tk-skeleton-line" style="height:34px;width:100%;animation-delay:${i*0.08}s;"></div>
      </div>
    </div>`;
  container.innerHTML = Array.from({ length: 6 }, (_, i) => card(i)).join('');
}

/* SUCCESS — real requests returned from the database. */
function renderTrackingCards(list) {
  const container = document.getElementById('requestsList');
  if (!container) return;
  const countEl = document.getElementById('trackingCount');
  const countWrap = countEl?.closest('.d-flex');
  /* Count = TOTAL submissions from the DB, never the filtered subset. */
  if (countEl) countEl.textContent = _tracking.all.length;

  /* EMPTY — the authenticated requester has no requests at all. */
  if (!_tracking.all.length) {
    if (countWrap) countWrap.style.display = 'none';
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
  if (countWrap) countWrap.style.display = '';

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
    container.querySelector('#retryClearFiltersBtn')?.addEventListener('click', () => {
      ['searchInput', 'statusFilter', 'priorityFilter'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('sortFilter').value = 'newest';
      applyTrackingFilter();
    });
    return;
  }

  const priColour = { critical: '#dc3545', high: '#fd7e14', medium: '#2563eb', low: '#198754' };
  container.innerHTML = list.map(r => {
    const heading = (r.title || r.problemDescription || '').trim();
    return `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100" style="border-left:4px solid ${priColour[r.priority]||'#6c757d'}!important;">
        <div class="card-body p-3 d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
            <span class="fw-bold text-primary small">${escHtml(r.ticketId || r.id)}</span>
            ${priorityBadge(r.priority)}
          </div>
          <h6 class="fw-semibold mb-1" title="${escHtml(r.problemDescription)}">${escHtml(heading)}</h6>
          <div class="small text-muted mb-2">${escHtml(r.equipmentType || 'Uncategorised')}${r.category ? ' · ' + escHtml(r.category) : ''}</div>
          <div class="mb-2">${statusBadge(r.status)}</div>
          <div class="mt-auto pt-3 small text-muted">
            <div><i class="bi bi-calendar3 me-1"></i>Submitted ${formatDateTime(r.created_at)}</div>
            ${r.assignedTechnician ? `<div><i class="bi bi-wrench me-1"></i>Technician: ${escHtml(r.assignedTechnician)}</div>` : ''}
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
  }).join('');
}

/* ERROR — the API/database call failed. Shows the real reason too, but the
   primary message is the user-facing headline, with a live "Try Again". */
function renderTrackingError(err) {
  const container = document.getElementById('requestsList');
  if (!container) return;
  const countEl = document.getElementById('trackingCount');
  if (countEl) countEl.textContent = '—';

  container.innerHTML = `
    <div class="col-12">
      <div class="card border-0 shadow-sm text-center py-5">
        <div class="card-body">
          <i class="bi bi-cloud-slash fs-1 text-danger d-block mb-3"></i>
          <h6 class="fw-bold text-danger mb-1">Unable to load your requests.</h6>
          <p class="text-muted mb-1">The server could not be reached right now. Your requests are safe — try again.</p>
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
  container.querySelector('#retryTrackingBtn')?.addEventListener('click', () => loadTrackingRequests());
}

/* ═══════════════════════════════════════════════════════════
   REQUEST DETAIL MODAL (shared — user tracking + admin)
   ═══════════════════════════════════════════════════════════ */
async function openDetailModal(id) {
  const body = document.getElementById('requestDetailBody');
  if (body) body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;

  const modal = document.getElementById('requestDetailModal');
  if (modal && !bootstrap.Modal.getInstance(modal)) new bootstrap.Modal(modal).show();

  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);
    const mLabel = document.getElementById('requestDetailModalLabel');
    if (mLabel) mLabel.textContent = r.ticketId || 'Request Details';
    if (body) {
      body.innerHTML = `
        <div class="row g-3">
          <div class="col-md-8">
            <div class="text-muted small fw-bold text-uppercase mb-1">Ticket</div>
            <h5 class="mb-2">${escHtml(r.ticketId || r.id)}</h5>
            ${r.title ? `<h6 class="fw-semibold mb-3">${escHtml(r.title)}</h6>` : ''}
            ${r.requester_name ? `<div class="d-flex gap-3 mb-2 flex-wrap">
              <span class="text-muted small"><i class="bi bi-person me-1"></i><strong>${escHtml(r.requester_name)}</strong></span>
              ${r.phone ? `<span class="text-muted small"><i class="bi bi-telephone me-1"></i>${escHtml(r.phone)}</span>` : ''}
              ${r.equipmentType ? `<span class="text-muted small"><i class="bi bi-laptop me-1"></i>${escHtml(r.equipmentType)}</span>` : ''}
            </div>` : ''}
            <div class="text-muted small fw-bold text-uppercase mb-1 mt-2">Description</div>
            <div class="p-3 bg-light rounded" style="white-space:pre-wrap;font-size:.875rem;">${escHtml(r.problemDescription)}</div>
          </div>
          <div class="col-md-4">
            <div class="card bg-light border-0 p-3 h-100">
              <div class="mb-2"><div class="text-muted small mb-1">Status</div>${statusBadge(r.status)}</div>
              <div class="mb-2"><div class="text-muted small mb-1">Priority</div>${priorityBadge(r.priority)}</div>
              <div class="mb-2"><div class="text-muted small mb-1">Equipment</div><span class="small">${escHtml(r.equipmentType||'—')}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1">Category</div><span class="small">${escHtml(r.category||'—')}</span></div>
              ${r.asset_tag ? `<div class="mb-2"><div class="text-muted small mb-1">ICT Asset</div><span class="small fw-semibold"><i class="bi bi-pc-display me-1"></i>${escHtml(r.asset_tag)}${r.asset_name ? ` — ${escHtml(r.asset_name)}` : ''}</span></div>` : ''}
              ${r.attachment ? `<div class="mb-2"><div class="text-muted small mb-1">Attachment</div><a class="small" href="${escHtml(uploadUrl(r.attachment))}" target="_blank" rel="noopener"><i class="bi bi-paperclip me-1"></i>View attachment</a></div>` : ''}
              <div class="mb-2"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
              <div class="mb-2"><div class="text-muted small mb-1">Last Updated</div><span class="small">${formatDateTime(r.updated_at)}</span></div>
              ${r.assignedTechnician ? `<div><div class="text-muted small mb-1">Technician</div><span class="small fw-semibold text-success"><i class="bi bi-wrench me-1"></i>${escHtml(r.assignedTechnician)}</span></div>` : ''}
              ${r.resolutionResponse ? `<div class="mt-2 pt-2 border-top"><div class="text-muted small mb-1">Latest Update</div><span class="small">${escHtml(r.resolutionResponse)}</span></div>` : ''}
            </div>
          </div>
        </div>`;
    }

    const tl = document.getElementById('statusTimeline');
    if (tl) {
      const steps    = ['submitted', 'under_review', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed'];
      const labels   = ['Submitted', 'Under Review', 'Assigned', 'Accepted', 'In Progress', 'Resolved', 'Closed'];
      const current  = steps.indexOf(r.status);
      tl.innerHTML = steps.map((s, i) => {
        const done = i < current;
        const cur  = i === current;
        const bg   = done ? 'bg-success text-white' : cur ? 'bg-primary text-white' : 'bg-light text-muted border';
        return `
          <div class="d-flex flex-column align-items-center">
            <div class="rounded-circle d-flex align-items-center justify-content-center ${bg}"
                 style="width:32px;height:32px;font-size:.65rem;font-weight:700;">
              ${done ? '<i class="bi bi-check-lg"></i>' : i+1}
            </div>
            <div style="font-size:.65rem;" class="mt-1 text-center ${cur?'fw-bold text-primary':done?'text-success':'text-muted'}">${labels[i]}</div>
          </div>
          ${i < steps.length-1 ? `<div class="flex-grow-1 mt-3" style="height:2px;background:${done?'#198754':'#dee2e6'};margin:0 4px;"></div>` : ''}`;
      }).join('');
    }
  } catch (err) {
    if (body) body.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   USER HISTORY
   ════════════════════════════════════════════════════════════ */
async function initUserHistory() {
  if (!requireRole('Requester')) return;
  try {
    /* The full request history comes straight from MongoDB (GET /api/tickets/my).
       Every request the user has ever submitted appears here — newly submitted
       ones included — using the same record, ID and created date as everywhere
       else in the system. */
    const { data } = await apiRequest('/tickets/my');
    renderHistoryTable(data);

    document.getElementById('filterBtn')?.addEventListener('click', () => {
      const from = document.getElementById('dateFrom')?.value;
      const to   = document.getElementById('dateTo')?.value;
      const filtered = data.filter(r => {
        const d = new Date(r.created_at);
        return (!from || d >= new Date(from)) && (!to || d <= new Date(to + 'T23:59:59'));
      });
      renderHistoryTable(filtered);
    });

    document.getElementById('exportBtn')?.addEventListener('click', () => window.print());
  } catch (err) {
    console.error('Load history failed:', err);
    showToast(err.message, 'danger');
    const tbody = document.getElementById('historyTableBody');
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
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  if (!requests.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="text-center py-5">
      <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i><p class="text-muted">No history yet.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = requests.map(r => `
    <tr>
      <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
      <td class="text-truncate" style="max-width:160px;">${escHtml(r.problemDescription)}</td>
      <td>${escHtml(r.equipmentType||'—')}</td>
      <td>${escHtml(r.assignedTechnician||'—')}</td>
      <td>${formatDate(r.updated_at)}</td>
      <td>${r.feedbackRating ? '<span class="text-warning">'+'★'.repeat(r.feedbackRating)+'</span>' : '—'}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary py-0 px-2"
                onclick="openDetailModal('${r.id}')"
                data-bs-toggle="modal" data-bs-target="#requestDetailModal">
          <i class="bi bi-eye"></i>
        </button>
      </td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   REQUESTER FEEDBACK — Service Experience Survey
   ════════════════════════════════════════════════════════════ */
let _feedbackInitDone = false;
let _submittingFeedback = false;

async function initFeedback() {
  if (!requireRole('Requester')) return;
  /* Guard against duplicate initialization (in-page Retry, etc.) — the submit
     and star handlers must be bound exactly once. */
  if (_feedbackInitDone) return;
  try {
    const { data } = await apiRequest('/tickets/my');
    renderPendingFeedback(data.filter(r => ['resolved','closed'].includes(r.status) && !r.feedbackRating));
  } catch (err) {
    console.error('Load feedback requests failed:', err);
    showToast(err.message, 'danger');
    const container = document.getElementById('pendingFeedbackList');
    if (container) {
      container.innerHTML = `<div class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load requests for feedback: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initFeedback()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>`;
    }
  }

  /* Data + handlers in place; any further init call is a no-op. */
  _feedbackInitDone = true;

  initStarRating();

  document.getElementById('feedbackForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('feedbackRequestId').value;
    if (!id) { showAlert('feedbackAlert', 'Please select a request to give feedback on.', 'warning'); return; }

    const rating = document.getElementById('ratingValue').value;
    const ratingNum = Number(rating);
    if (!rating || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      showAlert('feedbackAlert', 'Please select an overall star rating (1-5 stars).', 'warning');
      return;
    }

    /* Required dropdown fields */
    const requiredSelects = [
      ['fbServiceQuality',    'Service quality'],
      ['fbProfessionalism',   'Technician professionalism'],
      ['fbResponseTime',      'Response time'],
      ['fbCommunication',     'Communication'],
      ['fbProblemResolution', 'Problem resolution'],
      ['fbSatisfaction',      'Satisfaction level'],
      ['fbWouldRecommend',    'Would recommend service'],
    ];
    for (const [fieldId, label] of requiredSelects) {
      const el = document.getElementById(fieldId);
      if (el && !el.value) {
        showAlert('feedbackAlert', `Please select ${label}.`, 'warning');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    const comment     = (document.getElementById('comment')?.value || '').trim();
    const suggestions = (document.getElementById('suggestions')?.value || '').trim();
    if (comment && comment.length > 1000) { showAlert('feedbackAlert', 'Comment must be 1000 characters or fewer.', 'warning'); return; }
    if (suggestions && suggestions.length > 1000) { showAlert('feedbackAlert', 'Suggestions must be 1000 characters or fewer.', 'warning'); return; }

    const payload = {
      overallRating:   ratingNum,
      serviceQuality:  document.getElementById('fbServiceQuality').value,
      technicianProfessionalism: document.getElementById('fbProfessionalism').value,
      responseTime:    document.getElementById('fbResponseTime').value,
      communication:   document.getElementById('fbCommunication').value,
      problemResolution: document.getElementById('fbProblemResolution').value,
      satisfactionLevel: document.getElementById('fbSatisfaction').value,
      wouldRecommend:  document.getElementById('fbWouldRecommend').value,
      comment:  comment  || null,
      suggestions: suggestions || null,
    };

    /* One in-flight submission at a time — rapid clicks can never double-post. */
    if (_submittingFeedback) return;
    _submittingFeedback = true;

    setLoading('feedbackSubmitBtn', 'feedbackSpinner', true);
    try {
      const res = await apiRequest(`/tickets/${id}/requester-feedback`, { method: 'POST', body: payload });
      showToast(res.message || 'Your feedback has been submitted successfully.', 'success');

      /* Lock the submit control so this ticket can never be submitted again
         in this session (the editable card is then replaced by the read-only
         "Feedback Submitted" view). */
      const submitBtn = document.getElementById('feedbackSubmitBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.submitted = '1';
        submitBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Feedback Submitted';
      }

      /* Reflect the saved state from the BACKEND (never localStorage) and show a
         read-only "Feedback Submitted" view in place of the editable form. */
      try {
        const { data: updated } = await apiRequest(`/tickets/${encodeURIComponent(id)}`);
        showFeedbackSubmitted(updated || { id, ticketId: document.getElementById('feedbackRequestTitle').value }, { justSubmitted: true });
      } catch (_) {
        const card = document.getElementById('feedbackFormCard');
        if (card) card.style.display = 'none';
        showAlert('feedbackAlert', res.message || 'Your feedback has been submitted successfully.', 'success');
      }

      /* Re-fetch and re-render the awaiting list (the submitted ticket drops off). */
      const { data } = await apiRequest('/tickets/my');
      renderPendingFeedback(data.filter(r => ['resolved','closed'].includes(r.status) && !r.feedbackRating));
    } catch (err) {
      console.error('Submit feedback failed:', err);
      /* Keep the filled-in form so the requester can correct and retry, and
         surface the real backend error — never a false success message. */
      showAlert('feedbackAlert', `Unable to submit feedback. Please check the required fields and try again. (${err.message})`, 'danger');
    } finally {
      _submittingFeedback = false;
      setLoading('feedbackSubmitBtn', 'feedbackSpinner', false);
      /* After a successful submission the control stays locked + relabelled. */
      const submitBtn = document.getElementById('feedbackSubmitBtn');
      if (submitBtn && submitBtn.dataset.submitted) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Feedback Submitted';
      }
    }
  });

  /* Deep-link support: feedback.html?ticketId=<MongoId> (compat with the
     project's ?id= pattern) opens the form for one specific request. */
  const urlTicketId = (getUrlParam('ticketId') || getUrlParam('id') || '').trim();
  if (urlTicketId) await openFeedbackFromUrl(urlTicketId);
}

function renderPendingFeedback(requests) {
  const container = document.getElementById('pendingFeedbackList');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = `<div class="text-center text-muted py-4">
      <i class="bi bi-check2-all fs-2 d-block mb-2 text-success"></i>No resolved requests awaiting feedback.</div>`;
    return;
  }
  container.innerHTML = requests.map(r => `
    <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center px-3 py-3"
         onclick="openFeedbackForm('${r.id}','${escHtml(r.ticketId || r.id)}')" style="cursor:pointer;">
      <div>
        <div class="fw-semibold">${escHtml(r.ticketId || r.id)}</div>
        <small class="text-muted">${escHtml(r.problemDescription||'').substring(0,60)} · Resolved ${formatDate(r.updated_at)}</small>
      </div>
      <i class="bi bi-chevron-right text-muted"></i>
    </div>`).join('');
}

function openFeedbackForm(id, title) {
  document.getElementById('feedbackRequestId').value    = id;
  document.getElementById('feedbackRequestTitle').value = title;
  const card = document.getElementById('feedbackFormCard');
  if (card) { card.style.removeProperty('display'); card.scrollIntoView({ behavior: 'smooth' }); }
}

/* ── URL query-string helper ─────────────────────────────── */
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ── Deep-link: open the feedback form for one specific ticket ──
   Used when the dashboard (or the project's ?id= pattern) links to
   feedback.html?ticketId=<MongoId>. The ticket is re-fetched from the backend
   so ownership and eligibility are always enforced server-side: if feedback
   already exists we show the read-only "Feedback Submitted" view instead of
   the editable form, and POST can never be reached twice for the same ticket. */
async function openFeedbackFromUrl(ticketId) {
  const id = (ticketId || '').trim();
  if (!id) return;
  try {
    const { data: ticket } = await apiRequest(`/tickets/${encodeURIComponent(id)}`);
    if (!ticket || !ticket.id) {
      showAlert('feedbackAlert', 'The selected request could not be found.', 'danger');
      return;
    }
    if (ticket.has_requester_feedback || ticket.feedbackRating) {
      showFeedbackSubmitted(ticket, { justSubmitted: false });
      return;
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      showAlert('feedbackAlert', 'Feedback can only be submitted for resolved or closed requests. This request is currently: ' + escHtml(ticket.status) + '.', 'danger');
      return;
    }
    openFeedbackForm(ticket.id, ticket.ticketId || ticket.id);
  } catch (err) {
    console.error('Open feedback from URL failed:', err);
    showAlert('feedbackAlert', err.message || 'Unable to load the selected request for feedback.', 'danger');
  }
}

/* ── Read-only "Feedback Submitted" view ────────────────────
   Shown when a ticket already has requester feedback (or right after a
   successful POST): hides the editable form and summarises what was saved.
   The green banner distinguishes a just-completed submission from a ticket
   that was opened pre-submitted. */
function showFeedbackSubmitted(ticket, opts) {
  const fb = (ticket && ticket.requester_feedback) || {};
  const title = ticket ? (ticket.ticketId || ticket.id || '') : '';
  const rating = Number(fb.overallRating) || Number(ticket && ticket.feedbackRating) || 0;
  const ratingLabel = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating] || '';
  const stars = rating
    ? '<span class="text-warning">' + '★'.repeat(rating) + '</span><span class="text-muted">' + '☆'.repeat(5 - rating) + '</span>'
    : '—';

  const formCard = document.getElementById('feedbackFormCard');
  if (formCard) formCard.style.display = 'none';

  const card = document.getElementById('feedbackSubmittedCard');
  const body = document.getElementById('feedbackSubmittedBody');
  if (!card || !body) return;

  const justSubmitted = !!opts && !!opts.justSubmitted;
  const msg = justSubmitted
    ? `Your feedback has been submitted successfully for request <strong>${escHtml(title)}</strong>.`
    : `Feedback for request <strong>${escHtml(title)}</strong> has already been submitted. You cannot submit it again.`;

  const rows = [
    ['Overall Service Rating', stars + '<span class="ms-1">' + escHtml(ratingLabel) + '</span>'],
    ['Service Quality', fb.serviceQuality],
    ['Technician Professionalism', fb.technicianProfessionalism],
    ['Response Time', fb.responseTime],
    ['Communication', fb.communication],
    ['Problem Resolution', fb.problemResolution],
    ['Satisfaction Level', fb.satisfactionLevel],
    ['Would Recommend Service', fb.wouldRecommend],
    ['Comment', fb.comment],
    ['Suggestions', fb.suggestions],
  ].filter(([, v]) => v != null && v !== '' && v !== '—');

  card.classList.remove('d-none');
  body.innerHTML = `
    <div class="alert ${justSubmitted ? 'alert-success' : 'alert-info'} d-flex align-items-start gap-2 mb-4">
      <i class="bi ${justSubmitted ? 'bi-check-circle-fill' : 'bi-info-circle-fill'} fs-4 flex-shrink-0"></i>
      <div>${msg}</div>
    </div>
    <div class="row g-3">
      ${rows.map(([k, v]) => `
        <div class="col-md-6">
          <div class="p-3 rounded bg-light h-100">
            <div class="small fw-semibold text-muted mb-1">${escHtml(k)}</div>
            <div>${k === 'Overall Service Rating' ? v : escHtml(v)}</div>
          </div>
        </div>`).join('')}
    </div>
    ${fb.submittedAt ? `<div class="small text-muted mt-3"><i class="bi bi-clock me-1"></i>Submitted ${formatDateTime(fb.submittedAt)}</div>` : ''}`;
}

/* Single source of truth for the star rating: the hidden #ratingValue input.
   Every interaction routes through setStarRating() so the stored value, the
   filled stars and the label can never disagree. Values are clamped to the
   valid 1-5 range; anything else clears the rating entirely rather than ever
   persisting a bad value (which previously let the request reach the backend
   and fail with "Overall service rating (1-5) is required."). */
function setStarRating(value, clearAlert = true) {
  const input  = document.getElementById('ratingValue');
  const label  = document.getElementById('ratingLabel');
  const stars  = document.querySelectorAll('.star-rating .star');
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  const n     = parseInt(value, 10);
  const valid = Number.isInteger(n) && n >= 1 && n <= 5;

  if (input) input.value = valid ? String(n) : '';
  if (label) label.textContent = valid ? labels[n] : 'Click a star to rate';
  stars.forEach((s, i) => {
    s.className = valid && i < n ? 'bi bi-star-fill text-warning star' : 'bi bi-star text-warning star';
    s.setAttribute('aria-checked', String(valid && i < n));
  });

  /* Selecting a rating clears any outstanding validation error immediately. */
  if (clearAlert) {
    const alert = document.getElementById('feedbackAlert');
    if (alert && !alert.classList.contains('d-none')) {
      alert.classList.add('d-none');
      alert.innerHTML = '';
    }
  }
}

function initStarRating() {
  document.querySelectorAll('.star-rating .star').forEach(star => {
    /* Clicks (and keyboard Enter/Space triggered via click()) only update the
       rating state. Stars are not submit controls, so no form submission is
       ever triggered from them. */
    star.addEventListener('click', () => { setStarRating(star.dataset && star.dataset.value); });
    star.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); star.click(); } });
  });

  /* Establish a clean baseline (value cleared, stars outlined, label reset). */
  setStarRating(0, false);
}

/* ═══════════════════════════════════════════════════════════
   ADMIN REQUESTS PAGE
   ═══════════════════════════════════════════════════════════ */
async function initAdminFeedbackPage() {
  if (!requireRole('ICT Admin')) return;
  initAdminFeedbackModal();
  await loadAdminFeedbackPage();
}

/* Cached feedback records + current filter/page state for this page. */
let _allAdminFeedback = [];
let _adminFbFilters   = { search: '', status: '', rating: '', department: '', technician: '', from: '', to: '' };
let _adminFbPage      = 1;
let _adminFbSummary   = null;
const _ADMIN_FB_PAGE_SIZE = 8;

/* Map the current filter state to the backend query string. The select/date
   filters are applied on the server (status/department/technician live on the
   ticket); free-text search stays client-side over the populated results. */
function buildAdminFbQuery() {
  const parts = [];
  if (_adminFbFilters.status)     parts.push(`status=${encodeURIComponent(_adminFbFilters.status)}`);
  if (_adminFbFilters.rating) {
    if (_adminFbFilters.rating === 'low') parts.push('minRating=1&maxRating=2');
    else parts.push(`rating=${encodeURIComponent(_adminFbFilters.rating)}`);
  }
  if (_adminFbFilters.department) parts.push(`department=${encodeURIComponent(_adminFbFilters.department)}`);
  if (_adminFbFilters.technician) parts.push(`technician=${encodeURIComponent(_adminFbFilters.technician)}`);
  if (_adminFbFilters.from)       parts.push(`from=${encodeURIComponent(_adminFbFilters.from)}`);
  if (_adminFbFilters.to)         parts.push(`to=${encodeURIComponent(_adminFbFilters.to)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function loadAdminFeedbackPage() {
  const tbody = document.getElementById('adminFeedbackTableBody');
  if (tbody) {
    /* Professional loading state: replace the static placeholder so the page
       can never be left on a frozen "Loading requests..." message. */
    tbody.innerHTML = `
      <tr><td colspan="10" class="text-center text-muted py-4">
        <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>Loading service requests...
      </td></tr>`;
  }

  try {
    const res = await apiRequest(`/feedback${buildAdminFbQuery()}`);
    _allAdminFeedback = Array.isArray(res.data) ? res.data : [];
    _adminFbSummary   = res.summary || null;
    _adminFbPage      = 1;
    populateAdminFbFilterOptions(_allAdminFeedback);
    renderAdminFeedbackKPIs(_adminFbSummary);
    renderAdminFeedbackTable();
    wireAdminFeedbackFilters();
  } catch (err) {
    console.error('Load admin service feedback failed:', err);
    showToast(err.message, 'danger');
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="10" class="text-center py-4">
          <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
          <p class="text-danger mb-2">Failed to load service feedback.</p>
          <p class="text-muted small mb-3">${escHtml(err.message || 'Unknown error')}</p>
          <button class="btn btn-sm btn-outline-primary" onclick="loadAdminFeedbackPage()">
            <i class="bi bi-arrow-clockwise me-1"></i>Retry
          </button>
        </td></tr>`;
    }
  }
}

/* Rebuild the Department / Technician filter dropdowns from the current data.
   A currently-selected value that no longer appears in the set is kept so an
   active filter never silently disappears. */
function fillAdminFbSelect(id, values, placeholder, selected) {
  const el = document.getElementById(id);
  if (!el) return;
  let opts = [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  if (selected && !opts.includes(selected)) opts = [selected, ...opts];
  el.innerHTML = `<option value="">${escHtml(placeholder)}</option>`
    + opts.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  el.value = selected || '';
}

function populateAdminFbFilterOptions(data) {
  const depts = new Set();
  const techs = new Set();
  data.forEach(fb => {
    const r = fb.request || {};
    if (r.department) depts.add(r.department);
    if (r.assignedTechnician?.fullName) techs.add(r.assignedTechnician.fullName);
  });
  fillAdminFbSelect('adminFbDept', depts, 'All Departments', _adminFbFilters.department);
  fillAdminFbSelect('adminFbTech', techs, 'All Technicians', _adminFbFilters.technician);
}

/* Feedback summary KPIs computed by the backend — never hard-coded here. */
function renderAdminFeedbackKPIs(summary) {
  const s = summary || {};
  const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setNum('fbKpiTotal', s.totalFeedback ?? 0);
  const avgEl = document.getElementById('fbKpiAvg');
  if (avgEl) avgEl.textContent = s.totalFeedback ? Number(s.averageRating || 0).toFixed(1) : '—';
  setNum('fbKpiFiveStar', s.fiveStarFeedback ?? 0);
  setNum('fbKpiLow', s.lowRatings ?? 0);
  setNum('fbKpiPending', s.pendingReview ?? 0);
  const pendingEl = document.getElementById('fbKpiPending');
  const pendingCard = pendingEl ? pendingEl.closest('.card') : null;
  if (pendingCard) pendingCard.classList.toggle('border-danger', (s.pendingReview || 0) > 0);
}

/* Idempotent wiring (guarded so repeat loads never stack listeners). */
let _adminFbWired = false;
function wireAdminFeedbackFilters() {
  if (_adminFbWired) return;
  _adminFbWired = true;

  const search = document.getElementById('adminFbSearch');
  if (search) {
    search.addEventListener('input', () => {
      _adminFbFilters.search = search.value;
      _adminFbPage = 1;
      renderAdminFeedbackTable();
    });
  }

  /* Server-side filters: a select or date change reloads from the backend. */
  const reloadFromServer = () => {
    _adminFbFilters.search = document.getElementById('adminFbSearch')?.value || '';
    loadAdminFeedbackPage();
  };
  const bindFilter = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _adminFbFilters[key] = el.value.trim();
      reloadFromServer();
    });
  };
  bindFilter('adminFbStatus', 'status');
  bindFilter('adminFbRating', 'rating');
  bindFilter('adminFbDept', 'department');
  bindFilter('adminFbTech', 'technician');
  bindFilter('adminFbFrom', 'from');
  bindFilter('adminFbTo', 'to');

  const reset = document.getElementById('adminFbReset');
  if (reset) {
    reset.addEventListener('click', () => {
      _adminFbFilters = { search: '', status: '', rating: '', department: '', technician: '', from: '', to: '' };
      ['adminFbSearch', 'adminFbStatus', 'adminFbRating', 'adminFbDept', 'adminFbTech', 'adminFbFrom', 'adminFbTo']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      loadAdminFeedbackPage();
    });
  }

  document.getElementById('adminFbPrevBtn')?.addEventListener('click', () => { if (_adminFbPage > 1) { _adminFbPage--; renderAdminFeedbackTable(); } });
  document.getElementById('adminFbNextBtn')?.addEventListener('click', () => { if (_adminFbPage < _adminFbMaxPages()) _adminFbPage++; renderAdminFeedbackTable(); });
}

/* Free-text search applies over the populated, server-filtered records. */
function _adminFbFiltered() {
  const q = (_adminFbFilters.search || '').trim().toLowerCase();
  if (!q) return _allAdminFeedback;
  return _allAdminFeedback.filter(fb => {
    const req = fb.request || {};
    return ((req.ticketId || '') + ' '
      + (fb.user?.fullName || '') + ' '
      + (req.problemDescription || '') + ' '
      + (req.equipmentType || '') + ' '
      + (req.department || '') + ' '
      + (req.assignedTechnician?.fullName || '')).toLowerCase().includes(q);
  });
}

function _adminFbMaxPages() {
  return Math.max(1, Math.ceil(_adminFbFiltered().length / _ADMIN_FB_PAGE_SIZE));
}

function renderAdminFeedbackTable() {
  const tbody = document.getElementById('adminFeedbackTableBody');
  if (!tbody) return;

  const filtered = _adminFbFiltered();

  const countEl   = document.getElementById('adminFbCount');
  if (countEl) {
    const serverCount = _allAdminFeedback.length;
    const total = _adminFbSummary ? _adminFbSummary.totalFeedback : serverCount;
    countEl.textContent = filtered.length === total
      ? `${total} feedback ${total === 1 ? 'entry' : 'entries'}`
      : `${filtered.length} of ${total} feedback ${total === 1 ? 'entry' : 'entries'}`;
  }

  const filtersActive = Object.values(_adminFbFilters).some(v => String(v).trim() !== '');
  const filtersInfo = document.getElementById('adminFbFiltersInfo');
  if (filtersInfo) filtersInfo.classList.toggle('d-none', !filtersActive);

  const pageInfo = document.getElementById('adminFbPageInfo');
  const pageWrap = document.getElementById('adminFbPaginationWrap');
  const totalItems = filtered.length;
  const maxPages   = Math.ceil(totalItems / _ADMIN_FB_PAGE_SIZE) || 1; // totalPages = ceil(totalItems / pageSize)
  if (_adminFbPage > maxPages) _adminFbPage = maxPages;
  const start = (_adminFbPage - 1) * _ADMIN_FB_PAGE_SIZE;
  const page  = filtered.slice(start, start + _ADMIN_FB_PAGE_SIZE);

  /* Always show the pagination footer so the "Showing X–Y of Z" text and the
     < > controls are visible — with the buttons correctly disabled on a single
     page (or with no data). Previously the whole footer was hidden whenever a
     single page held every record, which hid the disabled controls and the
     "Showing …" readout the requirements/UI expect. */
  if (pageWrap) pageWrap.style.display = '';
  if (pageInfo) {
    pageInfo.textContent = totalItems
      ? `Showing ${start + 1}–${Math.min(start + _ADMIN_FB_PAGE_SIZE, totalItems)} of ${totalItems}`
      : 'Showing 0–0 of 0';
  }

  const prevBtn = document.getElementById('adminFbPrevBtn');
  const nextBtn = document.getElementById('adminFbNextBtn');
  if (prevBtn) prevBtn.disabled = _adminFbPage <= 1;
  if (nextBtn) nextBtn.disabled = _adminFbPage >= maxPages;

  if (!filtered.length) {
    const resetAction = filtersActive
      ? `<button class="btn btn-sm btn-outline-secondary mt-2" onclick="document.getElementById('adminFbReset').click()">
           <i class="bi bi-arrow-counterclockwise me-1"></i>Reset filters
         </button>`
      : '';
    tbody.innerHTML = `<tr><td colspan="10"><div class="text-center py-5">
      <i class="bi bi-star fs-1 text-muted d-block mb-2"></i>
      <p class="text-muted mb-2">${_allAdminFeedback.length
        ? 'No feedback matches your search.'
        : (filtersActive ? 'No feedback matches the current filters.' : 'No service feedback submitted yet.')}</p>
      ${resetAction}
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = page.map((fb, i) => {
    const req      = fb.request || {};
    const reqId    = req._id || req.id || '';
    const stars    = Math.max(1, Math.min(5, Number(fb.rating) || 1));
    const low      = stars <= 2;
    const starsHtml = '<span class="text-warning text-nowrap">'
      + '★'.repeat(stars) + '<span class="text-muted">' + '☆'.repeat(5 - stars) + '</span></span>';
    const comment  = (fb.comment || '').trim();
    const technician = req.assignedTechnician?.fullName || '—';
    const hasAdminFb = !!(req.adminFeedback && req.adminFeedback.adminId);
    return `
      <tr class="${low ? 'low-rating-row' : ''}">
        <td class="text-muted">${escHtml(start + i + 1)}</td>
        <td><strong class="text-primary text-nowrap">${escHtml(req.ticketId || '—')}</strong></td>
        <td>${escHtml(fb.user?.fullName || '—')}</td>
        <td>${req.department ? `<span class="badge bg-light text-dark border">${escHtml(req.department)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td>${escHtml(technician)}</td>
        <td><small class="text-muted text-nowrap">${fb.createdAt ? formatDateTime(fb.createdAt) : '—'}</small></td>
        <td><span class="badge bg-light text-dark border">${escHtml(req.equipmentType || '—')}</span></td>
        <td>${req.status ? statusBadge(req.status) : '<span class="text-muted">—</span>'}</td>
        <td>
          <div class="small text-nowrap">${starsHtml} <span class="text-muted">(${stars}/5)</span>
            ${low ? '<span class="badge bg-danger-subtle text-danger border ms-1">Low</span>' : ''}
          </div>
          ${comment ? `<div class="small text-muted text-truncate" style="max-width:240px;" title="${escHtml(comment)}">${escHtml(comment)}</div>` : ''}
        </td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-secondary btn-review-feedback"
                  data-id="${escHtml(reqId)}" data-title="${escHtml(req.ticketId || '')}"
                  data-bs-toggle="modal" data-bs-target="#reviewFeedbackModal" title="Review full maintenance lifecycle">
            <i class="bi bi-eye me-1"></i>Review
          </button>
          <button class="btn btn-sm btn-primary btn-admin-feedback"
                  data-id="${escHtml(reqId)}" data-title="${escHtml(req.ticketId || '')}"
                  data-bs-toggle="modal" data-bs-target="#adminFeedbackModal">
            <i class="bi bi-clipboard2-check me-1"></i>${hasAdminFb ? 'Edit Feedback' : 'Add Feedback'}
          </button>
        </td>
      </tr>`;
  }).join('');
}

/* Cached admin requests used by the search / status / priority filters. */
let _allAdminRequests = [];

async function loadAdminRequests() {
  const tbody = document.getElementById('requestsTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">Loading requests...</td></tr>`;

  try {
    const { data } = await apiRequest('/tickets');
    _allAdminRequests = data || [];
    renderAdminTable(_allAdminRequests);
  } catch (err) {
    console.error('Load admin requests failed:', err);
    showToast(err.message, 'danger');
    /* Never leave the loader hanging: show the real error + a Retry action. */
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">
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
  if (!requireRole('ICT Admin')) return;
  initAdminFeedbackModal();
  await populateSelect('categoryFilter', '/categories', true);
  await loadAdminRequests();

  const doFilter = () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase()||'';
    const st = document.getElementById('statusFilter')?.value||'';
    const pr = document.getElementById('priorityFilter')?.value||'';
    renderAdminTable(_allAdminRequests.filter(r =>
      (!q  || (r.problemDescription||'').toLowerCase().includes(q)||(r.requester_name||'').toLowerCase().includes(q)) &&
      (!st || r.status===st) && (!pr || r.priority===pr)
    ));
  };

  document.getElementById('searchBtn')?.addEventListener('click', doFilter);
  document.getElementById('searchInput')?.addEventListener('keydown', e => { if(e.key==='Enter') doFilter(); });
  document.getElementById('statusFilter')?.addEventListener('change', doFilter);
  document.getElementById('priorityFilter')?.addEventListener('change', doFilter);

  /* Event delegation for the dynamically rendered Actions buttons.
     Binds once on the tbody so it survives every table re-render. */
  const tbody = document.getElementById('requestsTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('.btn-view-ticket');
      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        if (!id) { console.error('Open ticket: missing ticket id.'); showToast('Could not identify the request.', 'danger'); return; }
        openAdminRequestModal(id);
      }
    });
  }
}

function renderAdminTable(requests) {
  const tbody = document.getElementById('requestsTableBody');
  if (!tbody) return;
  if (!requests.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="text-center py-5">
      <i class="bi bi-inbox fs-1 text-muted d-block mb-2"></i><p class="text-muted">No requests found.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = requests.map(r => `
    <tr>
      <td><strong class="text-primary">${escHtml(r.ticketId || r.id)}</strong></td>
      <td class="text-truncate" style="max-width:160px;">${escHtml(r.problemDescription)}</td>
      <td>${escHtml(r.requester_name||'—')}</td>
      <td><span class="badge bg-light text-dark border">${escHtml(r.department||'—')}</span></td>
      <td>${escHtml(r.equipmentType||'—')}</td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${statusBadge(r.status)}</td>
      <td><small class="text-muted">${formatDate(r.created_at)}</small></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-primary py-0 px-2 btn-view-ticket"
                data-id="${escHtml(r._id || r.id)}" title="View / Assign technician"
                data-bs-toggle="modal" data-bs-target="#requestDetailModal">
          <i class="bi bi-eye"></i>
        </button>
      </td>
    </tr>`).join('');
}

async function openAdminRequestModal(id) {
  document.getElementById('modalRequestId').value = id;
  const section = document.getElementById('requestInfoSection');
  if (section) section.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;

  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);

    if (section) {
      const reportHtml = r.technician_feedback ? renderAdminReport(r.technician_feedback) : '';
      const adminFeedHtml = r.admin_feedback ? renderAdminFeedbackCard(r.admin_feedback) : '';
      section.innerHTML = `
        <h6 class="fw-bold mb-3">${escHtml(r.ticketId || r.id)}</h6>
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="text-muted small mb-1">Status</div>${statusBadge(r.status)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Priority</div>${priorityBadge(r.priority)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Requester</div><span class="small">${escHtml(r.requester_name||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Phone</div><span class="small">${escHtml(r.phone||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Equipment</div><span class="small">${escHtml(r.equipmentType||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">ICT Asset</div><span class="small">${r.asset_tag ? escHtml(r.asset_tag) + (r.asset_name ? ` — ${escHtml(r.asset_name)}` : '') : '—'}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Department</div><span class="small">${escHtml(r.department||'—')}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Description</div>
            <div class="p-2 bg-light rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
        </div>
        <div class="d-flex justify-content-end mb-2">
          <button type="button" class="btn btn-sm btn-primary btn-admin-feedback"
                  data-id="${escHtml(r.id)}" data-title="${escHtml(r.ticketId || r.id)}"
                  data-bs-toggle="modal" data-bs-target="#adminFeedbackModal">
            <i class="bi bi-clipboard2-check me-1"></i>${r.admin_feedback ? 'Edit Service Feedback' : 'Add Service Feedback'}
          </button>
        </div>
        ${reportHtml}${adminFeedHtml}`;
    }

    const sel = document.getElementById('assignTechSelect');
    if (sel) {
      const { data: techs } = await apiRequest('/technicians');
      const activeTechs = techs.filter(t => t.status === 'active');
      sel.innerHTML = `<option value="">-- Select Technician --</option>` +
        activeTechs.map(t => `<option value="${escHtml(t._id || t.id)}">${escHtml(t.fullName)} — ${escHtml(t.specialization||'General')} ${t.available?'✓':''}</option>`).join('');
    }

    /* Load the current assignment for this ticket (if any) */
    let currentAssignment = null;
    try {
      const { data: assignments } = await apiRequest('/assignments');
      currentAssignment = assignments.find(a => String(a.ticket_id) === String(id) && ['assigned','accepted','in_progress'].includes(a.status)) || null;
    } catch (_) { currentAssignment = null; }

    const currentBox = document.getElementById('currentAssignment');
    if (currentBox) {
      if (currentAssignment) {
        currentBox.innerHTML = `
          <div class="alert alert-info py-2 small mb-0">
            <i class="bi bi-person-check-fill me-1"></i>
            <strong>Currently assigned:</strong> ${escHtml(currentAssignment.technician_name || 'Unknown technician')}
          </div>`;
      } else {
        currentBox.innerHTML = `<div class="text-muted small mb-0">No technician assigned yet.</div>`;
      }
    }

    const removeBtn = document.getElementById('removeAssignmentBtn');
    if (removeBtn) {
      if (currentAssignment) {
        removeBtn.classList.remove('d-none');
        removeBtn.onclick = async () => {
          if (!confirm(`Are you sure you want to remove the technician from "${r.ticketId || r.id}"?`)) return;
          setLoading('removeAssignmentBtn','removeAssignmentSpinner',true);
          try {
            await apiRequest(`/assignments/${currentAssignment._id}`, { method:'DELETE' });
            showToast('Assignment removed successfully.', 'success');
            setTimeout(() => window.location.reload(), 1000);
          } catch (err) { console.error('Remove assignment failed:', err); showAlert('assignAlert', err.message, 'danger'); }
          finally { setLoading('removeAssignmentBtn','removeAssignmentSpinner',false); }
        };
      } else {
        removeBtn.classList.add('d-none');
      }
    }

    const assignBtn = document.getElementById('doAssignBtn');
    if (assignBtn) {
      const label = currentAssignment ? 'Reassign Technician' : 'Assign Technician';
      assignBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2 d-none" id="doAssignSpinner"></span>${label}`;
      assignBtn.onclick = async () => {
        const techId = document.getElementById('assignTechSelect')?.value;
        const notes  = document.getElementById('assignNotes')?.value||'';
        if (!techId) { showAlert('assignAlert','Please select a technician.','warning'); return; }
        const spin = document.getElementById('doAssignSpinner');
        if (spin) spin.classList.remove('d-none');
        assignBtn.disabled = true;
        try {
          await apiRequest('/assignments', { method:'POST', body:{ ticket_id:id, technician_id:techId, notes } });
          showToast(currentAssignment ? 'Technician reassigned successfully.' : 'Technician assigned successfully.', 'success');
          setTimeout(() => window.location.reload(), 1200);
        } catch (err) { console.error('Assign technician failed:', err); showAlert('assignAlert', err.message, 'danger'); }
        finally {
          if (spin) spin.classList.add('d-none');
          assignBtn.disabled = false;
        }
      };
    }

    const updateBtn = document.getElementById('updateStatusBtn');
    if (updateBtn) {
      updateBtn.onclick = async () => {
        const status = document.getElementById('newStatusSelect')?.value;
        try {
          await apiRequest(`/tickets/${id}/status`, { method:'PATCH', body:{ status } });
          showToast(`Status updated to "${status}"`,'success');
          setTimeout(() => window.location.reload(), 1000);
        } catch (err) { showAlert('assignAlert', err.message, 'danger'); }
      };
    }
  } catch (err) {
    if (section) section.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

/* ── Render the technician maintenance report for admins ───── */
function renderAdminReport(report) {
  const statusBadgeHtml = report.status === 'Fixed'
    ? '<span class="badge bg-success">Fixed</span>'
    : report.status === 'Not Fixed'
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
        ${report.technician_name ? `<span class="small text-muted"><i class="bi bi-wrench me-1"></i>${escHtml(report.technician_name)}</span>` : ''}
        ${report.submittedAt ? `<span class="small text-muted">· Submitted ${formatDateTime(report.submittedAt)}</span>` : ''}
        ${report.completionDate ? `<span class="small text-muted">· Completed ${formatDateTime(report.completionDate)}</span>` : ''}
      </div>
      ${row('Diagnosis / Identified Problem', report.diagnosis)}
      ${row('Work Performed', report.workPerformed)}
      ${row('Parts / Materials Used', report.partsUsed)}
      ${row('Resolution Summary', report.resolution)}
      ${report.status === 'Not Fixed' ? row('Reason Not Fixed', report.reasonNotFixed) : ''}
      ${row('Recommendation', report.recommendation)}
      ${row('Technician Notes (internal)', report.technicianNotes)}
    </div>`;
}

/* ── Render the admin service feedback card for admins ──────── */
function renderAdminFeedbackCard(report) {
  const base = () => `
    <div class="text-muted small fw-bold text-uppercase mb-2">
      <i class="bi bi-clipboard2-check text-primary me-1"></i>Admin Service Feedback
    </div>`;

  const field = (label, value) => value ? `
    <div class="mb-3">
      <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
      <div class="small p-2 bg-light rounded" style="white-space:pre-wrap;">${escHtml(value)}</div>
    </div>` : '';

  const defaultBadge = (v, cls) => v ? `<span class="badge ${cls} me-1">${escHtml(v)}</span>` : '';

  const metaLine = `
    <div class="d-flex gap-2 align-items-center flex-wrap mb-2">
      ${defaultBadge(report.serviceHandlingQuality, 'bg-primary')}
      ${defaultBadge(report.overallServiceQuality, 'bg-success')}
      ${defaultBadge(report.responseTime, 'bg-warning text-dark')}
      ${defaultBadge(report.policyCompliance, 'bg-light text-dark border')}
      ${report.admin_name ? `<span class="small text-muted"><i class="bi bi-person-badge me-1"></i>${escHtml(report.admin_name)}</span>` : ''}
      ${report.submittedAt ? `<span class="small text-muted">· Submitted ${formatDateTime(report.submittedAt)}</span>` : ''}
    </div>`;

  return `
    <div class="border-top pt-3 mt-3">
      ${base()}
      ${metaLine}
      ${field('Technician Performance', report.technicianPerformance)}
      ${field('Resolution Quality', report.resolutionQuality)}
      ${field('Documentation Quality', report.documentationQuality)}
      ${field('Administrative Recommendation', report.administrativeRecommendation)}
      ${field('Admin Comment', report.adminComment)}
      ${report.followUpRequired ? `
        <div class="mb-2">
          <span class="badge bg-danger"><i class="bi bi-arrow-repeat me-1"></i>Follow-up Required</span>
        </div>
        ${field('Follow-up Notes', report.followUpNotes)}
      ` : ''}
    </div>`;
}

/* ── Render requester service feedback for admin review ───────
   Shown read-only to the ICT Admin. The admin is never allowed to
   overwrite the requester's original service experience survey. */
function renderRequesterFeedbackView(fb) {
  if (!fb) return '';
  const stars = Number(fb.overallRating) || 0;
  let starsHtml = '';
  for (let i = 1; i <= 5; i++) {
    starsHtml += `<i class="bi ${i <= stars ? 'bi-star-fill' : 'bi-star'} text-warning"></i>`;
  }
  const field = (label, value) => value ? `
    <div class="mb-2">
      <div class="text-muted small fw-semibold mb-1">${escHtml(label)}</div>
      <div class="small p-2 bg-light rounded">${escHtml(value)}</div>
    </div>` : '';

  return `
    <div class="border rounded p-2 mb-3 bg-white">
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
        <span class="fs-5">${starsHtml}</span>
        <span class="text-muted small">(${escHtml(fb.overallRating != null ? fb.overallRating : '—')}/5)</span>
        ${fb.requester_name ? `<span class="small text-muted ms-auto"><i class="bi bi-person me-1"></i>${escHtml(fb.requester_name)}</span>` : ''}
        ${fb.submittedAt ? `<span class="small text-muted">· ${formatDateTime(fb.submittedAt)}</span>` : ''}
        ${fb.wouldRecommend ? `<span class="badge ${fb.wouldRecommend === 'Yes' ? 'bg-success' : 'bg-danger'} ms-1">${escHtml(fb.wouldRecommend)} recommend</span>` : ''}
      </div>
      ${field('Service Quality', fb.serviceQuality)}
      ${field('Technician Professionalism', fb.technicianProfessionalism)}
      ${field('Response Time', fb.responseTime)}
      ${field('Communication', fb.communication)}
      ${field('Problem Resolution', fb.problemResolution)}
      ${field('Satisfaction Level', fb.satisfactionLevel)}
      ${field('Requester Comment', fb.comment)}
      ${field('Suggestions for Improvement', fb.suggestions)}
    </div>`;
}

/* ── Open the Admin Service Feedback form (add or edit) ────── */
async function openAdminFeedbackForm(id) {
  const body = document.getElementById('adminFbRequestId');
  const info = document.getElementById('adminFbTaskInfo');
  if (body) body.value = id;

  /* Reset the form */
  ['afServiceHandlingQuality','afTechnicianPerformance','afResponseTime','afResolutionQuality',
   'afDocumentationQuality','afPolicyCompliance','afOverallServiceQuality','afAdminComment',
   'afFollowUpNotes','afAdminRecommendation'].forEach(el => {
    const node = document.getElementById(el);
    if (node) node.value = '';
  });
  const fbReq = document.getElementById('afFollowUpRequired');
  const fbConf = document.getElementById('afConfirmed');
  if (fbReq) fbReq.checked = false;
  if (fbConf) fbConf.checked = false;
  const wrap = document.getElementById('afFollowUpWrap');
  if (wrap) wrap.classList.add('d-none');
  const alert = document.getElementById('adminFbAlert');
  if (alert) { alert.classList.add('d-none'); alert.innerHTML = ''; }

  document.getElementById('saveAdminFbBtn').innerHTML =
    `<span class="spinner-border spinner-border-sm me-2 d-none" id="saveAdminFbSpinner"></span><i class="bi bi-clipboard-check me-1"></i>Submit Admin Feedback`;

  if (info) {
    info.innerHTML = `<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>`;
  }

  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);
    if (info) {
      /* Build a read-only REVIEW panel so the admin can evaluate the full
         maintenance lifecycle without modifying the original records. */
      const metaLine = `<div class="small">
        <strong>${escHtml(r.ticketId || r.id)}</strong>
        ${r.requester_name ? ` — ${escHtml(r.requester_name)}` : ''}
        ${r.equipmentType ? `<span class="ms-2"><i class="bi bi-laptop me-1"></i>${escHtml(r.equipmentType)}</span>` : ''}
        <span class="ms-2">${statusBadge(r.status)}</span>
      </div>`;

      const requesterPanel = r.requester_feedback
        ? renderRequesterFeedbackView(r.requester_feedback)
        : `<div class="small p-2 bg-light rounded mb-2 text-muted">No requester service feedback submitted yet.</div>`;
      const technicianPanel = r.technician_feedback
        ? renderAdminReport(r.technician_feedback)
        : `<div class="small p-2 bg-light rounded text-muted">No technician maintenance report submitted yet.</div>`;

      info.innerHTML = `
        ${metaLine}
        <div class="border-top pt-2 mt-2">
          <div class="small fw-bold text-uppercase text-muted mb-1 mt-3">
            <i class="bi bi-star text-warning me-1"></i>Requester Service Feedback (review only)
          </div>
          ${requesterPanel}
          <div class="small fw-bold text-uppercase text-muted mb-1 mt-3">
            <i class="bi bi-clipboard2-check text-primary me-1"></i>Technician Maintenance Report (review only)
          </div>
          ${technicianPanel}
        </div>`;
    }

    if (r.admin_feedback) {
      /* Prefill for editing */
      document.getElementById('afServiceHandlingQuality').value = r.admin_feedback.serviceHandlingQuality || '';
      document.getElementById('afTechnicianPerformance').value = r.admin_feedback.technicianPerformance || '';
      document.getElementById('afResponseTime').value          = r.admin_feedback.responseTime || '';
      document.getElementById('afResolutionQuality').value     = r.admin_feedback.resolutionQuality || '';
      document.getElementById('afDocumentationQuality').value  = r.admin_feedback.documentationQuality || '';
      document.getElementById('afPolicyCompliance').value      = r.admin_feedback.policyCompliance || '';
      document.getElementById('afOverallServiceQuality').value = r.admin_feedback.overallServiceQuality || '';
      document.getElementById('afAdminComment').value          = r.admin_feedback.adminComment || '';
      document.getElementById('afFollowUpNotes').value         = r.admin_feedback.followUpNotes || '';
      document.getElementById('afAdminRecommendation').value   = r.admin_feedback.administrativeRecommendation || '';
      const fbReq2 = document.getElementById('afFollowUpRequired');
      if (fbReq2) {
        fbReq2.checked = !!r.admin_feedback.followUpRequired;
        document.getElementById('afFollowUpWrap').classList.toggle('d-none', !fbReq2.checked);
      }
      document.getElementById('saveAdminFbBtn').innerHTML =
        `<span class="spinner-border spinner-border-sm me-2 d-none" id="saveAdminFbSpinner"></span><i class="bi bi-clipboard-check me-1"></i>Update Admin Feedback`;
    }
  } catch (err) {
    if (info) info.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${escHtml(err.message)}</div>`;
  }
}

/* ── Submit or update Admin Service Feedback ───────────────── */
async function submitAdminFeedback() {
  const id = document.getElementById('adminFbRequestId').value;
  if (!id) { showAlert('adminFbAlert', 'Could not identify the request.', 'warning'); return; }

  const serviceHandlingQuality = document.getElementById('afServiceHandlingQuality').value;
  const technicianPerformance  = document.getElementById('afTechnicianPerformance').value;
  const responseTime           = document.getElementById('afResponseTime').value;
  const resolutionQuality      = document.getElementById('afResolutionQuality').value;
  const documentationQuality   = document.getElementById('afDocumentationQuality').value;
  const policyCompliance       = document.getElementById('afPolicyCompliance').value;
  const overallServiceQuality  = document.getElementById('afOverallServiceQuality').value;
  const adminComment           = document.getElementById('afAdminComment').value.trim();
  const followUpRequired       = document.getElementById('afFollowUpRequired').checked;
  const followUpNotes          = document.getElementById('afFollowUpNotes').value.trim();
  const administrativeRecommendation = document.getElementById('afAdminRecommendation').value.trim();
  const confirmed              = document.getElementById('afConfirmed').checked;

  if (!serviceHandlingQuality) { showAlert('adminFbAlert', 'Service handling quality is required.', 'warning'); return; }
  if (!overallServiceQuality)  { showAlert('adminFbAlert', 'Overall service quality is required.', 'warning'); return; }
  if (!adminComment)           { showAlert('adminFbAlert', 'Admin comment is required.', 'warning'); return; }
  if (followUpRequired && !followUpNotes) { showAlert('adminFbAlert', 'Please explain what the follow-up requires.', 'warning'); return; }
  if (!confirmed)              { showAlert('adminFbAlert', 'Please confirm that this service evaluation is accurate.', 'warning'); return; }

  setLoading('saveAdminFbBtn', 'saveAdminFbSpinner', true);
  const alert = document.getElementById('adminFbAlert');
  if (alert) { alert.classList.add('d-none'); }

  try {
    /* The save button text tells us whether we are adding or editing */
    const isEdit = /update/i.test(document.getElementById('saveAdminFbBtn').textContent);
    const payload = {
      serviceHandlingQuality, technicianPerformance, responseTime,
      resolutionQuality, documentationQuality, policyCompliance, overallServiceQuality,
      adminComment, followUpRequired, followUpNotes: followUpNotes || null,
      administrativeRecommendation: administrativeRecommendation || null,
      adminConfirmed: confirmed,
    };
    const res = await apiRequest(`/tickets/${id}/admin-feedback`, {
      method: isEdit ? 'PUT' : 'POST',
      body: payload,
    });
    showToast(res.message || (isEdit ? 'Service feedback updated.' : 'Admin service feedback submitted.'), 'success');
    const modal = document.getElementById('adminFeedbackModal');
    if (modal && bootstrap.Modal.getInstance(modal)) bootstrap.Modal.getInstance(modal).hide();
    /* refresh the detail modal so the new feedback card appears */
    if (window.location.pathname.includes('admin/requests')) {
      openAdminRequestModal(id);
    } else {
      await loadAdminFeedbackPage();
    }
  } catch (err) {
    showAlert('adminFbAlert', err.message, 'danger');
  } finally {
    setLoading('saveAdminFbBtn', 'saveAdminFbSpinner', false);
  }
}

/* ── Delete (clear) Admin Service Feedback for a ticket ────── */
async function deleteAdminFeedback(id, title) {
  if (!id) { showToast('Could not identify the request.', 'danger'); return; }
  if (!confirm(`Delete the admin service feedback for "${title}"? This cannot be undone.`)) return;

  try {
    const res = await apiRequest(`/tickets/${encodeURIComponent(id)}/admin-feedback`, { method: 'DELETE' });
    showToast(res.message || 'Admin service feedback deleted.', 'success');
    await loadAdminFeedbackPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

/* ── Open the read-only review of the full maintenance lifecycle ──
   Shows the requester's service feedback + technician report + any
   existing admin evaluation. Admins can REVIEW but cannot overwrite the
   original requester/technician records from here. */
async function openReviewFeedback(id) {
  const body = document.getElementById('reviewFeedbackBody');
  if (body) body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>`;
  try {
    const { data: r } = await apiRequest(`/tickets/${id}`);
    if (!body) return;
    const requesterPanel = r.requester_feedback
      ? renderRequesterFeedbackView(r.requester_feedback)
      : `<div class="small p-2 bg-light rounded text-muted mb-3">No requester service feedback submitted yet.</div>`;
    const technicianPanel = r.technician_feedback
      ? renderAdminReport(r.technician_feedback)
      : `<div class="small p-2 bg-light rounded text-muted mb-3">No technician maintenance report submitted yet.</div>`;
    const adminPanel = r.admin_feedback ? renderAdminFeedbackCard(r.admin_feedback) : '';
    body.innerHTML = `
      <div class="mb-3">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <h6 class="fw-bold mb-0">${escHtml(r.ticketId || r.id)}</h6>
          <span>${statusBadge(r.status)}</span>
          ${r.requester_name ? `<span class="small text-muted"><i class="bi bi-person me-1"></i>${escHtml(r.requester_name)}</span>` : ''}
        </div>
        <div class="small text-muted mt-1">${escHtml(r.problemDescription || '')}</div>
      </div>
      <div class="small fw-bold text-uppercase text-muted mb-1">
        <i class="bi bi-star text-warning me-1"></i>Requester Service Feedback
      </div>
      ${requesterPanel}
      <div class="small fw-bold text-uppercase text-muted mb-1 mt-3">
        <i class="bi bi-clipboard2-check text-primary me-1"></i>Technician Maintenance Report
      </div>
      ${technicianPanel}
      ${adminPanel ? `
        <div class="small fw-bold text-uppercase text-muted mb-1 mt-3">
          <i class="bi bi-person-badge text-info me-1"></i>Admin Service Feedback
        </div>
        ${adminPanel}` : ''}`;
  } catch (err) {
    if (body) body.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${escHtml(err.message)}</div>`;
  }
}

/* ── Wire up the Admin Service Feedback modal ──────────────── */
function initAdminFeedbackModal() {
  document.getElementById('afFollowUpRequired')?.addEventListener('change', e => {
    document.getElementById('afFollowUpWrap')?.classList.toggle('d-none', !e.target.checked);
  });
  document.getElementById('saveAdminFbBtn')?.addEventListener('click', submitAdminFeedback);

  /* Event delegation so dynamically rendered buttons work */
  document.addEventListener('click', (e) => {
    const reviewBtn = e.target.closest('.btn-review-feedback');
    if (reviewBtn) {
      const id = reviewBtn.getAttribute('data-id');
      if (!id) { console.error('Review feedback: missing ticket id.'); showToast('Could not identify the request.', 'danger'); return; }
      openReviewFeedback(id);
      return;
    }

    const delBtn = e.target.closest('.btn-admin-feedback-delete');
    if (delBtn) {
      const id = delBtn.getAttribute('data-id');
      const title = delBtn.getAttribute('data-title') || id;
      if (!id) { console.error('Admin feedback: missing ticket id.'); showToast('Could not identify the request.', 'danger'); return; }
      deleteAdminFeedback(id, title);
      return;
    }

    const btn = e.target.closest('.btn-admin-feedback');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (!id) { console.error('Admin feedback: missing ticket id.'); showToast('Could not identify the request.', 'danger'); return; }
      openAdminFeedbackForm(id);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   CATEGORIES (Admin)
   ═══════════════════════════════════════════════════════════ */
let _pendingDelete = null; /* { id, name, total } awaiting confirmation */

async function initCategories() {
  if (!requireRole('ICT Admin')) return;
  wireCategoryModalActions();
  await loadCategories();
}

/* Reset the Add/Edit modal to its clean state (used by the header
   "Add Category" button and the empty-state CTA). Bootstrap shows the
   modal via the buttons' data-bs-toggle/data-bs-target attributes. */
function openAddCategoryModal() {
  document.getElementById('categoryForm')?.reset();
  document.getElementById('categoryId').value = '';
  document.getElementById('categoryModalLabel').textContent = 'Add Category';
  const alert = document.getElementById('categoryModalAlert');
  if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }
}

/* One-time wiring of modals + event delegation for the dynamic action
   buttons. Binds once so it survives every table re-render. */
function wireCategoryModalActions() {
  document.getElementById('saveCategoryBtn')?.addEventListener('click', saveCategory);
  document.getElementById('addCategoryBtn')?.addEventListener('click', openAddCategoryModal);
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-add-category')) openAddCategoryModal();
  });

  const deleteModal = document.getElementById('deleteCategoryModal');
  if (deleteModal) {
    deleteModal.addEventListener('hidden.bs.modal', () => { _pendingDelete = null; });
    document.getElementById('deleteCategoryConfirmBtn')?.addEventListener('click', executeDeleteCategory);
  }

  const tbody = document.getElementById('categoriesTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const viewBtn   = e.target.closest('.btn-cat-view');
      const editBtn   = e.target.closest('.btn-cat-edit');
      const deleteBtn = e.target.closest('.btn-cat-delete');

      if (viewBtn) {
        const id = viewBtn.getAttribute('data-id');
        if (!id) { console.error('View category: missing id.'); showToast('Could not identify the category.', 'danger'); return; }
        viewCategory(id, Number(viewBtn.getAttribute('data-total')) || 0, viewBtn);
      } else if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        if (!id) { console.error('Edit category: missing id.'); showToast('Could not identify the category to edit.', 'danger'); return; }
        editCategory(id, editBtn);
      } else if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        if (!id) { console.error('Delete category: missing id.'); showToast('Could not identify the category to delete.', 'danger'); return; }
        confirmDeleteCategory(id, deleteBtn.getAttribute('data-name') || 'this category', Number(deleteBtn.getAttribute('data-total')) || 0);
      }
    });
  }
}

/* Disable all action buttons in a row and swap the clicked one for a
   spinner (or restore them when the operation settles). */
function setRowBusy(btn, isBusy) {
  const tr = btn?.closest('tr');
  const group = tr
    ? tr.querySelectorAll('.btn-cat-view, .btn-cat-edit, .btn-cat-delete')
    : [btn];
  group.forEach(b => {
    if (!b) return;
    if (isBusy) {
      if (!b.dataset.idleHtml) b.dataset.idleHtml = b.innerHTML;
      b.disabled = true;
    } else {
      if (b.dataset.idleHtml) { b.innerHTML = b.dataset.idleHtml; delete b.dataset.idleHtml; }
      b.disabled = false;
    }
  });
}

/* ── Load + render (single source of truth: /reports/requests-by-category) ── */
async function loadCategories() {
  const tbody = document.getElementById('categoriesTableBody');
  const stats = document.getElementById('categoryStats');
  if (!tbody && !stats) return;

  renderCategorySkeleton(tbody, stats);

  try {
    const { data } = await apiRequest('/reports/requests-by-category');
    const rows = Array.isArray(data) ? data : [];
    renderCategoryRows(rows);
    renderCategoryStats(rows);
  } catch (err) {
    console.error('[Categories] Failed to load category data:', err && err.message ? err.message : err);
    showToast(err.message, 'danger');
    renderCategoryInError(tbody, stats);
  }
}

function renderCategorySkeleton(tbody, stats) {
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 5 }).map(() => `
      <tr>
        <td><span class="skeleton-line" style="width:24px"></span></td>
        <td><span class="skeleton-line" style="width:55%"></span></td>
        <td><span class="skeleton-line" style="width:75%"></span></td>
        <td><span class="skeleton-line" style="width:32px"></span></td>
        <td><span class="skeleton-line" style="width:112px"></span></td>
      </tr>`).join('');
  }
  if (stats) {
    stats.innerHTML = Array.from({ length: 5 }).map(() => `
      <div class="d-flex align-items-center gap-2 py-2">
        <span class="skeleton-line rounded-circle" style="width:12px;height:12px;flex-shrink:0"></span>
        <span class="skeleton-line" style="width:60%;height:14px"></span>
        <span class="skeleton-line ms-auto" style="width:28px;height:14px"></span>
      </div>`).join('');
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
  const tbody = document.getElementById('categoriesTableBody');
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

  tbody.innerHTML = rows.map((c, i) => {
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
        <td class="text-truncate" style="max-width:280px;" title="${escHtml(c.description || '')}">${escHtml(c.description || '—')}</td>
        <td><span class="badge bg-light text-dark border ${total > 0 ? 'bg-primary-subtle text-primary-emphasis' : ''}">${total}</span></td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  initCategoryTooltips(tbody);
}

function renderCategoryStats(rows) {
  const stats = document.getElementById('categoryStats');
  if (!stats) return;

  if (!rows.length) {
    stats.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-bar-chart fs-2 text-muted d-block mb-2" aria-hidden="true"></i>
        <p class="text-muted small mb-0">No category data to display yet.</p>
      </div>`;
    return;
  }

  const withRequests = rows.filter(r => Number(r.total) > 0);
  if (!withRequests.length) {
    stats.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-inbox fs-2 text-muted d-block mb-2" aria-hidden="true"></i>
        <p class="text-muted small mb-0">No requests assigned to a category yet.</p>
        <p class="text-muted small">Statistics will appear here once requests are submitted.</p>
      </div>`;
    return;
  }

  const colours = ['#2563eb', '#198754', '#ffc107', '#dc3545', '#0dcaf0', '#6f42c1', '#fd7e14', '#20c997', '#6c757d', '#d63384'];
  const max  = Math.max(1, ...withRequests.map(r => Number(r.total) || 0));
  const totalRequests = withRequests.reduce((s, r) => s + (Number(r.total) || 0), 0);

  stats.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span class="small fw-semibold text-muted">Total requests</span>
      <span class="badge bg-primary">${totalRequests}</span>
    </div>` +
    withRequests.map((c, i) => {
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
    }).join('');
}

function renderCategoryInError(tbody, stats) {
  if (tbody && !tbody.querySelector('button')) {
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
    if (typeof bootstrap === 'undefined' || !bootstrap.Tooltip) return;
    (scope || document).querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      if (!bootstrap.Tooltip.getInstance(el)) new bootstrap.Tooltip(el, { container: 'body' });
    });
  } catch (_) { /* ignore */ }
}

/* ── VIEW ─────────────────────────────────────────────────── */
async function viewCategory(id, totalFromRow, btn) {
  const modalEl = document.getElementById('categoryViewModal');
  const body    = document.getElementById('categoryViewBody');
  const label   = document.getElementById('categoryViewLabel');
  if (!modalEl || !body) return;

  if (btn) setRowBusy(btn, true);
  body.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>`;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  try {
    const { data: c } = await apiRequest(`/categories/${encodeURIComponent(id)}`);
    body.innerHTML = renderCategoryDetail(c || {}, Number(totalFromRow) || 0);
    if (label) label.textContent = (c && (c.name || c._id)) ? c.name : 'Category Details';
  } catch (err) {
    console.error(`[Categories] View "${id}" failed:`, err && err.message ? err.message : err);
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
      <div class="fw-bold fs-5">${escHtml(c.name || '—')}</div>
      <span class="badge bg-success mt-1">Active</span>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-6">
        <div class="text-muted small fw-semibold mb-1">Total Requests</div>
        <span class="badge bg-primary">${total} request${total === 1 ? '' : 's'}</span>
      </div>
      <div class="col-6">
        <div class="text-muted small fw-semibold mb-1">Created</div>
        <span class="small">${created ? formatDateTime(created) : '—'}</span>
      </div>
      <div class="col-12">
        <div class="text-muted small fw-semibold mb-1">Description</div>
        <div class="p-3 rounded bg-light small" style="white-space:pre-wrap;">${escHtml(c.description || 'No description provided.')}</div>
      </div>
    </div>`;
}

/* ── EDIT ─────────────────────────────────────────────────── */
function editCategory(id, btn) {
  if (btn) setRowBusy(btn, true);
  (async () => {
    try {
      const { data: c } = await apiRequest(`/categories/${encodeURIComponent(id)}`);
      document.getElementById('categoryId').value          = c._id || c.id;
      document.getElementById('categoryName').value        = c.name || '';
      document.getElementById('categoryDescription').value = c.description || '';
      document.getElementById('categoryModalLabel').textContent = 'Edit Category';
      const alert = document.getElementById('categoryModalAlert');
      if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }
      bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModal')).show();
    } catch (err) {
      console.error('Load category for edit failed:', err && err.message ? err.message : err);
      showToast(err.message, 'danger');
    } finally {
      if (btn) setRowBusy(btn, false);
    }
  })();
}

/* ── SAVE (create + update) ───────────────────────────────── */
async function saveCategory() {
  const id   = document.getElementById('categoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  const desc = document.getElementById('categoryDescription').value.trim();

  const alert = document.getElementById('categoryModalAlert');
  if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }

  if (!name || name.length < 2) { showAlert('categoryModalAlert', 'Category name must be at least 2 characters.', 'warning'); return; }
  if (name.length > 100) { showAlert('categoryModalAlert', 'Category name must be no more than 100 characters.', 'warning'); return; }
  if (desc.length > 500) { showAlert('categoryModalAlert', 'Description must be no more than 500 characters.', 'warning'); return; }

  setLoading('saveCategoryBtn', 'saveCategorySpinner', true);
  try {
    if (id) await apiRequest(`/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: { name, description: desc } });
    else    await apiRequest('/categories', { method: 'POST', body: { name, description: desc } });

    const modal = document.getElementById('categoryModal');
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    document.getElementById('categoryModalLabel').textContent = 'Add Category';
    if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }

    showToast(id ? 'Category updated successfully.' : 'Category added successfully.', 'success');
    await loadCategories();
  } catch (err) {
    console.error('Save category failed:', err && err.message ? err.message : err);
    showAlert('categoryModalAlert', err.message, 'danger');
  } finally {
    setLoading('saveCategoryBtn', 'saveCategorySpinner', false);
  }
}

/* ── DELETE (confirm → execute) ────────────────────────────── */
function confirmDeleteCategory(id, name, total) {
  _pendingDelete = { id, name, total: Number(total) || 0 };

  const nameEl = document.getElementById('categoryDeleteName');
  if (nameEl) nameEl.textContent = _pendingDelete.name;

  const info = document.getElementById('categoryDeleteInfo');
  if (info) {
    info.innerHTML = _pendingDelete.total > 0
      ? `<div class="alert alert-warning py-2 small mb-0">
           <i class="bi bi-inbox me-1"></i><strong>${_pendingDelete.total}</strong>
           request${_pendingDelete.total === 1 ? '' : 's'} reference this category. They will NOT be deleted —
           they will be reclassified as <strong>Uncategorised</strong>.
         </div>`
      : '';
    info.classList.toggle('d-none', _pendingDelete.total === 0);
  }

  const alert = document.getElementById('deleteCategoryAlert');
  if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }

  const modal = document.getElementById('deleteCategoryModal');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function executeDeleteCategory() {
  if (!_pendingDelete || !_pendingDelete.id) return;

  const confirmBtn = document.getElementById('deleteCategoryConfirmBtn');
  const spinner    = document.getElementById('deleteCategorySpinner');
  if (confirmBtn) confirmBtn.disabled = true;
  if (spinner) spinner.classList.remove('d-none');

  const alert = document.getElementById('deleteCategoryAlert');
  if (alert) { alert.className = 'alert d-none'; alert.innerHTML = ''; }

  try {
    await apiRequest(`/categories/${encodeURIComponent(_pendingDelete.id)}`, { method: 'DELETE' });
    showToast('Category deleted successfully.', 'success');
    const modal = document.getElementById('deleteCategoryModal');
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    _pendingDelete = null;
    await loadCategories();
  } catch (err) {
    console.error('Delete category failed:', err && err.message ? err.message : err);
    showAlert('deleteCategoryAlert', `Unable to delete the category: ${err.message}`, 'danger');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
    if (spinner) spinner.classList.add('d-none');
  }
}

/* ═══════════════════════════════════════════════════════════
   USER MANAGEMENT (Admin)
   ═══════════════════════════════════════════════════════════ */
let _allUsers      = [];
let _allUsersQuery = { q: '', role: '', status: '' };
let _usersPage     = 1;
const _USERS_PAGE_SIZE = 10;

/* Human-readable role/status labels derived from the stored DB value
   (we always keep and display the real database value as the source of truth). */
function userRoleLabel(role) {
  if (role === 'ICT Admin') return 'Admin';
  if (role === 'Technician') return 'Technician';
  return 'Requester';
}
function userRoleBadge(role) {
  const cls = role === 'ICT Admin' ? 'danger'
    : role === 'Technician' ? 'warning text-dark'
    : 'primary';
  return `<span class="badge bg-${cls}">${escHtml(userRoleLabel(role))}</span>`;
}
function userStatusBadge(status) {
  return status === 'active'
    ? `<span class="badge bg-success"><i class="bi bi-circle-fill me-1" style="font-size:.5rem;"></i>Active</span>`
    : `<span class="badge bg-secondary"><i class="bi bi-circle me-1" style="font-size:.5rem;"></i>Inactive</span>`;
}

/* Re-fetch the full user list from the backend and re-render the table,
   re-applying the currently active search/role/status filters. Called on
   every load and after create / update / delete. */
async function refreshUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (tbody) {
    /* Professional loading state — spinner only while the request is pending. */
    tbody.innerHTML = `
      <tr><td colspan="8" class="text-center text-muted py-4">
        <div class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></div>
        Loading users...
      </td></tr>`;
  }

  try {
    const { data } = await apiRequest('/users');
    _allUsers = Array.isArray(data) ? data : [];
    _usersPage = 1;
    captureUserFilters();
    renderUsersTable();
    wireUserManagementFilters();
    return _allUsers;
  } catch (err) {
    console.error('Load users failed:', err);
    showToast(err.message, 'danger');
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
  _allUsersQuery.q      = (document.getElementById('searchInput')?.value || '').toLowerCase();
  _allUsersQuery.role   = document.getElementById('roleFilter')?.value || '';
  _allUsersQuery.status = document.getElementById('statusFilter')?.value || '';
}

function filteredUsers() {
  const { q, role, status } = _allUsersQuery;
  return _allUsers.filter(u =>
    (!q || (u.fullName||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) ||
           (u.role||'').toLowerCase().includes(q) || (u.department||'').toLowerCase().includes(q)) &&
    (!role || u.role === role) &&
    (!status || u.status === status)
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

  const apply = () => { captureUserFilters(); _usersPage = 1; renderUsersTable(); };

  document.getElementById('searchInput')?.addEventListener('input', apply);
  document.getElementById('roleFilter')?.addEventListener('change', apply);
  document.getElementById('statusFilter')?.addEventListener('change', apply);
  document.getElementById('searchBtn')?.addEventListener('click', apply);
  document.getElementById('resetUserFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('roleFilter').value = '';
    document.getElementById('statusFilter').value = '';
    apply();
  });
  document.getElementById('adminUsersPrevBtn')?.addEventListener('click', () => { if (_usersPage > 1) { _usersPage--; renderUsersTable(); } });
  document.getElementById('adminUsersNextBtn')?.addEventListener('click', () => { if (_usersPage < _usersMaxPages()) _usersPage++; renderUsersTable(); });
}

async function initUserManagement() {
  console.log('### USER MANAGEMENT INITIALIZED ###');
  if (!requireRole('ICT Admin')) return;

  await refreshUsersTable();

  document.getElementById('addUserBtn')?.addEventListener('click', () => {
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userModalLabel').textContent = 'Add New User';
    document.getElementById('passwordField').style.display = '';
    document.getElementById('userModalAlert').classList.add('d-none');
  });
  /* Real submit handler — the Save button is `type="submit"` (associated via
     form="userForm"). Intercepting the form submit event covers BOTH the button
     click and pressing Enter in a field, with a single guaranteed trigger. */
  document.getElementById('userForm')?.addEventListener('submit', (e) => {
    console.log('### USER FORM SUBMIT FIRED ###');
    e.preventDefault();
    saveUser();
  });
  document.getElementById('confirmDeleteUserBtn')?.addEventListener('click', doDeleteUser);
  document.getElementById('confirmChangeRoleBtn')?.addEventListener('click', doChangeRole);

  /* Event delegation for the dynamically rendered Actions dropdown.
     Since the table is re-rendered on refresh/filter, we bind one listener
     on the tbody that survives every render. Clicks land on the dropdown
     menu items (still DOM children of the row cell). */
  const tbody = document.getElementById('usersTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const item = e.target.closest('[data-user-action]');
      if (item) {
        e.preventDefault();           // <a href="#"> must not jump the page
        const id = item.getAttribute('data-id');
        if (!id) { console.error('User action: missing user id.'); showToast('Could not identify the user.', 'danger'); return; }
        const what = item.getAttribute('data-user-action');
        const name = item.getAttribute('data-name') || 'this user';
        const toc   = item.closest('.dropdown')?.querySelector('.dropdown-toggle');
        if (what === 'view')       viewUser(id);
        else if (what === 'edit')  editUser(id);
        else if (what === 'role')  openChangeRole(id, name, item.getAttribute('data-role') || '');
        else if (what === 'deactivate') {
          prepDeleteUser(id, name);
          const modal = document.getElementById('deleteUserModal');
          if (modal) new bootstrap.Modal(modal).show();
        }
        /* Close the opened dropdown after an action */
        if (toc) { const inst = bootstrap.Dropdown.getInstance(toc); if (inst) inst.hide(); }
      }
    });
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const filtered = filteredUsers();

  const countEl = document.getElementById('adminUsersCount');
  if (countEl) {
    if (filtered.length) {
      countEl.textContent = `Showing ${filtered.length} user${filtered.length === 1 ? '' : 's'}`;
    } else {
      countEl.textContent = '0 users';
    }
  }

  const resetBtn = document.getElementById('resetUserFiltersBtn');
  if (resetBtn) resetBtn.style.display = (_allUsersQuery.q || _allUsersQuery.role || _allUsersQuery.status) ? 'inline-flex' : 'none';

  const pageWrap = document.getElementById('adminUsersPaginationWrap');
  const pageInfo = document.getElementById('adminUsersPageInfo');
  const maxPages = _usersMaxPages();
  if (_usersPage > maxPages) _usersPage = maxPages;
  const start = (_usersPage - 1) * _USERS_PAGE_SIZE;
  const page  = filtered.slice(start, start + _USERS_PAGE_SIZE);

  if (pageWrap) pageWrap.style.display = filtered.length > _USERS_PAGE_SIZE ? '' : 'none';
  if (pageInfo) pageInfo.textContent = filtered.length ? `Showing ${start + 1}–${Math.min(start + _USERS_PAGE_SIZE, filtered.length)} of ${filtered.length} users` : '';

  const prevBtn = document.getElementById('adminUsersPrevBtn');
  const nextBtn = document.getElementById('adminUsersNextBtn');
  if (prevBtn) prevBtn.disabled = _usersPage <= 1;
  if (nextBtn) nextBtn.disabled = _usersPage >= maxPages;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="text-center py-5">
      <i class="bi bi-people fs-1 text-muted d-block mb-2"></i>
      <p class="text-muted mb-0">${_allUsersQuery.q ? 'No users match your search.' : 'No users found.'}</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = page.map((u, i) => `
    <tr>
      <td class="text-muted">${escHtml(start + i + 1)}</td>
      <td><strong>${escHtml(u.fullName)}</strong></td>
      <td class="text-muted small">${escHtml(u.email)}</td>
      <td>${userRoleBadge(u.role)}</td>
      <td>${escHtml(u.department || '—')}</td>
      <td>${userStatusBadge(u.status)}</td>
      <td><small class="text-muted">${formatDate(u.createdAt || u.created_at)}</small></td>
      <td class="text-nowrap">
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
        </div>
      </td>
    </tr>`).join('');
}

async function editUser(id) {
  try {
    const { data: u } = await apiRequest(`/users/${id}`);
    document.getElementById('userId').value         = u._id || u.id;
    document.getElementById('userName').value       = u.fullName;
    document.getElementById('userEmail').value      = u.email;
    document.getElementById('userRole').value       = u.role;
    document.getElementById('userStatus').value     = u.status;
    document.getElementById('userDepartment').value = u.department||'';
    document.getElementById('userPhone').value      = u.phone||'';
    document.getElementById('userPassword').value   = '';
    document.getElementById('userModalLabel').textContent = 'Edit User';
    document.getElementById('passwordField').style.display = '';
    new bootstrap.Modal(document.getElementById('userModal')).show();
  } catch (err) { console.error('Load user for edit failed:', err); showToast(err.message,'danger'); }
}

/* ── View User ───────────────────────────────────────────── */
async function viewUser(id) {
  console.log('[VIEW USER] opening for id:', id);
  try {
    const { data: u } = await apiRequest(`/users/${id}`);
    const set   = (el, val) => { const n = document.getElementById(el); if (n) n.textContent = val ?? '—'; };
    set('viewUserName',     u.fullName);
    set('viewUserEmail',    u.email);
    set('viewUserRole',     u.role);
    set('viewUserStatus',   u.status);
    set('viewUserDepartment', u.department || '—');
    set('viewUserPhone',    u.phone || '—');
    set('viewUserCreated',  formatDate(u.createdAt || u.created_at));
    new bootstrap.Modal(document.getElementById('viewUserModal')).show();
  } catch (err) {
    console.error('[VIEW USER] error:', err);
    showToast(err.message, 'danger');
  }
}

/* ── Change Role ─────────────────────────────────────────── */
let _changingRole = false;

function openChangeRole(id, name, currentRole) {
  console.log('[CHANGE ROLE] opening for id:', id);
  document.getElementById('changeRoleUserId').value = id;
  const nameEl = document.getElementById('changeRoleUserName');
  if (nameEl) nameEl.textContent = name;
  const sel = document.getElementById('changeRoleSelect');
  if (sel) sel.value = currentRole || '';
  const alertEl = document.getElementById('changeRoleAlert');
  if (alertEl) alertEl.classList.add('d-none');
  new bootstrap.Modal(document.getElementById('changeRoleModal')).show();
}

async function doChangeRole() {
  const id   = document.getElementById('changeRoleUserId').value;
  const role = document.getElementById('changeRoleSelect').value;
  if (!id)   { console.error('Change role: missing user id.'); showToast('Could not identify the user.', 'danger'); return; }
  if (!role) { showAlert('changeRoleAlert', 'Please select a role.', 'warning'); return; }

  if (_changingRole) return;            // prevent double submit
  _changingRole = true;
  const label = document.getElementById('changeRoleLabel');
  setLoading('confirmChangeRoleBtn', 'changeRoleSpinner', true);
  if (label) label.textContent = 'Saving...';

  try {
    console.log('[CHANGE ROLE] PUT /api/users/' + id, { role });
    const resp = await apiRequest(`/users/${id}`, { method: 'PUT', body: { role } });
    console.log('[CHANGE ROLE] response:', resp);
    const modal = document.getElementById('changeRoleModal');
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    showToast('User role updated.', 'success');
    await refreshUsersTable();
  } catch (err) {
    console.error('[CHANGE ROLE] error:', err);
    showAlert('changeRoleAlert', (err && err.status ? 'HTTP ' + err.status + ' — ' : '') + (err && err.message ? err.message : 'Failed to change role.'), 'danger');
  } finally {
    _changingRole = false;
    setLoading('confirmChangeRoleBtn', 'changeRoleSpinner', false);
    if (label) label.textContent = 'Change Role';
  }
}

let _savingUser = false;

async function saveUser() {
  console.log('### SAVE USER FUNCTION CALLED ###');
  const saveBtn    = document.getElementById('saveUserBtn');
  const saveLabel  = document.getElementById('saveUserLabel');

  /* Prevent duplicate SUBMITs from rapid clicks / Enter key presses. */
  if (_savingUser) return;
  _savingUser = true;
  setLoading('saveUserBtn','saveUserSpinner',true);
  if (saveLabel) saveLabel.textContent = 'Saving...';

  const id = document.getElementById('userId').value;
  const pw = document.getElementById('userPassword').value;
  const body = {
    fullName:     document.getElementById('userName').value.trim(),
    email:        document.getElementById('userEmail').value.trim(),
    role:         document.getElementById('userRole').value,
    status:       document.getElementById('userStatus').value,
    department:   document.getElementById('userDepartment').value.trim(),
    phone:        document.getElementById('userPhone').value.trim(),
  };

  /* Diagnostic (no password logged): trace ADD USER end-to-end in the browser
     console so a "does not save" report pinpoints the failing step. */
  console.log('[ADD USER] mode:', id ? 'EDIT' : 'CREATE', '| payload:', { ...body, password: pw ? '[REDACTED]' : '' });
  console.log('[ADD USER] token present:', !!Auth.getToken());

  /* Validate fields */
  let hasError = false;

  if (!body.fullName || body.fullName.length < 2) {
    showAlert('userModalAlert', 'Name must be at least 2 characters.', 'warning');
    hasError = true;
  }

  if (!body.email || Validators.email(body.email)) {
    showAlert('userModalAlert', 'Please enter a valid email address.', 'warning');
    hasError = true;
  }

  if (!body.role) {
    showAlert('userModalAlert', 'Role is required.', 'warning');
    hasError = true;
  }

  if (!id && !pw) {
    showAlert('userModalAlert', 'Password is required for new users.', 'warning');
    hasError = true;
  }

  if (!id && pw && Validators.password(pw)) {
    showAlert('userModalAlert', 'Password must be at least 8 characters and contain both letters and numbers.', 'warning');
    hasError = true;
  }

  if (body.phone && Validators.phone(body.phone)) {
    showAlert('userModalAlert', 'Please enter a valid phone number.', 'warning');
    hasError = true;
  }

  if (hasError) {
    _savingUser = false;
    setLoading('saveUserBtn','saveUserSpinner',false);
    if (saveLabel) saveLabel.textContent = 'Save User';
    return;
  }

  try {
    if (id) {
      console.log('[ADD USER] sending PUT /api/users/' + id);
      await apiRequest(`/users/${id}`, { method:'PUT', body });
      if (pw) await apiRequest(`/users/${id}/password`, { method:'PUT', body:{ password:pw } });
      console.log('[ADD USER] PUT /api/users/' + id + ' OK');
    } else {
      console.log('[ADD USER] sending POST /api/users', body);
      const resp = await apiRequest('/users', { method:'POST', body:{ ...body, password:pw } });
      console.log('[ADD USER] POST response:', resp);
    }

    /* Close the modal, clear the form, then refresh the table in place so the
       newly added/updated user appears immediately (re-fetches GET /api/users). */
    const modalEl = document.getElementById('userModal');
    if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
    document.getElementById('userForm').reset();
    document.getElementById('userModalAlert').classList.add('d-none');

    if (id) {
      showToast('User updated.', 'success');
    } else {
      showToast('User added successfully!', 'success');
    }
    console.log('[ADD USER] refreshing users table (GET /api/users)...');
    await refreshUsersTable();
    console.log('[ADD USER] table refreshed.');
  } catch (err) {
    console.error('[ADD USER] error:', err);
    const backendMsg = err && err.message ? err.message : 'Failed to save user. Please try again.';

    if (id) {
      /* For edit mode, show detailed error in modal */
      const parts = [];
      if (err && typeof err.status === 'number') {
        parts.push('HTTP ' + err.status + (err.status === 401 ? ' (Unauthorized/session expired)' : err.status === 403 ? ' (Forbidden)' : err.status === 404 ? ' (Not found)' : err.status === 409 ? ' (Conflict)' : err.status === 500 ? ' (Server error)' : ''));
      }
      if (err && err.message) {
        parts.push(err.message);
      }
      if (!parts.length) parts.push('Unknown error.');
      showAlert('userModalAlert', 'Failed to save user: ' + parts.join(' — '), 'danger');
    } else {
      /* For create mode, show the ACTUAL backend error message in the modal alert
         so the user sees it while the modal is still open */
      showAlert('userModalAlert', backendMsg, 'danger');
    }
  }
  finally {
    _savingUser = false;
    setLoading('saveUserBtn','saveUserSpinner',false);
    if (saveLabel) saveLabel.textContent = 'Save User';
  }
}

function prepDeleteUser(id, name) {
  document.getElementById('deleteUserId').value          = id;
  document.getElementById('deleteUserName').textContent  = name;
}
async function doDeleteUser() {
  const id = document.getElementById('deleteUserId').value;
  if (!id) { console.error('Delete user: missing user id.'); showToast('Could not identify the user to deactivate.', 'danger'); return; }
  try {
    await apiRequest(`/users/${id}`, { method:'DELETE' });
    const modal = document.getElementById('deleteUserModal');
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    showToast('User deactivated successfully.', 'success');
    await refreshUsersTable();
  } catch (err) { console.error('Delete user failed:', err); showToast(err.message,'danger'); }
}

/* ═══════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════ */
async function populateSelect(id, endpoint, allOpt=false) {
  try {
    const { data } = await apiRequest(endpoint);
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = '';
    if (first) sel.appendChild(first);
    if (allOpt) {
      const o=document.createElement('option'); o.value=''; o.textContent='All Categories'; sel.appendChild(o);
    }
    data.forEach(item => {
      const o=document.createElement('option');
      // Support both MySQL (id) and MongoDB (_id)
      o.value = item._id || item.id || '';
      o.textContent = item.name;
      sel.appendChild(o);
    });
  } catch (_) {}
}

async function populateAssetSelect(id) {
  try {
    const { data } = await apiRequest('/assets');
    const sel = document.getElementById(id);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = '';
    if (first) sel.appendChild(first);
    data.forEach(a => {
      const o=document.createElement('option');
      o.value = a._id || a.id || '';
      o.textContent=`${a.asset_tag} — ${a.asset_name}`;
      sel.appendChild(o);
    });
  } catch (_) {}
}

async function loadAssets() {
  const sel = document.getElementById('asset');
  if (!sel) return;

  /* Show loading state */
  sel.innerHTML = '<option value="" disabled selected>Loading ICT Assets...</option>';
  sel.disabled = true;

  try {
    /* Only fetch available (active) assets for the requester dropdown */
    const result = await apiRequest('/assets?status=active');
    const data = result?.data || result || [];

    /* Rebuild the select */
    sel.innerHTML = '';

    /* Placeholder option — first option, empty value */
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select ICT Asset';
    sel.appendChild(placeholder);

    /* No Asset option */
    const noAsset = document.createElement('option');
    noAsset.value = 'none';
    noAsset.textContent = 'No Asset / Not Applicable';
    sel.appendChild(noAsset);

    if (!data || data.length === 0) {
      /* Empty state */
      const empty = document.createElement('option');
      empty.value = '';
      empty.disabled = true;
      empty.selected = true;
      empty.textContent = 'No ICT Assets Available';
      sel.appendChild(empty);
      sel.value = 'none';
    } else {
      /* Populate real assets: display "asset_tag — asset_name" */
      data.forEach(a => {
        const o = document.createElement('option');
        o.value = a._id || a.id || '';
        o.textContent = `${a.asset_tag} — ${a.asset_name}`;
        sel.appendChild(o);
      });
    }

    sel.disabled = false;
  } catch (err) {
    /* Error state with retry button */
    sel.innerHTML = '';
    const errorOpt = document.createElement('option');
    errorOpt.value = '';
    errorOpt.disabled = true;
    errorOpt.selected = true;
    errorOpt.textContent = 'Unable to load ICT Assets — click to retry';
    sel.appendChild(errorOpt);

    /* Add click handler to retry */
    sel.onclick = () => {
      if (sel.value === '' && sel.options[0]?.textContent?.includes('Unable to load')) {
        loadAssets();
      }
    };

    sel.disabled = false;
  }
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(target)||0; let cur=0;
  const step = Math.max(1, Math.ceil(n/30));
  const t = setInterval(() => { cur=Math.min(cur+step,n); el.textContent=cur; if(cur>=n) clearInterval(t); },30);
}
