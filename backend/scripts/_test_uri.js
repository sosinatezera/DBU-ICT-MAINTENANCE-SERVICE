require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const uri = (process.env.MONGO_URI || '').trim();
const dbName = process.env.MONGO_DB_NAME || 'ict_maintenance_db';

console.log('');
console.log('=== MongoDB Atlas Connection Test ===');
console.log('');

if (!uri) {
  console.error('X MONGO_URI is not set in .env');
  process.exit(1);
}

const isAtlas = uri.startsWith('mongodb+srv://');
console.log('Protocol:', isAtlas ? 'mongodb+srv://' : 'mongodb://');

const withoutProtocol = uri.replace(/^mongodb(\+srv)?:\/\//, '');
const atIndex = withoutProtocol.indexOf('@');
if (atIndex > -1) {
  const userPart = withoutProtocol.substring(0, atIndex);
  const hostPart = withoutProtocol.substring(atIndex + 1);
  const colonIdx = userPart.indexOf(':');
  const username = colonIdx > -1 ? userPart.substring(0, colonIdx) : userPart;
  const hasPassword = colonIdx > -1 && userPart.substring(colonIdx + 1).length > 0;
  console.log('Username:', username);
  console.log('Password present:', hasPassword);
  console.log('Host:', hostPart.split('?')[0]);
  console.log('Params:', hostPart.includes('?') ? hostPart.split('?')[1] : '(none)');
} else {
  console.error('X Invalid URI: missing @ separator');
  process.exit(1);
}
console.log('Database:', dbName);
console.log('');

console.log('Connecting (15s timeout)...');

mongoose.connect(uri, {
  dbName,
  serverSelectionTimeoutMS: 15000,
  retryWrites: true,
  w: 'majority',
})
.then(() => {
  console.log('');
  console.log('SUCCESS: Connected to MongoDB Atlas!');
  console.log('  Host:', mongoose.connection.host);
  console.log('  Database:', mongoose.connection.name);
  return mongoose.disconnect();
})
.then(() => {
  console.log('  Disconnected. Test complete.');
  process.exit(0);
})
.catch(err => {
  console.error('');
  console.error('FAILED:', err.message);
  console.error('');
  console.error('Troubleshooting:');
  console.error('  1. Verify password matches Atlas (Dashboard > Database Access)');
  console.error('  2. Verify IP 190.2.149.30 is in Atlas Network Access list');
  console.error('  3. Verify cluster is not paused (Atlas free tier pauses after inactivity)');
  console.error('  4. Verify DB user has readWrite on ict_maintenance_db');
  process.exit(1);
});
