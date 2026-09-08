/* ============================================================
   api-config.js — Single canonical API base for ALL frontend pages
   Smart Computer Maintenance Service Request and Tracking System

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
var __KNOWN_BACKEND_URL = 'https://dbu-ict-maintenance-service.onrender.com/api';

/* Production URL mapping: Netlify frontend -> Render backend */
var PRODUCTION_API_MAP = {
  'smartcomputer-maintenance-system.netlify.app': __KNOWN_BACKEND_URL,
  'smartcomputermaintenanceservice.netlify.app':  __KNOWN_BACKEND_URL,
};

var API_BASE = (function () {
  /* 1. Explicit deploy-time override (see comments above). */
  if (typeof window !== 'undefined' && typeof window.__API_BASE__ === 'string' && window.__API_BASE__) {
    return window.__API_BASE__;
  }

  var protocol = window.location.protocol;
  var hostname = window.location.hostname;

  /* 2. Production: map known frontend domains to the Render backend origin. */
  if (PRODUCTION_API_MAP[hostname]) {
    return PRODUCTION_API_MAP[hostname];
  }

  /* 3. Local development: static server on :3000, backend API on :5000. */
  var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal) {
    return 'http://localhost:5000/api';
  }

  /* 4. Unknown non-local hostname (new Netlify/Vercel subdomain, custom
     domain, etc.). Never use same-origin — hosting platforms don't serve
     the backend. Fall back to the known backend URL and log a warning
     so developers can add the new hostname to PRODUCTION_API_MAP. */
  console.warn(
    '[api-config] Hostname "' + hostname + '" is not in PRODUCTION_API_MAP.',
    'Falling back to known backend:', __KNOWN_BACKEND_URL,
    '— Add this hostname to PRODUCTION_API_MAP to silence this warning.'
  );
  return __KNOWN_BACKEND_URL;
})();

/* Origin root (e.g. "https://dbu-ict-maintenance-service.onrender.com") —
   used to build attachment/upload URLs served from the backend /uploads route. */
function apiOrigin() {
  return API_BASE.replace(/\/api\/?$/, '');
}

var API_UPLOAD_BASE = apiOrigin();
