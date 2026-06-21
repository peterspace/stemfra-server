const express = require('express');
const router = express.Router();
const { claim, billingPortal, cancelBooking, cancelSubscription, reactivateSubscription, rescheduleBooking, memberActivity } = require('../controllers/siteMembersController');

// Public — member links their login to their customer record after magic-link sign-in.
router.post('/claim', claim);
// Member opens the Stripe Customer Portal (card + invoices).
router.post('/billing-portal', billingPortal);
// Member cancels their own upcoming appointment.
router.post('/cancel-booking', cancelBooking);
// Member cancels their own membership (at period end).
router.post('/cancel-subscription', cancelSubscription);
// Member changes their mind and reactivates a cancelling membership.
router.post('/reactivate-subscription', reactivateSubscription);
// Member reschedules their own upcoming appointment.
router.post('/reschedule-booking', rescheduleBooking);
// Member's own account activity (membership + booking actions they took).
router.get('/activity', memberActivity);

module.exports = router;
