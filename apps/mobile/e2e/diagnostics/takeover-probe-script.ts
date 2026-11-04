// Runs in the same WKWebView/frame as the real website and existing App scripts.
import { PLAYER_SITE_OBSERVER_SCRIPT } from './player-site-observer';
export const PROBE_SCRIPT = String.raw`
(function() {
  if (window.__takeoverProbe) return;
  ${PLAYER_SITE_OBSERVER_SCRIPT}
  const frameId = Math.random().toString(36).slice(2);
  const videos = new Map(), media = new Map(), seen = new Set();
  let nextId = 0, selected = null, restoreFn = null;
  function send(payload) {
    try {
      const message=JSON.stringify({type:'TAKEOVER_PROBE',payload:{at:Date.now(),frameId,href:location.href,top:window===window.top,...payload}});
      if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(message);
      else window.webkit?.messageHandlers?.ReactNativeWebView?.postMessage(message);
    } catch {}
  }
  function resource(url, method) {
    if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
    if (!/\.(m3u8|mpd|mp4|m4s|flv)(?:[?#]|$)|mime=video|mime_type=video|\/playurl\?/i.test(url)) return;
    if (media.has(url)) return;
    media.set(url,{url,method}); send({kind:'resource',url,method});
  }
  const origFetch = window.fetch;
  window.fetch = function(input,init) {
    resource(typeof input==='string'?input:input?.url,'fetch');
    return origFetch.apply(this,arguments).then(r=>{
      resource(r.url,'fetch-response');
      const ct=r.headers.get('content-type')||'';
      if (/mpegurl|dash\+xml/.test(ct)) { media.set(r.url,{url:r.url,method:'manifest-mime'}); send({kind:'resource',url:r.url,method:'manifest-mime'}); }
      return r;
    });
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method,url) {
    resource(String(url),'xhr'); this.addEventListener('load',()=>resource(this.responseURL,'xhr-response'),{once:true});
    return origOpen.apply(this,arguments);
  };
  try { new PerformanceObserver(list=>list.getEntries().forEach(e=>resource(e.name,'performance'))).observe({type:'resource',buffered:true}); } catch {}
  function scan(root=document) {
    root.querySelectorAll('video,bwp-video').forEach(v=>{
      if (Array.from(videos.values()).includes(v)) return;
      const id='v'+(++nextId); videos.set(id,v); let frames=0;
      v.__probeFrames=()=>frames;
      if (v.requestVideoFrameCallback) { const count=()=>{frames++;v.requestVideoFrameCallback(count)};v.requestVideoFrameCallback(count); }
      ['play','pause','loadedmetadata','loadeddata','emptied','seeked','error','encrypted'].forEach(event=>v.addEventListener(event,()=>send({kind:'video-event',event,video:state(id,v)})));
      send({kind:'detected',video:state(id,v)});
    });
  }
  function state(id,v) {
    const r=v.getBoundingClientRect(), cs=getComputedStyle(v);
    let quality;try { quality=v.getVideoPlaybackQuality?.().totalVideoFrames; } catch {}
    return {id,tag:v.tagName,connected:v.isConnected,src:v.currentSrc||v.src||'',sources:Array.from(v.querySelectorAll('source')).map(s=>s.src),paused:v.paused,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,rate:v.playbackRate,ready:v.readyState,seeking:v.seeking,error:v.error?{code:v.error.code,message:v.error.message}:null,frames:v.__probeFrames?.(),totalFrames:quality,muted:v.muted,volume:v.volume,width:r.width,height:r.height,x:r.x,y:r.y,visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight,host:location.host};
  }
  function snapshot() {
    scan();return {title:document.title,text:document.body?.innerText?.slice(0,1200),selected,videos:Array.from(videos).map(([id,v])=>state(id,v)),resources:Array.from(media.values()),iframes:Array.from(document.querySelectorAll('iframe')).map(f=>({src:f.src,width:f.offsetWidth,height:f.offsetHeight})),links:Array.from(document.querySelectorAll('a[href]')).filter(a=>a.innerText?.trim()).slice(0,100).map(a=>({text:a.innerText.trim().slice(0,70),href:a.href})),globals:Object.keys(window).filter(k=>/player_|hls|dplayer|artplayer/i.test(k)).slice(0,25)};
  }
  function pick(id) {
    scan();if(id&&videos.has(id))return [id,videos.get(id)];
    return Array.from(videos).filter(([id,v])=>v.isConnected).sort((a,b)=>{const ar=a[1].getBoundingClientRect(),br=b[1].getBoundingClientRect();return br.width*br.height-ar.width*ar.height})[0]||[];
  }
  function mount(id,mode='fixed') {
    restoreFn?.();const [key,v]=pick(id);if(!v)throw Error('no video');selected=key;
    const target=v.closest('.bpx-player-container,.player-container,#player,.txp_player,.iqp-player,.m-video-player,.dplayer,.artplayer-app')||v;
    const oldStyle=target.getAttribute('style'), bodyStyle=document.body.getAttribute('style');
    const marker=document.createComment('takeover-origin');let box=null;
    if(mode==='move') {
      target.parentNode.insertBefore(marker,target);box=document.createElement('div');box.id='probe-float';document.body.appendChild(box);box.appendChild(target);
      box.style.cssText='position:fixed;inset:100px 10px auto;height:240px;background:black;z-index:2147483646';
      target.style.setProperty('width','100%','important');target.style.setProperty('height','100%','important');
    } else {
      target.style.setProperty('position','fixed','important');target.style.setProperty('top','100px','important');target.style.setProperty('left','10px','important');target.style.setProperty('width','calc(100vw - 20px)','important');target.style.setProperty('height','240px','important');target.style.setProperty('z-index','2147483646','important');target.style.setProperty('background','black','important');
    }
    document.body.style.setProperty('overflow','hidden','important');
    restoreFn=()=>{
      if(mode==='move'&&marker.parentNode){marker.parentNode.insertBefore(target,marker);marker.remove();box?.remove();}
      oldStyle===null?target.removeAttribute('style'):target.setAttribute('style',oldStyle);
      bodyStyle===null?document.body.removeAttribute('style'):document.body.setAttribute('style',bodyStyle);restoreFn=null;selected=null;
    };return {mode,target:target.tagName,targetClass:target.className,video:state(key,v)};
  }
  async function run(cmd,relay=true) {
    if(seen.has(cmd.id))return;seen.add(cmd.id);
    if(relay) for(const f of document.querySelectorAll('iframe')) {try{f.contentWindow.postMessage({__takeoverCommand:cmd},'*')}catch{}}
    if(cmd.frameId&&cmd.frameId!==frameId)return;
    try {
      let result;
      if(cmd.op==='inspect')result=snapshot();
      else if(cmd.op==='site-snapshot')result=siteSnapshot();
      else if(cmd.op==='site-instrument')result=siteInstrument();
      else if(cmd.op==='site-controller') {
        result=null;
        if(window===window.top) {
          if(cmd.method==='sync')window.__syncCmd(cmd.value);
          else if(cmd.method==='query')window.__queryRealtimeStatus(cmd.value);
          result={top:true};
        }
      }
      else if(cmd.op==='eval')result=await (0,eval)(cmd.script);
      else if(cmd.op==='links')result=snapshot().links;
      else if(cmd.op==='controls') {
        const [id,v]=pick(cmd.videoId);if(!v)throw Error('no video');selected=id;
        if(cmd.action==='play')await v.play();
        if(cmd.action==='pause')v.pause();
        if(cmd.action==='seek')v.currentTime=cmd.time;
        if(cmd.action==='rate')v.playbackRate=cmd.rate;
        result=state(id,v);
      } else if(cmd.op==='mount')result=mount(cmd.videoId,cmd.mode);
      else if(cmd.op==='restore'){restoreFn?.();result=snapshot();}
      else if(cmd.op==='button') {
        const [id,v]=pick(cmd.videoId);if(!v)throw Error('no video');
        const button=document.createElement('button');button.innerText='E2E异起看接管';button.setAttribute('aria-label','E2E异起看接管');button.style.cssText='position:fixed;top:70px;right:10px;z-index:2147483647;padding:12px;background:#f97316;color:white';
        button.onclick=(event)=>{const result=mount(id,cmd.mode);v.play().catch(()=>{});send({kind:'button-click',trusted:event.isTrusted,result});button.remove()};document.body.appendChild(button);result={id};
      } else if(cmd.op==='click') {
        const nodes=Array.from(document.querySelectorAll(cmd.selector||'a,button'));
        const node=cmd.text?nodes.find(n=>n.innerText?.includes(cmd.text)):nodes[0];if(!node)throw Error('no matching clickable');node.click();result={tag:node.tagName,text:node.innerText?.slice(0,80)};
      } else throw Error('unknown command');
      send({kind:'response',commandId:cmd.id,op:cmd.op,result});
    } catch(error) {send({kind:'response',commandId:cmd.id,op:cmd.op,error:String(error)});}
  }
  window.__takeoverProbe={run,snapshot};
  window.addEventListener('message',e=>{if(e.data?.__takeoverCommand)run(e.data.__takeoverCommand,true)});
  const start=()=>{scan();new MutationObserver(()=>scan()).observe(document.documentElement,{childList:true,subtree:true});send({kind:'ready',ua:navigator.userAgent});setInterval(()=>send({kind:'sample',...snapshot(),links:undefined,text:undefined}),2000)};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();
`;
