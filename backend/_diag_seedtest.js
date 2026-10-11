/* TEMP test users for verification. DELETE after testing. */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const PWD = "Testpass1";
const BASE = "zzz.opencode.verify";

(async () => {
  await mongoose.connect((process.env.MONGO_URI || "").trim(), {
    dbName: process.env.MONGO_DB_NAME || "ict_maintenance_db",
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  });
  const col = mongoose.connection.db.collection("users");
  const hash = await bcrypt.hash(PWD, 10);
  const roles = [
    ["ICT Admin", "admin"],
    ["Technician", "tech"],
    ["Requester", "req"],
  ];
  for (const [role, tag] of roles) {
    const email = `${BASE}.${tag}@example.com`;
    await col.updateOne(
      { email },
      {
        $set: {
          fullName: `VERIFY ${role}`,
          email,
          role,
          status: "active",
          password: hash,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    console.log(`seeded ${role}: ${email}  pwd=${PWD}`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
