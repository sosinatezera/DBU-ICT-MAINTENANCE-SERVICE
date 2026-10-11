/* READ-ONLY: audit log entries around maintenance/settings */
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect((process.env.MONGO_URI || "").trim(), {
    dbName: process.env.MONGO_DB_NAME || "ict_maintenance_db",
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const logs = await db
    .collection("auditlogs")
    .find({ action: /maintenance/i })
    .sort({ timestamp: -1 })
    .limit(15)
    .toArray();
  console.log(`maintenance audit entries: ${logs.length}`);
  logs.forEach((l) => {
    console.log("----");
    console.log("action:", l.action);
    console.log("user:", l.user, "email:", l.userEmail || l.email);
    console.log("timestamp:", l.timestamp || l.createdAt);
    console.log("details:", String(l.details || "").slice(0, 400));
  });

  console.log("\nRecent settings audit entries:");
  const sl = await db
    .collection("auditlogs")
    .find({ entity: "settings" })
    .sort({ timestamp: -1 })
    .limit(10)
    .toArray();
  sl.forEach((l) => {
    console.log("----");
    console.log("action:", l.action, "| ts:", l.timestamp || l.createdAt);
    console.log("details:", String(l.details || "").slice(0, 300));
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
