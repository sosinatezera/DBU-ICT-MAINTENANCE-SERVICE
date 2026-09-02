/**
 * controllers/reportController.js
 * Analytics and reporting — ICT Admin dashboard data
 */
const Ticket     = require('../models/Ticket');
const User       = require('../models/User');
const ICTAsset   = require('../models/ICTAsset');
const Technician = require('../models/Technician');
const Assignment = require('../models/Assignment');
const Feedback   = require('../models/Feedback');
const Category   = require('../models/Category');

/* Build a $match filter on createdAt from ?dateFrom=&dateTo= */
const buildDateMatch = (req) => {
  const { dateFrom, dateTo } = req.query;
  const range = {};
  if (dateFrom) range.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
  if (dateTo)   range.$lte = new Date(`${dateTo}T23:59:59.999Z`);

  const valid = (d) => !(d instanceof Date) || !isNaN(d.getTime());
  if ((range.$gte && !valid(range.$gte)) || (range.$lte && !valid(range.$lte))) return null;
  return Object.keys(range).length ? { createdAt: range } : null;
};

/* GET /api/reports/dashboard */
const getDashboardStats = async (req, res, next) => {
  try {
    const dateMatch   = buildDateMatch(req);
    const ticketMatch = dateMatch || {};

    const [
      total_users, total_assets, total_technicians,
      submitted, under_review, in_progress, resolved, closed, total_tickets,
      avg_feedback,
    ] = await Promise.all([
      User.countDocuments({ status: 'active' }),
      ICTAsset.countDocuments(),
      Technician.countDocuments(),
      Ticket.countDocuments({ ...ticketMatch, status: 'submitted' }),
      Ticket.countDocuments({ ...ticketMatch, status: 'under_review' }),
      Ticket.countDocuments({ ...ticketMatch, status: 'in_progress' }),
      Ticket.countDocuments({ ...ticketMatch, status: 'resolved' }),
      Ticket.countDocuments({ ...ticketMatch, status: 'closed' }),
      Ticket.countDocuments(ticketMatch),
      Feedback.aggregate([
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);

    const pending = (submitted || 0) + (under_review || 0);
    const completed = (resolved || 0) + (closed || 0);

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
        avg_rating:  avg_feedback[0]?.avg  ? Math.round(avg_feedback[0].avg * 10) / 10 : 0,
        total_feedback: avg_feedback[0]?.count || 0,
      },
    });
  } catch (err) { next(err); }
};

/* GET /api/reports/requests-by-status */
const getRequestsByStatus = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      { $group: { _id: '$status', total: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', total: 1 } },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) { next(err); }
};

/* GET /api/reports/requests-by-equipment */
const getRequestsByEquipment = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      { $group: { _id: '$equipmentType', total: { $sum: 1 } } },
      { $project: { _id: 0, equipmentType: '$_id', total: 1 } },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) { next(err); }
};

/* GET /api/reports/technician-performance */
const getTechnicianPerformance = async (req, res, next) => {
  try {
    const dateMatch   = buildDateMatch(req);
    const assignments = await Assignment.find()
      .populate({ path: 'technician', populate: { path: 'user', select: 'fullName' } })
      .populate('ticket', 'status createdAt');

    const map = {};
    for (const a of assignments) {
      if (dateMatch && a.ticket?.createdAt) {
        const t = new Date(a.ticket.createdAt).getTime();
        if (dateMatch.createdAt.$gte && t < dateMatch.createdAt.$gte.getTime()) continue;
        if (dateMatch.createdAt.$lte && t > dateMatch.createdAt.$lte.getTime()) continue;
      }
      const name = a.technician?.user?.fullName || 'Unknown';
      if (!map[name]) map[name] = { name, assigned: 0, resolved: 0 };
      map[name].assigned++;
      if (['resolved', 'closed'].includes(a.ticket?.status)) map[name].resolved++;
    }

    res.json({ success: true, data: Object.values(map).sort((a, b) => b.resolved - a.resolved) });
  } catch (err) { next(err); }
};

/* GET /api/reports/requests-by-department */
const getRequestsByDepartment = async (req, res, next) => {
  try {
    const pipeline = [];
    const dateMatch = buildDateMatch(req);
    if (dateMatch) pipeline.push({ $match: dateMatch });
    pipeline.push(
      { $lookup: { from: 'users', localField: 'requester', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $match: { 'u.department': { $ne: null } } },
      { $group: {
        _id:       '$u.department',
        total:     { $sum: 1 },
        resolved:  { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
        closed:    { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } },
      }},
      { $project: { _id: 0, department: '$_id', total: 1, resolved: 1, closed: 1 } },
      { $sort: { total: -1 } },
    );
    res.json({ success: true, data: await Ticket.aggregate(pipeline) });
  } catch (err) { next(err); }
};

/* GET /api/reports/recent-feedback */
const getRecentFeedback = async (req, res, next) => {
  try {
    const feedback = await Feedback.find()
      .populate('user', 'fullName')
      .populate('request', 'ticketId equipmentType')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ success: true, data: feedback });
  } catch (err) { next(err); }
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
      { $group: {
        _id:   { $toLower: { $ifNull: [{ $toString: '$category' }, ''] } },
        total: { $sum: 1 },
      } },
    ]);

    const countMap = {};
    grouped.forEach(g => {
      const key = (g._id || '').toLowerCase();
      countMap[key] = (countMap[key] || 0) + Number(g.total || 0);
    });

    /* Every Category from the collection gets a row (even with 0 requests) */
    const cats = await Category.find().sort({ name: 1 });
    const data = [];
    const matched = new Set();

    cats.forEach(c => {
      const key = String(c.name || '').trim().toLowerCase();
      const total = countMap[key] || 0;
      if (countMap[key]) matched.add(key);
      data.push({ _id: c._id, name: c.name, description: c.description || null, total });
    });

    /* Ticket categories that don't match any category in the collection
       (includes tickets created before the Category list existed). */
    let uncategorised = 0;
    Object.entries(countMap).forEach(([key, total]) => {
      if (key && !matched.has(key)) uncategorised += total;
    });
    uncategorised += countMap[''] || 0;
    if (uncategorised) {
      data.push({
        _id: null,
        name: 'Uncategorised',
        description: 'Requests without a matching category',
        total: uncategorised,
      });
    }

    res.json({ success: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getDashboardStats,
  getRequestsByStatus,
  getRequestsByEquipment,
  getTechnicianPerformance,
  getRequestsByDepartment,
  getRequestsByCategory,
  getRecentFeedback,
};
