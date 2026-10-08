/**
 * controllers/userController.js
 * Admin-only user management + self-service profile/password
 */

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Technician = require("../models/Technician");
const Assignment = require("../models/Assignment");
const MaintenanceRecord = require("../models/MaintenanceRecord");
const Ticket = require("../models/Ticket");
const Notification = require("../models/Notification");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const AIConversation = require("../models/AIConversation");
const AIFeedback = require("../models/AIFeedback");
const Feedback = require("../models/Feedback");
const AuditLog = require("../models/AuditLog");
const Settings = require("../models/Settings");
const ProfileFile = require("../models/ProfileFile");
const ProfileImage = require("../models/ProfileImage");
const path = require("path");
const fs = require("fs");
const {
  validateObjectId,
  validateEmail,
  validatePassword,
  validateName,
  validatePhone,
  validateEnum,
  validateLength,
  sanitizeString,
  VALID_ROLES,
  VALID_STATUSES,
  VALID_GENDERS,
} = require("../middleware/validation");

/* ── GET /api/users — list all users (admin only) ─────────── */
const getAllUsers = async (req, res, next) => {
  try {
    const { role, status } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (status) filter.status = status;

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/users/:id — single user ─────────────────────── */
const getUserById = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "User");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/users — admin creates any role ─────────────── */
const createUser = async (req, res, next) => {
  try {
    let {
      fullName,
      email,
      password,
      role,
      department,
      phone,
      status,
      specialization,
      gender,
    } = req.body;

    fullName = fullName ? sanitizeString(fullName) : "";
    email = email ? sanitizeString(email) : "";

    /* Validate required fields */
    const nameErr = validateName(fullName, "Full name");
    if (nameErr)
      return res.status(422).json({ success: false, message: nameErr });

    const emailErr = validateEmail(email);
    if (emailErr)
      return res.status(422).json({ success: false, message: emailErr });

    if (!password) {
      return res
        .status(422)
        .json({ success: false, message: "Password is required." });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    /* Validate optional fields */
    if (role) {
      const roleErr = validateEnum(role, VALID_ROLES, "role");
      if (roleErr)
        return res.status(400).json({ success: false, message: roleErr });
    }

    if (status) {
      const statusErr = validateEnum(status, VALID_STATUSES, "status");
      if (statusErr)
        return res.status(400).json({ success: false, message: statusErr });
    }

    if (phone) {
      const phoneErr = validatePhone(phone);
      if (phoneErr)
        return res.status(400).json({ success: false, message: phoneErr });
    }

    if (gender) {
      const genderErr = validateEnum(gender, VALID_GENDERS, "gender");
      if (genderErr)
        return res.status(400).json({ success: false, message: genderErr });
    }

    const nameLenErr = validateLength(fullName, "Full name", { max: 100 });
    if (nameLenErr)
      return res.status(400).json({ success: false, message: nameLenErr });

    /* Check duplicate email */
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "Email already registered." });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      password: hashed,
      role: role || "Requester",
      department: department || null,
      phone: phone || null,
      status: status || "active",
      gender: gender || null,
    });
    req.auditEntityId = user._id;
    /* If creating a Technician, also create a Technician profile */
    if (user.role === "Technician") {
      await Technician.create({
        user: user._id,
        specialization: specialization || null,
        available: true,
      });
    }

    res.status(201).json({
      success: true,
      message: "User created.",
      data: { id: user._id, role: user.role },
    });
  } catch (err) {
    console.error(
      "[POST /api/users] createUser error (User.create FAILED?):",
      err.message,
    );
    console.error(
      "[POST /api/users] mongoose.readyState at failure:",
      mongoose.connection.readyState,
    );
    next(err);
  }
};

