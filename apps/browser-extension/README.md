# 异起看 (YiVideo) 同步助手 - 浏览器扩展

本扩展是 **异起看 Web 房间** 的配套浏览器插件（支持 Google Chrome、Microsoft Edge、Brave 等基于 Chromium 内核的浏览器，以及 Firefox）。

## 核心能力
1. **解除网页防嵌套限制**：利用 `declarativeNetRequest` 动态移除目标视频网站的 `X-Frame-Options` 与 `Content-Security-Policy` (frame-ancestors) 响应头，让任何网站都能在 Web 房间中嵌入。
2. **全平台播放器嗅探与控制**：自动探测 iframe 内部的 HTML5 `<video>`、B站 `bwp-video`、腾讯视频 `__PLAYER__`、百度网盘、优酷、爱奇艺等播放器实例。
3. **双向跨域通信与同步**：通过 `window.postMessage` 与顶层 Web 房间进行实时播放状态汇报和毫秒级同步指令下发。

## 安装与加载方法 (开发者模式)
1. 打开浏览器并访问扩展管理页：
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
2. 打开页面右上角的 **“开发者模式” (Developer mode)** 开关。
3. 点击 **“加载已解压的扩展程序” (Load unpacked)**。
4. 选择当前文件夹：`apps/browser-extension`（例如 `/Users/hetao/Desktop/Project-bus/yiqikan/apps/browser-extension`）即可完成加载！
