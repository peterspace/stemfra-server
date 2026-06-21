const cloudinary = require('cloudinary').v2;

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const missing = [];
if (!CLOUD_NAME) missing.push('CLOUDINARY_CLOUD_NAME');
if (!API_KEY) missing.push('CLOUDINARY_API_KEY');
if (!API_SECRET) missing.push('CLOUDINARY_API_SECRET');

if (missing.length > 0) {
  console.warn('[cloudinary] Missing env vars — uploads will fail:', missing.join(', '));
}

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
  secure: true,
});

function isCloudinaryConfigured() {
  return Boolean(CLOUD_NAME && API_KEY && API_SECRET);
}

module.exports = { cloudinary, isCloudinaryConfigured };
