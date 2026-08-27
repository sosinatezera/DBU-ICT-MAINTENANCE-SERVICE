/**
 * controllers/feedbackController.js
 * Feedback — requesters rate resolved tickets
 */
const Feedback = require('../models/Feedback');
const Ticket   = require('../models/Ticket');
const { validateObjectId, validateRequired, validateInteger, validateLength } = require('../middleware/validation');

const getAllFeedback = async (req, res, next) => {
  try {
    const feedback = await Feedback.find()
      .populate('user', 'fullName')
      .populate('request', 'ticketId problemDescription')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: feedback });
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

    if (ticket.requester.toString() !== req.user.id && req.user.role !== 'ICT Admin') {
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
