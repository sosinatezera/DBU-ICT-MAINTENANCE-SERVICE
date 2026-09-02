/**
 * models/Inquiry.js
 * Public contact/support inquiry submitted from the landing page
 */
const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required.'],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address.'],
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    issueType: {
      type: String,
      required: [true, 'Issue type is required.'],
      enum: [
        'Hardware Problem',
        'Software Problem',
        'Internet Connectivity',
        'Printer Problem',
        'Account / Access Problem',
        'ICT Service Request',
        'Other',
      ],
    },
    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'resolved'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Inquiry', inquirySchema);
