import type { Player } from './types';

export function getCleanVideoTitle() {
  try {
    var title = document.title || "";
    try {
      var playbackPage = window.__yiqikanSiteRules && window.__yiqikanSiteRules.playbackPage();
      var ruledTitle = window.__yiqikanSiteRules && window.__yiqikanSiteRules.title();
      if (playbackPage && playbackPage.status === 'applied' && playbackPage.value && typeof playbackPage.value.title === 'string' && playbackPage.value.title.trim()) {
        title = playbackPage.value.title;
      } else if (ruledTitle && ruledTitle.status === 'applied' && typeof ruledTitle.value === 'string' && ruledTitle.value.trim()) {
        title = ruledTitle.value;
      }
    } catch (_) {}
    title = title
      .replace(/_哔哩哔哩_bilibili.*$/i, "")
      .replace(/- 腾讯视频.*$/i, "")
      .replace(/- 优酷.*$/i, "")
      .replace(/- 爱奇艺.*$/i, "")
      .replace(/_芒果TV.*$/i, "")
      .replace(/【[^】]*】/g, "")
      .trim();
    return title.length > 40 ? title.slice(0, 40) + "..." : (title || "当前视频");
  } catch (e) { return "当前视频"; }
}

function getTencentPlayerWrapper(): Player | null {
  try {
    const playerObj = window.__PLAYER__;
    if (playerObj && playerObj.corePlayer && playerObj.currentVideoInfo) {
      return {
        isPlatformAdapter: true,
        controlOwner: playerObj,
        controlSource: String(playerObj.currentVideoInfo!.vid || playerObj.currentVideoInfo!.title || ''),
        canSeek: typeof playerObj.seek === 'function',
        get currentTime() { return Number(playerObj.currentVideoInfo!.playtime || 0); },
        set currentTime(val) { playerObj.seek && playerObj.seek(val); },
        get duration() { return Number(playerObj.currentVideoInfo!.duration || 0); },
        get paused() { return Boolean(playerObj.paused || (playerObj.corePlayer && playerObj.corePlayer.paused)); },
        get playbackRate() { return Number(playerObj.playbackRate || 1); },
        set playbackRate(r) { if (playerObj.setPlaybackRate) playerObj.setPlaybackRate(r); else playerObj.playbackRate = r; },
        play: function() { return playerObj.corePlayer!.play(); },
        pause: function() { return playerObj.corePlayer!.pause(); },
        seek: function(time: number) { playerObj.seek && playerObj.seek(time); }
      };
    }
  } catch (e) {}
  return null;
}

function getBaiduPanPlayerWrapper(): Player | null {
  try {
    if (window.location.host.indexOf("pan.baidu.com") !== -1) {
      var el = document.querySelector(".vjs-controls-enabled");
      const vjs = el && el.player;
      if (vjs && typeof vjs.currentTime === "function") {
        return {
          isPlatformAdapter: true,
          controlOwner: vjs,
          controlSource: String(vjs.currentSrc ? vjs.currentSrc() : ''),
          canSeek: true,
          get currentTime() { return vjs.currentTime() || 0; },
          set currentTime(val) { vjs.currentTime(val); },
          get duration() { return vjs.duration() || 0; },
          get paused() { return vjs.paused(); },
          get readyState() { return vjs.readyState ? vjs.readyState() : undefined; },
          get seeking() { return vjs.seeking ? vjs.seeking() : false; },
          get playbackRate() { return vjs.playbackRate() || 1; },
          set playbackRate(r) { vjs.playbackRate(r); },
          play: function() { return vjs.play(); },
          pause: function() { return vjs.pause(); },
          seek: function(time: number) { vjs.currentTime(time); }
        };
      }
    }
  } catch (e) {}
  return null;
}

export function wrapVideoElement(v: HTMLVideoElement): Player {
  return {
    element: v,
    isPlatformAdapter: false,
    get currentTime() { return v.currentTime || 0; },
    set currentTime(val) { v.currentTime = val; },
    get duration() { return v.duration || 0; },
    get paused() { return v.paused; },
    get readyState() { return v.readyState; },
    get seeking() { return v.seeking; },
    get playbackRate() { return v.playbackRate || 1; },
    set playbackRate(r) { try { v.playbackRate = r; } catch (e) {} },
    play: function() { return v.play(); },
    pause: function() { return v.pause(); },
    seek: function(time: number) { v.currentTime = time; }
  };
}

