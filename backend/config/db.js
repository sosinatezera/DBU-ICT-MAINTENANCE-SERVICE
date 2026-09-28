// config/db.js — MongoDB connection via Mongoose
require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");
const { promisify } = require("util");

const resolveSrv = promisify(dns.resolveSrv);

async function resolveSrvToDirect(srvUri) {
  try {
    const parsed = new URL(srvUri.replace("mongodb+srv://", "https://"));
    const host = parsed.hostname;

    const records = await resolveSrv(`_mongodb._tcp.${host}`);
    const hosts = records.map((r) => `${r.name}:${r.port}`).join(",");

    const user = encodeURIComponent(parsed.username);
    const pass = encodeURIComponent(parsed.password);

    let directUri = `mongodb://${user}:${pass}@${hosts}`;

    if (parsed.pathname && parsed.pathname !== "/") {
      directUri += parsed.pathname;
    }

    const params = new URLSearchParams(parsed.searchParams);
    /* A hand-built mongodb:// URI does NOT inherit the defaults that the
       mongodb+srv:// form implies. Atlas mandates retryable writes, and
       retryWrites defaults to FALSE on a non-SRV URI, which makes Atlas
       reject the connection. Restore it explicitly. */
    if (!params.has("retryWrites")) params.set("retryWrites", "true");
    /* Atlas always requires TLS. The SRV form implies it, so the rebuilt URI
       must state it. TLS is never disabled here. */
    if (!params.has("tls")) params.set("tls", "true");
    if (!params.has("appName")) params.set("appName", "ict-maintenance-service");
    const qs = params.toString();
    if (qs) directUri += `?${qs}`;

    return directUri;
  } catch {
    return null;
  }
}

/* ── Safe diagnostics ──────────────────────────────────────────
   MongoDB driver messages can embed the host list and, in some failure
   modes, fragments of the URI. These helpers report ONLY the hostname
   the client dialled, the database name, the error name and the error
   code. The password, the full MONGO_URI and every secret are never
   rendered into a log line. */
function safeHost(uri) {
  try {
    const probe = uri.replace(/^mongodb\+srv:\/\//, "https://").replace(/^mongodb:\/\//, "https://");
    return new URL(probe).hostname;
  } catch {
    return "unknown-host";
  }
}

function describeMongoError(err) {
  const name = (err && err.name) || "Error";
  const code = (err && (err.codeName || err.code)) ?? "n/a";
  let message = (err && err.message) || "unknown error";
  /* Defence in depth: strip any embedded user:pass before logging. */
  message = String(message).replace(/\/\/[^@/\s]*@/g, "//***:***@");
  return { name, code, message };
}

const connectDB = async () => {
  try {
    const uri = (process.env.MONGO_URI || "").trim();
    const dbName = process.env.MONGO_DB_NAME || "ict_maintenance_db";

    if (!uri) {
      console.error("[MongoDB] MONGO_URI is not set in .env file.");
      process.exit(1);
    }

    const isAtlas = uri.startsWith("mongodb+srv://");

    console.log(
      `[MongoDB] Connecting → host: ${safeHost(uri)} | db: ${dbName} | atlas: ${isAtlas}`,
    );

    /* Connection-pool tuning. Without an explicit pool the driver uses
       maxPoolSize=100 and, critically, maxIdleTimeMS=0 — which means idle
       sockets are NEVER closed. On a single small cloud instance (Render) that
       holds open Atlas connections between bursts of traffic for no benefit,
       and each socket still costs server-side resources. Bounding the pool to
       what one instance can actually use, and reaping idle sockets, both cuts
       cold-start connection churn and memory. */
    const options = {
      serverSelectionTimeoutMS: 15000,
      heartbeatFrequencyMS: 10000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      /* Sized for a single app instance, not a cluster. Raise maxPoolSize only
         if the same process genuinely needs more concurrent operations. */
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
      /* Close sockets idle for >60s instead of holding them forever. */
      maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_MS || 60000),
      /* Never let a request queue behind a saturated pool indefinitely — fail
         fast with a 503-style error the global handler already understands,
         rather than appearing to hang. */
      waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_MS || 10000),
    };

    if (dbName && !uri.includes(`/${dbName}`)) {
      options.dbName = dbName;
    }

    let conn;
    try {
      conn = await mongoose.connect(uri, options);
    } catch (err) {
      if (
        isAtlas &&
        /querySrv|ENOTFOUND|getaddrinfo|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|MongoNetwork|MongoServerSelection|MongoTopology/i.test(
          err.message,
        )
      ) {
        console.warn(
          "[MongoDB] SRV lookup failed — retrying with manually resolved hosts...",
        );
        const directUri = await resolveSrvToDirect(uri);
        if (directUri) {
          conn = await mongoose.connect(directUri, options);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    console.log(
      `[MongoDB] Connected: ${conn.connection.host} / ${conn.connection.name}`,
    );

    mongoose.connection.on("disconnected", () =>
      console.warn("[MongoDB] Disconnected."),
    );
    mongoose.connection.on("error", (err) => {
      const info = describeMongoError(err);
      console.error(`[MongoDB] Runtime error | ${info.name} | code: ${info.code} | ${info.message}`);
    });
  } catch (err) {
    const info = describeMongoError(err);
    console.error(
      `[MongoDB] Connection FAILED — host: ${safeHost(
        (process.env.MONGO_URI || "").trim(),
      )} | db: ${process.env.MONGO_DB_NAME || "ict_maintenance_db"} | ` +
        `${info.name} | code: ${info.code} | ${info.message}`,
    );
    process.exit(1);
  }
};

module.exports = connectDB;
