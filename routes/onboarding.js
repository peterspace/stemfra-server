const express = require('express');
const router = express.Router();
const { signup } = require('../controllers/onboardingController');

// Public — creates the account + provisions a previewing site.
router.post('/signup', signup);

module.exports = router;
