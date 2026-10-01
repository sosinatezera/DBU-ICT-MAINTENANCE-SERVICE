/* ═══════════════════════════════════════════════════════════════
 * verify-issue-type.js — FUNCTIONAL end-to-end verification of the
 * independent Issue Type / Service Type catalogue.
 *
 * Boots the real Express server, talks to the real API over HTTP with a real
 * session cookie, and asserts against the real MongoDB document written.
 * This is not a syntax check.
 *
 *   node scripts/verify-issue-type.js
 *
 * Cleanup: every ticket and user this creates is removed again.
 * ═══════════════════════════════════════════════════════════════ */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const hierarchy = require("../utils/ictCategoryHierarchy");

const PORT = Number(process.env.VERIFY_PORT || 5099);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;
const STAMP = Date.now();

const REQUESTER = {
  email: `catissue.req.${STAMP}@gmail.com`,
  password: "Test1234",
  phone: "0911223344",
};
const ADMIN = {
  email: `catissue.adm.${STAMP}@gmail.com`,
  password: "Test1234",
};
const TECH = { email: `catissue.tec.${STAMP}@gmail.com`, password: "Test1234" };

const CATS = hierarchy.ICT_CATEGORY_GROUPS[0].categories;
const createdTicketIds = [];
let createdAsset = null;
const createdUserIds = [];

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

