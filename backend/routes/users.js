const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  permanentDeleteUser,
  changePassword,
  updateMyProfile,
  getMyPreferences,
  updateMyPreferences,
  changeMyPassword,
  uploadProfileImage,
  getProfileImage,
  removeProfileImage,
  deleteMyAccount,
  uploadProfileFile,
  getProfileFiles,
  downloadProfileFile,
  deleteProfileFile,
} = require("../controllers/userController");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const uploadProfile = require("../config/multerProfile");
const uploadDocuments = require("../config/multerDocuments");

/* ── Self-service routes (any authenticated user) ────────── */
router.put("/profile", authenticate, updateMyProfile);
router.get(
  "/preferences",
  authenticate,
  authorize("Requester", "Technician"),
  getMyPreferences,
);
router.put(
  "/preferences",
  authenticate,
  authorize("Requester", "Technician"),
  updateMyPreferences,
);
router.put("/change-password", authenticate, changeMyPassword);
router.get("/profile-image/:id", authenticate, getProfileImage);
router.post(
  "/profile-image",
  authenticate,
  uploadProfile.single("profileImage"),
  uploadProfileImage,
);
router.delete("/profile-image", authenticate, removeProfileImage);
router.delete("/profile", authenticate, deleteMyAccount);

/* ── Profile File routes ─────────────────────────────────── */
router.post(
  "/profile/files",
  authenticate,
  uploadDocuments.single("file"),
  uploadProfileFile,
);
router.get("/profile/files", authenticate, getProfileFiles);
router.get("/profile/files/:id", authenticate, downloadProfileFile);
router.delete("/profile/files/:id", authenticate, deleteProfileFile);

/* ── Admin-only routes ──────────────────────────────────── */
router.get("/", authenticate, authorize("ICT Admin"), getAllUsers);
router.post("/", authenticate, authorize("ICT Admin"), createUser);
router.get("/:id", authenticate, authorize("ICT Admin"), getUserById);
router.put("/:id", authenticate, authorize("ICT Admin"), updateUser);
router.delete(
  "/:id/permanent",
  authenticate,
  authorize("ICT Admin"),
  permanentDeleteUser,
);
router.delete("/:id", authenticate, authorize("ICT Admin"), deleteUser);
router.put(
  "/:id/password",
  authenticate,
  authorize("ICT Admin"),
  changePassword,
);

module.exports = router;
