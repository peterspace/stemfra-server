const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { connect, status, disconnect, searchDomains, checkOne, registerOwn, manage, setAutoRenew, portfolio } = require('../../controllers/cms/domainController');

// Owner self-serve brand-domain connect (all gated by CMS owner auth).
router.get('/', requireCmsAuth, status);        // ?siteId= → current connection + CF status
router.post('/', requireCmsAuth, connect);      // { siteId, domain }
router.delete('/', requireCmsAuth, disconnect); // { siteId }

// Owner "buy a domain" (Hostinger-style search → instant register + invoice).
router.get('/search', requireCmsAuth, searchDomains); // ?siteId=&q= → exact (live) + alternates (cached pricing)
router.get('/check', requireCmsAuth, checkOne);       // ?siteId=&domain= → one live availability check
router.post('/register', requireCmsAuth, registerOwn); // { siteId, domain } → register + DNS + attach + invoice

// Namecheap-style manage (2026-08-10): registrar record + renewal controls +
// the owner's cross-site domain overview.
router.get('/manage', requireCmsAuth, manage);          // ?siteId= → expiry / auto-renew / renewal price
router.post('/auto-renew', requireCmsAuth, setAutoRenew); // { siteId, enabled }
router.get('/portfolio', requireCmsAuth, portfolio);    // → all the owner's domains across their sites

module.exports = router;
