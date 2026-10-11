/**
 * controllers/reportController.js
 * Analytics and reporting — ICT Admin dashboard data
 */
const ExcelJS = require("exceljs");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const ICTAsset = require("../models/ICTAsset");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const Feedback = require("../models/Feedback");
const Category = require("../models/Category");
const Settings = require("../models/Settings");
const { displayTicketId } = require("../utils/ticketId");
const {
  ICT_CATEGORY_GROUPS,
  isNetworkICTCategory,
} = require("../utils/ictCategoryHierarchy");

const NETWORK_CATEGORY_VALUES = [
  "Network Maintenance",
  "Networking",
  ...ICT_CATEGORY_GROUPS.flatMap(({ categories }) =>
    categories
      .filter(isNetworkICTCategory)
      .flatMap((category) => [category, `ICT Support > ${category}`]),
  ),
];

const dashboardCount = (value, field) => {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    const error = new Error(`Dashboard query returned an invalid ${field} count.`);
    error.code = "INVALID_DASHBOARD_COUNT";
    throw error;
  }
  return count;
};

const DEFAULT_REPORT_TIMEZONE = "Africa/Addis_Ababa";
const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const getReportTimezone = async () => {
  try {
    const settings = await Settings.getInstance();
    return settings?.timezone || DEFAULT_REPORT_TIMEZONE;
  } catch {
    return DEFAULT_REPORT_TIMEZONE;
  }
};

const getTimezoneOffsetMinutes = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  const localDate = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );

  return (localDate - date.getTime()) / 60000;
};

/* Parse a strict, real calendar date (YYYY-MM-DD). Returns the parts or null so
   an impossible date such as 2026-02-30 or 2026-13-01 is rejected instead of
   being silently normalised by the Date constructor. */
const parseCalendarDate = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!REPORT_DATE_RE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

/* UTC instant at 00:00 local time for a calendar date in the reporting zone. */
const zonedStartOfDay = (year, month, day, timeZone) => {
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMinutes = getTimezoneOffsetMinutes(
    new Date(utcMidnight),
    timeZone,
  );
  return utcMidnight - offsetMinutes * 60000;
};

/* Build the createdAt range for an INCLUSIVE start/end pair of calendar dates.
   The upper bound is the start of the following day, so the range is
   [start, nextDay) and midnight is never double-counted. Month lengths and leap
   years are honoured because the next day is derived from the Date object. */
const buildCreatedAtRange = (startDate, endDate, timeZone) => {
  const startMs = zonedStartOfDay(
    startDate.year,
    startDate.month,
    startDate.day,
    timeZone,
  );
  const nextDay = new Date(
    Date.UTC(endDate.year, endDate.month - 1, endDate.day),
  );
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endMs = zonedStartOfDay(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    timeZone,
  );
  return { createdAt: { $gte: new Date(startMs), $lt: new Date(endMs) } };
};

const reportPeriodError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const REPORT_PERIODS = new Set(["all", "daily", "monthly", "yearly", "custom"]);

/* Resolve the requested reporting period into both a createdAt match and a
   human-readable label. Returns { match, period, label }; match is null when no
   date filter applies. Invalid input raises a 400 (statusCode) error.

   The reporting timezone comes from the app's system settings (default
   Africa/Addis_Ababa) — not a fixed UTC assumption — so a "day" means the
   calendar day the admin actually sees. The upper bound is exclusive. */
