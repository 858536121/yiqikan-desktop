// Precompiled observers avoid eval on websites with a strict Content Security Policy.
export const PLAYER_SITE_OBSERVER_SCRIPT = String.raw`
function siteSnapshot() { return (()=>{
 var v=window.__yiqikanSelectedVideo || (window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo()) || document.querySelector('video,bwp-video');
 var s=document.querySelector('[data-yk-player]'), scale=visualViewport?.scale||1;
 var box=e=>e?e.getBoundingClientRect().toJSON():null;
 return {path:location.origin+location.pathname,title:document.title,scale,viewport:{x:visualViewport?.offsetLeft||0,y:visualViewport?.offsetTop||0,w:visualViewport?.width||innerWidth,h:visualViewport?.height||innerHeight},screen:{w:screen.width,h:screen.height},floating:!!s,rect:box(s),video:v?{connected:v.isConnected,source:!!(v.currentSrc||v.src),paused:v.paused,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,rate:v.playbackRate,ready:v.readyState,frames:v.__probeFrames?.()||v.getVideoPlaybackQuality?.().totalVideoFrames||0,rect:box(v),controls:v.controls}:null,
 entries:Array.from(document.querySelectorAll('[data-yk-entry]')).filter(b=>!b.hidden).map(b=>({ready:!b.disabled,label:b.getAttribute('aria-label'),rect:box(b)})),
 hosted:Array.from(document.querySelectorAll('iframe')).filter(f=>getComputedStyle(f).position==='fixed').map(f=>({path:new URL(f.src||'about:blank',location.href).pathname,rect:box(f)})),
 controls:s?Array.from(s.querySelectorAll('button,input,[data-yk-drag],[data-yk-resize]')).map(e=>({label:e.getAttribute('aria-label'),rect:box(e),visible:getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none',disabled:e.disabled})):[],trace:window.__siteUiTrace||[]};})(); }
function siteInstrument() {
 if(window.__siteUiTrace)return true;window.__siteUiTrace=[];
 document.addEventListener("click",function(e){var b=e.target.closest?.("[data-yk-player] button,[data-yk-entry]");if(!b)return;var label=b.getAttribute("aria-label");setTimeout(function(){var v=window.__yiqikanSelectedVideo;window.__siteUiTrace.push({trusted:e.isTrusted,label,time:v?.currentTime,paused:v?.paused,rate:v?.playbackRate,floating:!!document.querySelector("[data-yk-player]")});},200);},true);
 return true;
}
`;
