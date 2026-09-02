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
    if (!params.has("tls")) params.set("tls", "true");
    const qs = params.toString();
    if (qs) directUri += `?${qs}`;

    return directUri;
  } catch {
    return null;
  }
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

    const options = {
      serverSelectionTimeoutMS: 15000,
      heartbeatFrequencyMS: 10000,
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
        /querySrv|ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(err.message)
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
    mongoose.connection.on("error", (err) =>
      console.error("[MongoDB] Error:", err.message),
    );
  } catch (err) {
    console.error(`[MongoDB] Connection failed: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
