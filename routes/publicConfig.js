// PUBLIC, non-secret client configuration for the template apps.
//
// Exists so values every tenant site needs (today: the Mapbox PUBLIC token)
// have ONE versioned source of record — this server's deploy.yml env — instead
// of being hand-set as build-time vars on six Cloudflare Pages projects
// (Peter's call, 2026-08-04). Rotating a value here reaches every site on the
// next fetch; no Pages rebuilds.
//
// ONLY values that are safe in any browser belong here. A pk. Mapbox token is
// designed to ship in bundles; nothing secret may ever be added to this payload.
const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    mapboxToken: process.env.MAPBOX_PUBLIC_TOKEN || null,
  });
});

module.exports = router;
