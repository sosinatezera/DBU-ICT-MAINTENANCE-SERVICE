// env.js — Environment configuration (MongoDB)
require('dotenv').config();

module.exports = {
  PORT:          process.env.PORT          || 5000,
  NODE_ENV:      process.env.NODE_ENV      || 'development',

  // MongoDB
  MONGO_URI:     process.env.MONGO_URI     || 'mongodb://localhost:27017',
  MONGO_DB_NAME: process.env.MONGO_DB_NAME || 'ict_maintenance_db',

  // JWT
  JWT_SECRET:    process.env.JWT_SECRET    || 'change_this_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  // File Upload
  UPLOAD_PATH:   process.env.UPLOAD_PATH   || 'uploads/',
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE  || 5 * 1024 * 1024,

  // Frontend base URL (used to build password-reset links). Matches the
  // developer origin by default; override for production (e.g. https://app.example.com).
  FRONTEND_URL:  process.env.FRONTEND_URL  || 'http://localhost:3000',

  // Email (Gmail SMTP — optional; leave SMTP_HOST/SMTP_USER/SMTP_PASS blank to
  // disable mail delivery. SMTP_PASS must be a GOOGLE APP PASSWORD, NOT the
  // normal Gmail password — see .env.example for step-by-step instructions.)
  SMTP_HOST:     process.env.SMTP_HOST     || '',
  SMTP_PORT:     process.env.SMTP_PORT     || 587,   // 587 → STARTTLS; 465 → implicit TLS
  SMTP_USER:     process.env.SMTP_USER     || '',    // your.account@gmail.com
  SMTP_PASS:     process.env.SMTP_PASS     || '',    // 16-char Google App Password
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'Smart Computer Maintenance Service',
};
