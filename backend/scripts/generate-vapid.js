/**
 * scripts/generate-vapid.js
 * Generates a VAPID key pair for Web Push and prints instructions.
 *
 * Run (from backend/):
 *   npm install
 *   node scripts/generate-vapid.js
 *
 * Then paste the keys into backend/.env:
 *   VAPID_PUBLIC_KEY=<public key>
 *   VAPID_PRIVATE_KEY=<private key>
 *   VAPID_SUBJECT=mailto:your-email@example.com
 */

const webPush = require('web-push');

if (webPush.VapidHelper) {
  const keys = webPush.generateVAPIDKeys();

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  Web Push (VAPID) key pair generated          ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Add these to backend/.env:');
  console.log('');
  console.log(`  VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`  VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log('  VAPID_SUBJECT=mailto:your-email@example.com');
  console.log('');
  console.log('  Then restart the backend:');
  console.log('  cd backend && npm start');
  console.log('');
} else {
  console.error('The web-push package is not installed correctly.');
  console.error('Run `npm install` in the backend/ directory and try again.');
  process.exit(1);
}