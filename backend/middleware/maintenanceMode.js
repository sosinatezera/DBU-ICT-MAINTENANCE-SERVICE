const Settings = require("../models/Settings");
const User = require("../models/User");
const { getBearerToken, verifyAuthToken } = require("../services/authToken");

const MAINTENANCE_EXEMPT_API_PATHS = new Set([
  "/health",
  "/public/maintenance-mode",
  "/auth/login",
  "/auth/google",
  "/auth/google/config",
  "/auth/logout",
  "/auth/me",
  "/auth/forgot-password",
  "/auth/verify-reset-code",
  "/auth/reset-password",
  "/auth/registration-status",
  "/ai/chat",
  "/ai/health",
  "/assistant/chat",
  "/assistant/health",
  "/ai-support/chat",
  "/ai-support/health",
]);

function isMaintenanceExempt(req) {
  const candidates = [req.path, req.originalUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const pathname = candidate.split("?")[0].replace(/\/+$/, "") || "/";
    if (MAINTENANCE_EXEMPT_API_PATHS.has(pathname)) return true;
    if (
      pathname.startsWith("/api/") &&
      MAINTENANCE_EXEMPT_API_PATHS.has(pathname.slice("/api".length))
    ) {
      return true;
    }
  }
  return false;
}

async function enforceMaintenanceMode(req, res, next) {
  if (isMaintenanceExempt(req)) return next();

  try {
    const settings = await Settings.getInstance();
    if (settings?.maintenanceMode !== true) return next();

    const token = getBearerToken(req);
    if (token) {
      let payload = null;
      try {
        payload = verifyAuthToken(token);
      } catch (error) {
        payload = null;
      }
      if (payload) {
        const user = await User.findById(payload.sub)
          .select("role status")
          .lean();
        if (user?.status === "active" && user.role === "ICT Admin") return next();
      }
    }

    res.set("Cache-Control", "no-store");
    return res.status(503).json({
      success: false,
      code: "MAINTENANCE_MODE",
      message:
        settings.maintenanceNotice ||
        "The system is temporarily unavailable while maintenance is in progress.",
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { enforceMaintenanceMode, isMaintenanceExempt };
