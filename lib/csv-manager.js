const fs = require('fs');
const path = require('path');

const BASE_COLUMNS = [
  'id', 'created_at', 'date', 'coach', 'team_name', 'founder_name',
  'session_type', 'session_num', 'stage', 'stage_detail', 'main_topic',
  'last_commitment', 'last_done', 'last_number', 'last_result',
  'real_issue', 'blocker_type', 'ai_used',
  'next_action', 'next_deadline', 'next_evidence', 'next_checkin',
  'session_note', 'watch_next', 'energy'
];

const UTF8_BOM = '\uFEFF';

class CsvManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'coaching_logs.csv');
    this.records = [];
    this.metricColumns = []; // dynamic metric_* column names
    this._ensureDataDir();
    this._load();
  }

  // ---- internal helpers ----

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _allColumns() {
    return [...BASE_COLUMNS, ...this.metricColumns];
  }

  _escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  _parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      this.records = [];
      this.metricColumns = [];
      return;
    }

    let content = fs.readFileSync(this.filePath, 'utf-8');
    // strip BOM
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length === 0) {
      this.records = [];
      this.metricColumns = [];
      return;
    }

    const headerFields = this._parseCsvLine(lines[0]);

    // separate metric columns from base columns
    this.metricColumns = headerFields.filter(h => h.startsWith('metric_') && !BASE_COLUMNS.includes(h));

    // parse rows
    this.records = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = this._parseCsvLine(lines[i]);
      const record = {};
      for (let j = 0; j < headerFields.length; j++) {
        record[headerFields[j]] = fields[j] !== undefined ? fields[j] : '';
      }
      this.records.push(record);
    }
  }

  _buildCsvRow(record) {
    const cols = this._allColumns();
    return cols.map(col => this._escapeCsvField(record[col])).join(',');
  }

  _writeFullFile() {
    const cols = this._allColumns();
    const headerLine = cols.map(c => this._escapeCsvField(c)).join(',');
    const dataLines = this.records.map(r => this._buildCsvRow(r));
    const content = UTF8_BOM + [headerLine, ...dataLines].join('\n') + '\n';
    fs.writeFileSync(this.filePath, content, 'utf-8');
  }

  _appendLine(record) {
    const line = this._buildCsvRow(record);
    if (this.records.length === 1 && !fs.existsSync(this.filePath)) {
      // first record ever - write header + row
      this._writeFullFile();
      return;
    }

    // Check if file exists; if not, write full file (header + all rows)
    if (!fs.existsSync(this.filePath)) {
      this._writeFullFile();
      return;
    }

    // just append the line
    fs.appendFileSync(this.filePath, line + '\n', 'utf-8');
  }

  _nextId() {
    if (this.records.length === 0) return 1;
    const maxId = this.records.reduce((max, r) => {
      const n = parseInt(r.id, 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return maxId + 1;
  }

  _flattenMetrics(record) {
    // Convert metrics array [{name, value}] into metric_NAME fields
    const flat = { ...record };
    const newMetricCols = [];

    if (Array.isArray(record.metrics)) {
      for (const m of record.metrics) {
        if (!m.name) continue;
        const colName = 'metric_' + m.name.replace(/[^a-zA-Z0-9_]/g, '_');
        flat[colName] = m.value !== undefined ? m.value : '';
        if (!this.metricColumns.includes(colName)) {
          newMetricCols.push(colName);
        }
      }
      delete flat.metrics;
    }

    return { flat, newMetricCols };
  }

  // ---- public API ----

  append(record) {
    try {
      const { flat, newMetricCols } = this._flattenMetrics(record);

      const id = this._nextId();
      flat.id = String(id);
      flat.created_at = flat.created_at || new Date().toISOString();

      // If new metric columns appeared, add them and rewrite the whole file
      const needsRebuild = newMetricCols.length > 0;
      if (needsRebuild) {
        this.metricColumns.push(...newMetricCols);
      }

      // Ensure all base + metric columns have at least empty string
      for (const col of this._allColumns()) {
        if (flat[col] === undefined || flat[col] === null) {
          flat[col] = '';
        }
      }

      this.records.push(flat);

      if (needsRebuild || this.records.length === 1) {
        this._writeFullFile();
      } else {
        this._appendLine(flat);
      }

      return { success: true, id, csv_row_num: this.records.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getAll() {
    return this.records;
  }

  getByTeam(name) {
    const lower = name.toLowerCase();
    return this.records.filter(r => (r.team_name || '').toLowerCase() === lower);
  }

  getTeamSummaries() {
    const teams = {};
    for (const r of this.records) {
      const name = r.team_name || 'Unknown';
      if (!teams[name]) {
        teams[name] = {
          team_name: name,
          last_session_date: r.date || '',
          session_count: 0,
          stage: r.stage || '',
          last_session_num: r.session_num || ''
        };
      }
      teams[name].session_count++;
      // update to latest date
      if (r.date && r.date > teams[name].last_session_date) {
        teams[name].last_session_date = r.date;
        teams[name].stage = r.stage || teams[name].stage;
        teams[name].last_session_num = r.session_num || teams[name].last_session_num;
      }
    }
    return Object.values(teams);
  }

  deleteById(id) {
    const idStr = String(id);
    const idx = this.records.findIndex(r => r.id === idStr);
    if (idx === -1) {
      return { success: false, error: 'Record not found' };
    }
    this.records.splice(idx, 1);
    this._writeFullFile();
    return { success: true };
  }

  getFilePath() {
    return this.filePath;
  }

  getRecordCount() {
    return this.records.length;
  }
}

module.exports = CsvManager;
