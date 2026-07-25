const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

/**
 * Watch the usb-import directory for new video files.
 * When a file is detected (and stable), move it to uploads/<date>/ and record in DB.
 *
 * The filename before extension is treated as the tracking number.
 * Example: "SF1234567890.mp4" → trackingNumber = "SF1234567890"
 */
function startWatcher(db, config) {
  const importDir = path.join(__dirname, '..', config.usbImportDir);
  fs.mkdirSync(importDir, { recursive: true });

  console.log('[Watcher] Watching:', importDir);

  const watcher = chokidar.watch(importDir, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 3000, // wait 3s after last write
      pollInterval: 500,
    },
  });

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp4', '.webm', '.mov', '.avi'].includes(ext)) return;

    const filename = path.basename(filePath);
    const trackingNumber = path.parse(filename).name; // filename without extension
    const stat = fs.statSync(filePath);

    if (stat.size === 0) return; // skip empty files

    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10);
    const timeStr = date.toTimeString().slice(0, 8);
    const safeFilename = `${trackingNumber}_${Date.now()}${ext}`;

    const destDir = path.join(__dirname, '..', 'uploads', dateStr);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, safeFilename);

    try {
      fs.renameSync(filePath, destPath);

      const relPath = path.join(dateStr, safeFilename);
      db.insertVideo({
        trackingNumber,
        filename: safeFilename,
        filePath: relPath,
        fileSize: stat.size,
        duration: 0,
        recordDate: dateStr,
        recordTime: timeStr,
        uploadMethod: 'usb',
      });

      console.log('[Watcher] Imported:', trackingNumber, `(${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      console.error('[Watcher] Import error:', err.message);
    }
  });

  watcher.on('error', (err) => {
    console.error('[Watcher] Error:', err.message);
  });
}

module.exports = { startWatcher };
