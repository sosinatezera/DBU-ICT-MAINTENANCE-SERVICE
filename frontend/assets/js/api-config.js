/* ============================================================
   api-config.js — Single canonical API base for ALL frontend pages
   Smart Computer Maintenance Service Request and Tracking System

   This file ONLY defines the API origin/base and related helpers.
   It intentionally contains NO auth guards, no page initialization,
   and no DOM manipulation, so it is safe for public pages
   (index, login, register) AND authenticated pages alike.

   Exposes:  const API_BASE     (e.g. "http://localhost:5000/api")
             const API_UPLOAD_BASE  (the origin root for /uploads)
             function apiOrigin()   → returns the origin root

   ── Production ──────────────────────────────────────────────
   The API base is resolved at runtime so the SAME static bundle
   works locally and in production WITHOUT rebuilding:

   1. Same-origin proxy (RECOMMENDED): serve the frontend and proxy
      /api and /uploads to the backend — API_BASE becomes
      https://<your-host>/api automatically.
   2. Explicit override: inject a tiny <script> BEFORE this file:
        window.__API_BASE__ = 'https://api.example.com/api';
      e.g. <script>window.__API_BASE__='https://api.example.com/api'</script>
   ============================================================ */

/* Production URL mapping: Netlify frontend → Render backend */
const PRODUCTION_API_MAP = {
  'smartcomputermaintenanceservice.netlify.app': 'https://dbu-ict-maintenance-service.onrender.com/api',
};

const API_BASE = (function () {
  /* 1. Explicit deploy-time override (see comments above). */
  if (typeof window.__API_BASE__ === 'string' && window.__API_BASE__) {
    return window.__API_BASE__;
  }

  const { protocol, hostname } = window.location;

  /* 2. Production / non-local host: map known frontend domains to the
       Render backend origin. This ensures the Netlify-hosted frontend
       always calls the Render API, not itself. */
  if (PRODUCTION_API_MAP[hostname]) {
    return PRODUCTION_API_MAP[hostname];
  }

  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocal) {
    return `${protocol}//${hostname}/api`;
  }

  /* 3. Local development: static server on :3000, backend API on :5000. */
  return 'http://localhost:5000/api';
})();

/* Origin root (e.g. "http://localhost:5000") — used to build
   attachment/upload URLs served from the backend /uploads route. */
function apiOrigin() {
  return API_BASE.replace(/\/api\/?$/, '');
}

const API_UPLOAD_BASE = apiOrigin();