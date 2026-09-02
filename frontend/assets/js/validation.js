/* ============================================================
   validation.js — Shared Frontend Validation Utilities
    Smart Computer Maintenance Service Request and Tracking System
   
   Mirrors backend/middleware/validation.js rules.
   Provides inline field validation, error display, and
   form-level orchestration.
   ============================================================ */

/* ── Regex Constants ─────────────────────────────────────── */
const VAL = {
  PASSWORD_REGEX: /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,100}$/,
  EMAIL_REGEX:    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_REGEX:    /^\+?[\d\s\-()]{7,20}$/,
  NAME_REGEX:     /^[\p{L}\s.'-]{2,100}$/u,
};

/* ── Validators (return error message or null) ───────────── */
const Validators = {
  required(value, fieldName) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return `${fieldName} is required.`;
    }
    return null;
  },

  email(value) {
    if (!value || typeof value !== 'string') return 'Email is required.';
    const trimmed = value.trim();
    if (trimmed.length > 254) return 'Email is too long.';
    if (!VAL.EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address.';
    return null;
  },

  password(value) {
    if (!value || typeof value !== 'string') return 'Password is required.';
    if (value.length < 8) return 'Password must be at least 8 characters, contain both letters and numbers, and may include special characters.';
    if (!VAL.PASSWORD_REGEX.test(value)) return 'Password must be at least 8 characters (max 100), contain both letters and numbers, and may include special characters (no spaces).';
    return null;
  },

  passwordMatch(password, confirm) {
    if (!confirm) return 'Please confirm your password.';
    if (password !== confirm) return 'Passwords do not match.';
    return null;
  },

  name(value, fieldName = 'Name') {
    if (!value || typeof value !== 'string') return `${fieldName} is required.`;
    const trimmed = value.trim();
    if (trimmed.length < 2) return `${fieldName} must be at least 2 characters.`;
    return null;
  },

  phone(value) {
    if (!value || value.trim() === '') return null;
    if (!VAL.PHONE_REGEX.test(value.trim())) return 'Please enter a valid phone number.';
    return null;
  },

  minLength(value, fieldName, min) {
    if (!value || typeof value !== 'string') return null;
    if (value.trim().length < min) return `${fieldName} must be at least ${min} characters.`;
    return null;
  },

  maxLength(value, fieldName, max) {
    if (!value || typeof value !== 'string') return null;
    if (value.trim().length > max) return `${fieldName} must be no more than ${max} characters.`;
    return null;
  },

  length(value, fieldName, min, max) {
    const lenErr = Validators.minLength(value, fieldName, min);
    if (lenErr) return lenErr;
    return Validators.maxLength(value, fieldName, max);
  },
};

/* ── Field Error Display ─────────────────────────────────── */

/**
 * Show an error below a field
 * @param {string} fieldId - The input element ID
 * @param {string} message - Error message
 */
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  field.classList.add('is-invalid');
  field.classList.remove('is-valid');

  let feedback = field.parentNode.querySelector('.invalid-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.className = 'invalid-feedback';
    field.parentNode.appendChild(feedback);
  }
  feedback.textContent = message;
}

/**
 * Mark a field as valid
 * @param {string} fieldId - The input element ID
 */
function showFieldValid(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  field.classList.remove('is-invalid');
  field.classList.add('is-valid');
}

/**
 * Clear validation state from a field
 * @param {string} fieldId - The input element ID
 */
function clearFieldValidation(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  field.classList.remove('is-invalid', 'is-valid');
  const feedback = field.parentNode.querySelector('.invalid-feedback');
  if (feedback) feedback.remove();
}

/**
 * Clear all validation states in a container
 * @param {string} containerId - Container element ID (or form ID)
 */
function clearAllFieldValidations(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll('.is-invalid, .is-valid').forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });
  container.querySelectorAll('.invalid-feedback').forEach(el => el.remove());
}

/* ── Form Validation Orchestrator ────────────────────────── */

/**
 * Validate a form's fields and show errors inline.
 * @param {Array} validations - Array of { fieldId, value, checks: [fn, fn, ...] }
 * @returns {boolean} - true if all valid
 */
function validateFormFields(validations) {
  let allValid = true;

  validations.forEach(({ fieldId, value, checks }) => {
    let fieldError = null;
    for (const check of checks) {
      const err = check(value);
      if (err) {
        fieldError = err;
        break;
      }
    }

    if (fieldError) {
      showFieldError(fieldId, fieldError);
      allValid = false;
    } else {
      showFieldValid(fieldId);
    }
  });

  return allValid;
}

/**
 * Attach real-time validation (on blur + input) to form fields.
 * @param {string} formId - The form element ID
 * @param {Array} rules - Array of { fieldId, checks: [fn, fn, ...] }
 */
function attachRealTimeValidation(formId, rules) {
  const form = document.getElementById(formId);
  if (!form) return;

  rules.forEach(({ fieldId, checks }) => {
    const field = document.getElementById(fieldId);
    if (!field) return;

    const validate = () => {
      const value = field.value;
      let fieldError = null;
      for (const check of checks) {
        const err = check(value);
        if (err) {
          fieldError = err;
          break;
        }
      }

      if (fieldError) {
        showFieldError(fieldId, fieldError);
      } else {
        clearFieldValidation(fieldId);
        if (value.trim() !== '') showFieldValid(fieldId);
      }
    };

    field.addEventListener('blur', validate);
    field.addEventListener('input', () => {
      if (field.classList.contains('is-invalid')) validate();
    });
  });
}

/* ── Submit Button Helpers ───────────────────────────────── */

/**
 * Set loading state on a submit button
 * @param {string} btnId - Button element ID
 * @param {string} spinnerId - Spinner element ID
 * @param {boolean} isLoading
 */
function setSubmitLoading(btnId, spinnerId, isLoading) {
  const btn = document.getElementById(btnId);
  const sp  = document.getElementById(spinnerId);
  if (btn) btn.disabled = isLoading;
  if (sp)  sp.classList.toggle('d-none', !isLoading);
}

/* ── Common Rule Sets ────────────────────────────────────── */
const CommonRules = {
  fullName: { fieldId: 'fullName', checks: [v => Validators.name(v, 'Full name')] },
  email:    { fieldId: 'email',    checks: [Validators.email] },
  password: { fieldId: 'password', checks: [Validators.password] },
  phone:    { fieldId: 'phone',    checks: [Validators.phone] },
  description: { fieldId: 'description', checks: [
    v => Validators.required(v, 'Description'),
    v => Validators.minLength(v, 'Description', 5),
  ]},
};

/* Make available globally */
window.VAL = VAL;
window.Validators = Validators;
window.showFieldError = showFieldError;
window.showFieldValid = showFieldValid;
window.clearFieldValidation = clearFieldValidation;
window.clearAllFieldValidations = clearAllFieldValidations;
window.validateFormFields = validateFormFields;
window.attachRealTimeValidation = attachRealTimeValidation;
window.setSubmitLoading = setSubmitLoading;
window.CommonRules = CommonRules;
