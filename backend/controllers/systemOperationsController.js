const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const Settings = require("../models/Settings");
const SystemBackup = require("../models/SystemBackup");
const SystemOperationLock = require("../models/SystemOperationLock");
const { writeAuditLog } = require("../middleware/audit");
const env = require("../config/env");

const LOCK_ID = "database-backup";
const LOCK_LEASE_MS = 2 * 60 * 1000;
const BACKUP_TYPE = "mongodump-archive";
const DEFAULT_MAINTENANCE_NOTICE =
  "The system is temporarily unavailable while scheduled maintenance is in progress. Please try again later.";
const frontendRoot = path.resolve(__dirname, "../../frontend");
const configuredBackupRoot = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(__dirname, "../private_backups/database");

let resolvedBackupRootPromise;
let toolAvailabilityCache = { expiresAt: 0, value: null };
let backupRunning = false;

function safeAudit(req, action, details, success = true, entityId = null) {
  void writeAuditLog({
    user: req.user?.id,
    action,
    entity: "settings",
    entityId,
    details,
    ip: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.headers?.["user-agent"] || "",
    success,
  });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function getBackupRoot() {
  if (!resolvedBackupRootPromise) {
    resolvedBackupRootPromise = (async () => {
      if (
        env.NODE_ENV === "production" &&
        (!process.env.BACKUP_DIR || !path.isAbsolute(process.env.BACKUP_DIR))
      ) {
        throw new Error("Production backups require BACKUP_DIR to be an absolute path on persistent protected storage.");
      }
      if (
        env.NODE_ENV === "production" &&
        process.env.BACKUP_DIR_PERSISTENCE_CONFIRMED !== "true"
      ) {
        throw new Error("Confirm that BACKUP_DIR is mounted on persistent private storage by setting BACKUP_DIR_PERSISTENCE_CONFIRMED=true.");
      }
      if (
        process.platform === "win32" &&
        process.env.BACKUP_DIR_ACL_CONFIRMED !== "true"
      ) {
        throw new Error("On Windows, configure a private BACKUP_DIR ACL and set BACKUP_DIR_ACL_CONFIRMED=true after verifying it.");
      }
      await fs.promises.mkdir(configuredBackupRoot, { recursive: true, mode: 0o700 });
      const realRoot = await fs.promises.realpath(configuredBackupRoot);
      if (isWithin(frontendRoot, realRoot)) {
        throw new Error("BACKUP_DIR must be outside the public frontend directory.");
      }
      if (isWithin(path.resolve(__dirname, "../uploads"), realRoot)) {
        throw new Error("BACKUP_DIR must be outside the public uploads directory.");
      }
      if (process.platform !== "win32") {
        await fs.promises.chmod(realRoot, 0o700);
      }
      const staleBefore = Date.now() - 3 * 60 * 60 * 1000;
      const entries = await fs.promises.readdir(realRoot, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^\.mongodump-[a-f\d-]+\.yaml$/i.test(entry.name))
          .map(async (entry) => {
            const entryPath = path.join(realRoot, entry.name);
            const stats = await fs.promises.lstat(entryPath);
            if (stats.mtimeMs < staleBefore) {
              await fs.promises.unlink(entryPath);
            }
          }),
      );
      return realRoot;
    })().catch((error) => {
      resolvedBackupRootPromise = null;
      throw error;
    });
  }
  return resolvedBackupRootPromise;
}

async function checkBackupStorage() {
  try {
    const root = await getBackupRoot();
    const probePath = path.join(root, `.backup-write-test-${crypto.randomUUID()}`);
    let handle;
    try {
      handle = await fs.promises.open(probePath, "wx", 0o600);
      await handle.writeFile("backup storage readiness check");
      if (process.platform !== "win32") await handle.chmod(0o600);
    } finally {
      if (handle) await handle.close();
      await fs.promises.unlink(probePath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error: sanitizeError(error.message) };
  }
}

function sanitizeError(value) {
  return String(value || "The database backup operation failed.")
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[database URI redacted]")
    .replace(/(password|passwd|pwd)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 1000);
}

function runProcess(binary, args, { timeoutMs = 2 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const appendTail = (current, chunk) =>
      `${current}${chunk.toString("utf8")}`.slice(-4000);
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Database backup utility exceeded the operation time limit."));
    }, timeoutMs);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ ...result, stdout, stderr });
    }

    child.stdout.on("data", (chunk) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendTail(stderr, chunk);
    });
    child.once("error", (error) => {
      if (error.code === "ENOENT") {
        finish(new Error(`${path.basename(binary)} is not installed or not accessible.`));
      } else {
        finish(new Error(`Unable to start ${path.basename(binary)}: ${error.message}`));
      }
    });
    child.once("close", (code, signal) => {
      if (code === 0) finish(null, { code, signal });
      else {
        const output = sanitizeError(stderr || stdout || `Process exited with code ${code}${signal ? ` (${signal})` : ""}.`);
        finish(new Error(`${path.basename(binary)} failed: ${output}`));
      }
    });
  });
}

async function checkBackupTools() {
  if (toolAvailabilityCache.expiresAt > Date.now() && toolAvailabilityCache.value) {
    return toolAvailabilityCache.value;
  }
  const dumpBinary = process.env.MONGODUMP_PATH || "mongodump";
  const restoreBinary = process.env.MONGORESTORE_PATH || "mongorestore";
  const checks = await Promise.all(
    [[dumpBinary, "mongodump"], [restoreBinary, "mongorestore"]].map(
      async ([binary, name]) => {
        try {
          const result = await runProcess(binary, ["--version"], { timeoutMs: 10000 });
          const version = sanitizeError(result.stdout || result.stderr);
          return { name, available: true, version };
        } catch (error) {
          return { name, available: false, message: sanitizeError(error.message) };
        }
      },
    ),
  );
  const value = {
    available: checks.every((tool) => tool.available),
    tools: checks,
    restoreSupported: false,
  };
  toolAvailabilityCache = { expiresAt: Date.now() + 30000, value };
  return value;
}

function safeBackupResponse(record) {
  return {
    id: record._id,
    status: record.status,
    backupType: record.backupType,
    fileSizeBytes: record.fileSizeBytes,
    checksumSha256: record.checksumSha256,
    integrityVerified: record.integrityVerified,
    errorMessage: record.errorMessage,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

function buildMongoConfig() {
  const uri = String(env.MONGO_URI || "").trim();
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error("The configured MongoDB connection URI is invalid.");
  }
  return `uri: ${JSON.stringify(uri)}\n`;
}

function getDatabaseName() {
  const databaseName = String(env.MONGO_DB_NAME || "").trim();
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(databaseName)) {
    throw new Error("MONGO_DB_NAME must contain only letters, numbers, underscores, or hyphens.");
  }
  return databaseName;
}