function makeClient() {
  let cookie = "";
  return async function req(method, p, body, isForm) {
    const headers = { Accept: "application/json" };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (isForm) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${p}`, {
      method,
      headers,
      body: payload,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : []) {
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
      console.log(`  (mongo attempt ${i}/${attempts}: ${err.message})`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw last;
}

function waitForServer(url, timeoutMs = 60000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(`${url}/api/categories/maintenance`);
        if (r.status > 0) return resolve();
      } catch (_) {}
      if (Date.now() - t0 > timeoutMs)
        return reject(new Error("server did not start"));
      setTimeout(tick, 400);
    };
    tick();
  });
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

  try {
    await connectWithRetry(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    await waitForServer(BASE);

    const req = makeClient();
    const adm = makeClient();
    const tec = makeClient();

    /* ── accounts ── */
    console.log("\n[setup] requester, ICT admin, technician");
    const reg = await req("POST", "/auth/register", {
      fullName: "Cat Issue Req",
      email: REQUESTER.email,
      password: REQUESTER.password,
      confirmPassword: REQUESTER.password,
      phone: REQUESTER.phone,
      department: "ICT",
      agreeTerms: true,
    });
    check(
      "Requester registers",
      reg.status === 200 || reg.status === 201,
      `status=${reg.status}`,
    );
    const rl = await req("POST", "/auth/login", {
      email: REQUESTER.email,
      password: REQUESTER.password,
    });
    check("Requester logs in", rl.status === 200);

    const mkUser = async (email, role) => {
      const r = await db.collection("users").insertOne({
        fullName: `Cat ${role}`,
        email,
        password: await bcrypt.hash("Test1234", 10),
        role,
        department: "ICT",
        phone: "0911000000",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdUserIds.push(r.insertedId);
      return r.insertedId;
    };
    await mkUser(ADMIN.email, "ICT Admin");
    const techId = await mkUser(TECH.email, "Technician");
    await db.collection("technicians").insertOne({
      user: techId,
      name: "Cat Tech",
      email: TECH.email,
      status: "available",
      department: "ICT",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    check(
      "ICT Admin logs in",
      (
        await adm("POST", "/auth/login", {
          email: ADMIN.email,
          password: ADMIN.password,
        })
      ).status === 200,
    );
    check(
      "Technician logs in",
      (
        await tec("POST", "/auth/login", {
          email: TECH.email,
          password: TECH.password,
        })
      ).status === 200,
    );

    let assetId = null;
    const existing = await db
      .collection("ictassets")
      .findOne({ status: "active" });
    if (existing) assetId = String(existing._id);
    else {
      const a = await db.collection("ictassets").insertOne({
        asset_name: "Verify Laptop",
        asset_tag: `CATV-${STAMP}`,
        category: "Hardware",
        department: "ICT",
        location: "ICT Office",
        condition: "good",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      assetId = String(a.insertedId);
      createdAsset = a.insertedId;
    }

    function ticketForm({
      category,
      deviceType,
      issueType,
      title,
      description,
    }) {
      const fd = new FormData();
      fd.append("title", title || "Verification request");
      fd.append("equipmentType", deviceType || "Laptop");
      fd.append("deviceType", deviceType || "Laptop");
      fd.append(
        "problemDescription",
        description ||
          "Verifying the category and issue type fields end to end.",
      );
      fd.append("phone", REQUESTER.phone);
      fd.append("category", category);
      if (issueType !== undefined) {
        fd.append("issueType", issueType);
        fd.append("serviceType", issueType);
      }
      fd.append("location", "ICT Office, Block A");
      fd.append("asset_id", assetId || "none");
      fd.append("submissionKey", crypto.randomUUID());
      return fd;
    }
    const before = await db.collection("tickets").countDocuments();

    /* ═══ TEST 1 — the catalogue is exactly 85 values, and every
              Category offers all of them ═══ */
    console.log("\n[TEST 1] The catalogue has 85 values and every Category offers all of them");
    const catalogue = hierarchy.getAllIssueTypes();
    check(
      "TEST 1: the catalogue contains exactly 85 Issue Types",
      catalogue.length === 85,
      `count=${catalogue.length}`,
    );
    check(
      "TEST 1: the catalogue has no duplicates",
      new Set(catalogue).size === 85,
      `unique=${new Set(catalogue).size}`,
    );
    check(
      "TEST 1: the first entry is Hardware Failure",
      catalogue[0] === "Hardware Failure",
      `got ${catalogue[0]}`,
    );
    check(
      "TEST 1: the last entry is Other ICT Issue",
      catalogue[84] === "Other ICT Issue",
      `got ${catalogue[catalogue.length - 1]}`,
    );
    const notAllowed = CATS.flatMap((category) =>
      catalogue
        .filter(
          (issueType) =>
            !hierarchy.isIssueTypeAllowed(issueType, `ICT Support > ${category}`),
        )
        .map((issueType) => `${category}+${issueType}`),
    );
    check(
      "TEST 1: every Category accepts all 85 Issue Types",
      notAllowed.length === 0,
      notAllowed.slice(0, 6).join(", "),
    );
    /* No Category name may leak into the Issue Type list. */
    const leaked = catalogue.filter((item) =>
      CATS.some((c) => c.toLowerCase() === item.toLowerCase()),
    );
    check(
      "TEST 1: no Category name appears as an Issue Type",
      leaked.length === 0,
      JSON.stringify(leaked),
    );
    const emptyCateg = CATS.filter((c) => hierarchy.getIssueTypesForCategory(c).length === 0);
    check("TEST 1: every category has a non-empty issue-type list", emptyCateg.length === 0, JSON.stringify(emptyCateg));

    /* Every category's first Issue Type must be accepted over real HTTP. */
    const rejected = [];
    for (const category of CATS) {
      const first = hierarchy.getIssueTypesForCategory(category)[0];
      const r = await req("POST", "/tickets", ticketForm({
        category: `ICT Support > ${category}`, issueType: first, deviceType: "Laptop",
        title: `Cat ${category}`,
        description: `Checking the ${category} issue type is accepted by the API.`,
      }), true);
      if (r.status === 201) createdTicketIds.push(r.body?.data?.id);
      if (r.status !== 201) rejected.push(`${category}+${first} -> ${r.status}`);
    }
    check(`TEST 1: all ${CATS.length} categories are accepted over HTTP`, rejected.length === 0, rejected.slice(0, 5).join(", "));

    /* ═══ TEST 2 — Category remains required ═══ */
    check(
      "TEST 2: Category is still required",
      !hierarchy.isIssueTypeAllowed(
        hierarchy.getIssueTypesForCategory("Hardware")[0],
        "",
      ),
    );

    /* ═══ TEST 3 — the catalogue is flat, so any Category pairs with any
              Issue Type ═══ */
    const crossCategory = await req(
      "POST",
      "/tickets",
      ticketForm({
        category: "ICT Support > Network",
        issueType: "Hardware Failure",
        deviceType: "Router",
        title: "Category independent pairing",
        description:
          "The Issue Type catalogue is shared by every category, so this pairing must be accepted.",
      }),
      true,
    );
    if (crossCategory.status === 201) createdTicketIds.push(crossCategory.body?.data?.id);
    check(
      "TEST 3: Category=Network + Issue Type=Hardware Failure is accepted with HTTP 201",
      crossCategory.status === 201,
      `status=${crossCategory.status} ${crossCategory.body?.message || ""}`,
    );

    /* Every category paired with the FIRST and LAST Issue Type must be accepted. */
    const rejectedPairs = [];
    for (const category of CATS) {
      for (const issueType of [catalogue[0], catalogue[84]]) {
        const r = await req("POST", "/tickets", ticketForm({
          category: `ICT Support > ${category}`, issueType, deviceType: "Laptop",
          title: `Any ${category}`,
          description: `Checking ${issueType} is accepted under ${category}.`,
        }), true);
        if (r.status === 201) createdTicketIds.push(r.body?.data?.id);
        if (r.status !== 201) rejectedPairs.push(`${category}+${issueType} -> ${r.status}`);
      }
    }
    check(
      `TEST 3: all ${CATS.length} categories accept both end-of-list Issue Types`,
      rejectedPairs.length === 0,
      rejectedPairs.slice(0, 6).join(", "),
    );

    /* An Issue Type in no catalogue at all is still refused, so a hand-crafted
       payload cannot invent a value the dropdown never offers. */
    const invented = await req(
      "POST",
      "/tickets",
      ticketForm({
        category: "ICT Support > Network",
        issueType: "Definitely Not A Real Issue Type",
        deviceType: "Router",
        title: "Invented issue type",
        description: "An issue type outside the 85-value catalogue must be refused.",
      }),
      true,
    );
    check(
      "TEST 3: an Issue Type outside the catalogue is refused with HTTP 400",
      invented.status === 400,
      `status=${invented.status} ${invented.body?.message || ""}`,
    );

    /* ═══ TEST 4 — both fields are required ═══ */
    console.log("\n[TEST 4] Both fields are required");
    const noIssue = await req(
      "POST",
      "/tickets",
      ticketForm({
        category: "ICT Support > Hardware",
        issueType: undefined,
        title: "No issue type",
        description: "This request omits the issue type field entirely.",
      }),
      true,
    );
    check(
      "TEST 4a: omitting Issue Type is refused",
      noIssue.status === 422,
      `status=${noIssue.status}`,
    );
    const noCat = await req(
      "POST",
      "/tickets",
      ticketForm({
        category: "",
        issueType: "Hardware Failure",
        title: "No category",
        description: "This request omits the category field entirely.",
      }),
      true,
    );
    check(
      "TEST 4b: omitting Category is refused",
      noCat.status === 422,
      `status=${noCat.status}`,
    );
    check(
      "TEST 4c: neither was stored",
      (await db.collection("tickets").countDocuments()) ===
        before + createdTicketIds.length,
    );

    /* ═══ TEST 5 — stored as two separate fields ═══ */
    console.log("\n[TEST 5] category and issueType are stored separately");
    const t5 = await req(
      "POST",
      "/tickets",
      ticketForm({
        category: "ICT Support > Hardware",
        issueType: "Laptop Problem",
        deviceType: "Laptop",
        title: "Separate fields",
        description:
          "Confirming category and issue type are stored independently.",
      }),
      true,
    );
    if (t5.status === 201) createdTicketIds.push(t5.body?.data?.id);
    const doc5 = t5.body?.data?.id
      ? await db
          .collection("tickets")
          .findOne({ _id: new mongoose.Types.ObjectId(t5.body.data.id) })
      : null;
    check("TEST 5: created", t5.status === 201, `status=${t5.status}`);
    check(
      "TEST 5: category stored verbatim",
      doc5?.category === "ICT Support > Hardware",
      `got ${doc5?.category}`,
    );
    check(
      "TEST 5: issueType stored verbatim",
      doc5?.issueType === "Laptop Problem",
      `got ${doc5?.issueType}`,
    );
    check(
      "TEST 5: category was NOT overwritten with the issue type",
      doc5?.category !== doc5?.issueType &&
        !String(doc5?.category).includes("Laptop Problem"),
    );
    check(
      "TEST 5: both keys exist as distinct document fields",
      Object.keys(doc5 || {}).includes("category") &&
        Object.keys(doc5 || {}).includes("issueType"),
    );

    /* ═══ TEST 6 — visible to every role ═══ */
    console.log(
      "\n[TEST 6] Both fields reach requester, admin and technician views",
    );
    const mine = await req("GET", "/tickets/my");
    const mineT = (mine.body?.data || []).find(
      (t) => t.id === t5.body?.data?.id,
    );
    check(
      "TEST 6: requester sees category and issueType",
      mineT?.category === "ICT Support > Hardware" &&
        mineT?.issueType === "Laptop Problem",
      `cat=${mineT?.category} issue=${mineT?.issueType}`,
    );
    const admT = await adm("GET", `/tickets/${t5.body.data.id}`);
    check(
      "TEST 6: admin sees category and issueType",
      admT.body?.data?.category === "ICT Support > Hardware" &&
        admT.body?.data?.issueType === "Laptop Problem",
      `cat=${admT.body?.data?.category} issue=${admT.body?.data?.issueType}`,
    );
    const one = await req("GET", `/tickets/${t5.body.data.id}`);
    check(
      "TEST 6: GET /tickets/:id returns both",
      !!one.body?.data?.category && !!one.body?.data?.issueType,
    );

    /* ═══ TEST 7 — admin update keeps the Category→Issue Type pairing valid ═══ */
    console.log("\n[TEST 7] Admin update preserves the pairing");
    const good = await adm("PUT", `/tickets/${t5.body.data.id}`, {
      issueType: "RAM / Memory Problem",
    });
    check(
      "TEST 7: a catalogue Issue Type is accepted on update",
      good.status === 200,
      `status=${good.status} ${good.body?.message || ""}`,
    );
    const badUpd = await adm("PUT", `/tickets/${t5.body.data.id}`, {
      issueType: "Definitely Not A Real Issue Type",
    });
    check(
      "TEST 7: an Issue Type outside the catalogue is refused",
      badUpd.status === 400,
      `status=${badUpd.status}`,
    );
    const doc7 = await db
      .collection("tickets")
      .findOne({ _id: new mongoose.Types.ObjectId(t5.body.data.id) });
    check(
      "TEST 7: the refused update changed nothing",
      doc7?.issueType === "RAM / Memory Problem",
      `got ${doc7?.issueType}`,
    );
    const emptyUpd = await adm("PUT", `/tickets/${t5.body.data.id}`, {
      issueType: "",
    });
    /* Re-read after the empty update: comparing against the pre-update
       snapshot would pass no matter what the PUT did. */
    const doc7b = await db
      .collection("tickets")
      .findOne({ _id: new mongoose.Types.ObjectId(t5.body.data.id) });
    check(
      "TEST 7: an empty update does not blank the stored value",
      emptyUpd.status === 400 && doc7b?.issueType === "RAM / Memory Problem",
      `status=${emptyUpd.status} stored=${doc7b?.issueType}`,
    );

    /* ═══ TEST 8 — legacy records stay editable ═══ */
    console.log(
      "\n[TEST 8] A legacy ticket (free-text category, no issue type) stays editable",
    );
    const legacy = await db.collection("tickets").insertOne({
      ticketId: `LEG-${STAMP}`,
      requester: (
        await db.collection("users").findOne({ email: REQUESTER.email })
      )._id,
      department: "ICT",
      title: "Legacy record",
      equipmentType: "Laptop",
      category: "Laptop",
      location: "ICT Office",
      problemDescription:
        "A pre-taxonomy record with a free-text category and no issue type.",
      priority: "medium",
      status: "submitted",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdTicketIds.push(String(legacy.insertedId));
    const legacyUpd = await adm("PUT", `/tickets/${legacy.insertedId}`, {
      issueType: "Hardware Failure",
    });
    check(
      "TEST 8: a legacy ticket can still receive an issue type",
      legacyUpd.status === 200,
      `status=${legacyUpd.status} ${legacyUpd.body?.message || ""}`,
    );
    const legacyDoc = await db
      .collection("tickets")
      .findOne({ _id: legacy.insertedId });
    check(
      "TEST 8: its original category is preserved",
      legacyDoc?.category === "Laptop",
      `got ${legacyDoc?.category}`,
    );

    /* ═══ TEST 9 — the category dropdown ═══ */
    console.log(
      "\n[TEST 9] GET /api/categories/maintenance serves the 15 categories",
    );
    const cats = await req("GET", "/categories/maintenance");
    const served = [];
    for (const g of cats.body?.data || [])
      for (const c of g.categories || []) served.push(c.label);
    const canonical = served.filter((c) => CATS.includes(c));
    check(
      "TEST 9: the 15 canonical categories are served",
      canonical.length === 15,
      `count=${canonical.length}`,
    );
    check(
      "TEST 9: no Issue Type is offered as a category",
      !hierarchy
        .getAllIssueTypes()
        .some((issueType) => served.includes(issueType)),
      JSON.stringify(
        served.filter((v) => hierarchy.getAllIssueTypes().includes(v)),
      ),
    );
    check(
      "TEST 9: every served category offers the full 85-value catalogue",
      canonical.length > 0 &&
        canonical.every((c) => hierarchy.getIssueTypesForCategory(c).length === 85),
      JSON.stringify(
        canonical.filter((c) => hierarchy.getIssueTypesForCategory(c).length !== 85),
      ),
    );
    const servedCounts = {};
    for (const [label, list] of Object.entries(cats.body?.issueTypes || {}))
      servedCounts[label] = Array.isArray(list) ? list.length : 0;
    check(
      "TEST 9: the API serves 85 issue types for every category",
      canonical.length > 0 && canonical.every((c) => servedCounts[c] === 85),
      JSON.stringify(servedCounts),
    );

    /* ═══ TEST 10 — issue type report ═══ */
    const rep = await adm("GET", "/reports/requests-by-issue-type");
    check(
      "TEST 10: the issue-type report responds 200",
      rep.status === 200,
      `status=${rep.status}`,
    );
    /* TEST 1 created the first Issue Type of every category, so assert the
       report lists each of those rather than one fixed literal. */
    const reported = new Set((rep.body?.data || []).map((r) => r.issueType));
    const expected = CATS.map((c) => hierarchy.getIssueTypesForCategory(c)[0]);
    const absent = expected.filter((t) => !reported.has(t));
    check(
      "TEST 10: the report lists every category's issue type",
      absent.length === 0,
      `missing from report: ${JSON.stringify(absent)}`,
    );
    check(
      "TEST 10: a requester cannot read it",
      (await req("GET", "/reports/requests-by-issue-type")).status === 403,
    );

    /* ═══ TEST 11 — frontend/backend catalogue parity ═══ */
    console.log("\n[TEST 11] Frontend and backend expose the identical 85-value catalogue");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "frontend", "assets", "js", "requests.js"),
      "utf8",
    );
    /* The client mirror is the flat REQUEST_ISSUE_TYPES array; the
       per-category fallback is derived from it. Compare the flat array
       entry for entry against the backend catalogue. */
    const listStart = src.indexOf("const REQUEST_ISSUE_TYPES = [");
    const body = src.slice(listStart, src.indexOf("\n];", listStart));
    const fe = [];
    const re = /"([^"]+)"/g;
    let m;
    while ((m = re.exec(body))) fe.push(m[1]);
    check(
      "TEST 11: the frontend mirror exposes exactly 85 entries",
      fe.length === 85,
      `count=${fe.length}`,
    );
    const be = hierarchy.getAllIssueTypes();
    const firstDiff = be.findIndex((item, i) => fe[i] !== item);
    check(
      "TEST 11: the frontend mirror is identical to the backend catalogue, in order",
      firstDiff === -1 && fe.length === be.length,
      firstDiff === -1
        ? ""
        : `index ${firstDiff}: frontend=${JSON.stringify(fe[firstDiff])} backend=${JSON.stringify(be[firstDiff])}`,
    );
    check(
      "TEST 11: the catalogue has no duplicates",
      new Set(be).size === be.length,
      `unique=${new Set(be).size} total=${be.length}`,
    );
    check(
      "TEST 11: the first entry is Hardware Failure and the last is Other ICT Issue",
      be[0] === "Hardware Failure" && be[84] === "Other ICT Issue",
      `first=${be[0]} last=${be[be.length - 1]}`,
    );
    /* The client must not keep a second, renderable copy of the catalogue:
       two sources could disagree and a stale one would offer values the API
       refuses. */
    check(
      "TEST 11: the client has no hardcoded per-category fallback list",
      !src.includes("REQUEST_ISSUE_TYPES_BY_CATEGORY_FALLBACK"),
    );
    check(
      "TEST 11: the client has exactly one REQUEST_ISSUE_TYPES declaration",
      src.split("const REQUEST_ISSUE_TYPES = [").length === 2 &&
        !/\blet REQUEST_ISSUE_TYPES\b/.test(src),
    );

    /* ═══ cleanup ═══ */
    console.log("\n[cleanup]");
    for (const id of createdTicketIds) {
      if (!id) continue;
      try {
        await db
          .collection("tickets")
          .deleteOne({ _id: new mongoose.Types.ObjectId(id) });
      } catch (_) {}
    }
    for (const id of createdUserIds) {
      try {
        await db.collection("users").deleteOne({ _id: id });
      } catch (_) {}
    }
    await db.collection("technicians").deleteMany({ email: TECH.email });
    if (createdAsset)
      await db.collection("ictassets").deleteOne({ _id: createdAsset });
    check(
      "Cleanup: ticket count restored",
      (await db.collection("tickets").countDocuments()) === before,
      `before=${before} after=${await db.collection("tickets").countDocuments()}`,
    );
  } catch (err) {
    fail += 1;
    failures.push("harness crashed");
    console.error("\nHARNESS ERROR:", err.stack || err.message);
    console.error("\n--- server output (tail) ---\n" + log.slice(-1500));
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
