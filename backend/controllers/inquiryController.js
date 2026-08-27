/**
 * controllers/inquiryController.js
 * Public contact/support inquiry from the landing page
 */
const Inquiry = require('../models/Inquiry');
const {
  validateRequired, validateEmail, validateName, validateEnum, validateLength,
  sanitizeString, VALID_INQUIRY_TYPES,
} = require('../middleware/validation');

/* ── POST /api/inquiries — public submit ───────────────────── */
const submitInquiry = async (req, res, next) => {
  try {
    let { fullName, email, department, issueType, description } = req.body;

    /* Sanitize */
    fullName = fullName ? sanitizeString(fullName) : '';
    email    = email ? sanitizeString(email) : '';
    description = description ? sanitizeString(description) : '';

    /* Validate required fields */
    const nameErr = validateName(fullName, 'Full name');
    if (nameErr) return res.status(422).json({ success: false, message: nameErr });

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(422).json({ success: false, message: emailErr });

    const typeErr = validateRequired(issueType, 'Issue type');
    if (typeErr) return res.status(422).json({ success: false, message: typeErr });

    const descErr = validateRequired(description, 'Description');
    if (descErr) return res.status(422).json({ success: false, message: descErr });

    /* Validate enum */
    const issueErr = validateEnum(issueType, VALID_INQUIRY_TYPES, 'issue type');
    if (issueErr) return res.status(400).json({ success: false, message: issueErr });

    /* Validate lengths */
    const descLenErr = validateLength(description, 'Description', { min: 5, max: 2000 });
    if (descLenErr) return res.status(400).json({ success: false, message: descLenErr });

    const trimmedDept = department && typeof department === 'string'
      ? department.trim() || null
      : null;

    await Inquiry.create({
      fullName,
      email: email.toLowerCase(),
      department: trimmedDept,
      issueType,
      description,
    });

    res.status(201).json({
      success: true,
      message: 'Your inquiry has been submitted successfully. Our team will contact you shortly.',
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/inquiries — admin only ───────────────────────── */
const getAllInquiries = async (req, res, next) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 });
    res.json({ success: true, data: inquiries });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitInquiry, getAllInquiries };
