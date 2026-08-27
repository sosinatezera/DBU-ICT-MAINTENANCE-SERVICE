/**
 * controllers/userController.js
 * Admin-only user management + self-service profile/password
 */

const bcrypt     = require('bcryptjs');
const User       = require('../models/User');
const Technician = require('../models/Technician');
const {
  validateObjectId, validateEmail, validatePassword, validateName,
  validatePhone, validateEnum, validateLength, sanitizeString,
  VALID_ROLES, VALID_STATUSES,
} = require('../middleware/validation');

/* ── GET /api/users — list all users (admin only) ─────────── */
const getAllUsers = async (req, res, next) => {
  try {
    const { role, status } = req.query;
    const filter = {};
    if (role)   filter.role   = role;
    if (status) filter.status = status;

    const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/users/:id — single user ─────────────────────── */
const getUserById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'User');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/users — admin creates any role ─────────────── */
const createUser = async (req, res, next) => {
  try {
    let { fullName, email, password, role, department, phone, status, specialization } = req.body;

    fullName = fullName ? sanitizeString(fullName) : '';
    email    = email ? sanitizeString(email) : '';

    /* Validate required fields */
    const nameErr = validateName(fullName, 'Full name');
    if (nameErr) return res.status(422).json({ success: false, message: nameErr });

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(422).json({ success: false, message: emailErr });

    if (!password) {
      return res.status(422).json({ success: false, message: 'Password is required.' });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    /* Validate optional fields */
    if (role) {
      const roleErr = validateEnum(role, VALID_ROLES, 'role');
      if (roleErr) return res.status(400).json({ success: false, message: roleErr });
    }

    if (status) {
      const statusErr = validateEnum(status, VALID_STATUSES, 'status');
      if (statusErr) return res.status(400).json({ success: false, message: statusErr });
    }

    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) return res.status(400).json({ success: false, message: phoneErr });
    }

    const nameLenErr = validateLength(fullName, 'Full name', { max: 100 });
    if (nameLenErr) return res.status(400).json({ success: false, message: nameLenErr });

    /* Check duplicate email */
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      password: hashed,
      role:       role || 'Requester',
      department: department || null,
      phone:      phone || null,
      status:     status || 'active',
    });

    /* If creating a Technician, also create a Technician profile */
    if (user.role === 'Technician') {
      await Technician.create({
        user: user._id,
        specialization: specialization || null,
        available: true,
      });
    }

    res.status(201).json({ success: true, message: 'User created.', data: { id: user._id, role: user.role } });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/:id — admin updates user ──────────────── */
const updateUser = async (req, res, next) => {
  try {
    let { fullName, email, role, department, phone, status, specialization } = req.body;

    const idErr = validateObjectId(req.params.id, 'User');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (fullName !== undefined) fullName = sanitizeString(fullName);
    if (email !== undefined) email = sanitizeString(email);

    /* Validate fields if provided */
    if (fullName !== undefined) {
      const nameErr = validateName(fullName, 'Full name');
      if (nameErr) return res.status(400).json({ success: false, message: nameErr });
    }

    if (email !== undefined) {
      const emailErr = validateEmail(email);
      if (emailErr) return res.status(400).json({ success: false, message: emailErr });

      /* Check duplicate email */
      const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }
    }

    if (role !== undefined) {
      const roleErr = validateEnum(role, VALID_ROLES, 'role');
      if (roleErr) return res.status(400).json({ success: false, message: roleErr });
    }

    if (status !== undefined) {
      const statusErr = validateEnum(status, VALID_STATUSES, 'status');
      if (statusErr) return res.status(400).json({ success: false, message: statusErr });
    }

    if (phone !== undefined && phone !== null && phone !== '') {
      const phoneErr = validatePhone(phone);
      if (phoneErr) return res.status(400).json({ success: false, message: phoneErr });
    }

    const update = {};
    if (fullName !== undefined)   update.fullName   = fullName;
    if (email !== undefined)      update.email      = email.toLowerCase();
    if (role !== undefined)       update.role       = role;
    if (department !== undefined) update.department = department;
    if (phone !== undefined)      update.phone      = phone;
    if (status !== undefined)     update.status     = status;

    const user = await User.findByIdAndUpdate(
      req.params.id, update, { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    /* Sync Technician profile if needed */
    if (role === 'Technician') {
      const existing = await Technician.findOne({ user: user._id });
      if (!existing) {
        await Technician.create({ user: user._id, specialization: specialization || null, available: true });
      } else if (specialization !== undefined) {
        await Technician.findOneAndUpdate({ user: user._id }, { specialization });
      }
    } else if (specialization !== undefined && user.role === 'Technician') {
      await Technician.findOneAndUpdate({ user: user._id }, { specialization });
    }

    res.json({ success: true, message: 'User updated.' });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/:id — soft-delete (set inactive) ──── */
const deleteUser = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, 'User');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'inactive' },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'User deactivated.' });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/:id/password — admin resets password ──── */
const changePassword = async (req, res, next) => {
  try {
    const { password } = req.body;

    const idErr = validateObjectId(req.params.id, 'User');
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (!password) {
      return res.status(422).json({ success: false, message: 'Password is required.' });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.password = await bcrypt.hash(password, 12);
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/profile — update own profile ──────────── */
const updateMyProfile = async (req, res, next) => {
  try {
    let { fullName, phone, department } = req.body;

    fullName = fullName ? sanitizeString(fullName) : '';

    const nameErr = validateName(fullName, 'Full name');
    if (nameErr) return res.status(400).json({ success: false, message: nameErr });

    if (phone !== undefined && phone !== null && phone !== '') {
      const phoneErr = validatePhone(phone);
      if (phoneErr) return res.status(400).json({ success: false, message: phoneErr });
    }

    const nameLenErr = validateLength(fullName, 'Full name', { max: 100 });
    if (nameLenErr) return res.status(400).json({ success: false, message: nameLenErr });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fullName, phone: phone || null, department: department || null },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'Profile updated.', data: user });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/change-password — change own password ── */
const changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(422).json({ success: false, message: 'Current password and new password are required.' });
    }

    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current password.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllUsers, getUserById, createUser, updateUser, deleteUser, changePassword, updateMyProfile, changeMyPassword };
