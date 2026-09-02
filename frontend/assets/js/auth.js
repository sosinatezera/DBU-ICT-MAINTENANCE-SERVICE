/* ============================================================
   auth.js — Login & Registration Logic
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  if (Auth.isLoggedIn()) {
    redirectByRole(Auth.getUser().role);
    return;
  }
  initLoginForm();
  initRegisterForm();
  initPasswordToggle();
  initConfirmPasswordCheck();
});

function redirectByRole(role) {
  const routes = {
    'ICT Admin':  '/views/admin/dashboard.html',
    'Requester':  '/views/user/dashboard.html',
    'Technician': '/views/technician/dashboard.html',
  };
  window.location.href = routes[role] || '/views/login.html';
}

/* ── Login Form ─────────────────────────────────────────────── */
function initLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.classList.remove('was-validated');

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      form.classList.add('was-validated');
      return;
    }

    setLoading('loginBtn', 'loginSpinner', true);
    hideAlert('loginAlert');

    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body:   { email, password },
      });

      Auth.setToken(data.token);
      Auth.setUser(data.user);

      // Show success then redirect
      showAlert('loginAlert', `Welcome back, ${data.user.fullName}! Redirecting...`, 'success');
      setTimeout(() => window.location.href = data.redirect || redirectByRole(data.user.role), 1000);

    } catch (err) {
      const msg = err.message || 'Login failed.';
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
        showAlert('loginAlert', 'Cannot connect to server. Make sure the backend is running on port 5000.', 'warning');
      } else {
        showAlert('loginAlert', msg, 'danger');
      }
    } finally {
      setLoading('loginBtn', 'loginSpinner', false);
    }
  });
}

/* ── Register Form ──────────────────────────────────────────── */
function initRegisterForm() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('registerAlert');

    const name            = document.getElementById('name').value.trim();
    const email           = document.getElementById('email').value.trim();
    const department      = document.getElementById('department').value.trim();
    const phone           = document.getElementById('phone').value.trim();
    const password        = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const agreeTerms      = document.getElementById('agreeTerms').checked;

    // Validate
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }

    if (password !== confirmPassword) {
      const cfEl = document.getElementById('confirmPassword');
      const cfFb = document.getElementById('confirmPasswordFeedback');
      cfEl.classList.add('is-invalid');
      if (cfFb) cfFb.textContent = 'Passwords do not match.';
      return;
    }

    if (!agreeTerms) {
      form.classList.add('was-validated');
      return;
    }

    setLoading('registerBtn', 'registerSpinner', true);

    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body:   { fullName: name, email, password, confirmPassword, department, phone },
      });

      showAlert('registerAlert', '✓ Account created successfully! Redirecting to login...', 'success');
      form.reset();
      setTimeout(() => { window.location.href = '/views/login.html'; }, 2500);

    } catch (err) {
      const msg = err.message || 'Registration failed.';
      if (msg.includes('fetch') || msg.includes('Failed')) {
        showAlert('registerAlert', 'Cannot connect to server. Make sure the backend is running on port 5000.', 'warning');
      } else {
        showAlert('registerAlert', msg, 'danger');
      }
    } finally {
      setLoading('registerBtn', 'registerSpinner', false);
    }
  });
}

/* ── Confirm Password Live Check ────────────────────────────── */
function initConfirmPasswordCheck() {
  const pwd     = document.getElementById('password');
  const confirm = document.getElementById('confirmPassword');
  if (!pwd || !confirm) return;

  confirm.addEventListener('input', () => {
    if (confirm.value && pwd.value !== confirm.value) {
      confirm.classList.add('is-invalid');
      confirm.classList.remove('is-valid');
    } else if (confirm.value) {
      confirm.classList.remove('is-invalid');
      confirm.classList.add('is-valid');
    }
  });
}

/* ── Password Visibility Toggle ─────────────────────────────── */
function initPasswordToggle() {
  const toggleBtn = document.getElementById('togglePassword');
  const pwdInput  = document.getElementById('password');
  const eyeIcon   = document.getElementById('eyeIcon');
  if (!toggleBtn || !pwdInput) return;

  toggleBtn.addEventListener('click', () => {
    const show        = pwdInput.type === 'password';
    pwdInput.type     = show ? 'text' : 'password';
    eyeIcon.className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
    toggleBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

/* ── Hide Alert Helper ───────────────────────────────────────── */
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('d-none');
}
