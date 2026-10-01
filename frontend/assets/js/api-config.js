/* ============================================================
   api-config.js — Single canonical API base for ALL frontend pages
   Smart ICT Maintenance Management System

   This file ONLY defines the API origin/base and related helpers.
   It intentionally contains NO auth guards, no page initialization,
   and no DOM manipulation, so it is safe for public pages
   (index, login, register) AND authenticated pages alike.

   Exposes:  const API_BASE     (e.g. "http://localhost:5000/api")
             const API_UPLOAD_BASE  (the origin root for /uploads)
             function apiOrigin()   -> returns the origin root

   Resolution order:
   1. Explicit override via window.__API_BASE__ (set BEFORE this file loads)
   2. PRODUCTION_API_MAP hostname lookup
   3. Localhost fallback (development)
   4. Known backend URL as safety net for hosting platforms
   ============================================================ */

/* Known production backend URL — used as the final fallback when the
   current hostname is NOT localhost and NOT in PRODUCTION_API_MAP.
   This prevents hosting platforms (Netlify, Vercel, etc.) from
   accidentally falling back to same-origin /api which doesn't exist. */
var __KNOWN_BACKEND_URL =
  "https://dbu-ict-maintenance-service.onrender.com/api";

/* Production URL mapping: Netlify frontend -> Render backend */
var PRODUCTION_API_MAP = {
  "smartcomputer-maintenance-system.netlify.app": __KNOWN_BACKEND_URL,
  "smartcomputermaintenanceservice.netlify.app": __KNOWN_BACKEND_URL,
};

var API_BASE = (function () {
  /* 1. Explicit deploy-time override (see comments above). */
  if (
    typeof window !== "undefined" &&
    typeof window.__API_BASE__ === "string" &&
    window.__API_BASE__
  ) {
    return window.__API_BASE__;
  }

  var protocol = window.location.protocol;
  var hostname = window.location.hostname;

  /* 2. Production: map known frontend domains to the Render backend origin. */
  if (PRODUCTION_API_MAP[hostname]) {
    return PRODUCTION_API_MAP[hostname];
  }

  /* 3. Local development uses the backend's configured default port. */
  var isFile = protocol === "file:";
  var isLocal =
    isFile || !hostname || hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocal) {
    if (isFile) {
      console.warn(
        "[api-config] This page was opened directly from the filesystem " +
          "(file://). That sends `Origin: null`, which the backend CORS policy " +
          "does not allow, so every API call fails as a network error.\n" +
          "Fix: serve the frontend — `cd frontend && node server.js` — then open " +
          "http://localhost:3000/",
      );
    }
    return "http://" + (hostname || "localhost") + ":5000/api";
  }

  /* 4. Unknown non-local hostname (new Netlify/Vercel subdomain, custom
     domain, etc.). Never use same-origin — hosting platforms don't serve
     the backend. Fall back to the known backend URL and log a warning
     so developers can add the new hostname to PRODUCTION_API_MAP. */
  console.warn(
    '[api-config] Hostname "' + hostname + '" is not in PRODUCTION_API_MAP.',
    "Falling back to known backend:",
    __KNOWN_BACKEND_URL,
    "— Add this hostname to PRODUCTION_API_MAP to silence this warning.",
  );
  return __KNOWN_BACKEND_URL;
})();

/* Origin root (e.g. "https://dbu-ict-maintenance-service.onrender.com") —
   used to build attachment/upload URLs served from the backend /uploads route. */
function apiOrigin() {
  return API_BASE.replace(/\/api\/?$/, "");
}

var API_UPLOAD_BASE = apiOrigin();

/* Warm the connection to the API origin as soon as the page loads so the
   FIRST AI question starts immediately — the browser resolves DNS and opens
   the TCP/TLS socket early, instead of paying the handshake round-trips at
   submit time. Harmless helpers: modern browsers act on "preconnect",
   older ones still benefit from the "dns-prefetch" fallback. */
(function warmApiConnection() {
  if (typeof document === "undefined") return;
  var origin = apiOrigin();
  if (!origin) return;
  ["preconnect", "dns-prefetch"].forEach(function (kind) {
    var link = document.createElement("link");
    link.rel = kind;
    link.href = origin;
    document.head.appendChild(link);
  });
})();

/* Load the shared advisory AI support widget on every application page that
   already consumes the canonical API configuration.

   Loaded during browser idle time rather than immediately. This file is
   present on the public landing page and on login/register, where the widget
   is not needed for the first interaction — fetching and executing ~330 lines
   of widget JS during the initial parse competes with the page's own CSS and
   hero content for bandwidth and main-thread time. Deferring to idle keeps the
   first paint fast while still making the widget available essentially
   immediately on every page. `requestIdleCallback` is used when available,
   with a short timeout so the widget still appears promptly. */
(function loadAiSupportWidget() {
  if (window.__aiSupportLoaded || window.__aiSupportLoading) return;
  if (document.querySelector('script[src*="ai-support.js"]')) return;
  function inject() {
    if (window.__aiSupportLoaded || window.__aiSupportLoading) return;
    window.__aiSupportLoading = true;
    var script = document.createElement("script");
    script.src = "/assets/js/ai-support.js?v=26";
    script.defer = true;
    script.onload = function () {
      window.__aiSupportLoading = false;
    };
    script.onerror = function () {
      window.__aiSupportLoading = false;
      console.error("[api-config] Unable to load the AI support widget.");
    };
    document.head.appendChild(script);
  }
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(inject, { timeout: 2000 });
  } else {
    window.setTimeout(inject, 200);
  }
})();
