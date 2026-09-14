import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState } from "@yiqikan/shared";
import { VoiceAudioVisualizer, type VoiceVolumeStats } from "../lib/voice-visualizer";
import { log } from "../lib/logger";

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

interface UseRoomVoiceOptions {
  room: RoomState | null;
  currentUserId: string;
  name: string;
  showToast?: (message: string) => void;
}

const CALL_VOLUME_STORAGE_KEY = "yiqikan:callVolume";
const DEFAULT_VOICE_HOST = "https://api.videotogether.cn";

function fixedEncodeURIComponent(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function fixedDecodeURIComponent(str: string): string {
  return decodeURIComponent(str.replace(/\+/g, " "));
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useRoomVoice({
  room,
  currentUserId,
  name,
  showToast,
}: UseRoomVoiceOptions) {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(true);
  const [callVolume, setCallVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem(CALL_VOLUME_STORAGE_KEY);
    return saved !== null ? Number(saved) : 100;
  });

  const [stats, setStats] = useState<VoiceVolumeStats>({
    localVolume: 0,
    isLocalSpeaking: false,
    maxRemoteVolume: 0,
    isRemoteSpeaking: false,
  });

  // Refs for WebRTC & Audio Context
  const visualizerRef = useRef<VoiceAudioVisualizer | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isConnectingRef = useRef(false);
  const subscribeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMutedRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const callVolumeRef = useRef(callVolume);

  isMutedRef.current = isMuted;
  isDeafenedRef.current = isDeafened;
  callVolumeRef.current = callVolume;

  // Initialize visualizer singleton
  if (!visualizerRef.current) {
    visualizerRef.current = new VoiceAudioVisualizer();
  }

  // Subscribe to visualizer updates
  useEffect(() => {
    const visualizer = visualizerRef.current;
    if (!visualizer) return;
    return visualizer.subscribe((newStats) => {
      setStats({ ...newStats });
    });
  }, []);

  // Update Call Volume across all audio elements
  const setCallVolume = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(100, value));
    setCallVolumeState(normalized);
    localStorage.setItem(CALL_VOLUME_STORAGE_KEY, String(normalized));

    const targetGain = isDeafenedRef.current ? 0 : normalized / 100;
    peerAudioElementsRef.current.forEach((audio) => {
      try {
        audio.volume = targetGain;
      } catch { /* ignore */ }
    });
  }, []);

  // Set Deafened
  const setDeafened = useCallback((deafened: boolean) => {
    setIsDeafened(deafened);
    const targetGain = deafened ? 0 : callVolumeRef.current / 100;
    peerAudioElementsRef.current.forEach((audio) => {
      try {
        audio.volume = targetGain;
      } catch { /* ignore */ }
    });
  }, []);

  const toggleDeafen = useCallback(() => {
    setDeafened(!isDeafenedRef.current);
  }, [setDeafened]);

  // Clean up all voice connections
  const leaveVoice = useCallback(() => {
    isConnectingRef.current = false;
    if (subscribeTimerRef.current) {
      clearTimeout(subscribeTimerRef.current);
      subscribeTimerRef.current = null;
    }

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch { /* ignore */ }
      });
      localStreamRef.current = null;
    }

    // Close RTCPeerConnection
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch { /* ignore */ }
      peerConnectionRef.current = null;
    }

    // Remove remote audio elements
    peerAudioElementsRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch { /* ignore */ }
    });
    peerAudioElementsRef.current.clear();

    // Stop Visualizer
    visualizerRef.current?.stopAll();

    setVoiceStatus("idle");
    setErrorMessage(null);
  }, []);

  // Toggle Mute
  const setMuted = useCallback((muted: boolean) => {
    setIsMuted(muted);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(!isMutedRef.current);
  }, [setMuted]);

  // Toggle Noise Cancellation
  const toggleNoiseCancellation = useCallback(async () => {
    const nextVal = !noiseCancellationEnabled;
    setNoiseCancellationEnabled(nextVal);

    if (voiceStatus !== "connected" || !peerConnectionRef.current) return;

    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: nextVal,
          noiseSuppression: nextVal,
        },
        video: false,
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const prevStream = localStreamRef.current;
      localStreamRef.current = newStream;

      const pc = peerConnectionRef.current;
      const senders = pc.getSenders();
      const newTrack = newStream.getAudioTracks()[0];

      if (newTrack) {
        newTrack.enabled = !isMutedRef.current;
        senders.forEach((sender) => {
          if (sender.track?.kind === "audio") {
            sender.replaceTrack(newTrack).catch(() => {});
          }
        });
      }

      visualizerRef.current?.startLocal(newStream);

      if (prevStream) {
        prevStream.getTracks().forEach((t) => t.stop());
      }
      showToast?.(nextVal ? "已开启语音降噪与回声消除" : "已关闭语音降噪");
    } catch (err) {
      console.warn("[useRoomVoice] toggleNoiseCancellation failed:", err);
    }
  }, [noiseCancellationEnabled, showToast, voiceStatus]);

  // Join Voice
  const joinVoice = useCallback(async () => {
    if (!room?.id) {
      setErrorMessage("请先加入房间");
      setVoiceStatus("error");
      showToast?.("请先加入房间");
      return;
    }

    if (voiceStatus === "connecting" || voiceStatus === "connected") {
      return;
    }

    leaveVoice();
    setVoiceStatus("connecting");
    setErrorMessage(null);
    isConnectingRef.current = true;

    const roomId = room.id;
    const uid = currentUserId || generateUUID();
    const voiceHost = import.meta.env.VITE_VOICE_SERVER_URL?.trim() || DEFAULT_VOICE_HOST;

    // RPC helper
    const rpc = async (method: string, params: any[] = []): Promise<any> => {
      log("info", "VoiceRPC", `[SEND] ${method}`, params);
      const desktopBridge = (window as any).yiqikan;
      if (desktopBridge?.voiceRpc) {
        try {
          const res = await desktopBridge.voiceRpc({ host: voiceHost, method, params });
          log("info", "VoiceRPC", `[RECV] ${method}`, res);
          return res;
        } catch (err: any) {
          log("error", "VoiceRPC", `[FAIL] ${method}: ${err?.message || err}`, err);
          throw err;
        }
      }

      // Fallback for web
      const response = await fetch(`${voiceHost}/kraken`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ id: generateUUID(), method, params }),
      });
      if (!response.ok) {
        throw new Error(`RPC ${method} HTTP error: ${response.status}`);
      }
      const data = await response.json();
      log("info", "VoiceRPC", `[RECV-Fetch] ${method}`, data);
      return data;
    };

    try {
      log("info", "Voice", `Joining voice channel: yiqikan_${roomId}`);
      // 1. Isolation prefix for room name
      const rnameRPC = fixedEncodeURIComponent(`yiqikan_${roomId}`);
      const unameRPC = fixedEncodeURIComponent(`${uid}:${btoa(encodeURIComponent(name || "User"))}`);
      let ucid = "";

      // 2. Fetch TURN servers
      log("info", "Voice", "Fetching TURN servers...");
      const turnRes = await rpc("turn", [unameRPC]);
      const configuration: RTCConfiguration & { sdpSemantics?: string } = {
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        sdpSemantics: "unified-plan",
      };

      if (turnRes?.data && Array.isArray(turnRes.data) && turnRes.data.length > 0) {
        configuration.iceServers = turnRes.data;
        configuration.iceTransportPolicy = "relay";
        log("info", "Voice", `Received ${turnRes.data.length} TURN servers`);
      } else {
        log("warn", "Voice", "No TURN servers returned, using default STUN");
      }

      // 3. Create RTCPeerConnection
      const pc = new RTCPeerConnection(configuration);
      peerConnectionRef.current = pc;

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && isConnectingRef.current) {
          rpc("trickle", [rnameRPC, unameRPC, ucid, JSON.stringify(candidate)]).catch(() => {});
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;

        let sid = fixedDecodeURIComponent(stream.id);
        const remotePeerId = sid.split(":")[0] || stream.id;

        if (remotePeerId === uid) {
          // Local stream echoed back, ignore
          return;
        }

        log("info", "Voice", `Received remote audio track from peer: ${remotePeerId}`);

        // Attach remote audio element
        let audioEl = peerAudioElementsRef.current.get(remotePeerId);
        if (!audioEl) {
          audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          audioEl.volume = isDeafenedRef.current ? 0 : callVolumeRef.current / 100;
          audioEl.style.display = "none";
          document.body.appendChild(audioEl);
          peerAudioElementsRef.current.set(remotePeerId, audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.play().catch((err) => {
          log("warn", "Voice", `Remote audio.play() auto-play prevented: ${err?.message}`);
        });

        // Feed into visualizer
        visualizerRef.current?.addRemote(stream, remotePeerId);

        event.track.onended = () => {
          log("info", "Voice", `Track ended from peer: ${remotePeerId}`);
          visualizerRef.current?.removeRemote(remotePeerId);
        };
        event.track.onmute = () => {
          visualizerRef.current?.removeRemote(remotePeerId);
        };
        event.track.onunmute = () => {
          visualizerRef.current?.addRemote(stream, remotePeerId);
        };
      };

      pc.oniceconnectionstatechange = () => {
        log("info", "Voice", `ICE Connection State: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          log("warn", "Voice", `ICE Connection disconnected/failed`);
        }
      };

      // 4. Capture Local Microphone
      log("info", "Voice", "Acquiring local microphone...");
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: noiseCancellationEnabled,
            noiseSuppression: noiseCancellationEnabled,
          },
          video: false,
        });
        localStreamRef.current = localStream;
        log("info", "Voice", "Microphone acquired successfully");
      } catch (micErr: any) {
        log("error", "Voice", `getUserMedia failed: ${micErr?.message || micErr}`, micErr);
        setVoiceStatus("error");
        setErrorMessage(micErr?.name === "NotAllowedError" ? "麦克风权限被拒绝，请在系统设置中允许" : "无法访问麦克风设备");
        showToast?.("麦克风访问失败，请检查系统权限");
        leaveVoice();
        return;
      }

      // Add local audio tracks to peer connection
      localStream.getTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
        pc.addTrack(track, localStream);
      });

      // Start local volume visualization
      visualizerRef.current?.startLocal(localStream);

      // 5. Publish Offer to Kraken SFU
      log("info", "Voice", "Creating and publishing WebRTC offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const pubRes = await rpc("publish", [rnameRPC, unameRPC, JSON.stringify(pc.localDescription)]);
      if (pubRes?.data?.jsep) {
        const jsep = JSON.parse(pubRes.data.jsep);
        await pc.setRemoteDescription(jsep);
        ucid = pubRes.data.track || "";
        log("info", "Voice", `Offer published successfully, ucid: ${ucid}`);
      } else {
        throw new Error(pubRes?.error?.message || "Kraken SFU 未返回有效的 Answer");
      }

      // 6. Subscribe loop for remote peers
      const subscribeLoop = async () => {
        if (!isConnectingRef.current || !peerConnectionRef.current || peerConnectionRef.current !== pc) {
          return;
        }

        try {
          const subRes = await rpc("subscribe", [rnameRPC, unameRPC, ucid]);
          if (!isConnectingRef.current || peerConnectionRef.current !== pc) return;

          if (subRes?.data?.jsep) {
            const remoteJsep = JSON.parse(subRes.data.jsep);
            if (remoteJsep.type === "offer") {
              log("info", "Voice", "Received remote subscription offer, sending answer...");
              await pc.setRemoteDescription(remoteJsep);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await rpc("answer", [rnameRPC, unameRPC, ucid, JSON.stringify(answer)]);
            }
          }
        } catch (subErr: any) {
          log("debug", "Voice", `subscribe poll error: ${subErr?.message || subErr}`);
        }

        if (isConnectingRef.current && peerConnectionRef.current === pc) {
          subscribeTimerRef.current = setTimeout(subscribeLoop, 3000);
        }
      };

      subscribeLoop();

      setVoiceStatus("connected");
      log("info", "Voice", "Voice connected successfully");
      showToast?.("已连接语音频道");
    } catch (err: any) {
      log("error", "Voice", `joinVoice failed: ${err?.message || err}`, err);
      setVoiceStatus("error");
      setErrorMessage(err?.message || "连接语音服务失败");
      showToast?.(`语音连接失败: ${err?.message || "未知错误"}`);
      leaveVoice();
    }
  }, [
    currentUserId,
    leaveVoice,
    name,
    noiseCancellationEnabled,
    room?.id,
    showToast,
    voiceStatus,
  ]);

  // Automatically leave voice when leaving the room
  useEffect(() => {
    if (!room) {
      leaveVoice();
    }
  }, [leaveVoice, room]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      leaveVoice();
    };
  }, [leaveVoice]);

  return {
    voiceStatus,
    errorMessage,
    isMuted,
    isDeafened,
    callVolume,
    noiseCancellationEnabled,
    stats,
    joinVoice,
    leaveVoice,
    setMuted,
    toggleMute,
    setDeafened,
    toggleDeafen,
    setCallVolume,
    toggleNoiseCancellation,
  };
}
