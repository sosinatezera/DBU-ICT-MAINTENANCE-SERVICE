/* ============================================================
   settings.js — Admin Settings Page Logic
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const user = requireAuth();
  if (!user) return;

  /* Clear alerts on form reset */
  ['generalSettingsForm', 'notifSettingsForm', 'profileForm'].forEach(id => {
    document.getElementById(id)?.addEventListener('reset', () => {
      document.getElementById('settingsAlert')?.classList.add('d-none');
      document.getElementById('profileAlert')?.classList.add('d-none');
    });
  });

  /* ── Load all data on init ────────────────────────────── */
  let currentUser = null;
  let currentSettings = null;

  /* Attach real-time validation to profile form */
  attachRealTimeValidation('profileForm', [
    { fieldId: 'profileName', checks: [v => Validators.name(v, 'Full name')] },
    { fieldId: 'profilePhone', checks: [Validators.phone] },
  ]);

  /* Attach real-time validation to password form */
  attachRealTimeValidation('changePasswordForm', [
    { fieldId: 'newPassword', checks: [Validators.password] },
  ]);

  try {
    currentUser = (await apiRequest('/auth/me')).user;
  } catch (_) {
    showToast('Failed to load profile data.', 'danger');
    return;
  }

  try {
    currentSettings = (await apiRequest('/settings')).data;
  } catch (_) {
    showToast('Failed to load system settings.', 'danger');
  }

  /* ── Populate General Settings ────────────────────────── */
  if (currentSettings) {
    setVal('settingSystemName', currentSettings.systemName);
    setVal('settingOrgName', currentSettings.organizationName);
    setVal('settingSystemDesc', currentSettings.systemDescription);
    setVal('settingLanguage', currentSettings.defaultLanguage);
    setVal('settingTimezone', currentSettings.timezone);
    setVal('settingDateFormat', currentSettings.dateFormat);
  }

  /* ── Populate Notification Settings ───────────────────── */
  if (currentSettings) {
    setCheck('notifNewRequest', currentSettings.notifNewRequest);
    setCheck('notifAssignment', currentSettings.notifAssignment);
    setCheck('notifStatusChange', currentSettings.notifStatusChange);
    setCheck('notifCompletion', currentSettings.notifCompletion);
    setCheck('notifSystemSecurity', currentSettings.notifSystemSecurity);
    setCheck('emailNotifications', currentSettings.emailNotifications);
  }

  /* ── Populate My Profile ──────────────────────────────── */
  populateProfile(currentUser);

  /* ── Populate Security Info ───────────────────────────── */
  populateSecurity(currentUser);

  /* ═══════════════════════════════════════════════════════
     GENERAL SETTINGS — Save
     ═══════════════════════════════════════════════════════ */
  document.getElementById('generalSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading('saveGeneralBtn', 'saveGeneralSpinner', true);
    try {
      await apiRequest('/settings/general', {
        method: 'PUT',
        body: {
          systemName:        getVal('settingSystemName'),
          organizationName:  getVal('settingOrgName'),
          systemDescription: getVal('settingSystemDesc'),
          defaultLanguage:   getVal('settingLanguage'),
          timezone:          getVal('settingTimezone'),
          dateFormat:        getVal('settingDateFormat'),
        },
      });
      showAlert('settingsAlert', 'General settings saved successfully.', 'success');
      showToast('General settings saved.', 'success');
    } catch (err) {
      showAlert('settingsAlert', err.message, 'danger');
    }
    setLoading('saveGeneralBtn', 'saveGeneralSpinner', false);
  });

  /* ═══════════════════════════════════════════════════════
     NOTIFICATION SETTINGS — Save
     ═══════════════════════════════════════════════════════ */
  document.getElementById('notifSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading('saveNotifBtn', 'saveNotifSpinner', true);
    try {
      await apiRequest('/settings/notifications', {
        method: 'PUT',
        body: {
          notifNewRequest:     getCheck('notifNewRequest'),
          notifAssignment:     getCheck('notifAssignment'),
          notifStatusChange:   getCheck('notifStatusChange'),
          notifCompletion:     getCheck('notifCompletion'),
          notifSystemSecurity: getCheck('notifSystemSecurity'),
          emailNotifications:  getCheck('emailNotifications'),
        },
      });
      showAlert('settingsAlert', 'Notification preferences saved successfully.', 'success');
      showToast('Notification settings saved.', 'success');
    } catch (err) {
      showAlert('settingsAlert', err.message, 'danger');
    }
    setLoading('saveNotifBtn', 'saveNotifSpinner', false);
  });

  /* ═══════════════════════════════════════════════════════
     CHANGE PASSWORD
     ═══════════════════════════════════════════════════════ */
  document.getElementById('changePasswordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = getVal('currentPassword');
    const newPw   = getVal('newPassword');
    const confirm = getVal('confirmPassword');

    /* Validate fields */
    let hasError = false;

    if (!current) {
      showFieldError('currentPassword', 'Current password is required.');
      hasError = true;
    } else { clearFieldValidation('currentPassword'); }

    const pwErr = Validators.password(newPw);
    if (pwErr) { showFieldError('newPassword', pwErr); hasError = true; } else { clearFieldValidation('newPassword'); }

    const matchErr = Validators.passwordMatch(newPw, confirm);
    if (matchErr) { showFieldError('confirmPassword', matchErr); hasError = true; } else { showFieldValid('confirmPassword'); }

    if (newPw === current) {
      showAlert('passwordAlert', 'New password must be different from the current password.', 'warning');
      hasError = true;
    }

    if (hasError) return;

    setLoading('savePasswordBtn', 'savePasswordSpinner', true);
    try {
      await apiRequest('/users/change-password', {
        method: 'PUT',
        body: { currentPassword: current, newPassword: newPw },
      });
      showAlert('passwordAlert', 'Password updated successfully.', 'success');
      showToast('Password updated.', 'success');
      document.getElementById('changePasswordForm').reset();
      document.getElementById('passwordMatchText').textContent = '';
    } catch (err) {
      showAlert('passwordAlert', err.message, 'danger');
    }
    setLoading('savePasswordBtn', 'savePasswordSpinner', false);
  });

  /* ── Password confirmation live check ─────────────────── */
  const newPwInput = document.getElementById('newPassword');
  const confirmInput = document.getElementById('confirmPassword');
  const matchText = document.getElementById('passwordMatchText');

  function checkPasswordMatch() {
    const a = newPwInput.value;
    const b = confirmInput.value;
    if (!b) { matchText.textContent = ''; matchText.className = 'form-text'; return; }
    if (a === b) {
      matchText.textContent = 'Passwords match.';
      matchText.className = 'form-text text-success';
    } else {
      matchText.textContent = 'Passwords do not match.';
      matchText.className = 'form-text text-danger';
    }
  }
  newPwInput?.addEventListener('input', checkPasswordMatch);
  confirmInput?.addEventListener('input', checkPasswordMatch);

  /* Clear match text on form reset */
  document.getElementById('changePasswordForm')?.addEventListener('reset', () => {
    matchText.textContent = '';
    matchText.className = 'form-text';
    document.getElementById('passwordAlert')?.classList.add('d-none');
  });

  /* ═══════════════════════════════════════════════════════
     MY PROFILE — Save
     ═══════════════════════════════════════════════════════ */
  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    /* Validate fields */
    let hasError = false;

    const nameErr = Validators.name(getVal('profileName'), 'Full name');
    if (nameErr) { showFieldError('profileName', nameErr); hasError = true; } else { showFieldValid('profileName'); }

    const phoneErr = Validators.phone(getVal('profilePhone'));
    if (phoneErr) { showFieldError('profilePhone', phoneErr); hasError = true; } else { clearFieldValidation('profilePhone'); }

    if (hasError) return;

    setLoading('saveProfileBtn', 'saveProfileSpinner', true);
    try {
      const res = await apiRequest('/users/profile', {
        method: 'PUT',
        body: {
          fullName:   getVal('profileName'),
          phone:      getVal('profilePhone'),
          department: getVal('profileDept'),
        },
      });

      /* Update local session */
      const stored = Auth.getUser();
      if (stored) {
        stored.fullName = getVal('profileName');
        Auth.setUser(stored);
      }

      /* Refresh the profile header */
      if (res.data) {
        currentUser = res.data;
        populateProfile(currentUser);
        populateSecurity(currentUser);
      }

      showAlert('profileAlert', 'Profile updated successfully.', 'success');
      showToast('Profile updated.', 'success');
    } catch (err) {
      showAlert('profileAlert', err.message, 'danger');
    }
    setLoading('saveProfileBtn', 'saveProfileSpinner', false);
  });

  /* ═══════════════════════════════════════════════════════
     PASSWORD TOGGLE
     ═══════════════════════════════════════════════════════ */
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!target) return;
      const isPassword = target.type === 'password';
      target.type = isPassword ? 'text' : 'password';
      btn.querySelector('i').className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
  });

  /* ═══════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════ */
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  }

  function getCheck(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  function populateProfile(u) {
    setVal('profileName', u.fullName);
    setVal('profileEmail', u.email);
    setVal('profilePhone', u.phone);
    setVal('profileDept', u.department);

    /* Header */
    const initial = (u.fullName || 'A').charAt(0).toUpperCase();
    const avatar = document.getElementById('profileAvatar');
    if (avatar) {
      avatar.textContent = initial;
      const bg = { 'ICT Admin': '#dc3545', Technician: '#ffc107', Requester: '#0d6efd', student: '#0d6efd' };
      avatar.style.background = bg[u.role] || '#0d6efd';
      if (u.role === 'Technician') avatar.style.color = '#212529';
    }
    setText('profileDisplayName', u.fullName);
    setText('profileDisplayEmail', u.email);

    const roleBadge = document.getElementById('profileRoleBadge');
    if (roleBadge) {
      const roleC = { 'ICT Admin': 'danger', Technician: 'warning', Requester: 'primary', student: 'primary' };
      roleBadge.innerHTML = `<span class="badge bg-${roleC[u.role] || 'secondary'} text-capitalize">${u.role}</span>`;
    }
  }

  function populateSecurity(u) {
    const statusEl = document.getElementById('securityStatus');
    if (statusEl) {
      const isActive = u.status === 'active';
      statusEl.innerHTML = `<span class="badge bg-${isActive ? 'success' : 'danger'}">${isActive ? 'Active' : 'Inactive'}</span>`;
    }

    const roleEl = document.getElementById('securityRole');
    if (roleEl) {
      const roleC = { 'ICT Admin': 'danger', Technician: 'warning', Requester: 'primary', student: 'primary' };
      roleEl.innerHTML = `<span class="badge bg-${roleC[u.role] || 'secondary'}">${u.role}</span>`;
    }

    setText('securityLastLogin', u.lastLogin ? formatDateTime(u.lastLogin) : 'Never logged in');
    setText('securityMemberSince', u.createdAt ? formatDate(u.createdAt) : '—');
  }
});
