export const MAX_VIDEO_VOLUME = 1000;

export type VideoVolumeResult =
  | { status: "normal" | "waiting" | "unavailable" }
  | { status: "boosting"; gain: number };

type CaptureElement = HTMLMediaElement & { captureStream?: () => MediaStream };

const hasLiveAudio = (stream: MediaStream) =>
  stream.getAudioTracks().some((track) => track.readyState === "live" && !track.muted);

const COMPRESSOR_THRESHOLD_DB = -2.5;
const MAX_BOOST_THRESHOLD_DB = -1.6;
const COMPRESSOR_RATIO = 16;
const MAX_EXTRA_BOOST_DB = 9;

function compressorOutputGain(threshold: number) {
  // Cancel Web Audio's automatic makeup gain at each threshold.
  return 10 ** (threshold * (1 - 1 / COMPRESSOR_RATIO) * 0.6 / 20);
}

function makeLimiterCurve() {
  const curve = new Float32Array(1025);
  const knee = 0.985;
  const headroom = 0.035;
  for (let index = 0; index < curve.length; index++) {
    const sample = 2 * index / (curve.length - 1) - 1;
    const level = Math.abs(sample);
    curve[index] = level <= knee ? sample : Math.sign(sample) * (knee + headroom * Math.tanh((level - knee) / headroom));
  }
  return curve;
}

