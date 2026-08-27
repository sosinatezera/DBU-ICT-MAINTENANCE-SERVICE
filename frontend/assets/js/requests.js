/* ============================================================
   requests.js  —  All User/Admin Request Logic
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  const p = window.location.pathname;

  if (p.includes('user/dashboard'))    await initUserDashboard();
  if (p.includes('user/request'))      await initSubmitRequest();
  if (p.includes('user/tracking'))     await initTracking();
  if (p.includes('user/history'))      await initUserHistory();
  if (p.includes('user/feedback'))     await initFeedback();
  if (p.includes('admin/requests'))    await initAdminRequests();
  if (p.includes('admin/categories'))  await initCategories();
  if (p.includes('admin/users'))       await initUserManagement();
});

/* ═══════════════════════════════════════════════════════════
   USER DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function initUserDashboard() {
  if (!requireRole('Requester', 'student')) return;
  const user = Auth.getUser();

  const w = document.getElementById('welcomeName');
  if (w) w.textContent = user?.fullName || 'User';

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

    const tbody = document.getElementById('requestsTableBody');
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
        <td>
          <button class="btn btn-sm btn-outline-primary py-0 px-2"
                  onclick="openDetailModal('${r.id}')"
                  data-bs-toggle="modal" data-bs-target="#requestDetailModal">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>`).join('');

  } catch (err) { showToast(err.message, 'danger'); }
}

/* ═══════════════════════════════════════════════════════════
   SUBMIT REQUEST
   ═══════════════════════════════════════════════════════════ */
async function initSubmitRequest() {
  if (!requireRole('Requester', 'student')) return;
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
      if (lbl) { lbl.style.borderColor='#0d6efd'; lbl.style.background='#e8f0fe'; lbl.style.color='#0d6efd'; }
    });
  });

  document.getElementById('previewBtn')?.addEventListener('click', showPreview);

  document.getElementById('requestForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form       = e.target;
    const deviceType = document.querySelector('input[name="deviceType"]:checked')?.value;
    const devErr     = document.getElementById('deviceTypeError');

    /* Prevent double submission */
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn && submitBtn.disabled) return;

    /* Validate fields */
    let hasError = false;

    const nameErr = Validators.name(document.getElementById('requesterName')?.value, 'Full name');
    if (nameErr) { showFieldError('requesterName', nameErr); hasError = true; } else { showFieldValid('requesterName'); }

    const titleErr = Validators.length(document.getElementById('title')?.value, 'Title', 5, 200);
    if (titleErr) { showFieldError('title', titleErr); hasError = true; } else { showFieldValid('title'); }

    if (!deviceType) {
      if (devErr) { devErr.textContent = 'Please select a device type.'; devErr.style.display = 'block'; }
      hasError = true;
    } else { if (devErr) devErr.style.display = 'none'; }

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

    if (hasError) {
      /* Scroll to first error */
      const firstInvalid = form.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const fd = new FormData();
    fd.append('title',              document.getElementById('title').value.trim());
    fd.append('equipmentType',      deviceType);
    fd.append('problemDescription', document.getElementById('description').value.trim());
    fd.append('priority',           document.getElementById('priority').value);
    fd.append('phone',              document.getElementById('requesterPhone').value.trim());

    /* Append validated category */
    fd.append('category', catValue);

    /* Append asset selection */
    const assetValue = document.getElementById('asset')?.value;
    if (assetValue && assetValue !== 'none') {
      fd.append('asset_id', assetValue);
    }

    const file = document.getElementById('attachment')?.files[0];
    if (file) fd.append('attachment', file);

    setLoading('submitBtn', 'submitSpinner', true);
    try {
      await apiRequest('/tickets', { method: 'POST', body: fd, isFormData: true });
      showAlert('requestAlert', '✓ Request submitted! Technicians have been notified. Redirecting...', 'success');
      form.reset();
      document.getElementById('summaryCard')?.classList.add('d-none');
      setTimeout(() => (window.location.href = 'tracking.html'), 2200);
    } catch (err) {
      showAlert('requestAlert', err.message, 'danger');
    } finally {
      setLoading('submitBtn', 'submitSpinner', false);
    }
  });
}

