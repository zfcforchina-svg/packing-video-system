const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const db = require('./db/schema');
const apiRoutes = require('./routes/api');
const uploadRoutes = require('./routes/upload');
const { startWatcher } = require('./services/watcher');
const { startCleanup } = require('./services/cleanup');

// --- Config ---
const configPath = path.join(__dirname, 'config.json');
function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// --- Init ---
const config = loadConfig();
db.init();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: config.maxFileSizeMB * 1024 * 1024 });

// --- Middleware ---
app.use(express.json());

// Static files — uploads directory for video playback
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public web assets
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/camera', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'camera.html'));
});

app.use('/api', apiRoutes(db, config, saveConfig));
app.use('/api', uploadRoutes(io, db, config));

// --- WebSocket ---
io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);

  // Phone uploads video chunks via WebSocket
  socket.on('upload:start', (meta) => {
    console.log('[WS] Upload start:', meta.trackingNumber);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const timeStr = date.toTimeString().slice(0, 8);
    const safeFilename = `${meta.trackingNumber}_${Date.now()}.mp4`;
    const dir = path.join(__dirname, 'uploads', dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, safeFilename);

    socket.uploadMeta = { ...meta, dateStr, timeStr, safeFilename, filePath };
    socket.uploadStream = fs.createWriteStream(filePath);
    socket.uploadBytes = 0;
  });

  socket.on('upload:chunk', (chunk) => {
    if (!socket.uploadStream) return;
    const buffer = Buffer.from(chunk);
    socket.uploadStream.write(buffer);
    socket.uploadBytes += buffer.length;
    socket.emit('upload:progress', {
      received: socket.uploadBytes,
      total: socket.uploadMeta?.fileSize || 0,
    });
  });

  socket.on('upload:complete', () => {
    if (!socket.uploadStream || !socket.uploadMeta) return;
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

      socket.emit('upload:done', { success: true, id: result.lastInsertRowid });
      // Notify dashboard
      io.emit('new-video', {
        id: result.lastInsertRowid,
        trackingNumber: m.trackingNumber,
        recordDate: m.dateStr,
        recordTime: m.timeStr,
      });
      console.log('[WS] Upload complete:', m.trackingNumber);
    } catch (err) {
      socket.emit('upload:done', { success: false, error: err.message });
    }

    socket.uploadStream = null;
    socket.uploadMeta = null;
    socket.uploadBytes = 0;
  });

  socket.on('disconnect', () => {
    if (socket.uploadStream) {
      socket.uploadStream.end();
    }
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// --- Start Services ---
startWatcher(db, config);
startCleanup(db, config);

// --- Start Server ---
server.listen(config.port, () => {
  console.log(`\n📦 打包录像系统已启动`);
  console.log(`   管理后台: http://localhost:${config.port}`);
  console.log(`   手机录像: http://<本机IP>:${config.port}/camera`);
  console.log(`   USB导入: 将视频文件放入 usb-import/ 目录\n`);
});
