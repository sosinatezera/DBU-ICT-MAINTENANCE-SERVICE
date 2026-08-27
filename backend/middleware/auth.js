const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'No token provided.' });

  const token = header.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  /* Always resolve the account from the database so deactivated/deleted users lose
     access immediately and role changes take effect on the next request (no stale-token
     privilege escalation). */
  try {
    const user = await User.findById(payload.id).select('role status fullName');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Account no longer exists.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account has been deactivated. Contact ICT Admin.' });
    }

    req.user = { id: user._id, role: user.role, name: user.fullName, status: user.status };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticate };
