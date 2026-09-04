/**
 * models/User.js
 * User schema for Smart Computer Maintenance Service Request and Tracking System
 *
 * Roles:
 *   - 'Requester'   → DBU staff who submit maintenance tickets
 *   - 'Technician'  → ICT repair staff who resolve tickets
 *   - 'ICT Admin'   → Directorate manager with full system access
 * */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required.'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', 'Prefer not to say'],
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minlength: 8,
    },
    role: {
      type: String,
      enum: ['Requester', 'Technician', 'ICT Admin'],
      default: 'Requester',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    /* Password reset (forgot password)
       resetPasswordToken stores a HASH of the raw reset token (never the raw
       value) so a DB leak cannot be used to reset accounts. Only one active
       token per user is kept at a time.
    */
    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },
    profileImage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
