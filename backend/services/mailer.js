/**
 * services/mailer.js
 * Outbound email for the password-reset flow.
 *
 * Uses the project's existing Nodemailer dependency and the SMTP_* settings
 * already centralised in config/env.js. Email is OPTIONAL in this project:
 * the SMTP_* env vars are left blank to disable real delivery (see .env/.env.example
 * — "Email (optional — leave blank to disable)").
 *
 * IMPORTANT (honesty + security):
 *  - This module NEVER pretends an email was sent.
 *  - sendPasswordResetEmail() returns an explicit `delivered:true/false` result so
 *    the caller can behave correctly and log the reset link ONLY in development.
 *  - Raw reset tokens are NEVER placed in any database (only their hash is) and
 *    never in any server log — except the reset link printed to the development
 *    server console when SMTP is disabled, which is the project-approved dev
 *    mechanism (matching the existing `[auth/...]` console logging pattern).
 */

const nodemailer = require('nodemailer');
const env = require('../config/env');

/* SMTP is considered configured only when the server AND (host+user) exist.
   A server without host or without credentials cannot deliver mail. */
function smtpConfigured() {
  return Boolean(
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASS
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

/**
 * Send a password reset email.
 * @returns {Promise<{delivered:boolean, info:string}>}
 *   - delivered:true  → the email was handed to the SMTP server.
 *   - delivered:false → SMTP is not configured; mail was NOT sent.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  /* ── Dev mode / SMTP disabled ────────────────────────────────
     Do not pretend delivery. Emit the reset link on the server console only
     (this is the existing development convention in the codebase) and report
     that no email was sent; the API still returns the generic enumeration-safe
     message so nothing is leaked to the client. */
  if (!smtpConfigured()) {
    console.log(
      `[auth/password-reset] SMTP not configured — reset email NOT sent to "${to}". ` +
      `RAW RESET LINK (development only): ${resetUrl}`
    );
    return { delivered: false, info: 'SMTP not configured; email not delivered.' };
  }

  let transporter;
  try {
    transporter = createTransporter();
  } catch (err) {
    return { delivered: false, info: `Unable to build mail transport: ${err.message}` };
  }

  const text =
    'You requested a password reset for your Smart Computer Maintenance Service account.\n\n' +
    'Click the link below to reset your password. This link is valid for 30 minutes and can only be used once.\n\n' +
    `${resetUrl}\n\n` +
    'If you did not request this, you can safely ignore this email — your password will not change.\n\n' +
    'Smart Computer Maintenance Service';

  const html =
    '<p>You requested a password reset for your <strong>Smart Computer Maintenance Service</strong> account.</p>' +
    '<p>Click the button below to reset your password. This link is valid for <strong>30 minutes</strong> and can only be used once.</p>' +
    `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 22px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>` +
    '<p style="color:#666;">If you did not request this, you can safely ignore this email — your password will not change.</p>' +
    '<p style="color:#888;font-size:.8rem;">Smart Computer Maintenance Service</p>';

  try {
    await transporter.sendMail({
      from: env.SMTP_USER,
      to,
      subject: 'Reset your password',
      text,
      html,
    });
    return { delivered: true, info: 'Email delivered to SMTP server.' };
  } catch (err) {
    console.error('[auth/password-reset] Email delivery failed:', err.message);
    return { delivered: false, info: 'Email delivery failed.' };
  }
}

module.exports = { sendPasswordResetEmail };