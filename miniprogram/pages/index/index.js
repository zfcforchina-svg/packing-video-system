const app = getApp();

Page({
  data: {
    tracking: '',
    scanning: false,
    scanBtn: '📷 扫条码',
    videoPath: '',
    videoReady: false,
    uploading: false,
    done: false,
    connected: false,
    statusText: '准备就绪'
  },

  onLoad() {
    // Test server connection
    wx.request({
      url: app.globalData.serverUrl + '/api/stats',
      success: () => this.setData({ connected: true, statusText: '🟢 已连接' }),
      fail: () => this.setData({ connected: false, statusText: '🔴 未连接' })
    });
  },

  // Step 1: Scan barcode
  doScan() {
    this.setData({ scanning: true, scanBtn: '🔍 打开扫码...' });
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['barCode', 'qrCode', 'datamatrix', 'pdf417'],
      success: (res) => {
        const tracking = (res.result || '').replace(/[^a-zA-Z0-9]/g, '');
        this.setData({
          tracking,
          scanning: false,
          scanBtn: '📷 重新扫码',
          statusText: '✅ 单号: ' + tracking
        });
        wx.vibrateShort();
      },
      fail: (err) => {
        console.log('Scan cancelled:', err);
        this.setData({ scanning: false, scanBtn: '📷 扫条码' });
      }
    });
  },

  // Step 2: Record video
  doRecord() {
    wx.chooseVideo({
      camera: 'back',
      maxDuration: 60,
      sourceType: ['camera'],
      success: (res) => {
        this.setData({
          videoPath: res.tempFilePath,
          videoReady: true,
          statusText: '✅ 录像完成 — ' + (res.duration || 0) + 's'
        });
      },
      fail: (err) => {
        console.log('Record cancelled:', err);
      }
    });
  },

  // Step 3: Upload
  doUpload() {
    const tracking = this.data.tracking;
    if (!tracking || !this.data.videoPath) return;

    this.setData({ uploading: true, statusText: '上传中 0%...' });

    const uploadTask = wx.uploadFile({
      url: app.globalData.serverUrl + '/api/upload',
      filePath: this.data.videoPath,
      name: 'video',
      formData: { trackingNumber: tracking },
      success: (res) => {
        try {
          const data = JSON.parse(res.data);
          if (data.success) {
            this.setData({
              uploading: false,
              done: true,
              statusText: '✅ 上传完成 — ' + tracking
            });
          } else {
            this.setData({
              uploading: false,
              statusText: '⚠️ 上传失败: ' + (data.error || '未知')
            });
          }
        } catch (e) {
          this.setData({ uploading: false, statusText: '⚠️ 上传失败' });
        }
      },
      fail: (err) => {
        console.log('Upload failed:', err);
        this.setData({
          uploading: false,
          statusText: '⚠️ 上传失败，视频已存手机相册'
        });
      }
    });

    // Progress
    uploadTask.onProgressUpdate((res) => {
      this.setData({ statusText: '上传中 ' + res.progress + '%' });
    });
  },

  // Step 4: Next package
  doNext() {
    this.setData({
      tracking: '',
      videoPath: '',
      videoReady: false,
      done: false,
      scanBtn: '📷 扫条码',
      statusText: this.data.connected ? '🟢 准备就绪' : '🔴 未连接'
    });
  },

  onTrackingInput(e) {
    this.setData({ tracking: e.detail.value });
  }
});
