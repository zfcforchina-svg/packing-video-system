/**
 * 打包录像 — 使用浏览器原生 BarcodeDetector API
 * 自己控制摄像头，不依赖第三方扫码库
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const statusEl = $('#status'), hintEl = $('#hint'), foundEl = $('#found');
  const recordingEl = $('#recording'), timerEl = $('#timer'), msgEl = $('#msg');
  const btnSwitch = $('#btnSwitch'), btnRec = $('#btnRec');
  const btnStop = $('#btnStop'), btnNext = $('#btnNext');
  const scannerDiv = $('#scanner');
  const overlay = $('#overlay');

  // ---- STATE ----
  let tracking = '';
  let cameras = [];
  let camIdx = -1;
  let videoEl = null;       // hidden video for scanning
  let scanAnim = 0;         // requestAnimationFrame ID
  let barcodeDetector = null;
  let useNative = false;
  let stream = null, recorder = null, blob = null, chunks = [];
  let startTime = 0, timerInt = 0;
  let socket = null, connected = false;
  let scanRunning = false;

  // ---- INIT ----
  async function init() {
    socket = io({ reconnection: true });
    socket.on('connect', () => { connected = true; statusEl.textContent = '🟢'; });
    socket.on('disconnect', () => { connected = false; statusEl.textContent = '🔴'; });
    btnSwitch.onclick = switchCam;
    btnRec.onclick = startRec;
    btnStop.onclick = stopRec;
    btnNext.onclick = resetAll;

    // Check for native BarcodeDetector
    if ('BarcodeDetector' in window) {
      try {
        barcodeDetector = new BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code']
        });
        useNative = true;
        console.log('Using native BarcodeDetector');
      } catch (e) {
        console.log('BarcodeDetector init failed, using html5-qrcode fallback');
        useNative = false;
      }
    } else {
      console.log('BarcodeDetector not available, using html5-qrcode fallback');
      useNative = false;
    }

    await getCameras();
    if (useNative) startNativeScan();
    else startQrcodeScan();
  }

  // ---- CAMERAS ----
  async function getCameras() {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach(t => t.stop());
    } catch (e) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter(d => d.kind === 'videoinput');
    // Pick last camera (back on phones)
    camIdx = cameras.length - 1;
    console.log('Cameras:', cameras.map((c,i) => `${i}: ${c.label}`));
  }

  function getCamConfig() {
    if (cameras.length > 0 && camIdx >= 0) {
      return { deviceId: { exact: cameras[camIdx].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } };
    }
    return { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  }

  async function switchCam() {
    await getCameras();
    if (cameras.length < 2) { msg('只有一个摄像头'); return; }
    camIdx = (camIdx + 1) % cameras.length;
    msg('切换: ' + (cameras[camIdx]?.label || '摄像头'));
    if (useNative) { stopNativeScan(); startNativeScan(); }
    else { stopQrcodeScan(); startQrcodeScan(); }
  }

  // ============================================================
  // NATIVE BARCODE DETECTOR (primary, fast)
  // ============================================================
  async function startNativeScan() {
    scanRunning = true;
    scannerDiv.innerHTML = '';

    // Create video element
    videoEl = document.createElement('video');
    videoEl.setAttribute('autoplay', '');
    videoEl.setAttribute('muted', '');
    videoEl.setAttribute('playsinline', '');
    videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover';
    scannerDiv.appendChild(videoEl);

    // Hidden canvas for frame capture
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: getCamConfig(), audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (e) {
      console.error('Camera error:', e);
      hintEl.textContent = '摄像头启动失败，请刷新重试';
      statusEl.textContent = '❌';
      scanRunning = false;
      return;
    }

    statusEl.textContent = '🔍';
    hintEl.textContent = '将快递单号条码对准框内';

    // Scanning loop
    let lastScan = 0;
    async function scanLoop() {
      if (!scanRunning) return;

      if (videoEl.readyState >= 2 && Date.now() - lastScan > 150) {
        lastScan = Date.now();
        canvas.width = videoEl.videoWidth || 1280;
        canvas.height = videoEl.videoHeight || 720;

        try {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          const barcodes = await barcodeDetector.detect(canvas);
          if (barcodes.length > 0) {
            const text = barcodes[0].rawValue;
            if (text && text.length >= 4) {
              onBarcode(text);
              // Don't stop scanning — user might need to record this package
            }
          }
        } catch (e) {
          // BarcodeDetector throws on empty frames, ignore
        }
      }
      scanAnim = requestAnimationFrame(scanLoop);
    }
    scanLoop();
  }

  function stopNativeScan() {
    scanRunning = false;
    if (scanAnim) { cancelAnimationFrame(scanAnim); scanAnim = 0; }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) { videoEl.remove(); videoEl = null; }
  }

  // ============================================================
  // html5-qrcode FALLBACK (for older browsers)
  // ============================================================
  let qrScanner = null;
  function startQrcodeScan() {
    scannerDiv.innerHTML = '';
    qrScanner = new Html5Qrcode('scanner');
    qrScanner.start(
      getCamConfig(),
      { fps: 10, qrbox: { width: 320, height: 80 }, disableFlip: true, aspectRatio: 1.7 },
      (text) => { if (text && text.length >= 4) onBarcode(text); },
      () => {}
    ).then(() => {
      scanRunning = true;
      statusEl.textContent = '🔍';
      hintEl.textContent = '将快递单号条码对准框内';
    }).catch(e => {
      console.error('QR scanner error:', e);
      hintEl.textContent = '扫码启动失败: ' + (e.message || e);
      statusEl.textContent = '❌';
    });
  }

  function stopQrcodeScan() {
    scanRunning = false;
    if (qrScanner) {
      try { qrScanner.stop().catch(() => {}); } catch (e) {}
      qrScanner = null;
    }
  }

  // ---- BARCODE FOUND ----
  function onBarcode(text) {
    const now = Date.now();
    if (onBarcode._t && now - onBarcode._t < 2000) return;
    onBarcode._t = now;

    tracking = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    foundEl.textContent = '✅ ' + tracking;
    foundEl.style.display = 'block';
    hintEl.textContent = '已识别，点⏺开始录制';
    btnRec.disabled = false;
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setTimeout(() => { foundEl.style.display = 'none'; }, 2500);
  }

  // ============================================================
  // RECORDING
  // ============================================================
  async function startRec() {
    if (!tracking) return;
    if (recorder?.state === 'recording') return;

    // Stop scanner
    if (useNative) stopNativeScan();
    else stopQrcodeScan();
    scannerDiv.innerHTML = '';

    // Open camera for recording (with audio)
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: getCamConfig(), audio: true });
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    }

    recordingEl.style.display = 'block';
    hintEl.textContent = '录制中 — ' + tracking;
    btnRec.classList.add('hid'); btnStop.classList.remove('hid'); btnSwitch.classList.add('hid');

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

  function stopRec() { if (recorder?.state === 'recording') recorder.stop(); }
  function updateTimer() {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  }

  // ---- SAVE + UPLOAD ----
  function onDone() {
    const dur = Math.round((Date.now() - startTime) / 1000);
    // Save to phone
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = tracking + '.webm';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    doUpload(dur);
  }

  async function doUpload(dur) {
    hintEl.textContent = '上传中... ' + tracking;
    if (!connected) { hintEl.textContent = '⚠️ 未连接，已存手机 — ' + tracking; showNext(); return; }
    const fid = tracking + '_' + Date.now();
    const sz = blob.size, cs = 256*1024, total = Math.ceil(sz/cs);
    try {
      await ws('upload:start',{fileId:fid,trackingNumber:tracking,totalSize:sz,duration:dur});
      for (let i=0;i<total;i++) {
        const b=blob.slice(i*cs,Math.min((i+1)*cs,sz));
        await ws('upload:chunk',{fileId:fid,index:i,data:await b.arrayBuffer()});
        hintEl.textContent = `上传 ${Math.round((i+1)/total*100)}% — ${tracking}`;
      }
      await ws('upload:complete',{fileId:fid});
      hintEl.textContent = '✅ 上传完成 — ' + tracking;
    } catch(e) { hintEl.textContent = '⚠️ 上传失败，已存手机 — ' + tracking; }
    showNext();
  }

  function ws(ev,d) {
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(new Error('timeout')),120000);
      socket.emit(ev,d,r=>{clearTimeout(t);r?.error?reject(new Error(r.error)):resolve(r||{});});
    });
  }
  function showNext() { btnNext.classList.remove('hid'); }

  // ---- NEXT ----
  async function resetAll() {
    tracking='';blob=null;recorder=null;chunks=[];startTime=0;
    btnNext.classList.add('hid');btnRec.classList.remove('hid');btnRec.disabled=true;
    btnStop.classList.add('hid');btnSwitch.classList.remove('hid');
    foundEl.style.display='none';recordingEl.style.display='none';
    hintEl.textContent='将快递单号条码对准框内';
    if (useNative) startNativeScan(); else startQrcodeScan();
  }

  function msg(m){msgEl.textContent=m;msgEl.classList.remove('hid');setTimeout(()=>msgEl.classList.add('hid'),2500);}
  init();
})();
