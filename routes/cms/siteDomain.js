const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { connect, status, disconnect, searchDomains, checkOne, registerOwn } = require('../../controllers/cms/domainController');

// Owner self-serve brand-domain connect (all gated by CMS owner auth).
router.get('/', requireCmsAuth, status);        // ?siteId= → current connection + CF status
router.post('/', requireCmsAuth, connect);      // { siteId, domain }
router.delete('/', requireCmsAuth, disconnect); // { siteId }

// Owner "buy a domain" (Hostinger-style search → instant register + invoice).
router.get('/search', requireCmsAuth, searchDomains); // ?siteId=&q= → exact (live) + alternates (cached pricing)
router.get('/check', requireCmsAuth, checkOne);       // ?siteId=&domain= → one live availability check
router.post('/register', requireCmsAuth, registerOwn); // { siteId, domain } → register + DNS + attach + invoice

module.exports = router;