const resolveReportRange = async (req) => {
  const query = req.query || {};
  const rawPeriod = String(query.period || query.reportPeriod || "")
    .trim()
    .toLowerCase();
  const startInput =
    query.dateFrom || query.startDate || query.fromDate || null;
  const endInput = query.dateTo || query.endDate || query.toDate || null;

  let period = rawPeriod;
  if (!period) period = startInput || endInput ? "custom" : "all";
  if (!REPORT_PERIODS.has(period)) {
    throw reportPeriodError("Unknown report period.");
  }

  if (period === "all") {
    return { match: null, period, label: "All time" };
  }

  const timeZone = await getReportTimezone();

  if (period === "daily") {
    const dayInput = query.date || query.reportDate || startInput;
    const day = parseCalendarDate(dayInput);
    if (!day) {
      throw reportPeriodError(
        "A valid day (YYYY-MM-DD) is required for a daily report.",
      );
    }
    return {
      match: buildCreatedAtRange(day, day, timeZone),
      period,
      label: `Daily report: ${String(dayInput).trim()}`,
    };
  }

  if (period === "monthly") {
    let year = Number(query.year);
    let month = Number(query.month);
    const monthValue =
      typeof query.month === "string" ? query.month.trim() : "";
    if (/^\d{4}-\d{2}$/.test(monthValue)) {
      year = Number(monthValue.slice(0, 4));
      month = Number(monthValue.slice(5, 7));
    }
    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      throw reportPeriodError("A valid year is required for a monthly report.");
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw reportPeriodError(
        "A valid month (1-12) is required for a monthly report.",
      );
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      match: buildCreatedAtRange(
        { year, month, day: 1 },
        { year, month, day: lastDay },
        timeZone,
      ),
      period,
      label: `Monthly report: ${year}-${String(month).padStart(2, "0")}`,
    };
  }

  if (period === "yearly") {
    const year = Number(query.year);
    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      throw reportPeriodError("A valid year is required for a yearly report.");
    }
    return {
      match: buildCreatedAtRange(
        { year, month: 1, day: 1 },
        { year, month: 12, day: 31 },
        timeZone,
      ),
      period,
      label: `Yearly report: ${year}`,
    };
  }

  /* custom — inclusive start/end calendar dates. String comparison is safe
     because both values are validated YYYY-MM-DD. */
  const start = parseCalendarDate(startInput);
  const end = parseCalendarDate(endInput);
  if (!start || !end) {
    throw reportPeriodError(
      "A valid start and end date (YYYY-MM-DD) are required for a custom range.",
    );
  }
  if (String(startInput).trim() > String(endInput).trim()) {
    throw reportPeriodError("Start date cannot be later than end date.");
  }
  return {
    match: buildCreatedAtRange(start, end, timeZone),
    period,
    label: `Custom range: ${String(startInput).trim()} to ${String(endInput).trim()}`,
  };
};

/* Backwards-compatible helper: just the $match filter (or null). */
const buildDateMatch = async (req) => (await resolveReportRange(req)).match;

const REPORT_SYSTEM_NAME = "Smart ICT Maintenance Management System";

/* ── Reusable report aggregations ─────────────────────────────
   Shared by the individual endpoints and the Excel export so the on-screen
   figures and the exported figures are produced by exactly the same queries. */

/* Requests grouped by status, highest first. */
const statusBreakdown = async (dateMatch) => {
  const pipeline = [];
  if (dateMatch) pipeline.push({ $match: dateMatch });
  pipeline.push(
    { $group: { _id: "$status", total: { $sum: 1 } } },
    { $project: { _id: 0, status: "$_id", total: 1 } },
    { $sort: { total: -1 } },
  );
  return Ticket.aggregate(pipeline);
};

/* Requests grouped by their free-text category, merged with the canonical
   category list and a final "Uncategorised" bucket. */
const normalizeCategoryKey = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const separator = lower.lastIndexOf(">");
  return separator >= 0 ? lower.slice(separator + 1).trim() : lower.trim();
};

