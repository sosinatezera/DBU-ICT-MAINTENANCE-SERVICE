const express = require('express');
const router  = express.Router();
const { register, login, getMe, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');

const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
/* Tighter limit on reset-token issuing to slow account-enumeration / spam. */
const forgotRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

router.post('/register',         authRateLimit, register);
router.post('/login',            authRateLimit, login);
router.post('/forgot-password',  forgotRateLimit, forgotPassword);
router.post('/reset-password',   authRateLimit, resetPassword);
router.get('/me',                authenticate, getMe);

module.exports = router;