function showPreview() {
  const name    = document.getElementById('requesterName')?.value || '—';
  const phone   = document.getElementById('requesterPhone')?.value || '—';
  const device  = document.querySelector('input[name="deviceType"]:checked')?.value || '—';
  const title   = document.getElementById('title')?.value || '—';
  const catEl   = document.getElementById('category');
  const cat     = catEl?.value || '—';
  const pri     = document.getElementById('priority')?.value || '—';
  const desc    = document.getElementById('description')?.value || '—';
  const assetEl = document.getElementById('asset');
  const asset   = assetEl?.value === 'none' ? 'No Asset / Not Applicable' : (assetEl?.selectedOptions[0]?.text || '—');
  const priC    = {low:'success',medium:'primary',high:'warning',critical:'danger'}[pri]||'secondary';
  const devI    = {computer:'bi-pc-display',laptop:'bi-laptop',mobile:'bi-phone',tablet:'bi-tablet',printer:'bi-printer',other:'bi-hdd-stack'}[device]||'bi-hdd-stack';

  const card    = document.getElementById('summaryCard');
  const content = document.getElementById('summaryContent');
  if (!card || !content) return;

  content.innerHTML = `
    <div class="col-sm-6 col-md-3"><div class="text-muted small mb-1">Requester</div><div class="fw-semibold">${escHtml(name)}</div></div>
    <div class="col-sm-6 col-md-3"><div class="text-muted small mb-1">Phone</div><div class="fw-semibold">${escHtml(phone)}</div></div>
    <div class="col-sm-6 col-md-3"><div class="text-muted small mb-1">Device</div>
      <div class="fw-semibold text-capitalize"><i class="bi ${devI} me-1"></i>${escHtml(device)}</div></div>
    <div class="col-sm-6 col-md-3"><div class="text-muted small mb-1">Priority</div>
      <span class="badge bg-${priC} text-capitalize">${pri}</span></div>
    <div class="col-12"><div class="text-muted small mb-1">Title</div><div class="fw-semibold">${escHtml(title)}</div></div>
    <div class="col-sm-6"><div class="text-muted small mb-1">Category</div><div>${escHtml(cat)}</div></div>
    <div class="col-sm-6"><div class="text-muted small mb-1">Asset</div><div>${escHtml(asset)}</div></div>
    <div class="col-12"><div class="text-muted small mb-1">Description</div>
      <div class="p-2 bg-white border rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(desc)}</div></div>`;

  card.classList.remove('d-none');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════════════════════════════════════════════════════
   TRACKING PAGE
   ═══════════════════════════════════════════════════════════ */
async function initTracking() {
  if (!requireRole('Requester', 'student')) return;
  let all = [];
  try {
    const { data } = await apiRequest('/tickets/my');
    all = data;
    renderCards(all);
  } catch (err) { showToast(err.message, 'danger'); }

  const doFilter = () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const st = document.getElementById('statusFilter')?.value || '';
    const pr = document.getElementById('priorityFilter')?.value || '';
    renderCards(all.filter(r =>
      (!q  || (r.problemDescription||'').toLowerCase().includes(q)) &&
      (!st || r.status === st) &&
      (!pr || r.priority === pr)
    ));
  };

  document.getElementById('searchBtn')?.addEventListener('click', doFilter);
  document.getElementById('searchInput')?.addEventListener('keydown', e => { if (e.key==='Enter') doFilter(); });
  document.getElementById('statusFilter')?.addEventListener('change', doFilter);
  document.getElementById('priorityFilter')?.addEventListener('change', doFilter);

  /* Arrived from a notification click (e.g. tracking.html?id=...) → open that ticket directly */
  const focusId = new URLSearchParams(window.location.search).get('id');
  if (focusId) openDetailModal(focusId);
}

