/* ============================================================
   settings.js — Settings Page Logic (Admin + Requester/Technician)
    Smart ICT Maintenance Management System

   One file serves two pages, split by pathname at line 8:
     /admin/settings.html  -> requireRole("ICT Admin"),           admin block
     /settings.html        -> requireRole("Requester","Technician"),
                              initPersonalSettings() (from line 515)
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  await Auth.load();
  const adminSettingsPage = window.location.pathname.endsWith(
    "/admin/settings.html",
  );
  const user = adminSettingsPage
    ? requireRole("ICT Admin")
    : requireRole("Requester", "Technician");
  if (!user) return;
  if (!adminSettingsPage) {
    await initPersonalSettings(user);
    return;
  }

  /* Clear alerts on form reset */
  ["generalSettingsForm", "notifSettingsForm", "profileForm"].forEach((id) => {
    document.getElementById(id)?.addEventListener("reset", () => {
      document.getElementById("settingsAlert")?.classList.add("d-none");
      document.getElementById("profileAlert")?.classList.add("d-none");
      if (id === "profileForm") {
        loadProfilePhotoState();
        applyProfileAvatar(
          currentUser,
          document.getElementById("profileAvatar"),
        );
      }
    });
  });

  /* ── Load all data on init ────────────────────────────── */
  let currentUser = Auth.getUser();
  let currentSettings = null;
  /* Guards against the data-loss case below: if /settings could not be read,
     the form fields keep their HTML defaults (empty strings, unchecked
     boxes). Saving in that state would PUT the defaults over the real stored
     settings and silently wipe them. Until the read succeeds, the settings
     forms are inert. */
  let settingsLoaded = false;

  function settingsNotLoaded(alertId) {
    showAlert(
      alertId,
      "System settings could not be loaded, so saving is disabled to protect your current configuration. Check your connection and retry the page.",
      "warning",
    );
    return false;
  }

  function lockSettingsForms(locked) {
    ["generalSettingsForm", "notifSettingsForm"].forEach((formId) => {
      const form = document.getElementById(formId);
      if (!form) return;
      form.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = locked;
      });
    });
  }

  /* Attach real-time validation to profile form */
  attachRealTimeValidation("profileForm", [
    {
      fieldId: "profileName",
      checks: [(v) => Validators.name(v, "Full name")],
    },
    { fieldId: "profilePhone", checks: [Validators.phone] },
  ]);

  /* Attach real-time validation to password form */
  attachRealTimeValidation("changePasswordForm", [
    { fieldId: "newPassword", checks: [Validators.password] },
  ]);

  /* The notification checkboxes below are driven by this load, so it must
     settle before population — but the profile/security sections can render
     from the already-loaded session user in the meantime. */
  try {
    const settingsRes = await apiRequest("/settings");
    currentSettings = settingsRes.data;
    settingsLoaded = true;
  } catch (err) {
    showToast("Failed to load system settings.", "danger");
    lockSettingsForms(true);
  }

  /* ── Profile photo state (uploaded photo / image URL) ───── */
  let profilePhoto = { uploaded: null, url: "" };

  function loadProfilePhotoState() {
    const prefs = getProfileImagePrefs(currentUser);
    profilePhoto = { uploaded: prefs.uploaded || null, url: prefs.url || "" };
    const urlInput = document.getElementById("profileImageUrl");
    if (urlInput) urlInput.value = profilePhoto.url;
  }

  function persistProfilePhotoState() {
    if (!currentUser) return;
    setProfileImagePrefs(currentUser, profilePhoto);
    applyProfileAvatar(currentUser, document.getElementById("profileAvatar"));
  }

  loadProfilePhotoState();

  /* ── Populate General Settings ────────────────────────── */
  if (currentSettings) {
    setVal("settingSystemName", currentSettings.systemName);
    setVal("settingOrgName", currentSettings.organizationName);
    setVal("settingSystemDesc", currentSettings.systemDescription);
    const defaultLang =
      currentSettings.defaultLanguage === "en" ||
      currentSettings.defaultLanguage === "am"
        ? currentSettings.defaultLanguage
        : "en";
    setVal("settingLanguage", defaultLang);
    setVal("settingTimezone", currentSettings.timezone);
    setVal("settingDateFormat", currentSettings.dateFormat);
  }

  /* ── Apply chosen language immediately (shared i18n) ──── */
  const langSel = document.getElementById("settingLanguage");
  if (langSel) {
    if (window.setLang) window.setLang(langSel.value, false);
    langSel.addEventListener("change", () => {
      if (window.setLang) window.setLang(langSel.value);
    });
  }

  /* ── Populate Notification Settings ───────────────────── */
  if (currentSettings) {
    setCheck("notifNewRequest", currentSettings.notifNewRequest);
    setCheck("notifAssignment", currentSettings.notifAssignment);
    setCheck("notifStatusChange", currentSettings.notifStatusChange);
    setCheck("notifCompletion", currentSettings.notifCompletion);
    setCheck("notifSystemSecurity", currentSettings.notifSystemSecurity);
    setCheck("emailNotifications", currentSettings.emailNotifications);
  }
  const notificationSound = document.getElementById("notificationSound");
  if (notificationSound && window.NotificationSound) {
    notificationSound.checked = window.NotificationSound.isEnabled();
  }

  /* ── Populate My Profile ──────────────────────────────── */
  populateProfile(currentUser);

  /* ── Populate Security Info ───────────────────────────── */
  populateSecurity(currentUser);

  /* ── Deep link to a tab ─────────────────────────────────
     The admin profile dropdown links here as #profileTab. Bootstrap
     tabs key off the panel id, not the fragment, so without this
     "Profile Settings" would silently open the General pane.

     CSS.escape keeps an arbitrary fragment from being able to break
     out of the attribute selector; a hash that does not resolve to one
     of this page's own panes is ignored rather than throwing. */
  (function activateHashTab() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const panes = document.querySelectorAll(
      "#settingsTabs ~ .tab-content .tab-pane",
    );
    const target = document.getElementById(hash);
    if (!target || !panes.length || !panes.includes(target)) return;
    const trigger = document.querySelector(
      `#settingsTabs [data-bs-target="#${CSS.escape(hash)}"]`,
    );
    if (!trigger || typeof bootstrap === "undefined") return;
    bootstrap.Tab.getOrCreateInstance(trigger).show();
  })();

  /* ═══════════════════════════════════════════════════════
     GENERAL SETTINGS — Save
     ═══════════════════════════════════════════════════════ */
  document
    .getElementById("generalSettingsForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!settingsLoaded) return settingsNotLoaded("settingsAlert");
      setLoading("saveGeneralBtn", "saveGeneralSpinner", true);
      try {
        await apiRequest("/settings/general", {
          method: "PUT",
          body: {
            systemName: getVal("settingSystemName"),
            organizationName: getVal("settingOrgName"),
            systemDescription: getVal("settingSystemDesc"),
            defaultLanguage: getVal("settingLanguage"),
            timezone: getVal("settingTimezone"),
            dateFormat: getVal("settingDateFormat"),
          },
        });
        showAlert(
          "settingsAlert",
          "General settings saved successfully.",
          "success",
        );
        showToast("General settings saved.", "success");
        if (window.__ictPrefs) window.__ictPrefs.refresh();
      } catch (err) {
        showAlert("settingsAlert", err.message, "danger");
      } finally {
        setLoading("saveGeneralBtn", "saveGeneralSpinner", false);
      }
    });

  /* ═══════════════════════════════════════════════════════
     NOTIFICATION SETTINGS — Save
     ═══════════════════════════════════════════════════════ */
  document
    .getElementById("notifSettingsForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!settingsLoaded) return settingsNotLoaded("settingsAlert");
      setLoading("saveNotifBtn", "saveNotifSpinner", true);
      try {
        await apiRequest("/settings/notifications", {
          method: "PUT",
          body: {
            notifNewRequest: getCheck("notifNewRequest"),
            notifAssignment: getCheck("notifAssignment"),
            notifStatusChange: getCheck("notifStatusChange"),
            notifCompletion: getCheck("notifCompletion"),
            notifSystemSecurity: getCheck("notifSystemSecurity"),
            emailNotifications: getCheck("emailNotifications"),
          },
        });
        if (notificationSound && window.NotificationSound) {
          window.NotificationSound.setEnabled(notificationSound.checked);
        }
        showAlert(
          "settingsAlert",
          "Notification preferences saved successfully.",
          "success",
        );
        showToast("Notification settings saved.", "success");
      } catch (err) {
        showAlert("settingsAlert", err.message, "danger");
      } finally {
        setLoading("saveNotifBtn", "saveNotifSpinner", false);
      }
    });

  /* ═══════════════════════════════════════════════════════
     CHANGE PASSWORD
     ═══════════════════════════════════════════════════════ */
  document
    .getElementById("changePasswordForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const current = getVal("currentPassword");
      const newPw = getVal("newPassword");
      const confirm = getVal("confirmPassword");

      /* Validate fields */
      let hasError = false;

      if (!current) {
        showFieldError("currentPassword", "Current password is required.");
        hasError = true;
      } else {
        clearFieldValidation("currentPassword");
      }

      const pwErr = Validators.password(newPw);
      if (pwErr) {
        showFieldError("newPassword", pwErr);
        hasError = true;
      } else {
        clearFieldValidation("newPassword");
      }

      const matchErr = Validators.passwordMatch(newPw, confirm);
      if (matchErr) {
        showFieldError("confirmPassword", matchErr);
        hasError = true;
      } else {
        showFieldValid("confirmPassword");
      }

      if (newPw === current) {
        showAlert(
          "passwordAlert",
          "New password must be different from the current password.",
          "warning",
        );
        hasError = true;
      }

      if (hasError) return;

      setLoading("savePasswordBtn", "savePasswordSpinner", true);
      try {
        await apiRequest("/users/change-password", {
          method: "PUT",
          body: { currentPassword: current, newPassword: newPw },
        });
        showAlert("passwordAlert", "Password updated successfully.", "success");
        showToast("Password updated.", "success");
        document.getElementById("changePasswordForm").reset();
        document.getElementById("passwordMatchText").textContent = "";
      } catch (err) {
        showAlert("passwordAlert", err.message, "danger");
      } finally {
        setLoading("savePasswordBtn", "savePasswordSpinner", false);
      }
    });

  /* ── Password confirmation live check ─────────────────── */
  const newPwInput = document.getElementById("newPassword");
  const confirmInput = document.getElementById("confirmPassword");
  const matchText = document.getElementById("passwordMatchText");

  function checkPasswordMatch() {
    const a = newPwInput.value;
    const b = confirmInput.value;
    if (!b) {
      matchText.textContent = "";
      matchText.className = "form-text";
      return;
    }
    if (a === b) {
      matchText.textContent = "Passwords match.";
      matchText.className = "form-text text-success";
    } else {
      matchText.textContent = "Passwords do not match.";
      matchText.className = "form-text text-danger";
    }
  }
  newPwInput?.addEventListener("input", checkPasswordMatch);
  confirmInput?.addEventListener("input", checkPasswordMatch);

  /* Clear match text on form reset */
  document
    .getElementById("changePasswordForm")
    ?.addEventListener("reset", () => {
      matchText.textContent = "";
      matchText.className = "form-text";
      document.getElementById("passwordAlert")?.classList.add("d-none");
    });

  /* ═══════════════════════════════════════════════════════
     MY PROFILE — Save
     ═══════════════════════════════════════════════════════ */
  document
    .getElementById("profileForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();

      /* Validate fields */
      let hasError = false;

      const nameErr = Validators.name(getVal("profileName"), "Full name");
      if (nameErr) {
        showFieldError("profileName", nameErr);
        hasError = true;
      } else {
        showFieldValid("profileName");
      }

      const phoneErr = Validators.phone(getVal("profilePhone"));
      if (phoneErr) {
        showFieldError("profilePhone", phoneErr);
        hasError = true;
      } else {
        clearFieldValidation("profilePhone");
      }

      if (hasError) return;

      setLoading("saveProfileBtn", "saveProfileSpinner", true);
      try {
        const res = await apiRequest("/users/profile", {
          method: "PUT",
          body: {
            fullName: getVal("profileName"),
            phone: getVal("profilePhone"),
            department: getVal("profileDept"),
          },
        });

        /* Update local session */
        const stored = Auth.getUser();
        if (stored) {
          stored.fullName = getVal("profileName");
          Auth.setUser(stored);
        }

        /* Refresh the profile header */
        if (res.data) {
          currentUser = res.data;
          populateProfile(currentUser);
          populateSecurity(currentUser);
          persistProfilePhotoState();
        }

        showAlert("profileAlert", "Profile updated successfully.", "success");
        showToast("Profile updated.", "success");
      } catch (err) {
        showAlert("profileAlert", err.message, "danger");
      } finally {
        setLoading("saveProfileBtn", "saveProfileSpinner", false);
      }
    });

  /* ═══════════════════════════════════════════════════════
     PASSWORD TOGGLE
     ═══════════════════════════════════════════════════════ */
  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(
        btn.getAttribute("data-toggle-password"),
      );
      if (!target) return;
      const isPassword = target.type === "password";
      target.type = isPassword ? "text" : "password";
      btn.querySelector("i").className = isPassword
        ? "bi bi-eye-slash"
        : "bi bi-eye";
    });
  });

  /* ═══════════════════════════════════════════════════════
     PROFILE PHOTO — upload / image URL / remove
     Priority: upload > URL > default ADMIN image > initials
     ═══════════════════════════════════════════════════════ */
  const photoInput = document.getElementById("profilePhotoUpload");
  const urlInput = document.getElementById("profileImageUrl");
  const removeBtn = document.getElementById("removeProfilePhotoBtn");

  photoInput?.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;

    if (!/^image\//.test(file.type)) {
      showAlert(
        "profileAlert",
        "Please choose an image file (JPG, PNG or WebP).",
        "warning",
      );
      photoInput.value = "";
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      showAlert("profileAlert", "Image must be 1.5 MB or smaller.", "warning");
      photoInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      profilePhoto.uploaded = e.target.result;
      profilePhoto.url = "";
      if (urlInput) urlInput.value = "";
      persistProfilePhotoState();
    };
    reader.readAsDataURL(file);
  });

  urlInput?.addEventListener("input", () => {
    if (profilePhoto.uploaded) return; /* uploaded photo has priority */
    profilePhoto.url = urlInput.value.trim();
    persistProfilePhotoState();
  });

  removeBtn?.addEventListener("click", () => {
    profilePhoto = { uploaded: null, url: "" };
    if (photoInput) photoInput.value = "";
    if (urlInput) urlInput.value = "";
    persistProfilePhotoState();
    showToast("Custom photo removed. Default ADMIN image restored.", "info");
  });

  /* ═══════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════ */
  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
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
    setVal("profileName", u.fullName);
    setVal("profileEmail", u.email);
    setVal("profilePhone", u.phone);
    setVal("profileDept", u.department);

    /* Header avatar (uploaded photo > image URL > default ADMIN image > initial) */
    const avatar = document.getElementById("profileAvatar");
    if (avatar) applyProfileAvatar(u, avatar);

    /* Image URL field reflects the saved Image URL preference */
    const urlInput = document.getElementById("profileImageUrl");
    if (urlInput && !getProfileImagePrefs(u).uploaded) {
      urlInput.value = getProfileImagePrefs(u).url || "";
    }
    setText("profileDisplayName", u.fullName);
    setText("profileDisplayEmail", u.email);

    const roleBadge = document.getElementById("profileRoleBadge");
    if (roleBadge) {
      const roleC = {
        "ICT Admin": "danger",
        Technician: "warning",
        Requester: "primary",
      };
      roleBadge.innerHTML = `<span class="badge bg-${roleC[u.role] || "secondary"} text-capitalize">${u.role}</span>`;
    }
  }

  function populateSecurity(u) {
    const statusEl = document.getElementById("securityStatus");
    if (statusEl) {
      const isActive = u.status === "active";
      statusEl.innerHTML = `<span class="badge bg-${isActive ? "success" : "danger"}">${isActive ? "Active" : "Inactive"}</span>`;
    }

    const roleEl = document.getElementById("securityRole");
    if (roleEl) {
      const roleC = {
        "ICT Admin": "danger",
        Technician: "warning",
        Requester: "primary",
      };
      roleEl.innerHTML = `<span class="badge bg-${roleC[u.role] || "secondary"}">${u.role}</span>`;
    }

    setText(
      "securityLastLogin",
      u.lastLogin ? formatDateTime(u.lastLogin) : "Never logged in",
    );
    setText("securityMemberSince", u.createdAt ? formatDate(u.createdAt) : "—");
  }
});

