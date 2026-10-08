/**
 * Verify the configured outbound email provider.
 *
 * Run from backend/:
 *   npm run verify:email
 *   npm run verify:email -- --send-to=you@example.com
 *
 * The optional --send-to performs a real provider send. It never prints the
 * API key or full recipient address. A successful API response confirms
 * provider acceptance, not final inbox placement.
 */

"use strict";

require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const env = require("../config/env");
const {
  emailConfigured,
  describeEmailMissing,
  maskEmail,
  verifyEmailProvider,
  sendEmail,
} = require("../services/mailer");

async function main() {
  console.log(`Email provider: ${env.EMAIL_PROVIDER}`);
  if (!emailConfigured()) {
    console.error(
      `Email provider is not configured. Missing: ${describeEmailMissing()}.`,
    );
    process.exitCode = 1;
    return;
  }

  const check = await verifyEmailProvider();
  if (!check.ok) {
    console.error(`${check.code}: ${check.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(check.detail);

  const sendToArg = process.argv.find((arg) =>
    arg.startsWith("--send-to="),
  );
  if (!sendToArg) {
    console.log(
      "Connectivity check passed. Provide --send-to=address to send a real test email.",
    );
    return;
  }

  const to = sendToArg.slice("--send-to=".length).trim();
  if (!to) {
    console.error("--send-to requires a recipient address.");
    process.exitCode = 1;
    return;
  }

  const result = await sendEmail({
    to,
    subject: "Smart ICT Maintenance Management System email test",
    text: "This is a real email-provider test message.",
    html: "<p>This is a real email-provider test message.</p>",
  });
  if (!result.delivered) {
    console.error(
      `${result.code || "EMAIL_SEND_ERROR"}: ${result.info} (recipient ${maskEmail(to)}).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Email accepted by ${env.EMAIL_PROVIDER} for ${maskEmail(to)}. Confirm inbox delivery with the recipient.`,
  );
}

main().catch((error) => {
  console.error(`Email provider verification failed (${error?.code || error?.name || "error"}).`);
  process.exitCode = 1;
});
