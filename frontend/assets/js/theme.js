/* ============================================================
   theme.js — Global Light / Dark Theme Utility (shared)
   DBU ICT Maintenance Request & Tracking System

   Single source of truth for the application-wide theme.
   Exposes: getTheme, setTheme, toggleTheme, initTheme.

   Persistence: localStorage['theme'] = 'light' | 'dark'
   Marker:      <html data-theme="dark"> (absence = light)
   ============================================================ */

const THEME_STORAGE_KEY = 'theme';

function getTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'light';
}

/* Apply the theme to <html>, persist when asked, and sync any
   switcher controls already present in the DOM. */
function applyTheme(theme, save) {
  const value = theme === 'dark' ? 'dark' : 'light';
  if (value === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  if (save) localStorage.setItem(THEME_STORAGE_KEY, value);
  syncThemeSwitchers(value);
}

function setTheme(theme) {
  applyTheme(theme, true);
}

function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

/* Reflect the current theme on every [data-theme-switch] control. */
function syncThemeSwitchers(theme) {
  const isDark = theme === 'dark';
  document.querySelectorAll('[data-theme-switch]').forEach((btn) => {
    btn.setAttribute('aria-pressed', isDark ? 'false' : 'true');
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    const sun = btn.querySelector('.theme-sun');
    const moon = btn.querySelector('.theme-moon');
    if (sun) sun.style.display = isDark ? 'inline' : 'none';
    if (moon) moon.style.display = isDark ? 'none' : 'inline';
  });
  document.querySelectorAll('[data-theme-radio]').forEach((radio) => {
    if (radio.value === (isDark ? 'dark' : 'light')) radio.checked = true;
  });
}

/* Build a single switcher control and return it. */
function buildThemeSwitch(onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-theme-switch';
  btn.setAttribute('data-theme-switch', '');
  btn.setAttribute('aria-label', 'Switch theme');
  btn.innerHTML =
    '<i class="bi bi-sun-fill theme-sun" style="display:none;"></i>' +
    '<i class="bi bi-moon-stars-fill theme-moon"></i>';
  btn.addEventListener('click', onClick);
  return btn;
}

/* Inject the switcher into the page at the best available spot. */
function injectThemeSwitch() {
  if (document.querySelector('.app-theme-switch')) return; // already present

  const topbar = document.querySelector('.topbar');
  if (topbar) {
    // Dashboard / role pages: add to the topbar's right-hand controls.
    const btn = buildThemeSwitch(toggleTheme);
    btn.classList.add('app-theme-in-topbar');
    // Prefer an existing right-aligned action cluster, else append to topbar.
    const cluster =
      topbar.querySelector('.d-flex.gap-3 > *')?.parentElement ||
      topbar.querySelector('.d-flex.align-items-center.gap-3') ||
      topbar.querySelector('.d-flex.justify-content-between > div:last-child') ||
      topbar;
    cluster.appendChild(btn);
    return;
  }

  const mainNavbar = document.getElementById('mainNavbar');
  if (mainNavbar) {
    // Landing page: add to the navbar's action cluster (Login/Register) on the
    // right, or inside the nav menu. Avoid matching the .navbar-brand (it shares
    // some utility classes), so scope to the nav menu / collapse region.
    const btn = buildThemeSwitch(toggleTheme);
    btn.classList.add('app-theme-in-navbar');
    const actions =
      mainNavbar.querySelector('#navMenu .d-flex.align-items-center.gap-2') ||
      mainNavbar.querySelector('#navMenu') ||
      mainNavbar.querySelector('.navbar-collapse');
    if (actions) {
      actions.appendChild(btn);
    } else {
      const container = mainNavbar.querySelector('.container') || mainNavbar;
      container.appendChild(btn);
    }
    return;
  }

  // Public / auth pages (login, register): floating top-right.
  const btn = buildThemeSwitch(toggleTheme);
  btn.classList.add('app-theme-float');
  document.body.appendChild(btn);
}

/* Bind existing or newly injected switcher controls. */
function bindThemeSwitchers() {
  document.querySelectorAll('[data-theme-switch]').forEach((btn) => {
    if (btn.dataset.themeBound) return;
    btn.dataset.themeBound = '1';
    btn.addEventListener('click', toggleTheme);
  });
}

/* Initialise: apply the persisted theme and set up controls. */
function initTheme() {
  const theme = getTheme();
  applyTheme(theme, false);
  injectThemeSwitch();
  syncThemeSwitchers(theme); /* sync freshly-injected switch icons to saved theme */
  bindThemeSwitchers();
}

if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initTheme);
}
