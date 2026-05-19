// ─── Per-user settings (Phase 2: record_calls toggle) ────────────────────────
//
// Endpoints:
//   GET   /api/user-settings — fetch the caller's settings (auto-creates a default row)
//   PATCH /api/user-settings — update a whitelisted subset of fields
//
// Auth: validates the Supabase JWT in the Authorization: Bearer header,
// same pattern as the other authenticated server endpoints. The server uses
// the service-role Supabase client (bypasses RLS) but we still scope all
// reads/writes to the caller's user_id explicitly.

const express  = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

const ALLOWED_FIELDS = ['record_calls'];

async function validateUserSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// GET /api/user-settings
router.get('/', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: existing, error: readErr } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readErr) throw readErr;

    if (existing) return res.json(existing);

    // Default row on first read.
    const { data: created, error: insertErr } = await supabase
      .from('user_settings')
      .insert([{ user_id: user.id, record_calls: false }])
      .select()
      .single();
    if (insertErr) throw insertErr;

    res.json(created);
  } catch (err) {
    console.error('[user-settings] GET error:', err);
    res.status(500).json({ error: err.message || 'Failed to load settings' });
  }
});

// PATCH /api/user-settings
router.patch('/', async (req, res) => {
  const user = await validateUserSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const updates = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const k of ALLOWED_FIELDS) {
    if (k in (req.body || {})) updates[k] = req.body[k];
  }

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(updates, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[user-settings] PATCH error:', err);
    res.status(500).json({ error: err.message || 'Failed to save settings' });
  }
});

module.exports = router;
