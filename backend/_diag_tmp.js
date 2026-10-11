/* READ-ONLY diagnostic. Does not modify any data. */
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  const uri = (process.env.MONGO_URI || "").trim();
  const dbName = process.env.MONGO_DB_NAME || "ict_maintenance_db";
  if (!uri) {
    console.error("NO MONGO_URI");
    process.exit(1);
  }
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
    minPoolSize: 2,
    waitQueueTimeoutMS: 10000,
  });
  const db = mongoose.connection.db;
  console.log("connected:", mongoose.connection.host, "/", mongoose.connection.name);

  const settings = await db.collection("settings").findOne({});
  console.log("\n=== SETTINGS (maintenance-related) ===");
  console.log(
    JSON.stringify(
      {
        maintenanceMode: settings && settings.maintenanceMode,
        maintenanceNotice: settings && settings.maintenanceNotice,
        updatedAt: settings && settings.updatedAt,
        updatedBy: settings && String(settings.updatedBy),
      },
      null,
      2,
    ),
  );

  const users = await db
    .collection("users")
    .find(
      { role: { $in: ["ICT Admin", "Technician", "Requester"] } },
      { projection: { role: 1, status: 1 } },
    )
    .toArray();
  const byRole = {};
  users.forEach((u) => {
    const key = `${u.role}/${u.status}`;
    byRole[key] = (byRole[key] || 0) + 1;
  });
  console.log("\n=== USERS by role/status ===", JSON.stringify(byRole, null, 2));

  console.log("\n=== collection counts ===");
  for (const c of ["sessions", "session_activity", "tickets", "notifications", "auditlogs"]) {
    try {
      console.log(c, await db.collection(c).estimatedDocumentCount());
    } catch (e) {
      console.log(c, "ERR", e.message);
    }
  }

  console.log("\n=== session_activity indexes ===");
  console.log(JSON.stringify(await db.collection("session_activity").indexes(), null, 2));

  console.log("\n=== pool contention test (60 concurrent countDocuments, pool=10) ===");
  const started = Date.now();
  const tasks = Array.from({ length: 60 }, () =>
    db.collection("tickets").countDocuments({}),
  );
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected");
  console.log(
    `elapsed=${Date.now() - started}ms ok=${results.length - failed.length} fail=${failed.length}`,
  );
  failed.slice(0, 3).forEach((f) => console.log("  FAIL:", String(f.reason).slice(0, 140)));

  await mongoose.disconnect();
})().catch((e) => {
  console.error("DIAG ERROR:", e && e.message);
  process.exit(1);
});
