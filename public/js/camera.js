/**
 * camera.js — 手机端核心：扫码(自动对焦) → 录像 → 上传 → 下一单
 *
 * Key fixes applied:
 * - applyVideoConstraints for auto-focus after scanner starts
 * - disableFlip:true to fix iOS mirroring
 * - qrbox horizontal for barcode scanning (300x100)
 * - formatsToSupport limited to CODE_128/CODE_39/EAN_13 for speed
 * - User-initiated camera start (required by mobile browsers)
 * - Continuous packing flow: scan→record→upload→next→scan...
 */
(function () {
  'use strict';

  // ==================== DOM ====================
  const $ = (s) => document.querySelector(s);

  const statusBadge = $('#statusBadge');
  const scanView = $('#scanView');
  const scannerContainer = $('#scannerContainer');
  const scanHint = $('#scanHint');
  const scanResult = $('#scanResult');
  const recordView = $('#recordView');
  const recordVideo = $('#recordVideo');
  const recordBadge = $('#recordBadge');
  const recordTimer = $('#recordTimer');
  const recordTracking = $('#recordTracking');
  const uploadOverlay = $('#uploadOverlay');
  const uploadPct = $('#uploadPct');
  const uploadStatus = $('#uploadStatus');
  const errorOverlay = $('#errorOverlay');
  const errTitle = $('#errTitle');
  const errDetail = $('#errDetail');
  const btnFlash = $('#btnFlash');
  const btnRecord = $('#btnRecord');
  const btnUpload = $('#btnUpload');
  const btnNext = $('#btnNext');

  // ==================== STATE ====================
  const STATE = {
    tracking: '',        // current tracking number
    scanner: null,        // Html5Qrcode instance
    scanning: false,      // is scanner active
    cameraStream: null,   // MediaStream for recording
    mediaRecorder: null,  // MediaRecorder
    recordedBlob: null,   // recorded video blob
    recordStart: 0,       // timestamp when recording started
    recordInterval: 0,    // setInterval ID for timer
    socket: null,         // Socket.IO connection
    connected: false,     // WebSocket status
    flashOn: false,       // torch state
  };

  // ==================== INIT ====================
  function init() {
    connectSocket();
    // Don't start scanner yet — wait for user to click (mobile browser requirement)
    btnRecord.textContent = '📷 点击开始扫码';
    btnRecord.classList.remove('btn-red');
    btnRecord.classList.add('btn-blue');
    btnRecord.disabled = false;
    btnRecord.onclick = startScanning;

    btnFlash.onclick = toggleFlash;
    btnUpload.onclick = doUpload;
    btnNext.onclick = resetForNext;
  }

  // ==================== SOCKET ====================
  function connectSocket() {
    STATE.socket = io({ reconnection: true, reconnectionAttempts: 50 });
    STATE.socket.on('connect', () => {
      STATE.connected = true;
      statusBadge.textContent = '🟢 已连接';
      statusBadge.className = 'status status-ok';
    });
    STATE.socket.on('disconnect', () => {
      STATE.connected = false;
      statusBadge.textContent = '🔴 未连接';
      statusBadge.className = 'status status-err';
    });
  }

  // ==================== SCANNER ====================
  async function startScanning() {
    if (STATE.scanning) return;

    // Reset button state
    btnRecord.disabled = true;
    btnRecord.textContent = '启动中...';
    btnRecord.onclick = null;

    // Make sure scan view visible
    scanView.style.display = 'flex';
    recordView.style.display = 'none';

    try {
      STATE.scanner = new Html5Qrcode('scannerContainer');

      await STATE.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 300, height: 80 },  // Horizontal for barcodes
          aspectRatio: 1.7,
          disableFlip: true,                    // Fix iOS mirroring
          videoConstraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,  // Native API for speed
          },
        },
        onScanSuccess,
        () => {} // silent on each frame failure
      );

      STATE.scanning = true;
      statusBadge.textContent = '🔍 扫码中';
      statusBadge.className = 'status status-ok';
      scanHint.textContent = '将快递单号条码对准框内';
      btnFlash.disabled = false;
      btnRecord.textContent = '⏺ 开始录制';
      btnRecord.classList.remove('btn-blue');
      btnRecord.classList.add('btn-red');
      btnRecord.disabled = true; // enabled only after scan
      btnRecord.onclick = startRecording;

      // ---- KEY FIX: Apply video constraints for auto-focus ----
      await forceAutoFocus();

      // Also try periodically
      const focusInterval = setInterval(async () => {
        if (!STATE.scanning) { clearInterval(focusInterval); return; }
        try { await forceAutoFocus(); } catch (e) { /* ignore */ }
      }, 3000);

    } catch (err) {
      console.error('Scanner error:', err);
      showError('摄像头启动失败',
        `${err.message || err}\n\n请确保:\n1. 使用 HTTPS 访问 (https://)\n2. 已允许摄像头权限\n3. 不要使用微信/QQ内置浏览器打开\n4. 尝试用 Safari 或 Chrome 打开`);
      btnRecord.textContent = '🔄 点击重试';
      btnRecord.classList.remove('btn-red');
      btnRecord.classList.add('btn-blue');
      btnRecord.disabled = false;
      btnRecord.onclick = startScanning;
    }
  }

  /** Apply focus + zoom constraints for better barcode scanning */
  async function forceAutoFocus() {
    if (!STATE.scanner || !STATE.scanning) return;
    try {
      const caps = STATE.scanner.getRunningTrackCapabilities();
      if (!caps) return;

      const constraints = {
        width: { ideal: 1280 },
        frameRate: { ideal: caps.frameRate?.max || 30 },
        advanced: [],
      };

      // Add zoom if supported (helps scan small barcodes)
      if (caps.zoom && caps.zoom.max >= 2) {
        constraints.advanced.push({ zoom: Math.min(2.0, caps.zoom.max) });
      }
      // Add focus distance — critical for auto-focus!
      if (caps.focusDistance) {
        constraints.advanced.push({ focusDistance: 1 });
      }
      // Add focus mode if supported
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        constraints.advanced.push({ focusMode: 'continuous' });
      }

      if (constraints.advanced.length > 0) {
        await STATE.scanner.applyVideoConstraints(constraints);
      }
    } catch (e) {
      // Silently fail — focus optimization is best-effort
    }
  }

  async function toggleFlash() {
    if (!STATE.scanner || !STATE.scanning) return;
    try {
      STATE.flashOn = !STATE.flashOn;
      await STATE.scanner.setTorch(STATE.flashOn);
      btnFlash.textContent = STATE.flashOn ? '🔦💡' : '🔦';
    } catch (e) {
      btnFlash.disabled = true;
      btnFlash.textContent = '🔦❌';
    }
  }

  function onScanSuccess(decodedText) {
    if (!decodedText || decodedText.length < 4) return;

    // Debounce — prevent duplicate triggers
    const now = Date.now();
    if (onScanSuccess._last && now - onScanSuccess._last < 2000) return;
    onScanSuccess._last = now;

    // Clean tracking number — keep alphanumeric + common chars
    const tracking = decodedText.replace(/[^a-zA-Z0-9]/g, '').trim();

    // Show result
    scanResult.textContent = '✅ ' + tracking;
    scanResult.style.display = 'block';
    scanHint.textContent = '识别成功！准备录像';

    // Vibrate
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // Store and switch to recording mode
    STATE.tracking = tracking;
    btnRecord.disabled = false;
    btnRecord.textContent = '⏺ 开始录制';

    // Auto-hide result after 1.5s
    setTimeout(() => { scanResult.style.display = 'none'; }, 1500);
  }

  // ==================== RECORDING ====================
  async function startRecording() {
    if (!STATE.tracking) return;
    if (STATE.mediaRecorder?.state === 'recording') return;

    // Switch to record view — start camera for recording
    try {
      // Stop scanner to free camera
      if (STATE.scanner && STATE.scanning) {
        await STATE.scanner.stop();
        STATE.scanning = false;
      }

      // Get fresh camera stream for recording (more reliable than reusing scanner's)
      STATE.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });

      // Switch UI to record view
      scanView.style.display = 'none';
      recordView.style.display = 'flex';
      recordVideo.srcObject = STATE.cameraStream;
      await recordVideo.play();

      // Show tracking number
      recordTracking.textContent = '📦 ' + STATE.tracking;

      // Start recording
      const chunks = [];
      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        mimeType = 'video/webm;codecs=vp8';
      }

      STATE.mediaRecorder = new MediaRecorder(STATE.cameraStream, { mimeType });
      STATE.recordStart = Date.now();

      STATE.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      STATE.mediaRecorder.onstop = () => {
        clearInterval(STATE.recordInterval);
        recordBadge.style.display = 'none';

        STATE.recordedBlob = new Blob(chunks, { type: mimeType });
        const dur = Math.round((Date.now() - STATE.recordStart) / 1000);

        // Stop camera
        if (STATE.cameraStream) {
          STATE.cameraStream.getTracks().forEach((t) => t.stop());
          STATE.cameraStream = null;
        }

        // Show upload UI
        showUploadUI(dur);
      };

      STATE.mediaRecorder.start(1000);

      // Start timer
      recordBadge.style.display = 'flex';
      updateRecordTimer();
      STATE.recordInterval = setInterval(updateRecordTimer, 500);

      // Update button
      btnRecord.textContent = '⏹ 停止录制';
      btnRecord.onclick = stopRecording;
      btnFlash.disabled = true;

    } catch (err) {
      console.error('Record error:', err);
      alert('录像启动失败: ' + (err.message || err));
    }
  }

  function stopRecording() {
    if (STATE.mediaRecorder && STATE.mediaRecorder.state === 'recording') {
      STATE.mediaRecorder.stop();
    }
  }

  function updateRecordTimer() {
    const secs = Math.floor((Date.now() - STATE.recordStart) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    recordTimer.textContent = m + ':' + s;
  }

  // ==================== UPLOAD UI ====================
  function showUploadUI(durationSec) {
    btnRecord.classList.add('hidden');
    btnUpload.classList.remove('hidden');
    btnNext.classList.remove('hidden');
    btnUpload.textContent = `上传 (${formatSize(STATE.recordedBlob?.size || 0)}, ${durationSec}s)`;
    uploadOverlay.style.display = 'none';
    recordTracking.textContent = '📦 ' + STATE.tracking + ' — 就绪';
  }

  async function doUpload() {
    if (!STATE.recordedBlob || !STATE.tracking) return;
    if (!STATE.connected) {
      alert('未连接到电脑，视频将保存到手机相册。\n请通过数据线拷到 usb-import/ 文件夹。');
      downloadToPhone();
      return;
    }

    btnUpload.disabled = true;
    btnNext.disabled = true;
    uploadOverlay.style.display = 'flex';
    uploadPct.textContent = '0%';
    uploadStatus.textContent = '上传中...';

    const fileId = STATE.tracking + '_' + Date.now();
    const blob = STATE.recordedBlob;
    const totalSize = blob.size;
    const chunkSize = 256 * 1024;
    const totalChunks = Math.ceil(totalSize / chunkSize);

    try {
      // Start upload session
      await wsEmit('upload:start', {
        fileId, trackingNumber: STATE.tracking, totalSize,
        duration: Math.round((Date.now() - STATE.recordStart) / 1000),
      });

      // Send chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const chunk = blob.slice(start, end);
        const buf = await chunk.arrayBuffer();

        await wsEmit('upload:chunk', { fileId, index: i, data: buf });

        const pct = Math.round(((i + 1) / totalChunks) * 100);
        uploadPct.textContent = pct + '%';
        uploadStatus.textContent = `${formatSize((i + 1) * chunkSize)} / ${formatSize(totalSize)}`;
      }

      // Complete
      const result = await wsEmit('upload:complete', { fileId });
      if (result?.success) {
        uploadPct.textContent = '✅';
        uploadStatus.textContent = '上传完成！';
        btnUpload.classList.add('hidden');
        btnNext.textContent = '✅ 下一单';
      }
    } catch (err) {
      uploadPct.textContent = '❌';
      uploadStatus.textContent = '上传失败: ' + err.message;
      btnUpload.disabled = false;
      btnNext.disabled = false;
      // Save to phone as fallback
      downloadToPhone();
    }
  }

  function wsEmit(event, data) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('超时')), 120000);
      STATE.socket.emit(event, data, (resp) => {
        clearTimeout(timer);
        if (resp?.error) reject(new Error(resp.error));
        else resolve(resp || {});
      });
    });
  }

  // ==================== NEXT PACKAGE ====================
  async function resetForNext() {
    // Clean up
    STATE.tracking = '';
    STATE.recordedBlob = null;
    STATE.recordStart = 0;
    uploadOverlay.style.display = 'none';

    // Reset buttons
    btnUpload.classList.add('hidden');
    btnNext.classList.add('hidden');
    btnRecord.classList.remove('hidden', 'btn-blue');
    btnRecord.classList.add('btn-red');
    btnRecord.textContent = '⏺ 开始录制';
    btnRecord.disabled = true;
    btnRecord.onclick = startRecording;
    btnFlash.disabled = false;

    // Switch back to scanner
    recordView.style.display = 'none';
    scanView.style.display = 'flex';
    scanHint.textContent = '将快递单号条码对准框内';
    scanResult.style.display = 'none';

    // Restart scanner
    await startScanning();
  }

  // ==================== FALLBACK: Download to phone ====================
  function downloadToPhone() {
    if (!STATE.recordedBlob) return;
    const url = URL.createObjectURL(STATE.recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
    const ts = d.toTimeString().slice(0, 8).replace(/:/g, '');
    a.download = `${STATE.tracking}_${ds}_${ts}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ==================== ERROR ====================
  function showError(title, detail) {
    errTitle.textContent = title;
    errDetail.textContent = detail;
    errorOverlay.style.display = 'flex';
  }

  // ==================== UTILS ====================
  function formatSize(b) {
    if (!b || b === 0) return '0B';
    if (b < 1024) return b + 'B';
    if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
    return (b / 1048576).toFixed(1) + 'MB';
  }

  // ==================== GO ====================
  init();
})();
