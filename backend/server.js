/**
 * server.js — Entry Point
 * Smart ICT Maintenance Management System (Backend)
 *
 * Node.js / Express / MongoDB (Mongoose)
 *
 * API Routes:
 *   /api/auth          — Authentication (register, login, me)
 *   /api/users         — User management (ICT Admin)
 *   /api/tickets       — Ticket CRUD (replaces /api/requests)
 *   /api/technicians   — Technician profiles
 *   /api/assignments   — Ticket → Technician assignment
 *   /api/assets        — ICT asset inventory
 *   /api/categories    — Ticket categories
 *   /api/device-types  — Device Type catalogue (active list + admin CRUD)
 *   /api/notifications — User notifications
 *   /api/feedback      — Ticket feedback / ratings
 *   /api/reports       — Analytics and reports
 *   /api/maintenance   — Repair activity logs
 *   /api/networking    — Direct user-to-user messages
 *   /api/inquiries     — Public contact/inquiry submissions
 *   /api/settings      — System settings (ICT Admin)
 *   /api/public        — Public stats (no auth)
 *   /api/ai            — Master AI (AI Assistant; public health + streaming chat;
 *                        admin status at /api/assistant/admin/status; local Ollama)
 *   /api/assistant     — Master AI (same router: GET health + POST chat)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const path = require("path");
const connectDB = require("./config/db");
const env = require("./config/env");

/* Response compression. JSON payloads from this API are large and highly
   compressible (ticket lists, reports, notification feeds), so gzip cuts
   transfer size by roughly 70-90% on the wire and removes seconds of
   latency on slow/mobile links. The require is guarded so a missing
   dependency degrades to "no compression" instead of crashing boot. */
let compression = null;
try {
  compression = require("compression");
} catch (_) {
  console.warn(
    "[perf] 'compression' is not installed — responses will NOT be compressed.",
  );
  console.warn("[perf] Fix with: cd backend && npm install compression");
}

/* ── Production configuration guard ─────────────────────────
  Fail fast in production (never silently) when the session secret is
  missing or still the placeholder — a weak secret breaks all auth.
   Local development is left untouched. */
if (process.env.NODE_ENV === "production") {
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (!sessionSecret || sessionSecret === "change_this_session_secret") {
    console.error(
      "\n  [ERROR] NODE_ENV=production requires a strong SESSION_SECRET.",
    );
    console.error(
      '  Generate one (e.g. "openssl rand -hex 64") and set it in the',
    );
    console.error(
      "  hosting provider's environment variables. Aborting startup.\n",
    );
    process.exit(1);
  }
  if (!process.env.FRONTEND_ORIGINS) {
    console.warn(
      "\n  [WARN] FRONTEND_ORIGINS is not set — CORS will only allow the default development origins.",
    );
    console.warn(
      "  Set FRONTEND_ORIGINS to your deployed frontend origin(s), e.g.",
    );
    console.warn("  https://smartcomputer-maintenance-system.netlify.app\n");
  }
}

const { logger } = require("./middleware/logger");
const { errorHandler } = require("./middleware/errorHandler");
const { authenticate } = require("./middleware/auth");
const {
  verifySmtp,
  smtpConfigured,
  describeMissing,
} = require("./services/mailer");
const { initSocketIO } = require("./services/notificationService");
const {
  uploadProfileFile,
  getProfileFiles,
  downloadProfileFile,
  deleteProfileFile,
} = require("./controllers/userController");
const uploadDocuments = require("./config/multerDocuments");

const activeAiModel = env.OLLAMA_MODEL || "llama3.2";
console.log(
  `Master AI (AI Assistant): ${env.AI_SUPPORT_ENABLED !== "false" ? "Enabled" : "Disabled"} | Provider: ollama | Model: ${activeAiModel}`,
);

/* ── OpenAI residual guard (diagnostic only) ─────────────────
   Master AI uses ONLY local Ollama — never OpenAI. This check is
   intentionally NON-FATAL and never changes behavior: it only prints
   an explicit PASS/WARN line at boot so any stale OpenAI artifact
   (an OPENAI_API_KEY env var, an installed 'openai' package, or an
   '"openai"' entry in package.json / package-lock.json) is surfaced
   immediately instead of silently lingering. It is wrapped so a
   filesystem or resolver error can never block startup. */
