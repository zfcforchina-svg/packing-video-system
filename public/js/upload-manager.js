/**
 * Upload Manager — handles chunked upload via Socket.IO with resume support.
 * Works both from phone (camera.js) and dashboard (for HTTP fallback).
 */

const CHUNK_SIZE = 256 * 1024; // 256KB chunks

class UploadManager {
  constructor(socket) {
    this.socket = socket;
    this.activeUploads = new Map();
  }

  /**
   * Upload a video Blob with tracking metadata.
   * @param {Blob} blob - The recorded video
   * @param {object} meta - { trackingNumber, duration }
   * @param {function} onProgress - (percent, received, total)
   * @returns {Promise<{success: boolean, id?: number, error?: string}>}
   */
  async upload(blob, meta, onProgress) {
    const fileId = `${meta.trackingNumber}_${Date.now()}`;
    const totalSize = blob.size;

    return new Promise((resolve, reject) => {
      const session = { fileId, meta, blob, totalSize, onProgress, resolve, reject, cancelled: false };
      this.activeUploads.set(fileId, session);

      this._sendStart(fileId, meta, totalSize)
        .then((resumeIndex) => this._sendChunks(fileId, resumeIndex))
        .then(() => this._sendComplete(fileId))
        .then(resolve)
        .catch((err) => {
          if (!session.cancelled) reject(err);
        })
        .finally(() => {
          this.activeUploads.delete(fileId);
        });
    });
  }

  cancel(fileId) {
    const session = this.activeUploads.get(fileId);
    if (session) {
      session.cancelled = true;
      this.socket.emit('upload:cancel', { fileId });
    }
  }

  // --- Private ---

  _sendStart(fileId, meta, totalSize) {
    return new Promise((resolve, reject) => {
      this.socket.emit('upload:start', {
        fileId,
        trackingNumber: meta.trackingNumber,
        totalSize,
        duration: meta.duration || 0,
      }, (response) => {
        if (response?.ok) {
          // Check for resume
          this.socket.emit('upload:resume', { fileId }, (res) => {
            resolve(res?.lastIndex ?? -1);
          });
        } else {
          reject(new Error(response?.error || 'Failed to start upload'));
        }
      });
    });
  }

  async _sendChunks(fileId, resumeIndex) {
    const session = this.activeUploads.get(fileId);
    if (!session) throw new Error('Session lost');

    const { blob, totalSize, onProgress } = session;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const startChunk = resumeIndex + 1;

    for (let i = startChunk; i < totalChunks; i++) {
      if (session.cancelled) throw new Error('Cancelled');

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunk = blob.slice(start, end);

      await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          this.socket.emit('upload:chunk', {
            fileId,
            index: i,
            data: reader.result, // ArrayBuffer
          }, (ack) => {
            if (ack?.ok) {
              const pct = Math.round(((i + 1) / totalChunks) * 100);
              if (onProgress) onProgress(pct, (i + 1) * CHUNK_SIZE, totalSize);
              resolve();
            } else {
              reject(new Error(ack?.error || 'Chunk failed'));
            }
          });
        };
        reader.onerror = () => reject(new Error('Failed to read chunk'));
        reader.readAsArrayBuffer(chunk);
      });
    }
  }

  _sendComplete(fileId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('upload:complete', { fileId }, (response) => {
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || 'Upload failed'));
      });
    });
  }
}
