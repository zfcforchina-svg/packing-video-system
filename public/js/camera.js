/**
 * camera.js — 极简打包录像
 * 流程: 后置摄像头扫码 → 点开始录 → 点停止 → 存为单号.webm → 上传 → 下一单
 */
(function () {
  const $ = (s) => document.querySelector(s);

  // ---- DOM ----
  const statusEl = $('#status');
  const hintEl = $('#hint');
  const foundEl = $('#found');
  const recordingEl = $('#recording');
  const timerEl = $('#timer');
  const msgEl = $('#msg');
  const btnSwitch = $('#btnSwitch');
  const btnRec = $('#btnRec');
  const btnStop = $('#btnStop');
  const btnNext = $('#btnNext');

  // ---- STATE ----
  let tracking = '';          // current tracking number
  let scanner = null;         // Html5Qrcode
  let cameraId = null;        // selected camera device ID
  let recorder = null;        // MediaRecorder
  let stream = null;          // recording MediaStream
  let blob = null;            // recorded video blob
  let chunks = [];
  let startTime = 0;
  let timerInt = 0;
  let socket = null;
  let connected = false;
  let scanning = false;

  // ---- INIT ----
  function init() {
    socket = io({ reconnection: true });
    socket.on('connect', () => { connected = true; statusEl.textContent = '🟢 已连接'; });
    socket.on('disconnect', () => { connected = false; statusEl.textContent = '🔴 未连接'; });

    btnSwitch.onclick = switchCamera;
    btnRec.onclick = startRecord;
    btnStop.onclick = stopRecord;
    btnNext.onclick = resetAll;

    // Always start with back camera (facingMode: 'environment')
    startScanner();
  }

  // ---- SWITCH CAMERA ----
  async function switchCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      if (videos.length < 2) { showMsg('只有一个摄像头'); return; }
      // Toggle between available cameras
      const idx = cameraId ? videos.findIndex(v => v.deviceId === cameraId) : 0;
      const next = videos[(idx + 1) % videos.length];
      cameraId = next.deviceId;
      await restartScanner();
      showMsg('已切换: ' + (next.label || '摄像头'));
    } catch (e) {
      showMsg('切换失败，请重试');
    }
  }

  // ---- SCANNER ----
  function startScanner() {
    const el = document.getElementById('scanner');
    el.innerHTML = '';
    scanner = new Html5Qrcode('scanner');

    // Always prefer back camera
    const cameraConfig = cameraId
      ? { deviceId: { exact: cameraId } }
      : { facingMode: 'environment' };

    scanner.start(
      cameraConfig,
      {
        fps: 10,
        qrbox: { width: 320, height: 80 },
        disableFlip: true,
        aspectRatio: 1.7,
        videoConstraints: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      onScan,
      () => {} // silent
    ).then(() => {
      scanning = true;
      hintEl.textContent = '将快递单号条码对准框内';
      statusEl.textContent = '🔍 扫码中';
    }).catch(err => {
      statusEl.textContent = '❌ 失败';
      hintEl.textContent = '摄像头错误: ' + (err.message || err).substring(0, 50);
      console.error('Scanner:', err);
    });
  }

  async function stopScanner() {
    if (scanner && scanning) {
      try { await scanner.stop(); } catch (e) {}
      scanning = false;
    }
  }

  async function restartScanner() {
    await stopScanner();
    startScanner();
  }

  function onScan(text) {
    if (!text || text.length < 4) return;
    // Debounce 2s
    const now = Date.now();
    if (onScan._t && now - onScan._t < 2000) return;
    onScan._t = now;

    tracking = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    foundEl.textContent = '✅ ' + tracking;
    foundEl.style.display = 'block';
    hintEl.textContent = '单号已识别，点开始录制';
    btnRec.disabled = false;
    if (navigator.vibrate) navigator.vibrate(200);

    setTimeout(() => { foundEl.style.display = 'none'; }, 2000);
  }

  // ---- RECORD ----
  async function startRecord() {
    if (!tracking) return;
    if (recorder?.state === 'recording') return;

    // Stop scanner
    await stopScanner();
    document.getElementById('scanner').innerHTML = '';

    // Get camera for recording — use same back camera
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: cameraId
          ? { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (e) {
      // Fallback without exact device
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    }

    // Show recording UI
    recordingEl.style.display = 'block';
    hintEl.textContent = '录制中 — ' + tracking;
    btnRec.classList.add('hid');
    btnStop.classList.remove('hid');
    btnSwitch.classList.add('hid');

    // Start MediaRecorder
    chunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(timerInt);
      recordingEl.style.display = 'none';
      stream.getTracks().forEach(t => t.stop());
      stream = null;

      blob = new Blob(chunks, { type: mime });
      btnStop.classList.add('hid');
      onRecordDone();
    };
    recorder.start(1000);
    startTime = Date.now();
    timerInt = setInterval(updateTimer, 500);
    updateTimer();
  }

  function stopRecord() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- AFTER RECORD ----
  function onRecordDone() {
    const dur = Math.round((Date.now() - startTime) / 1000);
    hintEl.textContent = `录制完成: ${tracking} (${dur}s) — 上传中...`;

    // Save to phone + upload
    saveToPhone();
    uploadToServer();
  }

  // ---- SAVE TO PHONE (fallback) ----
  function saveToPhone() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tracking + '.webm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- UPLOAD ----
  async function uploadToServer() {
    if (!blob || !tracking) return;
    if (!connected) {
      hintEl.textContent = '⚠️ 未连接电脑，视频已保存到手机。连上WiFi后重试。';
      showNextBtn();
      return;
    }

    const fileId = tracking + '_' + Date.now();
    const totalSize = blob.size;
    const chunkSize = 256 * 1024;
    const totalChunks = Math.ceil(totalSize / chunkSize);

    try {
      await wsEmit('upload:start', {
        fileId, trackingNumber: tracking, totalSize,
        duration: Math.round((Date.now() - startTime) / 1000),
      });

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const chunk = blob.slice(start, end);
        const buf = await chunk.arrayBuffer();
        await wsEmit('upload:chunk', { fileId, index: i, data: buf });
        hintEl.textContent = `上传中 ${Math.round((i + 1) / totalChunks * 100)}% — ${tracking}`;
      }

      await wsEmit('upload:complete', { fileId });
      hintEl.textContent = '✅ 上传完成 — ' + tracking;
    } catch (err) {
      hintEl.textContent = '⚠️ 上传失败，视频已存手机 — ' + tracking;
    }

    showNextBtn();
  }

  function wsEmit(event, data) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 120000);
      socket.emit(event, data, r => { clearTimeout(t); r?.error ? reject(new Error(r.error)) : resolve(r || {}); });
    });
  }

  function showNextBtn() {
    btnNext.classList.remove('hid');
  }

  // ---- NEXT ----
  async function resetAll() {
    tracking = '';
    blob = null;
    recorder = null;
    chunks = [];
    startTime = 0;

    btnNext.classList.add('hid');
    btnRec.classList.remove('hid');
    btnRec.disabled = true;
    btnStop.classList.add('hid');
    btnSwitch.classList.remove('hid');
    foundEl.style.display = 'none';
    recordingEl.style.display = 'none';
    hintEl.textContent = '将快递单号条码对准框内';

    // Restart scanner
    startScanner(cameraId);
  }

  // ---- UTILS ----
  function showMsg(m) {
    msgEl.textContent = m;
    msgEl.classList.remove('hid');
    setTimeout(() => msgEl.classList.add('hid'), 3000);
  }

  // ---- GO ----
  init();
})();
