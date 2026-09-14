import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { SyncWebviewElement } from "../types/sync";

interface UseAudioBoostOptions {
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  webviewReady: boolean;
  localVolume: number;
}

export type AudioBoostStatus = "normal" | "starting" | "boosting" | "unavailable" | "failed";

const MAX_BOOST_GAIN = 8;

export function useAudioBoost({
  webviewRef,
  webviewReady,
  localVolume,
}: UseAudioBoostOptions) {
  const [status, setStatus] = useState<AudioBoostStatus>("normal");

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) {
      setStatus(localVolume > 100 ? "unavailable" : "normal");
      return;
    }

    const vol = Math.max(0, Math.min(MAX_BOOST_GAIN, localVolume / 100));

    if (vol <= 1) {
      wv.send("yiqikan:set-volume", { volume: vol });
      setStatus("normal");
      return;
    }

    wv.send("yiqikan:set-volume", { volume: vol });
    setStatus("boosting");
  }, [localVolume, webviewReady, webviewRef]);

  return status;
}