function isAdOrThumbnailVideo(v: HTMLVideoElement) {
  try {
    if (v.VideoTogetherDisabled) return true;
    var host = (window.location.hostname || "").toLowerCase();
    if (host.indexOf("bilibili.com") !== -1) {
      if (v.closest && (v.closest("div.video-page-card-small") || v.closest("div.feed-card") || v.closest(".bili-video-card__stats"))) return true;
    }
    if (host.indexOf("iqiyi.com") !== -1) {
      var cdTimes = document.querySelectorAll<HTMLElement>(".cd-time");
      for (var i = 0; i < cdTimes.length; i++) {
        if (cdTimes[i].offsetParent !== null && v.duration && v.duration < 120 && !(v.closest && v.closest(".iqp-player-videolayer-inner"))) {
          return true;
        }
      }
    }
    if (host.indexOf("v.qq.com") !== -1) {
      var adCtrls = document.querySelectorAll('.txp_ad_control:not(.txp_none)[data-role="creative-player-video-ad-control"]');
      if (adCtrls.length > 0 && v.duration && v.duration < 120) return true;
    }
    if (host.indexOf("youku.com") !== -1) {
      if (document.querySelector(".advertise-layer div") && v.duration && v.duration < 120) return true;
    }
    if (v.duration && v.duration < 5 && (v.offsetWidth < 60 || v.offsetHeight < 60)) return true;
  } catch (e) {}
  return false;
}

function calculateVideoScore(v: HTMLVideoElement) {
  if (isAdOrThumbnailVideo(v)) return -1000;
  var score = 0;
  var duration = v.duration || 0;
  if (isFinite(duration) && duration > 0) score += Math.min(duration, 7200) / 10;
  var width = v.offsetWidth || 0;
  var height = v.offsetHeight || 0;
  if (width >= 100 && height >= 60) score += (width * height) / 2000;
  if (!v.paused && v.currentTime > 0.3) score += 300;
  if (v.readyState >= 2) score += 200;
  if (window.location.hostname.indexOf("iqiyi.com") !== -1 && v.closest && v.closest(".iqp-player-videolayer-inner")) score += 2000;
  return score;
}



export function findBestPlayerInFrame(): Player | null {
  var selectedVideo = window.__yiqikanSelectedVideo;
  if (selectedVideo && selectedVideo.isConnected) return wrapVideoElement(selectedVideo);
  var localVideo = document.getElementById("yiqikan-local-video") as HTMLVideoElement | null;
  if (localVideo && localVideo.src) return wrapVideoElement(localVideo);

  var tencent = getTencentPlayerWrapper();
  if (tencent) return tencent;
  var baidu = getBaiduPanPlayerWrapper();
  if (baidu) return baidu;

  // Supplemental candidate only; explicit selection, local files and existing
  // platform adapters retain priority and the normal validity checks still run.
  try {
    var ruled = window.__yiqikanSiteRules && window.__yiqikanSiteRules.mediaCandidates();
    if (ruled && ruled.status === 'applied' && calculateVideoScore(ruled.value!) > 0) return wrapVideoElement(ruled.value!);
  } catch (_) {}

  var videos = document.querySelectorAll<HTMLVideoElement>("video, bwp-video");
  var best: HTMLVideoElement | null = null;
  var bestScore = -1;
  for (var i = 0; i < videos.length; i++) {
    var score = calculateVideoScore(videos[i]);
    if (score > bestScore) {
      bestScore = score;
      best = videos[i];
    }
  }
  // Android injects only the main document. Control accessible iframe media
  // directly when that document has no independently injected controller.
  // Keep cross-origin frames and already routed child controllers separate.
  if (!best && window.__yiqikanScanSameOriginFrames === true) {
    function visitFrames(doc: Document, depth: number) {
      if (depth > 12) return;
      var frames = doc.querySelectorAll('iframe');
      for (var j = 0; j < frames.length; j++) {
        try {
          var child = frames[j].contentDocument;
          if (!child || !child.defaultView || child.defaultView.__YIQIKAN_INJECTED) continue;
          var childVideos = child.querySelectorAll<HTMLVideoElement>('video, bwp-video');
          for (var k = 0; k < childVideos.length; k++) {
            var score = calculateVideoScore(childVideos[k]);
            if (score > bestScore) { bestScore = score; best = childVideos[k]; }
          }
          visitFrames(child, depth + 1);
        } catch (_) { /* Cross-origin documents need a native frame bridge. */ }
      }
    }
    visitFrames(document, 0);
  }
  return best ? wrapVideoElement(best) : null;
}




export function installPlayerDiscovery() {
  window.__yiqikanIsVideoCandidate = function(v) { return !isAdOrThumbnailVideo(v); };
  window.__yiqikanCurrentVideo = function() { var player=findBestPlayerInFrame(); return player && player.element; };
}
