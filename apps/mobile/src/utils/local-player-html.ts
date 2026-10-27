/**
 * 移动端轻量级内置本地视频播放器 HTML 模板
 * 运行于 React Native WebView 内部，100% 走纯 JS 热更新，支持 iOS 与 Android 双端
 */

interface LocalPlayerHtmlOptions {
  expectedFileName?: string | null;
  isHost?: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateLocalVideoPlayerHtml({
  expectedFileName,
  isHost = false,
}: LocalPlayerHtmlOptions): string {
  const cleanTitle = escapeHtml(expectedFileName || '本地视频放映室');
  const safeExpectedName = expectedFileName ? escapeHtml(expectedFileName) : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>${cleanTitle}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: #0c0c0e;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #root-container {
      width: 100%;
      height: 100%;
      position: relative;
      display: flex;
      padding: 12px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      box-sizing: border-box;
    }
    /* 视频视口容器 */
    #video-wrapper {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: none;
      align-items: center;
      justify-content: center;
      background: #000;
      z-index: 10;
    }
    #yiqikan-local-video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }
    /* 顶部换片小按钮 */
    #switch-btn {
      position: fixed;
      top: max(14px, env(safe-area-inset-top, 14px));
      right: 14px;
      z-index: 50;
      background: rgba(24, 24, 28, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #e4e4e7;
      font-size: 11px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 16px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: none;
      align-items: center;
      gap: 5px;
    }
    #switch-btn:active {
      transform: scale(0.96);
      background: rgba(40, 40, 45, 0.95);
    }
    /* 选片引导看板 */
    #guide-card {
      margin: auto;
      width: 100%;
      max-width: 380px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 18px 16px;
      text-align: center;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 20;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .icon-box {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, #F97316 0%, #FB7185 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
      box-shadow: 0 8px 20px rgba(249, 115, 22, 0.28);
      flex-shrink: 0;
    }
    .icon-box svg {
      width: 22px;
      height: 22px;
      fill: #fff;
      flex-shrink: 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 12px;
      background: rgba(52, 211, 153, 0.12);
      border: 1px solid rgba(52, 211, 153, 0.25);
      color: #34D399;
      font-size: 11px;
      font-weight: 600;
      margin: 0 auto;
      flex-shrink: 0;
    }
    .living-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #34D399;
      box-shadow: 0 0 8px #34D399;
      animation: pulse 1.6s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    h2 {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.2px;
      flex-shrink: 0;
    }
    p.desc {
      font-size: 11.5px;
      color: #a1a1aa;
      line-height: 1.45;
      flex-shrink: 0;
    }
    /* 房主片源信息条 */
    .source-box {
      background: rgba(249, 115, 22, 0.08);
      border: 1px solid rgba(249, 115, 22, 0.25);
      border-radius: 16px;
      padding: 10px 12px;
      text-align: left;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
    }
    .source-info {
      flex: 1;
      min-width: 0;
    }
    .source-label {
      font-size: 10px;
      color: #fdba74;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .source-name {
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .copy-btn {
      flex-shrink: 0;
      background: rgba(249, 115, 22, 0.2);
      border: 1px solid rgba(249, 115, 22, 0.35);
      color: #fed7aa;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .copy-btn:active {
      transform: scale(0.95);
      background: rgba(249, 115, 22, 0.35);
    }
    /* 3 步简要流程 */
    .steps-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      text-align: left;
      flex-shrink: 0;
    }
    .step-item {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 8px;
      flex-shrink: 0;
    }
    .step-title {
      font-size: 10px;
      font-weight: 700;
      color: #fdba74;
      margin-bottom: 2px;
    }
    .step-desc {
      font-size: 9px;
      color: #71717a;
      line-height: 1.3;
    }
    /* 选择视频主操作按钮 */
    .primary-btn {
      width: 100%;
      height: 48px;
      min-height: 48px;
      flex-shrink: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, #F97316 0%, #FB7185 100%);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 6px 18px rgba(249, 115, 22, 0.25);
      cursor: pointer;
      box-sizing: border-box;
      padding: 0 16px;
    }
    .primary-btn svg {
      flex-shrink: 0;
    }
    .primary-btn:active {
      transform: scale(0.98);
      filter: brightness(1.1);
    }
    .sub-btn {
      width: 100%;
      height: 40px;
      min-height: 40px;
      flex-shrink: 0;
      background: transparent;
      border: 1px dashed rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 0 12px;
      color: #a1a1aa;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-sizing: border-box;
    }
    .sub-btn svg {
      flex-shrink: 0;
    }
    .sub-btn:active {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }
    .qa-box {
      background: rgba(255, 255, 255, 0.02);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 10px;
      color: #71717a;
      line-height: 1.4;
      text-align: left;
      flex-shrink: 0;
    }
    .qa-box b {
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div id="root-container">
    <button id="switch-btn" type="button" onclick="triggerPickVideo()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      <span>换片</span>
    </button>

    <div id="video-wrapper">
      <video id="yiqikan-local-video" playsinline webkit-playsinline x5-video-player-type="h5" x5-playsinline="true"></video>
    </div>

    <div id="guide-card">
      <div class="icon-box">
        <svg viewBox="0 0 24 24"><path d="M19.82 2H4.18C2.97 2 2 2.97 2 4.18v15.64C2 21.03 2.97 22 4.18 22h15.64c1.21 0 2.18-.97 2.18-2.18V4.18C22 2.97 21.03 2 19.82 2zM7 4h2v2H7V4zm0 4h2v2H7V8zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm10 4H9v-2h8v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm0-4h-2V4h2v2z"/></svg>
      </div>

      <div>
        <div class="badge">
          <span class="living-dot"></span>
          <span>4K 原画点对点同步 · 免流</span>
        </div>
        <h2 id="guide-title" style="margin-top: 8px;">${expectedFileName ? '放映室正在同步本地视频' : '选择本地视频放映'}</h2>
        <p id="guide-desc" class="desc" style="margin-top: 5px;">
          ${expectedFileName
            ? '房主已开启本地高清放映。双方载入相同文件，即可享受毫秒级对齐。'
            : (isHost
              ? '支持 MP4 / WebM / MKV / MOV 等本地视频，选定后房内成员将实时跟播。'
              : '房内支持点对点同步本地视频，选定后即可与大家一起同步观看。')}
        </p>
      </div>

      <div id="source-box" class="source-box" style="display: ${safeExpectedName ? 'flex' : 'none'};">
        <div class="source-info">
          <div class="source-label">房主正在放映的文件：</div>
          <div class="source-name" id="source-name-text">${safeExpectedName}</div>
        </div>
        <button class="copy-btn" id="copy-btn" type="button" onclick="copySourceName()">
          <span id="copy-btn-text">复制片名</span>
        </button>
      </div>

      <div id="steps-host" class="steps-row" style="display: ${isHost && !expectedFileName ? 'grid' : 'none'};">
        <div class="step-item">
          <div class="step-title">1. 选本地视频</div>
          <div class="step-desc">点击下方导入手机文件</div>
        </div>
        <div class="step-item">
          <div class="step-title">2. 发给好友</div>
          <div class="step-desc">微信/网盘发同款视频</div>
        </div>
        <div class="step-item">
          <div class="step-title">3. 毫秒级同步</div>
          <div class="step-desc">好友载入后全员对齐</div>
        </div>
      </div>

      <div id="steps-member" class="steps-row" style="display: ${!isHost || expectedFileName ? 'grid' : 'none'};">
        <div class="step-item">
          <div class="step-title">1. 向对方索取</div>
          <div class="step-desc">微信/网盘获取同一文件</div>
        </div>
        <div class="step-item">
          <div class="step-title">2. 选同款视频</div>
          <div class="step-desc">点击下方导入手机文件</div>
        </div>
        <div class="step-item">
          <div class="step-title">3. 毫秒级对齐</div>
          <div class="step-desc">全自动同步进度状态</div>
        </div>
      </div>

      <button type="button" class="primary-btn" onclick="triggerPickVideo()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span id="primary-btn-text">${isHost && !safeExpectedName ? '选择手机本地视频开播' : (safeExpectedName ? '选择手机里的对应视频' : '选择手机本地视频')}</span>
      </button>

      <button type="button" class="sub-btn" onclick="triggerPickSubtitle()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span id="subtitle-btn-text">载入外挂字幕 (.srt / .vtt)</span>
      </button>

      <div class="qa-box">
        <b>💡 为什么需要双方选文件？</b><br/>
        本地视频不经云服务器转码中转，既避免网络卡顿，又享受 4K 原画与 0 延迟观影。<br/>
        <span style="display:inline-block;margin-top:4px;color:#f59e0b;">
          ⚠️ <b>格式注意</b>：iOS 仅支持 MP4 / MOV 格式（MKV 建议转码后播放）；Android 支持 MP4 / WebM / MKV 等。
        </span>
      </div>
    </div>
  </div>

  <input type="file" id="video-file-input" accept="video/*,.mkv,.mp4,.webm,.mov,.avi" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;" />
  <input type="file" id="subtitle-file-input" accept=".srt,.vtt" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;" />

  <script>
    (function() {
      let expectedName = ${JSON.stringify(expectedFileName || '')};

      const videoFileInput = document.getElementById('video-file-input');
      const subtitleFileInput = document.getElementById('subtitle-file-input');
      const videoWrapper = document.getElementById('video-wrapper');
      const guideCard = document.getElementById('guide-card');
      const videoEl = document.getElementById('yiqikan-local-video');
      const switchBtn = document.getElementById('switch-btn');
      const subtitleBtnText = document.getElementById('subtitle-btn-text');

      // 跟踪已创建的内存 Blob URL，换片或卸载时主动释放避免内存泄露
      let currentVideoBlobUrl = null;
      let currentSubtitleBlobUrl = null;

      function clearBlobUrls() {
        if (currentVideoBlobUrl) {
          URL.revokeObjectURL(currentVideoBlobUrl);
          currentVideoBlobUrl = null;
        }
        if (currentSubtitleBlobUrl) {
          URL.revokeObjectURL(currentSubtitleBlobUrl);
          currentSubtitleBlobUrl = null;
        }
      }

      window.addEventListener('beforeunload', clearBlobUrls);

      window.triggerPickVideo = function() {
        if (videoFileInput) videoFileInput.click();
      };

      window.triggerPickSubtitle = function() {
        if (subtitleFileInput) subtitleFileInput.click();
      };

      window.copySourceName = function() {
        if (!expectedName) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(expectedName);
          } else {
            const input = document.createElement('input');
            input.value = expectedName;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
          }
        } catch (e) {}

        const btnText = document.getElementById('copy-btn-text');
        if (btnText) btnText.innerText = '已复制';
        setTimeout(() => {
          if (btnText) btnText.innerText = '复制片名';
        }, 2000);

        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'TOAST',
            message: '已复制视频文件名：' + expectedName,
          }));
        }
      };

      window.__updateExpectedMedia = function(fileName, isHost) {
        expectedName = fileName || '';
        if (typeof isHost === 'boolean') {
          window.__isHost = isHost;
        }

        const sourceBox = document.getElementById('source-box');
        const sourceNameText = document.getElementById('source-name-text');
        const guideTitle = document.getElementById('guide-title');
        const guideDesc = document.getElementById('guide-desc');
        const primaryBtnText = document.getElementById('primary-btn-text');
        const hostSteps = document.getElementById('steps-host');
        const memberSteps = document.getElementById('steps-member');

        if (sourceBox && sourceNameText) {
          if (expectedName) {
            sourceNameText.innerText = expectedName;
            sourceBox.style.display = 'flex';
          } else {
            sourceBox.style.display = 'none';
          }
        }

        if (expectedName) {
          if (guideTitle) guideTitle.innerText = '放映室正在同步本地视频';
          if (guideDesc) guideDesc.innerText = '房主已开启本地高清放映。双方载入相同文件，即可享受毫秒级对齐。';
          if (primaryBtnText) primaryBtnText.innerText = '选择手机里的对应视频';
          if (hostSteps) hostSteps.style.display = 'none';
          if (memberSteps) memberSteps.style.display = 'grid';
          if (!videoEl.src) document.title = expectedName;
        } else if (window.__isHost) {
          if (guideTitle) guideTitle.innerText = '选择本地视频放映';
          if (guideDesc) guideDesc.innerText = '支持 MP4 / MOV 等本地视频，选定后房内成员将实时跟播。';
          if (primaryBtnText) primaryBtnText.innerText = '选择手机本地视频开播';
          if (hostSteps) hostSteps.style.display = 'grid';
          if (memberSteps) memberSteps.style.display = 'none';
          if (!videoEl.src) document.title = '本地视频放映室';
        } else {
          if (guideTitle) guideTitle.innerText = '选择本地视频放映';
          if (guideDesc) guideDesc.innerText = '房内支持点对点同步本地视频，选定后即可与大家一起同步观看。';
          if (primaryBtnText) primaryBtnText.innerText = '选择手机本地视频';
          if (hostSteps) hostSteps.style.display = 'none';
          if (memberSteps) memberSteps.style.display = 'grid';
          if (!videoEl.src) document.title = '本地视频放映室';
        }
      };

      window.__updateHostRole = function(isHost) {
        window.__updateExpectedMedia(expectedName, isHost);
      };

      window.__loadTestVideo = function(url, fileName) {
        const targetUrl = url || 'http://127.0.0.1:9999/real_sample.mp4';
        const targetName = fileName || '流浪地球2.2023.IMAX.mkv';
        fetch(targetUrl)
          .then(res => res.blob())
          .then(blob => {
            const file = new File([blob], targetName, { type: 'video/mp4' });
            if (currentVideoBlobUrl) {
              URL.revokeObjectURL(currentVideoBlobUrl);
            }
            currentVideoBlobUrl = URL.createObjectURL(file);
            videoEl.src = currentVideoBlobUrl;
            videoEl.load();

            document.title = file.name;
            guideCard.style.display = 'none';
            videoWrapper.style.display = 'flex';
            switchBtn.style.display = 'inline-flex';

            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'LOCAL_VIDEO_SELECTED',
                fileName: file.name,
                isHost: Boolean(window.__isHost),
              }));
            }
          })
          .catch(err => {
            console.error('Failed to load test video:', err);
          });
      };

      function srtToVtt(srtContent) {
        const normalized = srtContent.replace(/\\r\\n|\\r/g, '\\n').trim();
        return 'WEBVTT\\n\\n' + normalized.replace(/(\\d\\d:\\d\\d:\\d\\d),(\\d\\d\\d)/g, '$1.$2');
      }

      // 异步视频解码错误监听（如 iOS Safari 不支持 MKV 封装）
      videoEl.addEventListener('error', function() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        let errorTip = '当前视频格式暂不支持直接解码播放';
        if (isIOS) {
          errorTip = 'iOS 系统不支持直接播放 MKV 格式，建议选择 MP4 / MOV 格式文件或使用格式工厂转码';
        } else {
          errorTip = '该视频可能包含手机不支持的专有音视频编码（如特定 MKV），建议使用 MP4 格式';
        }

        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'TOAST',
            message: errorTip,
          }));
        }

        // 恢复显示引导选片卡片，隐藏异常视口
        guideCard.style.display = 'flex';
        videoWrapper.style.display = 'none';
        switchBtn.style.display = 'none';
      });

      videoFileInput.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          if (currentVideoBlobUrl) {
            URL.revokeObjectURL(currentVideoBlobUrl);
          }
          currentVideoBlobUrl = URL.createObjectURL(file);
          videoEl.src = currentVideoBlobUrl;
          videoEl.load();

          document.title = file.name;
          guideCard.style.display = 'none';
          videoWrapper.style.display = 'flex';
          switchBtn.style.display = 'inline-flex';

          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'LOCAL_VIDEO_SELECTED',
              fileName: file.name,
              isHost: Boolean(window.__isHost),
            }));
          }
        } catch (err) {
          alert('视频加载失败: ' + err.message);
        }
      });

      subtitleFileInput.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(ev) {
          const content = ev.target && ev.target.result;
          if (!content || typeof content !== 'string') return;
          try {
            const vttContent = file.name.endsWith('.vtt') ? content : srtToVtt(content);
            const blob = new Blob([vttContent], { type: 'text/vtt' });
            
            if (currentSubtitleBlobUrl) {
              URL.revokeObjectURL(currentSubtitleBlobUrl);
            }
            currentSubtitleBlobUrl = URL.createObjectURL(blob);

            const oldTracks = videoEl.querySelectorAll('track');
            for (let i = 0; i < oldTracks.length; i++) {
              oldTracks[i].remove();
            }

            const track = document.createElement('track');
            track.default = true;
            track.kind = 'subtitles';
            track.src = currentSubtitleBlobUrl;
            track.srclang = 'zh';
            track.label = file.name;
            videoEl.appendChild(track);

            if (subtitleBtnText) {
              subtitleBtnText.innerText = '已挂载字幕: ' + file.name;
            }
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'TOAST',
                message: '已挂载字幕: ' + file.name,
              }));
            }
          } catch (err) {
            alert('字幕解析失败: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    })();
  </script>
</body>
</html>`;
}
