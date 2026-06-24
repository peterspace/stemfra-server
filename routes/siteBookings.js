const express = require('express');
const router = express.Router();
const {
  getAvailability,
  createBooking,
  getMonthAvailability,
  createBookingGroup,
  getClassSessions,
  createClassBooking,
} = require('../controllers/bookingController');

router.get('/availability', getAvailability);
router.get('/month', getMonthAvailability);
router.get('/class-sessions', getClassSessions);
router.post('/group', createBookingGroup);
router.post('/class', createClassBooking);
router.post('/', createBooking);

module.exports = router;
