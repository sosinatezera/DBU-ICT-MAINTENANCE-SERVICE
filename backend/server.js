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
const path      = require('path');
const connectDB = require('./config/db');

const { logger }       = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');

/* ── Connect to MongoDB ──────────────────────────────────── */
connectDB();

const app = express();

/* ── Core Middleware ─────────────────────────────────────── */
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
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
