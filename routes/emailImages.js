// emailImages.js — inline images for CRM email composing (2026-08-31,
// the leadgen-CRM composer parity arc). Staff-only; WebP via Cloudinary
// into stemfra_assets/email-images (distinct from mockup sources).
const express = require('express');
const crypto = require('crypto');
const busboy = require('connect-busboy');
const { requireStaffAuth } = require('../middleware/staffAuth');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

const router = express.Router();
router.use(busboy({ limits: { fileSize: 15 * 1024 * 1024 } }));

router.post('/', requireStaffAuth, (req, res) => {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Image uploads are not configured.' });
  if (!req.busboy) return res.status(400).json({ error: 'multipart form required' });
  let handled = false;
  req.busboy.on('file', (name, file, info) => {
    if (handled) return file.resume();
    handled = true;
    if (!String(info.mimeType || '').startsWith('image/')) {
      file.resume();
      return res.status(400).json({ error: 'Only images are accepted.' });
    }
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'stemfra_assets/email-images',
        public_id: crypto.randomBytes(6).toString('hex'),
        resource_type: 'image',
        format: 'webp',
        quality: 'auto:good',
        transformation: [{ width: 1200, crop: 'limit' }],
      },
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ url: result.secure_url });
      },
    );
    file.pipe(stream);
  });
  req.busboy.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'upload failed' }); });
  req.pipe(req.busboy);
});

module.exports = router;