function detectOpenAIResidual() {
  const found = [];
  if (process.env.OPENAI_API_KEY) {
    found.push("OPENAI_API_KEY is set in the environment");
  }
  try {
    require.resolve("openai", { paths: [__dirname] });
    found.push("an installed 'openai' package exists in node_modules");
  } catch {
    /* not installed — good */
  }
  const fs = require("fs");
  for (const file of ["package.json", "package-lock.json"]) {
    try {
      const text = fs.readFileSync(path.join(__dirname, file), "utf8");
      if (/"openai"\s*:/.test(text)) {
        found.push(`"openai" is declared in ${file}`);
        break;
      }
    } catch {
      /* unreadable — skip */
    }
  }
  return found;
}
try {
  const residuals = detectOpenAIResidual();
  if (residuals.length > 0) {
    console.warn(
      `\n  [WARN] OpenAI residual detected: ${residuals.join("; ")}.`,
    );
    console.warn(
      "         Master AI uses only local Ollama. Remove the residual (e.g. run\n" +
        "         `npm prune` inside backend/ or unset OPENAI_API_KEY) and redeploy,\n" +
        "         otherwise the deployed service may silently keep talking to OpenAI.\n",
    );
  } else {
    console.log(
      "  Master AI provider check: PASS — no OpenAI code, dependency, or key found (Ollama only).",
    );
  }
} catch {
  /* must never block startup */
}

/* ── Connect to MongoDB ──────────────────────────────────── */
connectDB();

const app = express();

/* ── Reverse-proxy trust ─────────────────────────────────────
   The deployment terminates TLS in front of this process, so the socket
   address belongs to the proxy for EVERY caller. Without trusting that hop,
   req.ip is the proxy for all users and the per-IP rate-limit buckets collapse
   into one shared bucket that throttles the whole user base (this is what made
   a valid forgot-password request return "Too many requests"). Only the
   configured number of hops is trusted — never `true` — so a client-supplied
   X-Forwarded-For can never be used to escape a rate limit. */
app.set("trust proxy", env.TRUST_PROXY);

/* ── Core Middleware ─────────────────────────────────────── */
/* Production CORS allows the deployed frontend origins only. Localhost is
   included only outside production. Additional exact origins may be supplied
   through FRONTEND_ORIGINS; wildcard origins are never used. */
const productionOrigins = [
  "https://simms-ict-maintanance-system.netlify.app",
  "https://smartcomputer-maintenance-system.netlify.app",
  "https://smartcomputermaintenanceservice.netlify.app",
];
const localDevOrigins = ["localhost", "127.0.0.1", "::1"];
const developmentOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];
const envOrigins = process.env.FRONTEND_ORIGINS
  ? process.env.FRONTEND_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter((origin) => {
        if (!origin) return false;
        try {
          const hostname = new URL(origin).hostname;
          return (
            env.NODE_ENV !== "production" || !localDevOrigins.includes(hostname)
          );
        } catch {
          return false;
        }
      })
  : [];
const defaultOrigins =
  env.NODE_ENV === "production"
    ? productionOrigins
    : [...productionOrigins, ...developmentOrigins];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    /* Retry-After is NOT a CORS-safelisted response header, so a separate
       frontend origin could never read the cooldown after a 429 without this.
       X-RateLimit-* is exposed for the same reason. */
    exposedHeaders: [
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
  }),
);

/* SameSite=None is required for the direct Netlify-to-Render session cookie.
   Reject browser-originated state changes from any other origin; requests
   without an Origin header remain available for non-browser API clients. */
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (
    !origin ||
    !stateChangingMethods.has(req.method) ||
    allowedOrigins.includes(origin)
  ) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Request origin is not allowed.",
  });
});
/* ── Security headers (Helmet) ──────────────────────────────
   Defaults harden API responses. We relax crossOriginResourcePolicy
   to "cross-origin" so uploaded attachments under /uploads remain
    displayable on the separate frontend origin. */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
/* Compression sits above the body parsers so every downstream response
   (including error envelopes from the global handler) is compressed. */
