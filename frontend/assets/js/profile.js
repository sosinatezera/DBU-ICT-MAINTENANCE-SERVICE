/* ============================================================
   profile.js — Professional Profile feature for the Requester and
   Technician dashboards.
   DBU ICT Maintenance Request & Tracking System

   Role-aware: reads the authenticated role from Auth.getUser() and
   renders ONLY that role's fields (never mixing requester and
   technician data on the same page).

   Reuses the existing architecture:
     - /auth/me                     → full profile (no password)
     - /users/profile      (PUT)    → self-only edit of own personal info
     - /users/change-password (PUT) → secure password change
     - /technicians/me     (GET)    → technician specialization/availability
     - Auth guards, apiRequest, applyProfileAvatar, setText, formatDate,
       showToast, setLoading, t()/data-i18n, dark/light theme.

   Security: the backend scopes every mutation to req.user.id (the
   authenticated identity). A user can never load/edit another user's
   profile and can never change their own role, email, status or id.
   ============================================================ */

(function () {
  if (typeof window === 'undefined') return;

  const PROFILE_SECTION_ID = 'profileSection';
  let _current = null;      // merged profile data
  let _role = null;         // 'Requester' | 'Technician'
  let _saving = false;      // duplicate-submit guard

  function badge(status) {
    const active = status !== 'inactive';
    return `<span class="badge ${active ? 'bg-success' : 'bg-secondary'}">${escHtml(t(status === 'inactive' ? 'profile.status.inactive' : 'profile.status.active'))}</span>`;
  }

  /* Render the profile view (read-only) for whichever role is logged in.
     Builds the avatar header + Personal Info + Account Info sections. */
  function renderProfile() {
    const section = document.getElementById(PROFILE_SECTION_ID);
    if (!section || !_current) return;

    const u = _current;

    const personalRows = `
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.fullName'))}</div>
        <div class="fw-semibold">${escHtml(u.fullName || '—')}</div>
      </div>
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.email'))}</div>
        <div>${escHtml(u.email || '—')}</div>
      </div>
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.gender'))}</div>
        <div>${escHtml(u.gender || '—')}</div>
      </div>
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.phone'))}</div>
        <div>${escHtml(u.phone || '—')}</div>
      </div>
      <div class="col-12">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.department'))}</div>
        <div>${escHtml(u.department || '—')}</div>
      </div>`;

    const accountCols = `
      <div class="col-md-4">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.role'))}</div>
        <div>${roleBadgeText(u.role)}</div>
      </div>
      <div class="col-md-4">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.status'))}</div>
        <div>${badge(u.status)}</div>
      </div>
      <div class="col-md-4">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.created'))}</div>
        <div>${escHtml(formatDate(u.createdAt))}</div>
      </div>
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.lastLogin'))}</div>
        <div>${escHtml(formatDate(u.lastLogin))}</div>
      </div>
      <div class="col-md-6">
        <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.department'))} (ID: ${escHtml(u.id || u._id || '—')})</div>
        <div>${escHtml(u.department || '—')}</div>
      </div>`;

    /* Technician-only extra block (specialization, availability). */
    let techBlock = '';
    if (_role === 'Technician' && u.tech) {
      const avail = u.tech.available !== false;
      techBlock = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.specialization'))}</div>
          <div>${escHtml(u.tech.specialization || '—')}</div>
        </div>
        <div class="col-md-6">
          <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.available'))}</div>
          <span class="badge ${avail ? 'bg-success' : 'bg-secondary'}">
            <i class="bi ${avail ? 'bi-check-circle' : 'bi-x-circle'} me-1"></i>
            ${escHtml(t(avail ? 'profile.available.yes' : 'profile.available.no'))}
          </span>
        </div>
        <div class="col-12">
          <div class="text-muted small fw-semibold mb-1">${escHtml(t('profile.techId'))}</div>
          <div class="small text-muted">${escHtml(u.tech.id || u.tech._id || '—')}</div>
        </div>
      </div>`;
    }

    section.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h4 class="mb-0 fw-bold"><i class="bi bi-person-badge me-2"></i>${escHtml(t('profile.title'))}</h4>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="profileChangePwdBtn">
            <i class="bi bi-key me-1"></i>${escHtml(t('profile.changePassword'))}
          </button>
          <button type="button" class="btn btn-primary btn-sm" id="profileEditBtn">
            <i class="bi bi-pencil me-1"></i>${escHtml(t('profile.edit'))}
          </button>
        </div>
      </div>

      <div class="card border-0 shadow-sm">
        <div class="card-body p-4">
          <!-- Avatar header -->
          <div class="d-flex flex-column flex-sm-row align-items-center gap-3 mb-4 p-3 rounded"
               style="background:linear-gradient(135deg,#1a1d23,#2d3748);">
            <div class="profile-avatar profile-avatar-md rounded-circle" id="profileAvatar" data-avatar aria-label="Profile">
              <img class="profile-avatar-image" alt="Profile Photo" hidden />
              <span class="profile-avatar-initials">${escHtml((u.fullName || 'A').charAt(0).toUpperCase())}</span>
            </div>
            <div class="text-center text-sm-start">
              <div class="fw-bold fs-5 text-white" id="profFullName">${escHtml(u.fullName || '—')}</div>
              <div class="text-white-50 small">${roleBadgeText(u.role)}</div>
              <div class="text-white-50 small">${escHtml(u.email || '—')}</div>
            </div>
          </div>

          <!-- Personal Information -->
          <div class="mb-4">
            <div class="fw-semibold mb-3 d-flex align-items-center gap-2 border-bottom pb-2">
              <i class="bi bi-person-lines-fill text-primary"></i>${escHtml(t('profile.personal'))}
            </div>
            <div class="row g-3">${personalRows}</div>
          </div>

          <!-- Account Information -->
          <div class="mb-4">
            <div class="fw-semibold mb-3 d-flex align-items-center gap-2 border-bottom pb-2">
              <i class="bi bi-shield-lock text-primary"></i>${escHtml(t('profile.account'))}
            </div>
            <div class="row g-3">${accountCols}</div>
          </div>

          ${techBlock}
        </div>
      </div>`;

    applyProfileAvatar(u, document.getElementById('profileAvatar'));
    renderProfileAvatarButtons(u);

    document.getElementById('profileEditBtn')?.addEventListener('click', () => openEditForm());
    document.getElementById('profileChangePwdBtn')?.addEventListener('click', () => {
      const modalEl = document.getElementById('changePasswordModal');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.show();
        else new bootstrap.Modal(modalEl).show();
      }
    });

    /* Re-bind avatar upload/remove click handlers after innerHTML replacement. */
    initProfileAvatarButtons();
  }

  function roleBadgeText(role) {
    const map = { 'Requester': 'primary', 'Technician': 'warning', 'ICT Admin': 'danger' };
    return `<span class="badge bg-${map[role] || 'secondary'}">${escHtml(role)}</span>`;
  }

  /* Swap the read-only view for the "Edit Profile" form (Cancels returns). */
  function openEditForm() {
    const section = document.getElementById(PROFILE_SECTION_ID);
    if (!section || !_current) return;

    section.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h4 class="mb-0 fw-bold"><i class="bi bi-person-gear me-2"></i>${escHtml(t('profile.edit'))}</h4>
      </div>
      <div class="card border-0 shadow-sm">
        <div class="card-body p-4">
          <div id="profileEditAlert" class="alert d-none"></div>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label fw-semibold small">${escHtml(t('profile.fullName'))} <span class="text-danger">*</span></label>
              <input type="text" class="form-control" id="editFullName" value="${escHtml(_current.fullName || '')}" maxlength="100" />
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold small">${escHtml(t('profile.email'))}</label>
              <input type="text" class="form-control" value="${escHtml(_current.email || '')}" disabled />
              <div class="small text-muted mt-1">Email cannot be changed here.</div>
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold small">${escHtml(t('profile.phone'))}</label>
              <input type="tel" class="form-control" id="editPhone" value="${escHtml(_current.phone || '')}" />
            </div>
            <div class="col-md-6">
              <label class="form-label fw-semibold small">${escHtml(t('profile.gender'))}</label>
              <select class="form-select" id="editGender">
                <option value="">—</option>
                <option value="Male">${escHtml(t('auth.gender.male'))}</option>
                <option value="Female">${escHtml(t('auth.gender.female'))}</option>
                <option value="Other">${escHtml(t('auth.gender.other'))}</option>
                <option value="Prefer not to say">${escHtml(t('auth.gender.prefer'))}</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label fw-semibold small">${escHtml(t('profile.department'))}</label>
              <input type="text" class="form-control" id="editDepartment" value="${escHtml(_current.department || '')}" maxlength="120" />
            </div>
          </div>
          <div class="d-flex gap-2 mt-4">
            <button type="button" class="btn btn-primary" id="profileSaveBtn">
              <span class="spinner-border spinner-border-sm me-1 d-none" id="profileSaveSpinner"></span>
              <i class="bi bi-save me-1"></i>${escHtml(t('profile.save'))}
            </button>
            <button type="button" class="btn btn-outline-secondary" id="profileCancelBtn">${escHtml(t('profile.cancel'))}</button>
          </div>
        </div>
      </div>`;

    const g = document.getElementById('editGender');
    if (_current.gender) g.value = _current.gender;

    document.getElementById('profileSaveBtn')?.addEventListener('click', () => saveProfile());
    document.getElementById('profileCancelBtn')?.addEventListener('click', () => renderProfile());
  }

  /* Persist edited personal info via the authenticated self-only endpoint. */
  async function saveProfile() {
    if (_saving) return;                       // prevent duplicate submissions
    const section = document.getElementById(PROFILE_SECTION_ID);
    const showErr = (msg) => showProfileAlert(section && 'profileEditAlert', msg);

    const fullName = document.getElementById('editFullName').value.trim();
    if (!fullName) { showErr(t('profile.fullName') + ' is required.'); return; }

    const body = {
      fullName: fullName,
      phone:    document.getElementById('editPhone').value.trim() || null,
      gender:   document.getElementById('editGender').value || null,
      department: document.getElementById('editDepartment').value.trim() || null,
    };

    _saving = true;
    setLoading('profileSaveBtn', 'profileSaveSpinner', true);
    try {
      const { data: updated } = await apiRequest('/users/profile', { method: 'PUT', body });
      _current = { ..._current, ...updated };

      /* Sync the updated name/department to localStorage so the sidebar
         topbar and welcome message reflect the change without a page reload. */
      var localUser = Auth.getUser();
      if (localUser) {
        localUser.fullName = updated.fullName || localUser.fullName;
        localUser.department = updated.department !== undefined ? updated.department : localUser.department;
        localUser.gender = updated.gender !== undefined ? updated.gender : localUser.gender;
        Auth.setUser(localUser);
        populateUserInfo();
      }

      showToast(t('profile.saved'), 'success');
      renderProfile();
    } catch (err) {
      showErr(err.message || t('profile.loadFailed'));
    } finally {
      _saving = false;
      setLoading('profileSaveBtn', 'profileSaveSpinner', false);
    }
  }

  function showProfileAlert(id, msg) {
    const el = document.getElementById(id || 'profileEditAlert');
    if (!el) { showToast(msg, 'danger'); return; }
    el.className = 'alert alert-danger';
    el.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i>${escHtml(msg)}`;
    el.classList.remove('d-none');
  }

  /* ── Profile Image ────────────────────────────────────────── */
  let _profileImageModal = null;
  let _profileXhr = null;
  let _avatarUploadInProgress = false;

  /* Password show/hide toggle helpers */
  function initPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        btn.innerHTML = isHidden
          ? '<i class="bi bi-eye-slash"></i>'
          : '<i class="bi bi-eye"></i>';
        btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      });
    });
  }

  /* Render Change/Remove Photo buttons inside the avatar header */
  function renderProfileAvatarButtons(u) {
    const avatar = document.getElementById('profileAvatar');
    if (!avatar) return;
    const initialsSpan = avatar.querySelector('.profile-avatar-initials');
    const avatarImg    = avatar.querySelector('.profile-avatar-image');

    /* Remove any existing button to avoid duplicates */
    const existingBtn = avatar.querySelector('.profile-avatar-btns');
    if (existingBtn) existingBtn.remove();

    const btns = document.createElement('div');
    btns.className = 'profile-avatar-btns d-flex gap-2 align-items-center small text-white-50';
    btns.innerHTML = `
      <button type="button" class="btn btn-link text-white-50 p-0 profile-avatar-change" id="profileAvatarChangeBtn" aria-label="${escHtml(t('profile.uploadPhoto'))}"><i class="bi bi-upload me-1"></i></button>
      ${u.profileImage ? `
        <button type="button" class="btn btn-link text-white-50 p-0 profile-avatar-remove" id="profileAvatarRemoveBtn" aria-label="${escHtml(t('profile.removePhoto'))}"><i class="bi bi-x-circle me-1"></i></button>` : ''}
    `;

    /* Initially hide initials when a photo is present */
    if (u.profileImage) {
      initialsSpan.hidden = true;
    }

    avatar.appendChild(btns);
    return btns;
  }

  /* Handle Change Photo click */
  function handleProfileAvatarChange() {
    if (_avatarUploadInProgress) return;
    _avatarUploadInProgress = true;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.className = 'd-none';

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) { _avatarUploadInProgress = false; return; }

      /* File size validation (5MB) */
      if (file.size > 5 * 1024 * 1024) {
        showToast(t('profile.tooLarge'), 'danger');
        _avatarUploadInProgress = false;
        return;
      }

      /* MIME type validation */
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast(t('profile.invalidImage'), 'danger');
        _avatarUploadInProgress = false;
        return;
      }

      /* Local preview before upload */
      const previewUrl = URL.createObjectURL(file);
      const avatarImg = document.querySelector('#profileAvatar .profile-avatar-image');
      if (avatarImg) {
        avatarImg.src = previewUrl;
        avatarImg.hidden = false;
      }

      setLoading('profileAvatarChangeBtn', null, true);
      try {
        const formData = new FormData();
        formData.append('profileImage', file);

        const { data } = await apiRequest('/users/profile-image', {
          method: 'POST',
          body: formData,
          isFormData: true,
        });

        /* Revoke the local object URL - it's only a preview */
        URL.revokeObjectURL(previewUrl);

        showToast(t('profile.success'), 'success');
        _current = { ..._current, profileImage: data.profileImage };

        /* Update localStorage prefs so avatar persists after page reload.
           Store an absolute URL pointing to the backend origin so the image
           loads correctly regardless of which port the frontend runs on. */
        var absProfileUrl = (typeof profileUploadUrl === 'function')
          ? profileUploadUrl(data.profileImage)
          : data.profileImage;
        var prefsKey = 'ict_profile_image_prefs';
        var allPrefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
        var userKey = String(_current.email || _current.id || 'default').toLowerCase();
        allPrefs[userKey] = { uploaded: absProfileUrl };
        localStorage.setItem(prefsKey, JSON.stringify(allPrefs));

        renderProfile();
      } catch (err) {
        /* Revoke the local object URL on error too */
        URL.revokeObjectURL(previewUrl);
        showToast(err.message || t('profile.loadFailed'), 'danger');
      } finally {
        setLoading('profileAvatarChangeBtn', null, false);
        _avatarUploadInProgress = false;
      }
    });

    fileInput.click();
  }

  /* Handle Remove Photo click */
  async function handleProfileAvatarRemove() {
    if (!confirm(t('profile.removePhoto'))) return;

    setLoading('profileAvatarRemoveBtn', null, true);
    try {
      await apiRequest('/users/profile-image', {
        method: 'DELETE',
      });

      showToast(t('profile.success'), 'success');
      _current = { ..._current, profileImage: null };

      /* Clear localStorage prefs so avatar falls back to initials */
      const prefsKey = 'ict_profile_image_prefs';
      let allPrefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
      const userKey = String(_current.email || _current.id || 'default').toLowerCase();
      delete allPrefs[userKey];
      localStorage.setItem(prefsKey, JSON.stringify(allPrefs));

      renderProfile();
    } catch (err) {
      showToast(err.message || t('profile.loadFailed'), 'danger');
    } finally {
      setLoading('profileAvatarRemoveBtn', null, false);
    }
  }

  /* Initialize avatar buttons after avatar is rendered */
  function initProfileAvatarButtons() {
    const section = document.getElementById(PROFILE_SECTION_ID);
    if (!section) return;

    /* Re-render buttons whenever the profile view changes */
    /* Explicit re-render on profile tab switch handled by renderProfile()
       rather than MutationObserver to avoid recursive rendering and
       duplicated click handlers. */
    const avatar = document.getElementById('profileAvatar');
    if (avatar) {
      /* Ensure buttons are rendered initially */
      renderProfileAvatarButtons(_current);
    }

    /* Click handlers */
    avatar?.addEventListener('click', (e) => {
      const changeBtn = e.target.closest('.profile-avatar-change');
      const removeBtn = e.target.closest('.profile-avatar-remove');
      if (changeBtn) handleProfileAvatarChange();
      if (removeBtn) handleProfileAvatarRemove();
    });
  } // closes initProfileAvatarButtons()

  // Change Password modal is initialized only when the user clicks
  // the "Change Password" button in their Profile section — not on dashboard load.