const categoryBreakdown = async (dateMatch) => {
  const pipeline = [];
  if (dateMatch) pipeline.push({ $match: dateMatch });

  const grouped = await Ticket.aggregate(
    [
      ...pipeline,
      {
        $group: {
          _id: { $ifNull: ["$category", ""] },
          total: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          total: 1,
        },
      },
      { $sort: { total: -1, category: 1 } },
    ],
    { allowDiskUse: true },
  );

  const countMap = {};
  grouped.forEach((row) => {
    const key = normalizeCategoryKey(row.category);
    if (!key) {
      countMap[""] = (countMap[""] || 0) + Number(row.total || 0);
      return;
    }
    countMap[key] = (countMap[key] || 0) + Number(row.total || 0);
  });

  const categoryRows = new Map();
  for (const { categories } of ICT_CATEGORY_GROUPS) {
    for (const name of categories) {
      const key = normalizeCategoryKey(name);
      if (key) categoryRows.set(key, { _id: null, name });
    }
  }

  const cats = await Category.find({}, { name: 1, description: 1 }).sort({ name: 1 }).lean();
  for (const category of cats) {
    const key = normalizeCategoryKey(category.name);
    if (!key) continue;
    categoryRows.set(key, {
      _id: category._id,
      name: category.name,
      description: category.description || null,
    });
  }

  const data = [];
  const matched = new Set();
  const orderedKeys = Array.from(categoryRows.keys()).sort((a, b) => a.localeCompare(b));

  for (const key of orderedKeys) {
    const total = countMap[key] || 0;
    if (!total) continue;
    matched.add(key);
    const category = categoryRows.get(key);
    data.push({
      _id: category._id,
      name: category.name,
      description: category.description || null,
      total,
    });
  }

  let uncategorised = 0;
  for (const [key, total] of Object.entries(countMap)) {
    if (key && !matched.has(key)) uncategorised += Number(total || 0);
  }
  uncategorised += countMap[""] || 0;
  if (uncategorised) {
    data.push({
      _id: null,
      name: "Uncategorised",
      description: "Requests without a matching category",
      total: uncategorised,
    });
  }

  return data;
};

/* Period summary metrics: total, completed (resolved+closed), pending
   (submitted+under_review), in-progress and average resolution time. */
const reportSummary = async (dateMatch) => {
  const [row] = await Ticket.aggregate([
    ...(dateMatch ? [{ $match: dateMatch }] : []),
    {
      $facet: {
        counts: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              submitted: {
                $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] },
              },
              under_review: {
                $sum: { $cond: [{ $eq: ["$status", "under_review"] }, 1, 0] },
              },
              assigned: {
                $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] },
              },
              accepted: {
                $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
              },
              in_progress: {
                $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
              },
              resolved: {
                $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
              },
              closed: {
                $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] },
              },
            },
          },
        ],
        resolution: [
          { $match: { status: { $in: ["resolved", "closed"] } } },
          {
            $project: {
              created: "$createdAt",
              completed: {
                $ifNull: ["$technicianFeedback.completionDate", "$updatedAt"],
              },
            },
          },
          { $match: { created: { $ne: null }, completed: { $ne: null } } },
          {
            $group: {
              _id: null,
              avgMs: { $avg: { $subtract: ["$completed", "$created"] } },
            },
          },
        ],
      },
    },
  ]);

  const counts = row?.counts?.[0] || {};
  const submitted = Number(counts.submitted || 0);
  const under_review = Number(counts.under_review || 0);
  const assigned = Number(counts.assigned || 0);
  const accepted = Number(counts.accepted || 0);
  const in_progress = Number(counts.in_progress || 0);
  const resolved = Number(counts.resolved || 0);
  const closed = Number(counts.closed || 0);
  const avgMs = row?.resolution?.[0]?.avgMs;

  return {
    total: Number(counts.total || 0),
    submitted,
    under_review,
    assigned,
    accepted,
    in_progress,
    resolved,
    closed,
    pending: submitted + under_review,
    completed: resolved + closed,
    avgResolutionHours:
      avgMs != null
        ? Math.round((avgMs / 3600000 + Number.EPSILON) * 10) / 10
        : null,
  };
};