/* ── PUT /api/users/:id — admin updates user ──────────────── */
const updateUser = async (req, res, next) => {
  try {
    let {
      fullName,
      email,
      role,
      department,
      phone,
      status,
      specialization,
      gender,
    } = req.body;

    const idErr = validateObjectId(req.params.id, "User");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (fullName !== undefined) fullName = sanitizeString(fullName);
    if (email !== undefined) email = sanitizeString(email);

    /* Validate fields if provided */
    if (fullName !== undefined) {
      const nameErr = validateName(fullName, "Full name");
      if (nameErr)
        return res.status(400).json({ success: false, message: nameErr });
    }

    if (email !== undefined) {
      const emailErr = validateEmail(email);
      if (emailErr)
        return res.status(400).json({ success: false, message: emailErr });

      /* Check duplicate email */
      const existing = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: req.params.id },
      });
      if (existing) {
        return res
          .status(409)
          .json({ success: false, message: "Email already registered." });
      }
    }

    if (role !== undefined) {
      const roleErr = validateEnum(role, VALID_ROLES, "role");
      if (roleErr)
        return res.status(400).json({ success: false, message: roleErr });
    }

    if (status !== undefined) {
      const statusErr = validateEnum(status, VALID_STATUSES, "status");
      if (statusErr)
        return res.status(400).json({ success: false, message: statusErr });
    }

    if (phone !== undefined && phone !== null && phone !== "") {
      const phoneErr = validatePhone(phone);
      if (phoneErr)
        return res.status(400).json({ success: false, message: phoneErr });
    }

    if (gender !== undefined && gender !== null && gender !== "") {
      const genderErr = validateEnum(gender, VALID_GENDERS, "gender");
      if (genderErr)
        return res.status(400).json({ success: false, message: genderErr });
    }

    const update = {};
    if (fullName !== undefined) update.fullName = fullName;
    if (email !== undefined) update.email = email.toLowerCase();
    if (role !== undefined) update.role = role;
    if (department !== undefined) update.department = department;
    if (phone !== undefined) update.phone = phone;
    if (status !== undefined) update.status = status;
    if (gender !== undefined) update.gender = gender;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    /* Sync Technician profile if needed */
    if (role === "Technician") {
      const existing = await Technician.findOne({ user: user._id });
      if (!existing) {
        await Technician.create({
          user: user._id,
          specialization: specialization || null,
          available: true,
        });
      } else if (specialization !== undefined) {
        await Technician.findOneAndUpdate(
          { user: user._id },
          { specialization },
        );
      }
    } else if (specialization !== undefined && user.role === "Technician") {
      await Technician.findOneAndUpdate({ user: user._id }, { specialization });
    }

    res.json({ success: true, message: "User updated." });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/:id — soft-delete (set inactive) ──── */
const deleteUser = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "User");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: "inactive" },
      { new: true },
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    res.json({ success: true, message: "User deactivated." });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/:id/permanent — HARD delete (admin only) ──
   Truly removes the user document (and any linked Technician profile) from
   MongoDB. Refuses to permanently delete the currently logged-in admin (they
   would lock themselves out) and refuses technicians who still have active
   assigned requests, so in-flight work is never orphaned. This is separate
   from the soft-delete endpoint above and never changes status fields. */