async function writePrivateConfig(root) {
  const configPath = path.join(root, `.mongodump-${crypto.randomUUID()}.yaml`);
  const handle = await fs.promises.open(configPath, "wx", 0o600);
  try {
    await handle.writeFile(buildMongoConfig(), "utf8");
    if (process.platform !== "win32") await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return configPath;
}

async function sha256File(filePath) {
  const digest = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

async function acquireBackupLock(operationId) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LOCK_LEASE_MS);
  try {
    const lock = await SystemOperationLock.findOneAndUpdate(
      { _id: LOCK_ID, leaseUntil: { $lte: now } },
      { $set: { operationId, leaseUntil } },
      { new: true },
    );
    if (lock) return true;
    await SystemOperationLock.create({ _id: LOCK_ID, operationId, leaseUntil });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function renewBackupLock(operationId) {
  await SystemOperationLock.updateOne(
    { _id: LOCK_ID, operationId },
    { $set: { leaseUntil: new Date(Date.now() + LOCK_LEASE_MS) } },
  );
}

async function releaseBackupLock(operationId) {
  await SystemOperationLock.deleteOne({ _id: LOCK_ID, operationId });
}

async function executeBackup(recordId, adminId, root) {
  let configPath = null;
  let outputPath = null;
  let lockAcquired = true;
  let heartbeat = null;
  try {
    heartbeat = setInterval(() => {
      void Promise.all([
        renewBackupLock(recordId),
        SystemBackup.updateOne(
          { _id: recordId, status: "in_progress" },
          { $set: { updatedAt: new Date() } },
        ),
      ]).catch((error) => {
        console.error(`[Backup] Unable to renew operation lock: ${sanitizeError(error.message)}`);
      });
    }, Math.floor(LOCK_LEASE_MS / 3));

    const createdAt = new Date();
    const fileName = `database-${createdAt.toISOString().replace(/[:.]/g, "-")}-${recordId}.archive.gz`;
    outputPath = path.join(root, fileName);
    const config = await writePrivateConfig(root);
    configPath = config;
    if (!isWithin(root, outputPath) || path.basename(outputPath) !== fileName) {
      throw new Error("The generated backup file path failed validation.");
    }
    try {
      await fs.promises.access(outputPath);
      throw new Error("A backup file with this unique name already exists; it was not overwritten.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const dumpBinary = process.env.MONGODUMP_PATH || "mongodump";
    const dumpResult = await runProcess(dumpBinary, [
      "--config", config,
      "--db", getDatabaseName(),
      "--archive", outputPath,
      "--gzip",
    ]);
    const stats = await fs.promises.stat(outputPath);
    if (!stats.isFile() || stats.size < 1) {
      throw new Error("mongodump completed without producing a non-empty archive.");
    }
    if (process.platform !== "win32") await fs.promises.chmod(outputPath, 0o600);

    const restoreBinary = process.env.MONGORESTORE_PATH || "mongorestore";
    await runProcess(restoreBinary, [
      "--config", config,
      "--db", getDatabaseName(),
      "--archive", outputPath,
      "--gzip",
      "--dryRun",
    ]);
    const checksumSha256 = await sha256File(outputPath);

    await SystemBackup.findByIdAndUpdate(recordId, {
      $set: {
        status: "completed",
        fileName,
        fileSizeBytes: stats.size,
        checksumSha256,
        integrityVerified: true,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    await writeAuditLog({
      user: adminId,
      action: "Completed database backup",
      entity: "settings",
      entityId: String(recordId),
      details: `Verified compressed MongoDB archive (${stats.size} bytes; SHA-256 recorded).`,
      success: true,
    });
    void dumpResult;
  } catch (error) {
    const message = sanitizeError(error.message);
    if (outputPath) {
      try {
        const root = await getBackupRoot();
        if (isWithin(root, outputPath)) await fs.promises.unlink(outputPath).catch(() => {});
      } catch (_) {
        /* Preserve the backup error if protected storage is unavailable. */
      }
    }
    const failedBackup = await SystemBackup.findByIdAndUpdate(
      recordId,
      {
        $set: {
          status: "failed",
          integrityVerified: false,
          errorMessage: message,
          completedAt: new Date(),
        },
      },
      { new: true },
    );
    if (failedBackup?.fileName) {
      try {
        const root = await getBackupRoot();
        const failedPath = path.join(root, path.basename(failedBackup.fileName));
        if (isWithin(root, failedPath)) await fs.promises.unlink(failedPath).catch(() => {});
      } catch (_) {
        /* Keep the operation failure as the primary error. */
      }
    }
    await writeAuditLog({
      user: adminId,
      action: "Failed database backup",
      entity: "settings",
      entityId: String(recordId),
      details: message,
      success: false,
    });
  } finally {
    if (configPath) await fs.promises.unlink(configPath).catch(() => {});
    if (heartbeat) clearInterval(heartbeat);
    if (lockAcquired) {
      await releaseBackupLock(recordId).catch((error) => {
        console.error(`[Backup] Unable to release operation lock: ${sanitizeError(error.message)}`);
      });
    }
    backupRunning = false;
  }
}

const getOperationsStatus = async (_req, res, next) => {
  try {
    const databaseState = mongoose.connection.readyState;
    const databaseConnected = databaseState === 1;
    const databaseStateName = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    }[databaseState] || "unknown";
    const storage = await checkBackupStorage();
    const settings = await Settings.getInstance();
    const tools = await checkBackupTools();
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        databaseConnected,
        databaseState: databaseStateName,
        backupDirectoryReady: storage.ready,
        backupDirectoryWritable: storage.ready,
        backupDirectoryError: storage.error,
        backupInProgress: backupRunning,
        backupReady: databaseConnected && storage.ready && tools.available,
        maintenance: {
          enabled: settings.maintenanceMode === true,
          notice: settings.maintenanceNotice || DEFAULT_MAINTENANCE_NOTICE,
          updatedAt: settings.maintenanceUpdatedAt || null,
          updatedBy: settings.maintenanceUpdatedBy || null,
        },
        ...tools,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMaintenanceStatus = async (_req, res, next) => {
  try {
    const settings = await Settings.getInstance();
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        enabled: settings.maintenanceMode === true,
        notice: settings.maintenanceNotice || DEFAULT_MAINTENANCE_NOTICE,
        updatedAt: settings.maintenanceUpdatedAt || null,
        updatedBy: settings.maintenanceUpdatedBy || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateMaintenance = async (req, res, next) => {
  try {
    const { enabled, notice } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "Maintenance status must be a boolean." });
    }
    if (typeof notice !== "string" || notice.trim().length < 10 || notice.trim().length > 500) {
      return res.status(400).json({ success: false, message: "The maintenance notice must be between 10 and 500 characters." });
    }
    const settings = await Settings.getInstance();
    const previous = {
      enabled: settings.maintenanceMode === true,
      notice: settings.maintenanceNotice || DEFAULT_MAINTENANCE_NOTICE,
    };
    settings.maintenanceMode = enabled;
    settings.maintenanceNotice = notice.trim();
    settings.maintenanceUpdatedAt = new Date();
    settings.maintenanceUpdatedBy = req.user.id;
    settings.updatedBy = req.user.id;
    await settings.save();
    Settings.invalidateInstanceCache();
    safeAudit(
      req,
      enabled ? "Enabled maintenance mode" : "Disabled maintenance mode",
      JSON.stringify({
        previousEnabled: previous.enabled,
        enabled,
        noticeChanged: previous.notice !== notice.trim(),
        previousNotice: previous.notice,
        notice: notice.trim(),
      }),
      true,
      String(settings._id),
    );
    res.json({
      success: true,
      data: {
        enabled: settings.maintenanceMode,
        notice: settings.maintenanceNotice,
        updatedAt: settings.maintenanceUpdatedAt,
        updatedBy: settings.maintenanceUpdatedBy,
      },
      message: `Maintenance mode ${enabled ? "enabled" : "disabled"}.`,
    });
  } catch (error) {
    next(error);
  }
};

const listBackups = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    await SystemBackup.updateMany(
      {
        status: "in_progress",
        updatedAt: { $lt: new Date(Date.now() - LOCK_LEASE_MS * 2) },
      },
      {
        $set: {
          status: "failed",
          integrityVerified: false,
          errorMessage: "The backup operation stopped before completion.",
          completedAt: new Date(),
        },
      },
    );
    const [backups, latestSuccessful] = await Promise.all([
      SystemBackup.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("createdBy", "fullName")
        .lean(),
      SystemBackup.findOne({ status: "completed", integrityVerified: true })
        .sort({ completedAt: -1 })
        .populate("createdBy", "fullName")
        .lean(),
    ]);
    res.json({
      success: true,
      data: backups.map((backup) => ({
        ...safeBackupResponse(backup),
        createdBy: backup.createdBy?.fullName || "Administrator",
      })),
      latestSuccessful: latestSuccessful
        ? {
            ...safeBackupResponse(latestSuccessful),
            createdBy: latestSuccessful.createdBy?.fullName || "Administrator",
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
};

const createBackup = async (req, res, next) => {
  if (backupRunning) {
    return res.status(409).json({ success: false, message: "A database backup is already running." });
  }
  backupRunning = true;
  let lockAcquired = false;
  let backupId = null;
  try {
    const tools = await checkBackupTools();
    if (!tools.available) {
      safeAudit(req, "Rejected database backup", "Required MongoDB Database Tools are unavailable.", false);
      backupRunning = false;
      return res.status(503).json({
        success: false,
        message: "MongoDB Database Tools are not available on this server. Configure MONGODUMP_PATH and MONGORESTORE_PATH.",
      });
    }
    const root = await getBackupRoot();
    const backup = await SystemBackup.create({
      status: "in_progress",
      backupType: BACKUP_TYPE,
      fileName: `pending-${crypto.randomUUID()}.archive.gz`,
      createdBy: req.user.id,
    });
    backupId = backup._id;
    lockAcquired = await acquireBackupLock(backup._id);
    if (!lockAcquired) {
      await SystemBackup.findByIdAndDelete(backup._id);
      backupRunning = false;
      return res.status(409).json({ success: false, message: "A database backup is already running on another server instance." });
    }
    safeAudit(req, "Started database backup", "Admin initiated a MongoDB archive backup.", true, String(backup._id));
    void executeBackup(backup._id, req.user.id, root).catch((error) => {
      console.error(`[Backup] Background operation failed unexpectedly: ${sanitizeError(error.message)}`);
    });
    lockAcquired = false;
    res.status(202).json({
      success: true,
      data: safeBackupResponse(backup),
      message: "Database backup started. Refresh the history to follow its progress.",
    });
  } catch (error) {
    if (lockAcquired && backupId) {
      await releaseBackupLock(backupId).catch(() => {});
    }
    if (backupId) {
      await SystemBackup.findByIdAndDelete(backupId).catch(() => {});
    }
    backupRunning = false;
    safeAudit(req, "Failed to start database backup", sanitizeError(error.message), false);
    next(error);
  }
};

const downloadBackup = async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ""))) {
      return res.status(404).json({ success: false, message: "Backup not found." });
    }
    const backup = await SystemBackup.findById(req.params.id).lean();
    if (!backup || backup.status !== "completed" || !backup.integrityVerified) {
      return res.status(404).json({ success: false, message: "Verified backup not found." });
    }
    const root = await getBackupRoot();
    const fileName = path.basename(backup.fileName);
    const filePath = path.resolve(root, fileName);
    if (fileName !== backup.fileName || !isWithin(root, filePath)) {
      safeAudit(req, "Rejected unsafe backup download", "Stored backup path failed validation.", false, String(backup._id));
      return res.status(404).json({ success: false, message: "Backup not found." });
    }
    const stats = await fs.promises.lstat(filePath);
    if (
      !stats.isFile() ||
      stats.size !== backup.fileSizeBytes ||
      (await sha256File(filePath)) !== backup.checksumSha256
    ) {
      safeAudit(req, "Rejected invalid backup download", "Backup file missing or size changed after integrity verification.", false, String(backup._id));
      return res.status(409).json({ success: false, message: "The backup file failed its integrity check." });
    }
    res.download(filePath, `database-backup-${backup._id}.archive.gz`, (error) => {
      safeAudit(
        req,
        error ? "Failed database backup download" : "Downloaded database backup",
        error ? "The verified backup could not be transferred." : `Downloaded verified archive (${stats.size} bytes).`,
        !error,
        String(backup._id),
      );
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOperationsStatus,
  getMaintenanceStatus,
  updateMaintenance,
  listBackups,
  createBackup,
  downloadBackup,
};
