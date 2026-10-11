const multer = require("multer");
const path = require("path");

const ALLOWED_TYPES = new Map([
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".gif", ["image/gif"]],
  [".webp", ["image/webp"]],
  [".pdf", ["application/pdf"]],
  [".doc", ["application/msword"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".xls", ["application/vnd.ms-excel"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  [".txt", ["text/plain"]],
]);

const uploadFeedbackAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypes = ALLOWED_TYPES.get(extension);
    if (mimeTypes?.includes(file.mimetype)) return callback(null, true);
    const error = new Error(
      "Attachment must be a JPG, PNG, GIF, WEBP, PDF, DOC, DOCX, XLS, XLSX, or TXT file.",
    );
    error.code = "FEEDBACK_ATTACHMENT_TYPE";
    error.statusCode = 400;
    callback(error);
  },
});

module.exports = uploadFeedbackAttachment;
