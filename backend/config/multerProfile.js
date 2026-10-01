// Multer configuration for profile image uploads
// Handles profile photo uploads with strict image type validation

const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  },
});

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

const fileFilter = (req, file, cb) => {
  const extname = allowedExtensions.includes(
    path.extname(file.originalname).toLowerCase(),
  );
  const mimetype = allowedMimeTypes.includes(file.mimetype);
  if (extname && mimetype) return cb(null, true);
  const error = new Error("Only JPG, JPEG, PNG, and WEBP images are allowed.");
  error.code = "PROFILE_IMAGE_TYPE";
  error.statusCode = 400;
  cb(error);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});
