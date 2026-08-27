require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

(async () => {
  await connectDB();

  // Change manager@ict.local role to admin
  const result = await mongoose.connection.db.collection('users').updateOne(
    { email: 'manager@ict.local' },
    { $set: { role: 'admin', name: 'ICT Administrator 2' } }
  );
  console.log(`✅ manager@ict.local → role changed to admin (modified: ${result.modifiedCount})`);

  // Verify all users and their roles
  const users = await mongoose.connection.db.collection('users').find({}, { projection: { name:1, email:1, role:1 } }).toArray();
  console.log('\nCurrent users:');
  users.forEach(u => console.log(`  ${u.role.padEnd(12)} ${u.email}`));

  mongoose.disconnect();
})();
