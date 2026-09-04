/**
 * controllers/technicianController.js
 * Technician management and assignment views
 */
const bcrypt = require('bcryptjs');
const Technician = require('../models/Technician');
const Assignment = require('../models/Assignment');
const Ticket     = require('../models/Ticket');
const User       = require('../models/User');
const { validateObjectId, validateBoolean, validateLength, sanitizeString, validateName, validatePhone, validateEmail, validateEnum, VALID_GENDERS } = require('../middleware/validation');

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
      profileImage:   t.user?.profileImage || null,
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

/* Return the profile of the AUTHENTICATED technician, resolved deterministically
   by the logged-in user's id — not by fuzzy name matching across the whole list.
   Mirrors the shape of entries in getAllTechnicians so the frontend can use either. */
const getMyTechnicianProfile = async (req, res, next) => {
  try {
    const tech = await Technician.findOne({ user: req.user.id }).populate('user', '-password');
    if (!tech) {
      return res.status(404).json({
        success: false,
        message: 'Technician profile not found for your account. Contact ICT Admin.',
      });
    }
    res.json({
      success: true,
      data: {
        id:             tech._id,
        _id:            tech._id,
        user_id:        tech.user?._id,
        fullName:       tech.user?.fullName,
        email:          tech.user?.email,
        phone:          tech.user?.phone,
        department:     tech.user?.department,
        status:         tech.user?.status,
        role:           tech.user?.role,
        profileImage:   tech.user?.profileImage || null,
        specialization: tech.specialization,
        available:      tech.available,
      },
    });
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
      has_feedback:     !!(a.ticket?.technicianFeedback && a.ticket.technicianFeedback.technicianConfirmed),
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
};

const updateTechnician = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'Technician');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const tech = await Technician.findById(req.params.id);
    if (!tech) return res.status(404).json({ success: false, message: 'Technician not found.' });

    if (req.user.role === 'Technician') {
      if (tech.user?.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'You can only update your own technician profile.' });
      }
      req.body = { available: req.body.available };
    }

    if (req.body.available !== undefined) {
      const availErr = validateBoolean(req.body.available, 'Available');
      if (availErr) return res.status(400).json({ success: false, message: availErr });
    }

    if (req.body.specialization !== undefined && req.body.specialization !== null) {
      const specErr = validateLength(sanitizeString(req.body.specialization), 'Specialization', { max: 100 });
      if (specErr) return res.status(400).json({ success: false, message: specErr });
      req.body.specialization = sanitizeString(req.body.specialization);
    }

    const updated = await Technician.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Technician not found.' });

    res.json({ success: true, message: 'Technician updated.' });
  } catch (err) { next(err); }
};

/* ── PUT /api/technicians/me — update own technician profile ─── */
const updateMyTechnicianProfile = async (req, res, next) => {
  try {
    const tech = await Technician.findOne({ user: req.user.id });
    if (!tech) {
      return res.status(404).json({
        success: false,
        message: 'Technician profile not found for your account. Contact ICT Admin.',
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let { fullName, phone, department, gender, specialization, employeeId, shift, available } = req.body;

    // Validate and sanitize user fields
    if (fullName !== undefined) {
      fullName = fullName ? sanitizeString(fullName) : '';
      const nameErr = validateName(fullName, 'Full name');
      if (nameErr) return res.status(400).json({ success: false, message: nameErr });
    }

    if (phone !== undefined && phone !== null && phone !== '') {
      const phoneErr = validatePhone(phone);
      if (phoneErr) return res.status(400).json({ success: false, message: phoneErr });
    }

    if (gender !== undefined && gender !== null && gender !== '') {
      const genderErr = validateEnum(gender, ['Male', 'Female', 'Other', 'Prefer not to say'], 'gender');
      if (genderErr) return res.status(400).json({ success: false, message: genderErr });
    }

    if (department !== undefined) {
      department = department ? sanitizeString(department) : null;
    }

    if (specialization !== undefined && specialization !== null) {
      const specErr = validateLength(sanitizeString(specialization), 'Specialization', { max: 100 });
      if (specErr) return res.status(400).json({ success: false, message: specErr });
      specialization = sanitizeString(specialization);
    }

    if (employeeId !== undefined) {
      employeeId = employeeId ? sanitizeString(employeeId) : null;
    }

    if (shift !== undefined) {
      const shiftErr = validateEnum(shift, ['morning', 'afternoon', 'night'], 'shift');
      if (shiftErr) return res.status(400).json({ success: false, message: shiftErr });
    }

    if (available !== undefined) {
      const availErr = validateBoolean(available, 'Available');
      if (availErr) return res.status(400).json({ success: false, message: availErr });
    }

    // Update user fields
    const userUpdate = {};
    if (fullName !== undefined) userUpdate.fullName = fullName;
    if (phone !== undefined) userUpdate.phone = phone || null;
    if (department !== undefined) userUpdate.department = department;
    if (gender !== undefined) userUpdate.gender = gender || null;

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(req.user.id, userUpdate, { new: true, runValidators: true });
    }

    // Update technician fields
    const techUpdate = {};
    if (specialization !== undefined) techUpdate.specialization = specialization;
    if (employeeId !== undefined) techUpdate.employeeId = employeeId;
    if (shift !== undefined) techUpdate.shift = shift;
    if (available !== undefined) techUpdate.available = available;

    if (Object.keys(techUpdate).length > 0) {
      await Technician.findByIdAndUpdate(tech._id, techUpdate, { new: true, runValidators: true });
    }

    // Return updated profile
    const updatedTech = await Technician.findOne({ user: req.user.id }).populate('user', '-password');
    const updatedUser = await User.findById(req.user.id).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      data: {
        id: updatedTech._id,
        _id: updatedTech._id,
        user_id: updatedUser._id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        phone: updatedUser.phone,
        department: updatedUser.department,
        status: updatedUser.status,
        role: updatedUser.role,
        profileImage: updatedUser.profileImage || null,
        specialization: updatedTech.specialization,
        employeeId: updatedTech.employeeId,
        shift: updatedTech.shift,
        available: updatedTech.available,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllTechnicians, getTechnicianById, getMyTechnicianProfile, getMyAssignments, updateTechnician, updateMyTechnicianProfile };
