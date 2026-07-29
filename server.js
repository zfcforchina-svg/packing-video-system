const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db/schema');
const apiRoutes = require('./routes/api');
const uploadRoutes = require('./routes/upload');
const { startWatcher } = require('./services/watcher');
const { startCleanup } = require('./services/cleanup');
const oss = require('./services/oss');

// --- Config ---
const configPath = path.join(__dirname, 'config.json');
function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// --- Self-signed cert for HTTPS (required for mobile camera access) ---
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

function generateCert() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  console.log('[HTTPS] Generating certificate...');
  fs.mkdirSync(certDir, { recursive: true });
  try {
    const { execSync } = require('child_process');
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=packing-video" 2>nul 2>/dev/null`);
  } catch (e) {
    const selfsigned = require('selfsigned');
    const pems = selfsigned.generate([{ name: 'commonName', value: 'packing-video' }], { days: 3650, keySize: 2048 });
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

// --- Init ---
const config = loadConfig();
oss.init(config);

const app = express();

// --- Middleware ---
// Disable caching for HTML/JS/CSS (prevent stale versions)
app.use((req, res, next) => {
  if (req.path.match(/\.(html|js|css|mjs)$/) || req.path === '/' || req.path === '/camera') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/camera', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'camera.html'));
});
app.use('/api', apiRoutes(db, config, saveConfig));

// --- HTTPS or HTTP ---
let server;
try {
  const credentials = generateCert();
  server = https.createServer(credentials, app);
  console.log('[HTTPS] Using HTTPS (required for mobile camera access)');
} catch (e) {
  console.warn('[HTTPS] Failed to setup HTTPS, falling back to HTTP');
  console.warn('[HTTPS] Mobile camera will NOT work on HTTP!');
  console.warn('[HTTPS] Error:', e.message);
  server = http.createServer(app);
}

// --- WebSocket ---
const io = new Server(server, {
  maxHttpBufferSize: (config.maxFileSizeMB || 500) * 1024 * 1024,
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log('[WS] Connected:', socket.id);

  socket.on('upload:start', (meta, ack) => {
    console.log('[WS] Upload start:', meta.trackingNumber);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const timeStr = date.toTimeString().slice(0, 8);
    const safeFilename = `${meta.trackingNumber}_${Date.now()}.webm`;
    const dir = path.join(__dirname, 'uploads', dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, safeFilename);

    socket.uploadMeta = { ...meta, dateStr, timeStr, safeFilename, filePath };
    socket.uploadStream = fs.createWriteStream(filePath);
    socket.uploadBytes = 0;
    if (ack) ack({ ok: true });
  });

  socket.on('upload:chunk', (data, ack) => {
    if (!socket.uploadStream) return ack && ack({ ok: false, error: 'No session' });
    const buffer = Buffer.from(data.data || data);
    socket.uploadStream.write(buffer);
    socket.uploadBytes += buffer.length;
    if (ack) ack({ ok: true, index: data.index });
    socket.emit('upload:progress', {
      received: socket.uploadBytes,
      total: socket.uploadMeta?.fileSize || 0,
    });
  });

  socket.on('upload:complete', (data, ack) => {
    if (!socket.uploadStream || !socket.uploadMeta) {
      return ack && ack({ success: false, error: 'No session' });
    }
    socket.uploadStream.end();

    const m = socket.uploadMeta;
    const relPath = path.join(m.dateStr, m.safeFilename);

    try {
      const result = db.insertVideo({
        trackingNumber: m.trackingNumber,
        filename: m.safeFilename,
        filePath: relPath,
        fileSize: socket.uploadBytes,
        duration: m.duration || 0,
        recordDate: m.dateStr,
        recordTime: m.timeStr,
        uploadMethod: 'wifi',
      });

      // Sync to OSS in background
      const ossRelPath = relPath;
      oss.upload(require('path').join(__dirname, 'uploads', ossRelPath), ossRelPath).then(url => {
        if (url) console.log('[OSS] Synced:', m.trackingNumber);
      }).catch(()=>{});
      if (ack) ack({ success: true, id: result.lastInsertRowid });
      io.emit('new-video', {
        id: result.lastInsertRowid,
        trackingNumber: m.trackingNumber,
        recordDate: m.dateStr,
        recordTime: m.timeStr,
      });
      console.log('[WS] Upload complete:', m.trackingNumber);
    } catch (err) {
      if (ack) ack({ success: false, error: err.message });
    }
    socket.uploadStream = null;
    socket.uploadMeta = null;
    socket.uploadBytes = 0;
  });

  socket.on('upload:resume', (data, ack) => {
    if (ack) ack({ lastIndex: -1 });
  });

  socket.on('disconnect', () => {
    if (socket.uploadStream) socket.uploadStream.end();
    console.log('[WS] Disconnected:', socket.id);
  });
});

// Also update upload routes to use io
app.use('/api', uploadRoutes(io, db, config));

// --- Start ---
const PORT = config.port || 3456;
server.listen(PORT, async () => {
  await db.init();
  startWatcher(db, config);
  startCleanup(db, config);
  const protocol = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n📦 打包录像系统已启动`);
  console.log(`   管理后台: ${protocol}://localhost:${PORT}`);
  console.log(`   手机录像: ${protocol}://<本机IP>:${PORT}/camera`);
  console.log(`   USB导入: 将视频文件放入 usb-import/ 目录`);

  // --- Localtunnel (for external access via mobile data, no signup needed) ---
  try {
    const localtunnel = require('localtunnel');
    const tunnel = await localtunnel({ port: PORT, local_https: true, allow_invalid_cert: true });
    console.log(`   🌐 手机录像: ${tunnel.url}/camera`);
    console.log(`   🌐 管理后台: ${tunnel.url}`);
    console.log(`   (手机流量/外网都能访问！)\n`);
    process.env.TUNNEL_URL = tunnel.url;
    tunnel.on('close', () => console.log('[Tunnel] Disconnected'));
  } catch (e) {
    console.log(`   ⚠️ 公网隧道: ${e.message}. 仅局域网可用\n`);
  }
});
