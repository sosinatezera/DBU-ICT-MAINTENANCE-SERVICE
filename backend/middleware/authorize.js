// Role-based authorization middleware
// Restricts route access based on user role

/**
 * authorize(...roles)
 * Usage: router.get('/admin-only', authenticate, authorize('ICT Admin'), handler)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of: ${roles.join(', ')}.`,
      });
    }

    next();
  };
};

module.exports = { authorize };
