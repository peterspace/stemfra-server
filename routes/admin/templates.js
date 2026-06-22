const express = require('express');
const router = express.Router();
const { requireStaffAuth } = require('../../middleware/staffAuth');
const { listTemplates, updateTemplate, setDefault } = require('../../controllers/admin/templatesController');

router.get('/', requireStaffAuth, listTemplates);
router.patch('/:id', requireStaffAuth, updateTemplate);
router.post('/:id/set-default', requireStaffAuth, setDefault);

module.exports = router;
