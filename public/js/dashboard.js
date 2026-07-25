/**
 * dashboard.js — Computer management dashboard
 * Video list, search, playback, settings.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const dom = {
    connectionBadge: $('#connectionBadge'),
    searchInput: $('#searchInput'),
    dateFrom: $('#dateFrom'),
    dateTo: $('#dateTo'),
    searchBtn: $('#searchBtn'),
    clearSearchBtn: $('#clearSearchBtn'),
    searchResult: $('#searchResult'),
    videoList: $('#videoList'),
    emptyState: $('#emptyState'),
    pagination: $('#pagination'),
    prevPageBtn: $('#prevPageBtn'),
    nextPageBtn: $('#nextPageBtn'),
    pageInfo: $('#pageInfo'),
    statsBar: $('#statsBar'),
    statTotal: $('#statTotal'),
    statSize: $('#statSize'),
    statToday: $('#statToday'),
    statFree: $('#statFree'),
    // Player modal
    playerModal: $('#playerModal'),
    playerVideo: $('#playerVideo'),
    playerTitle: $('#playerTitle'),
    playerInfo: $('#playerInfo'),
    closePlayer: $('#closePlayer'),
    copyTrackingBtn: $('#copyTrackingBtn'),
    deleteVideoBtn: $('#deleteVideoBtn'),
    // Settings modal
    settingsModal: $('#settingsModal'),
    settingsToggle: $('#settingsToggle'),
    closeSettings: $('#closeSettings'),
    settingRetention: $('#settingRetention'),
    settingMaxSize: $('#settingMaxSize'),
    settingWatermark: $('#settingWatermark'),
    saveSettingsBtn: $('#saveSettingsBtn'),
    // Toast
    toast: $('#toast'),
  };

  let currentPage = 1;
  let currentVideo = null;
  let socket = null;

  // ====== INIT ======
  function init() {
    connectSocket();
    bindEvents();
    loadVideos();
    loadStats();
    loadSettings();
  }

  function connectSocket() {
    socket = io({ reconnection: true });
    socket.on('connect', () => {
      dom.connectionBadge.innerHTML = '🟢 服务运行中';
    });
    socket.on('disconnect', () => {
      dom.connectionBadge.innerHTML = '🔴 连接断开';
    });
    // Real-time: new video arrived
    socket.on('new-video', (data) => {
      toast(`新视频到达: ${data.trackingNumber}`);
      loadVideos();
      loadStats();
    });
  }

  function bindEvents() {
    dom.searchBtn.addEventListener('click', () => { currentPage = 1; loadVideos(); });
    dom.clearSearchBtn.addEventListener('click', clearSearch);
    dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { currentPage = 1; loadVideos(); }
    });
    dom.prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; loadVideos(); }
    });
    dom.nextPageBtn.addEventListener('click', () => { currentPage++; loadVideos(); });

    // Player
    dom.closePlayer.addEventListener('click', closePlayer);
    dom.playerModal.addEventListener('click', (e) => {
      if (e.target === dom.playerModal) closePlayer();
    });
    dom.copyTrackingBtn.addEventListener('click', copyTracking);
    dom.deleteVideoBtn.addEventListener('click', deleteCurrentVideo);

    // Settings
    dom.settingsToggle.addEventListener('click', () => dom.settingsModal.classList.remove('hidden'));
    dom.closeSettings.addEventListener('click', () => dom.settingsModal.classList.add('hidden'));
    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) dom.settingsModal.classList.add('hidden');
    });
    dom.saveSettingsBtn.addEventListener('click', saveSettings);
  }

  // ====== VIDEO LIST ======
  async function loadVideos() {
    const search = dom.searchInput.value.trim();
    const dateFrom = dom.dateFrom.value;
    const dateTo = dom.dateTo.value;
    const params = new URLSearchParams({ page: currentPage, limit: 30, search, dateFrom, dateTo });

    try {
      const res = await fetch(`/api/videos?${params}`);
      const data = await res.json();

      renderVideoList(data.videos);
      dom.searchResult.textContent = data.total > 0
        ? `共 ${data.total} 条，第 ${data.page}/${data.totalPages} 页`
        : '';

      if (data.total === 0) {
        dom.emptyState.classList.remove('hidden');
        dom.pagination.classList.add('hidden');
      } else {
        dom.emptyState.classList.add('hidden');
        dom.pagination.classList.remove('hidden');
        dom.pageInfo.textContent = `第 ${data.page} / ${data.totalPages} 页`;
        dom.prevPageBtn.disabled = data.page <= 1;
        dom.nextPageBtn.disabled = data.page >= data.totalPages;
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
      dom.emptyState.classList.remove('hidden');
      dom.emptyState.querySelector('p').textContent = '加载失败，请检查服务器是否启动';
    }
  }

  function renderVideoList(videos) {
    dom.videoList.querySelectorAll('.video-card').forEach((c) => c.remove());

    if (!videos || videos.length === 0) return;

    videos.forEach((v) => {
      const card = document.createElement('div');
      card.className = 'video-card';
      card.innerHTML = `
        <div class="video-card-thumb" data-id="${v.id}">
          <div class="play-icon">▶</div>
        </div>
        <div class="video-card-body">
          <div class="video-card-tracking" title="${v.tracking_number}">${v.tracking_number}</div>
          <div class="video-card-meta">
            <span>${v.record_date} ${v.record_time}</span>
            <span>${formatSize(v.file_size)}</span>
          </div>
          <div class="video-card-tags">
            <span class="tag tag-${v.upload_method}">${v.upload_method === 'wifi' ? 'WiFi' : v.upload_method === 'usb' ? 'USB' : v.upload_method}</span>
            ${v.duration ? `<span class="tag">${Math.round(v.duration)}s</span>` : ''}
          </div>
        </div>
      `;

      // Click to play
      card.querySelector('.video-card-thumb').addEventListener('click', () => openPlayer(v));
      dom.videoList.appendChild(card);
    });
  }

  function clearSearch() {
    dom.searchInput.value = '';
    dom.dateFrom.value = '';
    dom.dateTo.value = '';
    currentPage = 1;
    loadVideos();
  }

  // ====== PLAYER ======
  function openPlayer(video) {
    currentVideo = video;
    dom.playerModal.classList.remove('hidden');
    dom.playerTitle.textContent = `单号: ${video.tracking_number}`;
    dom.playerInfo.innerHTML = `
      日期: ${video.record_date} ${video.record_time} |
      大小: ${formatSize(video.file_size)} |
      上传方式: ${video.upload_method}
    `;
    // Use relative path to uploads
    dom.playerVideo.src = `/uploads/${video.file_path}`;
    dom.playerVideo.load();
  }

  function closePlayer() {
    dom.playerModal.classList.add('hidden');
    dom.playerVideo.pause();
    dom.playerVideo.src = '';
    currentVideo = null;
  }

  function copyTracking() {
    if (!currentVideo) return;
    navigator.clipboard.writeText(currentVideo.tracking_number).then(() => {
      toast('单号已复制');
    }).catch(() => {
      // Fallback
      const input = document.createElement('input');
      input.value = currentVideo.tracking_number;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      toast('单号已复制');
    });
  }

  async function deleteCurrentVideo() {
    if (!currentVideo) return;
    if (!confirm(`确认删除视频？\n单号: ${currentVideo.tracking_number}\n此操作不可撤销。`)) return;

    try {
      const res = await fetch(`/api/videos/${currentVideo.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast('已删除');
        closePlayer();
        loadVideos();
        loadStats();
      }
    } catch (err) {
      toast('删除失败: ' + err.message);
    }
  }

  // ====== STATS ======
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      dom.statTotal.textContent = data.total?.count || 0;
      dom.statSize.textContent = formatSize(data.total?.size || 0);

      // Count today's videos
      const today = new Date().toISOString().slice(0, 10);
      const todayEntry = (data.byDate || []).find((d) => d.record_date === today);
      dom.statToday.textContent = todayEntry?.count || 0;

      dom.statFree.textContent = data.diskFreeGB ? `${data.diskFreeGB}GB` : '--';
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  // ====== SETTINGS ======
  async function loadSettings() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      dom.settingRetention.value = cfg.retentionDays || 90;
      dom.settingMaxSize.value = cfg.maxFileSizeMB || 500;
      dom.settingWatermark.checked = cfg.enableWatermark || false;
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function saveSettings() {
    const config = {
      retentionDays: parseInt(dom.settingRetention.value) || 90,
      maxFileSizeMB: parseInt(dom.settingMaxSize.value) || 500,
      enableWatermark: dom.settingWatermark.checked,
    };
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      toast('设置已保存（端口修改需重启服务生效）');
      dom.settingsModal.classList.add('hidden');
    } catch (err) {
      toast('保存失败: ' + err.message);
    }
  }

  // ====== HELPERS ======
  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0B';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB';
    return (bytes / 1073741824).toFixed(1) + 'GB';
  }

  function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove('hidden');
    setTimeout(() => dom.toast.classList.add('hidden'), 3000);
  }

  // ====== STARTUP ======
  init();
})();
