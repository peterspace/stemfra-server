// Backup sweeper admin surface (P21) — PLATFORM_ADMIN, same gate as billing.
// GET / lists the nightly backups on disk; POST /run triggers one now.
const express = require('express');
const { requireStaffRole, PLATFORM_ADMIN } = require('../../middleware/staffAuth');
const { listBackups, runOnce, BACKUP_DIR, TABLES } = require('../../lib/backupSweeper');

const router = express.Router();
const gate = requireStaffRole(...PLATFORM_ADMIN);

router.get('/', gate, (_req, res) => {
  res.json({ dir: BACKUP_DIR, tables: TABLES.length, backups: listBackups() });
});

router.post('/run', gate, async (_req, res) => {
  const manifest = await runOnce('manual');
  res.json(manifest);
});

module.exports = router;
