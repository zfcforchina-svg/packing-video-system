# 打包录像系统

电商打包发货录像系统 — 手机扫码录制，WiFi/USB 双模式传输，电脑端检索回放。

## 功能

- **手机扫码** — 用手机摄像头扫描快递面单条码（支持 Code128/QR/EAN13），自动提取单号
- **录像水印** — 录制时在视频底部叠加快递单号 + 实时时间戳
- **WiFi 上传** — 录完自动通过局域网传到电脑，进度条实时显示
- **USB 导入** — 数据线拷贝到 `usb-import/` 文件夹，自动识别导入
- **管理后台** — 按单号搜索、日期筛选、在线播放、批量删除
- **存储管理** — 按保留天数自动清理过期视频

## 快速开始

### 1. 环境要求

- **电脑**：macOS / Windows / Linux，已安装 Node.js >= 18
- **手机**：iPhone (iOS >= 15) 或 Android 手机
- **网络**：电脑和手机在同一个 WiFi 下（WiFi 上传模式）

可选：
- FFmpeg（用于视频水印后处理）

### 2. 安装

```bash
cd packing-video-system
npm install
```

### 3. 启动

```bash
npm start
```

启动后输出：
```
📦 打包录像系统已启动
   管理后台: http://localhost:3456
   手机录像: http://<本机IP>:3456/camera
   USB导入: 将视频文件放入 usb-import/ 目录
```

### 4. 使用

**电脑端：**
1. 浏览器打开 `http://localhost:3456` → 管理后台
2. 查看所有录像、搜索、回放

**手机端：**
1. 确保手机和电脑在同一 WiFi
2. 手机浏览器打开 `http://<电脑IP>:3456/camera`
3. 步骤① → 扫描快递单号条码
4. 步骤② → 录制打包视频
5. 步骤③ → 确认并上传到电脑

**添加到主屏幕：**
- iPhone Safari：点击分享按钮 → "添加到主屏幕"
- Android Chrome：点击菜单 → "添加到主屏幕"
- 之后就像 App 一样使用，全屏无浏览器边框

**USB 导入模式（无 WiFi 时）：**
1. 录完视频后点击"保存到手机"
2. 数据线连接手机到电脑
3. 将视频文件拷贝到 `usb-import/` 文件夹
4. 系统自动识别并导入（文件名格式：`单号_日期_时间.webm`）

## 配置

编辑 `config.json`：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `port` | `3456` | 服务端口 |
| `uploadsDir` | `./uploads` | 视频存储目录 |
| `usbImportDir` | `./usb-import` | USB 导入监听目录 |
| `retentionDays` | `90` | 视频保留天数（过期自动删除） |
| `enableWatermark` | `false` | 是否用 FFmpeg 后处理烧录水印 |
| `watermarkFontSize` | `28` | 水印字体大小 |
| `maxFileSizeMB` | `500` | 上传文件大小上限 |

也可以在管理后台的"设置"面板中修改。

## API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/videos` | GET | 视频列表（支持 `search`/`dateFrom`/`dateTo`/`page`/`limit`） |
| `/api/videos/:id` | GET | 单个视频信息 |
| `/api/videos/:id` | DELETE | 删除视频 |
| `/api/videos/tracking/:number` | GET | 按单号搜索 |
| `/api/videos/batch-delete` | POST | 批量删除 |
| `/api/upload` | POST | HTTP 上传视频 |
| `/api/stats` | GET | 存储统计 |
| `/api/config` | GET/PUT | 读取/更新配置 |

## 项目结构

```
packing-video-system/
├── server.js              # 主服务 (Express + Socket.IO)
├── config.json            # 配置文件
├── db/schema.js           # SQLite 数据库
├── routes/
│   ├── api.js             # REST API
│   └── upload.js          # 文件上传
├── services/
│   ├── watcher.js         # USB 文件夹监听
│   ├── watermark.js       # FFmpeg 水印
│   └── cleanup.js         # 定时清理
├── public/
│   ├── index.html         # 管理后台
│   ├── camera.html        # 手机录像页
│   ├── css/style.css      # 样式
│   └── js/
│       ├── dashboard.js   # 后台逻辑
│       ├── camera.js      # 录像 + 扫码 + 上传
│       └── upload-manager.js  # 上传队列管理
├── uploads/               # 视频存储 (gitignore)
└── usb-import/            # USB 导入 (gitignore)
```

## License

MIT