const permanentDeleteUser = async (req, res, next) => {
  let failure = null;
  let deletedUser = null;
  let deletedTechnician = false;
  let profileImage = null;
  const session = await mongoose.startSession();

  try {
    const idErr = validateObjectId(req.params.id, "User");
    if (idErr) {
      throw Object.assign(new Error(idErr), { statusCode: 400 });
    }

    const id = req.params.id;
    if (String(id) === String(req.user.id)) {
      throw Object.assign(
        new Error("You cannot permanently delete your own account."),
        { statusCode: 400 },
      );
    }

    await session.withTransaction(async () => {
      const user = await User.findById(id).session(session);
      if (!user) {
        throw Object.assign(new Error("User not found."), {
          statusCode: 404,
        });
      }

      deletedUser = user;
      profileImage = user.profileImage;

      if (user.role === "Technician") {
        deletedTechnician = true;
        const tech = await Technician.findOne({ user: id }).session(session);

        if (tech) {
          const activeAssignments = await Assignment.countDocuments({
            technician: tech._id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          }).session(session);
          const activeTickets = await Ticket.countDocuments({
            assignedTechnician: id,
            status: { $in: ["assigned", "accepted", "in_progress"] },
          }).session(session);
          if (activeAssignments > 0 || activeTickets > 0) {
            throw Object.assign(
              new Error(
                "Cannot permanently delete this technician while active requests are assigned. Reassign or complete them first.",
              ),
              { statusCode: 409 },
            );
          }
        }

        const requesterTickets = await Ticket.countDocuments({
          requester: id,
        }).session(session);
        if (requesterTickets > 0) {
          throw Object.assign(
            new Error(
              "This account is also linked to requester tickets, so it cannot be permanently deleted without removing ticket history.",
            ),
            { statusCode: 409 },
          );
        }

        const conversationIds = await Conversation.find({
          participants: id,
        })
          .distinct("_id")
          .session(session);

        await Message.deleteMany(
          {
            $or: [
              { sender: id },
              { recipient: id },
              { conversation: { $in: conversationIds } },
            ],
          },
          { session },
        );
        await Conversation.deleteMany({ participants: id }, { session });
        await Notification.deleteMany({ user: id }, { session });
        await AIConversation.deleteMany({ user: id }, { session });
        await AIFeedback.deleteMany({ user: id }, { session });
        await Feedback.deleteMany({ user: id }, { session });

        await Assignment.updateMany(
          { assigned_by: id },
          { $set: { assigned_by: null } },
          { session },
        );
        await AuditLog.updateMany(
          { user: id },
          { $set: { user: null } },
          { session },
        );
        await Settings.updateMany(
          { updatedBy: id },
          { $set: { updatedBy: null } },
          { session },
        );
        await Ticket.updateMany(
          { assignedTechnician: id },
          { $unset: { assignedTechnician: 1 } },
          { session },
        );
        await Ticket.updateMany(
          { "technicianFeedback.technician.technicianId": id },
          {
            $set: { "technicianFeedback.technician.technicianId": null },
          },
          { session },
        );

        if (tech) {
          await Assignment.deleteMany({ technician: tech._id }, { session });
          await MaintenanceRecord.deleteMany(
            { technician: tech._id },
            { session },
          );
          await Technician.deleteOne({ _id: tech._id }, { session });
        }
      }

      await ProfileImage.deleteMany({ user: id }, { session });
      await User.deleteOne({ _id: id }, { session });
    });
  } catch (err) {
    failure = err;
  } finally {
    await session.endSession();
  }

  if (failure) {
    if (failure.statusCode) {
      return res
        .status(failure.statusCode)
        .json({ success: false, message: failure.message });
    }
    return next(failure);
  }

  if (profileImage) {
    await unlinkProfileImage(profileImage);
  }

  res.json({
    success: true,
    message: deletedTechnician
      ? `Technician "${deletedUser.fullName}" permanently deleted.`
      : `User "${deletedUser.fullName}" permanently deleted.`,
  });
};