//  const modalEl = document.getElementById('changePasswordModal');
//  if (modalEl) {
//    const fields = ['pwdCurrent', 'pwdNew', 'pwdConfirm'];
//    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
//    const alert = document.getElementById('pwdAlert');
//    if (alert) { alert.className = 'alert d-none'; alert.textContent = ''; }
//
//    const modal = bootstrap.Modal.getInstance(modalEl);
//    if (modal) modal.show();
//    else new bootstrap.Modal(modalEl).show();
//  }

  async function submitPasswordChange() {
    if (_saving) return;
    const alert = document.getElementById('pwdAlert');
    const showMsg = (msg, type) => {
      if (!alert) { showToast(msg, type); return; }
      alert.className = `alert alert-${type}`;
      alert.textContent = msg;
      alert.classList.remove('d-none');
    };

    // Support both modal (pwdCurrent/pwdNew/pwdConfirm) and card form (currentPassword/newPassword/confirmPassword)
    const currentPwd = document.getElementById('pwdCurrent')?.value || document.getElementById('currentPassword')?.value;
    const newPwd     = document.getElementById('pwdNew')?.value     || document.getElementById('newPassword')?.value;
    const confirmPwd = document.getElementById('pwdConfirm')?.value || document.getElementById('confirmPassword')?.value;

    if (!currentPwd) { showMsg(t('profile.currentPassword') + ' is required.', 'warning'); return; }
    if (!newPwd || newPwd.length < 8) { showMsg(t('profile.passwordHint'), 'warning'); return; }
    if (newPwd !== confirmPwd) { showMsg('Passwords do not match.', 'danger'); return; }

    _saving = true;
    const btn = document.getElementById('pwdSaveBtn');
    setLoading('pwdSaveBtn', 'pwdSaveSpinner', true);
    try {
      await apiRequest('/users/change-password', {
        method: 'PUT',
        body: { currentPassword: currentPwd, newPassword: newPwd },
      });
      showToast(t('profile.password.changed'), 'success');
      const modalEl = document.getElementById('changePasswordModal');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
    } catch (err) {
      showMsg(err.message || 'Could not change password.', 'danger');
    } finally {
      _saving = false;
      setLoading('pwdSaveBtn', 'pwdSaveSpinner', false);
    }
  }

  /* ── Load profile for the authenticated role ───────────────── */
  async function initProfile() {
    const section = document.getElementById(PROFILE_SECTION_ID);
    if (!section) return;

    const user = requireAuth();
    if (!user) return;
    _role = user.role;

    try {
      const { user: me } = await apiRequest('/auth/me');

      /* Resolve technician-only fields (never loaded for requesters). */
      let tech = null;
      if (_role === 'Technician') {
        try {
          const tRes = await apiRequest('/technicians/me');
          tech = tRes.data || null;
        } catch (_) { tech = null; }
      }

      _current = { ...me, tech };
      renderProfile();

      /* Hook static modal buttons (present in both dashboards). */
      document.getElementById('pwdSaveBtn')?.addEventListener('click', submitPasswordChange);
    } catch (err) {
      if (err && err.redirected) return;      // auth layer already redirected
      section.innerHTML = `
        <div class="alert alert-danger d-flex align-items-center gap-2">
          <i class="bi bi-exclamation-triangle-fill"></i>
          <span>${escHtml(err.message || t('profile.loadFailed'))}</span>
          <button type="button" class="btn btn-sm btn-outline-danger ms-auto" onclick="window.location.reload()">Retry</button>
        </div>`;
    }
  }

  function bindSidebarProfileNav() {
    const link = document.getElementById('profileNavLink');
    if (!link) return;
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) return; // real page nav
      e.preventDefault();
      switchProfileTab();
    });
  }

  /* Show the profile section and mark it active in the sidebar; hide it on the
     "Dashboard" link. This keeps the profile on the same page (no new route). */
  function switchProfileTab() {
    const section = document.getElementById(PROFILE_SECTION_ID);
    const dashboard = document.getElementById('dashboardHome');
    if (section) section.classList.remove('d-none');
    if (dashboard) dashboard.classList.add('d-none');

    document.querySelectorAll('#sidebar .nav-link').forEach(l => {
      const isProfile = l.id === 'profileNavLink';
      l.classList.toggle('active', isProfile);
      l.classList.toggle('bg-white', isProfile);
      l.classList.toggle('bg-opacity-25', isProfile);
      l.classList.toggle('rounded', isProfile);
      l.classList.toggle('text-white', isProfile);
      l.classList.toggle('text-white-50', !isProfile);
    });

    if (!_current) initProfile();
  }

  function bindDashboardReturn() {
    const link = document.getElementById('dashboardNavLink');
    if (!link) return;
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href') && !link.getAttribute('href').startsWith('#')) return;
      e.preventDefault();
      const section = document.getElementById(PROFILE_SECTION_ID);
      const dashboard = document.getElementById('dashboardHome');
      if (section) section.classList.add('d-none');
      if (dashboard) dashboard.classList.remove('d-none');
      document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active','bg-white','bg-opacity-25','rounded'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindSidebarProfileNav();
    bindDashboardReturn();
    /* Auto-open profile when arriving via #profile hash (optional convenience). */
    if (window.location.hash === '#profile') switchProfileTab();
    initProfileAvatarButtons();
    initPasswordToggles();
  });

  /* Expose for the inline sub-initializers and Retry buttons. */
  window.initProfile = initProfile;
  window.switchProfileTab = switchProfileTab;
  window.handleProfileAvatarChange = handleProfileAvatarChange;
  window.handleProfileAvatarRemove = handleProfileAvatarRemove;
  window.submitPasswordChange = submitPasswordChange;
})();