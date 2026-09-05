// profileAvatar.js — a staff member's own profile photo (Stemfra OS, Peter
// 2026-09-05: "use the same image on the lock screen and let the user update
// it from their profile settings"). POST multipart {file} → Cloudinary
// stemfra_staff/avatars/<user id> (square, face-aware crop, WebP) → writes
// profiles.avatar_url for the caller ONLY (service role; the row is theirs).
// The CRM reads profiles.avatar_url first everywhere (lib/avatars.js).
const express = require('express');
const busboy = require('connect-busboy');
const { requireStaffAuth } = require('../middleware/staffAuth');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const supabase = require('../config/supabase');

const router = express.Router();
router.use(busboy({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } }));

router.post('/', requireStaffAuth, (req, res) => {
  if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Photo uploads are not configured.' });
  if (!req.busboy) return res.status(400).json({ error: 'multipart form required' });
  const userId = req.staffUser.id;
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
        folder: 'stemfra_staff/avatars',
        public_id: userId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        format: 'webp',
        quality: 'auto:good',
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
      },
      async (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        const { error } = await supabase.from('profiles').update({ avatar_url: result.secure_url }).eq('id', userId);
        if (error) return res.status(500).json({ error: error.message });
        res.json({ url: result.secure_url });
      },
    );
    file.pipe(stream);
  });
  req.busboy.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'upload failed' }); });
  req.pipe(req.busboy);
});

module.exports = router;