/* ── PUT /api/users/:id/password — admin resets password ──── */
const changePassword = async (req, res, next) => {
  try {
    const { password } = req.body;

    const idErr = validateObjectId(req.params.id, "User");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    if (!password) {
      return res
        .status(422)
        .json({ success: false, message: "Password is required." });
    }

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    const user = await User.findById(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.password = await bcrypt.hash(password, 12);
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: "Password updated." });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/profile — update own profile ────────────
   Field-wise update: only keys actually present in the body are written.
   An earlier version always assigned phone/department/gender (falling back to
   null), so any client that submitted a partial payload silently erased the
   fields it did not mention. */
const updateMyProfile = async (req, res, next) => {
  try {
    const { fullName, phone, department, gender } = req.body || {};
    const update = {};

    if (fullName !== undefined) {
      const name = sanitizeString(fullName || "");
      const nameErr = validateName(name, "Full name");
      if (nameErr)
        return res.status(400).json({ success: false, message: nameErr });

      const nameLenErr = validateLength(name, "Full name", { max: 100 });
      if (nameLenErr)
        return res.status(400).json({ success: false, message: nameLenErr });

      update.fullName = name;
    }

    if (phone !== undefined) {
      if (phone !== null && phone !== "") {
        const phoneErr = validatePhone(phone);
        if (phoneErr)
          return res.status(400).json({ success: false, message: phoneErr });
        update.phone = phone;
      } else {
        update.phone = null;
      }
    }

    if (department !== undefined) {
      update.department = department
        ? sanitizeString(String(department)).slice(0, 120)
        : null;
    }

    if (gender !== undefined) {
      if (gender !== null && gender !== "") {
        const genderErr = validateEnum(gender, VALID_GENDERS, "gender");
        if (genderErr)
          return res.status(400).json({ success: false, message: genderErr });
        update.gender = gender;
      } else {
        update.gender = null;
      }
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({
        success: false,
        message: "No profile fields were provided.",
      });
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    res.json({ success: true, message: "Profile updated.", data: user });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/users/preferences — the authenticated user's own settings ── */
const getMyPreferences = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id)
      .select("notificationPreferences preferences")
      .lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    res.json({
      success: true,
      data: {
        inAppNotifications:
          user.notificationPreferences?.inAppNotifications ?? true,
        emailNotifications:
          user.notificationPreferences?.emailNotifications ?? true,
        /* Technician-only control: never surfaced to a Requester. */
        maintenanceAlerts:
          req.user.role === "Technician"
            ? (user.notificationPreferences?.maintenanceAlerts ?? true)
            : undefined,
        language: user.preferences?.language ?? "en",
        theme: user.preferences?.theme ?? "light",
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/preferences — self-service settings save ────────────
   Field-level authorization: a Requester may never write maintenanceAlerts
   (a technician-only control), and every key is type-checked before it can
   reach the database. Anything not explicitly allowed is rejected outright
   rather than silently dropped, so the client never gets a false "saved". */
const PREFERENCE_BOOLEAN_FIELDS = new Set([
  "inAppNotifications",
  "emailNotifications",
]);
const PREFERENCE_ENUM_FIELDS = {
  language: ["en", "am"],
  theme: ["light", "dark"],
};

const updateMyPreferences = async (req, res, next) => {
  try {
    const isTechnician = req.user.role === "Technician";
    const allowedBooleans = new Set(PREFERENCE_BOOLEAN_FIELDS);
    if (isTechnician) allowedBooleans.add("maintenanceAlerts");

    const entries = Object.entries(req.body || {});
    if (!entries.length) {
      return res.status(400).json({
        success: false,
        message: "No settings were provided.",
      });
    }

    const booleans = {};
    const enums = {};
    for (const [key, value] of entries) {
      if (allowedBooleans.has(key)) {
        if (typeof value !== "boolean") {
          return res
            .status(400)
            .json({ success: false, message: `${key} must be true or false.` });
        }
        booleans[key] = value;
        continue;
      }
      const allowedValues = PREFERENCE_ENUM_FIELDS[key];
      if (allowedValues) {
        if (!allowedValues.includes(value)) {
          return res.status(400).json({
            success: false,
            message: `Invalid ${key}. Must be one of: ${allowedValues.join(", ")}.`,
          });
        }
        enums[key] = value;
        continue;
      }
      return res.status(400).json({
        success: false,
        message: `Unknown setting "${key}".`,
      });
    }

    const user = await User.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found." });

    for (const [key, value] of Object.entries(booleans))
      user.set(`notificationPreferences.${key}`, value);
    for (const [key, value] of Object.entries(enums))
      user.set(`preferences.${key}`, value);
    await user.save();

    res.json({
      success: true,
      message: "Preferences saved.",
      data: {
        inAppNotifications: user.notificationPreferences.inAppNotifications,
        emailNotifications: user.notificationPreferences.emailNotifications,
        maintenanceAlerts: isTechnician
          ? user.notificationPreferences.maintenanceAlerts
          : undefined,
        language: user.preferences.language,
        theme: user.preferences.theme,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ── PUT /api/users/change-password — change own password ── */
const changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(422).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the current password.",
      });
    }

    const user = await User.findById(req.user.id).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      /* 400, not 401: the session is still perfectly valid — only the
         submitted value is wrong. The shared frontend apiRequest() treats ANY
         401 as an expired session and force-redirects to the login page, so a
         401 here would log the user out for simply mistyping their password. */
      return res
        .status(400)
        .json({ success: false, message: "Current password is incorrect." });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    next(err);
  }
};

/* ── POST /api/users/profile-image — upload profile image ───── */
const profileImageSignatures = {
  "image/jpeg": (header) =>
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff,
  "image/png": (header) =>
    header.length >= 8 &&
    header
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (header) =>
    header.length >= 12 &&
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP",
};

const PROFILE_IMAGE_PATH_PREFIX = "/api/users/profile-image/";
const MAX_PROFILE_IMAGE_SIZE = 1.5 * 1024 * 1024;

const profileImageIdFromPath = (value) => {
  const match = /^\/api\/users\/profile-image\/([a-f\d]{24})$/i.exec(
    String(value || ""),
  );
  return match ? match[1] : null;
};

const hasProfileImageSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer)) return false;
  return !!profileImageSignatures[mimeType]?.(buffer.subarray(0, 12));
};

const unlinkProfileImage = async (filename) => {
  if (!filename || path.basename(filename) !== filename) return;
  try {
    await fs.promises.unlink(path.join(__dirname, "..", "uploads", filename));
  } catch (err) {
    if (err.code !== "ENOENT")
      console.error("Could not remove profile image:", err.message);
  }
};

const uploadProfileImage = async (req, res, next) => {
  let storedImage = null;
  let user = null;
  let previousImage = null;
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
      return res
        .status(422)
        .json({ success: false, message: "No image file provided." });
    }

    const extensionMimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (
      extensionMimeTypes[extension] !== req.file.mimetype ||
      req.file.size > MAX_PROFILE_IMAGE_SIZE ||
      !hasProfileImageSignature(req.file.buffer, req.file.mimetype)
    ) {
      return res.status(400).json({
        success: false,
        message: "The selected file is not a valid JPG, PNG, or WEBP image.",
      });
    }

    user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    previousImage = user.profileImage;
    storedImage = await ProfileImage.create({
      user: user._id,
      contentType: req.file.mimetype,
      data: req.file.buffer,
      size: req.file.size,
    });

    user.profileImage = `${PROFILE_IMAGE_PATH_PREFIX}${storedImage._id}`;
    await user.save();
  } catch (err) {
    if (storedImage) {
      try {
        await ProfileImage.deleteOne({ _id: storedImage._id, user: req.user.id });
      } catch (cleanupError) {
        console.error(
          "Could not remove an unreferenced profile image:",
          cleanupError.message,
        );
      }
    }
    return next(err);
  }

  if (previousImage) {
    const previousImageId = profileImageIdFromPath(previousImage);
    if (previousImageId) {
      try {
        await ProfileImage.deleteOne({
          _id: previousImageId,
          user: user._id,
        });
      } catch (cleanupError) {
        console.error(
          "Could not remove the replaced profile image:",
          cleanupError.message,
        );
      }
    } else {
      await unlinkProfileImage(previousImage);
    }
  }

  res.json({
    success: true,
    message: "Profile photo updated successfully.",
    data: {
      profileImage: user.profileImage,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        department: user.department,
        role: user.role,
        profileImage: user.profileImage,
      },
    },
  });
};