if (compression) {
  app.use(
    compression({
      /* Only spend CPU on payloads where it actually pays. */
      threshold: 1024,
      filter: (req, res) => {
        /* Never compress an already-compressed upload (images, docx, pdf). */
        if (
          /^image\/|video\/|audio\//.test(res.getHeader("Content-Type") || "")
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );
}

/* AI attachments are sent as base64 JSON; allow the configured 10 MB file plus
   encoding overhead while keeping request bodies bounded.

   The large limit is scoped to the AI routes plus system settings ONLY.
   Applying 15mb globally made every endpoint — including simple ones like
   /auth/login and /notifications/unread-count — accept and buffer an enormous
   body, which wasted CPU and memory and widened the DoS surface. Everything
   else now uses a tight limit that still comfortably fits real JSON payloads
   (ticket descriptions, feedback, profile forms). File uploads are unaffected:
   they arrive as multipart/form-data and are handled by multer, not by these
   parsers.

   /api/settings is included because the admin home-image layout editor posts
   hero images; if those are base64 the payload is legitimately large and must
   not be rejected with a 413. */
const AI_JSON_PATHS = ["/api/ai", "/api/assistant", "/api/ai-support"];
const LARGE_JSON_PATHS = [...AI_JSON_PATHS, "/api/settings"];
const AI_JSON_LIMIT = process.env.AI_JSON_LIMIT || "15mb";
const DEFAULT_JSON_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";

app.use(
  LARGE_JSON_PATHS,
  express.json({ limit: AI_JSON_LIMIT }),
  express.urlencoded({ extended: true, limit: AI_JSON_LIMIT }),
);
app.use(express.json({ limit: DEFAULT_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: DEFAULT_JSON_LIMIT }));

const isLocalDevelopmentFrontend = (() => {
  const configuredUrl = String(
    process.env.FRONTEND_URL ||
      env.FRONTEND_URL ||
      (env.NODE_ENV === "production" ? "" : "http://localhost:3000"),
  ).trim();
  try {
    return localDevOrigins.includes(new URL(configuredUrl).hostname);
  } catch {
    return env.NODE_ENV !== "production";
  }
})();
const isSecureSessionCookie =
  env.NODE_ENV === "production" && !isLocalDevelopmentFrontend;

const sessionMiddleware = session({
  name: "ict_session",
  secret: env.SESSION_SECRET,
  /* Activity-based expiry: with `rolling`, express-session re-issues the
     cookie on EVERY response, so the client-side lifetime is pushed forward
     each time the user does something. SESSION_TTL_MS (24h) therefore means
     "24 hours of INACTIVITY" rather than "24 hours since login".

     `resave: true` is required for the SERVER side to agree. With
     resave:false + rolling:true the cookie is refreshed but an unmodified
     session document is not re-written, so MongoStore's `expires` field would
     still elapse on the original absolute schedule and the TTL monitor would
     delete a session belonging to a user who is actively signed in. Resaving
     keeps the store TTL, the cookie maxAge and SESSION_TTL_MS consistent.

     saveUninitialized:false means anonymous visitors never get a session, so
     rolling cannot be abused to mint sessions for unauthenticated traffic. */
  resave: true,
  rolling: true,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: env.MONGO_URI,
    dbName: env.MONGO_DB_NAME,
    collectionName: "sessions",
    /* Matches cookie.maxAge / SESSION_TTL_MS exactly (ms → s). */
    ttl: Math.floor(env.SESSION_TTL_MS / 1000),
  }),
  cookie: {
    httpOnly: true,
    sameSite: isSecureSessionCookie ? "none" : "lax",
    secure: isSecureSessionCookie,
    maxAge: env.SESSION_TTL_MS,
  },
});
app.use(sessionMiddleware);
app.use(logger);
/* Uploaded attachments (screenshots, .docx evidence) are served with a long
   immutable cache. They are written under a timestamped filename, so the URL
   for a given file never changes and a cached copy can never go stale.
   Previously express.static defaulted to max-age=0, forcing a conditional
   revalidation round-trip for every attachment view. */
const profileFilesRouter = express.Router();
profileFilesRouter.post(
  "/files",
  authenticate,
  uploadDocuments.single("file"),
  uploadProfileFile,
);
profileFilesRouter.get("/files", authenticate, getProfileFiles);
profileFilesRouter.get("/files/:id", authenticate, downloadProfileFile);
profileFilesRouter.delete("/files/:id", authenticate, deleteProfileFile);
app.use("/api/profile", profileFilesRouter);

/* Profile attachments must only be served through the owner-checked download
   endpoint above, never through the generic authenticated uploads directory. */
app.use("/uploads/profile-files", authenticate, (req, res) => {
  res.status(404).json({ success: false, message: "File not found." });
});

app.use(
  "/uploads",
  authenticate,
  express.static(path.join(__dirname, "uploads"), {
    maxAge: "30d",
    immutable: true,
    etag: true,
    lastModified: true,
  }),
);

/* ── Security Audit Trail ──────────────────────────────────
   Every create/update/delete on the management endpoints below is written
   to the AuditLog collection (fire-and-forget; the actor, action, entity,
   entity id, IP, user agent and success/failure are recorded). Read-only
   requests are never audited. */
const { auditRouter } = require("./middleware/audit");
const AUDITED_MOUNTS = {
  "/api/users": "user",
  "/api/tickets": "ticket",
  "/api/technicians": "technician",
  "/api/assignments": "assignment",
  "/api/assets": "asset",
  "/api/categories": "category",
  "/api/issue-types": "issueType",
  "/api/device-types": "deviceType",
  "/api/maintenance": "maintenance",
  "/api/feedback": "feedback",
  "/api/notifications": "notification",
  "/api/settings": "settings",
};
for (const [mount, entity] of Object.entries(AUDITED_MOUNTS)) {
  app.use(mount, auditRouter({ entity }));
}

/* ── API Routes ─────────────────────────────────────────── */
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api/technicians", require("./routes/technicians"));
app.use("/api/assignments", require("./routes/assignments"));
app.use("/api/assets", require("./routes/assets"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/issue-types", require("./routes/issueTypes"));
app.use("/api/device-types", require("./routes/deviceTypes"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/maintenance", require("./routes/maintenance"));
app.use("/api/networking", require("./routes/networking"));
app.use("/api/inquiries", require("./routes/inquiries"));
/* /api/ai/chat is canonical. The same router is mounted at /api/assistant
   (canonical AI Assistant API: GET /api/assistant/health, POST
   /api/assistant/chat) and as /api/ai-support for backwards compatibility. */
const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);
app.use("/api/assistant", aiRoutes);
app.use(
  "/api/ai-support",
  (req, _res, next) => {
    /* Older cached widgets posted directly to /api/ai-support. */
    if (req.method === "POST" && req.path === "/") req.url = "/chat";
    next();
  },
  aiRoutes,
);
app.use("/api/settings", require("./routes/settings"));
app.use("/api/audit", require("./routes/audit"));
app.use("/api/public", require("./routes/public"));

/* ── Health Check ───────────────────────────────────────── */
app.get("/api/health", (req, res) =>
  res.json({
    status: "OK",
    system: "Smart ICT Maintenance Management System",
    db: "MongoDB",
    timestamp: new Date(),
  }),
);

/* ── 404 Handler ────────────────────────────────────────── */
app.use((req, res) =>
  res.status(404).json({ success: false, message: "Route not found." }),
);

/* ── Global Error Handler ───────────────────────────────── */
app.use(errorHandler);

/* Render supplies PORT; local development falls back to port 5000. */
const PORT = Number(process.env.PORT || 5000);

const server = app.listen(PORT, () => {
  /* Socket.IO is bound to the http.Server that owns the fixed API port, so
       the realtime channel and the REST API can never end up on different
       origins. */
  initSocketIO(server, sessionMiddleware);
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║  Smart ICT Maintenance Management System             ║");
  console.log("  ║  (Backend API)                                       ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║  Server  : listening on port ${PORT}                     ║`);
  console.log("  ║  Database: MongoDB                                   ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log("  ║  Roles: Requester | Technician | ICT Admin           ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("");

  try {
    if (smtpConfigured()) {
      verifySmtp()
        .then((r) => {
          if (r.ok) console.log(`  Email : ${r.detail}`);
          else console.error(`  Email : ${r.detail}`);
        })
        .catch(() =>
          console.error(
            "  Email : EMAIL_CONNECTION_ERROR - SMTP check failed (non-fatal).",
          ),
        );
    } else {
      console.error(
        "  Email : EMAIL_CONFIGURATION_ERROR - PASSWORD RESET IS DISABLED in this deployment.",
      );
      console.error(`          Missing or invalid: ${describeMissing()}.`);
      console.error(
        "          Set them in the hosting provider's environment variables",
      );
      console.error(
        "          (backend/.env is not read in the cloud) and redeploy.\n",
      );
    }
  } catch (err) {
    console.error("  Email : SMTP status unavailable (non-fatal).");
  }

  try {
    if (env.ADMIN_EMAIL_STATUS.configured) {
      console.log("  Contact: admin notification enabled.");
    } else {
      console.error(
        "  Contact: CONTACT_FORM_NOTIFICATION_DISABLED - the contact form will REJECT every submission with HTTP 503.",
      );
      console.error(
        `          Missing or invalid: ${env.ADMIN_EMAIL_STATUS.missing.join(", ")}.`,
      );
      console.error(
        "          Set it in backend/.env (local) or the hosting provider's",
      );
      console.error(
        "          environment variables (deployed), then restart.\n",
      );
    }
  } catch (err) {
    console.error("  Contact: status unavailable (non-fatal).");
  }
});

server.once("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `\n  [ERROR] Port ${PORT} is already in use.\n` +
        "          Another copy of the backend is probably already running, or\n" +
        "          a different application owns the port. Stop it and restart.\n" +
        "          The API port is fixed and never changed automatically,\n" +
        "          because the frontend API base targets this exact origin.\n",
    );
    process.exit(1);
  }
  console.error("[server] Failed to start:", err);
  process.exit(1);
});

/* ── Graceful Shutdown ─────────────────────────────────── */
function shutdown(signal) {
  console.log(`\n  [${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log("  Server closed.");
    const mongoose = require("mongoose");
    mongoose.connection.close(false, () => {
      console.log("  MongoDB connection closed.");
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000);
}

/* Last line of defence. Most fire-and-forget work (notifications, audit
   writes) is now guarded at the source, but a rejection that still escapes
   would otherwise be Node's default behaviour: log, then terminate the
   process. For this service an in-app notification or audit row is never worth
   taking the API down for, so log and keep serving. */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  /* A truly synchronous throw leaves the process in an undefined state, so
     log it and let the supervisor restart us instead of limping on. */
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException");
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
