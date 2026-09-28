const User = require("../models/User");

const authenticate = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId)
    return res
      .status(401)
      .json({ success: false, message: "Not authenticated." });

  /* Always resolve the account from the database so deactivated/deleted users lose
     access immediately and role changes take effect on the next request. */
  try {
    const user = await User.findById(userId).select("role status fullName");
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
  const userId = req.session?.userId;
  if (!userId) return next();
  try {
    const user = await User.findById(userId).select("role status fullName");
    if (user && user.status === "active") {
      req.user = {
        id: user._id,
        role: user.role,
        name: user.fullName,
        status: user.status,
      };
    }
  } catch (_) {
    /* AI support remains available as a public advisory tool. */
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate };
