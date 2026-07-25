const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Burn tracking number + timestamp watermark into a video using FFmpeg.
 *
 * @param {object} video — DB video record
 * @param {string} uploadsDir — absolute path to uploads directory
 * @param {object} config — { watermarkFontSize, ... }
 * @returns {Promise<{filePath: string, fileSize: number}>}
 */
function addWatermark(video, uploadsDir, config = {}) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(uploadsDir, video.file_path);
    if (!fs.existsSync(inputPath)) {
      return reject(new Error('源视频文件不存在: ' + inputPath));
    }

    // Output: same dir, _wm suffix
    const parsed = path.parse(video.file_path);
    const outputRelPath = path.join(path.dirname(video.file_path), parsed.name + '_wm' + parsed.ext);
    const outputPath = path.join(uploadsDir, outputRelPath);

    const fontSize = config.watermarkFontSize || 28;
    const trackingText = video.tracking_number.replace(/[:'"]/g, '');

    // FFmpeg drawtext filter: tracking number (top-right) + timestamp (bottom-left)
    // Using simple approach: just burn tracking number at bottom-right
    const vfFilter = [
      `drawtext=text='${trackingText}':fontsize=${fontSize}:fontcolor=white@0.7:` +
        `x=w-tw-24:y=h-th-24:box=1:boxcolor=black@0.4:boxborderw=6`,
      `drawtext=text='${video.record_date} ${video.record_time}':fontsize=${fontSize - 6}:` +
        `fontcolor=white@0.7:x=24:y=h-th-24:box=1:boxcolor=black@0.4:boxborderw=6`,
    ].join(',');

    const args = [
      '-i', inputPath,
      '-vf', vfFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-y', // overwrite
      outputPath,
    ];

    console.log('[Watermark] Processing:', video.tracking_number);

    execFile('ffmpeg', args, { timeout: 300000 }, (err) => {
      if (err) {
        console.error('[Watermark] FFmpeg error:', err.message);
        return reject(err);
      }

      const stat = fs.statSync(outputPath);

      // Delete original and rename watermarked file to take its place
      fs.unlinkSync(inputPath);
      fs.renameSync(outputPath, inputPath);

      resolve({
        filePath: video.file_path, // same path (replaced)
        fileSize: stat.size,
      });
    });
  });
}

module.exports = { addWatermark };
