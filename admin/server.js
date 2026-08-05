const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3458;
const JWT_SECRET = process.env.JWT_SECRET || 'order-admin-secret-key-change-in-production';
const DB_PATH = path.join(__dirname, 'data.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE ====================
let db;

async function initDB() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT DEFAULT '',
    email TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'pending',
    reject_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  save();
  // Check for super admin
  const stmt = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='superadmin'");
  let count = 0;
  while (stmt.step()) count = stmt.getAsObject().c;
  stmt.free();
  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO users (username, password, nickname, role, status) VALUES (?,?,?,?,?)",
      ['admin', hash, '超级管理员', 'superadmin', 'active']);
    save();
    console.log('[DB] Super admin created: admin / admin123');
  }
  console.log('[DB] Initialized');
}

function save() { if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  let r = null; while (stmt.step()) r = stmt.getAsObject(); stmt.free(); return r;
}
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
}
function run(sql, params = []) { db.run(sql, params); save(); }

// ==================== AUTH MIDDLEWARE ====================
function auth(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '未登录' });
    try {
      const user = jwt.verify(token, JWT_SECRET);
      if (user.status !== 'active') return res.status(403).json({ error: '账户未激活，请等待管理员审核' });
      if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: '权限不足' });
      req.user = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: '登录已过期' });
    }
  };
}

// ==================== API ROUTES ====================

// Register
app.post('/api/register', async (req, res) => {
  const { username, password, nickname, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: '账号密码不能为空' });
  if (username.length < 3) return res.status(400).json({ error: '账号至少3个字符' });

  const existing = queryOne('SELECT id FROM users WHERE username=?', [username]);
  if (existing) return res.status(400).json({ error: '账号已存在' });

  // Check whitelist
  const whitelist = queryOne("SELECT value FROM settings WHERE key='email_whitelist'");
  if (whitelist && email) {
    const domains = whitelist.value.split(',').map(s => s.trim()).filter(Boolean);
    const emailDomain = email.split('@')[1];
    if (domains.length && !domains.includes(emailDomain)) {
      return res.status(400).json({ error: '仅限指定邮箱后缀注册' });
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  run('INSERT INTO users (username, password, nickname, email, role, status) VALUES (?,?,?,?,?,?)',
    [username, hash, nickname || username, email || '', 'user', 'pending']);
  res.json({ success: true, message: '注册成功，请等待管理员审核' });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = queryOne('SELECT * FROM users WHERE username=?', [username]);
  if (!user) return res.status(401).json({ error: '账号或密码错误' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '账号或密码错误' });
  if (user.status === 'pending') return res.status(403).json({ error: '账户未激活，请等待管理员审核' });
  if (user.status === 'rejected') return res.status(403).json({ error: '账户已被拒绝: ' + (user.reject_reason || '无理由') });
  if (user.status === 'disabled') return res.status(403).json({ error: '账户已被禁用' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, status: user.status }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
});

// Get current user
app.get('/api/me', auth(), (req, res) => {
  const user = queryOne('SELECT id, username, nickname, email, role, status, created_at FROM users WHERE id=?', [req.user.id]);
  res.json(user);
});

// ==================== ADMIN ROUTES ====================

// List users (admin only)
app.get('/api/admin/users', auth(['superadmin', 'admin']), (req, res) => {
  const { status, search } = req.query;
  let sql = 'SELECT id, username, nickname, email, role, status, reject_reason, created_at FROM users';
  const conditions = [], params = [];
  if (status) { conditions.push('status=?'); params.push(status); }
  if (search) { conditions.push('(username LIKE ? OR nickname LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const users = queryAll(sql, params);
  const pending = queryOne("SELECT COUNT(*) as c FROM users WHERE status='pending'");
  res.json({ users, pendingCount: pending?.c || 0 });
});

// Approve user
app.post('/api/admin/users/:id/approve', auth(['superadmin', 'admin']), (req, res) => {
  const user = queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'superadmin') return res.status(403).json({ error: '不能操作超级管理员' });
  run('UPDATE users SET status=?, reject_reason=? WHERE id=?', ['active', '', req.params.id]);
  res.json({ success: true, message: '已通过审核' });
});

// Reject user
app.post('/api/admin/users/:id/reject', auth(['superadmin', 'admin']), (req, res) => {
  const { reason } = req.body;
  const user = queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'superadmin') return res.status(403).json({ error: '不能操作超级管理员' });
  run('UPDATE users SET status=?, reject_reason=? WHERE id=?', ['rejected', reason || '', req.params.id]);
  res.json({ success: true, message: '已驳回' });
});

// Disable user
app.post('/api/admin/users/:id/disable', auth(['superadmin', 'admin']), (req, res) => {
  const user = queryOne('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'superadmin') return res.status(403).json({ error: '不能操作超级管理员' });
  run('UPDATE users SET status=? WHERE id=?', ['disabled', req.params.id]);
  res.json({ success: true, message: '已禁用' });
});

// Create admin (superadmin only)
app.post('/api/admin/create', auth(['superadmin']), (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.status(400).json({ error: '账号密码不能为空' });
  const existing = queryOne('SELECT id FROM users WHERE username=?', [username]);
  if (existing) return res.status(400).json({ error: '账号已存在' });
  const hash = bcrypt.hashSync(password, 10);
  run('INSERT INTO users (username, password, nickname, role, status) VALUES (?,?,?,?,?)',
    [username, hash, nickname || username, 'admin', 'active']);
  res.json({ success: true, message: '管理员创建成功' });
});

// Settings
app.get('/api/admin/settings', auth(['superadmin']), (req, res) => {
  const whitelist = queryOne("SELECT value FROM settings WHERE key='email_whitelist'");
  res.json({ emailWhitelist: whitelist?.value || '' });
});

app.put('/api/admin/settings', auth(['superadmin']), (req, res) => {
  const { emailWhitelist } = req.body;
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_whitelist', ?)", [emailWhitelist || '']);
  res.json({ success: true });
});

// ==================== START ====================
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`\n📋 订单系统后台管理已启动`);
    console.log(`   地址: http://localhost:${PORT}`);
    console.log(`   超级管理员: admin / admin123\n`);
  });
})();
