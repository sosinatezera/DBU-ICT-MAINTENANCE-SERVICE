/* ============================================================
   settings.js — Settings Page Logic (Admin + Requester/Technician)
    Smart ICT Maintenance Management System

   One file serves two pages, split by pathname at line 8:
     /admin/settings.html  -> requireRole("ICT Admin"),           admin block
     /settings.html        -> requireRole("Requester","Technician"),
                              initPersonalSettings() (from line 515)
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const adminSettingsPage = window.location.pathname.endsWith(
    "/admin/settings.html",
  );
  if (!adminSettingsPage) {
    await Auth.load();
    const user = requireRole("Requester", "Technician");
    if (!user) return;
    await initPersonalSettings(user);
    return;
  }

  /* Clear alerts on form reset */
  ["generalSettingsForm", "notifSettingsForm", "profileForm"].forEach((id) => {
    document.getElementById(id)?.addEventListener("reset", () => {
      document.getElementById("settingsAlert")?.classList.add("d-none");
      document.getElementById("notifSettingsAlert")?.classList.add("d-none");
      document.getElementById("profileAlert")?.classList.add("d-none");
    });
  });

  const changePasswordForm = document.getElementById("changePasswordForm");
  const currentPasswordInput = document.getElementById("currentPassword");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const passwordMatchText = document.getElementById("passwordMatchText");
  let passwordUpdating = false;
  let passwordFormAuthorized = false;

  function resetPasswordVisibility() {
    changePasswordForm
      ?.querySelectorAll("[data-toggle-password]")
      .forEach((button) => {
        const target = document.getElementById(
          button.getAttribute("data-toggle-password"),
        );
        if (target) target.type = "password";
        button.setAttribute("aria-pressed", "false");
        const targetName =
          target?.id === "currentPassword"
            ? "current"
            : target?.id === "newPassword"
              ? "new"
              : "confirmation";
        button.setAttribute("aria-label", `Show ${targetName} password`);
        const icon = button.querySelector("i");
        if (icon) icon.className = "bi bi-eye";
      });
  }

  changePasswordForm
    ?.querySelectorAll("[data-toggle-password]")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const target = document.getElementById(
          button.getAttribute("data-toggle-password"),
        );
        if (!target) return;

        const visible = target.type === "password";
        target.type = visible ? "text" : "password";
        button.setAttribute("aria-pressed", String(visible));
        const targetName =
          target.id === "currentPassword"
            ? "current"
            : target.id === "newPassword"
              ? "new"
              : "confirmation";
        button.setAttribute(
          "aria-label",
          `${visible ? "Hide" : "Show"} ${targetName} password`,
        );
        const icon = button.querySelector("i");
        if (icon) icon.className = visible ? "bi bi-eye-slash" : "bi bi-eye";
      });
    });

  function checkPasswordMatch() {
    if (!confirmPasswordInput || !newPasswordInput || !passwordMatchText) {
      return;
    }
    const confirmation = confirmPasswordInput.value;
    if (!confirmation) {
      passwordMatchText.textContent = "";
      passwordMatchText.className = "form-text";
    } else if (newPasswordInput.value === confirmation) {
      passwordMatchText.textContent = "Passwords match.";
      passwordMatchText.className = "form-text text-success";
      clearFieldValidation("confirmPassword");
    } else {
      passwordMatchText.textContent =
        "New password and confirmation password do not match.";
      passwordMatchText.className = "form-text text-danger";
    }
  }
  newPasswordInput?.addEventListener("input", checkPasswordMatch);
  confirmPasswordInput?.addEventListener("input", checkPasswordMatch);
  changePasswordForm?.addEventListener("reset", () => {
    resetPasswordVisibility();
    if (passwordMatchText) {
      passwordMatchText.textContent = "";
      passwordMatchText.className = "form-text";
    }
    document.getElementById("passwordAlert")?.classList.add("d-none");
  });

  changePasswordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!passwordFormAuthorized) {
      showAlert(
        "passwordAlert",
        "Please wait for administrator authentication to complete.",
        "warning",
      );
      return;
    }
    if (passwordUpdating) return;

    const current = currentPasswordInput?.value || "";
    const newPassword = newPasswordInput?.value || "";
    const confirmation = confirmPasswordInput?.value || "";
    document.getElementById("passwordAlert")?.classList.add("d-none");

    let valid = true;
    if (!current) {
      showFieldError("currentPassword", "Current password is required.");
      valid = false;
    } else {
      clearFieldValidation("currentPassword");
    }

    const passwordError = Validators.password(newPassword);
    if (passwordError) {
      showFieldError("newPassword", passwordError);
      valid = false;
    } else {
      clearFieldValidation("newPassword");
    }

    const confirmationError = Validators.passwordMatch(
      newPassword,
      confirmation,
    );
    if (confirmationError) {
      showFieldError("confirmPassword", confirmationError);
      valid = false;
    } else {
      clearFieldValidation("confirmPassword");
    }

    if (newPassword && newPassword === current) {
      showFieldError(
        "newPassword",
        "New password must be different from the current password.",
      );
      valid = false;
    }
    if (!valid) return;

    passwordUpdating = true;
    setLoading("savePasswordBtn", "savePasswordSpinner", true);
    const savePasswordLabel = document.getElementById("savePasswordLabel");
    if (savePasswordLabel) savePasswordLabel.textContent = "Updating...";
    try {
      const response = await apiRequest("/users/change-password", {
        method: "PUT",
        body: { currentPassword: current, newPassword },
      });
      if (response?.success !== true) {
        throw new Error("Password update was not confirmed by the server.");
      }

      changePasswordForm.reset();
      ["currentPassword", "newPassword", "confirmPassword"].forEach((id) =>
        clearFieldValidation(id),
      );
      const successMessage = "Password updated successfully!";
      showAlert("passwordAlert", successMessage, "success");
      showToast(successMessage, "success");
    } catch (error) {
      let message = "Unable to update password. Please try again.";
      if (error?.status === 401 || error?.redirected) {
        message = "Access token expired; sign in again.";
      } else if (error?.status === 400 || error?.status === 422) {
        message =
          error.message || "Password does not meet security requirements.";
        if (message === "Current password is incorrect.") {
          showFieldError("currentPassword", message);
        } else if (
          message !== "Current password and new password are required."
        ) {
          showFieldError("newPassword", message);
        }
      }
      showAlert("passwordAlert", message, "danger");
      showToast(message, "danger");
    } finally {
      passwordUpdating = false;
      setLoading("savePasswordBtn", "savePasswordSpinner", false);
      if (savePasswordLabel) {
        savePasswordLabel.textContent = "Update Password";
      }
    }
  });

  const profileForm = document.getElementById("profileForm");
  let profileSaving = false;
  let profileFormAuthorized = false;
  let currentUser = null;
  let profileAlertTimeout = null;

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!profileFormAuthorized || !currentUser) {
      showAlert(
        "profileAlert",
        "Please wait for administrator authentication to complete.",
        "warning",
      );
      return;
    }
    if (profileSaving) return;

    const profilePayload = {
      fullName: getVal("profileName"),
      phone: getVal("profilePhone"),
      department: getVal("profileDept"),
    };
    let valid = true;
    const nameError = Validators.name(profilePayload.fullName, "Full name");
    if (nameError) {
      showFieldError("profileName", nameError);
      valid = false;
    } else {
      clearFieldValidation("profileName");
    }

    const phoneError = Validators.phone(profilePayload.phone);
    if (phoneError) {
      showFieldError("profilePhone", phoneError);
      valid = false;
    } else {
      clearFieldValidation("profilePhone");
    }

    if (profilePayload.fullName.length > 100) {
      showFieldError("profileName", "Full name must be 100 characters or fewer.");
      valid = false;
    }
    if (profilePayload.department.length > 120) {
      showFieldError(
        "profileDept",
        "Department must be 120 characters or fewer.",
      );
      valid = false;
    } else {
      clearFieldValidation("profileDept");
    }
    if (!valid) return;

    profileSaving = true;
    const saveLabel = document.getElementById("saveProfileLabel");
    setLoading("saveProfileBtn", "saveProfileSpinner", true);
    if (saveLabel) saveLabel.textContent = "Saving...";
    document.getElementById("profileAlert")?.classList.add("d-none");

    try {
      const response = await apiRequest("/users/profile", {
        method: "PUT",
        body: profilePayload,
      });
      if (
        response?.success !== true ||
        !response.data ||
        response.data.fullName !== profilePayload.fullName ||
        (response.data.phone || "") !== profilePayload.phone ||
        (response.data.department || "") !== profilePayload.department
      ) {
        throw new Error("The server did not confirm the saved profile.");
      }

      const refreshedUser = await Auth.refresh();
      if (
        !refreshedUser ||
        refreshedUser.fullName !== profilePayload.fullName ||
        (refreshedUser.phone || "") !== profilePayload.phone ||
        (refreshedUser.department || "") !== profilePayload.department
      ) {
        throw new Error("The saved profile could not be reloaded.");
      }

      currentUser = refreshedUser;
      populateProfile(currentUser);
      populateSecurity(currentUser);
      const successMessage = "Profile updated successfully!";
      showAlert("profileAlert", successMessage, "success");
      showToast(successMessage, "success");
      if (profileAlertTimeout) window.clearTimeout(profileAlertTimeout);
      profileAlertTimeout = window.setTimeout(() => {
        document.getElementById("profileAlert")?.classList.add("d-none");
      }, 4000);
    } catch (error) {
      const message =
        error?.status === 401 || error?.redirected
          ? "Access token expired; please sign in again."
          : error?.message || "Unable to save profile. Please try again.";
      showAlert("profileAlert", message, "danger");
      showToast(message, "danger");
    } finally {
      profileSaving = false;
      setLoading("saveProfileBtn", "saveProfileSpinner", false);
      if (saveLabel) saveLabel.textContent = "Save Profile";
    }
  });

  profileForm?.addEventListener("reset", (event) => {
    event.preventDefault();
    if (currentUser) populateProfile(currentUser);
    ["profileName", "profilePhone", "profileDept"].forEach(
      clearFieldValidation,
    );
    document.getElementById("profileAlert")?.classList.add("d-none");
    const cancelPhotoButton = document.getElementById(
      "cancelProfilePhotoBtn",
    );
    if (cancelPhotoButton && !cancelPhotoButton.disabled) {
      cancelPhotoButton.click();
    }
  });

  /* ── Load all data on init ────────────────────────────── */
  let currentSettings = null;
  let notificationSettingsSaving = false;
  /* Guards against the data-loss case below: if /settings could not be read,
     the form fields keep their HTML defaults (empty strings, unchecked
     boxes). Saving in that state would PUT the defaults over the real stored
     settings and silently wipe them. Until the read succeeds, the settings
     forms are inert. */
  let settingsLoaded = false;
  let generalSettingsSaving = false;
  const generalSettingsForm = document.getElementById("generalSettingsForm");

  function populateGeneralSettings(settings) {
    setVal("settingSystemName", settings.systemName);
    setVal("settingOrgName", settings.organizationName);
    setVal("settingSystemDesc", settings.systemDescription);
    setVal(
      "settingLanguage",
      ["en", "am", "om"].includes(settings.defaultLanguage)
        ? settings.defaultLanguage
        : "en",
    );
    setVal("settingDefaultTheme", settings.defaultTheme || "light");
    setVal("settingTimezone", settings.timezone);
    setVal("settingDateFormat", settings.dateFormat);
    setVal("settingTimeFormat", settings.timeFormat || "24h");
  }

  function validateGeneralSettings(settings) {
    if (!settings.systemName) return "System name is required.";
    if (settings.systemName.length < 2) {
      return "System name must be at least 2 characters.";
    }
    if (settings.systemName.length > 100) {
      return "System name must be no more than 100 characters.";
    }
    if (!settings.organizationName) return "Organization name is required.";
    if (settings.organizationName.length < 2) {
      return "Organization name must be at least 2 characters.";
    }
    if (settings.organizationName.length > 100) {
      return "Organization name must be no more than 100 characters.";
    }
    if (settings.systemDescription.length > 500) {
      return "System description must be no more than 500 characters.";
    }
    if (!["en", "am", "om"].includes(settings.defaultLanguage)) {
      return "Select a valid default language.";
    }
    if (!["light", "dark"].includes(settings.defaultTheme)) {
      return "Select a valid default theme.";
    }
    if (!["12h", "24h"].includes(settings.timeFormat)) {
      return "Select a valid time format.";
    }
    if (
      !["Africa/Addis_Ababa", "Africa/Nairobi", "UTC"].includes(
        settings.timezone,
      )
    ) {
      return "Select a valid time zone.";
    }
    if (
      !["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "EC"].includes(
        settings.dateFormat,
      )
    ) {
      return "Select a valid date format.";
    }
    return null;
  }

  function setGeneralSettingsLoading(loading) {
    const button = document.getElementById("saveGeneralBtn");
    const spinner = document.getElementById("saveGeneralSpinner");
    const label = document.getElementById("saveGeneralLabel");
    if (button) {
      button.disabled = loading;
      button.setAttribute("aria-busy", loading ? "true" : "false");
    }
    spinner?.classList.toggle("d-none", !loading);
    if (label) {
      if (loading) {
        label.textContent = "Saving...";
      } else {
        label.textContent = label.dataset.savedLabel || "Save Changes";
      }
    }
  }

  const saveGeneralLabel = generalSettingsForm?.querySelector("#saveGeneralLabel");
  if (saveGeneralLabel) {
    saveGeneralLabel.dataset.savedLabel = saveGeneralLabel.textContent.trim();
  }

  /* Register the primary settings handler before initializing profile, photo,
     and other admin-page features so an unrelated initialization error cannot
     leave Save Changes without a submit listener. */
  generalSettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!settingsLoaded || !currentSettings) {
      return settingsNotLoaded("settingsAlert");
    }
    if (generalSettingsSaving) return;

    const submittedSettings = {
      systemName: getVal("settingSystemName").replace(/\s+/g, " "),
      organizationName: getVal("settingOrgName").replace(/\s+/g, " "),
      systemDescription: getVal("settingSystemDesc").replace(/\s+/g, " "),
      defaultLanguage: getVal("settingLanguage"),
      defaultTheme: getVal("settingDefaultTheme"),
      timezone: getVal("settingTimezone"),
      dateFormat: getVal("settingDateFormat"),
      timeFormat: getVal("settingTimeFormat"),
    };
    const validationError = validateGeneralSettings(submittedSettings);
    if (validationError) {
      showAlert("settingsAlert", validationError, "danger");
      return;
    }

    generalSettingsSaving = true;
    setGeneralSettingsLoading(true);
    try {
      const response = await apiRequest("/settings/general", {
        method: "PUT",
        body: submittedSettings,
      });
      if (response.success !== true || !response.data) {
        throw new Error("The server did not confirm that settings were saved.");
      }

      /* Read back from the protected endpoint after the successful write. The
         API client invalidates its GET cache on mutations, so this confirms
         the values currently persisted by the backend before showing success. */
      const persistedResponse = await apiRequest("/settings");
      const persistedSettings = persistedResponse.data;
      const matchesSavedValues =
        persistedResponse.success === true &&
        persistedSettings &&
        Object.entries(submittedSettings).every(
          ([key, value]) => persistedSettings[key] === value,
        );
      if (!matchesSavedValues) {
        throw new Error(
          "The server did not return the saved settings. Please reload and try again.",
        );
      }

      currentSettings = persistedSettings;
      showAlert("settingsAlert", "Settings saved successfully!", "success");
      showToast("Settings saved successfully!", "success");
      if (window.__ictPrefs) {
        try {
          window.__ictPrefs.refresh();
        } catch (err) {
          console.warn("Could not refresh system preferences:", err);
        }
      }
    } catch (err) {
      const message =
        err?.message || "Failed to save settings. Please try again.";
      showAlert("settingsAlert", message, "danger");
      showToast(message, "danger");
    } finally {
      generalSettingsSaving = false;
      setGeneralSettingsLoading(false);
    }
  });

  generalSettingsForm?.addEventListener("reset", (event) => {
    if (!currentSettings) return;
    event.preventDefault();
    populateGeneralSettings(currentSettings);
    if (window.setLang) {
      window.setLang(currentSettings.defaultLanguage || "en", false);
    }
  });

  function settingsNotLoaded(alertId) {
    showAlert(
      alertId,
      "System settings could not be loaded, so saving is disabled to protect your current configuration. Check your connection and retry the page.",
      "warning",
    );
    return false;
  }

  function lockSettingsForms(locked) {
    [
      "generalSettingsForm",
      "notifSettingsForm",
      "userSettingsForm",
      "technicianSettingsForm",
    ].forEach((formId) => {
      const form = document.getElementById(formId);
      if (!form) return;
      form.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = locked;
      });
    });
  }

  const notifSettingsForm = document.getElementById("notifSettingsForm");

  function populateNotificationSettings(settings) {
    setCheck("notifNewRequest", settings.notifNewRequest !== false);
    setCheck("notifAssignment", settings.notifAssignment !== false);
    setCheck("notifStatusChange", settings.notifStatusChange !== false);
    setCheck("notifCompletion", settings.notifCompletion !== false);
    setCheck("notifSystemSecurity", settings.notifSystemSecurity !== false);
    setCheck("notifUserFeedback", settings.notifUserFeedback !== false);
    setCheck("notifTechnicianFeedback", settings.notifTechnicianFeedback !== false);
    setCheck("notifFeedbackReplies", settings.notifFeedbackReplies !== false);
    setCheck("notificationSound", settings.notificationSound !== false);
    setCheck("emailNotifications", settings.emailNotifications === true);
  }

  /* As with the general settings form, bind before authentication/settings
     requests so an unrelated initialization failure cannot leave an active
     submit button with no handler. The form remains disabled until loaded. */
  lockSettingsForms(true);
  notifSettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!settingsLoaded || !currentSettings) {
      return settingsNotLoaded("notifSettingsAlert");
    }
    if (notificationSettingsSaving) return;

    notificationSettingsSaving = true;
    const saveLabel = document.getElementById("saveNotifLabel");
    const originalSaveLabel =
      saveLabel?.textContent || "Save Notification Preferences";
    if (saveLabel) saveLabel.textContent = "Saving...";
    setLoading("saveNotifBtn", "saveNotifSpinner", true);

    const submittedPreferences = {
      notifNewRequest: getCheck("notifNewRequest"),
      notifAssignment: getCheck("notifAssignment"),
      notifStatusChange: getCheck("notifStatusChange"),
      notifCompletion: getCheck("notifCompletion"),
      notifSystemSecurity: getCheck("notifSystemSecurity"),
      notifUserFeedback: getCheck("notifUserFeedback"),
      notifTechnicianFeedback: getCheck("notifTechnicianFeedback"),
      notifFeedbackReplies: getCheck("notifFeedbackReplies"),
      notificationSound: getCheck("notificationSound"),
      emailNotifications: getCheck("emailNotifications"),
    };

    try {
      document.getElementById("notifSettingsAlert")?.classList.add("d-none");
      const response = await apiRequest("/settings/notifications", {
        method: "PUT",
        body: submittedPreferences,
      });
      if (response?.success !== true || !response.data) {
        throw new Error(
          "The server did not confirm that notification preferences were saved.",
        );
      }

      /* Confirm the persisted values with a fresh, authenticated backend read
         before reporting success. Successful mutations invalidate apiRequest's
         GET cache, so this read is not served from a stale response. */
      const persistedResponse = await apiRequest("/settings");
      const persistedSettings = persistedResponse?.data;
      const preferencesConfirmed =
        persistedResponse?.success === true &&
        persistedSettings &&
        Object.entries(submittedPreferences).every(
          ([key, value]) => persistedSettings[key] === value,
        );
      if (!preferencesConfirmed) {
        throw new Error(
          "The server did not return the saved notification preferences. Please reload and try again.",
        );
      }

      currentSettings = persistedSettings;
      populateNotificationSettings(currentSettings);
      const notificationSound =
        document.getElementById("notificationSound");
      if (notificationSound && window.NotificationSound) {
        window.NotificationSound.setEnabled(currentSettings.notificationSound);
      }
      const successMessage = "Notification preferences saved successfully!";
      showAlert("notifSettingsAlert", successMessage, "success");
      showToast(successMessage, "success");
      window.setTimeout(() => {
        document.getElementById("notifSettingsAlert")?.classList.add("d-none");
      }, 4000);
    } catch (err) {
      console.error(
        "Failed to save notification preferences:",
        err?.message || err,
      );
      const message =
        err?.message ||
        "Failed to save notification preferences. Please try again.";
      showAlert("notifSettingsAlert", message, "danger");
      showToast(message, "danger");
    } finally {
      notificationSettingsSaving = false;
      setLoading("saveNotifBtn", "saveNotifSpinner", false);
      if (saveLabel) saveLabel.textContent = originalSaveLabel;
    }
  });

  notifSettingsForm?.addEventListener("reset", (event) => {
    if (!currentSettings) return;
    event.preventDefault();
    populateNotificationSettings(currentSettings);
    const notificationSound = document.getElementById("notificationSound");
    if (notificationSound && window.NotificationSound) {
      window.NotificationSound.setEnabled(currentSettings.notificationSound);
    }
  });

  function populateUserSettings(settings) {
    setCheck("settingPublicRegistration", settings.publicRegistration !== false);
  }

  function populateTechnicianSettings(settings) {
    setCheck("settingTechAutoNotify", settings.techAutoNotify !== false);
    setVal("settingSlaResponseHours", settings.slaResponseHours ?? 24);
    setVal("settingDefaultPriority", settings.defaultPriority || "medium");
  }

  async function savePolicyForm({ form, fields, alertId, buttonId, spinnerId }) {
    if (!settingsLoaded || !currentSettings) return settingsNotLoaded(alertId);
    if (form.dataset.saving === "true") return;
    const payload = fields();
    if (payload.slaResponseHours !== undefined &&
      (!Number.isInteger(payload.slaResponseHours) ||
        payload.slaResponseHours < 1 ||
        payload.slaResponseHours > 720)) {
      showAlert(alertId, "Response target must be a whole number from 1 to 720 hours.", "danger");
      return;
    }
    if (
      Object.hasOwn(payload, "publicRegistration") &&
      currentSettings.publicRegistration !== payload.publicRegistration &&
      !window.confirm(
        payload.publicRegistration
          ? "Allow people to create accounts through public registration?"
          : "Disable public registration? Existing accounts will remain active.",
      )
    ) return;

    form.dataset.saving = "true";
    setLoading(buttonId, spinnerId, true);
    try {
      const response = await apiRequest("/settings/general", {
        method: "PUT",
        body: payload,
      });
      if (response?.success !== true) throw new Error("The server did not confirm the settings update.");
      const persisted = await apiRequest("/settings");
      if (persisted?.success !== true || !persisted.data ||
        Object.entries(payload).some(([key, value]) => persisted.data[key] !== value)) {
        throw new Error("Saved settings could not be verified. Reload the page before making another change.");
      }
      currentSettings = persisted.data;
      populateUserSettings(currentSettings);
      populateTechnicianSettings(currentSettings);
      showAlert(alertId, "Settings saved and verified.", "success");
      showToast("Settings saved and verified.", "success");
      window.__ictPrefs?.refresh?.();
    } catch (error) {
      const message = error?.message || "Unable to save these settings.";
      showAlert(alertId, message, "danger");
      showToast(message, "danger");
    } finally {
      form.dataset.saving = "false";
      setLoading(buttonId, spinnerId, false);
    }
  }

  const userSettingsForm = document.getElementById("userSettingsForm");
  userSettingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePolicyForm({
      form: userSettingsForm,
      fields: () => ({ publicRegistration: getCheck("settingPublicRegistration") }),
      alertId: "userSettingsAlert",
      buttonId: "saveUserSettingsBtn",
      spinnerId: "saveUserSettingsSpinner",
    });
  });
  userSettingsForm?.addEventListener("reset", (event) => {
    if (!currentSettings) return;
    event.preventDefault();
    populateUserSettings(currentSettings);
  });

  const technicianSettingsForm = document.getElementById("technicianSettingsForm");
  technicianSettingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePolicyForm({
      form: technicianSettingsForm,
      fields: () => ({
        techAutoNotify: getCheck("settingTechAutoNotify"),
        defaultPriority: getVal("settingDefaultPriority"),
        slaResponseHours: Number(getVal("settingSlaResponseHours")),
      }),
      alertId: "technicianSettingsAlert",
      buttonId: "saveTechnicianSettingsBtn",
      spinnerId: "saveTechnicianSettingsSpinner",
    });
  });
  technicianSettingsForm?.addEventListener("reset", (event) => {
    if (!currentSettings) return;
    event.preventDefault();
    populateTechnicianSettings(currentSettings);
  });

  const auditBody = document.getElementById("settingsAuditLogBody");
  let auditPage = 1;
  let auditPages = 1;
  const escapeAuditText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const formatBackupSize = (bytes) => {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "—";
    const value = Number(bytes);
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
  };
  let backupRefreshTimer = null;
  let backupCreatePending = false;
  let maintenanceLoaded = false;

  function setBackupCreateBusy(busy) {
    backupCreatePending = busy;
    const button = document.getElementById("createBackupBtn");
    const spinner = document.getElementById("createBackupSpinner");
    const icon = document.getElementById("createBackupIcon");
    const label = document.getElementById("createBackupLabel");
    if (button) button.disabled = busy || button.dataset.ready !== "true";
    spinner?.classList.toggle("d-none", !busy);
    icon?.classList.toggle("d-none", busy);
    if (label) label.textContent = busy ? "Starting..." : "Create Backup";
  }

  async function loadBackupOperations() {
    const tableBody = document.getElementById("backupHistoryBody");
    const readiness = document.getElementById("backupReadiness");
    const latestSuccessful = document.getElementById("latestSuccessfulBackup");
    if (!tableBody || !readiness || !latestSuccessful) return;
    if (backupRefreshTimer) clearTimeout(backupRefreshTimer);
    document.getElementById("backupOperationsAlert")?.classList.add("d-none");
    tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Loading backups...</td></tr>';
    try {
      const [operations, backupResponse] = await Promise.all([
        apiRequest("/settings/operations"),
        apiRequest("/settings/backups?limit=50"),
      ]);
      if (operations?.success !== true || !operations.data) {
        throw new Error("Backup readiness could not be checked.");
      }
      if (backupResponse?.success !== true || !Array.isArray(backupResponse.data)) {
        throw new Error("Backup history could not be loaded.");
      }
      const canCreate = operations.data.backupReady === true;
      const backups = backupResponse.data;
      const latestBackup = backupResponse.latestSuccessful;
      const operationRunning = operations.data.backupInProgress === true ||
        backups.some((backup) => backup.status === "in_progress");
      const createButton = document.getElementById("createBackupBtn");
      if (createButton) createButton.dataset.ready = String(canCreate && !operationRunning);
      const backupTools = Array.isArray(operations.data.tools) ? operations.data.tools : [];
      const toolSummary = backupTools
        .map((tool) => tool.available
          ? `${tool.name} ${tool.version || "available"}`
          : `${tool.name}: ${tool.message || "unavailable"}`)
        .join(", ");
      const readinessProblems = [];
      if (operations.data.databaseConnected !== true) {
        readinessProblems.push(`MongoDB connection is ${operations.data.databaseState || "unavailable"}.`);
      }
      if (operations.data.backupDirectoryWritable !== true) {
        readinessProblems.push(operations.data.backupDirectoryError || "Protected backup storage is not writable.");
      }
      readinessProblems.push(...backupTools
        .filter((tool) => !tool.available)
        .map((tool) => `${tool.name}: ${tool.message || "unavailable"}.`));
      readiness.textContent = canCreate
        ? `MongoDB is connected. Protected backup storage is writable. Required tools: ${toolSummary}.`
        : readinessProblems.join(" ") || "Backup creation is unavailable because the database, protected storage, or MongoDB backup tools are not ready.";
      latestSuccessful.textContent = latestBackup
        ? `Latest successful backup: ${new Date(latestBackup.completedAt || latestBackup.createdAt).toLocaleString()} (${formatBackupSize(latestBackup.fileSizeBytes)}).`
        : "No successful database backup has been recorded.";
      setBackupCreateBusy(backupCreatePending);
      tableBody.innerHTML = backups.length
        ? backups.map((backup) => {
            const statusBadge = {
              in_progress: '<span class="badge text-bg-primary"><span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>In progress</span>',
              completed: '<span class="badge text-bg-success">Completed</span>',
              failed: '<span class="badge text-bg-danger">Failed</span>',
            }[backup.status] || '<span class="badge text-bg-secondary">Unknown</span>';
            const completed = backup.status === "completed" && backup.integrityVerified === true;
            return `<tr>
              <td class="font-monospace small text-break">${escapeAuditText(backup.id || "—")}</td>
              <td>${statusBadge}${backup.errorMessage ? `<div class="small text-danger mt-1">${escapeAuditText(backup.errorMessage)}</div>` : ""}</td>
              <td>${backup.backupType === "mongodump-archive" ? "Compressed MongoDB archive" : escapeAuditText(backup.backupType || "—")}</td>
              <td class="text-nowrap">${escapeAuditText(backup.createdAt ? new Date(backup.createdAt).toLocaleString() : "—")}</td>
              <td>${formatBackupSize(backup.fileSizeBytes)}</td>
              <td>${completed ? '<span class="text-success"><i class="bi bi-shield-check me-1"></i>Verified</span>' : backup.status === "in_progress" ? "Pending" : "Not verified"}</td>
              <td>${escapeAuditText(backup.createdBy || "Administrator")}</td>
              <td>${completed
                ? `<button type="button" class="btn btn-sm btn-outline-primary" data-download-backup="${escapeAuditText(backup.id)}"><i class="bi bi-download me-1"></i>Download</button>`
                : "—"}</td>
            </tr>`;
          }).join("")
        : '<tr><td colspan="8" class="text-center text-muted py-4">No database backups have been created.</td></tr>';
      tableBody.querySelectorAll("[data-download-backup]").forEach((button) => {
        button.addEventListener("click", () => void downloadBackup(button.dataset.downloadBackup, button));
      });
      if (backups.some((backup) => backup.status === "in_progress") || operations.data.backupInProgress) {
        backupRefreshTimer = setTimeout(() => void loadBackupOperations(), 2000);
      }
    } catch (error) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Backup history could not be loaded. See the error message above.</td></tr>';
      readiness.textContent = "Backup readiness could not be verified.";
      latestSuccessful.textContent = "Latest successful backup could not be checked.";
      showAlert("backupOperationsAlert", error.message || "Backup operations are unavailable.", "danger");
      const button = document.getElementById("createBackupBtn");
      if (button) button.disabled = true;
    }
  }

  async function downloadBackup(id, button) {
    if (!/^[a-f\d]{24}$/i.test(String(id || ""))) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Downloading';
    try {
      const response = await fetch(`${resolveApiBase()}/settings/backups/${encodeURIComponent(id)}/download`, {
        headers: { Accept: "application/octet-stream, application/json" },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Backup download failed (${response.status}).`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The server returned an empty backup file.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `database-backup-${id}.archive.gz`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAlert("backupOperationsAlert", "Verified backup downloaded.", "success");
    } catch (error) {
      showAlert("backupOperationsAlert", error.message || "The backup could not be downloaded.", "danger");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  document.getElementById("createBackupBtn")?.addEventListener("click", async () => {
    if (backupCreatePending) return;
    const confirmed = window.confirm("Create a compressed database backup now? This may use significant disk space and database resources.");
    if (!confirmed) return;
    setBackupCreateBusy(true);
    document.getElementById("backupOperationsAlert")?.classList.add("d-none");
    try {
      const response = await apiRequest("/settings/backups", { method: "POST", body: {} });
      if (response?.success !== true || response.data?.status !== "in_progress") {
        throw new Error(response?.message || "The server did not confirm that a backup started.");
      }
      showAlert("backupOperationsAlert", response.message || "Backup started.", "info");
      await loadBackupOperations();
      setBackupCreateBusy(false);
    } catch (error) {
      showAlert("backupOperationsAlert", error.message || "Could not start the backup.", "danger");
      setBackupCreateBusy(false);
    }
  });

  async function loadMaintenanceSettings() {
    const form = document.getElementById("maintenanceSettingsForm");
    if (!form) return;
    try {
      const response = await apiRequest("/settings/maintenance");
      if (response?.success !== true || !response.data) {
        throw new Error("Maintenance settings could not be loaded.");
      }
      document.getElementById("maintenanceModeEnabled").checked = response.data.enabled === true;
      document.getElementById("maintenanceNoticeInput").value = response.data.notice || "";
      const badge = document.getElementById("maintenanceStatusBadge");
      badge.textContent = response.data.enabled ? "Enabled" : "Disabled";
      badge.className = `badge ${response.data.enabled ? "text-bg-warning" : "text-bg-success"}`;
      const lastUpdated = document.getElementById("maintenanceLastUpdated");
      if (lastUpdated) {
        lastUpdated.textContent = response.data.updatedAt
          ? `Last changed: ${new Date(response.data.updatedAt).toLocaleString()}`
          : "No maintenance mode changes recorded.";
      }
      maintenanceLoaded = true;
      document.getElementById("saveMaintenanceBtn").disabled = false;
    } catch (error) {
      showAlert("maintenanceOperationsAlert", error.message || "Maintenance settings are unavailable.", "danger");
      document.getElementById("saveMaintenanceBtn").disabled = true;
    }
  }

  document.getElementById("maintenanceSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!maintenanceLoaded) return;
    const enabled = document.getElementById("maintenanceModeEnabled").checked;
    const notice = document.getElementById("maintenanceNoticeInput").value.trim();
    if (notice.length < 10 || notice.length > 500) {
      showAlert("maintenanceOperationsAlert", "The maintenance notice must be between 10 and 500 characters.", "warning");
      return;
    }
    const currentEnabled = document.getElementById("maintenanceStatusBadge").textContent === "Enabled";
    if (enabled !== currentEnabled && !window.confirm(`${enabled ? "Enable" : "Disable"} maintenance mode? ${enabled ? "Non-admin users will be blocked from using the system." : "Normal system access will be restored."}`)) {
      document.getElementById("maintenanceModeEnabled").checked = currentEnabled;
      return;
    }
    const button = document.getElementById("saveMaintenanceBtn");
    button.disabled = true;
    setLoading("saveMaintenanceBtn", "saveMaintenanceSpinner", true);
    document.getElementById("saveMaintenanceLabel").textContent = "Saving...";
    try {
      const response = await apiRequest("/settings/maintenance", {
        method: "PUT",
        body: { enabled, notice },
      });
      if (response?.success !== true || response.data?.enabled !== enabled) {
        throw new Error(response?.message || "Maintenance settings were not confirmed by the server.");
      }
      showAlert("maintenanceOperationsAlert", response.message || "Maintenance settings saved.", "success");
      await loadMaintenanceSettings();
    } catch (error) {
      showAlert("maintenanceOperationsAlert", error.message || "Could not save maintenance settings.", "danger");
      button.disabled = false;
    } finally {
      setLoading("saveMaintenanceBtn", "saveMaintenanceSpinner", false);
      document.getElementById("saveMaintenanceLabel").textContent = "Save Maintenance Settings";
      button.disabled = !maintenanceLoaded;
    }
  });

  async function loadSystemOverview() {
    const cards = document.getElementById("systemOverviewCards");
    if (!cards) return;
    cards.innerHTML = '<div class="col-12 text-muted" role="status">Loading system overview...</div>';
    try {
      const response = await apiRequest("/settings/overview");
      if (response?.success !== true || !response.data) throw new Error("System status is unavailable.");
      const info = response.data;
      cards.innerHTML = [
        ["Application version", info.version],
        ["Environment", info.environment],
        ["Database", info.database],
        ["Access token lifetime", `${info.authTokenLifetimeHours} hours`],
        ["Password requirements", info.passwordPolicy],
        ["Multi-factor authentication", info.multiFactorAuthentication],
      ].map(([label, value]) => `<div class="col-sm-6 col-xl-4"><div class="border rounded p-3 h-100"><div class="small text-muted mb-1">${escapeAuditText(label)}</div><div class="fw-semibold">${escapeAuditText(value)}</div></div></div>`).join("");
      const alert = document.getElementById("systemOverviewAlert");
      alert?.classList.add("d-none");
    } catch (error) {
      cards.innerHTML = "";
      showAlert("systemOverviewAlert", error.message || "Could not load system status.", "danger");
    }
  }

  async function loadSettingsAuditLog() {
    if (!auditBody) return;
    auditBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Loading audit records...</td></tr>';
    try {
      const response = await apiRequest(`/audit?page=${auditPage}&limit=20&entity=settings`);
      if (response?.success !== true || !Array.isArray(response.data)) {
        throw new Error("Audit records could not be loaded.");
      }
      auditPages = Math.max(1, Number(response.meta?.pages) || 1);
      auditBody.innerHTML = response.data.length
        ? response.data.map((entry) => `<tr>
            <td class="text-nowrap">${escapeAuditText(entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—")}</td>
            <td>${escapeAuditText(entry.user?.fullName || entry.user?.email || "Unknown")}</td>
            <td>${escapeAuditText(entry.action)}</td>
            <td class="small text-break">${escapeAuditText(entry.details || "—")}</td>
            <td><span class="badge ${entry.success ? "bg-success" : "bg-danger"}">${entry.success ? "Success" : "Failed"}</span></td>
          </tr>`).join("")
        : '<tr><td colspan="5" class="text-center text-muted py-4">No settings audit records yet.</td></tr>';
      document.getElementById("settingsAuditPageInfo").textContent =
        `Page ${auditPage} of ${auditPages} · ${response.meta?.total || 0} records`;
      document.getElementById("settingsAuditPrevBtn").disabled = auditPage <= 1;
      document.getElementById("settingsAuditNextBtn").disabled = auditPage >= auditPages;
    } catch (error) {
      auditBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${escapeAuditText(error.message || "Could not load audit records.")}</td></tr>`;
    }
  }

  document.getElementById("refreshSystemOverviewBtn")?.addEventListener("click", () => void loadSystemOverview());
  document.getElementById("refreshAuditLogBtn")?.addEventListener("click", () => void loadSettingsAuditLog());
  document.getElementById("settingsAuditPrevBtn")?.addEventListener("click", () => {
    if (auditPage > 1) { auditPage -= 1; void loadSettingsAuditLog(); }
  });
  document.getElementById("settingsAuditNextBtn")?.addEventListener("click", () => {
    if (auditPage < auditPages) { auditPage += 1; void loadSettingsAuditLog(); }
  });

  /* Bind both settings forms before waiting on auth resolution. The route
     and controller still enforce ICT Admin authorization before any write. */
  await Auth.load();
  const user = requireRole("ICT Admin");
  if (!user) return;
  passwordFormAuthorized = true;
  currentUser = Auth.getUser() || user;
  initAdminProfilePhoto();
  populateProfile(currentUser);
  populateSecurity(currentUser);
  profileFormAuthorized = true;

  attachRealTimeValidation("profileForm", [
    {
      fieldId: "profileName",
      checks: [(value) => Validators.name(value, "Full name")],
    },
    { fieldId: "profilePhone", checks: [Validators.phone] },
  ]);

  try {
    const settingsRes = await apiRequest("/settings");
    if (settingsRes.success !== true || !settingsRes.data) {
      throw new Error("The server did not return system settings.");
    }
    currentSettings = settingsRes.data;
    populateGeneralSettings(currentSettings);
    settingsLoaded = true;
    lockSettingsForms(false);
  } catch (err) {
    showToast(err?.message || "Failed to load system settings.", "danger");
    lockSettingsForms(true);
  }

  /* Attach real-time validation to password form */
  attachRealTimeValidation("changePasswordForm", [
    { fieldId: "newPassword", checks: [Validators.password] },
  ]);

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
    populateNotificationSettings(currentSettings);
    populateUserSettings(currentSettings);
    populateTechnicianSettings(currentSettings);
  }
  const notificationSound = document.getElementById("notificationSound");
  if (settingsLoaded && notificationSound && window.NotificationSound) {
    window.NotificationSound.setEnabled(notificationSound.checked);
  }
  void loadSystemOverview();
  void loadSettingsAuditLog();
  void loadBackupOperations();
  void loadMaintenanceSettings();

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
  /* ═══════════════════════════════════════════════════════
     PROFILE PHOTO — upload / image URL / remove
     Priority: upload > URL > default ADMIN image > initials
     ═══════════════════════════════════════════════════════ */
  function initAdminProfilePhoto() {
  const photoInput = document.getElementById("profilePhotoUpload");
  const uploadPhotoBtn = document.getElementById("uploadProfilePhotoBtn");
  const uploadPhotoLabel = document.getElementById("uploadProfilePhotoLabel");
  const uploadPhotoSpinner = document.getElementById(
    "uploadProfilePhotoSpinner",
  );
  const uploadPhotoIcon = document.getElementById("uploadProfilePhotoIcon");
  const cancelPhotoBtn = document.getElementById("cancelProfilePhotoBtn");
  const changePhotoBtn = document.getElementById("changeProfilePhotoBtn");
  const profilePhotoAlert = document.getElementById("profilePhotoAlert");
  const profilePhotoSelectionStatus = document.getElementById(
    "profilePhotoSelectionStatus",
  );
  const removeBtn = document.getElementById("removeProfilePhotoBtn");
  const profilePhotoMimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const maxProfilePhotoSize = 1.5 * 1024 * 1024;
  let selectedProfilePhoto = null;
  let profilePhotoPreviewUrl = null;
  let profilePhotoUploading = false;
  let profilePhotoSelectionId = 0;

  function syncProfilePhotoControls() {
    const busy = profilePhotoUploading;
    if (photoInput) photoInput.disabled = busy;
    if (changePhotoBtn) changePhotoBtn.disabled = busy;
    if (removeBtn) {
      removeBtn.disabled = busy || !currentUser?.profileImage;
    }
    if (uploadPhotoBtn) {
      uploadPhotoBtn.disabled = busy || !selectedProfilePhoto;
    }
    if (cancelPhotoBtn) cancelPhotoBtn.disabled = busy;
  }

  function showProfilePhotoAlert(message, type = "danger") {
    if (!profilePhotoAlert) return;
    profilePhotoAlert.className = `alert alert-${type} mt-2 mb-0`;
    profilePhotoAlert.textContent = message;
    profilePhotoAlert.classList.remove("d-none");
  }

  function clearProfilePhotoAlert() {
    profilePhotoAlert?.classList.add("d-none");
  }

  function releaseProfilePhotoPreview() {
    if (profilePhotoPreviewUrl) {
      URL.revokeObjectURL(profilePhotoPreviewUrl);
      profilePhotoPreviewUrl = null;
    }
  }

  window.addEventListener("pagehide", releaseProfilePhotoPreview, {
    once: true,
  });

  function resetProfilePhotoSelection() {
    profilePhotoSelectionId += 1;
    selectedProfilePhoto = null;
    if (photoInput) photoInput.value = "";
    releaseProfilePhotoPreview();
    cancelPhotoBtn?.classList.add("d-none");
    if (profilePhotoSelectionStatus) {
      profilePhotoSelectionStatus.hidden = true;
      profilePhotoSelectionStatus.textContent = "";
    }
    applyProfileAvatar(currentUser, document.getElementById("profileAvatar"));
    syncProfilePhotoControls();
  }

  function hasProfilePhotoSignature(bytes, mimeType) {
    if (mimeType === "image/jpeg") {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[2] === 0xff;
    }
    if (mimeType === "image/png") {
      return (
        bytes.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
          (byte, index) => bytes[index] === byte,
        )
      );
    }
    if (mimeType === "image/webp") {
      return (
        bytes.length >= 12 &&
        String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
      );
    }
    return false;
  }

  changePhotoBtn?.addEventListener("click", () => {
    if (!profilePhotoUploading) photoInput?.click();
  });

  photoInput?.addEventListener("change", async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;

    const extension = file.name
      .slice(file.name.lastIndexOf("."))
      .toLowerCase();
    if (profilePhotoMimeTypes[extension] !== file.type) {
      resetProfilePhotoSelection();
      showProfilePhotoAlert("Choose a JPG, JPEG, PNG, or WEBP image.", "warning");
      return;
    }
    if (file.size > maxProfilePhotoSize) {
      resetProfilePhotoSelection();
      showProfilePhotoAlert("Profile photo must be 1.5 MB or smaller.", "warning");
      return;
    }

    selectedProfilePhoto = null;
    syncProfilePhotoControls();
    const selectionId = ++profilePhotoSelectionId;
    clearProfilePhotoAlert();
    let signatureValid = false;
    try {
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      signatureValid = hasProfilePhotoSignature(
        bytes,
        profilePhotoMimeTypes[extension],
      );
    } catch (error) {
      resetProfilePhotoSelection();
      showProfilePhotoAlert("Could not validate the selected image file.");
      return;
    }
    if (
      selectionId !== profilePhotoSelectionId ||
      photoInput.files?.[0] !== file
    ) {
      return;
    }
    if (!signatureValid) {
      resetProfilePhotoSelection();
      showProfilePhotoAlert(
        "The selected file does not contain a valid image signature.",
        "warning",
      );
      return;
    }

    selectedProfilePhoto = file;
    releaseProfilePhotoPreview();
    profilePhotoPreviewUrl = URL.createObjectURL(file);
    const avatar = document.getElementById("profileAvatar");
    const avatarImage = avatar?.querySelector(".profile-avatar-image");
    const avatarInitials = avatar?.querySelector(".profile-avatar-initials");
    if (avatarImage && avatarInitials) {
      avatarImage.src = profilePhotoPreviewUrl;
      avatarImage.hidden = false;
      avatarInitials.hidden = true;
    }
    if (profilePhotoSelectionStatus) {
      profilePhotoSelectionStatus.textContent = `${file.name} selected. Preview is not saved until you choose Save Photo.`;
      profilePhotoSelectionStatus.hidden = false;
    }
    cancelPhotoBtn?.classList.remove("d-none");
    syncProfilePhotoControls();
  });

  uploadPhotoBtn?.addEventListener("click", async () => {
    if (profilePhotoUploading) return;
    if (!selectedProfilePhoto) {
      showProfilePhotoAlert("Choose a profile photo before saving.", "warning");
      return;
    }

    profilePhotoUploading = true;
    uploadPhotoBtn.setAttribute("aria-busy", "true");
    syncProfilePhotoControls();
    if (uploadPhotoLabel) uploadPhotoLabel.textContent = "Saving photo...";
    uploadPhotoSpinner?.classList.remove("d-none");
    uploadPhotoIcon?.classList.add("d-none");
    clearProfilePhotoAlert();
    try {
      const formData = new FormData();
      formData.append("profileImage", selectedProfilePhoto);
      const response = await apiRequest("/users/profile-image", {
        method: "POST",
        body: formData,
        isFormData: true,
      });
      const savedProfileImage = response.data?.profileImage;
      if (
        response.success !== true ||
        typeof savedProfileImage !== "string" ||
        !savedProfileImage
      ) {
        throw new Error("The server did not confirm the profile photo upload.");
      }

      currentUser = {
        ...currentUser,
        ...(response.data.user || {}),
        profileImage: savedProfileImage,
      };
      Auth.setUser(currentUser);
      applyProfileAvatar(currentUser, document.getElementById("profileAvatar"));
      populateUserInfo();
      resetProfilePhotoSelection();
      showProfilePhotoAlert("Profile photo updated successfully!", "success");
      showToast("Profile photo updated successfully!", "success");
    } catch (err) {
      const message =
        err?.message || "Could not save the profile photo. Please try again.";
      showProfilePhotoAlert(message);
      showToast(message, "danger");
    } finally {
      profilePhotoUploading = false;
      uploadPhotoBtn.setAttribute("aria-busy", "false");
      syncProfilePhotoControls();
      if (uploadPhotoLabel) uploadPhotoLabel.textContent = "Save Photo";
      uploadPhotoSpinner?.classList.add("d-none");
      uploadPhotoIcon?.classList.remove("d-none");
    }
  });

  cancelPhotoBtn?.addEventListener("click", () => {
    resetProfilePhotoSelection();
    clearProfilePhotoAlert();
  });

  const removePhotoModalElement = document.getElementById(
    "removeProfilePhotoModal",
  );
  const removePhotoModal =
    removePhotoModalElement && typeof bootstrap !== "undefined"
      ? bootstrap.Modal.getOrCreateInstance(removePhotoModalElement)
      : null;
  const confirmRemovePhotoBtn = document.getElementById(
    "confirmRemoveProfilePhotoBtn",
  );
  const removePhotoSpinner = document.getElementById(
    "removeProfilePhotoSpinner",
  );
  const removePhotoLabel = document.getElementById("removeProfilePhotoLabel");
  const closeRemovePhotoBtn = document.getElementById(
    "closeRemoveProfilePhotoModalBtn",
  );
  const cancelRemovePhotoBtn = document.getElementById(
    "cancelRemoveProfilePhotoBtn",
  );

  syncProfilePhotoControls();

  removeBtn?.addEventListener("click", () => {
    if (profilePhotoUploading || !currentUser?.profileImage) return;
    if (removePhotoModal) {
      removePhotoModal.show();
      return;
    }
    if (
      window.confirm(
        "Remove your custom profile photo and restore the default ADMIN image?",
      )
    ) {
      confirmRemovePhotoBtn?.click();
    }
  });

  confirmRemovePhotoBtn?.addEventListener("click", async () => {
    if (profilePhotoUploading || !currentUser?.profileImage) return;
    profilePhotoUploading = true;
    syncProfilePhotoControls();
    confirmRemovePhotoBtn.disabled = true;
    confirmRemovePhotoBtn.setAttribute("aria-busy", "true");
    if (closeRemovePhotoBtn) closeRemovePhotoBtn.disabled = true;
    if (cancelRemovePhotoBtn) cancelRemovePhotoBtn.disabled = true;
    removePhotoSpinner?.classList.remove("d-none");
    if (removePhotoLabel) removePhotoLabel.textContent = "Removing photo...";
    clearProfilePhotoAlert();
    try {
      const response = await apiRequest("/users/profile-image", {
        method: "DELETE",
      });
      if (response.success !== true || response.data?.profileImage !== null) {
        throw new Error("The server did not confirm profile photo removal.");
      }

      currentUser = { ...currentUser, profileImage: null };
      Auth.setUser(currentUser);
      selectedProfilePhoto = null;
      resetProfilePhotoSelection();
      applyProfileAvatar(currentUser, document.getElementById("profileAvatar"));
      populateUserInfo();
      showProfilePhotoAlert(
        "Custom profile photo removed. The default ADMIN photo is now in use.",
        "success",
      );
      showToast("Custom profile photo removed successfully.", "success");
    } catch (err) {
      const message =
        err?.message || "Failed to remove profile photo. Please try again.";
      showProfilePhotoAlert(message);
      showToast(message, "danger");
    } finally {
      profilePhotoUploading = false;
      confirmRemovePhotoBtn.disabled = false;
      confirmRemovePhotoBtn.setAttribute("aria-busy", "false");
      if (closeRemovePhotoBtn) closeRemovePhotoBtn.disabled = false;
      if (cancelRemovePhotoBtn) cancelRemovePhotoBtn.disabled = false;
      removePhotoSpinner?.classList.add("d-none");
      if (removePhotoLabel) removePhotoLabel.textContent = "Remove Photo";
      syncProfilePhotoControls();
      removePhotoModal?.hide();
    }
  });
  }

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

  const photoInput = document.getElementById("profilePhotoInput");
  const photoAvatar = document.getElementById("profileSettingsAvatar");
  const photoPreview = document.getElementById("profilePhotoPreview");
  const photoPreviewImage = document.getElementById("profilePhotoPreviewImage");
  const photoSaveButton = document.getElementById("saveProfilePhotoBtn");
  const photoCancelButton = document.getElementById("cancelProfilePhotoBtn");
  const photoChooseLabel = document.getElementById("profilePhotoChooseLabel");
  const fileInput = document.getElementById("profileFileInput");
  const filePreview = document.getElementById("profileFilePreview");
  const fileUploadButton = document.getElementById("uploadProfileFileBtn");
  let selectedPhoto = null;
  let photoPreviewUrl = null;
  let selectedProfileFile = null;

  const showUploadAlert = (id, message, type = "danger") => {
    const alert = document.getElementById(id);
    if (!alert) return;
    alert.className = `alert alert-${type} mt-2 mb-0`;
    alert.textContent = message;
    alert.classList.remove("d-none");
  };
  const clearUploadAlert = (id) =>
    document.getElementById(id)?.classList.add("d-none");
  const formatFileSize = (size) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };
  const extensionOf = (name) => name.split(".").pop().toLowerCase();
  const photoMimeByExtension = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const fileMimeByExtension = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };

  const resetPhotoSelection = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
    selectedPhoto = null;
    if (photoInput) photoInput.value = "";
    photoPreview?.classList.add("d-none");
    photoSaveButton?.classList.add("d-none");
    photoCancelButton?.classList.add("d-none");
    if (photoSaveButton) photoSaveButton.disabled = false;
    if (photoAvatar) applyProfileAvatar(Auth.getUser(), photoAvatar);
  };

  photoInput?.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    clearUploadAlert("profilePhotoAlert");
    const extension = extensionOf(file.name);
    if (
      !Object.hasOwn(photoMimeByExtension, extension) ||
      file.type !== photoMimeByExtension[extension]
    ) {
      resetPhotoSelection();
      showUploadAlert(
        "profilePhotoAlert",
        "Choose a JPG, JPEG, PNG, or WEBP image.",
      );
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      resetPhotoSelection();
      showUploadAlert(
        "profilePhotoAlert",
        "The selected photo exceeds the 1.5 MB limit.",
      );
      return;
    }
    selectedPhoto = file;
    photoPreviewUrl = URL.createObjectURL(file);
    photoPreviewImage.src = photoPreviewUrl;
    document.getElementById("profilePhotoPreviewName").textContent = file.name;
    photoPreview.classList.remove("d-none");
    photoPreview.classList.add("d-flex");
    const avatarImage = photoAvatar?.querySelector(".profile-avatar-image");
    const avatarInitial = photoAvatar?.querySelector(
      ".profile-avatar-initials",
    );
    if (avatarImage) {
      avatarImage.src = photoPreviewUrl;
      avatarImage.hidden = false;
    }
    if (avatarInitial) avatarInitial.hidden = true;
    photoSaveButton?.classList.remove("d-none");
    photoCancelButton?.classList.remove("d-none");
  });

  photoCancelButton?.addEventListener("click", () => {
    resetPhotoSelection();
    clearUploadAlert("profilePhotoAlert");
  });

  photoSaveButton?.addEventListener("click", async () => {
    if (!selectedPhoto) return;
    photoSaveButton.disabled = true;
    document
      .getElementById("saveProfilePhotoSpinner")
      ?.classList.remove("d-none");
    clearUploadAlert("profilePhotoAlert");
    try {
      const formData = new FormData();
      formData.append("profileImage", selectedPhoto);
      const { data } = await apiRequest("/users/profile-image", {
        method: "POST",
        body: formData,
        isFormData: true,
      });
      if (!data?.profileImage) {
        throw new Error("Profile photo upload returned no saved image.");
      }
      const updatedUser = await Auth.refresh();
      if (updatedUser.profileImage !== data.data.profileImage) {
        throw new Error("The saved profile photo could not be reloaded.");
      }
      applyProfileAvatar(updatedUser, photoAvatar);
      if (typeof populateUserInfo === "function") populateUserInfo();
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      photoPreviewUrl = null;
      selectedPhoto = null;
      photoInput.value = "";
      photoPreview?.classList.add("d-none");
      photoSaveButton.classList.add("d-none");
      photoCancelButton.classList.add("d-none");
      photoChooseLabel.textContent = "Change Photo";
      showUploadAlert(
        "profilePhotoAlert",
        "Profile photo updated successfully.",
        "success",
      );
    } catch (error) {
      showUploadAlert(
        "profilePhotoAlert",
        error.message || "Could not upload the profile photo.",
      );
    } finally {
      photoSaveButton.disabled = false;
      document
        .getElementById("saveProfilePhotoSpinner")
        ?.classList.add("d-none");
    }
  });

  const resetProfileFileSelection = () => {
    selectedProfileFile = null;
    if (fileInput) fileInput.value = "";
    filePreview?.classList.add("d-none");
    if (fileUploadButton) fileUploadButton.disabled = false;
  };

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    clearUploadAlert("profileFileAlert");
    const extension = extensionOf(file.name);
    if (
      !Object.hasOwn(fileMimeByExtension, extension) ||
      file.type !== fileMimeByExtension[extension]
    ) {
      resetProfileFileSelection();
      showUploadAlert(
        "profileFileAlert",
        "Choose a PDF, DOC, DOCX, JPG, JPEG, or PNG file.",
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      resetProfileFileSelection();
      showUploadAlert(
        "profileFileAlert",
        "The selected file exceeds the 10 MB limit.",
      );
      return;
    }
    selectedProfileFile = file;
    document.getElementById("profileFilePreviewName").textContent = file.name;
    document.getElementById("profileFilePreviewType").textContent =
      file.type || extension.toUpperCase();
    document.getElementById("profileFilePreviewSize").textContent =
      formatFileSize(file.size);
    filePreview.classList.remove("d-none");
  });

  document
    .getElementById("cancelProfileFileBtn")
    ?.addEventListener("click", () => {
      resetProfileFileSelection();
      clearUploadAlert("profileFileAlert");
    });

  const loadProfileFiles = async () => {
    const loading = document.getElementById("profileFileLoading");
    const list = document.getElementById("profileFileList");
    const empty = document.getElementById("profileFileEmpty");
    loading?.classList.remove("d-none");
    try {
      const { data = [] } = await apiRequest("/users/profile/files");
      list.replaceChildren();
      empty?.classList.toggle("d-none", data.length > 0);
      data.forEach((file) => {
        const item = document.createElement("div");
        item.className = "list-group-item px-0 py-3";
        const row = document.createElement("div");
        row.className =
          "d-flex flex-wrap justify-content-between align-items-center gap-3";
        const details = document.createElement("div");
        details.className = "min-w-0";
        const name = document.createElement("div");
        name.className = "fw-semibold text-break";
        name.textContent = file.originalName;
        const metadata = document.createElement("div");
        metadata.className = "text-muted small";
        const uploadedAt = new Date(file.uploadedAt);
        metadata.textContent = `${file.mimeType} · ${formatFileSize(file.size)} · ${Number.isNaN(uploadedAt.getTime()) ? "" : uploadedAt.toLocaleDateString()}`;
        details.append(name, metadata);
        const actions = document.createElement("div");
        actions.className = "d-flex gap-2 flex-shrink-0";
        const download = document.createElement("button");
        download.type = "button";
        download.className = "btn btn-outline-primary btn-sm";
        download.innerHTML = '<i class="bi bi-download me-1"></i>Download';
        download.addEventListener("click", () => downloadProfileFile(file));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-outline-danger btn-sm";
        remove.innerHTML = '<i class="bi bi-trash me-1"></i>Delete';
        remove.addEventListener("click", () => deleteProfileFile(file, remove));
        actions.append(download, remove);
        row.append(details, actions);
        item.append(row);
        list.append(item);
      });
    } catch (error) {
      showUploadAlert(
        "profileFileAlert",
        error.message || "Could not load profile files.",
      );
    } finally {
      loading?.classList.add("d-none");
    }
  };

  const downloadProfileFile = async (file) => {
    try {
      const response = await fetch(
        `${resolveApiBase()}/users/profile/files/${encodeURIComponent(file.id)}`,
        {
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Could not download this file.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.originalName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showUploadAlert(
        "profileFileAlert",
        error.message || "Could not download this file.",
      );
    }
  };

  const deleteProfileFile = async (file, button) => {
    if (!window.confirm(`Delete ${file.originalName}?`)) return;
    button.disabled = true;
    try {
      await apiRequest(`/users/profile/files/${encodeURIComponent(file.id)}`, {
        method: "DELETE",
      });
      showUploadAlert(
        "profileFileAlert",
        "File deleted successfully.",
        "success",
      );
      await loadProfileFiles();
    } catch (error) {
      button.disabled = false;
      showUploadAlert(
        "profileFileAlert",
        error.message || "Could not delete this file.",
      );
    }
  };

  fileUploadButton?.addEventListener("click", async () => {
    if (!selectedProfileFile) return;
    fileUploadButton.disabled = true;
    document
      .getElementById("uploadProfileFileSpinner")
      ?.classList.remove("d-none");
    clearUploadAlert("profileFileAlert");
    try {
      const formData = new FormData();
      formData.append("file", selectedProfileFile);
      await apiRequest("/users/profile/files", {
        method: "POST",
        body: formData,
        isFormData: true,
      });
      resetProfileFileSelection();
      showUploadAlert(
        "profileFileAlert",
        "File uploaded successfully.",
        "success",
      );
      await loadProfileFiles();
    } catch (error) {
      showUploadAlert(
        "profileFileAlert",
        error.message || "Could not upload this file.",
      );
    } finally {
      fileUploadButton.disabled = false;
      document
        .getElementById("uploadProfileFileSpinner")
        ?.classList.add("d-none");
    }
  });

  const signedInUser = Auth.getUser() || user;
  if (photoAvatar) applyProfileAvatar(signedInUser, photoAvatar);
  if (signedInUser.profileImage && photoChooseLabel) {
    photoChooseLabel.textContent = "Change Photo";
  }
  loadProfileFiles();

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
    const submittedProfile = readProfile();
    const saveButton = document.getElementById("saveProfileBtn");
    const spinner = document.getElementById("profileSpinner");
    saveButton.disabled = true;
    spinner.classList.remove("d-none");
    clearFormAlert("profileAlert");
    try {
      const result = await apiRequest("/users/profile", {
        method: "PUT",
        body: submittedProfile,
      });
      if (result.success !== true || !result.data) {
        throw new Error("The server did not confirm the saved profile.");
      }
      const updatedUser = await Auth.refresh();
      if (
        updatedUser.fullName !== submittedProfile.fullName ||
        (updatedUser.phone || "") !== submittedProfile.phone ||
        (updatedUser.department || "") !== submittedProfile.department ||
        (updatedUser.gender || "") !== submittedProfile.gender
      ) {
        throw new Error("The saved profile could not be reloaded.");
      }
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

  /* Identity fields depend only on the already-loaded authenticated user, never on a
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
    ?.addEventListener("click", () => {
      void logout();
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