function renderCards(requests) {
  const container = document.getElementById('requestsList');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = `<div class="col-12 text-center py-5">
      <i class="bi bi-search fs-1 text-muted d-block mb-2"></i>
      <p class="text-muted">No requests found.</p>
      <a href="request.html" class="btn btn-outline-primary btn-sm">Submit a Request</a>
    </div>`;
    return;
  }
  const priColour = {critical:'#dc3545',high:'#fd7e14',medium:'#0d6efd',low:'#198754'};
  container.innerHTML = requests.map(r => `
    <div class="col-md-6 col-lg-4">
      <div class="card border-0 shadow-sm h-100"
           style="border-left:4px solid ${priColour[r.priority]||'#6c757d'}!important;">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="text-muted small fw-semibold">${escHtml(r.ticketId || r.id)}</span>
            ${priorityBadge(r.priority)}
          </div>
          <h6 class="fw-semibold mb-1 text-truncate" title="${escHtml(r.problemDescription)}">${escHtml(r.problemDescription)}</h6>
          <div class="small text-muted mb-2">${escHtml(r.equipmentType||'Uncategorised')}</div>
          ${statusBadge(r.status)}
          <div class="mt-2 small text-muted"><i class="bi bi-calendar3 me-1"></i>${formatDate(r.created_at)}</div>
        </div>
        <div class="card-footer bg-transparent border-0 pb-3 px-3">
          <button class="btn btn-outline-primary btn-sm w-100"
                  onclick="openDetailModal('${r.id}')"
                  data-bs-toggle="modal" data-bs-target="#requestDetailModal">
            <i class="bi bi-eye me-1"></i>View Details
          </button>
        </div>
      </div>
    </div>`).join('');
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
    if (body) {
      body.innerHTML = `
        <div class="row g-3">
          <div class="col-md-8">
            <div class="text-muted small fw-bold text-uppercase mb-1">Ticket</div>
            <h5 class="mb-3">${escHtml(r.ticketId || r.id)}</h5>
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
              <div class="mb-2"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
              ${r.assignedTechnician ? `<div><div class="text-muted small mb-1">Technician</div><span class="small fw-semibold text-success"><i class="bi bi-wrench me-1"></i>${escHtml(r.assignedTechnician)}</span></div>` : ''}
            </div>
          </div>
        </div>`;
    }

    const tl = document.getElementById('statusTimeline');
    if (tl) {
      const steps    = ['submitted', 'assigned', 'in_progress', 'resolved'];
      const labels   = ['Submitted', 'Assigned', 'In Progress', 'Resolved'];
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
   ═══════════════════════════════════════════════════════════ */
async function initUserHistory() {
  if (!requireRole('Requester', 'student')) return;
  try {
    const { data } = await apiRequest('/tickets/my');
    const closed   = data.filter(r => ['resolved','closed'].includes(r.status));
    renderHistoryTable(closed);

    document.getElementById('filterBtn')?.addEventListener('click', () => {
      const from = document.getElementById('dateFrom')?.value;
      const to   = document.getElementById('dateTo')?.value;
      const filtered = closed.filter(r => {
        const d = new Date(r.created_at);
        return (!from || d >= new Date(from)) && (!to || d <= new Date(to + 'T23:59:59'));
      });
      renderHistoryTable(filtered);
    });

    document.getElementById('exportBtn')?.addEventListener('click', () => window.print());
  } catch (err) { showToast(err.message, 'danger'); }
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
   FEEDBACK
   ═══════════════════════════════════════════════════════════ */
async function initFeedback() {
  if (!requireRole('Requester', 'student')) return;
  try {
    const { data } = await apiRequest('/tickets/my');
    renderPendingFeedback(data.filter(r => ['resolved','closed'].includes(r.status) && !r.feedbackRating));
  } catch (err) { showToast(err.message, 'danger'); }

  initStarRating();

  document.getElementById('feedbackForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id      = document.getElementById('feedbackRequestId').value;
    const rating  = document.getElementById('ratingValue').value;
    const comment = document.getElementById('comment').value.trim();
    if (!rating) { showAlert('feedbackAlert', 'Please select a star rating.', 'warning'); return; }

    if (comment && comment.length < 5) {
      showAlert('feedbackAlert', 'Comment must be at least 5 characters if provided.', 'warning');
      return;
    }

    setLoading('feedbackSubmitBtn', 'feedbackSpinner', true);
    try {
      await apiRequest('/feedback', { method: 'POST', body: { request_id: id, rating, comment } });
      showAlert('feedbackAlert', '✓ Feedback submitted. Thank you!', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      showAlert('feedbackAlert', err.message, 'danger');
    } finally {
      setLoading('feedbackSubmitBtn', 'feedbackSpinner', false);
    }
  });
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

function initStarRating() {
  const stars  = document.querySelectorAll('.star-rating .star');
  const labels = ['','Poor','Fair','Good','Very Good','Excellent'];
  stars.forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.value);
      document.getElementById('ratingValue').value = val;
      const el = document.getElementById('ratingLabel');
      if (el) el.textContent = labels[val] || '';
      stars.forEach((s, i) => {
        s.className = i < val ? 'bi bi-star-fill text-warning star' : 'bi bi-star text-warning star';
      });
    });
    star.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') star.click(); });
  });
}

