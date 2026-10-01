/* Functional E2E test for the Permanent Delete technician feature.
   Boots the real server, talks real HTTP with real session cookies, asserts on
   the real MongoDB state, and cleans up everything it creates.

   This is NOT a syntax check.

   node scripts/verify-permanent-delete-technician.js */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.VERIFY_PORT || 5097);
const API = `http://127.0.0.1:${PORT}/api`;
const STAMP = Date.now();
const ADMIN = { email: `permtest.adm.${STAMP}@gmail.com`, pw: "Test1234" };

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

function client() {
  let cookie = "";
  return async function req(method, p, body) {
    const headers = { Accept: "application/json" };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${p}`, {
      method,
      headers,
      body: payload,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = c.split(";")[0];
      if (pair.startsWith("session=") || !cookie) cookie = pair;
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {}
    return { status: res.status, body: json };
  };
}

async function connectWithRetry(uri, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 30000,
        maxPoolSize: 1,
        waitQueueTimeoutMS: 30000,
      });
    } catch (err) {
      last = err;
      console.log(`  (mongo ${i}/${attempts}: ${err.message})`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw last;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${API}/categories/maintenance`);
      if (r.status > 0) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not start");
}

(async () => {
  const server = spawn(
    process.execPath,
    [path.join(__dirname, "..", "server.js")],
    {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (d) => {
    log += d;
  });
  server.stderr.on("data", (d) => {
    log += d;
  });

  const TEC_EMAIL = `permtest.tec.${STAMP}@gmail.com`;
  const TEC2_EMAIL = `permtest.tec2.${STAMP}@gmail.com`;
  const REQ_EMAIL = `permtest.req.${STAMP}@gmail.com`;

  try {
    await connectWithRetry(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    await waitForServer();

    const adm = client();
    const reqUser = client();
    const tecClient = client();
    const anon = client();

    const mkUser = async (email, role) => {
      const r = await db.collection("users").insertOne({
        fullName: `Perm ${role}`,
        email,
        password: await bcrypt.hash("Test1234", 10),
        role,
        department: "ICT",
        phone: "0911000000",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return r.insertedId;
    };

    const adminId = await mkUser(ADMIN.email, "ICT Admin");
    const login = await adm("POST", "/auth/login", {
      email: ADMIN.email,
      password: ADMIN.pw,
    });
    check("ICT Admin logs in", login.status === 200, `status=${login.status}`);

    const techUserId = await mkUser(TEC_EMAIL, "Technician");
    const reqUserId = await mkUser(REQ_EMAIL, "Requester");
    const otherTechUserId = await mkUser(TEC2_EMAIL, "Technician");

    const techA = (
      await db.collection("technicians").insertOne({
        user: techUserId,
        specialization: "Network",
        available: true,
        availability: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;
    const techB = (
      await db.collection("technicians").insertOne({
        user: otherTechUserId,
        specialization: "Hardware",
        available: true,
        availability: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    /* ── related records ── */
    const ticket = (
      await db.collection("tickets").insertOne({
        ticketId: `PERM-${STAMP}`,
        requester: reqUserId,
        department: "ICT",
        title: "Perm test ticket",
        equipmentType: "Router",
        category: "ICT Support > Network",
        location: "Lab",
        problemDescription: "Related record for the permanent delete test.",
        issueType: "Router Problem",
        priority: "medium",
        status: "completed",
        assignedTechnician: techUserId,
        technicianFeedback: {
          technician: {
            technicianId: techUserId,
            technicianName: "Perm Technician",
          },
          technicianConfirmed: true,
          submittedAt: new Date(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    await db.collection("assignments").insertOne({
      ticket,
      technician: techA,
      assigned_by: adminId,
      status: "completed",
      notes: "done",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const maint = (
      await db.collection("maintenancerecords").insertOne({
        request_id: ticket,
        technician: techA,
        action_taken: "Replaced cable",
        parts_used: "cable",
        notes: "n",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    const notif = (
      await db.collection("notifications").insertOne({
        user: techUserId,
        title: "Assigned",
        message: "m",
        type: "info",
        is_read: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    const conv = (
      await db.collection("conversations").insertOne({
        participants: [adminId, techUserId].sort(),
        lastMessageAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;
    const msg = (
      await db.collection("messages").insertOne({
        conversation: conv,
        sender: adminId,
        recipient: techUserId,
        body: "hi",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    const audit = (
      await db.collection("auditlogs").insertOne({
        user: techUserId,
        action: "login",
        entity: "User",
        entityId: String(techUserId),
        ip: "127.0.0.1",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;

    /* ═══ 1. Authorization ═══ */
    console.log("\n[1] Authorization");
    check(
      "unauthenticated request is refused (401)",
      (await anon("DELETE", `/users/${techUserId}/permanent`)).status === 401,
    );
    await reqUser("POST", "/auth/login", {
      email: REQ_EMAIL,
      password: "Test1234",
    });
    check(
      "Requester is refused (403)",
      (await reqUser("DELETE", `/users/${techUserId}/permanent`)).status === 403,
    );
    await tecClient("POST", "/auth/login", {
      email: TEC2_EMAIL,
      password: "Test1234",
    });
    check(
      "Technician is refused (403)",
      (await tecClient("DELETE", `/users/${techUserId}/permanent`)).status === 403,
    );
    check(
      "nothing was deleted by the refused attempts",
      (await db.collection("technicians").countDocuments({ _id: techA })) === 1 &&
        (await db.collection("users").countDocuments({ _id: techUserId })) === 1,
    );

    /* ═══ 2. Active work is protected ═══ */
    console.log("\n[2] A technician with an ACTIVE assignment is protected");
    const ticket2 = (
      await db.collection("tickets").insertOne({
        ticketId: `PERM2-${STAMP}`,
        requester: reqUserId,
        department: "ICT",
        title: "active",
        equipmentType: "Router",
        category: "ICT Support > Network",
        location: "Lab",
        problemDescription: "Active work must not be orphaned.",
        priority: "medium",
        status: "in_progress",
        assignedTechnician: techUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;
    await db.collection("assignments").insertOne({
      ticket: ticket2,
      technician: techA,
      assigned_by: adminId,
      status: "in_progress",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const blocked = await adm("DELETE", `/users/${techUserId}/permanent`);
    check(
      "deletion is refused while work is active (409)",
      blocked.status === 409,
      `status=${blocked.status} ${blocked.body?.message || ""}`,
    );
    await db.collection("assignments").deleteMany({ ticket: ticket2 });
    await db.collection("tickets").deleteOne({ _id: ticket2 });

    /* ═══ 3. Self-delete ═══ */
    console.log("\n[3] An admin cannot delete their own account");
    check(
      "self-delete refused (400)",
      (await adm("DELETE", `/users/${adminId}/permanent`)).status === 400,
    );

    /* ═══ 4. Delete + cascade ═══ */
    console.log("\n[4] Permanent delete succeeds and cascades");
    const del = await adm("DELETE", `/users/${techUserId}/permanent`);
    check("delete returns 200", del.status === 200, `status=${del.status} ${del.body?.message || ""}`);
    check("Technician document is GONE", (await db.collection("technicians").countDocuments({ _id: techA })) === 0);
    check("User document is GONE", (await db.collection("users").countDocuments({ _id: techUserId })) === 0);
    check("Assignment (required ref) removed", (await db.collection("assignments").countDocuments({ technician: techA })) === 0);
    check("MaintenanceRecord (required ref) removed", (await db.collection("maintenancerecords").countDocuments({ technician: techA })) === 0);
    check("Notification (required ref) removed", (await db.collection("notifications").countDocuments({ _id: notif })) === 0);
    check("Conversation removed", (await db.collection("conversations").countDocuments({ _id: conv })) === 0);
    check("Message removed", (await db.collection("messages").countDocuments({ _id: msg })) === 0);

    /* ═══ 5. Nullable refs detached, records kept ═══ */
    console.log("\n[5] Nullable references are detached, records kept");
    const t = await db.collection("tickets").findOne({ _id: ticket });
    check("Ticket SURVIVES", !!t);
    check("Ticket.assignedTechnician cleared", t?.assignedTechnician == null, `got ${t?.assignedTechnician}`);
    check(
      "embedded technicianFeedback.technicianId cleared",
      t?.technicianFeedback?.technician?.technicianId == null,
      `got ${t?.technicianFeedback?.technician?.technicianId}`,
    );
    check(
      "technicianName kept for the audit trail",
      t?.technicianFeedback?.technician?.technicianName === "Perm Technician",
    );
    const auditDoc = await db.collection("auditlogs").findOne({ _id: audit });
    check("AuditLog KEPT but detached", !!auditDoc && auditDoc.user == null);

    /* ═══ 6. No orphans ═══ */
    console.log("\n[6] No orphaned references anywhere");
    check("assignments.technician has no dangling ref", (await db.collection("assignments").countDocuments({ technician: techA })) === 0);
    check("maintenanceRecords.technician has no dangling ref", (await db.collection("maintenancerecords").countDocuments({ technician: techA })) === 0);
    check("notifications.user has no dangling ref", (await db.collection("notifications").countDocuments({ user: techUserId })) === 0);
    check("tickets.assignedTechnician has no dangling ref", (await db.collection("tickets").countDocuments({ assignedTechnician: techUserId })) === 0);
    check(
      "messages has no dangling ref",
      (await db.collection("messages").countDocuments({ $or: [{ sender: techUserId }, { recipient: techUserId }] })) === 0,
    );
    check(
      "conversations has no dangling ref",
      (await db.collection("conversations").countDocuments({ participants: techUserId })) === 0,
    );

    /* ═══ 7. Existing behaviour untouched ═══ */
    console.log("\n[7] Existing functionality untouched");
    check("other technician still present", (await db.collection("technicians").countDocuments({ _id: techB })) === 1);
    const listed = (await adm("GET", "/technicians")).body?.data || [];
    check("deleted technician no longer listed", !listed.some((x) => String(x.id) === String(techA)));
    check("other technician still listed", listed.some((x) => String(x.id) === String(techB)));
    const soft = await adm("DELETE", `/users/${otherTechUserId}`);
    check("the existing soft-delete (Deactivate) still works", soft.status === 200, `status=${soft.status}`);
    check("Deactivate soft-deletes rather than removing", (await db.collection("users").countDocuments({ _id: otherTechUserId })) === 1);

    /* ═══ 8. Validation ═══ */
    console.log("\n[8] Validation");
    check("a malformed id is rejected (400)", (await adm("DELETE", "/users/not-an-id/permanent")).status === 400);
    check(
      "an unknown id is rejected (404)",
      (await adm("DELETE", `/users/${new mongoose.Types.ObjectId()}/permanent`)).status === 404,
    );

    /* ── cleanup ── */
    console.log("\n[cleanup]");
    await db.collection("assignments").deleteMany({ technician: { $in: [techA, techB] } });
    await db.collection("maintenancerecords").deleteMany({ technician: { $in: [techA, techB] } });
    await db.collection("notifications").deleteMany({ user: { $in: [adminId, reqUserId, techUserId, otherTechUserId] } });
    await db.collection("messages").deleteMany({ conversation: conv });
    await db.collection("conversations").deleteMany({ _id: { $in: [conv] } });
    await db.collection("tickets").deleteMany({ ticketId: /^PERM/ });
    await db.collection("auditlogs").deleteMany({ _id: audit });
    await db.collection("technicians").deleteMany({ _id: { $in: [techA, techB] } });
    await db.collection("users").deleteMany({ email: /^permtest\./ });
    console.log("  test data removed");
  } catch (err) {
    fail += 1;
    failures.push("harness crashed");
    console.error("HARNESS ERROR:", err.stack || err.message);
    console.error(log.slice(-1200));
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
    server.kill();
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 400);
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.log(`  failing: ${failures.join(", ")}`);
  console.log("═══════════════════════════════════════");
})();