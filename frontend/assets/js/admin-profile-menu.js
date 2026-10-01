/* ============================================================
  admin-profile-menu.js — Shared dashboard profile dropdown
    Smart ICT Maintenance Management System

   Mounts the profile section at the far right of the EXISTING
  dashboard topbar, immediately after the notification bell, and
   leaves every existing navbar item, notification control and
   page behaviour untouched.

   Deliberately reuses the existing platform rather than
   introducing a parallel one:
     • identity      → Auth.getUser()          (main.js)
     • avatar        → applyProfileAvatar()    (main.js)
     • sign out      → logout()                (main.js)
• profile page  → existing role-aware settings page
      • system config → existing settings page
      • icons         → Bootstrap Icons (already loaded on every page)
      • styling       → .admin-profile-* rules in style.css

   Styles live in style.css, not admin.css, because this menu now
   serves the Requester, Technician and Admin dashboards alike — and
   only admin pages load admin.css.

   Loaded by main.js's ensureSharedProfileMenu() before it calls mount()
   from the topbar routine, so window.AdminProfileMenu is always defined
   by then and the load-order race cannot happen.
   ============================================================ */

(function () {
  "use strict";

  const SUPPORTED_ROLES = new Set(["ICT Admin", "Technician", "Requester"]);

  /* Viewport gutter kept between the dropdown and the window edges. */
  const VIEWPORT_MARGIN = 8;

  let mounted = false;

  function getCanonicalRole(user) {
    const role = user?.role;
    if (!role) return "";
    return typeof normalizeRole === "function" ? normalizeRole(role) : role;
  }

  function isSupportedUser(user) {
    return SUPPORTED_ROLES.has(getCanonicalRole(user));
  }

  /* ── Markup ──────────────────────────────────────────────
     Built as static markup only; every user-supplied value is
     written with textContent afterwards, so nothing from the
     session is ever interpolated into HTML. */
  function buildProfileMenu(role) {
    const technicianItems =
      role === "Technician"
        ? `
        <a class="admin-profile-item" role="menuitem" id="adminProfileMyProfileLink" href="/views/technician/profile.html">
          <i class="bi bi-person" aria-hidden="true"></i>
          <span class="admin-profile-item-label">My Profile</span>
        </a>
        <a class="admin-profile-item" role="menuitem" id="adminProfileSettingsLink" href="/views/technician/profile.html#profileSettings">
          <i class="bi bi-sliders" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Profile Settings</span>
        </a>
        <a class="admin-profile-item" role="menuitem" href="/views/settings.html#securitySettings">
          <i class="bi bi-shield-lock" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Security</span>
        </a>
        <a class="admin-profile-item" role="menuitem" href="/views/settings.html#notificationSettings">
          <i class="bi bi-bell" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Notification Settings</span>
        </a>
        <a class="admin-profile-item" role="menuitem" id="adminProfileSystemSettingsLink" href="/views/settings.html#languageSettings">
          <i class="bi bi-translate" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Language &amp; Appearance</span>
        </a>
        <div class="admin-profile-dropdown-sep" role="separator"></div>
        <a class="admin-profile-item" role="menuitem" href="/views/technician/assigned-requests.html">
          <i class="bi bi-tools" aria-hidden="true"></i>
          <span class="admin-profile-item-label">My Assignments</span>
        </a>
        <a class="admin-profile-item" role="menuitem" href="/views/technician/dashboard.html#performanceStats">
          <i class="bi bi-bar-chart" aria-hidden="true"></i>
          <span class="admin-profile-item-label">My Performance</span>
        </a>
        <div class="admin-profile-dropdown-sep" role="separator"></div>`
        : `
        <a class="admin-profile-item" role="menuitem" id="adminProfileSettingsLink">
          <i class="bi bi-person" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Profile Settings</span>
        </a>
        <a class="admin-profile-item" role="menuitem" id="adminProfileSystemSettingsLink">
          <i class="bi bi-gear" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Settings</span>
        </a>
        <div class="admin-profile-dropdown-sep" role="separator"></div>`;

    const wrap = document.createElement("div");
    wrap.className = "admin-profile-menu";
    wrap.id = "adminProfileMenu";

    wrap.innerHTML = `
      <button type="button" class="admin-profile-trigger" id="adminProfileTrigger"
              aria-haspopup="true" aria-expanded="false"
              aria-controls="adminProfileDropdown">
        <span class="profile-avatar profile-avatar-sm" data-avatar aria-hidden="true">
          <img class="profile-avatar-image" alt="" hidden />
          <span class="profile-avatar-initials">A</span>
        </span>
        <span class="admin-profile-trigger-text">
          <span class="admin-profile-trigger-name" id="adminProfileTriggerName">Administrator</span>
          <span class="admin-profile-trigger-role" id="adminProfileTriggerRole"></span>
        </span>
        <i class="bi bi-chevron-down admin-profile-trigger-caret" aria-hidden="true"></i>
      </button>

      <div class="admin-profile-dropdown" id="adminProfileDropdown"
           role="menu" aria-labelledby="adminProfileTrigger" aria-hidden="true">
        <div class="admin-profile-dropdown-head">
          <span class="profile-avatar profile-avatar-md" data-avatar aria-hidden="true">
            <img class="profile-avatar-image" alt="" hidden />
            <span class="profile-avatar-initials">A</span>
          </span>
          <div class="admin-profile-dropdown-ident">
            <div class="admin-profile-dropdown-name" id="adminProfileDropdownName"></div>
            <div class="admin-profile-dropdown-email" id="adminProfileDropdownEmail"></div>
            <div class="admin-profile-dropdown-role" id="adminProfileDropdownRole"></div>
            <div class="admin-profile-dropdown-status" id="adminProfileDropdownStatus" hidden>
              <i class="bi bi-circle-fill" aria-hidden="true"></i>
              <span>Loading status...</span>
            </div>
          </div>
        </div>

        <div class="admin-profile-dropdown-sep" role="separator"></div>
        ${technicianItems}

        <button type="button" class="admin-profile-item admin-profile-item--danger"
                id="adminProfileLogout" role="menuitem">
          <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
          <span class="admin-profile-item-label">Logout</span>
        </button>
      </div>`;

    return wrap;
  }

  /* ── Open / close ─────────────────────────────────────────
     State lives on the wrapper as .is-open, matching the existing
     .lang-select convention in theme.css. */
  function isOpen(menu) {
    return menu.classList.contains("is-open");
  }

  function open(menu) {
    menu.classList.add("is-open");
    const trigger = menu.querySelector("#adminProfileTrigger");
    const dropdown = menu.querySelector("#adminProfileDropdown");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    /* visibility + a11y are transitioned in CSS; setting them here keeps
       assistive tech in step with the visual state. */
    if (dropdown) dropdown.setAttribute("aria-hidden", "false");
    clampToViewport(menu);
  }

  function close(menu) {
    menu.classList.remove("is-open");
    menu.classList.remove("opens-up");
    const trigger = menu.querySelector("#adminProfileTrigger");
    const dropdown = menu.querySelector("#adminProfileDropdown");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (dropdown) {
      dropdown.setAttribute("aria-hidden", "true");
      /* Release any viewport offset so the next open re-measures. */
      dropdown.style.right = "";
    }
  }

  /* Keep the panel fully inside the window. The trigger sits at the far
     right of the topbar, so right-alignment normally suffices; this
     handles narrow viewports and long localised labels, and is
     re-evaluated on open and on resize while open. */
  function clampToViewport(menu) {
    const dropdown = menu.querySelector("#adminProfileDropdown");
    if (!dropdown) return;
    let rect = dropdown.getBoundingClientRect();
    if (!rect.width) return;

    const openUp =
      rect.bottom > window.innerHeight - VIEWPORT_MARGIN &&
      rect.top > rect.height + VIEWPORT_MARGIN;
    menu.classList.toggle("opens-up", openUp);
    if (openUp) rect = dropdown.getBoundingClientRect();

    let shift = 0;
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflowRight > 0) shift = overflowRight;
    const overflowLeft = VIEWPORT_MARGIN - (rect.left - shift);
    if (overflowLeft > 0) shift += overflowLeft;

    dropdown.style.right = shift > 0 ? `-${Math.round(shift)}px` : "";
  }

  /* ── Mount ───────────────────────────────────────────────
     Idempotent shared mount for every authenticated dashboard role. */
  function mount(user) {
    if (!isSupportedUser(user)) return false;
    if (mounted && document.getElementById("adminProfileMenu")) return true;

    const topbar = document.querySelector(".topbar");
    if (!topbar) return false;

    /* Same cluster resolution main.js already uses, so the menu lands
       in the existing control group instead of a new container. Falls back
       to the topbar itself: an admin page must never end up with no
       profile menu just because its control cluster is shaped
       differently. */
    const notificationContainer = topbar.querySelector("#notifBellContainer");
    const headerControls =
      notificationContainer?.parentElement ||
      topbar.querySelector(".topbar-actions") ||
      topbar.querySelector(".d-flex.align-items-center.gap-3:last-child") ||
      topbar.querySelector(".d-flex.align-items-center") ||
      topbar;

    /* The standalone logout button main.js injects into every dashboard
       topbar is redundant now that the dropdown carries the same
       logout() call. Remove it only on admin pages, and only from this
       topbar — sidebar/section buttons are left alone. */
    headerControls
      .querySelectorAll(".dashboard-logout-btn")
      .forEach((button) => button.remove());

    /* The legacy avatar + "Welcome, <name>" text duplicated the profile
       trigger. The trigger shows both, so drop the originals. */
    headerControls
      .querySelectorAll("[data-avatar], #topUserName")
      .forEach((element) => element.remove());

    const name = (user.fullName || "").trim() || "User";
    const role = getCanonicalRole(user);
    const email = (user.email || "").trim();
    const menu = buildProfileMenu(role);
    headerControls.appendChild(menu);

    const trigger = menu.querySelector("#adminProfileTrigger");
    const dropdown = menu.querySelector("#adminProfileDropdown");

    /* ── Identity, from the authenticated session only ─────── */
    /* The fragment must match a REAL id on the destination page:
       the admin page's profile pane is #profileTab (a Bootstrap tab),
       while the shared personal page's is the #profileSettings section
       (a plain anchor the browser scrolls to on its own). Pointing both
       at "#profile" would land nowhere. */
    const profileSettingsLink =
      role === "ICT Admin"
        ? "/views/admin/settings.html#profileTab"
        : "/views/settings.html#profileSettings";
    const systemSettingsLink =
      role === "ICT Admin"
        ? "/views/admin/settings.html"
        : "/views/settings.html";
    const profileSettingsAnchor = menu.querySelector(
      "#adminProfileSettingsLink",
    );
    if (profileSettingsAnchor && role !== "Technician") {
      profileSettingsAnchor.href = profileSettingsLink;
    }
    const systemSettingsAnchor = menu.querySelector(
      "#adminProfileSystemSettingsLink",
    );
    if (systemSettingsAnchor && role !== "Technician") {
      systemSettingsAnchor.href = systemSettingsLink;
    }

    menu.querySelector("#adminProfileTriggerName").textContent = name;
    menu.querySelector("#adminProfileTriggerRole").textContent = role;
    menu.querySelector("#adminProfileDropdownName").textContent = name;
    menu.querySelector("#adminProfileDropdownEmail").textContent =
      email || "Email not set";
    menu.querySelector("#adminProfileDropdownRole").textContent = role;

    if (trigger) {
      trigger.setAttribute("aria-label", `Account menu — ${name}, ${role}`);
      trigger.setAttribute("title", `${name} — ${role}`);
    }

    /* populateUserInfo() in main.js already walked the document before this
       runs, so these new avatars are filled explicitly here. */
    menu
      .querySelectorAll("[data-avatar]")
      .forEach((el) => applyProfileAvatar(user, el));

    /* Hide the email row entirely when there is no address, so the
       dropdown header never shows a placeholder line. */
    if (!email) {
      const emailRow = menu.querySelector("#adminProfileDropdownEmail");
      if (emailRow) emailRow.hidden = true;
    }

    if (role === "Technician") {
      const status = menu.querySelector("#adminProfileDropdownStatus");
      status.hidden = false;
      apiRequest("/technicians/me")
        .then(({ data }) => {
          const value =
            data?.availability || (data?.available ? "available" : "offline");
          const labels = {
            available: "Available",
            busy: "Busy",
            offline: "Offline",
          };
          const label = labels[value];
          const icon = status.querySelector("i");
          status.dataset.state = label ? value : "unavailable";
          status.querySelector("span").textContent =
            label || "Status unavailable";
          if (icon) icon.className = "bi bi-circle-fill";
        })
        .catch(() => {
          status.dataset.state = "unavailable";
          status.querySelector("span").textContent = "Status unavailable";
        });
    }

    /* ── Toggle ────────────────────────────────────────────── */
    trigger?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isOpen(menu)) close(menu);
      else open(menu);
    });

    trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      open(menu);
      const items = [
        ...dropdown.querySelectorAll("a[href], button:not(:disabled)"),
      ];
      items[event.key === "ArrowUp" ? items.length - 1 : 0]?.focus();
    });

    dropdown?.addEventListener("keydown", (event) => {
      const items = [
        ...dropdown.querySelectorAll("a[href], button:not(:disabled)"),
      ];
      const current = items.indexOf(document.activeElement);
      if (!items.length || current < 0) return;
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      else if (event.key === "ArrowUp")
        next = (current - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else return;
      event.preventDefault();
      items[next].focus();
    });

    menu.addEventListener("focusout", () => {
      requestAnimationFrame(() => {
        if (isOpen(menu) && !menu.contains(document.activeElement)) close(menu);
      });
    });

    /* ── Click outside closes ────────────────────────────────
       Capture phase, and it ignores clicks that land inside the menu, so
       the notification bell's own Bootstrap dropdown keeps working. */
    document.addEventListener(
      "click",
      (event) => {
        if (!isOpen(menu)) return;
        if (menu.contains(event.target)) return;
        close(menu);
      },
      true,
    );

    /* ── ESC closes and returns focus to the trigger ─────────── */
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      if (!isOpen(menu)) return;
      close(menu);
      trigger?.focus();
    });

    /* Keep the panel inside the viewport while it is open. */
    window.addEventListener(
      "resize",
      () => {
        if (isOpen(menu)) clampToViewport(menu);
      },
      { passive: true },
    );

    /* ── Logout: the existing mechanism, never a second one ────
       logout() destroys the server session, clears the cached user and
       redirects to the login page. Disabling guards against a double
       click firing two /auth/logout requests at the same session. */
    menu
      .querySelector("#adminProfileLogout")
      ?.addEventListener("click", async () => {
        const button = menu.querySelector("#adminProfileLogout");
        if (button.disabled) return;
        button.disabled = true;
        close(menu);
        try {
          await logout();
        } catch (_) {
          /* logout() swallows transport errors and always redirects; if it
           ever throws, restore the control rather than leaving it dead. */
          if (document.body.contains(button)) button.disabled = false;
        }
      });

    /* Menu items navigate away, so make sure the panel is not left open
       if navigation is deferred by the browser back/forward cache. */
    menu.querySelectorAll(".admin-profile-item[href]").forEach((item) => {
      item.addEventListener("click", () => close(menu));
    });

    mounted = true;
    return true;
  }

  /* ── Back/forward-cache guard ──────────────────────────────
     A protected admin page restored from the bfcache does not re-run any
     script, so requireAuth() never fires and the dashboard would stay
     visible after logout. On a bfcache restore the session is therefore
     re-checked against the server.

     This deliberately does NOT go through Auth.load() or apiRequest():
     both short-circuit on the module-level `_sessionLoaded` cache in
     main.js and would replay the pre-logout user without ever reaching
     the network, making the guard a silent no-op. A direct fetch is the
     only way to get an authoritative answer here.

     Only a 401 is treated as proof of sign-out. A network fault or a 5xx
     proves nothing, so the page is left alone rather than throwing a
     correctly signed-in admin out of the dashboard. */
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const user = Auth.getUser();
    if (!user || !isSupportedUser(user)) return;
    if (typeof resolveApiBase !== "function") return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(resolveApiBase() + "/auth/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status !== 401) return;
        Auth.clear();
        if (!window.__authRedirecting) {
          window.__authRedirecting = true;
          window.location.href = "/views/login.html";
        }
      })
      .catch(() => {
        /* Offline or timed out — not evidence of logout. Leave the page. */
      })
      .finally(() => clearTimeout(timer));
  });

  window.AdminProfileMenu = { mount };
})();
