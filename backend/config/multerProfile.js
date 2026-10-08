// Multer configuration for profile image uploads
// Handles profile photo uploads with strict image type validation

const multer = require("multer");
const path = require("path");

const MAX_PROFILE_IMAGE_SIZE = 1.5 * 1024 * 1024;

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
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_PROFILE_IMAGE_SIZE },
});
