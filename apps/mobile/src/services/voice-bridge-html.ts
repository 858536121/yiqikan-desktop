export const VOICE_BRIDGE_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YiQiKan Voice Bridge</title>
</head>
<body style="background: #000; margin: 0; padding: 0; color: #fff;">
<div id="status">Voice Engine Standby</div>
<script>
(function() {
  // WebRTC & getUserMedia Polyfill
  try {
    if (typeof navigator !== "undefined") {
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
      }
      if (!navigator.mediaDevices.getUserMedia) {
        var legacyGetUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;
        if (legacyGetUserMedia) {
          navigator.mediaDevices.getUserMedia = function(constraints) {
            return new Promise(function(resolve, reject) {
              legacyGetUserMedia.call(navigator, constraints, resolve, reject);
            });
          };
        }
      }
    }
  } catch(e) {}

  const DEFAULT_VOICE_HOST = "https://api.videotogether.cn";
  let voiceStatus = "idle";
  let sessionId = 0;
  let lastSampleClock = -1;
  let isMuted = false;
  let isDeafened = false;
  let callVolume = 1.0;

  let lastRoomId = "";
  let lastUserId = "";
  let lastUserName = "";
  let iceDisconnectTimer = null;
  let isReconnecting = false;

  let pc = null;
  let localStream = null;
  let peerAudioNodes = new Map();
  let isConnecting = false;
  let subscribeTimer = null;
  let connectionTimer = null;
  const rpcControllers = new Set();
  let diagnosticsEnabled = false;
  let diagnosticsTimer = null;
  let diagnosticsPolling = false;
  let diagnosticsEpoch = 0;
  let ucid = "";
  let rnameRPC = "";
  let unameRPC = "";
  let myUid = "";
  let pendingCandidates = [];
  let lastOfferFingerprint = "";

  // Audio Analyser & Smoothing
  let audioCtx = null;
  let localSource = null;
  let localAnalyser = null;
  let remoteAnalysers = new Map();
  let animLoopId = null;
  let audioRecoveryPromise = null;
  let audioRecoveryEpoch = 0;
  let lastRecoveryRequestAt = 0;
  let lastAudioRebuildAt = 0;
  let lastOutputRefreshAt = 0;
  let lastAudioClock = 0;
  let lastAudioClockAt = 0;
  let systemInterrupted = false;
  
  let smoothedLocalVol = 0;
  let smoothedRemoteVol = 0;
  let localSpeakingHoldCount = 0;
  let isCurrentlySpeaking = false;

  function log(tag, msg, extra) {
    postMsg("VOICE_LOG", { tag: tag, message: msg, extra: extra || null });
  }

  function postMsg(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload, sessionId: sessionId }));
    }
  }

  function fixedEncodeURIComponent(str) {
    return encodeURIComponent(str)
      .replace(/[!'()*]/g, function(c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); })
      .replace(/%20/g, "+");
  }

  function generateUUID() {
    return "voice-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getSdpTracksFingerprint(sdp) {
    if (!sdp) return "";
    const lines = sdp.split("\\r\\n");
    const trackLines = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("m=") || l.startsWith("a=ssrc:") || l.startsWith("a=mid:")) {
        trackLines.push(l);
      }
    }
    return trackLines.join(";");
  }

  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        const ctx = new AudioCtxClass();
        lastSampleClock = -1;
        audioCtx = ctx;
        lastAudioClock = ctx.currentTime;
        lastAudioClockAt = Date.now();
        ctx.onstatechange = function() {
          if (audioCtx === ctx && ctx.state !== "running") {
            requestAudioRecovery("state-" + ctx.state);
          }
        };
      }
    }
    return audioCtx;
  }

  function requestAudioRecovery(reason, refreshOutput) {
    if (!isConnecting || systemInterrupted || audioRecoveryPromise) return;
    const now = Date.now();
    if (lastRecoveryRequestAt && now - lastRecoveryRequestAt < 2000) return;
    lastRecoveryRequestAt = now;
    if (window.ReactNativeWebView) {
      // Restore the native session first, then resume this WebView's output.
      postMsg("VOICE_AUDIO_RECOVERY_REQUEST", { reason: reason, refreshOutput: !!refreshOutput });
    } else {
      recoverAudioOutput(reason, refreshOutput).catch(function(e) { log("WARN", e.message); });
    }
  }

  function withAudioTimeout(operation) {
    return new Promise(function(resolve, reject) {
      const timer = setTimeout(function() { reject(new Error("音频输出恢复超时")); }, 1500);
      Promise.resolve(operation).then(function(value) {
        clearTimeout(timer);
        resolve(value);
      }, function(error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function removeRemoteAudio(peerId, expected) {
    const node = peerAudioNodes.get(peerId);
    if (!node || (expected && node !== expected)) return;
    node.dispose();
    peerAudioNodes.delete(peerId);
    remoteAnalysers.delete(peerId);
  }

  function hasLiveAudio(stream) {
    return !!stream && stream.getAudioTracks().some(function(track) {
      return track.readyState === "live" && track.enabled !== false && !track.muted;
    });
  }

  function attachRemoteAudio(peerId, stream, ctx) {
    removeRemoteAudio(peerId);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    const gainNode = ctx.createGain();
    gainNode.gain.value = isDeafened ? 0 : callVolume;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    const tracks = stream.getAudioTracks();
    const node = { stream: stream, source: source, gainNode: gainNode, analyser: analyser, volume: 0,
      dispose: function() {
        tracks.forEach(function(track) { if (track.removeEventListener) track.removeEventListener("ended", onEnded); });
        if (stream.removeEventListener) stream.removeEventListener("removetrack", onEnded);
        source.disconnect(); gainNode.disconnect(); analyser.disconnect();
      }
    };
    function onEnded() {
      if (!stream.getAudioTracks().some(function(track) { return track.readyState === "live"; })) {
        removeRemoteAudio(peerId, node);
      }
    }
    tracks.forEach(function(track) { if (track.addEventListener) track.addEventListener("ended", onEnded); });
    if (stream.addEventListener) stream.addEventListener("removetrack", onEnded);
    peerAudioNodes.set(peerId, node);
    remoteAnalysers.set(peerId, node);
  }

  function rebuildAudioGraph() {
    // Retain the accepted remote streams and peer keys; never re-add filtered SFU loopback tracks.
    const streams = Array.from(peerAudioNodes.entries()).map(function(entry) {
      return { peerId: entry[0], stream: entry[1].stream };
    });
    if (localSource) localSource.disconnect();
    if (localAnalyser) localAnalyser.disconnect();
    peerAudioNodes.forEach(function(node) {
      node.dispose();
    });
    peerAudioNodes.clear();
    remoteAnalysers.clear();
    localSource = null;
    localAnalyser = null;
    const previous = audioCtx;
    audioCtx = null;
    if (previous) {
      previous.onstatechange = null;
      if (previous.state !== "closed") previous.close().catch(function(e) { log("WARN", "关闭旧音频输出失败: " + e.message); });
    }
    const ctx = getAudioContext();
    if (!ctx) throw new Error("设备不支持 AudioContext");
    if (localStream) {
      localSource = ctx.createMediaStreamSource(localStream);
      localAnalyser = ctx.createAnalyser();
      localAnalyser.fftSize = 256;
      localAnalyser.smoothingTimeConstant = 0.4;
      localSource.connect(localAnalyser);
    }
    streams.forEach(function(item) {
      if (item.stream.getAudioTracks().some(function(track) { return track.readyState === "live"; })) {
        attachRemoteAudio(item.peerId, item.stream, ctx);
      }
    });
    return ctx;
  }

  function recoverAudioOutput(reason, refreshOutput) {
    if (!isConnecting || systemInterrupted) return Promise.resolve();
    if (audioRecoveryPromise) return audioRecoveryPromise;
    const epoch = audioRecoveryEpoch;
    const operation = (async function() {
      let ctx = getAudioContext();
      if (!ctx) return;
      const initialState = ctx.state;
      try {
        if (ctx.state === "closed") throw new Error("音频输出已关闭");
        // WebKit can report running even when its hardware output has stalled.
        if (refreshOutput && ctx.state === "running" && Date.now() - lastOutputRefreshAt >= 2000) {
          lastOutputRefreshAt = Date.now();
          await withAudioTimeout(ctx.suspend());
        }
        if (epoch !== audioRecoveryEpoch || !isConnecting || systemInterrupted) return;
        await withAudioTimeout(ctx.resume());
        if (epoch !== audioRecoveryEpoch || systemInterrupted) return;
        if (ctx.state !== "running") throw new Error("音频输出仍为 " + ctx.state);
      } catch(error) {
        if (epoch !== audioRecoveryEpoch || !isConnecting || systemInterrupted) return;
        const now = Date.now();
        if (lastAudioRebuildAt && now - lastAudioRebuildAt < 10000) throw error;
        lastAudioRebuildAt = now;
        log("AudioRecovery", "恢复失败，重建音频管道: " + error.message);
        ctx = rebuildAudioGraph();
        await withAudioTimeout(ctx.resume());
      }
      if (epoch !== audioRecoveryEpoch || !isConnecting || systemInterrupted) return;
      lastAudioClock = ctx.currentTime;
      lastAudioClockAt = Date.now();
      log("AudioRecovery", "音频输出恢复尝试完成", {
        reason: reason, previousState: initialState, state: ctx.state,
        currentTime: ctx.currentTime, sampleRate: ctx.sampleRate, remoteStreams: peerAudioNodes.size
      });
    })();
    audioRecoveryPromise = operation;
    operation.finally(function() {
      if (epoch === audioRecoveryEpoch) audioRecoveryPromise = null;
    }).catch(function() {});
    return operation;
  }

  function calcVolume(analyser) {
    if (!analyser) return 0;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i];
    }
    const avg = sum / buffer.length;
    return Math.min(1.0, Math.max(0.0, (avg - 8) / 50));
  }

  function getAudioConstraints() {
    // 强制启用系统级回声消除 (AEC) + 噪声抑制 (NS) + 自动增益 (AGC)
    // 使用硬约束 (true) 而非 ideal，确保 iOS WebKit 激活系统底层音频处理模块
    // AEC 是防止扬声器视频声音通过麦克风回传的唯一有效手段（需要系统层参考信号）
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      // WebKit 厂商前缀约束，兼容旧版 iOS
      googEchoCancellation: true,
      googAutoGainControl: true,
      googNoiseSuppression: true,
      googHighpassFilter: true
    };
  }

  function startVolumeLoop() {
    if (animLoopId) return;

    function loop() {
      if (audioCtx && !systemInterrupted) {
        if (audioCtx.state !== "running") {
          requestAudioRecovery("heartbeat-" + audioCtx.state);
        } else if (Date.now() - lastAudioClockAt >= 2000) {
          if (peerAudioNodes.size && !isDeafened && callVolume > 0 && audioCtx.currentTime <= lastAudioClock) {
            requestAudioRecovery("output-clock-stalled", true);
          }
          lastAudioClock = audioCtx.currentTime;
          lastAudioClockAt = Date.now();
        }
      }

      // Analyser buffers can freeze during an interruption. Only advancing,
      // running audio with a live track can extend a speaking indication.
      const validSample = isConnecting && audioCtx && audioCtx.state === "running" &&
        !systemInterrupted && audioCtx.currentTime > lastSampleClock;
      lastSampleClock = audioCtx ? audioCtx.currentTime : -1;
      const localValid = validSample && !isMuted && hasLiveAudio(localStream);
      const rawLocalVol = localValid ? calcVolume(localAnalyser) : 0;
      smoothedLocalVol = localValid ? smoothedLocalVol * 0.65 + rawLocalVol * 0.35 : 0;
      if (!localValid) { localSpeakingHoldCount = 0; isCurrentlySpeaking = false; }
      const remoteSpeakingByUserId = Object.create(null);
      smoothedRemoteVol = 0;
      remoteAnalysers.forEach(function(item, peerId) {
        const valid = validSample && !isDeafened && hasLiveAudio(item.stream);
        item.volume = valid ? item.volume * 0.65 + calcVolume(item.analyser) * 0.35 : 0;
        remoteSpeakingByUserId[peerId] = item.volume > 0.08;
        smoothedRemoteVol = Math.max(smoothedRemoteVol, item.volume);
      });

      // 滞后门限防抖判定 (Hysteresis Gate)
      if (smoothedLocalVol > 0.08) {
        localSpeakingHoldCount = 3; // 保持 3 帧 (300ms)
        if (!isCurrentlySpeaking) {
          isCurrentlySpeaking = true;
          log("Speaking", "🎤 麦克风发声中 (音量: " + smoothedLocalVol.toFixed(2) + ")");
        }
      } else {
        if (localSpeakingHoldCount > 0) {
          localSpeakingHoldCount--;
        } else if (isCurrentlySpeaking) {
          isCurrentlySpeaking = false;
          log("Speaking", "🙊 停止发声");
        }
      }

      const isRemoteSpeaking = smoothedRemoteVol > 0.08;

      postMsg("VOICE_STATS", {
        localVolume: smoothedLocalVol,
        isLocalSpeaking: isCurrentlySpeaking,
        maxRemoteVolume: smoothedRemoteVol,
        isRemoteSpeaking: isRemoteSpeaking,
        remoteSpeakingByUserId: remoteSpeakingByUserId,
      });

      animLoopId = setTimeout(loop, 100);
    }
    loop();
  }

  function stopVolumeLoop() {
    if (animLoopId) {
      clearTimeout(animLoopId);
      animLoopId = null;
    }
    smoothedLocalVol = 0;
    smoothedRemoteVol = 0;
    localSpeakingHoldCount = 0;
    isCurrentlySpeaking = false;
  }

  function startDiagnostics() {
    if (!diagnosticsEnabled || !isConnecting || diagnosticsPolling) return;
    diagnosticsPolling = true;
    const epoch = audioRecoveryEpoch, token = diagnosticsEpoch;
    const current = function() { return diagnosticsEnabled && isConnecting && epoch === audioRecoveryEpoch && token === diagnosticsEpoch; };
    async function poll() {
      if (!current()) return;
      let report = null;
      try { if (pc && pc.getStats) report = await pc.getStats(); } catch(e) {}
      if (!current()) return;
      const totals = { inboundBytes: null, outboundBytes: null, inboundPackets: null, inboundAudioEnergy: null };
      function add(key, value) { if (typeof value === "number" && Number.isFinite(value)) totals[key] = (totals[key] || 0) + value; }
      if (report) report.forEach(function(row) {
        if (row.kind !== "audio" && row.mediaType !== "audio") return;
        if (row.type === "inbound-rtp" && !row.isRemote) {
          add("inboundBytes", row.bytesReceived); add("inboundPackets", row.packetsReceived);
          add("inboundAudioEnergy", row.totalAudioEnergy);
        } else if (row.type === "outbound-rtp" && !row.isRemote) add("outboundBytes", row.bytesSent);
      });
      postMsg("VOICE_DIAGNOSTICS", Object.assign(totals, {
        connectionEpoch: epoch, statsSupported: !!report,
        audioState: audioCtx ? audioCtx.state : "absent", audioCurrentTime: audioCtx ? audioCtx.currentTime : null,
        systemInterrupted: systemInterrupted, remoteStreams: peerAudioNodes.size, maxRemoteVolume: smoothedRemoteVol
      }));
      diagnosticsTimer = setTimeout(poll, 1000);
    }
    poll();
  }

  function stopDiagnostics() {
    diagnosticsEpoch++;
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = null;
    diagnosticsPolling = false;
  }

  async function rpc(method, params, silent, retries = 2) {
    const host = DEFAULT_VOICE_HOST;
    if (!silent) {
      log("RPC", "发送 " + method);
    }
    const epoch = audioRecoveryEpoch;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!isConnecting || epoch !== audioRecoveryEpoch) throw new Error("语音请求已取消");
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (controller) rpcControllers.add(controller);
      try {
        const response = await fetch(host + "/kraken", {
          method: "POST",
          signal: controller ? controller.signal : undefined,
          mode: "cors",
          credentials: "omit",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ id: generateUUID(), method: method, params: params || [] })
        });
        if (!response.ok) {
          throw new Error("RPC " + method + " HTTP 错误: " + response.status);
        }
        const data = await response.json();
        if (data.error) throw new Error("RPC " + method + " failed" +
          (typeof data.error.code === "number" ? " (" + data.error.code + ")" : ""));
        return data;
      } catch (err) {
        if (attempt === retries) {
          throw err;
        }
        if (!isConnecting || epoch !== audioRecoveryEpoch) throw err;
        await new Promise(r => setTimeout(r, 600));
      } finally {
        if (controller) rpcControllers.delete(controller);
      }
    }
  }

  async function reconnectSFU() {
    if (isReconnecting || !isConnecting || !lastRoomId) return;
    postMsg("VOICE_STATUS", { status: "reconnecting" });
    const pending = window.__voiceClient.join(lastRoomId, lastUserId, lastUserName, sessionId);
    const epoch = audioRecoveryEpoch;
    isReconnecting = true;
    try { await pending; }
    finally { if (epoch === audioRecoveryEpoch) isReconnecting = false; }
  }

  window.__voiceClient = {
    join: async function(roomId, userId, userName, requestedSessionId) {
      this.cleanup();
      sessionId = requestedSessionId;
      isConnecting = true;
      const epoch = audioRecoveryEpoch;
      const current = function() { return isConnecting && epoch === audioRecoveryEpoch; };
      connectionTimer = setTimeout(function() {
        if (!current()) return;
        voiceStatus = "error";
        postMsg("VOICE_ERROR", { message: "语音连接超时，请重试" });
        window.__voiceClient.cleanup();
      }, 15000);
      try {
        if (!roomId) {
          throw new Error("房间号为空");
        }
        lastRoomId = roomId;
        lastUserId = userId;
        lastUserName = userName;
        log("Join", "正在加入语音频道: yiqikan_" + roomId);
        voiceStatus = "connecting";
        postMsg("VOICE_STATUS", { status: "connecting" });
        isConnecting = true;
        pendingCandidates = [];
        lastOfferFingerprint = "";
        ucid = "";

        myUid = userId || generateUUID();
        rnameRPC = fixedEncodeURIComponent("yiqikan_" + roomId);
        unameRPC = fixedEncodeURIComponent(myUid + ":" + btoa(encodeURIComponent(userName || "User")));

        // 1. 获取 TURN
        log("TURN", "正在获取中继服务器列表...");
        let turnRes = null;
        try {
          turnRes = await rpc("turn", [unameRPC]);
        } catch(turnErr) {
          log("WARN", "TURN 获取失败，使用默认配置");
        }

        if (!current()) return;
        const configuration = {
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require",
          sdpSemantics: "unified-plan"
        };
        if (turnRes && turnRes.data && Array.isArray(turnRes.data) && turnRes.data.length > 0) {
          configuration.iceServers = turnRes.data;
          configuration.iceTransportPolicy = "relay";
          log("TURN", "已成功获取 " + turnRes.data.length + " 个中继服务器");
        }

        // 2. 初始化 RTCPeerConnection
        const connection = new RTCPeerConnection(configuration);
        pc = connection;

        pc.onicecandidate = function(e) {
          if (!current() || pc !== connection || !e.candidate) return;
          if (ucid) {
            rpc("trickle", [rnameRPC, unameRPC, ucid, JSON.stringify(e.candidate)], true).catch(function() {});
          } else {
            pendingCandidates.push(e.candidate);
          }
        };

        pc.oniceconnectionstatechange = function() {
          if (!current() || pc !== connection) return;
          const state = pc.iceConnectionState;
          log("ICE", "⚡ ICE 连接状态变更: " + state);

          if (state === "disconnected") {
            postMsg("VOICE_ICE_STATE", { state: "disconnected" });
            postMsg("VOICE_STATUS", { status: "reconnecting" });
            if (iceDisconnectTimer) clearTimeout(iceDisconnectTimer);
            // 3.5秒自愈等待窗口，若仍未恢复则主动触发 SFU 重连
            iceDisconnectTimer = setTimeout(function() {
              if (current() && pc === connection && connection.iceConnectionState === "disconnected") {
                log("ICE", "⚠️ ICE disconnected 持续超时，触发自动重连 SFU");
                reconnectSFU();
              }
            }, 3500);
          } else if (state === "failed") {
            if (iceDisconnectTimer) clearTimeout(iceDisconnectTimer);
            iceDisconnectTimer = null;
            postMsg("VOICE_ICE_STATE", { state: "failed" });
            postMsg("VOICE_STATUS", { status: "reconnecting" });
            log("ICE", "❌ ICE 连接失败 (failed)，立即触发自动重连 SFU");
            reconnectSFU();
          } else if (state === "connected" || state === "completed") {
            if (connectionTimer) clearTimeout(connectionTimer);
            connectionTimer = null;
            if (iceDisconnectTimer) {
              clearTimeout(iceDisconnectTimer);
              iceDisconnectTimer = null;
            }
            voiceStatus = "connected";
            postMsg("VOICE_ICE_STATE", { state: "connected" });
            postMsg("VOICE_STATUS", { status: "connected" });
          }
        };

        pc.onconnectionstatechange = function() {
          if (!current() || pc !== connection) return;
          const state = pc.connectionState;
          log("PeerConn", "⚡ PeerConnection 状态: " + state);
          if (state === "failed") {
            reconnectSFU();
          }
        };

        pc.ontrack = function(event) {
          if (!current() || pc !== connection) return;
          const stream = event.streams[0];
          if (!stream) return;

          // 1. 严格过滤本地麦克风音轨自身的 SFU 环回
          if (localStream) {
            const localTracks = localStream.getAudioTracks();
            for (let i = 0; i < localTracks.length; i++) {
              if (localTracks[i].id === event.track.id) {
                log("Track", "忽略本地音轨回传: " + event.track.id);
                return;
              }
            }
          }

          // 2. 健壮匹配 remotePeerId（支持 uid 包含冒号，如 socket:xxx）
          const rawId = decodeURIComponent(stream.id.replace(/\\+/g, " "));
          const lastColonIdx = rawId.lastIndexOf(":");
          const remotePeerId = lastColonIdx !== -1 ? rawId.slice(0, lastColonIdx) : rawId;

          if (remotePeerId === myUid || rawId.startsWith(myUid + ":")) {
            log("Track", "忽略自身远端流镜像: " + myUid);
            return;
          }

          log("Track", "🔊 收到远端成员音频流: " + remotePeerId);

          // Keep voice in Web Audio to avoid a competing HTML media player.
          // Web Audio still participates in WebKit's audio-session lifecycle.
          try {
            const ctx = getAudioContext();
            if (ctx) attachRemoteAudio(remotePeerId, stream, ctx);
          } catch(e) {
            log("WARN", "Web Audio 混音管道初始化异常: " + e.message);
          }
        };

        // 3. 获取麦克风流
        log("Mic", "正在初始化本地麦克风设备...");
        try {
          const capturedStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: false
          });
          if (!current() || pc !== connection) {
            capturedStream.getTracks().forEach(function(track) { track.stop(); });
            return;
          }
          localStream = capturedStream;
          const track = localStream.getAudioTracks()[0];
          log("Mic", "✅ 麦克风已就绪 (" + (track ? track.label : "Default Track") + ")");
        } catch(micErr) {
          if (!current()) return;
          log("ERROR", "麦克风获取失败: " + micErr.name);
          let errorTip = "无法获取麦克风权限，请在手机系统设置中允许录音权限";
          if (micErr.name === "NotAllowedError" || micErr.name === "PermissionDeniedError") {
            errorTip = "麦克风权限被拒绝，请在手机系统设置中开启权限";
          }
          voiceStatus = "error";
          postMsg("VOICE_ERROR", { message: errorTip });
          this.cleanup();
          return;
        }

        localStream.getTracks().forEach(function(track) {
          track.enabled = !isMuted;
          pc.addTrack(track, localStream);
        });

        // Local Analyser
        try {
          const ctx = getAudioContext();
          if (ctx) {
            localSource = ctx.createMediaStreamSource(localStream);
            localAnalyser = ctx.createAnalyser();
            localAnalyser.fftSize = 256;
            localAnalyser.smoothingTimeConstant = 0.4;
            localSource.connect(localAnalyser);
          }
        } catch(e) {}

        startVolumeLoop();
        startDiagnostics();

        // 4. 发送 Offer 至 SFU
        log("SFU", "正在向语音服务器发布本地音轨...");
        const offer = await connection.createOffer();
        if (!current()) return;
        await connection.setLocalDescription(offer);
        if (!current()) return;

        const pubRes = await rpc("publish", [rnameRPC, unameRPC, JSON.stringify(connection.localDescription)]);
        if (!current()) return;
        if (pubRes && pubRes.data && pubRes.data.jsep) {
          const jsep = JSON.parse(pubRes.data.jsep);
          await connection.setRemoteDescription(jsep);
          if (!current()) return;
          ucid = pubRes.data.track || "";
          log("SFU", "✅ 本地音轨发布成功 (UCID: " + ucid.slice(0, 8) + "...)");

          // 补发暂存候选者
          if (pendingCandidates.length > 0) {
            pendingCandidates.forEach(function(cand) {
              rpc("trickle", [rnameRPC, unameRPC, ucid, JSON.stringify(cand)], true).catch(function() {});
            });
            pendingCandidates = [];
          }
        } else {
          throw new Error(pubRes && pubRes.error && pubRes.error.message ? pubRes.error.message : "SFU 未返回有效 Answer");
        }

        // 5. Subscribe 轮询（精确比对音轨指纹，绝不重复 renegotiate）
        const subscribeLoop = async function() {
          if (!current() || pc !== connection) return;
          try {
            const subRes = await rpc("subscribe", [rnameRPC, unameRPC, ucid], true);
            if (!current() || pc !== connection) return;
            if (subRes && subRes.data && subRes.data.jsep) {
              const remoteJsep = JSON.parse(subRes.data.jsep);
              if (remoteJsep.type === "offer") {
                const currentFingerprint = getSdpTracksFingerprint(remoteJsep.sdp);
                // 仅在真实音轨或 SSRC 变化时才重新协商
                if (currentFingerprint && currentFingerprint !== lastOfferFingerprint) {
                  log("Subscribe", "🔄 频道成员音轨变动，已同步远端音频流");
                  await connection.setRemoteDescription(remoteJsep);
                  if (!current()) return;
                  const answer = await connection.createAnswer();
                  if (!current()) return;
                  await connection.setLocalDescription(answer);
                  if (!current()) return;
                  await rpc("answer", [rnameRPC, unameRPC, ucid, JSON.stringify(answer)], true);
                  if (!current()) return;
                  // A failed Answer must retry this offer on the next poll.
                  lastOfferFingerprint = currentFingerprint;
                }
              }
            }
          } catch(e) {}

          if (current() && pc === connection) {
            subscribeTimer = setTimeout(subscribeLoop, 3000);
          }
        };

        subscribeLoop();

        // Signalling success does not prove media connectivity. ICE reports
        // connected/completed through the guarded callback above.
      } catch(err) {
        if (!current()) return;
        log("ERROR", "连接失败: " + err.message);
        voiceStatus = "error";
        postMsg("VOICE_ERROR", { message: err.message || "连接语音频道失败" });
        this.cleanup();
      }
    },

    cleanup: function() {
      isConnecting = false;
      isReconnecting = false;
      audioRecoveryEpoch++;
      stopDiagnostics();
      if (connectionTimer) clearTimeout(connectionTimer);
      connectionTimer = null;
      rpcControllers.forEach(function(controller) { controller.abort(); });
      rpcControllers.clear();
      lastSampleClock = -1;
      audioRecoveryPromise = null;
      lastRecoveryRequestAt = 0;
      lastAudioRebuildAt = 0;
      lastOutputRefreshAt = 0;
      pendingCandidates = [];
      lastOfferFingerprint = "";
      smoothedLocalVol = 0;
      smoothedRemoteVol = 0;
      localSpeakingHoldCount = 0;
      isCurrentlySpeaking = false;
      if (iceDisconnectTimer) {
        clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = null;
      }
      if (subscribeTimer) {
        clearTimeout(subscribeTimer);
        subscribeTimer = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(function(t) {
          try { t.stop(); } catch(e) {}
        });
        localStream = null;
      }
      if (pc) {
        try { pc.close(); } catch(e) {}
        pc = null;
      }
      if (localSource) {
        try { localSource.disconnect(); } catch(e) {}
        localSource = null;
      }
      if (localAnalyser) {
        try { localAnalyser.disconnect(); } catch(e) {}
        localAnalyser = null;
      }
      peerAudioNodes.forEach(function(node) {
        try {
          node.dispose();
        } catch(e) {}
      });
      peerAudioNodes.clear();
      remoteAnalysers.clear();

      stopVolumeLoop();
      if (audioCtx) {
        const previous = audioCtx;
        audioCtx = null;
        previous.onstatechange = null;
        if (previous.state !== "closed") previous.close().catch(function(e) { log("WARN", "释放 AudioContext 失败: " + e.message); });
      }
    },

    leave: function() {
      lastRoomId = "";
      lastUserId = "";
      lastUserName = "";
      this.cleanup();
      voiceStatus = "idle";
      postMsg("VOICE_STATUS", { status: "idle" });
      log("Leave", "已断开语音通话");
    },

    setDiagnosticsEnabled: function(enabled) {
      diagnosticsEnabled = !!enabled;
      stopDiagnostics();
      if (diagnosticsEnabled) startDiagnostics();
    },

    setSystemInterrupted: function(interrupted) {
      systemInterrupted = !!interrupted;
      lastAudioClockAt = Date.now();
      lastAudioClock = audioCtx ? audioCtx.currentTime : 0;
    },

    resumeAudio: async function(reason, refreshOutput) {
      const recoveryEpoch = audioRecoveryEpoch;
      try {
        await recoverAudioOutput(reason || "foreground", !!refreshOutput);
        if (recoveryEpoch !== audioRecoveryEpoch || !isConnecting) return;
        if ((voiceStatus === "connected" || voiceStatus === "reconnecting") && pc) {
          if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
            log("Resume", "⚠️ WebRTC 连接中断，触发自动重连...");
            reconnectSFU();
            return;
          }
          if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track && track.readyState === 'ended') {
              log("Resume", "⚠️ 麦克风音轨已失效，重新激活麦克风...");
              const epoch = audioRecoveryEpoch;
              navigator.mediaDevices.getUserMedia({
                audio: getAudioConstraints(),
                video: false
              }).then(function(newStream) {
                if (epoch !== audioRecoveryEpoch || !isConnecting) {
                  newStream.getTracks().forEach(function(t) { t.stop(); });
                  return;
                }
                const oldStream = localStream;
                localStream = newStream;
                const newTrack = newStream.getAudioTracks()[0];
                if (newTrack && pc) {
                  newTrack.enabled = !isMuted;
                  pc.getSenders().forEach(function(sender) {
                    if (sender.track && sender.track.kind === "audio") {
                      sender.replaceTrack(newTrack).catch(function() {});
                    }
                  });
                }
                if (oldStream) {
                  oldStream.getTracks().forEach(function(t) { t.stop(); });
                }
                const ctx = getAudioContext();
                if (ctx) {
                  if (localSource) localSource.disconnect();
                  if (localAnalyser) localAnalyser.disconnect();
                  localSource = ctx.createMediaStreamSource(newStream);
                  localAnalyser = ctx.createAnalyser();
                  localAnalyser.fftSize = 256;
                  localAnalyser.smoothingTimeConstant = 0.4;
                  localSource.connect(localAnalyser);
                }
              }).catch(function(e) { log("WARN", "重新获取麦克风失败: " + e.message); });
            }
          }
        }
      } catch(e) {
        log("WARN", "resumeAudio 执行异常: " + e.message);
      }
    },

    setMuted: function(muted) {
      isMuted = !!muted;
      if (localStream) {
        localStream.getAudioTracks().forEach(function(t) {
          t.enabled = !isMuted;
        });
      }
      log("Mute", isMuted ? "🔇 麦克风已静音" : "🎙️ 麦克风已开启");
      postMsg("VOICE_MUTE_CHANGED", { isMuted: isMuted });
    },

    setDeafened: function(deafened) {
      isDeafened = !!deafened;
      const targetVol = isDeafened ? 0 : callVolume;
      peerAudioNodes.forEach(function(node) {
        try {
          if (audioCtx) {
            node.gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
            node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, audioCtx.currentTime);
            node.gainNode.gain.linearRampToValueAtTime(targetVol, audioCtx.currentTime + 0.025);
          } else {
            node.gainNode.gain.value = targetVol;
          }
        } catch(e) {}
      });
      postMsg("VOICE_DEAFEN_CHANGED", { isDeafened: isDeafened });
    },

    setVolume: function(vol) {
      callVolume = Math.max(0, Math.min(1.0, vol));
      const targetVol = isDeafened ? 0 : callVolume;
      peerAudioNodes.forEach(function(node) {
        try {
          if (audioCtx) {
            node.gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
            node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, audioCtx.currentTime);
            node.gainNode.gain.linearRampToValueAtTime(targetVol, audioCtx.currentTime + 0.025);
          } else {
            node.gainNode.gain.value = targetVol;
          }
        } catch(e) {}
      });
      postMsg("VOICE_VOLUME_CHANGED", { volume: callVolume });
    }
  };

  postMsg("VOICE_BRIDGE_READY", {});
  log("Ready", "Voice Bridge 引擎准备就绪");
})();
</script>
</body>
</html>
`;
