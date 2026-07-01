// Hard-purge sweeper (P6.26). Sites soft-deleted longer than the grace window
// (90 days) get their Cloudinary media + all DB rows permanently destroyed.
// Idempotent + best-effort: a failure on one site is logged and retried next run.
const supabase = require('../config/supabase');
const { hardPurgeSite, GRACE_DAYS } = require('./siteDeletion');

async function sweepOnce() {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86400000).toISOString();
  const { data: due, error } = await supabase.from('sites')
    .select('id, subdomain')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff)
    .limit(25);
  if (error || !due?.length) return;
  for (const s of due) {
    try {
      const r = await hardPurgeSite(s.id);
      console.log(`[delete] purged ${s.subdomain} — ${r.mediaDeleted} media, ${r.dbErrors.length} db error(s)`);
    } catch (e) {
      console.error('[delete] purge failed for', s.id, '—', e.message);
    }
  }
}

// Runs twice a day; the grace cutoff makes it safe to run as often as we like.
function startSiteDeletionSweeper({ intervalMs = 12 * 3600 * 1000 } = {}) {
  setTimeout(() => sweepOnce().catch(() => {}), 60000); // shortly after boot
  const t = setInterval(() => sweepOnce().catch(() => {}), intervalMs);
  console.log(`✓ Site-deletion sweeper running every ${Math.round(intervalMs / 3600000)}h (${GRACE_DAYS}-day grace)`);
  return t;
}

module.exports = { sweepOnce, startSiteDeletionSweeper };
