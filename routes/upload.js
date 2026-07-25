const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

module.exports = function (_io, db, config) {
  const router = express.Router();

  // Multer for HTTP upload (USB fallback / direct POST)
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const dateStr = new Date().toISOString().slice(0, 10);
      const dir = path.join(__dirname, '..', 'uploads', dateStr);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, _file, cb) => {
      const tracking = req.body.trackingNumber || 'unknown';
      const safeTracking = tracking.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_');
      cb(null, `${safeTracking}_${Date.now()}.mp4`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: (config.maxFileSizeMB || 500) * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp4|webm|mov|avi)$/i)) {
        cb(null, true);
      } else {
        cb(new Error('不支持的视频格式，仅支持 mp4/webm/mov/avi'));
      }
    },
  });

  // HTTP upload endpoint
  router.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未收到视频文件' });

    const trackingNumber = req.body.trackingNumber || 'unknown';
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const timeStr = date.toTimeString().slice(0, 8);
    const relPath = path.join(dateStr, req.file.filename);

    const result = db.insertVideo({
      trackingNumber,
      filename: req.file.filename,
      filePath: relPath,
      fileSize: req.file.size,
      duration: parseFloat(req.body.duration) || 0,
      recordDate: dateStr,
      recordTime: timeStr,
      uploadMethod: 'http',
    });

    // Sync to cloud storage (R2/OSS)
    const oss = require('../services/oss');
    const fullPath = path.join(__dirname, '..', 'uploads', relPath);
    oss.upload(fullPath, relPath).then(url => {
      if (url) console.log('[Cloud] Synced (HTTP):', trackingNumber);
    });

    res.json({
      success: true,
      id: result.lastInsertRowid,
      filePath: relPath,
    });
  });

  // Serve uploaded videos via /uploads/... (handled by express.static in server.js)

  return router;
};
