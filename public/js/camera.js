/**
 * 使用手机原生相机 — 拍照扫码 + 录像，100% 可用
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const statusBar = $('#statusBar');
  const trackingDisplay = $('#trackingDisplay');
  const fileCard = $('#fileCard');
  const fileDisplay = $('#fileDisplay');
  const btnScan = $('#btnScan');
  const btnRecord = $('#btnRecord');
  const btnUpload = $('#btnUpload');
  const btnNext = $('#btnNext');
  const scanInput = $('#scanInput');
  const recordInput = $('#recordInput');

  let tracking = '';
  let videoBlob = null;
  let socket = null;
  let connected = false;

  // ---- INIT ----
  function init() {
    socket = io({ reconnection: true });
    socket.on('connect', () => {
      connected = true;
      statusBar.textContent = '🟢 已连接电脑';
      statusBar.className = 'sub connected';
    });
    socket.on('disconnect', () => {
      connected = false;
      statusBar.textContent = '🔴 未连接（视频会存手机）';
      statusBar.className = 'sub disconnected';
    });

    btnScan.onclick = () => scanInput.click();
    btnRecord.onclick = () => recordInput.click();
    btnUpload.onclick = doUpload;
    btnNext.onclick = resetAll;

    scanInput.onchange = handleScanFile;
    recordInput.onchange = handleRecordFile;
  }

  // ---- STEP 1: SCAN BARCODE (native camera photo → decode) ----
  async function handleScanFile() {
    const file = scanInput.files[0];
    if (!file) return;

    btnScan.disabled = true;
    btnScan.textContent = '🔍 识别中...';
    statusBar.textContent = '正在识别条码...';

    try {
      // Use html5-qrcode to decode barcode from photo
      const html5QrCode = new Html5Qrcode('scanHelper');
      const result = await html5QrCode.scanFile(file, false);
      tracking = result.trim().replace(/[^a-zA-Z0-9]/g, '');

      if (!tracking || tracking.length < 4) {
        throw new Error('未识别到有效单号: ' + result);
      }

      trackingDisplay.textContent = tracking;
      trackingDisplay.classList.remove('empty');
      btnScan.textContent = '📷 重新扫码';
      btnScan.disabled = false;
      btnRecord.classList.remove('hid');
      statusBar.textContent = '✅ 单号: ' + tracking;

    } catch (err) {
      console.error('Scan error:', err);
      trackingDisplay.textContent = '识别失败，请重试';
      btnScan.textContent = '📷 拍照扫码';
      btnScan.disabled = false;
      statusBar.textContent = '⚠️ ' + (err.message || '识别失败');
    }

    // Reset file input for next use
    scanInput.value = '';
  }

  // ---- STEP 2: RECORD VIDEO (native camera video) ----
  function handleRecordFile() {
    const file = recordInput.files[0];
    if (!file) return;

    videoBlob = file;
    const sizeMB = (file.size / 1048576).toFixed(1);
    const duration = '未知';

    fileDisplay.textContent = `${tracking}.mp4 (${sizeMB}MB)`;
    fileCard.classList.remove('hid');
    btnRecord.classList.add('hid');
    btnUpload.classList.remove('hid');
    btnScan.textContent = '📷 重新扫码';
    btnScan.disabled = false;
    statusBar.textContent = '✅ 录像完成 — ' + tracking;

    recordInput.value = '';
  }

  // ---- STEP 3: UPLOAD ----
  async function doUpload() {
    if (!videoBlob || !tracking) return;
    if (!connected) {
      statusBar.textContent = '⚠️ 未连接，请通过数据线拷贝视频到 usb-import/';
      saveToPhone();
      showNext();
      return;
    }

    btnUpload.disabled = true;
    btnUpload.textContent = '上传中 0%...';

    const fid = tracking + '_' + Date.now();
    const sz = videoBlob.size;
    const cs = 256 * 1024;
    const total = Math.ceil(sz / cs);

    try {
      await ws('upload:start', {
        fileId: fid,
        trackingNumber: tracking,
        totalSize: sz,
        duration: 0,
      });

      for (let i = 0; i < total; i++) {
        const start = i * cs;
        const end = Math.min(start + cs, sz);
        const chunk = videoBlob.slice(start, end);
        const buf = await chunk.arrayBuffer();
        await ws('upload:chunk', { fileId: fid, index: i, data: buf });
        const pct = Math.round(((i + 1) / total) * 100);
        btnUpload.textContent = `上传中 ${pct}%...`;
      }

      const result = await ws('upload:complete', { fileId: fid });
      if (result?.success) {
        statusBar.textContent = '✅ 上传完成 — ' + tracking;
        btnUpload.textContent = '☁️ 上传完成';
      }
    } catch (err) {
      statusBar.textContent = '⚠️ 上传失败，视频已存手机 — ' + err.message;
      saveToPhone();
    }

    showNext();
  }

  function ws(ev, data) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('超时')), 120000);
      socket.emit(ev, data, r => {
        clearTimeout(t);
        r?.error ? reject(new Error(r.error)) : resolve(r || {});
      });
    });
  }

  function saveToPhone() {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tracking + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function showNext() {
    btnUpload.classList.add('hid');
    btnNext.classList.remove('hid');
  }

  // ---- NEXT PACKAGE ----
  function resetAll() {
    tracking = '';
    videoBlob = null;
    trackingDisplay.textContent = '扫描获取';
    trackingDisplay.classList.add('empty');
    fileCard.classList.add('hid');
    btnScan.textContent = '📷 拍照扫码';
    btnScan.disabled = false;
    btnScan.classList.remove('hid');
    btnRecord.classList.add('hid');
    btnUpload.classList.add('hid');
    btnNext.classList.add('hid');
    statusBar.textContent = connected ? '🟢 准备就绪' : '🔴 未连接';
  }

  init();
})();
