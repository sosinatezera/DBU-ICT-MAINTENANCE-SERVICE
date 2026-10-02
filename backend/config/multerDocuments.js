// Multer configuration for profile document uploads
// Handles document/image uploads with strict type validation (10MB limit)

const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "uploads", "profile-files");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  },
});

const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];

const allowedExtensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

const fileFilter = (req, file, cb) => {
  const extname = allowedExtensions.includes(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedMimeTypes.includes(file.mimetype);
  if (extname && mimetype) return cb(null, true);
  cb(new Error("Only PDF, DOC, DOCX, JPG, JPEG, and PNG files are allowed."));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});
