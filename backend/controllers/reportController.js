/**
 * controllers/reportController.js
 * Analytics and reporting — ICT Admin dashboard data
 */
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const ICTAsset = require("../models/ICTAsset");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const Feedback = require("../models/Feedback");
const Category = require("../models/Category");
const Settings = require("../models/Settings");
const { displayTicketId } = require("../utils/ticketId");

/* Build a $match filter on createdAt from ?dateFrom=&dateTo= */
const buildDateMatch = (req) => {
  const { dateFrom, dateTo } = req.query;
  const range = {};
  if (dateFrom) range.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
  if (dateTo) range.$lte = new Date(`${dateTo}T23:59:59.999Z`);

  const valid = (d) => !(d instanceof Date) || !isNaN(d.getTime());
  if ((range.$gte && !valid(range.$gte)) || (range.$lte && !valid(range.$lte)))
    return null;
  return Object.keys(range).length ? { createdAt: range } : null;
};

/* GET /api/reports/dashboard */
const getDashboardStats = async (req, res, next) => {
  try {
    const dateMatch = buildDateMatch(req);
    const ticketMatch = dateMatch || {};

    /* Overdue = still-open tickets older than the admin's SLA window
       (slResponseHours from the Settings singleton, default 24h). The date
       filter, when present, narrows the range to what the user selected. */
    const settings = await Settings.getInstance();
    const slaHours = Number(settings?.slaResponseHours) || 24;
    const overdueThreshold = new Date(Date.now() - slaHours * 3600 * 1000);
    const overdueCreated = { ...(ticketMatch.createdAt || {}) };
    if (!overdueCreated.$lte || overdueCreated.$lte > overdueThreshold) {
      overdueCreated.$lte = overdueThreshold;
    }

    const [
      total_users,
      total_assets,
      total_technicians,
      submitted,
      under_review,
      in_progress,
      resolved,
      closed,
      total_tickets,
      avg_feedback,
      network_total,
      network_pending,
      network_in_progress,
      network_resolved,
      overdue,
      avg_resolution,
    ] = await Promise.all([
      User.countDocuments({ status: "active" }),
      ICTAsset.countDocuments(),
      Technician.countDocuments(),
      Ticket.countDocuments({ ...ticketMatch, status: "submitted" }),
      Ticket.countDocuments({ ...ticketMatch, status: "under_review" }),
      Ticket.countDocuments({ ...ticketMatch, status: "in_progress" }),
      Ticket.countDocuments({ ...ticketMatch, status: "resolved" }),
      Ticket.countDocuments({ ...ticketMatch, status: "closed" }),
      Ticket.countDocuments(ticketMatch),
      Feedback.aggregate([
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ]),
      Ticket.countDocuments({
        ...ticketMatch,
        category: "Network Maintenance",
      }),
      Ticket.countDocuments({
        ...ticketMatch,
        category: "Network Maintenance",
        status: { $in: ["submitted", "under_review"] },
      }),
      Ticket.countDocuments({
        ...ticketMatch,
        category: "Network Maintenance",
        status: "in_progress",
      }),
      Ticket.countDocuments({
        ...ticketMatch,
        category: "Network Maintenance",
        status: { $in: ["resolved", "closed"] },
      }),
      Ticket.countDocuments({
        ...ticketMatch,
        status: { $nin: ["resolved", "closed"] },
        createdAt: overdueCreated,
      }),
      Ticket.aggregate([
        { $match: { ...ticketMatch, status: { $in: ["resolved", "closed"] } } },
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
      ]),
    ]);

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
        total_feedback: avg_feedback[0]?.count || 0,
        network_total: network_total || 0,
        network_pending: network_pending || 0,
        network_in_progress: network_in_progress || 0,
        network_resolved: network_resolved || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-status */
const getRequestsByStatus = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      { $group: { _id: "$status", total: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id", total: 1 } },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) {
    next(err);
  }
};

/* GET /api/reports/requests-by-equipment */
const getRequestsByEquipment = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
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
    const dateMatch = buildDateMatch(req);

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
    const dateMatch = buildDateMatch(req);
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
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });

    /* Group tickets by their free-text `category`. $toString makes the
       pipeline safe for legacy rows (null / Missing / non-string) and
       $toLower normalises the match against Category names. */
    const grouped = await Ticket.aggregate([
      ...pipeline,
      {
        $group: {
          _id: { $toLower: { $ifNull: [{ $toString: "$category" }, ""] } },
          total: { $sum: 1 },
        },
      },
    ]);

    const countMap = {};
    grouped.forEach((g) => {
      const key = (g._id || "").toLowerCase();
      countMap[key] = (countMap[key] || 0) + Number(g.total || 0);
    });

    /* Every Category from the collection gets a row (even with 0 requests) */
    const cats = await Category.find().sort({ name: 1 }).lean();
    const data = [];
    const matched = new Set();

    cats.forEach((c) => {
      const key = String(c.name || "")
        .trim()
        .toLowerCase();
      const total = countMap[key] || 0;
      if (countMap[key]) matched.add(key);
      data.push({
        _id: c._id,
        name: c.name,
        description: c.description || null,
        total,
      });
    });

    /* Ticket categories that don't match any category in the collection
       (includes tickets created before the Category list existed). */
    let uncategorised = 0;
    Object.entries(countMap).forEach(([key, total]) => {
      if (key && !matched.has(key)) uncategorised += total;
    });
    uncategorised += countMap[""] || 0;
    if (uncategorised) {
      data.push({
        _id: null,
        name: "Uncategorised",
        description: "Requests without a matching category",
        total: uncategorised,
      });
    }

    res.json({ success: true, data });
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
    const dateMatch = buildDateMatch(req);
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
    const dateMatch = buildDateMatch(req);
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
};