async function initPersonalSettings(user) {
  /* Every listener below binds to a static element and the two settings
     requests below are fired on entry, so a second run would double-bind the
     controls (each click then saving twice) and re-issue both requests. */
  if (document.body.dataset.personalSettingsBound) return;
  document.body.dataset.personalSettingsBound = "1";

  const isTechnician = user.role === "Technician";
  const technicianStyles = document.getElementById("technicianSettingsStyles");
  if (technicianStyles) technicianStyles.disabled = !isTechnician;
  const alertEl = document.getElementById("settingsAlert");
  const form = document.getElementById("settingsForm");
  const saveBtn = document.getElementById("saveSettingsBtn");
  const spinner = document.getElementById("settingsSpinner");
  const saveIcon = document.getElementById("settingsSaveIcon");
  const saveLabel = document.getElementById("settingsSaveLabel");
  const languageSelect = document.getElementById("languageSelect");
  const themeSelect = document.getElementById("themeSelect");
  let original = null;

  /* The sidebar is a SIBLING of the Settings content container (#sidebar is
     never inside .flex-grow-1), so the settings forms physically cannot
     replace it. For a Requester the static markup in settings.html is already
     the exact requester sidebar used by user/dashboard.html, so this block must
     not run for that role at all. A Technician's link set genuinely differs, so
     it is the only case that rebuilds the list. */
  const sideNav = document.getElementById("settingsSidebarNav");
  if (sideNav && isTechnician) {
    /* [href, icon, i18n key, English fallback] — the fallback text stays
       inside the span so an untranslated key degrades to English instead of
       rendering a blank label (applyLanguage only overwrites on a hit). */
    const links = [
      [
        "technician/dashboard.html",
        "speedometer2",
        "side.dashboard",
        "Dashboard",
      ],
      [
        "technician/assigned-requests.html",
        "list-task",
        "side.assigned",
        "Assigned Requests",
      ],
      [
        "technician/maintenance.html",
        "tools",
        "side.maintenance",
        "Maintenance Activity",
      ],
      ["technician/history.html", "clock-history", "side.history", "History"],
      [
        "technician/technician-feedback.html",
        "chat-dots",
        "side.feedback",
        "Feedback",
      ],
      [
        "technician/notifications.html",
        "bell",
        "side.notifications",
        "Notifications",
      ],
    ];
    const markup = links
      .map(([href, icon, key, fallback]) => {
        return `<li class="nav-item"><a href="${href}" class="nav-link text-white-50"><i class="bi bi-${icon} me-2"></i><span data-i18n="${key}">${fallback}</span></a></li>`;
      })
      .join("");
    /* Rebuild only when the rendered links are actually wrong, so a correct
       sidebar is never churned — and restore the previous markup if the write
       throws, so a failure can never leave the navigation empty. */
    const currentHrefs = Array.from(sideNav.querySelectorAll("a[href]")).map(
      (link) => link.getAttribute("href"),
    );
    const wantedHrefs = links.map(([href]) => href);
    const alreadyCorrect =
      currentHrefs.length === wantedHrefs.length &&
      currentHrefs.every((href, index) => href === wantedHrefs[index]);
    if (!alreadyCorrect) {
      const previousMarkup = sideNav.innerHTML;
      try {
        sideNav.innerHTML = markup;
      } catch (error) {
        sideNav.innerHTML = previousMarkup;
        console.warn(
          "[Settings] Sidebar rebuild failed; keeping current links.",
          error,
        );
      }
    }
    /* Labels are injected after initLang() walked the document — resolve them
       now so this sidebar matches the role dashboards in the active language. */
    if (typeof applyLanguage === "function") applyLanguage(sideNav);
  }

  document
    .getElementById("availabilitySettings")
    ?.classList.toggle("d-none", !isTechnician);
  document
    .getElementById("maintenanceAlertsRow")
    ?.classList.toggle("d-none", !isTechnician);

  const showAlert = (message, type) => {
    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = message;
    alertEl.classList.remove("d-none");
  };
  const showFormAlert = (id, message, type) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove("d-none");
  };
  const clearFormAlert = (id) =>
    document.getElementById(id)?.classList.add("d-none");
  const profileForm = document.getElementById("profileForm");
  const passwordForm = document.getElementById("passwordForm");
  const profileFields = {
    fullName: document.getElementById("profileNameInput"),
    email: document.getElementById("profileEmailInput"),
    phone: document.getElementById("profilePhoneInput"),
    department: document.getElementById("profileDepartmentInput"),
    gender: document.getElementById("profileGenderInput"),
  };
  let originalProfile = null;

  const fillProfile = (profile) => {
    profileFields.fullName.value = profile.fullName || "";
    profileFields.email.value = profile.email || "";
    profileFields.phone.value = profile.phone || "";
    profileFields.department.value = profile.department || "";
    profileFields.gender.value = profile.gender || "";
  };
  const readProfile = () => ({
    fullName: profileFields.fullName.value.trim(),
    phone: profileFields.phone.value.trim(),
    department: profileFields.department.value.trim(),
    gender: profileFields.gender.value,
  });
  const validateProfile = () => {
    const fields = readProfile();
    let valid = true;
    const nameError = Validators.name(fields.fullName, "Full name");
    if (nameError) {
      showFieldError("profileNameInput", nameError);
      valid = false;
    } else {
      clearFieldValidation("profileNameInput");
    }
    const phoneError = Validators.phone(fields.phone);
    if (phoneError) {
      showFieldError("profilePhoneInput", phoneError);
      valid = false;
    } else {
      clearFieldValidation("profilePhoneInput");
    }
    return valid;
  };

  attachRealTimeValidation("profileForm", [
    {
      fieldId: "profileNameInput",
      checks: [(value) => Validators.name(value, "Full name")],
    },
    { fieldId: "profilePhoneInput", checks: [Validators.phone] },
  ]);

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateProfile()) return;
    const saveButton = document.getElementById("saveProfileBtn");
    const spinner = document.getElementById("profileSpinner");
    saveButton.disabled = true;
    spinner.classList.remove("d-none");
    clearFormAlert("profileAlert");
    try {
      const result = await apiRequest("/users/profile", {
        method: "PUT",
        body: readProfile(),
      });
      const updatedUser = result.data;
      Auth.setUser({ ...Auth.getUser(), ...updatedUser });
      fillProfile(updatedUser);
      originalProfile = readProfile();
      /* Optional: the shared profile dropdown removes the topbar
         #topUserName when it mounts, so this element may legitimately be
         gone. Guarded to keep a successful save from reporting a
         TypeError as a failure. */
      const topUserName = document.getElementById("topUserName");
      if (topUserName) topUserName.textContent = updatedUser.fullName || "";
      document.getElementById("sidebarUserName").textContent =
        updatedUser.fullName || "User";
      showFormAlert("profileAlert", "Profile updated successfully.", "success");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      showFormAlert("profileAlert", error.message, "danger");
    } finally {
      saveButton.disabled = false;
      spinner.classList.add("d-none");
    }
  });

  document.getElementById("cancelProfileBtn")?.addEventListener("click", () => {
    if (originalProfile) fillProfile({ ...user, ...originalProfile });
    clearAllFieldValidations("profileForm");
    clearFormAlert("profileAlert");
  });

  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const matchHint = document.getElementById("passwordMatchHint");
  const checkPasswordMatch = () => {
    if (!confirmPassword.value) {
      matchHint.textContent = "";
      matchHint.className = "form-text";
    } else if (newPassword.value === confirmPassword.value) {
      matchHint.textContent = "Passwords match.";
      matchHint.className = "form-text text-success";
    } else {
      matchHint.textContent = "Passwords do not match.";
      matchHint.className = "form-text text-danger";
    }
  };
  newPassword.addEventListener("input", checkPasswordMatch);
  confirmPassword.addEventListener("input", checkPasswordMatch);
  document
    .querySelectorAll(".password-toggle[data-target]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.target);
        input.type = input.type === "password" ? "text" : "password";
        button.setAttribute(
          "aria-label",
          input.type === "password" ? "Show password" : "Hide password",
        );
        button.querySelector("i").className =
          input.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
      });
    });
  passwordForm?.addEventListener("reset", () => {
    clearFormAlert("passwordAlert");
    matchHint.textContent = "";
    matchHint.className = "form-text";
  });
  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = document.getElementById("currentPassword").value;
    const next = newPassword.value;
    const confirmation = confirmPassword.value;
    let valid = true;
    if (!current) {
      showFieldError("currentPassword", "Current password is required.");
      valid = false;
    } else clearFieldValidation("currentPassword");
    const passwordError = Validators.password(next);
    if (passwordError) {
      showFieldError("newPassword", passwordError);
      valid = false;
    } else clearFieldValidation("newPassword");
    const matchError = Validators.passwordMatch(next, confirmation);
    if (matchError) {
      showFieldError("confirmPassword", matchError);
      valid = false;
    } else clearFieldValidation("confirmPassword");
    if (!valid) return;

    const saveButton = document.getElementById("savePasswordBtn");
    saveButton.disabled = true;
    document.getElementById("passwordSpinner").classList.remove("d-none");
    clearFormAlert("passwordAlert");
    try {
      await apiRequest("/users/change-password", {
        method: "PUT",
        body: { currentPassword: current, newPassword: next },
      });
      passwordForm.reset();
      clearAllFieldValidations("passwordForm");
      showFormAlert(
        "passwordAlert",
        "Password updated successfully.",
        "success",
      );
    } catch (error) {
      showFormAlert("passwordAlert", error.message, "danger");
    } finally {
      saveButton.disabled = false;
      document.getElementById("passwordSpinner").classList.add("d-none");
    }
  });

  const captureForm = () => ({
    inAppNotifications: document.getElementById("inAppNotifications").checked,
    emailNotifications: document.getElementById("emailNotifications").checked,
    maintenanceAlerts: isTechnician
      ? document.getElementById("maintenanceAlerts").checked
      : undefined,
    language: languageSelect.value,
    theme: themeSelect.value,
    availability: isTechnician
      ? document.getElementById("availabilitySelect").value
      : undefined,
  });
  const applyForm = (values) => {
    document.getElementById("inAppNotifications").checked =
      values.inAppNotifications;
    document.getElementById("emailNotifications").checked =
      values.emailNotifications;
    if (isTechnician) {
      document.getElementById("maintenanceAlerts").checked =
        values.maintenanceAlerts;
      const availability = document.getElementById("availabilitySelect");
      /* Only assign a value the <select> actually offers — writing anything
         else leaves the control blank, which would then save as "". */
      if (
        availability &&
        [...availability.options].some((o) => o.value === values.availability)
      ) {
        availability.value = values.availability;
      }
    }
    languageSelect.value = values.language;
    themeSelect.value = values.theme;
  };

  /* Unsaved-changes marker. Recomputed from the live form against the last
     saved snapshot rather than set by each listener, so it can never drift out
     of sync with what the Save button would actually persist. */
  const dirtyBadge = document.getElementById("unsavedChangesBadge");
  const hasUnsavedChanges = () =>
    !!original && JSON.stringify(captureForm()) !== JSON.stringify(original);
  const syncDirtyBadge = () =>
    dirtyBadge?.classList.toggle("show", hasUnsavedChanges());
  /* Re-apply the saved language/theme so Cancel genuinely undoes the instant
     preview that the select handlers already applied to the live document. */
  const restoreDisplay = () => {
    if (!original) return;
    if (typeof setLang === "function") setLang(original.language, false);
    if (typeof applyTheme === "function") applyTheme(original.theme, false);
  };
  const setSaving = (saving) => {
    saveBtn.disabled = saving;
    spinner.classList.toggle("d-none", !saving);
    saveIcon.classList.toggle("d-none", saving);
    /* Resolve through the shared i18n table so the label matches the active
       language — writing a hard-coded string here would clobber the
       translation that applyLanguage() put on this span. */
    saveLabel.textContent =
      typeof t === "function"
        ? saving
          ? t("common.saving") || "Saving…"
          : t("profile.save") || "Save Changes"
        : saving
          ? "Saving…"
          : "Save Changes";
  };

  /* Identity fields depend only on the already-loaded session user, never on a
     network response, so they are populated before the fetch below. Otherwise a
     /users/preferences failure would blank the profile and account panels while
     the page reports an error. */
  fillProfile(user);
  originalProfile = readProfile();
  /* Optional: absent when the shared profile dropdown replaced the topbar
     greeting with its own trigger. */
  const topUserName = document.getElementById("topUserName");
  if (topUserName) topUserName.textContent = user.fullName || "";
  document.getElementById("accountRole").textContent = user.role || "—";
  document.getElementById("accountStatus").textContent = user.status || "—";
  document.getElementById("accountLastLogin").textContent = user.lastLogin
    ? formatDateTime(user.lastLogin)
    : typeof t === "function"
      ? t("settings.neverLoggedIn") || "Never logged in"
      : "Never logged in";
  document.getElementById("accountMemberSince").textContent = user.createdAt
    ? formatDate(user.createdAt)
    : "—";

  /* Preferences controls stay disabled until the saved values have actually
     loaded, so nothing can be written from a blank form — but they are NOT
     disabled forever: loadSavedSettings() is re-runnable and the failure path
     puts a working Retry button in the alert. */
  const setPreferencesControlsEnabled = (enabled) => {
    form
      .querySelectorAll("input, select, button[type=submit]")
      .forEach((control) => {
        control.disabled = !enabled;
      });
  };

  const loadSavedSettings = async () => {
    alertEl.classList.add("d-none");
    setPreferencesControlsEnabled(false);
    spinner.classList.remove("d-none");
    try {
      /* A Technician with no Technician document must not take the whole page
         down: the notification/language/theme preferences are User-level and
         still load fine. Only the availability control depends on /technicians/me,
         so that one failure is absorbed and the row is hidden with an explanation. */
      const [preferencesResult, technicianResult] = await Promise.all([
        apiRequest("/users/preferences"),
        isTechnician
          ? apiRequest("/technicians/me").catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);
      const preferences = preferencesResult.data || {};
      /* This snapshot MUST have the same keys, in the same order, as
         captureForm() — the unsaved-changes marker compares the two with
         JSON.stringify, which omits undefined values. A Requester gets
         maintenanceAlerts/availability back as undefined from the API, so
         storing them here as real values would make the two objects differ
         forever and light up the "Unsaved changes" marker on a pristine page. */
      original = {
        inAppNotifications: preferences.inAppNotifications !== false,
        emailNotifications: preferences.emailNotifications !== false,
        maintenanceAlerts: isTechnician
          ? preferences.maintenanceAlerts !== false
          : undefined,
        language: preferences.language === "am" ? "am" : "en",
        theme: preferences.theme === "dark" ? "dark" : "light",
        availability: isTechnician
          ? technicianResult.data?.availability ||
            (technicianResult.data?.available === false
              ? "offline"
              : "available")
          : undefined,
      };
      applyForm(original);
      /* The server is the source of truth for language/theme, so mirror it into
         localStorage. Without this, every OTHER page would keep booting from a
         stale local value and appear to ignore the change made here. */
      if (typeof setLang === "function") setLang(original.language);
      if (typeof setTheme === "function") setTheme(original.theme);
      if (isTechnician && !technicianResult.data) {
        document
          .getElementById("availabilitySettings")
          ?.classList.add("d-none");
        showAlert(
          "No technician profile is linked to your account yet, so availability cannot be changed. Contact ICT Admin.",
          "warning",
        );
      }
      setPreferencesControlsEnabled(true);
    } catch (err) {
      /* showAlert() rewrites the alert's textContent, which also drops any
         Retry button left over from a previous failed attempt. */
      showAlert(err.message || "Could not load your settings.", "danger");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-sm btn-outline-secondary ms-2";
      retry.textContent = "Retry";
      retry.addEventListener("click", loadSavedSettings);
      alertEl.appendChild(retry);
    } finally {
      spinner.classList.add("d-none");
      syncDirtyBadge();
    }
  };

  await loadSavedSettings();

  document.getElementById("cancelSettingsBtn").addEventListener("click", () => {
    const discarded = hasUnsavedChanges();
    if (original) {
      applyForm(original);
      /* Undo the instant language/theme preview as well — the select handlers
         already mutated the live document, so resetting only the <select>
         values would leave the page rendering an unsaved state. */
      restoreDisplay();
    }
    clearAllFieldValidations("settingsForm");
    if (discarded) showAlert("Changes discarded.", "info");
    else alertEl.classList.add("d-none");
    syncDirtyBadge();
  });
  document
    .getElementById("logoutSettingsBtn")
    ?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      /* logout() navigates away, so a double click would fire two
         /auth/logout requests at a session the first one is already
         destroying. Disable the control for the duration. */
      if (btn.disabled) return;
      btn.disabled = true;
      showAlert("Signing you out…", "info");
      /* logout() swallows fetch errors and only redirects once the request
         settles. If the server never answers it would never settle, leaving a
         permanently disabled button — so re-enable and report after a wait. */
      let signedOut = false;
      const recover = setTimeout(() => {
        if (signedOut || !document.body.contains(btn)) return;
        btn.disabled = false;
        showAlert(
          "Could not reach the server to sign you out. Please try again.",
          "danger",
        );
      }, 6000);
      try {
        await logout();
        signedOut = true;
      } finally {
        clearTimeout(recover);
      }
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!original || saveBtn.disabled) return;
    const current = captureForm();
    const previousAvailability = original.availability;
    setSaving(true);
    alertEl.classList.add("d-none");

    /* Preferences and availability live in two different collections, so they
       are persisted as two steps and the saved snapshot is advanced as each one
       succeeds. Without this, a failed availability call would roll the whole
       form back to preference values the server had already replaced — the UI
       would then show "unsaved" state that no longer matches the database. */
    try {
      await apiRequest("/users/preferences", {
        method: "PUT",
        body: {
          inAppNotifications: current.inAppNotifications,
          emailNotifications: current.emailNotifications,
          language: current.language,
          theme: current.theme,
          ...(isTechnician
            ? { maintenanceAlerts: current.maintenanceAlerts }
            : {}),
        },
      });
      original = { ...original, ...current };
      if (typeof setLang === "function") setLang(current.language);
      if (typeof setTheme === "function") setTheme(current.theme);

      if (isTechnician && current.availability !== previousAvailability) {
        try {
          await apiRequest("/technicians/me", {
            method: "PUT",
            body: { availability: current.availability },
          });
          original = { ...original, availability: current.availability };
        } catch (availabilityError) {
          /* Preferences are safely stored; only the availability leg failed. */
          showAlert(
            `Your preferences were saved, but availability could not be updated: ${availabilityError.message}`,
            "warning",
          );
          return;
        }
      }
      showAlert("Settings saved successfully.", "success");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      showAlert(err.message || "Could not save your settings.", "danger");
    } finally {
      setSaving(false);
      syncDirtyBadge();
    }
  });

  /* Language and theme preview instantly, but are written to localStorage and
     to the server only by Save — that is what gives Cancel something real to
     revert. setLang(v, false) / applyTheme(v, false) are the non-persisting
     variants; setTheme() would save unconditionally and defeat the Cancel. */
  languageSelect.addEventListener("change", () => {
    setLang(languageSelect.value, false);
    syncDirtyBadge();
  });
  themeSelect.addEventListener("change", () => {
    if (typeof applyTheme === "function") applyTheme(themeSelect.value, false);
    syncDirtyBadge();
  });

  /* One delegated listener covers the switches and the availability select, so
     the unsaved marker stays correct without N near-identical handlers. */
  form.addEventListener("change", (event) => {
    if (event.target === languageSelect || event.target === themeSelect) return;
    syncDirtyBadge();
  });
}
