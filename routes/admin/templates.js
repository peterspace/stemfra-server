const express = require('express');
const router = express.Router();
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const { listTemplates, updateTemplate, setDefault } = require('../../controllers/admin/templatesController');

const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/', gate, listTemplates);
router.patch('/:id', gate, updateTemplate);
router.post('/:id/set-default', gate, setDefault);

module.exports = router;