/* GET /api/reports/dashboard */
const getDashboardStats = async (req, res, next) => {
  try {
    const dateMatch = await buildDateMatch(req);
    const ticketMatch = dateMatch || {};

    /* Overdue = still-open tickets older than the admin's SLA window
       (slResponseHours from the Settings singleton, default 24h). The date
       filter, when present, narrows the range to what the user selected. */
    const [settings, userCount, assetCount, technicianCount, avg_feedback] =
      await Promise.all([
        Settings.getInstance(),
        User.countDocuments(),
        ICTAsset.countDocuments(),
        Technician.countDocuments(),
        Feedback.aggregate([
          {
            $group: {
              _id: null,
              avg: { $avg: "$rating" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);
    const total_users = dashboardCount(userCount, "total_users");
    const total_assets = dashboardCount(assetCount, "total_assets");
    const total_technicians = dashboardCount(
      technicianCount,
      "total_technicians",
    );
    const slaHours = Number(settings?.slaResponseHours) || 24;
    const overdueThreshold = new Date(Date.now() - slaHours * 3600 * 1000);
    const overdueCreated = { ...(ticketMatch.createdAt || {}) };
    if (!overdueCreated.$lte || overdueCreated.$lte > overdueThreshold) {
      overdueCreated.$lte = overdueThreshold;
    }

    const [ticketStats] = await Ticket.aggregate([
      ...(Object.keys(ticketMatch).length ? [{ $match: ticketMatch }] : []),
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                total_tickets: { $sum: 1 },
                submitted: {
                  $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] },
                },
                under_review: {
                  $sum: { $cond: [{ $eq: ["$status", "under_review"] }, 1, 0] },
                },
                assigned: {
                  $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] },
                },
                accepted: {
                  $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
                },
                in_progress: {
                  $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
                },
                resolved: {
                  $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
                },
                closed: {
                  $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] },
                },
                network_total: {
                  $sum: {
                    $cond: [
                      { $in: ["$category", NETWORK_CATEGORY_VALUES] },
                      1,
                      0,
                    ],
                  },
                },
                network_pending: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$category", NETWORK_CATEGORY_VALUES] },
                          { $in: ["$status", ["submitted", "under_review"]] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                network_in_progress: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$category", NETWORK_CATEGORY_VALUES] },
                          { $eq: ["$status", "in_progress"] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                network_resolved: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$category", NETWORK_CATEGORY_VALUES] },
                          { $in: ["$status", ["resolved", "closed"]] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          overdue: [
            {
              $match: {
                status: { $nin: ["resolved", "closed"] },
                createdAt: overdueCreated,
              },
            },
            { $count: "count" },
          ],
          resolution: [
            { $match: { status: { $in: ["resolved", "closed"] } } },
            {
              $project: {
                created: "$createdAt",
                completed: {
                  $ifNull: ["$technicianFeedback.completionDate", "$updatedAt"],
                },
              },
            },
            { $match: { created: { $ne: null }, completed: { $ne: null } } },
            {
              $group: {
                _id: null,
                avgMs: { $avg: { $subtract: ["$completed", "$created"] } },
              },
            },
          ],
        },
      },
    ]);
    const counts = ticketStats?.counts?.[0] || {};
    const submitted = dashboardCount(counts.submitted, "submitted");
    const under_review = dashboardCount(counts.under_review, "under_review");
    const assigned = dashboardCount(counts.assigned, "assigned");
    const accepted = dashboardCount(counts.accepted, "accepted");
    const in_progress = dashboardCount(counts.in_progress, "in_progress");
    const resolved = dashboardCount(counts.resolved, "resolved");
    const closed = dashboardCount(counts.closed, "closed");
    const total_tickets = dashboardCount(counts.total_tickets, "total_tickets");
    const network_total = dashboardCount(counts.network_total, "network_total");
    const network_pending = dashboardCount(
      counts.network_pending,
      "network_pending",
    );
    const network_in_progress = dashboardCount(
      counts.network_in_progress,
      "network_in_progress",
    );
    const network_resolved = dashboardCount(
      counts.network_resolved,
      "network_resolved",
    );
    const overdue = dashboardCount(
      ticketStats?.overdue?.[0]?.count,
      "overdue",
    );
    const avg_resolution = ticketStats?.resolution || [];

    const pending = (submitted || 0) + (under_review || 0);
    const completed = (resolved || 0) + (closed || 0);
    const avgResolutionHours =
      avg_resolution[0]?.avgMs != null
        ? Math.round(
            (avg_resolution[0].avgMs / 3600000 + Number.EPSILON) * 10,
          ) / 10
        : null;

    res.json({
      success: true,
      data: {
        total_users,
        total_assets,
        total_technicians,
        submitted,
        under_review,
        assigned,
        accepted,
        pending,
        in_progress,
        resolved,
        closed,
        completed,
        total_tickets,
        overdue: overdue || 0,
        avg_resolution_hours: avgResolutionHours,
        avg_rating: avg_feedback[0]?.avg
          ? Math.round(avg_feedback[0].avg * 10) / 10
          : 0,
        total_feedback: dashboardCount(
          avg_feedback[0]?.count,
          "total_feedback",
        ),
        network_total,
        network_pending,
        network_in_progress,
        network_resolved,
      },
    });
  } catch (err) {
    /* A bad report period/date is a client error, not a statistics failure. */
    if (err && err.statusCode === 400) {
      return next(err);
    }
    console.error("[reports.dashboard] Statistics query failed.", {
      errorName: err?.name || "Error",
      errorCode: err?.code || null,
    });
    const safeError = new Error("Dashboard statistics could not be loaded.");
    safeError.statusCode = 500;
    safeError.cause = err;
    next(safeError);
  }
};

/* GET /api/reports/requests-by-status */
const getRequestsByStatus = async (req, res, next) => {
  try {
    const dateMatch = await buildDateMatch(req);
    res.json({ success: true, data: await statusBreakdown(dateMatch) });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-equipment */
const getRequestsByEquipment = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = await buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      { $group: { _id: "$equipmentType", total: { $sum: 1 } } },
      { $project: { _id: 0, equipmentType: "$_id", total: 1 } },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/technician-performance */
const getTechnicianPerformance = async (req, res, next) => {
  try {
    const dateMatch = await buildDateMatch(req);

    /* One grouped aggregation instead of hydrating every assignment plus two
       populated collections.

       The previous implementation loaded EVERY assignment document and
       populated the technician, its user and the ticket for each one — five
       sequential round trips and ~37 KB of hydrated documents, all to
       produce one small row per technician. Measured over the Atlas link that
       was ~5.9 s; this aggregation returns the same numbers in a single
       round trip (~1.8 s) and ~1 KB.

       preserveNullAndEmptyArrays keeps assignments whose ticket document is
       missing, so they are still counted as before rather than silently
       vanishing. */
    const createdMatch = dateMatch && dateMatch.createdAt;
    const rows = await Assignment.aggregate([
      {
        $lookup: {
          from: "tickets",
          localField: "ticket",
          foreignField: "_id",
          as: "t",
        },
      },
      { $unwind: { path: "$t", preserveNullAndEmptyArrays: true } },
      /* The previous code only applied the date filter to assignments whose
         ticket had a createdAt, so that is replicated exactly. */
      ...(createdMatch
        ? [
            {
              $match: {
                $or: [
                  { "t.createdAt": { $exists: false } },
                  { "t.createdAt": createdMatch },
                ],
              },
            },
          ]
        : []),
      {
        $lookup: {
          from: "technicians",
          localField: "technician",
          foreignField: "_id",
          as: "tech",
        },
      },
      { $unwind: { path: "$tech", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "tech.user",
          foreignField: "_id",
          as: "u",
        },
      },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ["$u.fullName", "Unknown"] },
          assigned: { $sum: 1 },
          resolved: {
            $sum: {
              $cond: [{ $in: ["$t.status", ["resolved", "closed"]] }, 1, 0],
            },
          },
          resolveHours: {
            $push: {
              $cond: [
                { $in: ["$t.status", ["resolved", "closed"]] },
                /* Hours = completion (or last update) - created. Values that
                   are missing, non-numeric or negative are discarded by the
                   JS-side filter below rather than inside the pipeline, which
                   keeps this expression simple and portable. */
                {
                  $let: {
                    vars: {
                      created: "$t.createdAt",
                      done: {
                        $ifNull: [
                          "$t.technicianFeedback.completionDate",
                          "$t.updatedAt",
                        ],
                      },
                    },
                    in: {
                      $divide: [
                        { $subtract: ["$$done", "$$created"] },
                        3600000,
                      ],
                    },
                  },
                },
                "$$REMOVE",
              ],
            },
          },
          resolvedTicketIds: {
            $push: {
              $cond: [
                { $in: ["$t.status", ["resolved", "closed"]] },
                /* $t._id, NOT $_id: inside $group, $_id is the group key
                   (the technician name). Using it here silently produced the
                   wrong ticket ids and emptied every average rating. */
                { $toString: "$t._id" },
                "$$REMOVE",
              ],
            },
          },
        },
      },
      { $project: { _id: 1, assigned: 1, resolved: 1, resolveHours: 1, resolvedTicketIds: 1 } },
    ]);

    const map = {};
    const resolvedTicketIds = [];
    for (const r of rows) {
      const name = r._id || "Unknown";
      map[name] = {
        name,
        assigned: r.assigned,
        resolved: r.resolved,
        resolveHours: (r.resolveHours || []).filter(
          (h) => typeof h === "number" && Number.isFinite(h) && h >= 0,
        ),
        resolvedTicketIds: r.resolvedTicketIds || [],
      };
      for (const id of map[name].resolvedTicketIds) resolvedTicketIds.push(String(id));
    }

    /* Real average service-satisfaction rating per technician — pulled from the
       Feedback records attached to the tickets they resolved. */
    const ratingsByRequest = {};
    if (resolvedTicketIds.length) {
      const feedbackRows = await Feedback.find({
        request: { $in: resolvedTicketIds },
      })
        .select("request rating")
        .lean();
      for (const f of feedbackRows) {
        if (typeof f.rating === "number")
          ratingsByRequest[String(f.request)] = f.rating;
      }
    }

    const data = Object.values(map)
      .map((row) => {
        const selfRatings = row.resolvedTicketIds
          .map((id) => ratingsByRequest[id])
          .filter((r) => typeof r === "number");
        const avgRating = selfRatings.length
          ? Math.round(
              (selfRatings.reduce((sum, r) => sum + r, 0) /
                selfRatings.length) *
                10,
            ) / 10
          : null;
        const avgResolvedHours = row.resolveHours.length
          ? Math.round(
              (row.resolveHours.reduce((sum, h) => sum + h, 0) /
                row.resolveHours.length) *
                10,
            ) / 10
          : null;
        return {
          name: row.name,
          assigned: row.assigned,
          resolved: row.resolved,
          avgRating,
          avgResolvedHours,
        };
      })
      .sort((a, b) => b.resolved - a.resolved);

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-department */
const getRequestsByDepartment = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = await buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      {
        $lookup: {
          from: "users",
          localField: "requester",
          foreignField: "_id",
          as: "u",
        },
      },
      { $unwind: "$u" },
      { $match: { "u.department": { $ne: null } } },
      {
        $group: {
          _id: "$u.department",
          total: { $sum: 1 },
          resolved: {
            $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
          },
          closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          department: "$_id",
          total: 1,
          resolved: 1,
          closed: 1,
        },
      },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/recent-feedback */
const getRecentFeedback = async (req, res, next) => {
  try {
    const feedback = await Feedback.find()
      .populate("user", "fullName")
      .populate({
        path: "request",
        select: "ticketId equipmentType requester",
        populate: { path: "requester", select: "fullName" },
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    feedback.forEach((fb) => {
      if (fb.request && fb.request.ticketId)
        fb.request.ticketId = displayTicketId(fb.request.ticketId);
    });
    res.json({ success: true, data: feedback });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-category */
const getRequestsByCategory = async (req, res, next) => {
  try {
    const dateMatch = await buildDateMatch(req);
    res.json({ success: true, data: await categoryBreakdown(dateMatch) });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-issue-type — Issue Type / Service Type
   breakdown (ICT Admin).

   Groups requests by the Issue Type the requester actually chose — the field
   that answers "what problem or service is required?". This is deliberately a
   field of its own: it is never derived from, merged into, or reported under
   Category, Device Type or ICT Asset.

   Legacy rows predate the dedicated `issueType` field, so `serviceType` is used
   as a fallback in the aggregation only, so historical requests are still
   represented in the totals instead of silently disappearing. */
const getRequestsByIssueType = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = await buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });

    const grouped = await Ticket.aggregate([
      ...pipeline,
      {
        $group: {
          _id: {
            $ifNull: [
              {
                $trim: { input: { $ifNull: ["$issueType", ""] } },
              },
              {
                $trim: { input: { $ifNull: ["$serviceType", ""] } },
              },
              "Unspecified",
            ],
          },
          total: { $sum: 1 },
          resolved: {
            $sum: {
              $cond: [{ $in: ["$status", ["resolved", "closed"]] }, 1, 0],
            },
          },
          open: {
            $sum: {
              $cond: [{ $in: ["$status", ["resolved", "closed"]] }, 0, 1],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          issueType: "$_id",
          total: 1,
          resolved: 1,
          open: 1,
        },
      },
      { $sort: { total: -1, issueType: 1 } },
    ]);

    /* Attach the requester-chosen Category for each issue type so a report
       reader can tell which ICT area each problem came from. */
    const rows = grouped.map((row) => ({
      issueType: row.issueType,
      total: Number(row.total || 0),
      resolved: Number(row.resolved || 0),
      open: Number(row.open || 0),
    }));

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

const NETWORK_CATEGORY = "Network Maintenance";

/* GET /api/reports/network — network maintenance analytics (ICT Admin) */
const getNetworkReports = async (req, res, next) => {
  try {
    const dateMatch = await buildDateMatch(req);
    const baseMatch = { category: NETWORK_CATEGORY, ...(dateMatch || {}) };

    const [byServiceType, byStatus, byDepartment, byDevice, history] =
      await Promise.all([
        Ticket.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: { $ifNull: ["$serviceType", "Unspecified"] },
              total: { $sum: 1 },
              resolved: {
                $sum: {
                  $cond: [{ $in: ["$status", ["resolved", "closed"]] }, 1, 0],
                },
              },
            },
          },
          { $project: { _id: 0, serviceType: "$_id", total: 1, resolved: 1 } },
          { $sort: { total: -1 } },
        ]),
        Ticket.aggregate([
          { $match: baseMatch },
          { $group: { _id: "$status", total: { $sum: 1 } } },
          { $project: { _id: 0, status: "$_id", total: 1 } },
          { $sort: { total: -1 } },
        ]),
        Ticket.aggregate([
          { $match: baseMatch },
          {
            $lookup: {
              from: "users",
              localField: "requester",
              foreignField: "_id",
              as: "u",
            },
          },
          { $unwind: "$u" },
          { $match: { "u.department": { $ne: null } } },
          {
            $group: {
              _id: "$u.department",
              total: { $sum: 1 },
              resolved: {
                $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
              },
            },
          },
          { $project: { _id: 0, department: "$_id", total: 1, resolved: 1 } },
          { $sort: { total: -1 } },
        ]),
        Ticket.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: { $ifNull: ["$networkDevice", "Unspecified"] },
              total: { $sum: 1 },
            },
          },
          { $project: { _id: 0, device: "$_id", total: 1 } },
          { $sort: { total: -1 } },
        ]),
        Ticket.find(baseMatch)
          .populate("requester", "fullName department")
          .sort({ createdAt: -1 })
          .limit(20)
          .select(
            "ticketId title serviceType issueType networkDevice status priority createdAt requester",
          )
          .lean(),
      ]);

    history.forEach((h) => {
      if (h.ticketId) h.ticketId = displayTicketId(h.ticketId);
    });

    res.json({
      success: true,
      data: {
        byServiceType,
        byStatus,
        byDepartment,
        byDevice,
        history,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/export — downloadable Excel workbook for the selected
   reporting period. Uses the same aggregations as the on-screen report so the
   exported figures always match what is displayed. */
const getReportExport = async (req, res, next) => {
  try {
    const range = await resolveReportRange(req);
    const [summary, statusRows, categoryRows] = await Promise.all([
      reportSummary(range.match),
      statusBreakdown(range.match),
      categoryBreakdown(range.match),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = REPORT_SYSTEM_NAME;
    workbook.created = new Date();

    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F3A5F" },
    };
    const styleHeader = (sheet) => {
      const row = sheet.getRow(1);
      row.height = 22;
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = headerFill;
        cell.alignment = { vertical: "middle" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF000000" } },
        };
      });
    };
    const percent = (part, whole) =>
      whole > 0 ? Math.round((Number(part) / whole) * 1000) / 10 : 0;

    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.columns = [
      { header: "Metric", key: "metric", width: 36 },
      { header: "Value", key: "value", width: 28 },
    ];
    summarySheet.addRow({ metric: "Report", value: REPORT_SYSTEM_NAME });
    summarySheet.addRow({ metric: "Report Period", value: range.label });
    summarySheet.addRow({
      metric: "Generated",
      value: new Date().toISOString(),
    });
    summarySheet.addRow({});
    summarySheet.addRow({ metric: "Total Requests", value: summary.total });
    summarySheet.addRow({
      metric: "Completed (resolved + closed)",
      value: summary.completed,
    });
    summarySheet.addRow({
      metric: "Pending (submitted + under review)",
      value: summary.pending,
    });
    summarySheet.addRow({ metric: "In Progress", value: summary.in_progress });
    summarySheet.addRow({ metric: "Assigned", value: summary.assigned });
    summarySheet.addRow({ metric: "Accepted", value: summary.accepted });
    summarySheet.addRow({ metric: "Resolved", value: summary.resolved });
    summarySheet.addRow({ metric: "Closed", value: summary.closed });
    summarySheet.addRow({
      metric: "Avg. Resolution Time (hrs)",
      value: summary.avgResolutionHours ?? "—",
    });
    styleHeader(summarySheet);

    const statusSheet = workbook.addWorksheet("By Status");
    statusSheet.columns = [
      { header: "Status", key: "status", width: 24 },
      { header: "Total", key: "total", width: 14 },
      { header: "% of Total", key: "pct", width: 14 },
    ];
    if (statusRows.length) {
      statusRows.forEach((r) =>
        statusSheet.addRow({
          status: String(r.status || "—").replace(/_/g, " "),
          total: Number(r.total || 0),
          pct: percent(r.total, summary.total),
        }),
      );
    } else {
      statusSheet.addRow({
        status: "No requests in the selected period",
        total: 0,
        pct: 0,
      });
    }
    styleHeader(statusSheet);

    const categorySheet = workbook.addWorksheet("By Category");
    categorySheet.columns = [
      { header: "Category", key: "category", width: 40 },
      { header: "Total", key: "total", width: 14 },
      { header: "% of Total", key: "pct", width: 14 },
    ];
    if (categoryRows.length) {
      categoryRows.forEach((r) =>
        categorySheet.addRow({
          category: r.name,
          total: Number(r.total || 0),
          pct: percent(r.total, summary.total),
        }),
      );
    } else {
      categorySheet.addRow({
        category: "No requests in the selected period",
        total: 0,
        pct: 0,
      });
    }
    styleHeader(categorySheet);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="maintenance-report-${stamp}.xlsx"`,
    );
    res.setHeader("Cache-Control", "no-store");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardStats,
  getRequestsByStatus,
  getRequestsByEquipment,
  getTechnicianPerformance,
  getRequestsByDepartment,
  getRequestsByCategory,
  getRequestsByIssueType,
  getRecentFeedback,
  getNetworkReports,
  getReportExport,
};
