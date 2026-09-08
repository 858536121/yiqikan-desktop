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
  let isMuted = false;
  let isDeafened = false;
  let callVolume = 1.0;
  let noiseCancellation = true;

  let pc = null;
  let localStream = null;
  let peerAudioElements = new Map();
  let isConnecting = false;
  let subscribeTimer = null;
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
  
  let smoothedLocalVol = 0;
  let smoothedRemoteVol = 0;
  let localSpeakingHoldCount = 0;
  let isCurrentlySpeaking = false;

  function log(tag, msg, extra) {
    postMsg("VOICE_LOG", { tag: tag, message: msg, extra: extra || null });
  }

  function postMsg(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
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
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(function() {});
    }
    return audioCtx;
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

  function startVolumeLoop() {
    if (animLoopId) return;

    function loop() {
      let rawLocalVol = 0;
      let rawRemoteVol = 0;

      if (localAnalyser && !isMuted) {
        rawLocalVol = calcVolume(localAnalyser);
      }

      if (!isDeafened) {
        remoteAnalysers.forEach(function(item) {
          const vol = calcVolume(item.analyser);
          if (vol > rawRemoteVol) rawRemoteVol = vol;
        });
      }

      // 指数移动平均平滑滤波 (EMA Smoothing)
      smoothedLocalVol = smoothedLocalVol * 0.65 + rawLocalVol * 0.35;
      smoothedRemoteVol = smoothedRemoteVol * 0.65 + rawRemoteVol * 0.35;

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
    if (localSource) {
      try { localSource.disconnect(); } catch(e) {}
      localSource = null;
    }
    localAnalyser = null;
    remoteAnalysers.forEach(function(item) {
      try { item.source.disconnect(); } catch(e) {}
    });
    remoteAnalysers.clear();
    smoothedLocalVol = 0;
    smoothedRemoteVol = 0;
    localSpeakingHoldCount = 0;
    isCurrentlySpeaking = false;
  }

  let lastRoomId = "";
  let lastUserId = "";
  let lastUserName = "";

  async function rpc(method, params, silent, retries = 2) {
    const host = DEFAULT_VOICE_HOST;
    if (!silent) {
      log("RPC", "发送 " + method);
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(host + "/kraken", {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ id: generateUUID(), method: method, params: params || [] })
        });
        if (!response.ok) {
          throw new Error("RPC " + method + " HTTP 错误: " + response.status);
        }
        const data = await response.json();
        return data;
      } catch (err) {
        if (attempt === retries) {
          throw err;
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }

  window.__voiceClient = {
    join: async function(roomId, userId, userName) {
      try {
        if (!roomId) {
          throw new Error("房间号为空");
        }
        lastRoomId = roomId;
        lastUserId = userId;
        lastUserName = userName;
        log("Join", "正在加入语音频道: yiqikan_" + roomId);
        this.cleanup();

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
        pc = new RTCPeerConnection(configuration);

        pc.onicecandidate = function(e) {
          if (!e.candidate || !isConnecting) return;
          if (ucid) {
            rpc("trickle", [rnameRPC, unameRPC, ucid, JSON.stringify(e.candidate)], true).catch(function() {});
          } else {
            pendingCandidates.push(e.candidate);
          }
        };

        pc.ontrack = function(event) {
          const stream = event.streams[0];
          if (!stream) return;
          const rawId = decodeURIComponent(stream.id.replace(/\\+/g, " "));
          const remotePeerId = rawId.split(":")[0] || stream.id;

          if (remotePeerId === myUid) return;

          log("Track", "🔊 收到远端成员音频流: " + remotePeerId);

          let audioEl = peerAudioElements.get(remotePeerId);
          if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            audioEl.volume = isDeafened ? 0 : callVolume;
            audioEl.style.display = "none";
            document.body.appendChild(audioEl);
            peerAudioElements.set(remotePeerId, audioEl);
          }
          audioEl.srcObject = stream;
          audioEl.play().catch(function(err) {
            log("WARN", "音频播放被系统拦截", err.message);
          });

          // Analyser
          try {
            const ctx = getAudioContext();
            if (ctx) {
              const src = ctx.createMediaStreamSource(stream);
              const ana = ctx.createAnalyser();
              ana.fftSize = 256;
              ana.smoothingTimeConstant = 0.4;
              src.connect(ana);
              remoteAnalysers.set(remotePeerId, { source: src, analyser: ana });
            }
          } catch(e) {}
        };

        // 3. 获取麦克风流
        log("Mic", "正在初始化本地麦克风设备...");
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: noiseCancellation,
              noiseSuppression: noiseCancellation
            },
            video: false
          });
          const track = localStream.getAudioTracks()[0];
          log("Mic", "✅ 麦克风已就绪 (" + (track ? track.label : "Default Track") + ")");
        } catch(micErr) {
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

        // 4. 发送 Offer 至 SFU
        log("SFU", "正在向语音服务器发布本地音轨...");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const pubRes = await rpc("publish", [rnameRPC, unameRPC, JSON.stringify(pc.localDescription)]);
        if (pubRes && pubRes.data && pubRes.data.jsep) {
          const jsep = JSON.parse(pubRes.data.jsep);
          await pc.setRemoteDescription(jsep);
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
          if (!isConnecting || !pc) return;
          try {
            const subRes = await rpc("subscribe", [rnameRPC, unameRPC, ucid], true);
            if (!isConnecting || !pc) return;
            if (subRes && subRes.data && subRes.data.jsep) {
              const remoteJsep = JSON.parse(subRes.data.jsep);
              if (remoteJsep.type === "offer") {
                const currentFingerprint = getSdpTracksFingerprint(remoteJsep.sdp);
                // 仅在真实音轨或 SSRC 变化时才重新协商
                if (currentFingerprint && currentFingerprint !== lastOfferFingerprint) {
                  lastOfferFingerprint = currentFingerprint;
                  log("Subscribe", "🔄 频道成员音轨变动，已同步远端音频流");
                  await pc.setRemoteDescription(remoteJsep);
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  await rpc("answer", [rnameRPC, unameRPC, ucid, JSON.stringify(answer)], true);
                }
              }
            }
          } catch(e) {}

          if (isConnecting && pc) {
            subscribeTimer = setTimeout(subscribeLoop, 3000);
          }
        };

        subscribeLoop();

        voiceStatus = "connected";
        log("Success", "🟢 实时语音连接成功");
        postMsg("VOICE_STATUS", { status: "connected" });
      } catch(err) {
        log("ERROR", "连接失败: " + err.message);
        voiceStatus = "error";
        postMsg("VOICE_ERROR", { message: err.message || "连接语音频道失败" });
        this.cleanup();
      }
    },

    cleanup: function() {
      isConnecting = false;
      pendingCandidates = [];
      lastOfferFingerprint = "";
      smoothedLocalVol = 0;
      smoothedRemoteVol = 0;
      localSpeakingHoldCount = 0;
      isCurrentlySpeaking = false;
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
      peerAudioElements.forEach(function(el) {
        try {
          el.pause();
          el.srcObject = null;
          el.remove();
        } catch(e) {}
      });
      peerAudioElements.clear();

      stopVolumeLoop();
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

    resumeAudio: function() {
      try {
        log("Resume", "🔄 尝试唤醒 WebRTC 音频引擎与 AudioContext...");
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume().catch(function() {});
        }
        peerAudioElements.forEach(function(el) {
          if (el && el.paused && el.srcObject) {
            el.play().catch(function() {});
          }
        });
        if (voiceStatus === "connected" && pc) {
          if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            log("Resume", "⚠️ WebRTC ICE 连接中断，触发自动重连...");
            if (lastRoomId) {
              window.__voiceClient.join(lastRoomId, lastUserId, lastUserName);
              return;
            }
          }
          if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track && track.readyState === 'ended') {
              log("Resume", "⚠️ 麦克风音轨已失效，重新激活麦克风...");
              navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: noiseCancellation, noiseSuppression: noiseCancellation },
                video: false
              }).then(function(newStream) {
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
              }).catch(function() {});
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
      peerAudioElements.forEach(function(el) {
        try { el.volume = targetVol; } catch(e) {}
      });
      postMsg("VOICE_DEAFEN_CHANGED", { isDeafened: isDeafened });
    },

    setVolume: function(vol) {
      callVolume = Math.max(0, Math.min(1.0, vol));
      const targetVol = isDeafened ? 0 : callVolume;
      peerAudioElements.forEach(function(el) {
        try { el.volume = targetVol; } catch(e) {}
      });
      postMsg("VOICE_VOLUME_CHANGED", { volume: callVolume });
    },

    toggleNoiseCancellation: async function(enabled) {
      noiseCancellation = !!enabled;
      if (voiceStatus === "connected" && localStream && pc) {
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { 
              echoCancellation: noiseCancellation, 
              noiseSuppression: noiseCancellation
            },
            video: false
          });
          const oldStream = localStream;
          localStream = newStream;

          const senders = pc.getSenders();
          const newTrack = newStream.getAudioTracks()[0];
          if (newTrack) {
            newTrack.enabled = !isMuted;
            senders.forEach(function(sender) {
              if (sender.track && sender.track.kind === "audio") {
                sender.replaceTrack(newTrack).catch(function() {});
              }
            });
          }
          if (oldStream) {
            oldStream.getTracks().forEach(function(t) { t.stop(); });
          }
        } catch(e) {}
      }
      postMsg("VOICE_NOISE_CHANGED", { noiseCancellation: noiseCancellation });
    }
  };

  postMsg("VOICE_BRIDGE_READY", {});
  log("Ready", "Voice Bridge 引擎准备就绪");
})();
</script>
</body>
</html>
`;
