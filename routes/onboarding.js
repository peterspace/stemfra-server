const express = require('express');
const router = express.Router();
const { signup, signupAuthenticated } = require('../controllers/onboardingController');

// Public — creates the account + provisions a previewing site.
router.post('/signup', signup);
router.post('/signup-authenticated', signupAuthenticated); // Google sign-up (Bearer JWT = the new owner)

module.exports = router;
