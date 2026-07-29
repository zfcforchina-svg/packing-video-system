const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, '..', 'data.db');
let db = null;

async function init() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  db.run('PRAGMA journal_mode=WAL');
  db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, tracking_number TEXT NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL, file_size INTEGER DEFAULT 0, duration REAL DEFAULT 0, record_date TEXT NOT NULL, record_time TEXT NOT NULL, upload_method TEXT DEFAULT 'wifi', has_watermark INTEGER DEFAULT 0, notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.run('CREATE INDEX IF NOT EXISTS idx_tracking ON videos(tracking_number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_date ON videos(record_date)');
  save(); console.log('[DB] sql.js OK'); return db;
}
function save() { if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }

function insertVideo(o) { db.run(`INSERT INTO videos (tracking_number,filename,file_path,file_size,duration,record_date,record_time,upload_method) VALUES (?,?,?,?,?,?,?,?)`, [o.trackingNumber,o.filename,o.filePath,o.fileSize||0,o.duration||0,o.recordDate,o.recordTime,o.uploadMethod||'wifi']); save(); const r = db.exec('SELECT last_insert_rowid() as id'); return { lastInsertRowid: r[0].values[0][0] }; }

function listVideos({page=1,limit=50,search='',dateFrom='',dateTo=''}) { const c=[],p=[]; if(search){c.push('tracking_number LIKE ?');p.push('%'+search+'%');} if(dateFrom){c.push('record_date >= ?');p.push(dateFrom);} if(dateTo){c.push('record_date <= ?');p.push(dateTo);} const w = c.length?'WHERE '+c.join(' AND '):''; const off = (page-1)*limit; let total=0,rows=[]; const cs = db.prepare('SELECT COUNT(*) as total FROM videos '+w);cs.bind(p);while(cs.step())total=cs.getAsObject().total;cs.free(); const st = db.prepare('SELECT * FROM videos '+w+' ORDER BY created_at DESC LIMIT ? OFFSET ?');st.bind([...p,limit,off]);while(st.step())rows.push(st.getAsObject());st.free(); return {videos:rows,total,page,totalPages:Math.ceil(total/limit)}; }

function getVideoById(id) { const s=db.prepare('SELECT * FROM videos WHERE id=?');s.bind([id]);let r=null;while(s.step())r=s.getAsObject();s.free();return r; }
function getVideoByTracking(t) { const s=db.prepare('SELECT * FROM videos WHERE tracking_number=? ORDER BY created_at DESC');s.bind([t]);const r=[];while(s.step())r.push(s.getAsObject());s.free();return r; }
function deleteVideo(id) { db.run('DELETE FROM videos WHERE id=?',[id]);save(); }
function updateWatermark(id,fp,fs) { db.run('UPDATE videos SET has_watermark=1,file_path=?,file_size=? WHERE id=?',[fp,fs,id]);save(); }

function getStats() { let total={count:0,size:0},range={earliest:null,latest:null},byMethod=[],byDate=[]; const s1=db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(file_size),0) as size FROM videos');while(s1.step())total=s1.getAsObject();s1.free(); const s2=db.prepare('SELECT MIN(record_date) as earliest, MAX(record_date) as latest FROM videos');while(s2.step())range=s2.getAsObject();s2.free(); const s3=db.prepare('SELECT upload_method, COUNT(*) as count FROM videos GROUP BY upload_method');while(s3.step())byMethod.push(s3.getAsObject());s3.free(); const s4=db.prepare('SELECT record_date, COUNT(*) as count FROM videos GROUP BY record_date ORDER BY record_date DESC LIMIT 30');while(s4.step())byDate.push(s4.getAsObject());s4.free(); return {total,range,byMethod,byDate}; }
function getExpiredVideos(d) { const s=db.prepare("SELECT * FROM videos WHERE record_date < date('now','-'||?||' days')");s.bind([d]);const r=[];while(s.step())r.push(s.getAsObject());s.free();return r; }
function getMonthlyUploadSize() { const now=new Date();const month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;const s=db.prepare("SELECT COALESCE(SUM(file_size),0) as total FROM videos WHERE strftime('%Y-%m',record_date)=?");s.bind([month]);let r=0;while(s.step())r=s.getAsObject().total;s.free();return r; }

module.exports = {init,insertVideo,listVideos,getVideoById,getVideoByTracking,deleteVideo,updateWatermark,getStats,getExpiredVideos,getMonthlyUploadSize};
