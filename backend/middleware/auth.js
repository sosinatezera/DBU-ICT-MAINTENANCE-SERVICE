const User = require("../models/User");
const { getBearerToken, verifyAuthToken } = require("../services/authToken");

const authenticate = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated." });
  }

  try {
    let payload;
    try {
      payload = verifyAuthToken(token);
    } catch {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired access token." });
    }
    const user = await User.findById(payload.sub).select("role status fullName");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Account no longer exists." });
    }
    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated. Contact ICT Admin.",
      });
    }
    req.user = {
      id: user._id,
      role: user.role,
      name: user.fullName,
      status: user.status,
    };
    next();
  } catch (err) {
    next(err);
  }
};

const optionalAuthenticate = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) return next();
  try {
    const payload = verifyAuthToken(token);
    const user = await User.findById(payload.sub).select("role status fullName");
    if (user && user.status === "active") {
      req.user = {
        id: user._id,
        role: user.role,
        name: user.fullName,
        status: user.status,
      };
    }
  } catch {
    /* AI support remains available as a public advisory tool. */
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate };
