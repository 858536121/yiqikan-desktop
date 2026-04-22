import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { SyncWebviewElement } from "../types/sync";

type DesktopBridge = {
  getWebviewMediaSourceId: () => Promise<string | null>;
};

interface UseAudioBoostOptions {
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  webviewReady: boolean;
  videoDetected: boolean;
  localVolume: number;
  desktopBridge: DesktopBridge;
}

export function useAudioBoost({
  webviewRef,
  webviewReady,
  videoDetected,
  localVolume,
  desktopBridge,
}: UseAudioBoostOptions) {
  const audioBoostRef = useRef<{
    ctx: AudioContext;
    gain: GainNode;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (audioBoostRef.current) {
        audioBoostRef.current.ctx.close().catch(() => {});
        audioBoostRef.current.stream.getTracks().forEach((t) => t.stop());
        audioBoostRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;

    const vol = localVolume / 100;

    if (vol <= 1) {
      if (audioBoostRef.current) {
        audioBoostRef.current.ctx.close().catch(() => {});
        audioBoostRef.current.stream.getTracks().forEach((t) => t.stop());
        audioBoostRef.current = null;
      }
      wv.send("yiqikan:set-volume", { volume: vol });
      return;
    }

    wv.send("yiqikan:set-volume", { volume: 1 });

    if (audioBoostRef.current) {
      audioBoostRef.current.gain.gain.value = vol;
      return;
    }

    (async () => {
      try {
        const mediaSourceId = await desktopBridge.getWebviewMediaSourceId();
        if (!mediaSourceId) return;

        const stream = await (navigator.mediaDevices as any).getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: mediaSourceId,
            },
          },
          video: false,
        });

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = vol;
        source.connect(gain);
        gain.connect(ctx.destination);

        audioBoostRef.current = { ctx, gain, stream, source };
      } catch (err) {
        console.warn("[yiqikan] audio boost capture failed:", err);
      }
    })();
  }, [localVolume, webviewReady, videoDetected, desktopBridge, webviewRef]);
}
