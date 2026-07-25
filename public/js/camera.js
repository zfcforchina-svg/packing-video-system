/**
 * 极简打包录像 — 完全控制摄像头
 * 流程: 扫码得单号 → 手动点开始录 → 手动点停止 → 自动存+上传 → 下一单
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const statusEl = $('#status'), hintEl = $('#hint'), foundEl = $('#found');
  const recordingEl = $('#recording'), timerEl = $('#timer'), msgEl = $('#msg');
  const btnSwitch = $('#btnSwitch'), btnRec = $('#btnRec');
  const btnStop = $('#btnStop'), btnNext = $('#btnNext');

  let tracking = '';
  let scanner = null;
  let cameras = [];         // available video devices
  let currentCamIdx = -1;   // index in cameras[]
  let recorder = null, stream = null, blob = null, chunks = [];
  let startTime = 0, timerInt = 0;
  let socket = null, connected = false, scanning = false;

  // ---- INIT ----
  async function init() {
    socket = io({ reconnection: true });
    socket.on('connect', () => { connected = true; statusEl.textContent = '🟢'; });
    socket.on('disconnect', () => { connected = false; statusEl.textContent = '🔴'; });
    btnSwitch.onclick = switchCam;
    btnRec.onclick = startRec;
    btnStop.onclick = stopRec;
    btnNext.onclick = resetAll;

    // Enumerate cameras, pick back one
    await getCameras();
    startScan();
  }

  // ---- FIND CAMERAS ----
  async function getCameras() {
    // Need camera permission first — do a quick open/close
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach(t => t.stop());
    } catch (e) { /* will try anyway */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter(d => d.kind === 'videoinput');
    console.log('Cameras:', cameras.map(c => ({ id: c.deviceId.slice(0,8), label: c.label })));

    // Find back camera: prefer label containing back/environment/后/背面
    // On most phones, the LAST camera is the back one
    for (let i = cameras.length - 1; i >= 0; i--) {
      const label = (cameras[i].label || '').toLowerCase();
      if (label.includes('back') || label.includes('环境') || label.includes('后') ||
          label.includes('背面') || label.includes('背面摄像头')) {
        currentCamIdx = i; break;
      }
    }
    // Fallback: last camera
    if (currentCamIdx < 0 && cameras.length > 0) {
      currentCamIdx = cameras.length - 1; // last = back on phones
    }
    console.log('Using camera index:', currentCamIdx, cameras[currentCamIdx]?.label);
  }

  // ---- SWITCH CAMERA ----
  async function switchCam() {
    await getCameras(); // refresh list
    if (cameras.length < 2) { msg('只有一个摄像头'); return; }
    currentCamIdx = (currentCamIdx + 1) % cameras.length;
    msg('切换: ' + (cameras[currentCamIdx]?.label || '摄像头'));
    await stopScan();
    startScan();
  }

  // ---- SCANNER (back camera FORCED) ----
  function startScan() {
    const el = document.getElementById('scanner');
    el.innerHTML = '';
    scanner = new Html5Qrcode('scanner');

    // FORCE back camera via deviceId (most reliable)
    let camConfig;
    if (cameras.length > 0 && currentCamIdx >= 0) {
      // Use exact deviceId — no ambiguity
      camConfig = { deviceId: { exact: cameras[currentCamIdx].deviceId } };
    } else {
      // Fallback: constrain to environment
      camConfig = { facingMode: { exact: 'environment' } };
    }

    console.log('Scanner camera config:', JSON.stringify(camConfig));

    scanner.start(
      camConfig,
      {
        fps: 10,
        qrbox: { width: 320, height: 80 },
        disableFlip: true,
        aspectRatio: 1.7,
      },
      onScan,
      () => {} // each frame fail = silent
    ).then(() => {
      scanning = true;
      hintEl.textContent = '将快递单号条码对准框内';
      statusEl.textContent = '🔍';
    }).catch(async (err) => {
      console.error('Scanner start error:', err);
      // If exact deviceId fails, try environment fallback
      if (camConfig.deviceId) {
        console.log('Retry with facingMode...');
        camConfig = { facingMode: { exact: 'environment' } };
        try {
          scanner = new Html5Qrcode('scanner');
          await scanner.start(camConfig,
            { fps: 10, qrbox: { width: 320, height: 80 }, disableFlip: true, aspectRatio: 1.7 },
            onScan, () => {});
          scanning = true;
          hintEl.textContent = '将快递单号条码对准框内（备选模式）';
          statusEl.textContent = '🔍';
          return;
        } catch (e2) {
          console.error('Fallback also failed:', e2);
        }
      }
      statusEl.textContent = '❌';
      hintEl.textContent = '摄像头失败。请刷新重试或检查权限。';
    });
  }

  async function stopScan() {
    if (scanner && scanning) {
      try { await scanner.stop(); } catch (e) {}
      scanning = false;
    }
  }

  // ---- BARCODE FOUND ----
  function onScan(text) {
    if (!text || text.length < 4) return;
    const now = Date.now();
    if (onScan._t && now - onScan._t < 2000) return;
    onScan._t = now;

    tracking = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    foundEl.textContent = '✅ ' + tracking;
    foundEl.style.display = 'block';
    hintEl.textContent = '单号已识别，点按钮开始录制';
    btnRec.disabled = false;
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setTimeout(() => { foundEl.style.display = 'none'; }, 2500);
  }

  // ---- RECORD (back camera + mic) ----
  async function startRec() {
    if (!tracking) return;
    if (recorder?.state === 'recording') return;

    await stopScan();
    document.getElementById('scanner').innerHTML = '';

    // Open camera for recording — same back camera
    const videoConstraints = (cameras.length > 0 && currentCamIdx >= 0)
      ? { deviceId: { exact: cameras[currentCamIdx].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    } catch (e) {
      // Fallback without exact
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    }

    recordingEl.style.display = 'block';
    hintEl.textContent = '录制中 — ' + tracking;
    btnRec.classList.add('hid');
    btnStop.classList.remove('hid');
    btnSwitch.classList.add('hid');

    chunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(timerInt);
      recordingEl.style.display = 'none';
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      blob = new Blob(chunks, { type: mime });
      btnStop.classList.add('hid');
      onDone();
    };
    recorder.start(1000);
    startTime = Date.now();
    timerInt = setInterval(updateTimer, 500);
    updateTimer();
  }

  function stopRec() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- AFTER RECORD ----
  function onDone() {
    const dur = Math.round((Date.now() - startTime) / 1000);
    // Save to phone
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = tracking + '.webm';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    // Upload
    doUpload(dur);
  }

  async function doUpload(dur) {
    hintEl.textContent = '上传中... ' + tracking;
    if (!connected) {
      hintEl.textContent = '⚠️ 未连接，视频已存手机相册 — ' + tracking;
      showNext(); return;
    }
    const fid = tracking + '_' + Date.now();
    const sz = blob.size, cs = 256 * 1024, total = Math.ceil(sz / cs);
    try {
      await ws('upload:start', { fileId: fid, trackingNumber: tracking, totalSize: sz, duration: dur });
      for (let i = 0; i < total; i++) {
        const b = blob.slice(i * cs, Math.min((i + 1) * cs, sz));
        await ws('upload:chunk', { fileId: fid, index: i, data: await b.arrayBuffer() });
        hintEl.textContent = `上传 ${Math.round((i+1)/total*100)}% — ${tracking}`;
      }
      await ws('upload:complete', { fileId: fid });
      hintEl.textContent = '✅ 上传完成 — ' + tracking;
    } catch (e) {
      hintEl.textContent = '⚠️ 上传失败，已存手机 — ' + tracking;
    }
    showNext();
  }

  function ws(ev, data) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 120000);
      socket.emit(ev, data, r => { clearTimeout(t); r?.error ? reject(new Error(r.error)) : resolve(r || {}); });
    });
  }

  function showNext() { btnNext.classList.remove('hid'); }

  // ---- NEXT PACKAGE ----
  async function resetAll() {
    tracking = ''; blob = null; recorder = null; chunks = []; startTime = 0;
    btnNext.classList.add('hid'); btnRec.classList.remove('hid'); btnRec.disabled = true;
    btnStop.classList.add('hid'); btnSwitch.classList.remove('hid');
    foundEl.style.display = 'none'; recordingEl.style.display = 'none';
    hintEl.textContent = '将快递单号条码对准框内';
    startScan();
  }

  function msg(m) { msgEl.textContent = m; msgEl.classList.remove('hid'); setTimeout(() => msgEl.classList.add('hid'), 2500); }

  init();
})();
