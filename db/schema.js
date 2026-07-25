const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.db');

let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_number TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      duration REAL DEFAULT 0,
      record_date TEXT NOT NULL,
      record_time TEXT NOT NULL,
      upload_method TEXT DEFAULT 'wifi',
      has_watermark INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_tracking ON videos(tracking_number);
    CREATE INDEX IF NOT EXISTS idx_date ON videos(record_date);
  `);

  console.log('[DB] SQLite initialized');
  return db;
}

// --- Video CRUD ---

function insertVideo({ trackingNumber, filename, filePath, fileSize, duration,
                        recordDate, recordTime, uploadMethod }) {
  const stmt = db.prepare(`
    INSERT INTO videos (tracking_number, filename, file_path, file_size, duration,
                        record_date, record_time, upload_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(trackingNumber, filename, filePath, fileSize, duration,
                  recordDate, recordTime, uploadMethod);
}

function listVideos({ page = 1, limit = 50, search = '', dateFrom = '', dateTo = '' }) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('tracking_number LIKE ?');
    params.push(`%${search}%`);
  }
  if (dateFrom) {
    conditions.push('record_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('record_date <= ?');
    params.push(dateTo);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM videos ${where}`).get(...params);
  const rows = db.prepare(
    `SELECT * FROM videos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return {
    videos: rows,
    total: countRow.total,
    page,
    totalPages: Math.ceil(countRow.total / limit),
  };
}

function getVideoById(id) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

function getVideoByTracking(trackingNumber) {
  return db.prepare(
    'SELECT * FROM videos WHERE tracking_number = ? ORDER BY created_at DESC'
  ).all(trackingNumber);
}

function deleteVideo(id) {
  return db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}

function updateWatermark(id, filePath, fileSize) {
  return db.prepare(
    'UPDATE videos SET has_watermark = 1, file_path = ?, file_size = ? WHERE id = ?'
  ).run(filePath, fileSize);
}

// --- Stats ---

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(file_size),0) as size FROM videos').get();
  const range = db.prepare(
    'SELECT MIN(record_date) as earliest, MAX(record_date) as latest FROM videos'
  ).get();
  const byMethod = db.prepare(
    'SELECT upload_method, COUNT(*) as count FROM videos GROUP BY upload_method'
  ).all();
  const byDate = db.prepare(
    `SELECT record_date, COUNT(*) as count
     FROM videos
     GROUP BY record_date
     ORDER BY record_date DESC
     LIMIT 30`
  ).all();

  return { total, range, byMethod, byDate };
}

// --- Cleanup ---

function getExpiredVideos(retentionDays) {
  return db.prepare(
    `SELECT * FROM videos
     WHERE record_date < date('now', '-' || ? || ' days')`
  ).all(retentionDays);
}

module.exports = { init, insertVideo, listVideos, getVideoById, getVideoByTracking,
                   deleteVideo, updateWatermark, getStats, getExpiredVideos };
