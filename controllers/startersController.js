// Public Starter catalog — the sample sites shown on the marketing page + the
// onboarding "choose your starting design" picker. Read-only; returns only the
// curated `metadata.is_starter` sites + their public preview URLs.
const { listStarters } = require('../lib/starters');

async function list(req, res) {
  try {
    const starters = await listStarters({ vertical: req.query.vertical || null });
    res.json({ starters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { list };
