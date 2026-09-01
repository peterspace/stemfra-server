// Nightly backup sweeper (P21 item 1, 2026-09-01) — the production Supabase org
// runs the FREE plan (no backups), so until the Pro upgrade this turns "total
// loss" into "restore yesterday" at zero cost: every night it dumps the
// business-critical tables to compressed JSON on the VPS disk (a compose named
// volume, so backups survive redeploys) with rolling retention.
//
// Gates + knobs (all env, sane defaults — ON unless killed):
//   BACKUP_ENABLED=false     kill switch (anything else = armed)
//   BACKUP_DIR               default <repo>/backups (compose mounts a volume there)
//   BACKUP_RETENTION_DAYS    default 7 (rolling — older nightly dirs are deleted)
//   BACKUP_HOUR_UTC          default 7 (≈ 02:00–03:00 US Eastern)
//
// Layout: <BACKUP_DIR>/<YYYY-MM-DD>/<table>.json.gz + manifest.json (counts,
// bytes, errors, timing). Failures email NOTIFY_EMAIL best-effort and never
// crash the server.
//
// RESTORE (manual, deliberate): gunzip a table file → a JSON array of rows →
// re-insert via the service key in FK order (companies/contacts → sites →
// site_pages → site_sections → categories → services/team → the rest). There is
// intentionally no automated restore endpoint — restoring is a human decision.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const supabase = require('../config/supabase');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 7;
const HOUR_UTC = Number.isFinite(Number(process.env.BACKUP_HOUR_UTC)) ? Number(process.env.BACKUP_HOUR_UTC) : 7;
const PAGE = 1000;

// The business-critical set (ROADMAP P21 list + the config/content tables the
// platform leans on). `order` must be a stable unique column for pagination.
const TABLES = [
  { name: 'companies' },
  { name: 'contacts' },
  { name: 'sites' },
  { name: 'site_theme_settings' },
  { name: 'site_pages' },
  { name: 'site_sections' },
  { name: 'site_service_categories' },
  { name: 'site_services' },
  { name: 'site_team_members' },
  { name: 'site_team_service_links' },
  { name: 'site_availability_rules' },
  { name: 'site_testimonials' },
  { name: 'site_media' },
  { name: 'site_posts' },
  { name: 'site_promotions' },
  { name: 'site_customers' },
  { name: 'site_bookings' },
  { name: 'site_booking_groups' },
  { name: 'site_subscriptions' },
  { name: 'site_leads' },
  { name: 'site_newsletter_subscribers' },
  { name: 'site_products' },
  { name: 'templates' },
  { name: 'verticals' },
  { name: 'subscriptions' },
  { name: 'billing_charges' },
  { name: 'legal_acceptances' },
  { name: 'support_requests' },
  { name: 'leads' },
  { name: 'deals' },
];

const dateStamp = (d = new Date()) => d.toISOString().slice(0, 10);

