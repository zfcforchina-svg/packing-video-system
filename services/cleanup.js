const path = require('path');
const fs = require('fs');

/**
 * Periodically clean up videos older than retentionDays.
 * Runs once on startup, then every 6 hours.
 */
function startCleanup(db, config) {
  const retentionDays = config.retentionDays || 90;

  function run() {
    console.log('[Cleanup] Checking for videos older than', retentionDays, 'days...');
    const expired = db.getExpiredVideos(retentionDays);

    if (expired.length === 0) {
      console.log('[Cleanup] Nothing to clean');
      return;
    }

    let deletedCount = 0;
    let freedBytes = 0;

    for (const video of expired) {
      const fullPath = path.join(__dirname, '..', 'uploads', video.file_path);
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
        db.deleteVideo(video.id);
        deletedCount++;
        freedBytes += video.file_size || 0;
      } catch (err) {
        console.error('[Cleanup] Failed to delete:', video.file_path, err.message);
      }
    }

    console.log(`[Cleanup] Deleted ${deletedCount} videos, freed ${(freedBytes / 1024 / 1024).toFixed(1)}MB`);
  }

  // Run immediately
  run();

  // Then every 6 hours
  setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { startCleanup };
