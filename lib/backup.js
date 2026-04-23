const fs = require('fs');
const path = require('path');

/**
 * Copy coaching_logs.csv to data/backups/coaching_logs_YYYY-MM-DD.csv
 * Skips if a backup for today already exists.
 */
function backupCsv(dataDir) {
  const srcFile = path.join(dataDir, 'coaching_logs.csv');
  if (!fs.existsSync(srcFile)) {
    console.log('[backup] No CSV file to back up.');
    return { success: false, reason: 'source_missing' };
  }

  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const destFile = path.join(backupDir, `coaching_logs_${today}.csv`);

  if (fs.existsSync(destFile)) {
    console.log(`[backup] Backup for ${today} already exists, skipping.`);
    return { success: true, skipped: true, file: destFile };
  }

  try {
    fs.copyFileSync(srcFile, destFile);
    console.log(`[backup] Created backup: ${destFile}`);
    return { success: true, skipped: false, file: destFile };
  } catch (err) {
    console.error(`[backup] Failed: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

module.exports = { backupCsv };
