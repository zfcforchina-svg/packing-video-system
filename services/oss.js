const OSS = require('ali-oss');
const path = require('path');
const fs = require('fs');

let client = null;
let ossConfig = null;

/**
 * Initialize OSS client from config.
 * Call this once on startup and whenever config changes.
 */
function init(cfg) {
  ossConfig = cfg.oss || {};
  if (!ossConfig.enabled || !ossConfig.accessKeyId) {
    console.log('[OSS] Not configured — cloud storage disabled');
    client = null;
    return;
  }
  try {
    client = new OSS({
      region: ossConfig.region || 'oss-cn-hangzhou',
      bucket: ossConfig.bucket,
      accessKeyId: ossConfig.accessKeyId,
      accessKeySecret: ossConfig.accessKeySecret,
      ...(ossConfig.endpoint ? { endpoint: ossConfig.endpoint } : {}),
    });
    console.log('[OSS] Initialized — bucket:', ossConfig.bucket);
  } catch (e) {
    console.error('[OSS] Init failed:', e.message);
    client = null;
  }
}

/**
 * Upload a local file to OSS.
 * @param {string} localPath - absolute path to the video file
 * @param {string} ossKey - object key in OSS (e.g., "2026-07-26/SF123.mp4")
 * @returns {Promise<string|null>} OSS URL or null if disabled/failed
 */
async function upload(localPath, ossKey) {
  if (!client || !ossConfig.enabled) return null;
  try {
    const result = await client.put(ossKey.replace(/\\/g, '/'), localPath);
    // Return the OSS URL
    if (ossConfig.endpoint) {
      return `${ossConfig.endpoint}/${ossKey}`;
    }
    return result.url;
  } catch (e) {
    console.error('[OSS] Upload failed:', e.message);
    return null;
  }
}

/**
 * Get a signed URL for temporary access (expires in 1 hour).
 * Useful for sharing links without making bucket public.
 */
async function getSignedUrl(ossKey, expiresSec = 3600) {
  if (!client || !ossConfig.enabled) return null;
  try {
    return await client.signatureUrl(ossKey.replace(/\\/g, '/'), { expires: expiresSec });
  } catch (e) {
    return null;
  }
}

/**
 * Delete a file from OSS.
 */
async function remove(ossKey) {
  if (!client || !ossConfig.enabled) return false;
  try {
    await client.delete(ossKey.replace(/\\/g, '/'));
    return true;
  } catch (e) {
    return false;
  }
}

function isEnabled() {
  return !!(client && ossConfig && ossConfig.enabled);
}

module.exports = { init, upload, getSignedUrl, remove, isEnabled };
