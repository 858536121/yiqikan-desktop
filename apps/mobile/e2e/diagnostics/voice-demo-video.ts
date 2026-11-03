export const DEFAULT_DEMO_VIDEO = 'https://media.w3.org/2010/05/sintel/trailer.mp4';

// Passive probe: never resumes a paused video or broadcasts room playback.
export const VOICE_DEMO_VIDEO_PROBE = `
(function() {
  if (window.__voiceDemoVideo) return;
  var ids = new WeakMap(), bound = new WeakSet(), counter = 0;
  var documentId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var micProbeId = null, micProbeStream = null, micProbeEpoch = 0;
  function micMessage(id, state, error) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'DEMO_MIC_PROBE', payload: { id: id, state: state, error: error }
    }));
  }
  function stopMicrophoneProbe(id) {
    if (id !== undefined && id !== micProbeId) return;
    micProbeEpoch++; micProbeId = null;
    if (micProbeStream) micProbeStream.getTracks().forEach(function(track) { track.stop(); });
    micProbeStream = null;
  }
  function selected() {
    var candidates = Array.from(document.querySelectorAll('video')).filter(function(v) {
      var r = v.getBoundingClientRect(); return r.width > 40 && r.height > 30;
    });
    candidates.sort(function(a, b) {
      var ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    return candidates[0] || null;
  }
  function send(event) {
    var video = selected();
    if (!window.ReactNativeWebView) return;
    if (!video) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DEMO_NO_VIDEO' })); return;
    }
    if (!ids.has(video)) ids.set(video, documentId + ':' + (++counter));
    var quality = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    var frames = quality && Number.isFinite(quality.totalVideoFrames) ? quality.totalVideoFrames :
      (Number.isFinite(video.webkitDecodedFrameCount) ? video.webkitDecodedFrameCount : null);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DEMO_VIDEO', payload: {
      id: ids.get(video), currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused, ended: video.ended, muted: video.muted, volume: video.volume,
      playbackRate: video.playbackRate, readyState: video.readyState, frames: frames, event: event
    } }));
  }
  function scan() {
    document.querySelectorAll('video').forEach(function(video) {
      if (bound.has(video)) return;
      bound.add(video);
      ['play','playing','pause','waiting','stalled','ended','error','seeking','seeked','volumechange','ratechange'].forEach(function(name) {
        video.addEventListener(name, function() { if (video === selected()) send(name); });
      });
    });
    send('sample');
  }
  window.__voiceDemoVideo = {
    startMicrophoneProbe: async function(id) {
      stopMicrophoneProbe();
      micProbeId = id;
      var epoch = micProbeEpoch;
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true
        }, video: false });
        if (epoch !== micProbeEpoch || micProbeId !== id) {
          stream.getTracks().forEach(function(track) { track.stop(); }); return;
        }
        micProbeStream = stream;
        stream.getAudioTracks().forEach(function(track) {
          track.addEventListener('ended', function() {
            if (epoch !== micProbeEpoch || micProbeId !== id) return;
            stopMicrophoneProbe(id); micMessage(id, 'error', 'TrackEnded');
          });
        });
        micMessage(id, 'active');
      } catch(error) {
        if (epoch !== micProbeEpoch || micProbeId !== id) return;
        stopMicrophoneProbe(id); micMessage(id, 'error', error.name || 'Error');
      }
    },
    stopMicrophoneProbe: stopMicrophoneProbe,
    command: function(action) {
      var video = selected(); if (!video) return;
      if (action === 'play') video.play().catch(function() { send('error'); });
      else if (action === 'pause') video.pause();
      else if (action === 'rewind') { video.pause(); video.currentTime = 0; }
    }
  };
  if (window.addEventListener) window.addEventListener('pagehide', function() { stopMicrophoneProbe(); });
  scan(); setInterval(scan, 500);
})(); true;
`;

export function buildDemoVideoHtml(url: string): string {
  const encoded = JSON.stringify(url).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="margin:0;background:#080b12;color:#eee;font:14px sans-serif">
    <video id="demo-video" controls playsinline preload="metadata" style="width:100%;height:100vh;object-fit:contain"></video>
    <script>document.getElementById('demo-video').src=${encoded};</script></body></html>`;
}
