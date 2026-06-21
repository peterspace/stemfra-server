const express = require('express');
const router = express.Router();
const {
  getAvailability,
  createBooking,
  getMonthAvailability,
  createBookingGroup,
} = require('../controllers/bookingController');

router.get('/availability', getAvailability);
router.get('/month', getMonthAvailability);
router.post('/group', createBookingGroup);
router.post('/', createBooking);

module.exports = router;
