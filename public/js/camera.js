/**
 * camera.js — Phone recording page logic
 * Flow: Scan barcode → Record video with watermark → Upload to computer
 */
(function () {
  'use strict';

  // ====== DOM REFS ======
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const dom = {
    connectionStatus: $('#connectionStatus'),
    // Step 1: Scan
    stepScan: $('#step-scan'),
    scannerViewfinder: $('#scannerViewfinder'),
    scanHint: $('#scanHint'),
    trackingInput: $('#trackingInput'),
    confirmTrackingBtn: $('#confirmTrackingBtn'),
    // Step 2: Record
    stepRecord: $('#step-record'),
    cameraPreview: $('#cameraPreview'),
    watermarkCanvas: $('#watermarkCanvas'),
    recordOverlay: $('#recordOverlay'),
    recordTimer: $('#recordTimer'),
    recordTracking: $('#recordTracking'),
    startRecordBtn: $('#startRecordBtn'),
    stopRecordBtn: $('#stopRecordBtn'),
    // Step 3: Upload
    stepUpload: $('#step-upload'),
    previewVideo: $('#previewVideo'),
    previewTracking: $('#previewTracking'),
    previewSize: $('#previewSize'),
    uploadProgress: $('#uploadProgress'),
    progressFill: $('#progressFill'),
    progressText: $('#progressText'),
    retakeBtn: $('#retakeBtn'),
    uploadBtn: $('#uploadBtn'),
    uploadDoneBtn: $('#uploadDoneBtn'),
    // Message
    camMessage: $('#camMessage'),
  };

  // ====== STATE ======
  let trackingNumber = '';
  let cameraStream = null;
  let mediaRecorder = null;
  let recordedBlob = null;
  let recordedDuration = 0;
  let recordStartTime = 0;
  let recordTimerInterval = null;
  let animationId = null;
  let isRecording = false;
  let socket = null;
  let uploadManager = null;

  // ====== INIT ======
  function init() {
    connectSocket();
    initScanner();
    bindEvents();
    checkUrlParams();
  }

  function connectSocket() {
    socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

    socket.on('connect', () => {
      dom.connectionStatus.innerHTML = '🟢 已连接';
      dom.connectionStatus.className = 'cam-status connected';
    });

    socket.on('disconnect', () => {
      dom.connectionStatus.innerHTML = '🔴 断开';
      dom.connectionStatus.className = 'cam-status';
    });

    socket.on('connect_error', () => {
      dom.connectionStatus.innerHTML = '🟡 连接中...';
      dom.connectionStatus.className = 'cam-status';
    });

    uploadManager = new UploadManager(socket);
  }

  function bindEvents() {
    // Manual tracking input
    dom.trackingInput.addEventListener('input', () => {
      const val = dom.trackingInput.value.trim();
      dom.confirmTrackingBtn.disabled = val.length < 4;
    });
    dom.trackingInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && dom.trackingInput.value.trim().length >= 4) {
        confirmTracking(dom.trackingInput.value.trim());
      }
    });
    dom.confirmTrackingBtn.addEventListener('click', () => {
      confirmTracking(dom.trackingInput.value.trim());
    });

    // Record
    dom.startRecordBtn.addEventListener('click', startRecording);
    dom.stopRecordBtn.addEventListener('click', stopRecording);

    // Upload
    dom.uploadBtn.addEventListener('click', doUpload);
    dom.retakeBtn.addEventListener('click', retake);
    dom.uploadDoneBtn.addEventListener('click', resetAll);
  }

  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const tracking = params.get('tracking');
    if (tracking) {
      confirmTracking(tracking);
    }
  }

  // ====== BARCODE SCANNER ======
  let html5QrCode = null;

  function initScanner() {
    // Scanner will be started after camera permission
    html5QrCode = new Html5Qrcode('scannerViewfinder');
  }

  async function startScanner() {
    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 300, height: 150 },
          // code_128=5, qr_code=0, ean_13=9 in Html5QrcodeSupportedFormats
          formatsToSupport: [5, 0, 9],
        },
        onScanSuccess,
        () => { /* scan failure — ignore */ }
      );
      dom.scanHint.textContent = '将条码对准扫描框';
    } catch (err) {
      console.warn('Scanner start failed:', err.message);
      dom.scanHint.textContent = '无法启动扫码，请手动输入单号';
    }
  }

  function onScanSuccess(decodedText) {
    if (!decodedText || decodedText.length < 4) return;

    // Stop scanner
    if (html5QrCode && html5QrCode.isScanning) {
      html5QrCode.stop().catch(() => {});
    }

    // Vibrate feedback
    if (navigator.vibrate) navigator.vibrate(200);

    confirmTracking(decodedText.trim());
  }

  // ====== TRACKING CONFIRMED ======
  function confirmTracking(tracking) {
    trackingNumber = tracking.replace(/[^a-zA-Z0-9一-鿿_-]/g, '');
    dom.trackingInput.value = trackingNumber;
    dom.recordTracking.textContent = trackingNumber;

    // Transition to step 2
    dom.stepScan.classList.add('hidden');
    dom.stepRecord.classList.remove('hidden');
    dom.startRecordBtn.disabled = false;

    // Start camera preview
    startCamera();
  }

  // ====== CAMERA ======
  async function startCamera() {
    if (cameraStream) return;

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
      });

      dom.cameraPreview.srcObject = cameraStream;
      await dom.cameraPreview.play();

      // Set canvas size to match video
      dom.cameraPreview.addEventListener('loadedmetadata', () => {
        dom.watermarkCanvas.width = dom.cameraPreview.videoWidth || 1280;
        dom.watermarkCanvas.height = dom.cameraPreview.videoHeight || 720;
      });
    } catch (err) {
      showMessage('无法访问摄像头: ' + err.message, 'error');
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
  }

  // ====== RECORDING ======
  function startRecording() {
    if (!cameraStream || isRecording) return;

    // Hide the camera preview switch
    dom.startRecordBtn.classList.add('hidden');
    dom.stopRecordBtn.classList.remove('hidden');

    // Set up canvas for watermark overlay
    const canvas = dom.watermarkCanvas;
    const ctx = canvas.getContext('2d');
    const video = dom.cameraPreview;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    isRecording = true;
    recordStartTime = Date.now();

    // Draw loop: composite video + watermark onto canvas
    function drawFrame() {
      if (!isRecording) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Watermark bar at bottom
      const barH = Math.round(canvas.height * 0.1);
      const barY = canvas.height - barH;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, barY, canvas.width, barH);

      // Tracking number (right side)
      ctx.font = `bold ${Math.round(canvas.width * 0.025)}px "Courier New", monospace`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(`单号: ${trackingNumber}`, canvas.width - 24, barY + barH * 0.55);

      // Timestamp (left side)
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      ctx.textAlign = 'left';
      ctx.fillText(`${mins}:${secs}`, 24, barY + barH * 0.55);

      animationId = requestAnimationFrame(drawFrame);
    }

    // Start recording from canvas stream
    const canvasStream = canvas.captureStream(30);
    // Merge original audio track
    const audioTrack = cameraStream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    const mimeType = getSupportedMimeType();
    const chunks = [];

    mediaRecorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2500000 });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      isRecording = false;
      if (animationId) cancelAnimationFrame(animationId);
      clearInterval(recordTimerInterval);
      dom.recordOverlay.classList.add('hidden');

      recordedBlob = new Blob(chunks, { type: mimeType });
      recordedDuration = (Date.now() - recordStartTime) / 1000;

      // Show preview
      showPreview();
    };

    mediaRecorder.start(1000); // 1-second chunks
    drawFrame();

    // Show recording overlay
    dom.recordOverlay.classList.remove('hidden');
    updateRecordTimer();

    recordTimerInterval = setInterval(updateRecordTimer, 200);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    dom.stopRecordBtn.classList.add('hidden');
  }

  function updateRecordTimer() {
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    dom.recordTimer.textContent = `${mins}:${secs}`;
  }

  function getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  // ====== PREVIEW & UPLOAD ======
  function showPreview() {
    dom.stepRecord.classList.add('hidden');
    dom.stepUpload.classList.remove('hidden');

    const url = URL.createObjectURL(recordedBlob);
    dom.previewVideo.src = url;
    dom.previewTracking.textContent = `单号: ${trackingNumber}`;
    dom.previewSize.textContent = `大小: ${formatSize(recordedBlob.size)} | 时长: ${Math.round(recordedDuration)}s`;

    dom.uploadBtn.classList.remove('hidden');
    dom.uploadDoneBtn.classList.add('hidden');
    dom.uploadProgress.classList.add('hidden');
  }

  async function doUpload() {
    if (!recordedBlob || !socket?.connected) {
      showMessage('未连接到服务器，请检查WiFi。录制的视频已保存到手机相册。', 'error');
      saveToDevice();
      return;
    }

    dom.uploadBtn.classList.add('hidden');
    dom.retakeBtn.classList.add('hidden');
    dom.uploadProgress.classList.remove('hidden');

    try {
      const result = await uploadManager.upload(recordedBlob, {
        trackingNumber,
        duration: recordedDuration,
      }, (pct, received, total) => {
        dom.progressFill.style.width = pct + '%';
        dom.progressText.textContent =
          `上传中 ${pct}% (${formatSize(received)} / ${formatSize(total)})`;
      });

      if (result.success) {
        dom.progressText.textContent = '上传完成!';
        dom.uploadDoneBtn.classList.remove('hidden');
        showMessage('上传成功!', 'success');
      }
    } catch (err) {
      dom.progressText.textContent = '上传失败: ' + err.message;
      dom.retakeBtn.classList.remove('hidden');
      showMessage('上传失败，请重试。视频已保存到手机。', 'error');
      saveToDevice();
    }
  }

  function retake() {
    // Clean up preview
    if (dom.previewVideo.src) URL.revokeObjectURL(dom.previewVideo.src);
    recordedBlob = null;

    dom.stepUpload.classList.add('hidden');
    dom.stepRecord.classList.remove('hidden');
    dom.startRecordBtn.classList.remove('hidden');
    dom.stopRecordBtn.classList.add('hidden');
    dom.startRecordBtn.disabled = false;
  }

  function resetAll() {
    if (dom.previewVideo.src) URL.revokeObjectURL(dom.previewVideo.src);
    recordedBlob = null;
    trackingNumber = '';
    dom.trackingInput.value = '';

    dom.stepUpload.classList.add('hidden');
    dom.stepScan.classList.remove('hidden');
    dom.startRecordBtn.classList.add('hidden');
    dom.stopRecordBtn.classList.add('hidden');
    dom.confirmTrackingBtn.disabled = true;

    stopCamera();

    // Restart scanner
    if (html5QrCode && !html5QrCode.isScanning) {
      startScanner().catch(() => {});
    }
  }

  // ====== USB FALLBACK ======
  function saveToDevice() {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = date.toTimeString().slice(0, 8).replace(/:/g, '');
    a.download = `${trackingNumber}_${dateStr}_${timeStr}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('视频已保存到下载目录，请通过数据线拷贝到电脑 usb-import 文件夹', 'info');
  }

  // ====== HELPERS ======
  function showMessage(msg, type) {
    dom.camMessage.textContent = msg;
    dom.camMessage.className = `cam-message cam-message-${type}`;
    dom.camMessage.classList.remove('hidden');
    setTimeout(() => dom.camMessage.classList.add('hidden'), 5000);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1048576).toFixed(1) + 'MB';
  }

  // ====== STARTUP ======
  init();
  // Start scanner right away
  startScanner().catch(() => {
    dom.scanHint.textContent = '扫码启动失败，请手动输入单号';
  });
})();