/* ── GET /api/users/profile-image/:id — authenticated image bytes ── */
const getProfileImage = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "ProfileImage");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const image = await ProfileImage.findById(req.params.id);
    if (!image) {
      return res
        .status(404)
        .json({ success: false, message: "Profile image not found." });
    }

    res.set("Cache-Control", "private, max-age=300");
    res.set("X-Content-Type-Options", "nosniff");
    res.type(image.contentType).send(image.data);
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/profile — delete own account ──────── */
const deleteMyAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const oldProfileImage = user.profileImage;

    /* Soft-delete: set status to inactive rather than hard delete to preserve
       referential integrity with tickets and other collections. */
    user.status = "inactive";
    user.fullName = "[Deleted User]";
    user.email = `deleted_${user._id}@removed.local`;
    user.password = await bcrypt.hash(
      require("crypto").randomBytes(32).toString("hex"),
      12,
    );
    user.profileImage = null;
    await user.save({ validateBeforeSave: false });
    await ProfileImage.deleteMany({ user: user._id });
    await unlinkProfileImage(oldProfileImage);

    res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/users/profile-image — remove profile image ─── */
const removeProfileImage = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (!user.profileImage) {
      return res
        .status(400)
        .json({ success: false, message: "No profile image to remove." });
    }

    const oldProfileImage = user.profileImage;
    user.profileImage = null;
    await user.save({ validateBeforeSave: false });
    const oldImageId = profileImageIdFromPath(oldProfileImage);
    if (oldImageId) {
      await ProfileImage.deleteOne({ _id: oldImageId, user: user._id });
    } else {
      await unlinkProfileImage(oldProfileImage);
    }

    res.json({
      success: true,
      message: "Profile photo removed successfully.",
      data: { profileImage: null },
    });
  } catch (err) {
    next(err);
  }
};

