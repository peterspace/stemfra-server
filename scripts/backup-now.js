// Manual backup run (P21): node -r dotenv/config scripts/backup-now.js
// Same code path as the nightly sweeper; prints the manifest summary.
const { runOnce, BACKUP_DIR } = require('../lib/backupSweeper');

runOnce('manual script').then((m) => {
  if (m.error) { console.error('failed:', m.error); process.exit(1); }
  if (m.skipped) { console.log('a backup is already running'); return; }
  console.log(`dir: ${BACKUP_DIR}`);
  console.log(`rows: ${m.totalRows}  bytes: ${m.totalBytes}  errors: ${m.errors.length}`);
  for (const e of m.errors) console.log('  error:', e.table, '-', e.error);
});
