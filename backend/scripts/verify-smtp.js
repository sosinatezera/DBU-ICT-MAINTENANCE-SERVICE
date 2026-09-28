/**
 * scripts/verify-smtp.js — Gmail SMTP / Nodemailer verification tool.
 * Smart ICT Maintenance Management System
 *
 * Checks (in order):
 *   1. Whether SMTP is even configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD).
 *   2. Nodemailer transporter.verify() — a real SMTP login/connection test.
 *   3. OPTIONAL live test email: node scripts/verify-smtp.js --send-to=you@example.com
 *
 * Run from backend/:   npm run verify:smtp
 *   (npm run verify:smtp -- --send-to=you@example.com  for a live test)
 *
 * Expected result after configuring your Google App Password:
 *   ✔  SMTP connection verified (smtp.gmail.com:587) as yo***@gmail.com.
 *
 * NEVER prints credentials. SMTP_USER is masked; SMTP_PASS is only shown as
 * the presence flag "****(set)". Failures are reported with a stage category
 * (EMAIL_CONFIGURATION_ERROR / EMAIL_CONNECTION_ERROR / EMAIL_SEND_ERROR) and,
 * when configuration is incomplete, the missing variable NAMES. Exit codes:
 * 0 = ok/skipped, 1 = verification failed while SMTP was configured to run.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  smtpConfigured,
  verifySmtp,
  sendEmail,
  maskConfig,
  describeMissing,
  EMAIL_ERROR,
} = require('../services/mailer');

const checks = { pass: 0, fail: 0 };
const ok  = (msg) => { checks.pass++; console.log(`  ✔  ${msg}`); };
const bad = (msg) => { checks.fail++; console.log(`  ✖  ${msg}`); };

async function main() {
  console.log('\n  ── Gmail SMTP verification ──────────────────────────');

  const cfg = maskConfig();
  console.log(`  Host : ${cfg.host}`);
  console.log(`  Port : ${cfg.port} (${cfg.port === 465 ? 'implicit TLS' : 'STARTTLS'})`);
  console.log(`  User : ${cfg.user}`);
  console.log(`  Pass : ${cfg.pass}   ← must be a 16-char GOOGLE APP PASSWORD`);
  console.log('  ──────────────────────────────────────────────────────');

  if (!smtpConfigured()) {
    bad(`${EMAIL_ERROR.CONFIGURATION} — email delivery is disabled, so "forgot password" cannot work.`);
    console.log(`\n  Missing or invalid: ${describeMissing()}`);
    console.log('\n  To enable email, set the variable(s) above:');
    console.log('    locally  -> backend/.env');
    console.log('    deployed -> hosting provider Environment variables.');
    console.log('               (render.yaml only DECLARES these with sync:false,');
    console.log('                it never sets their values.)');
    console.log('  SMTP_PASSWORD must be a 16-char Google App Password from');
    console.log('  https://myaccount.google.com/apppasswords. Then re-run this script.\n');
    process.exit(0); /* not configured ≠ a failed verification */
  }

  const result = await verifySmtp();
  if (result.ok) {
    ok(result.detail);
  } else {
    bad(`${result.code || EMAIL_ERROR.CONNECTION} — ${result.detail}`);
  }

  const sendToArg = process.argv.find((a) => a.startsWith('--send-to='));
  if (sendToArg) {
    const to = sendToArg.split('=')[1];
    if (!to) {
      bad('--send-to= requires an email address.');
    } else {
      const send = await sendEmail({
        to,
        subject: 'SMTP test — Smart ICT Maintenance Management System',
        text: 'This is a test email from scripts/verify-smtp.js.\n\nIf you received it, Gmail SMTP is working correctly.',
        html: '<p>This is a test email from <strong>scripts/verify-smtp.js</strong>.</p><p>If you received it, Gmail SMTP is working correctly.</p>',
      });
      if (send.delivered) ok(`Test email delivered to ${to}.`);
      else bad(`${send.code || EMAIL_ERROR.SEND} — test email NOT delivered (${send.info})`);
    }
  } else {
    console.log('\n  Tip: send a live test email with:');
    console.log('  npm run verify:smtp -- --send-to=your.email@gmail.com\n');
  }

  console.log(`  ── ${checks.pass} passed, ${checks.fail} failed ──`);
  process.exit(checks.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('  ✖  Unexpected error:', err && err.message ? err.message : err);
  process.exit(1);
});