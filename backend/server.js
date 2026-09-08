/**
 * server.js — Entry Point
 * Smart Computer Maintenance Service Request and Tracking System (Backend)
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
 *   /api/notifications — User notifications
 *   /api/feedback      — Ticket feedback / ratings
 *   /api/reports       — Analytics and reports
 *   /api/maintenance   — Repair activity logs
 *   /api/inquiries     — Public contact/inquiry submissions
 *   /api/settings      — System settings (ICT Admin)
 *   /api/public        — Public stats (no auth)
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const path      = require('path');
const connectDB = require('./config/db');

/* ── Production configuration guard ─────────────────────────
   Fail fast in production (never silently) when the JWT secret is
   missing or still the placeholder — a weak secret breaks all auth.
   Local development is left untouched. */
if (process.env.NODE_ENV === 'production') {
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret === 'change_this_secret') {
    console.error('\n  [ERROR] NODE_ENV=production requires a strong JWT_SECRET.');
    console.error('  Generate one (e.g. "openssl rand -hex 64") and set it in the');
    console.error('  hosting provider\'s environment variables. Aborting startup.\n');
    process.exit(1);
  }
  if (!process.env.FRONTEND_ORIGINS) {
    console.warn('\n  [WARN] FRONTEND_ORIGINS is not set — CORS will only allow the default development origins.');
    console.warn('  Set FRONTEND_ORIGINS to your deployed frontend origin(s), e.g.');
    console.warn('  https://smartcomputer-maintenance-system.netlify.app\n');
  }
}

const { logger }       = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { verifySmtp, smtpConfigured } = require('./services/mailer');

/* ── Connect to MongoDB ──────────────────────────────────── */
connectDB();

const app = express();

/* ── Core Middleware ─────────────────────────────────────── */
/* CORS origins: combine the default development origins with any origins
   provided via the FRONTEND_ORIGINS env var (comma-separated). This union
   ensures known frontend origins (development AND the deployed Netlify
   sites) are always allowed, while still letting operators add extra
   origins through the environment. credentials:true is preserved and a
   wildcard is never used. */
const defaultOrigins = [
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5000', 'http://127.0.0.1:5000',
  'https://smartcomputer-maintenance-system.netlify.app',
  'https://smartcomputermaintenanceservice.netlify.app',
];
const envOrigins = process.env.FRONTEND_ORIGINS
  ? process.env.FRONTEND_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

/* ── Security headers (Helmet) ──────────────────────────────
   Defaults harden API responses. We relax crossOriginResourcePolicy
   to "cross-origin" so uploaded attachments under /uploads remain
   displayable on the separate frontend origin (localhost:3000). */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(logger);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ── API Routes ─────────────────────────────────────────── */
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/tickets',       require('./routes/tickets'));
app.use('/api/technicians',   require('./routes/technicians'));
app.use('/api/assignments',   require('./routes/assignments'));
app.use('/api/assets',        require('./routes/assets'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/feedback',      require('./routes/feedback'));
app.use('/api/reports',       require('./routes/reports'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/api/inquiries',    require('./routes/inquiries'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/public',        require('./routes/public'));

/* ── Health Check ───────────────────────────────────────── */
app.get('/api/health', (req, res) =>
  res.json({
    status:   'OK',
    system:   'Smart Computer Maintenance Service Request and Tracking System',
    db:       'MongoDB',
    timestamp: new Date(),
  })
);

/* ── 404 Handler ────────────────────────────────────────── */
app.use((req, res) =>
  res.status(404).json({ success: false, message: 'Route not found.' })
);

/* ── Global Error Handler ───────────────────────────────── */
app.use(errorHandler);

/* ── Start Server with EADDRINUSE handling ──────────────── */
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║  Smart Computer Maintenance Service Request and      ║');
  console.log('  ║  Tracking System                                     ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log(`  ║  Server  : http://localhost:${PORT}                      ║`);
  console.log('  ║  Database: MongoDB                                   ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log('  ║  Roles: Requester | Technician | ICT Admin           ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');

  /* ── Non-fatal SMTP status check ──────────────────────────
     Email is optional. This NEVER blocks or crashes startup: it only reports
     whether outbound email will work. No credentials are ever printed. */
  try {
    if (smtpConfigured()) {
      verifySmtp().then((r) => {
        if (r.ok) console.log(`  Email : ${r.detail}`);
        else console.log('  Email : SMTP configured but connection failed — messages will be skipped (see scripts/verify-smtp.js).');
      }).catch(() => console.log('  Email : SMTP check skipped (non-fatal).'));
    } else {
      console.log('  Email : SMTP not configured — email delivery disabled (optional, see backend/.env).');
    }
  } catch (err) {
    console.log('  Email : SMTP status unavailable (non-fatal).');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [ERROR] Port ${PORT} is already in use.`);
    console.error('  Another instance of the backend may be running.');
    console.error('  Kill the other process or wait a moment and retry.\n');
    process.exit(1);
  }
  throw err;
});

/* ── Graceful Shutdown ─────────────────────────────────── */
function shutdown(signal) {
  console.log(`\n  [${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('  Server closed.');
    const mongoose = require('mongoose');
    mongoose.connection.close(false, () => {
      console.log('  MongoDB connection closed.');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
