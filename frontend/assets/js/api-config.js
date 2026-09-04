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
   ============================================================ */

const API_BASE = 'http://localhost:5000/api';

/* Origin root (e.g. "http://localhost:5000") — used to build
   attachment/upload URLs served from the backend /uploads route. */
function apiOrigin() {
  return API_BASE.replace(/\/api\/?$/, '');
}

const API_UPLOAD_BASE = apiOrigin();