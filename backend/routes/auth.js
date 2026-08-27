const express = require('express');
const router  = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');

const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

router.post('/register', authRateLimit, register);
router.post('/login',    authRateLimit, login);
router.get('/me',        authenticate, getMe);

module.exports = router;
