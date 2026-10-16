/* ============================================================
   theme.js — Global Light / Dark Theme Utility (shared)
   MAU ICT Maintenance Management System

   Single source of truth for the application-wide theme.
   Exposes: getTheme, setTheme, toggleTheme, initTheme.

   Persistence: role-specific dashboard keys, or localStorage['theme']
                on public and Admin pages.
   Marker:      <html data-theme="dark"> (absence = light)
   ============================================================ */

const THEME_STORAGE_KEY = "theme";

function getThemeStorageKey() {
  const path = window.location.pathname;
  if (/^\/views\/user\//i.test(path)) return "theme:requester";
  if (/^\/views\/technician\//i.test(path)) return "theme:technician";
  return THEME_STORAGE_KEY;
}

function getExplicitStoredTheme() {
  try {
    const theme = localStorage.getItem(getThemeStorageKey());
    return theme === "dark" || theme === "light" ? theme : null;
  } catch (_) {
    return null;
  }
}

function getStoredTheme() {
  const savedTheme = getExplicitStoredTheme();
  if (savedTheme) return savedTheme;

  const storageKey = getThemeStorageKey();
  if (storageKey === THEME_STORAGE_KEY) return null;

  try {
    const legacyTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return legacyTheme === "dark" || legacyTheme === "light"
      ? legacyTheme
      : null;
  } catch (_) {
    return null;
  }
}

function getTheme() {
  return (
    getStoredTheme() ||
    (document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light")
  );
}

/* Apply the theme to <html>, persist when asked, and sync any
   switcher controls already present in the DOM. */
let themeApplicationVersion = 0;

function applyTheme(theme, save) {
  const value = theme === "dark" ? "dark" : "light";
  themeApplicationVersion += 1;
  if (value === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (save) {
    try {
      localStorage.setItem(getThemeStorageKey(), value);
    } catch (_) {}
  }
  syncThemeSwitchers(value);
}

function setTheme(theme) {
  applyTheme(theme, true);
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

/* Reflect the current theme on every [data-theme-switch] control. */
function syncThemeSwitchers(theme) {
  const isDark = theme === "dark";
  document.querySelectorAll("[data-theme-switch]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode",
    );
    btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    const sun = btn.querySelector(".theme-sun");
    const moon = btn.querySelector(".theme-moon");
    if (sun) sun.style.display = isDark ? "inline" : "none";
    if (moon) moon.style.display = isDark ? "none" : "inline";
  });
  document.querySelectorAll("[data-theme-radio]").forEach((radio) => {
    if (radio.value === (isDark ? "dark" : "light")) radio.checked = true;
  });
}

/* Build a single switcher control and return it. */
function buildThemeSwitch() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "app-theme-switch";
  btn.setAttribute("data-theme-switch", "");
  btn.setAttribute("aria-label", "Switch theme");
  btn.innerHTML =
    '<i class="bi bi-sun-fill theme-sun" style="display:none;"></i>' +
    '<i class="bi bi-moon-stars-fill theme-moon"></i>';
  return btn;
}

/* Inject the switcher into the page at the best available spot. */
function injectThemeSwitch() {
  if (document.body?.classList.contains("assistant-page")) return;

  const isAuthLoginOrRegister =
    document.body &&
    (document.body.classList.contains("login-page") ||
      document.body.classList.contains("register-page"));

  if (isAuthLoginOrRegister) {
    document.querySelectorAll(".app-theme-switch").forEach((button) => {
      button.remove();
    });
    return;
  }

  const existing = document.querySelector(".app-theme-switch");
  const sidebarThemeSlot = document.querySelector(
    ".dashboard-sidebar-theme-slot",
  );
  if (existing) {
    if (sidebarThemeSlot) {
      existing.classList.add("dashboard-sidebar-theme");
      sidebarThemeSlot.appendChild(existing);
    }
    return;
  }

  const sidebarNav = document.querySelector(".sidebar");
  if (sidebarNav) {
    // Dashboard / role pages: place the toggle at the top of the left sidebar,
    // outside the brand link so clicking it does not trigger navigation.
    const btn = buildThemeSwitch();
    btn.classList.add("app-theme-in-sidebar");
    btn.setAttribute("title", "Toggle dark/light mode");
    if (sidebarThemeSlot) {
      btn.classList.add("dashboard-sidebar-theme");
      sidebarThemeSlot.appendChild(btn);
      return;
    }
    const brandLink = sidebarNav.querySelector("a[href]");
    if (brandLink && brandLink.parentNode === sidebarNav) {
      brandLink.after(btn);
    } else {
      sidebarNav.prepend(btn);
    }
    return;
  }

  const topbar = document.querySelector(".topbar");
  if (topbar) {
    // Dashboard / role pages without a sidebar: add to topbar's controls.
    const btn = buildThemeSwitch();
    btn.classList.add("app-theme-in-topbar");
    // Prefer an existing right-aligned action cluster, else append to topbar.
    const cluster =
      topbar.querySelector(".d-flex.gap-3 > *")?.parentElement ||
      topbar.querySelector(".d-flex.align-items-center.gap-3") ||
      topbar.querySelector(
        ".d-flex.justify-content-between > div:last-child",
      ) ||
      topbar;
    cluster.appendChild(btn);
    return;
  }

  // Public navbar (index.html): inject into navbar action area
  const navActions = document.querySelector(
    ".main-navbar .d-flex.align-items-center.gap-2.mt-2.mt-lg-0",
  );
  if (navActions && !document.body.classList.contains("auth-body")) {
    const btn = buildThemeSwitch();
    btn.classList.add("app-theme-in-navbar");
    const before = navActions.firstElementChild;
    if (before) navActions.insertBefore(btn, before);
    else navActions.appendChild(btn);
    return;
  }

  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar && !document.body.classList.contains("auth-body")) {
    const btn = buildThemeSwitch();
    btn.classList.add("app-theme-in-navbar");
    const actions =
      mainNavbar.querySelector("#navMenu .d-flex.align-items-center.gap-2") ||
      mainNavbar.querySelector("#navMenu") ||
      mainNavbar.querySelector(".navbar-collapse");
    if (actions) {
      const before = actions.firstElementChild;
      if (before) actions.insertBefore(btn, before);
      else actions.appendChild(btn);
    }
    return;
  }

  // Public / auth pages (login, register): floating top-right.
  const btn = buildThemeSwitch();
  btn.classList.add("app-theme-float");
  document.body.appendChild(btn);
}

/* Bind existing or newly injected switcher controls. */
function bindThemeSwitchers() {
  document.querySelectorAll("[data-theme-switch]").forEach((btn) => {
    if (btn.dataset.themeBound) return;
    btn.dataset.themeBound = "1";
    btn.addEventListener("click", toggleTheme);
  });
}

function pauseNavbarAnimationsWhenHidden() {
  const syncVisibility = () => {
    document.documentElement.classList.toggle(
      "navbar-animations-paused",
      document.hidden,
    );
  };

  syncVisibility();
  document.addEventListener("visibilitychange", syncVisibility);
}

function initContentRevealAnimations() {
  if (
    document.body.classList.contains("public-home-page") ||
    !("IntersectionObserver" in window)
  ) {
    return;
  }

  const candidates = document.querySelectorAll(
    "main > section, main .card, main .alert, " +
      ".auth-body .card, .auth-body .auth-footer, .auth-body img, .auth-body i, " +
      ".auth-body svg, .auth-body .btn, .auth-body button:not(.btn-close), " +
      ".assistant-page .assistant-header, .assistant-page .assistant-notice, " +
      ".assistant-page .assistant-messages, .assistant-page .assistant-composer-wrap, " +
      ".assistant-page .assistant-welcome, .assistant-page img, .assistant-page i, " +
      ".assistant-page svg, .assistant-page button:not(.btn-close), " +
      ".certificate-page .toolbar button, .certificate-page .masthead, " +
      ".certificate-page .document-heading, .certificate-page .body-copy, " +
      ".certificate-page .info-section, .certificate-page .approval-section, " +
      ".certificate-page .approval-block, .certificate-page .footer-note, " +
      "main img, main i, main svg, main .btn, main button:not(.btn-close)",
  );
  const siblingIndexes = new Map();

  candidates.forEach((element) => {
    if (element.closest(".main-navbar, #sidebar, .topbar")) return;
    if (element.matches("i, svg") && element.closest("a, button")) return;

    const parent = element.parentElement;
    const index = siblingIndexes.get(parent) || 0;
    siblingIndexes.set(parent, index + 1);
    element.style.setProperty(
      "--motion-reveal-delay",
      `${Math.min(index, 5) * 45}ms`,
    );
    element.classList.add("motion-reveal");
  });

  const observer = new IntersectionObserver(
    (entries, activeObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        entry.target.classList.add("is-visible");
        activeObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -32px 0px" },
  );

  document.querySelectorAll(".motion-reveal").forEach((element) => {
    observer.observe(element);
  });
}

/* Initialise: apply the persisted theme and set up controls. */
function initTheme() {
  const savedTheme = getStoredTheme();
  const theme = savedTheme || "light";
  applyTheme(theme, false);
  injectThemeSwitch();
  syncThemeSwitchers(
    theme,
  ); /* sync freshly-injected switch icons to saved theme */
  bindThemeSwitchers();
  pauseNavbarAnimationsWhenHidden();
  initContentRevealAnimations();
  const initializationVersion = themeApplicationVersion;
  if (!savedTheme && typeof apiRequest === "function") {
    apiRequest("/public/settings")
      .then((response) => {
        const defaultTheme = response?.data?.defaultTheme;
        if (
          (defaultTheme === "light" || defaultTheme === "dark") &&
          themeApplicationVersion === initializationVersion &&
          !getStoredTheme()
        ) {
          applyTheme(defaultTheme, false);
        }
      })
      .catch((error) => {
        console.warn("[Theme] Could not load the system default theme.", error.message);
      });
  }
}

if (typeof window !== "undefined") {
  window.getStoredTheme = getStoredTheme;
  window.getExplicitStoredTheme = getExplicitStoredTheme;
  document.addEventListener("DOMContentLoaded", initTheme);
}
