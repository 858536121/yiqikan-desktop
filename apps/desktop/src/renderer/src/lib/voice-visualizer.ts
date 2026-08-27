export interface VoiceVolumeStats {
  localVolume: number; // 0.0 ~ 1.0
  isLocalSpeaking: boolean;
  maxRemoteVolume: number; // 0.0 ~ 1.0
  isRemoteSpeaking: boolean;
}

export type VoiceVisualizerCallback = (stats: VoiceVolumeStats) => void;

interface AnalyserItem {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

export class VoiceAudioVisualizer {
  private audioCtx: AudioContext | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalysers = new Map<string, AnalyserItem>();
  private animFrameId: number | null = null;
  private listeners = new Set<VoiceVisualizerCallback>();

  public isLocalSpeaking = false;
  public isRemoteSpeaking = false;
  public localVolume = 0;
  public maxRemoteVolume = 0;

  private getAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public subscribe(callback: VoiceVisualizerCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public startLocal(stream: MediaStream | null): void {
    try {
      if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      if (this.localSource) {
        try {
          this.localSource.disconnect();
        } catch { /* ignore */ }
      }

      this.localAnalyser = ctx.createAnalyser();
      this.localAnalyser.fftSize = 256;
      this.localAnalyser.smoothingTimeConstant = 0.4;

      this.localSource = ctx.createMediaStreamSource(stream);
      this.localSource.connect(this.localAnalyser);
      // NOTE: Do NOT connect to ctx.destination to avoid local echo feedback loop!

      this.startLoop();
    } catch (err) {
      console.warn("[VoiceAudioVisualizer] startLocal failed:", err);
    }
  }

  public addRemote(stream: MediaStream | null, peerId: string): void {
    try {
      if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      this.removeRemote(peerId);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      this.remoteAnalysers.set(peerId, { source, analyser });
      this.startLoop();
    } catch (err) {
      console.warn("[VoiceAudioVisualizer] addRemote failed:", err);
    }
  }

  public removeRemote(peerId: string): void {
    const item = this.remoteAnalysers.get(peerId);
    if (item) {
      try {
        item.source.disconnect();
      } catch { /* ignore */ }
      this.remoteAnalysers.delete(peerId);
    }
  }

  private calcVolume(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i];
    }
    const avg = sum / buffer.length;
    // Filter noise floor (avg < 8) and normalize 0.0 ~ 1.0
    return Math.min(1.0, Math.max(0.0, (avg - 8) / 72));
  }

  private startLoop(): void {
    if (this.animFrameId) return;
    const loop = () => {
      this.tick();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private tick(): void {
    try {
      // 1. Calculate local volume
      let localVol = 0;
      if (this.localAnalyser) {
        localVol = this.calcVolume(this.localAnalyser);
      }
      this.localVolume = localVol;
      this.isLocalSpeaking = localVol > 0.08;

      // 2. Calculate remote max volume
      let maxRemoteVol = 0;
      this.remoteAnalysers.forEach(({ analyser }) => {
        const vol = this.calcVolume(analyser);
        if (vol > maxRemoteVol) maxRemoteVol = vol;
      });
      this.maxRemoteVolume = maxRemoteVol;
      this.isRemoteSpeaking = maxRemoteVol > 0.08;

      const stats: VoiceVolumeStats = {
        localVolume: this.localVolume,
        isLocalSpeaking: this.isLocalSpeaking,
        maxRemoteVolume: this.maxRemoteVolume,
        isRemoteSpeaking: this.isRemoteSpeaking,
      };

      for (const listener of this.listeners) {
        listener(stats);
      }
    } catch (err) {
      console.warn("[VoiceAudioVisualizer] tick error:", err);
    }
  }

  public stopAll(): void {
    this.stopLoop();
    if (this.localSource) {
      try {
        this.localSource.disconnect();
      } catch { /* ignore */ }
      this.localSource = null;
    }
    this.localAnalyser = null;
    this.remoteAnalysers.forEach(({ source }) => {
      try {
        source.disconnect();
      } catch { /* ignore */ }
    });
    this.remoteAnalysers.clear();
    this.localVolume = 0;
    this.maxRemoteVolume = 0;
    this.isLocalSpeaking = false;
    this.isRemoteSpeaking = false;
  }
}
