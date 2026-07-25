const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function (db, config, saveConfig) {
  const router = express.Router();

  // --- List videos (with search & pagination) ---
  router.get('/videos', (req, res) => {
    const { page = 1, limit = 50, search = '', dateFrom = '', dateTo = '' } = req.query;
    const result = db.listVideos({
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 200),
      search,
      dateFrom,
      dateTo,
    });
    res.json(result);
  });

  // --- Get single video ---
  router.get('/videos/:id', (req, res) => {
    const video = db.getVideoById(req.params.id);
    if (!video) return res.status(404).json({ error: '视频不存在' });
    res.json(video);
  });

  // --- Search by tracking number ---
  router.get('/videos/tracking/:number', (req, res) => {
    const videos = db.getVideoByTracking(req.params.number);
    res.json(videos);
  });

  // --- Delete video ---
  router.delete('/videos/:id', (req, res) => {
    const video = db.getVideoById(req.params.id);
    if (!video) return res.status(404).json({ error: '视频不存在' });

    // Delete file
    const fullPath = path.join(__dirname, '..', 'uploads', video.file_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    db.deleteVideo(req.params.id);
    res.json({ success: true, message: '已删除' });
  });

  // --- Batch delete ---
  router.post('/videos/batch-delete', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });

    let deleted = 0;
    for (const id of ids) {
      const video = db.getVideoById(id);
      if (!video) continue;
      const fullPath = path.join(__dirname, '..', 'uploads', video.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      db.deleteVideo(id);
      deleted++;
    }
    res.json({ success: true, deleted });
  });

  // --- Storage stats ---
  router.get('/stats', (_req, res) => {
    const stats = db.getStats();
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    let diskFree = 0;
    try {
      // Simple disk check — works on macOS/Linux
      const { size } = fs.statfsSync(uploadsDir);
      diskFree = size || 0;
    } catch (_) { /* ignore */ }

    res.json({
      ...stats,
      diskFreeGB: diskFree ? (diskFree / (1024 * 1024 * 1024)).toFixed(1) : 'N/A',
    });
  });

  // --- Get config ---
  router.get('/config', (_req, res) => {
    res.json(config);
  });

  // --- Update config ---
  router.put('/config', (req, res) => {
    const allowed = ['port', 'retentionDays', 'enableWatermark', 'watermarkFontSize', 'maxFileSizeMB'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        config[key] = req.body[key];
      }
    }
    saveConfig(config);
    res.json({ success: true, config });
  });

  // --- Pending USB imports (unknown tracking numbers) ---
  router.get('/pending-imports', (_req, res) => {
    const importDir = path.join(__dirname, '..', config.usbImportDir);
    if (!fs.existsSync(importDir)) return res.json([]);
    const files = fs.readdirSync(importDir)
      .filter(f => /\.(mp4|webm|mov|avi)$/i.test(f))
      .map(f => ({ filename: f, size: fs.statSync(path.join(importDir, f)).size }));
    res.json(files);
  });

  return router;
};
