/**
 * controllers/feedbackController.js
 * Feedback — requesters rate resolved tickets
 */
const Feedback = require('../models/Feedback');
const Ticket   = require('../models/Ticket');
const User     = require('../models/User');
const { validateObjectId, validateRequired, validateInteger, validateLength } = require('../middleware/validation');

/* Escape a string for safe use inside a RegExp (user-supplied filters). */
const escapeRegExp = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAllFeedback = async (req, res, next) => {
  try {
    const { rating, minRating, maxRating, status, department, technician, from, to } = req.query;

    const filter = {};

    /* Rating filters (top-level Feedback fields). */
    let ratingCond;
    if (rating !== undefined && rating !== '') {
      const r = Number(rating);
      if (Number.isFinite(r)) ratingCond = r;
    }
    const ratingRange = {};
    if (minRating !== undefined && minRating !== '' && Number.isFinite(Number(minRating))) ratingRange.$gte = Number(minRating);
    if (maxRating !== undefined && maxRating !== '' && Number.isFinite(Number(maxRating))) ratingRange.$lte = Number(maxRating);
    if (ratingCond === undefined && Object.keys(ratingRange).length) ratingCond = ratingRange;
    if (ratingCond !== undefined) filter.rating = ratingCond;

    /* Date range on when the feedback was submitted. */
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to)   filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    /*
     * Ticket-level filters (status / department / technician) live on the
     * referenced Ticket, so resolve them to matching ticket ids first and
     * constrain the Feedback records by that set.
     */
    const ticketConds = [];
    if (status) ticketConds.push({ status });
    if (department) ticketConds.push({ department: new RegExp(escapeRegExp(department), 'i') });
    if (technician) {
      const techIds = (await User.find({ fullName: new RegExp(escapeRegExp(technician), 'i') })
        .select('_id').lean()).map(u => u._id);
      /* An empty $in yields no matches (rather than matching everything). */
      ticketConds.push({ assignedTechnician: { $in: techIds } });
    }

    if (ticketConds.length) {
      const matched = await Ticket.find({ $and: ticketConds }).select('_id').lean();
      if (!matched.length) {
        return res.json({
          success: true,
          data: [],
          summary: { totalFeedback: 0, averageRating: 0, fiveStarFeedback: 0, lowRatings: 0, pendingReview: 0 },
        });
      }
      filter.request = { $in: matched.map(t => t._id) };
    }

    const feedback = await Feedback.find(filter)
      .populate('user', 'fullName')
      .populate({
        path: 'request',
        select: 'ticketId problemDescription status equipmentType department assignedTechnician adminFeedback.adminId',
        populate: { path: 'assignedTechnician', select: 'fullName' },
      })
      .sort({ createdAt: -1 });

    /* KPIs are computed by the backend from the same filtered dataset —
       never hard-coded in the frontend. */
    const [agg] = await Feedback.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        avg:   { $avg: '$rating' },
        five:  { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
        low:   { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } },
      } },
    ]);

    /* "Pending review" = submitted requester feedback that no ICT Admin has
       evaluated yet (no admin feedback recorded on the underlying ticket).
       A feedback record whose referenced Ticket resolved to null (the ticket
       was deleted or its ObjectId is orphaned) has no document to inspect, so
       it is skipped here — it can never be a pending review. Without this the
       access below would throw "Cannot read properties of null (reading '_id')"
       and kill the whole GET /feedbacks response. */
    const requestIds = [...new Set(feedback
      .filter(f => f.request && f.request._id)
      .map(f => String(f.request._id)))];
    const pendingReview = requestIds.length
      ? await Ticket.countDocuments({ _id: { $in: requestIds }, 'adminFeedback.adminId': null })
      : 0;

    res.json({
      success: true,
      data: feedback,
      summary: {
        totalFeedback:    agg ? agg.total : 0,
        averageRating:    agg && agg.total ? Math.round(agg.avg * 10) / 10 : 0,
        fiveStarFeedback: agg ? agg.five : 0,
        lowRatings:       agg ? agg.low : 0,
        pendingReview,
      },
    });
  } catch (err) { next(err); }
};

const submitFeedback = async (req, res, next) => {
  try {
    const { request_id, rating, comment } = req.body;

    const reqErr = validateRequired(request_id, 'request_id');
    if (reqErr) return res.status(422).json({ success: false, message: reqErr });

    const ratingErr = validateRequired(rating, 'rating');
    if (ratingErr) return res.status(422).json({ success: false, message: ratingErr });

    const idErr = validateObjectId(request_id, 'Ticket');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const ratingIntErr = validateInteger(rating, 'Rating', { min: 1, max: 5 });
    if (ratingIntErr) return res.status(400).json({ success: false, message: ratingIntErr });

    if (comment !== undefined && comment !== null) {
      const commentLenErr = validateLength(String(comment), 'Comment', { max: 500 });
      if (commentLenErr) return res.status(400).json({ success: false, message: commentLenErr });
    }

    /* Verify the ticket belongs to the requester and is resolved/closed */
    const ticket = await Ticket.findById(request_id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    /* Compare both IDs as strings so the ownership check works:
       `ticket.requester` is a Mongoose ObjectId and `req.user.id` is also an ObjectId.
       Comparing a string to an ObjectId directly would always be unequal and would
       wrongly reject the ticket owner with a 403. */
    if (String(ticket.requester) !== String(req.user.id) && req.user.role !== 'ICT Admin') {
      return res.status(403).json({ success: false, message: 'You can only rate your own tickets.' });
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({ success: false, message: 'Feedback can only be submitted for resolved or closed tickets.' });
    }

    /* Prevent duplicate feedback */
    const existing = await Feedback.findOne({ request: request_id });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Feedback already submitted for this ticket.' });
    }

    await Feedback.create({
      request: request_id,
      user:    req.user.id,
      rating:  Number(rating),
      comment: comment || null,
    });

    /* Update ticket feedback fields */
    await Ticket.findByIdAndUpdate(request_id, {
      feedbackRating:   Number(rating),
      feedbackComments: comment || null,
    });

    res.status(201).json({ success: true, message: 'Feedback submitted. Thank you!' });
  } catch (err) { next(err); }
};

module.exports = { getAllFeedback, submitFeedback };