export function createVideoVolume(report: (result: VideoVolumeResult) => void) {
  let context: AudioContext | undefined;
  let disposeRoute: (() => void) | undefined;
  let updateGain: ((gain: number) => void) | undefined;
  let element: CaptureElement | null = null;
  let sourceUrl = "";
  let requested = 100;
  let status: VideoVolumeResult["status"] = "normal";

  function reportStatus(result: VideoVolumeResult) {
    if (status === result.status && (status === "waiting" || status === "unavailable")) return;
    status = result.status;
    report(result);
  }

  function releaseRoute() {
    disposeRoute?.();
    disposeRoute = undefined;
    updateGain = undefined;
  }

  function start(media: CaptureElement) {
    let stream: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    const probes: AudioNode[] = [];
    let gain: GainNode | undefined;
    let compressor: DynamicsCompressorNode | undefined;
    let compressorOutput: GainNode | undefined;
    let limiter: WaveShaperNode | undefined;
    let timer: number | undefined;
    let nativeVolume: number | undefined;
    const listeners = new AbortController();
    const { signal } = listeners;

    disposeRoute = () => {
      listeners.abort();
      window.clearTimeout(timer);
      source?.disconnect();
      probes.forEach((node) => node.disconnect());
      gain?.disconnect();
      compressor?.disconnect();
      compressorOutput?.disconnect();
      limiter?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (nativeVolume !== undefined && media.volume === 0) media.volume = nativeVolume;
    };

    function fail() {
      releaseRoute();
      reportStatus({ status: "unavailable" });
    }

    function waitForMedia() {
      releaseRoute();
      reportStatus({ status: "waiting" });
    }

    try {
      stream = media.captureStream?.();
      if (!stream || !stream.getAudioTracks().length) {
        fail();
        return;
      }
      stream.getVideoTracks().forEach((track) => track.stop());
      const audioStream = new MediaStream(stream.getAudioTracks());
      const audio = context ??= new AudioContext();
      const input = source = audio.createMediaStreamSource(audioStream);
      // AnalyserNode downmixes to mono. Inspect the channels separately so
      // stereo samples with opposite polarity still count as audible.
      const stereo = new GainNode(audio, { channelCount: 2, channelCountMode: "explicit" });
      const split = new ChannelSplitterNode(audio, { numberOfOutputs: 2 });
      probes.push(stereo, split);
      input.connect(stereo).connect(split);
      const analysers = [0, 1].map((channel) => {
        const analyser = new AnalyserNode(audio, { fftSize: 1024 });
        probes.push(analyser);
        split.connect(analyser, channel);
        return analyser;
      });
      const amplifier = gain = audio.createGain();
      const peakCompressor = compressor = new DynamicsCompressorNode(audio, {
        threshold: COMPRESSOR_THRESHOLD_DB,
        knee: 0,
        ratio: COMPRESSOR_RATIO,
        attack: 0.002,
        release: 0.14,
      });
      const trim = compressorOutput = new GainNode(audio, { gain: compressorOutputGain(COMPRESSOR_THRESHOLD_DB) });
      const output = limiter = audio.createWaveShaper();
      output.curve = makeLimiterCurve();
      amplifier.connect(peakCompressor);
      peakCompressor.connect(trim);
      trim.connect(output);
      output.connect(audio.destination);

      const reportApplied = (level: number) => reportStatus({
        status: "boosting", gain: level,
      });

      function applyGain(level: number, immediate = false) {
        // Ramp the ceiling evenly in dB above 2× while leaving lower levels alone.
        const progress = Math.log(Math.max(2, level) / 2) / Math.log(MAX_VIDEO_VOLUME / 200);
        const threshold = COMPRESSOR_THRESHOLD_DB + progress * (MAX_BOOST_THRESHOLD_DB - COMPRESSOR_THRESHOLD_DB);
        const inputGain = media.muted ? 0 : level * 10 ** (progress * MAX_EXTRA_BOOST_DB / 20);
        if (immediate) {
          amplifier.gain.value = inputGain;
          peakCompressor.threshold.value = threshold;
          trim.gain.value = compressorOutputGain(threshold);
          return;
        }
        const now = audio.currentTime;
        amplifier.gain.setTargetAtTime(inputGain, now, 0.02);
        peakCompressor.threshold.setTargetAtTime(threshold, now, 0.02);
        trim.gain.setTargetAtTime(compressorOutputGain(threshold), now, 0.02);
        reportApplied(level);
      }

      // A muted or ended capture can no longer supply audio. Restore native
      // playback immediately, including when the site reuses this element.
      for (const track of audioStream.getAudioTracks()) {
        track.addEventListener("ended", waitForMedia, { signal });
        track.addEventListener("mute", () => {
          if (nativeVolume !== undefined && !media.paused) fail();
        }, { signal });
      }
      stream.addEventListener("addtrack", (event) => {
        if (event.track.kind === "audio" && !audioStream.getAudioTracks().includes(event.track)) waitForMedia();
      }, { signal });
      media.addEventListener("emptied", waitForMedia, { signal });
      audio.addEventListener("statechange", () => {
        if (nativeVolume !== undefined && audio.state !== "running") fail();
      }, { signal });
      media.addEventListener("volumechange", () => {
        if (nativeVolume === undefined) return;
        if (media.volume !== 0) fail();
        else applyGain(requested / 100);
      }, { signal });
      media.addEventListener("playing", () => {
        if (nativeVolume !== undefined && !hasLiveAudio(audioStream)) waitForMedia();
      }, { signal });

      const samples = new Float32Array(1024);
      const deadline = performance.now() + 2500;
      function confirmOutput() {
        if (signal.aborted) return;
        if (audio.state === "running" && hasLiveAudio(audioStream)) {
          const hasSignal = analysers.some((analyser) => {
            analyser.getFloatTimeDomainData(samples);
            return samples.some((sample) => Math.abs(sample) > 0.00001);
          });
          if (hasSignal) {
            try {
              applyGain(requested / 100, true);
              nativeVolume = media.volume;
              input.connect(amplifier);
              stereo.disconnect();
              media.volume = 0;
              if (media.volume !== 0) {
                fail();
                return;
              }
              updateGain = (level) => applyGain(level);
              reportApplied(requested / 100);
            } catch {
              fail();
            }
            return;
          }
        }
        if (performance.now() >= deadline) fail();
        else timer = window.setTimeout(confirmOutput, 50);
      }
      reportStatus({ status: "waiting" });
      void audio.resume().catch(() => { if (!signal.aborted) fail(); });
      confirmOutput();
    } catch {
      fail();
    }
  }

  return {
    set(media: CaptureElement | null, volume: number) {
      const next = Math.max(0, Math.min(MAX_VIDEO_VOLUME, volume));
      const url = media?.currentSrc ?? "";
      const changed = media !== element || url !== sourceUrl;
      const adjusted = requested !== next;
      if (changed || next <= 100) releaseRoute();
      element = media;
      sourceUrl = url;
      requested = next;
      if (!media) {
        reportStatus({ status: "unavailable" });
      } else if (next <= 100) {
        if (changed || adjusted || status !== "normal") {
          try {
            media.volume = next / 100;
            reportStatus({ status: media.volume === next / 100 ? "normal" : "unavailable" });
          } catch {
            reportStatus({ status: "unavailable" });
          }
        }
      } else if (updateGain) {
        if (adjusted) updateGain(next / 100);
      } else if (changed || adjusted || (status === "waiting" && !disposeRoute)) {
        if (media.readyState < 2 || media.paused) reportStatus({ status: "waiting" });
        else start(media);
      }
    },
    retry() {
      if (status === "unavailable") status = "waiting";
    },
    clear() {
      releaseRoute();
      element = null;
      sourceUrl = "";
      status = "normal";
    },
    dispose() {
      releaseRoute();
      if (context && context.state !== "closed") void context.close().catch(() => {});
    },
  };
}
