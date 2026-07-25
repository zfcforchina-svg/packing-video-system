const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

let client = null;
let ossConfig = null;
let bucket = null;
let publicEndpoint = null;

/**
 * Initialize S3-compatible client (Cloudflare R2 / Aliyun OSS / Backblaze B2).
 * R2 is recommended: 10GB free, no egress fees.
 */
function init(cfg) {
  ossConfig = cfg.oss || {};
  if (!ossConfig.enabled || !ossConfig.accessKeyId) {
    console.log('[Cloud] Not configured — cloud storage disabled');
    client = null;
    return;
  }
  try {
    client = new S3Client({
      region: ossConfig.region || 'auto',
      endpoint: ossConfig.endpoint || `https://${ossConfig.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ossConfig.accessKeyId,
        secretAccessKey: ossConfig.accessKeySecret,
      },
      forcePathStyle: true,
    });
    bucket = ossConfig.bucket;
    publicEndpoint = ossConfig.publicEndpoint || null; // e.g., https://cdn.yourdomain.com
    console.log('[Cloud] Initialized — bucket:', bucket);
  } catch (e) {
    console.error('[Cloud] Init failed:', e.message);
    client = null;
  }
}

/**
 * Upload a local file to cloud storage.
 * @returns {Promise<string|null>} public URL or null
 */
async function upload(localPath, ossKey) {
  if (!client || !bucket) return null;
  try {
    const body = fs.createReadStream(localPath);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: ossKey.replace(/\\/g, '/'),
      Body: body,
    }));
    if (publicEndpoint) {
      return `${publicEndpoint}/${ossKey.replace(/\\/g, '/')}`;
    }
    // Construct R2/OSS URL
    const endpoint = ossConfig.endpoint || `https://${ossConfig.accountId}.r2.cloudflarestorage.com`;
    return `${endpoint}/${bucket}/${ossKey.replace(/\\/g, '/')}`;
  } catch (e) {
    console.error('[Cloud] Upload failed:', e.message);
    return null;
  }
}

/**
 * Get a public URL for a cloud-stored video.
 */
function getPublicUrl(ossKey) {
  if (publicEndpoint) return `${publicEndpoint}/${ossKey.replace(/\\/g, '/')}`;
  if (!ossConfig || !ossConfig.endpoint) return null;
  return `${ossConfig.endpoint}/${bucket}/${ossKey.replace(/\\/g, '/')}`;
}

/**
 * Delete a file from cloud storage.
 */
async function remove(ossKey) {
  if (!client || !bucket) return false;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: ossKey.replace(/\\/g, '/') }));
    return true;
  } catch (e) {
    console.error('[Cloud] Delete failed:', e.message);
    return false;
  }
}

function isEnabled() {
  return !!(client && bucket && ossConfig && ossConfig.enabled);
}

module.exports = { init, upload, getPublicUrl, remove, isEnabled };
