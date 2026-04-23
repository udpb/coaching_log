require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const CsvManager = require('./lib/csv-manager');
const { backupCsv } = require('./lib/backup');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const DATA_DIR = process.env.DATA_DIR || './data';
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';

// Resolve DATA_DIR relative to project root
const resolvedDataDir = path.resolve(__dirname, DATA_DIR);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize CSV manager
const csvManager = new CsvManager(resolvedDataDir);

// ---- API Routes ----

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', records: csvManager.getRecordCount() });
});

// Get all logs (optional ?team=NAME filter)
app.get('/api/logs', (req, res) => {
  try {
    const team = req.query.team;
    const logs = team ? csvManager.getByTeam(team) : csvManager.getAll();
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Team summaries
app.get('/api/logs/teams', (req, res) => {
  try {
    const summaries = csvManager.getTeamSummaries();
    res.json({ success: true, count: summaries.length, data: summaries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export CSV file download
app.get('/api/logs/export', (req, res) => {
  try {
    const filePath = csvManager.getFilePath();
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'No CSV file found' });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="coaching_logs.csv"');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save new log
app.post('/api/logs', (req, res) => {
  try {
    const record = req.body;
    if (!record || typeof record !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must be a JSON object' });
    }
    const result = csvManager.append(record);
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a log by id
app.delete('/api/logs/:id', (req, res) => {
  try {
    const result = csvManager.deleteById(req.params.id);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Daily backup cron ----
if (BACKUP_ENABLED) {
  // Run at midnight every day
  cron.schedule('0 0 * * *', () => {
    console.log('[cron] Running daily backup...');
    backupCsv(resolvedDataDir);
  });
  console.log('[cron] Daily backup scheduled at midnight.');
}

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Underdogs Coaching Log running on port ${PORT}`);
});
