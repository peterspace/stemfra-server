const express = require('express');
const router = express.Router();
const { requireCmsAuth } = require('../../middleware/cmsAuth');
const { init, send, list, get, rename, onboarding, onboardingMark } = require('../../controllers/cms/assistantController');

// Stacy (CMS copilot) — all owner-auth gated.
router.post('/init', requireCmsAuth, init);                  // { siteId, conversationId? }
router.post('/send', requireCmsAuth, send);                  // { siteId, conversationId, message }
router.get('/onboarding', requireCmsAuth, onboarding);       // ?siteId=  → setup checklist
router.post('/onboarding', requireCmsAuth, onboardingMark);  // { siteId, key?, done?, dismissed? }
router.get('/', requireCmsAuth, list);                       // ?siteId=  → conversation list
router.get('/:id', requireCmsAuth, get);                     // ?siteId=  → one conversation
router.patch('/:id', requireCmsAuth, rename);                // { siteId, title }  → rename

module.exports = router;