/* ═══════════════════════════════════════════════════════════
   ADMIN REQUESTS PAGE
   ═══════════════════════════════════════════════════════════ */
async function initAdminRequests() {
  if (!requireRole('ICT Admin')) return;
  await populateSelect('categoryFilter', '/categories', true);

  let all = [];
  try {
    const { data } = await apiRequest('/tickets');
    all = data;
    renderAdminTable(all);
  } catch (err) { showToast(err.message, 'danger'); }

  const doFilter = () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase()||'';
    const st = document.getElementById('statusFilter')?.value||'';
    const pr = document.getElementById('priorityFilter')?.value||'';
    renderAdminTable(all.filter(r =>
      (!q  || (r.problemDescription||'').toLowerCase().includes(q)||(r.requester_name||'').toLowerCase().includes(q)) &&
      (!st || r.status===st) && (!pr || r.priority===pr)
    ));
  };

  document.getElementById('searchBtn')?.addEventListener('click', doFilter);
  document.getElementById('searchInput')?.addEventListener('keydown', e => { if(e.key==='Enter') doFilter(); });
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
      <td>
        <button class="btn btn-sm btn-primary py-0 px-2"
                onclick="openAdminRequestModal('${r.id}')"
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
      section.innerHTML = `
        <h6 class="fw-bold mb-3">${escHtml(r.ticketId || r.id)}</h6>
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="text-muted small mb-1">Status</div>${statusBadge(r.status)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Priority</div>${priorityBadge(r.priority)}</div>
          <div class="col-6"><div class="text-muted small mb-1">Requester</div><span class="small">${escHtml(r.requester_name||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Phone</div><span class="small">${escHtml(r.phone||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Equipment</div><span class="small">${escHtml(r.equipmentType||'—')}</span></div>
          <div class="col-6"><div class="text-muted small mb-1">Department</div><span class="small">${escHtml(r.department||'—')}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Submitted</div><span class="small">${formatDateTime(r.created_at)}</span></div>
          <div class="col-12"><div class="text-muted small mb-1">Description</div>
            <div class="p-2 bg-light rounded small" style="white-space:pre-wrap;max-height:80px;overflow-y:auto;">${escHtml(r.problemDescription)}</div>
          </div>
        </div>`;
    }

    const sel = document.getElementById('assignTechSelect');
    if (sel) {
      const { data: techs } = await apiRequest('/technicians');
      sel.innerHTML = `<option value="">-- Select Technician --</option>` +
        techs.map(t => `<option value="${t.id}">${escHtml(t.fullName)} — ${escHtml(t.specialization||'General')} ${t.available?'✓':''}</option>`).join('');
    }

    const assignBtn = document.getElementById('doAssignBtn');
    if (assignBtn) {
      assignBtn.onclick = async () => {
        const techId = document.getElementById('assignTechSelect')?.value;
        const notes  = document.getElementById('assignNotes')?.value||'';
        if (!techId) { showAlert('assignAlert','Please select a technician.','warning'); return; }
        setLoading('doAssignBtn','doAssignSpinner',true);
        try {
          await apiRequest('/assignments', { method:'POST', body:{ ticket_id:id, technician_id:techId, notes } });
          showToast('Technician assigned!','success');
          setTimeout(() => window.location.reload(), 1200);
        } catch (err) { showAlert('assignAlert', err.message, 'danger'); }
        finally { setLoading('doAssignBtn','doAssignSpinner',false); }
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

/* ═══════════════════════════════════════════════════════════
   CATEGORIES (Admin)
   ═══════════════════════════════════════════════════════════ */
async function initCategories() {
  if (!requireRole('ICT Admin')) return;
  await refreshCategoriesTable();

  document.getElementById('saveCategoryBtn')?.addEventListener('click', async () => {
    const id   = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();
    const desc = document.getElementById('categoryDescription').value.trim();
    if (!name || name.length < 2) { showAlert('categoryModalAlert','Category name must be at least 2 characters.','warning'); return; }
    if (name.length > 100) { showAlert('categoryModalAlert','Category name must be no more than 100 characters.','warning'); return; }

    setLoading('saveCategoryBtn','saveCategorySpinner',true);
    try {
      if (id) await apiRequest(`/categories/${id}`, { method:'PUT', body:{ name, description:desc } });
      else     await apiRequest('/categories', { method:'POST', body:{ name, description:desc } });
      showToast(id ? 'Category updated.' : 'Category created.','success');
      bootstrap.Modal.getInstance(document.getElementById('categoryModal'))?.hide();
      await refreshCategoriesTable();
    } catch (err) { showAlert('categoryModalAlert', err.message, 'danger'); }
    finally { setLoading('saveCategoryBtn','saveCategorySpinner',false); }
  });
}

async function refreshCategoriesTable() {
  try {
    const { data } = await apiRequest('/categories');
    const tbody = document.getElementById('categoriesTableBody');
    if (tbody) {
      tbody.innerHTML = data.map((c,i) => `
        <tr>
          <td>${i+1}</td>
          <td><strong>${escHtml(c.name)}</strong></td>
          <td>${escHtml(c.description||'—')}</td>
          <td>—</td>
          <td>
            <button class="btn btn-sm btn-outline-primary me-1"
                    onclick="editCategory(${c.id},'${escHtml(c.name)}','${escHtml(c.description||'')}')">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger"
                    onclick="deleteCategory(${c.id},'${escHtml(c.name)}')">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>`).join('');
    }
    // Category stats panel
    const stats = document.getElementById('categoryStats');
    if (stats) {
      const colours = ['#0d6efd','#198754','#ffc107','#dc3545','#0dcaf0','#6f42c1','#fd7e14','#20c997','#6c757d','#d63384'];
      stats.innerHTML = data.map((c,i) => `
        <div class="d-flex align-items-center gap-2 py-2 border-bottom">
          <span style="width:10px;height:10px;border-radius:50%;background:${colours[i%colours.length]};display:inline-block;flex-shrink:0;"></span>
          <span class="small flex-grow-1">${escHtml(c.name)}</span>
        </div>`).join('');
    }
  } catch (err) { showToast(err.message,'danger'); }
}

function editCategory(id, name, desc) {
  document.getElementById('categoryId').value          = id;
  document.getElementById('categoryName').value        = name;
  document.getElementById('categoryDescription').value = desc;
  document.getElementById('categoryModalLabel').textContent = 'Edit Category';
  new bootstrap.Modal(document.getElementById('categoryModal')).show();
}
async function deleteCategory(id, name) {
  if (!confirm(`Delete category "${name}"?`)) return;
  try {
    await apiRequest(`/categories/${id}`, { method:'DELETE' });
    showToast('Category deleted.','success');
    await refreshCategoriesTable();
  } catch (err) { showToast(err.message,'danger'); }
}

/* ═══════════════════════════════════════════════════════════
   USER MANAGEMENT (Admin)
   ═══════════════════════════════════════════════════════════ */
async function initUserManagement() {
  if (!requireRole('ICT Admin')) return;
  let all = [];

  try {
    const { data } = await apiRequest('/users');
    all = data;
    renderUsersTable(all);
  } catch (err) { showToast(err.message,'danger'); }

  const doFilter = () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase()||'';
    const rl = document.getElementById('roleFilter')?.value||'';
    const st = document.getElementById('statusFilter')?.value||'';
    renderUsersTable(all.filter(u =>
      (!q  || u.fullName.toLowerCase().includes(q)||u.email.toLowerCase().includes(q)) &&
      (!rl || u.role===rl) && (!st || u.status===st)
    ));
  };

  document.getElementById('searchBtn')?.addEventListener('click', doFilter);
  document.getElementById('addUserBtn')?.addEventListener('click', () => {
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userModalLabel').textContent = 'Add New User';
    document.getElementById('passwordField').style.display = '';
  });
  document.getElementById('saveUserBtn')?.addEventListener('click', saveUser);
  document.getElementById('confirmDeleteUserBtn')?.addEventListener('click', doDeleteUser);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="text-center py-4"><i class="bi bi-people fs-2 text-muted d-block mb-2"></i><p class="text-muted">No users found.</p></div></td></tr>`;
    return;
  }
  const roleC = {'ICT Admin':'danger', Technician:'warning', Requester:'primary'};
  tbody.innerHTML = users.map((u,i) => `
    <tr>
      <td>${i+1}</td>
      <td><strong>${escHtml(u.fullName)}</strong></td>
      <td class="text-muted small">${escHtml(u.email)}</td>
      <td><span class="badge bg-${roleC[u.role]||'secondary'}">${u.role}</span></td>
      <td>${escHtml(u.department||'—')}</td>
      <td><span class="badge ${u.status==='active'?'bg-success':'bg-secondary'}">${u.status}</span></td>
      <td><small class="text-muted">${formatDate(u.created_at)}</small></td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 py-0 px-2" onclick="editUser(${u.id})"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2"
                onclick="prepDeleteUser(${u.id},'${escHtml(u.fullName)}')"
                data-bs-toggle="modal" data-bs-target="#deleteUserModal">
          <i class="bi bi-person-dash"></i>
        </button>
      </td>
    </tr>`).join('');
}

async function editUser(id) {
  try {
    const { data: u } = await apiRequest(`/users/${id}`);
    document.getElementById('userId').value         = u.id;
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
  } catch (err) { showToast(err.message,'danger'); }
}

async function saveUser() {
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

  if (hasError) return;

  setLoading('saveUserBtn','saveUserSpinner',true);
  try {
    if (id) {
      await apiRequest(`/users/${id}`, { method:'PUT', body });
      if (pw) await apiRequest(`/users/${id}/password`, { method:'PUT', body:{ password:pw } });
    } else {
      await apiRequest('/users', { method:'POST', body:{ ...body, password:pw } });
    }
    showToast(id ? 'User updated.' : 'User created.', 'success');
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) { showAlert('userModalAlert', err.message, 'danger'); }
  finally { setLoading('saveUserBtn','saveUserSpinner',false); }
}

function prepDeleteUser(id, name) {
  document.getElementById('deleteUserId').value          = id;
  document.getElementById('deleteUserName').textContent  = name;
}
async function doDeleteUser() {
  const id = document.getElementById('deleteUserId').value;
  try {
    await apiRequest(`/users/${id}`, { method:'DELETE' });
    showToast('User deactivated.','success');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) { showToast(err.message,'danger'); }
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
  sel.innerHTML = '<option value="" disabled selected>Loading assets...</option>';
  sel.disabled = true;
  
  try {
    const result = await apiRequest('/assets');
    const data = result?.data || result || [];
    
    /* Rebuild the select */
    sel.innerHTML = '';
    
    /* Placeholder option */
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
      empty.textContent = 'No assets registered in the system';
      sel.appendChild(empty);
      sel.value = 'none';
    } else {
      /* Populate assets */
      data.forEach(a => {
        const o = document.createElement('option');
        o.value = a._id || a.id || '';
        o.textContent = `${a.asset_tag} — ${a.asset_name}`;
        sel.appendChild(o);
      });
    }
    
    sel.disabled = false;
  } catch (err) {
    /* Error state */
    sel.innerHTML = '';
    const errorOpt = document.createElement('option');
    errorOpt.value = '';
    errorOpt.disabled = true;
    errorOpt.selected = true;
    errorOpt.textContent = 'Failed to load assets';
    sel.appendChild(errorOpt);
    
    const retryOpt = document.createElement('option');
    retryOpt.value = 'retry';
    retryOpt.textContent = 'Click here to retry';
    sel.appendChild(retryOpt);
    
    sel.disabled = false;
    
    /* Allow retry on selection */
    sel.addEventListener('change', function handler() {
      if (sel.value === 'retry') {
        sel.removeEventListener('change', handler);
        loadAssets();
      }
    });
  }
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(target)||0; let cur=0;
  const step = Math.max(1, Math.ceil(n/30));
  const t = setInterval(() => { cur=Math.min(cur+step,n); el.textContent=cur; if(cur>=n) clearInterval(t); },30);
}

function escHtml(s) {
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
