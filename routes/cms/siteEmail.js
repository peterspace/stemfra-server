// Owner email forwarding (Case 11) — /api/cms/site-email
const express = require('express');
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const ctrl = require('../../controllers/cms/emailController');

const router = express.Router();
router.use(requireCmsAuth);

router.get('/', ctrl.status);
router.post('/', ctrl.createAlias);
router.delete('/', ctrl.deleteAlias);

module.exports = router;
