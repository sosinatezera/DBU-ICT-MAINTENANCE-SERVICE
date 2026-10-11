/* ============================================================
   api-config.js — Single canonical API base for ALL frontend pages
   Smart ICT Maintenance Management System
   ============================================================ */

var __KNOWN_BACKEND_URL =
  "https://dbu-ict-maintenance-service.onrender.com/api";
var PRODUCTION_API_MAP = {
  "simms-mau.netlify.app": __KNOWN_BACKEND_URL,
  "simms-ict-maintenance-system.netlify.app": __KNOWN_BACKEND_URL,
};

var API_BASE = (function () {
  var protocol = window.location.protocol;
  var hostname = window.location.hostname;
  if (PRODUCTION_API_MAP[hostname]) return PRODUCTION_API_MAP[hostname];

  if (
    typeof window !== "undefined" &&
    typeof window.__API_BASE__ === "string" &&
    window.__API_BASE__
  ) {
    return window.__API_BASE__;
  }

  var isFile = protocol === "file:";
  var isLocal =
    isFile || !hostname || hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocal) {
    if (isFile) {
      console.warn(
        "[api-config] Serve the frontend with `cd frontend && node server.js` instead of opening it as file://.",
      );
    }
    return "http://" + (hostname || "localhost") + ":5000/api";
  }

  console.warn(
    '[api-config] Hostname "' + hostname + '" is not in PRODUCTION_API_MAP.',
    "Falling back to known backend:",
    __KNOWN_BACKEND_URL,
  );
  return __KNOWN_BACKEND_URL;
})();

function apiOrigin() {
  if (API_BASE.charAt(0) === "/") return window.location.origin;
  return API_BASE.replace(/\/api\/?$/, "");
}

var API_UPLOAD_BASE = apiOrigin();
var AUTH_TOKEN_STORAGE_KEY = "ict.auth.token";
window.__AUTH_TOKEN_STORAGE_KEY = AUTH_TOKEN_STORAGE_KEY;

(function warmApiConnection() {
  if (typeof document === "undefined") return;
  var origin = apiOrigin();
  if (!origin || origin === window.location.origin) return;
  ["preconnect", "dns-prefetch"].forEach(function (kind) {
    var link = document.createElement("link");
    link.rel = kind;
    link.href = origin;
    document.head.appendChild(link);
  });
})();

(function loadAiSupportWidget() {
  if (window.__aiSupportLoaded || window.__aiSupportLoading) return;
  if (document.querySelector('script[src*="ai-support.js"]')) return;
  function setupLauncher() {
    var launcher = document.querySelector(".ai-support-launcher");
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.type = "button";
      launcher.className = "ai-support-launcher";
      launcher.setAttribute("aria-label", "Open Master AI chat");
      launcher.setAttribute("aria-expanded", "false");
      launcher.innerHTML =
        '<span class="ai-support-sparkle" aria-hidden="true"><i class="bi bi-stars"></i></span><span>✨ Master AI</span>';
      document.body.appendChild(launcher);
    }

    var openAfterLoad = false;
    function inject() {
      if (window.__aiSupportLoaded || window.__aiSupportLoading) return;
      window.__aiSupportLoading = true;
      var script = document.createElement("script");
      script.src = "/assets/js/ai-support.js?v=30";
      script.defer = true;
      script.onload = function () {
        window.__aiSupportLoading = false;
        if (openAfterLoad) launcher.click();
      };
      script.onerror = function () {
        window.__aiSupportLoading = false;
        console.error("[api-config] Unable to load the AI support widget.");
      };
      document.head.appendChild(script);
    }
    launcher.addEventListener("click", function (event) {
      if (window.__aiSupportLoaded) return;
      event.preventDefault();
      openAfterLoad = true;
      inject();
    });
    launcher.addEventListener("pointerenter", inject, { once: true });
    launcher.addEventListener("focus", inject, { once: true });
  }

  if (document.body) setupLauncher();
  else document.addEventListener("DOMContentLoaded", setupLauncher, { once: true });
})();

(function installBearerAuthorization() {
  var originalFetch = window.fetch.bind(window);
  var publicAuthPaths = [
    "/auth/login",
    "/auth/google",
    "/auth/google/config",
    "/auth/register",
    "/auth/registration-status",
    "/auth/forgot-password",
    "/auth/verify-reset-code",
    "/auth/reset-password",
    "/auth/logout",
  ];
  var publicPagePaths = [
    "/",
    "/views/index.html",
    "/views/login.html",
    "/views/register.html",
    "/views/forgot-password.html",
    "/views/reset-password.html",
    "/views/assistant.html",
    "/views/project-certificate.html",
  ];
  var redirectingToLogin = false;

  function storedToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
    } catch (error) {
      console.error("[auth] Unable to read the saved access token.", error);
      return "";
    }
  }

  window.fetch = function (input, init) {
    var requestUrl;
    try {
      var inputUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requestUrl = new URL(inputUrl, window.location.href);
    } catch (_) {
      return originalFetch(input, init);
    }

    var apiUrl;
    try {
      apiUrl = new URL(API_BASE, window.location.href);
    } catch (_) {
      return originalFetch(input, init);
    }
    var apiPath = apiUrl.pathname.replace(/\/+$/, "");
    var isApiRequest =
      requestUrl.origin === apiUrl.origin &&
      (requestUrl.pathname === apiPath ||
        requestUrl.pathname.indexOf(apiPath + "/") === 0);
    if (!isApiRequest) return originalFetch(input, init);

    var headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined,
    );
    if (init && init.headers) {
      new Headers(init.headers).forEach(function (value, name) {
        headers.set(name, value);
      });
    }
    var token = storedToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }

    return originalFetch(input, Object.assign({}, init || {}, { headers: headers }))
      .then(function (response) {
        if (response.status !== 401 || redirectingToLogin) return response;
        var apiRoute = requestUrl.pathname.slice(apiPath.length);
        var isPublicAuthRoute = publicAuthPaths.some(function (route) {
          return apiRoute === route || apiRoute.indexOf(route + "/") === 0;
        });
        if (
          !isPublicAuthRoute &&
          publicPagePaths.indexOf(window.location.pathname) === -1 &&
          !window.__authRedirecting
        ) {
          redirectingToLogin = true;
          window.__authRedirecting = true;
          window.dispatchEvent(new Event("ict:auth-expired"));
          window.location.replace("/views/login.html");
        }
        return response;
      });
  };
})();
