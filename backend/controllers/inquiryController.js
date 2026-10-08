/**
 * controllers/inquiryController.js
 * Public contact/support inquiry from the landing page
 */
const Inquiry = require("../models/Inquiry");
const { sendEmail, EMAIL_ERROR } = require("../services/mailer");
const env = require("../config/env");
const {
  validateRequired,
  validateGenericEmail,
  validateName,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_INQUIRY_TYPES,
} = require("../middleware/validation");

/* Escape user-supplied text before embedding it in the admin notification email
   so message content can never break the layout or inject markup. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── POST /api/inquiries — public submit ───────────────────── */
const submitInquiry = async (req, res, next) => {
  try {
    let { fullName, email, subject, message } = req.body;

    /* Backward compatibility: older clients may send department/issueType/description */
    const { department, issueType, description } = req.body;

    /* Sanitize */
    fullName = fullName ? sanitizeString(fullName) : "";
    email = email ? sanitizeString(email) : "";
    subject = subject ? sanitizeString(subject) : "";
    const bodyText = message || description || "";
    const trimmedBody = typeof bodyText === "string" ? bodyText.trim() : "";

    /* Validate required fields */
    const nameErr = validateName(fullName, "Full name");
    if (nameErr)
      return res.status(422).json({ success: false, message: nameErr });

    const emailErr = validateGenericEmail(email);
    if (emailErr)
      return res.status(422).json({ success: false, message: emailErr });

    const subjErr = validateRequired(subject, "Subject");
    if (subjErr)
      return res.status(422).json({ success: false, message: subjErr });

    const msgErr = validateRequired(trimmedBody, "Message");
    if (msgErr)
      return res.status(422).json({ success: false, message: msgErr });

    /* Validate enum (only when an issue type is provided) */
    if (issueType) {
      const issueErr = validateEnum(
        issueType,
        VALID_INQUIRY_TYPES,
        "issue type",
      );
      if (issueErr)
        return res.status(400).json({ success: false, message: issueErr });
    }

    /* Validate lengths */
    const subjLenErr = validateLength(subject, "Subject", { min: 2, max: 200 });
    if (subjLenErr)
      return res.status(400).json({ success: false, message: subjLenErr });

    const msgLenErr = validateLength(trimmedBody, "Message", {
      min: 5,
      max: 2000,
    });
    if (msgLenErr)
      return res.status(400).json({ success: false, message: msgLenErr });

    const trimmedDept =
      department && typeof department === "string"
        ? department.trim() || null
        : null;

    await Inquiry.create({
      fullName,
      email: email.toLowerCase(),
      department: trimmedDept,
      subject,
      issueType: issueType || "Other",
      description: trimmedBody,
    });

    /* Notify the ICT Admin (backend env ADMIN_EMAIL) via the existing SMTP
       mailer. Ordering is deliberate: validate -> store -> notify -> respond.
       The row is written BEFORE any mail is attempted, so a mail failure can
       never lose the visitor's message, and the response distinguishes the two
       outcomes with an explicit `notified` flag instead of collapsing them.
       replyTo points back at the sender so the admin can reply directly. */
    const sent = await sendEmail({
      to: env.ADMIN_EMAIL,
      replyTo: email,
      subject: "New Contact Message",
      text:
        "New contact message received from the website contact form.\n\n" +
        `Name: ${fullName}\n` +
        `Email: ${email}\n` +
        `Subject: ${subject}\n\n` +
        `Message:\n${trimmedBody}`,
      html:
        "<p><strong>New contact message</strong> received from the website contact form.</p>" +
        `<p><strong>Name:</strong> ${escapeHtml(fullName)}<br>` +
        `<strong>Email:</strong> ${escapeHtml(email)}<br>` +
        `<strong>Subject:</strong> ${escapeHtml(subject)}</p>` +
        `<p><strong>Message:</strong></p>` +
        `<p>${escapeHtml(trimmedBody).replace(/\n/g, "<br>")}</p>`,
    });

    if (!sent.delivered) {
      /* The submission itself SUCCEEDED: the row is stored and the ICT Admin
         reads these submissions in the admin dashboard, so the message is NOT
         lost and there is nothing for the visitor to retry. Answering 503 here
         would misreport a completed submission as a server fault and invite a
         duplicate row for a message already held. The real state is reported
         instead — 201 with `notified:false` — so the caller can tell "stored
         and emailed" from "stored, notification failed" without ever claiming
         an email went out. Failures are reported on the server by variable
         name and provider code only: never an address, a password or a stack. */
      if (!env.ADMIN_EMAIL_STATUS.configured) {
        console.error(
          `[inquiries] ${EMAIL_ERROR.CONFIGURATION} - the contact form cannot notify the ICT Admin because ADMIN_EMAIL is not set to a valid address. ` +
            `Missing or invalid: ${env.ADMIN_EMAIL_STATUS.missing.join(", ")}. Set it in backend/.env (local) or the hosting provider's environment (deployed).`,
        );
      }
      console.error(
        `[inquiries] ADMIN NOTIFICATION NOT delivered for the stored message from "${fullName}" (subject "${subject}") — ${sent.code || EMAIL_ERROR.SEND}. ` +
          `The submission WAS saved and the ICT Admin must still read it in the admin dashboard.`,
      );
      return res.status(201).json({
        success: true,
        received: true,
        notified: false,
        code: sent.code || EMAIL_ERROR.SEND,
        message:
          "Your message was received successfully, but the email notification could not be sent. The ICT helpdesk can still access your message.",
      });
    }

    res.status(201).json({
      success: true,
      received: true,
      notified: true,
      message:
        "Your message has been sent successfully. Our ICT support team will respond within 24 working hours.",
    });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/inquiries — admin only ───────────────────────── */
const getAllInquiries = async (req, res, next) => {
  try {
    const inquiries = await Inquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitInquiry, getAllInquiries };
