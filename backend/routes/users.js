const express = require('express');
const router  = express.Router();
const { getAllUsers, getUserById, createUser, updateUser, deleteUser, permanentDeleteUser, changePassword, updateMyProfile, changeMyPassword, uploadProfileImage, removeProfileImage, deleteMyAccount } = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { authorize }    = require('../middleware/authorize');
const uploadProfile    = require('../config/multerProfile');

/* ── Self-service routes (any authenticated user) ────────── */
router.put('/profile',            authenticate, updateMyProfile);
router.put('/change-password',    authenticate, changeMyPassword);
router.post('/profile-image',     authenticate, uploadProfile.single('profileImage'), uploadProfileImage);
router.delete('/profile-image',   authenticate, removeProfileImage);
router.delete('/profile',         authenticate, deleteMyAccount);

/* ── Admin-only routes ──────────────────────────────────── */
router.get('/',             authenticate, authorize('ICT Admin'), getAllUsers);
router.post('/',            authenticate, authorize('ICT Admin'), createUser);
router.get('/:id',          authenticate, authorize('ICT Admin'), getUserById);
router.put('/:id',          authenticate, authorize('ICT Admin'), updateUser);
router.delete('/:id/permanent', authenticate, authorize('ICT Admin'), permanentDeleteUser);
router.delete('/:id',       authenticate, authorize('ICT Admin'), deleteUser);
router.put('/:id/password', authenticate, authorize('ICT Admin'), changePassword);

module.exports = router;