/* ── Profile file validation — reject forged browser metadata ───── */
const PROFILE_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
]);

function validateStoredProfileFile(filePath, originalName, mimeType) {
  const extension = path.extname(originalName || "").toLowerCase();
  if (!PROFILE_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  try {
    const buffer = fs.readFileSync(filePath).subarray(0, 16);

    if (extension === ".pdf") {
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
      );
    }

    if (extension === ".png") {
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    }

    if (extension === ".jpg" || extension === ".jpeg") {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );
    }

    if (extension === ".docx") {
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x03 &&
        buffer[3] === 0x04
      );
    }

    if (extension === ".doc") {
      return (
        buffer.length >= 8 &&
        buffer[0] === 0xd0 &&
        buffer[1] === 0xcf &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xe0 &&
        buffer[4] === 0xa1 &&
        buffer[5] === 0xb1 &&
        buffer[6] === 0x1a &&
        buffer[7] === 0xe1
      );
    }

    return false;
  } catch {
    return false;
  }
}

function removeUploadedFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort cleanup
  }
}

/* ── POST /api/profile/files — upload a profile file ────────── */
const uploadProfileFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(422)
        .json({ success: false, message: "No file provided." });
    }

    if (
      !validateStoredProfileFile(
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
      )
    ) {
      removeUploadedFile(req.file.path);
      return res.status(415).json({
        success: false,
        message: "Unsupported file type or invalid file contents.",
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      removeUploadedFile(req.file.path);
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const isImage = req.file.mimetype.startsWith("image/");
    const category = isImage ? "image" : "document";

    const profileFile = await ProfileFile.create({
      user: user._id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      category,
    });

    res.status(201).json({
      success: true,
      message: "File uploaded successfully.",
      data: {
        id: profileFile._id,
        originalName: profileFile.originalName,
        size: profileFile.size,
        mimeType: profileFile.mimeType,
        category: profileFile.category,
        uploadedAt: profileFile.uploadedAt,
      },
    });
  } catch (err) {
    removeUploadedFile(req.file && req.file.path);
    next(err);
  }
};

/* ── GET /api/profile/files — list user's files ─────────────── */
const getProfileFiles = async (req, res, next) => {
  try {
    const files = await ProfileFile.find({ user: req.user.id })
      .sort({ uploadedAt: -1 })
      .lean();

    const data = files.map((f) => ({
      id: f._id,
      originalName: f.originalName,
      size: f.size,
      mimeType: f.mimeType,
      category: f.category,
      uploadedAt: f.uploadedAt,
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/* ── GET /api/profile/files/:id — download a file ───────────── */
const downloadProfileFile = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "ProfileFile");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const file = await ProfileFile.findById(req.params.id);
    if (!file) {
      return res
        .status(404)
        .json({ success: false, message: "File not found." });
    }

    if (String(file.user) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this file.",
      });
    }

    if (!fs.existsSync(file.path)) {
      return res
        .status(404)
        .json({ success: false, message: "File not found on server." });
    }

    res.download(file.path, file.originalName);
  } catch (err) {
    next(err);
  }
};

/* ── DELETE /api/profile/files/:id — delete a file ──────────── */
const deleteProfileFile = async (req, res, next) => {
  try {
    const idErr = validateObjectId(req.params.id, "ProfileFile");
    if (idErr) return res.status(400).json({ success: false, message: idErr });

    const file = await ProfileFile.findById(req.params.id);
    if (!file) {
      return res
        .status(404)
        .json({ success: false, message: "File not found." });
    }

    if (String(file.user) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this file.",
      });
    }

    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    await ProfileFile.deleteOne({ _id: file._id });

    res.json({
      success: true,
      message: "File deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};
