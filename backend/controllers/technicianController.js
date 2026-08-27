/**
 * controllers/technicianController.js
 * Technician management and assignment views
 */
const Technician = require('../models/Technician');
const Assignment = require('../models/Assignment');
const Ticket     = require('../models/Ticket');
const { validateObjectId, validateBoolean, validateLength, sanitizeString } = require('../middleware/validation');

const getAllTechnicians = async (req, res, next) => {
  try {
    const techs = await Technician.find().populate('user', '-password').sort({ createdAt: 1 });
    const data = techs.map(t => ({
      id:             t._id,
      _id:            t._id,
      user_id:        t.user?._id,
      fullName:       t.user?.fullName,
      email:          t.user?.email,
      phone:          t.user?.phone,
      department:     t.user?.department,
      status:         t.user?.status,
      role:           t.user?.role,
      specialization: t.specialization,
      available:      t.available,
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const getTechnicianById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Technician');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const tech = await Technician.findById(req.params.id).populate('user', '-password');
    if (!tech) return res.status(404).json({ success: false, message: 'Technician not found.' });
    res.json({ success: true, data: tech });
  } catch (err) { next(err); }
};

const getMyAssignments = async (req, res, next) => {
  try {
    const tech = await Technician.findOne({ user: req.user.id });
    if (!tech) return res.status(404).json({ success: false, message: 'Technician profile not found.' });

    const assignments = await Assignment.find({ technician: tech._id })
      .populate({ path: 'ticket', populate: [{ path: 'requester', select: 'fullName department' }] })
      .sort({ createdAt: -1 });

    const data = assignments.map(a => ({
      _id:              a._id,
      ticket_id:        a.ticket?._id || null,
      ticketId:         a.ticket?.ticketId,
      title:            a.ticket?.title || a.ticket?.problemDescription?.substring(0, 80),
      priority:         a.ticket?.priority,
      status:           a.ticket?.status,
      equipmentType:    a.ticket?.equipmentType,
      category:         a.ticket?.category,
      problemDescription: a.ticket?.problemDescription,
      requester_name:   a.ticket?.requester?.fullName,
      department:       a.ticket?.requester?.department,
      assigned_at:      a.createdAt,
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const updateTechnician = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Technician');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (req.body.available !== undefined) {
      const availErr = validateBoolean(req.body.available, 'Available');
      if (availErr) return res.status(400).json({ success: false, message: availErr });
    }

    if (req.body.specialization !== undefined && req.body.specialization !== null) {
      const specErr = validateLength(sanitizeString(req.body.specialization), 'Specialization', { max: 100 });
      if (specErr) return res.status(400).json({ success: false, message: specErr });
      req.body.specialization = sanitizeString(req.body.specialization);
    }

    const tech = await Technician.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    );
    if (!tech) return res.status(404).json({ success: false, message: 'Technician not found.' });

    res.json({ success: true, message: 'Technician updated.' });
  } catch (err) { next(err); }
};

module.exports = { getAllTechnicians, getTechnicianById, getMyAssignments, updateTechnician };