// Stream one table to <dir>/<table>.json.gz, paginating so a large table never
// has to fit in memory. Returns { rows, bytes } or throws.
async function dumpTable(dir, { name, order = 'id' }) {
  const outPath = path.join(dir, `${name}.json.gz`);
  const gzip = zlib.createGzip({ level: 6 });
  const sink = fs.createWriteStream(outPath);
  gzip.pipe(sink);
  const write = (chunk) =>
    new Promise((resolve, reject) => gzip.write(chunk, (err) => (err ? reject(err) : resolve())));

  let rows = 0;
  try {
    await write('[');
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(name)
        .select('*')
        .order(order, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${name}: ${error.message}`);
      if (!data || data.length === 0) break;
      const chunk = data.map((r) => JSON.stringify(r)).join(',');
      await write(rows === 0 ? chunk : ',' + chunk);
      rows += data.length;
      if (data.length < PAGE) break;
    }
    await write(']');
    await new Promise((resolve, reject) => {
      sink.on('finish', resolve);
      sink.on('error', reject);
      gzip.end();
    });
    return { rows, bytes: fs.statSync(outPath).size };
  } catch (err) {
    try { gzip.destroy(); sink.destroy(); fs.rmSync(outPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/** Run one full backup. Returns the manifest (also written to disk). */
async function runBackup() {
  const startedAt = new Date();
  const dir = path.join(BACKUP_DIR, dateStamp(startedAt));
  fs.mkdirSync(dir, { recursive: true });

  const manifest = { startedAt: startedAt.toISOString(), tables: {}, errors: [] };
  for (const t of TABLES) {
    try {
      manifest.tables[t.name] = await dumpTable(dir, t);
    } catch (err) {
      manifest.errors.push({ table: t.name, error: err.message });
      console.error(`[backup] ${t.name} failed:`, err.message);
    }
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.totalRows = Object.values(manifest.tables).reduce((s, t) => s + t.rows, 0);
  manifest.totalBytes = Object.values(manifest.tables).reduce((s, t) => s + t.bytes, 0);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  pruneOldBackups();

  const mb = (manifest.totalBytes / 1024 / 1024).toFixed(1);
  console.log(`[backup] ${dateStamp(startedAt)}: ${manifest.totalRows} rows, ${mb}MB, ${manifest.errors.length} errors`);
  if (manifest.errors.length > 0) notifyFailure(manifest);
  return manifest;
}

function pruneOldBackups() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(BACKUP_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      if (new Date(`${entry}T00:00:00Z`).getTime() < cutoff) {
        fs.rmSync(path.join(BACKUP_DIR, entry), { recursive: true, force: true });
        console.log(`[backup] pruned ${entry} (retention ${RETENTION_DAYS}d)`);
      }
    }
  } catch (err) {
    console.error('[backup] prune failed:', err.message);
  }
}

/** List backups on disk, newest first, with their manifest summaries. */
function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort()
      .reverse()
      .map((date) => {
        let manifest = null;
        try { manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, date, 'manifest.json'), 'utf8')); } catch { /* partial */ }
        return {
          date,
          totalRows: manifest?.totalRows ?? null,
          totalBytes: manifest?.totalBytes ?? null,
          errors: manifest?.errors?.length ?? null,
          finishedAt: manifest?.finishedAt ?? null,
        };
      });
  } catch {
    return [];
  }
}

function notifyFailure(manifest) {
  try {
    const { sendMail } = require('./mailer');
    const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
    if (!to) return;
    const lines = manifest.errors.map((e) => `- ${e.table}: ${e.error}`).join('\n');
    sendMail({
      fromName: 'Stemfra Ops',
      to,
      subject: `Backup sweep had ${manifest.errors.length} error(s)`,
      text: `The nightly data backup finished with errors.\n\n${lines}\n\nManifest: ${manifest.startedAt}\nCheck the server logs + disk.`,
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), HOUR_UTC, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

let running = false;
async function runOnce(trigger) {
  if (running) return { skipped: true };
  running = true;
  try {
    console.log(`[backup] run starting (${trigger})`);
    return await runBackup();
  } catch (err) {
    console.error('[backup] run failed:', err.message);
    notifyFailure({ startedAt: new Date().toISOString(), errors: [{ table: '(run)', error: err.message }], tables: {} });
    return { error: err.message };
  } finally {
    running = false;
  }
}

function startBackupSweeper() {
  if (process.env.BACKUP_ENABLED === 'false') {
    console.log('[backup] sweeper disabled (BACKUP_ENABLED=false)');
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Boot catch-up: if the newest backup is older than ~26h (or none exists),
  // run shortly after boot instead of waiting for tonight — covers servers that
  // were down over the scheduled hour.
  const newest = listBackups()[0];
  const newestAge = newest?.finishedAt ? Date.now() - new Date(newest.finishedAt).getTime() : Infinity;
  if (newestAge > 26 * 60 * 60 * 1000) {
    setTimeout(() => runOnce('boot catch-up'), 60 * 1000);
  }

  const scheduleNext = () => {
    const ms = msUntilNextRun();
    setTimeout(async () => {
      await runOnce('nightly');
      scheduleNext();
    }, ms);
    console.log(`[backup] next nightly run in ${(ms / 60000).toFixed(0)} min (hour ${HOUR_UTC} UTC, retention ${RETENTION_DAYS}d, dir ${BACKUP_DIR})`);
  };
  scheduleNext();
}

module.exports = { startBackupSweeper, runOnce, listBackups, BACKUP_DIR, TABLES };
