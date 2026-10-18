import { MEDIA_CONTEXT_SCRIPT } from '@yiqikan/shared';

// Runs in each document. Media stays in its original DOM tree; only styles change.
// Child documents relay through their actual parent iframe, never navigate the host.
export function createWebPlayerScript(session: string): string {
  return MEDIA_CONTEXT_SCRIPT + '\n' + WEB_PLAYER_SCRIPT.replace('__SESSION_JSON__', JSON.stringify(session));
}

const WEB_PLAYER_SCRIPT = String.raw`
(function(session) {
  if (window.__yiqikanPlayer) { window.__yiqikanPlayer.attach(); return; }
  var root = window === window.top;
  var frameId = 'f-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  var nativePost = window.ReactNativeWebView && window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
  var children = new Map(), activeFrame = frameId, explicit = false;
  var selected = null, selectedSource = '', surface = null, cover = null;
  var changed = [], selectedListeners = [], controlsBefore = false, hosted = null, hostedChanges = [], hostedPlaceholder = null;
  var mode = 'inline', box = null, fullscreen = false, idle = null;
  var entries = new Map(), frameEntries = new Map(), sequence = 0, childWindow = null, lastPolicy = '', parentScale = 1;
  var iframeEntries=new Map(), mediaFrames=new Set(), frameChrome=null, passthrough=false;
  var theaterVideo=null, theaterChanges=[];
  var layouts=new Map(), layoutSequence=0;
  var episodeSelector='.anthology-list-play a,.module-play-list a,.stui-content__playlist a,.myui-content__list a,.playlist a,.play-list a,.play_list a,.video-episode-card,.ep-item,.list-box .item,[data-yk-episode]';
  var clickedEpisode=null, mediaKey='', pendingEpisode=null, lastSourceToken='';
  var mediaContext=window.__yiqikanMediaContext,lastMediaContext=null;
  function label(node) {return mediaContext.label(node);}
  function episodeIdentity(value) {return mediaContext.identity(value);}
  function mediaStamp(video) {
    if(!video.__ykMediaStamp){video.__ykMediaStamp='v-'+Math.random().toString(36).slice(2);video.__ykMediaEpoch=0;video.addEventListener('emptied',function(){video.__ykMediaEpoch++;});}
    return video.__ykMediaStamp+':'+video.__ykMediaEpoch;
  }
  function episodeOptions() {
    return mediaContext.options();
  }
  function optionFor(target) {
    var options=episodeOptions();
    for(var n=target;n && n!==document.documentElement;n=n.parentElement)if(options.indexOf(n)>=0)return n;
    return null;
  }
  function currentEpisode() {
    var observed=mediaContext.currentEpisode();if(observed)return observed;
    if(clickedEpisode) return clickedEpisode;
    var nodes=episodeOptions();
    for(var i=0;i<nodes.length;i++) {
      var node=nodes[i];
      if(node.matches('.active,.on,.current,.selected,[aria-current="true"],[aria-current="page"]') || node.closest('li.active,li.on,li.current')) {
        var text=label(node);if(text)return {label:text,url:node.href || undefined};
      }
    }
    return undefined;
  }
  function sourceKey(value) {var h=2166136261;for(var i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function reportMedia(packet) {
    if(!root) return;
    var p=packet.payload, v=window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo();
    var source=p.mediaSource || (v && (v.getAttribute('src') || v.currentSrc || v.src)) || '';
    if(!source) return;
    var sourceToken=sourceKey(source)+'|'+packet.frameId+'|'+(p.mediaVideoId || (v && mediaStamp(v)) || '');
    var context=mediaContext.read(null,{source:sourceToken,ready:p.mediaReady !== undefined ? p.mediaReady : Boolean(v && v.readyState>=1 && !v.error)});
    var key=context.key+'|'+context.ready;
    if(key===mediaKey) return;
    mediaKey=key;lastMediaContext=context;
    emitNative({frameId:packet.frameId,payload:Object.assign({type:'MEDIA_CONTEXT'},context)});
  }

  function iframeFor(source) {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === source) return frames[i];
    return null;
  }
  function down(packet) {
    children.forEach(function(id, child) {
      if (iframeFor(child)) child.postMessage(Object.assign({channel:'yiqikan-player',session:session}, packet), '*');
      else children.delete(child);
    });
  }
  function up(packet) {
    if (!root) { window.parent.postMessage(Object.assign({channel:'yiqikan-player',session:session}, packet), '*'); return; }
    receive(packet, null);
  }
  function send(payload) {
    if(['SYNC_EVENT','VIDEO_FOUND','MEDIA_REALTIME_STATUS'].indexOf(payload.type)>=0) {
      var v=window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo();
      if(v){payload.mediaSource=v.getAttribute('src') || v.currentSrc || v.src || '';payload.mediaReady=v.readyState>=1 && !v.error;payload.mediaVideoId=mediaStamp(v);}
    }
    up({kind:'event',frameId:frameId,payload:payload});
  }
  function emitNative(packet) {
    var payload=packet.payload;
    // Embedded player documents often have a generic vendor title. Keep the
    // surrounding film page's title when forwarding their media to the HUD.
    if(packet.frameId!==frameId && document.title) {
      if(payload.type==='PLAYER_SELECTED' || payload.type==='VIDEO_FOUND') payload=Object.assign({},payload,{title:document.title});
      if(payload.type==='SYNC_EVENT' && payload.payload) payload=Object.assign({},payload,{payload:Object.assign({},payload.payload,{videoTitle:document.title})});
    }
    if (nativePost) nativePost(JSON.stringify({type:'WEB_PLAYER_MESSAGE',session:session,documentId:frameId,frameId:packet.frameId,payload:payload}));
  }
  function selectFrame(id) {
    activeFrame = id; explicit = true;
    window.__yiqikanInactiveFrame=id!==frameId;
    down({kind:'active',frameId:id});
    if(id!==frameId && window.__yiqikanSelectedVideo) window.__yiqikanSelectedVideo.pause();
    if (id !== frameId && selected) restore(false);
    if (id !== frameId && window.__resetVideoSync) window.__resetVideoSync();
  }
  function receive(packet, source) {
    if (packet.kind === 'register') {
      var previous=source && children.get(source);
      if (source) {
        if(previous && previous!==packet.frameId && (previous===activeFrame || source===childWindow)) expireFrame();
        frameEntries.forEach(function(candidate,key) { if(candidate.source===source) { candidate.button.remove(); frameEntries.delete(key); } });
        children.set(source, packet.frameId);
      }
      lastPolicy = ''; policy();
      up({kind:'event',frameId:frameId,payload:{type:'PLAYER_FRAME_READY',previousFrameId:previous,registeredFrameId:packet.frameId}});
      return;
    }
    if (packet.kind === 'event') {
      var p = packet.payload;
      if (!p || typeof p.type !== 'string') return;
      var childEvents=['SYNC_EVENT','MEDIA_REALTIME_STATUS','VIDEO_FOUND','REQUEST_RESYNC','REQUEST_FULLSCREEN','EXIT_FULLSCREEN','TOGGLE_FULLSCREEN','TOGGLE_CONTROLS','TOUCH_INTERACT','HOST_ONLY_WARNING','TOAST','LOG','FOUND_IFRAME','PLAYER_CANDIDATE','PLAYER_SELECTED','PLAYER_PRESENTATION','PLAYER_DRAG','PLAYER_RESIZE','PLAYER_RELEASED','PLAYER_EXPIRED','PLAYER_FRAME_READY','PLAYER_CONTROL'];
      if(source && childEvents.indexOf(p.type)<0 && !(p.type==='TAKEOVER_PROBE' && window.__takeoverProbe)) return;
      if (p.type === 'PLAYER_SELECTED') {
        removeFrameChrome(); passthrough=false;
        selectFrame(packet.frameId);
        childWindow = source;
        if (source) { box=defaultBox(p.ratio); showIframe(source, 'float'); }
      }
      if (p.type === 'PLAYER_PRESENTATION' && source) showIframe(source, passthrough && p.mode==='inline'?'float':p.mode);
      if (p.type === 'PLAYER_DRAG' && source) moveHosted(p.dx, p.dy, p.end);
      if (p.type === 'PLAYER_RESIZE' && source) resizeHosted(p);
      if(p.type==='PLAYER_FRAME_READY' && p.previousFrameId && p.registeredFrameId!==p.previousFrameId) {
        frameEntries.forEach(function(candidate,key) { if(key.indexOf(p.previousFrameId+':')===0) { candidate.button.remove(); frameEntries.delete(key); } });
        if(p.previousFrameId===activeFrame) expireFrame();
      }
      if (root && p.type === 'PLAYER_CANDIDATE' && source) {
        var key=packet.frameId+':'+p.id, candidate=frameEntries.get(key);
        if(!candidate) {
          var entry=entryButton(function() { down({kind:'command',frameId:packet.frameId,method:'select',value:p.id}); });
          document.documentElement.appendChild(entry);
          candidate={button:entry,source:source}; frameEntries.set(key,candidate);
        }
        candidate.ready=p.ready; candidate.visible=p.visible;
      }
      if (p.type === 'PLAYER_RELEASED' && packet.frameId !== activeFrame) return;
      if (p.type === 'PLAYER_RELEASED' && source) restoreHosted();
      if(p.type==='VIDEO_FOUND') {
        mediaFrames.add(packet.frameId);
        if(passthrough && source===childWindow) selectFrame(packet.frameId);
        if(source===childWindow && fullscreen)down({kind:'command',frameId:packet.frameId,method:'sync',value:{fullscreen:true}});
      }
      if (!root) { window.parent.postMessage(Object.assign({channel:'yiqikan-player',session:session},packet), '*'); return; }
      if (!explicit && (!passthrough || source===childWindow) && p.type === 'VIDEO_FOUND' && packet.frameId !== frameId && !document.querySelector('video,bwp-video')) {
        activeFrame = packet.frameId; window.__yiqikanInactiveFrame=true; down({kind:'active',frameId:activeFrame});
      }
      var mediaMessage = ['SYNC_EVENT','MEDIA_REALTIME_STATUS','VIDEO_FOUND','REQUEST_RESYNC','PLAYER_CONTROL'].indexOf(p.type) >= 0;
      if (mediaMessage && packet.frameId !== activeFrame) return;
      if(mediaMessage) reportMedia(packet);
      if (p.type === 'FOUND_IFRAME' || p.type === 'PLAYER_CANDIDATE' || p.type === 'PLAYER_DRAG' || p.type === 'PLAYER_RESIZE' || p.type === 'PLAYER_FRAME_READY') return;
      emitNative(packet);
    }
  }
  window.addEventListener('message', function(event) {
    var p = event.data;
    if (!p || p.channel !== 'yiqikan-player' || p.session !== session || typeof p.kind !== 'string') return;
    if (event.source === window.parent && !root) {
      if (p.kind === 'layout') {
        parentScale=Math.max(.1,Math.min(10,Number(p.scale)||1));
        if(surface) surface.style.setProperty('--yk-scale',String(1/uiScale()));
        down(p); return;
      }
      if (p.kind === 'policy') {
        Object.keys(p.values).forEach(function(key) { window[key] = p.values[key]; });
        if (!window.__followSyncEnabled && window.__resetVideoSync) window.__resetVideoSync();
        down(p); return;
      }
      if (p.kind === 'active') {
        activeFrame = p.frameId; explicit = true;
        window.__yiqikanInactiveFrame=activeFrame!==frameId;
        if(activeFrame!==frameId && window.__yiqikanSelectedVideo) window.__yiqikanSelectedVideo.pause();
        if (activeFrame !== frameId) { if (selected) restore(false); if (window.__resetVideoSync) window.__resetVideoSync(); }
        down(p); return;
      }
      if (p.kind === 'command') {
        if (p.frameId === frameId) {
          attach();
          if (p.method === 'sync' && localSync) localSync(p.value);
          if (p.method === 'query' && localQuery) localQuery(p.value);
          if (p.method === 'restore') restore(true);
          if (p.method === 'select') entries.forEach(function(entry,video) { if(entry.getAttribute('data-yk-entry')===String(p.value)) select(video); });
          if (p.method === 'present') present(p.value);
          if (p.method === 'pauseAll') pauseAll();
          if (p.method === 'wake') wake();
        } else down(p);
        return;
      }
    }
    if (!iframeFor(event.source)) return;
    if (typeof p.frameId !== 'string' || p.frameId.length > 100) return;
    if(p.kind!=='register' && !children.has(event.source)) children.set(event.source, p.frameId);
    receive(p, event.source);
  });
  // Give existing injection scripts the same transport in main and child frames.
  window.__yiqikanPost = send;
  function transport(value) { try { send(JSON.parse(value)); } catch (_) {} }
  transport.__ykTransport=true;
  window.ReactNativeWebView = {postMessage:transport};
  if (!root) up({kind:'register',frameId:frameId});

  function saveStyle(list, el, values) {
    Object.keys(values).forEach(function(key) {
      var prev = el.style.getPropertyValue(key), priority = el.style.getPropertyPriority(key);
      el.style.setProperty(key, values[key], 'important');
      list.push({el:el,key:key,prev:prev,priority:priority,value:el.style.getPropertyValue(key)});
    });
  }
  function undo(list) {
    for (var i = list.length - 1; i >= 0; i--) {
      var x = list[i];
      if(x.layout) {
        var layout=x.layout;
        if(layout.el.getAttribute('data-yk-layout')===layout.token) {
          if(layout.previous===null)layout.el.removeAttribute('data-yk-layout');
          else layout.el.setAttribute('data-yk-layout',layout.previous);
        }
        layout.node.remove();layouts.delete(layout.el);continue;
      }
      // Don't overwrite changes the website made after our transaction.
      if (x.el.style.getPropertyValue(x.key) !== x.value || x.el.style.getPropertyPriority(x.key) !== 'important') continue;
      if (x.prev) x.el.style.setProperty(x.key, x.prev, x.priority); else x.el.style.removeProperty(x.key);
    }
    list.length = 0;
  }
  function unclip(el, list) {
    for (var parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      var css = getComputedStyle(parent), values = {};
      if (css.transform !== 'none') values.transform = 'none';
      if (css.filter !== 'none') values.filter = 'none';
      if (css.perspective !== 'none') values.perspective = 'none';
      if (css.contain !== 'none') values.contain = 'none';
      if (css.overflow !== 'visible') values.overflow = 'visible';
      if (css.clipPath !== 'none') values['clip-path'] = 'none';
      values['z-index'] = '2147483645';
      saveStyle(list, parent, values);
    }
  }
  function viewport() {
    var v = window.visualViewport;
    return {x:v ? v.offsetLeft : 0,y:v ? v.offsetTop : 0,w:v ? v.width : window.innerWidth,h:v ? v.height : window.innerHeight,scale:v ? v.scale : 1};
  }
  function uiScale() { return root ? viewport().scale : parentScale; }
  function fullBox() {
    var v=viewport();
    // WKWebView can keep the portrait visualViewport width after the native
    // view rotates. At 1x the layout viewport is the current fullscreen size.
    return {x:v.x,y:v.y,w:Math.abs(v.scale-1)<.01?window.innerWidth:v.w,h:Math.abs(v.scale-1)<.01?window.innerHeight:v.h};
  }
  function constrain(b) {
    var v = viewport(), pad = 8 / v.scale;
    var ratio=b.ratio || b.w/b.h || 16/9;
    b.w = Math.min(b.w, Math.max(80, v.w - pad * 2), Math.max(80,v.h-pad*2)*ratio);
    b.h = b.w/ratio; b.ratio=ratio;
    b.x = Math.max(v.x + pad, Math.min(b.x, v.x + v.w - b.w - pad));
    b.y = Math.max(v.y + pad, Math.min(b.y, v.y + v.h - b.h - pad));
    return b;
  }
  function defaultBox(ratio) {
    ratio=Number(ratio)>0?Number(ratio):16/9;
    var v = viewport(), w = Math.min(300 / v.scale, v.w * .75, v.h*.7*ratio);
    return constrain({x:v.x + v.w - w - 10 / v.scale,y:v.y + 12 / v.scale,w:w,h:w/ratio,ratio:ratio});
  }
  function rectStyles(b) {
    return {position:'fixed',left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px','max-width':'none','max-height':'none','box-sizing':'border-box',border:'0',margin:'0','z-index':'2147483646','object-fit':'contain',background:'#000',visibility:'visible',opacity:'1',transform:'none','border-radius':12/uiScale()+'px',display:'block'};
  }
  function saveLayout(list,el,b) {
    // Player libraries may clear video/iframe inline dimensions on a delayed
    // resize. Keep the same geometry in our own rule, without observing and
    // repeatedly rewriting the website's styles. Inline styles still cover
    // existing !important declarations and pages that disallow inline sheets.
    var token=frameId+'-'+(++layoutSequence),node=document.createElement('style');
    node.setAttribute('data-yk-layout-style',token);
    node.textContent='[data-yk-layout="'+token+'"]{}';
    (document.head || document.documentElement).appendChild(node);
    var rule=node.sheet && node.sheet.cssRules[0];
    if(rule) {
      var layout={el:el,node:node,style:rule.style,token:token,previous:el.getAttribute('data-yk-layout')};
      layouts.set(el,layout);list.push({layout:layout});el.setAttribute('data-yk-layout',token);
    } else node.remove();
    saveStyle(list,el,rectStyles(b));applyBox(el,b);
  }
  function applyBox(el, b) {
    var values = rectStyles(b);
    if(fullscreen) values['border-radius']='0';
    var owned=changed.concat(hostedChanges),layout=layouts.get(el);
    // If the site changed its inline styles since our last write, restore those
    // latest values when closing, even after a subsequent drag or full screen.
    owned.forEach(function(x) {
      if(x.el!==el || !keyIn(values,x.key))return;
      var current=el.style.getPropertyValue(x.key),priority=el.style.getPropertyPriority(x.key);
      if(current!==x.value || priority!=='important') {x.prev=current;x.priority=priority;}
    });
    Object.keys(values).forEach(function(key) {
      if(layout)layout.style.setProperty(key,values[key],'important');
      el.style.setProperty(key,values[key],'important');
    });
    // Update transaction's owned values for conditional restoration after dragging.
    owned.forEach(function(x) { if (x.el === el && keyIn(values,x.key)) x.value = el.style.getPropertyValue(x.key); });
  }
  function keyIn(values,key) { return Object.prototype.hasOwnProperty.call(values,key); }
  function removeFrameChrome() { if(frameChrome) frameChrome.remove(); frameChrome=null; }
  function releaseIframe() {restoreHosted();emitNative({frameId:activeFrame,payload:{type:'PLAYER_RELEASED'}});scan();}
  function positionFrameChrome(b) {
    if(!frameChrome)return;
    applyBox(frameChrome,b);
    frameChrome.style.setProperty('background','transparent','important');
    frameChrome.style.setProperty('z-index','2147483647','important');
    frameChrome.style.setProperty('display',fullscreen?'none':'block','important');
  }
  function restoreHosted() { var wasHosted=Boolean(hosted); removeFrameChrome(); passthrough=false; undo(hostedChanges); if(hostedPlaceholder) hostedPlaceholder.remove(); hostedPlaceholder = null; hosted = null; childWindow = null; if(wasHosted) fullscreen=false; }
  function expireFrame() {
    var wasPresented=Boolean(hosted);
    var previousMode=fullscreen?'fullscreen':hosted?'floating':'page';
    restoreHosted(); activeFrame=frameId; explicit=false; window.__yiqikanInactiveFrame=false;
    if(window.__resetVideoSync) window.__resetVideoSync();
    down({kind:'active',frameId:frameId});
    if(wasPresented) send({type:'PLAYER_EXPIRED',previousMode:previousMode,message:'视频页面已切换'});
  }
  function showIframe(source, next) {
    var iframe = iframeFor(source);
    if (!iframe) return;
    if (next === 'inline' || next === 'released') { restoreHosted(); return; }
    if (hosted !== iframe) {
      restoreHosted(); hosted = iframe; childWindow = source;
      var r=iframe.getBoundingClientRect(); hostedPlaceholder=document.createElement('div');
      hostedPlaceholder.setAttribute('data-yk-frame-placeholder','');
      hostedPlaceholder.style.cssText='height:'+r.height+'px;display:flex;align-items:center;justify-content:center;background:#17191f;color:white;';
      hostedPlaceholder.appendChild(button('视频在小窗播放 · 收回',function() { down({kind:'command',frameId:activeFrame,method:'restore'}); }));
      iframe.parentNode.insertBefore(hostedPlaceholder,iframe);
      unclip(iframe,hostedChanges); saveLayout(hostedChanges,iframe,defaultBox(16/9));
    }
    if (root) {
      if (next === 'fullscreen') { fullscreen = true; applyBox(iframe,fullBox()); }
      else { fullscreen = false; if(!box) box=defaultBox(16/9); applyBox(iframe,constrain(Object.assign({},box))); }
    } else applyBox(iframe,fullBox());
    source.postMessage({channel:'yiqikan-player',session:session,kind:'layout',scale:uiScale()},'*');
    if(frameChrome) { positionFrameChrome(fullscreen?fullBox():constrain(Object.assign({},box))); frameChrome.hidden=fullscreen; }
  }
  function moveHosted(dx,dy,end) {
    if (!hosted || !root || fullscreen) return;
    var v = viewport(); box = constrain(box || defaultBox(16/9));
    box.x += Number(dx || 0) / v.scale; box.y += Number(dy || 0) / v.scale;
    if (end) box.x = box.x + box.w/2 < v.x + v.w/2 ? v.x : v.x + v.w - box.w;
    constrain(box); applyBox(hosted,box); positionFrameChrome(box);
  }
  function resizedBox(b,dx,dy,factor) {
    var v=viewport(), ratio=b.ratio||b.w/b.h, width=b.w;
    if(factor) width*=Math.max(.5,Math.min(2,Number(factor)||1));
    else width+=Math.abs(dx)>=Math.abs(dy*ratio)?dx:dy*ratio;
    width=Math.max(Math.min(180/v.scale,v.w-16/v.scale),width);
    var next={x:b.x,y:b.y,w:width,h:width/ratio,ratio:ratio};
    if(factor) { next.x+=(b.w-width)/2; next.y+=(b.h-next.h)/2; }
    return constrain(next);
  }
  function resizeHosted(p) {
    if(!hosted || !root || fullscreen) return;
    var scale=viewport().scale;
    box=resizedBox(box||defaultBox(16/9),Number(p.dx||0)/scale,Number(p.dy||0)/scale,p.factor);
    applyBox(hosted,box);
    positionFrameChrome(box);
  }
  function restore(notify, forget) {
    clearTimeout(idle);
    if (surface) surface.remove(); if (cover) cover.remove();
    if (selected) { selected.controls = controlsBefore; selected.removeEventListener('click',wake); }
    selectedListeners.forEach(function(x) { x.video.removeEventListener(x.event,x.callback); }); selectedListeners=[];
    undo(changed); surface = cover = null;
    window.__yiqikanSelectedVideo = forget ? null : selected || window.__yiqikanSelectedVideo;
    selected = null; mode = 'inline'; fullscreen = false;
    if (notify) send({type:'PLAYER_RELEASED',mode:'inline'});
    scan();
  }
  function framePresentation(next) { send({type:'PLAYER_PRESENTATION',mode:next}); }
  function resizeSelected(next) {
    if (!selected) return;
    mode = next; fullscreen = next === 'fullscreen';
    var v = viewport(), b = !root || fullscreen ? fullBox() : constrain(Object.assign({},box || defaultBox(selected.videoWidth / selected.videoHeight || 16/9)));
    applyBox(selected,b); applyBox(surface,b);
    surface.style.setProperty('background','transparent','important'); surface.style.setProperty('pointer-events','auto','important');
    surface.style.setProperty('z-index','2147483647','important');
    surface.style.setProperty('--yk-scale',String(1/uiScale()));
    surface.querySelector('[data-yk-controls]').style.display = fullscreen ? 'none' : 'flex';
    if(fullscreen) surface.querySelector('[data-yk-rates]').hidden=true;
    if (!root) framePresentation(next);
  }
  function button(label, action) {
    var b = document.createElement('button'); b.type='button'; b.textContent=label;
    b.setAttribute('aria-label',label); b.addEventListener('click',function(e) { e.stopPropagation(); action(); wake(); });
    return b;
  }
  var icons={
    play:'<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause:'<path d="M8 5v14M16 5v14" stroke-width="3.5"/>',
    fullscreen:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    resize:'<path d="m9 19 10-10m-4 10 4-4"/>',
    grip:'<path d="M8 9h8M8 15h8"/>',
    settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="#12151b"/><circle cx="15" cy="17" r="2.5" fill="#12151b"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>'; }
  function iconButton(label,name,action) { var b=button(label,action); b.innerHTML=icon(name); b.title=label; return b; }
  function entryButton(action) {
    var b=button('异起看',action); b.setAttribute('data-yk-entry',String(++sequence)); b.hidden=true;
    b.innerHTML=icon('play')+'<span>异起看</span>';
    // Use the same pointer gesture on WKWebView and Android WebView. Keep a
    // normal tap in its trusted click so iOS can start playback immediately.
    b.addEventListener('pointerdown',function(e) {
      if(!e.isPrimary || e.button!==0 || b.disabled || !b.__entryLayout) return;
      b.__suppressEntryClick=false;
      var r=b.getBoundingClientRect();
      b.__entryDrag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove',function(e) {
      var d=b.__entryDrag, layout=b.__entryLayout;
      if(!d || d.id!==e.pointerId || !layout) return;
      var dx=e.clientX-d.x,dy=e.clientY-d.y;
      if(!d.moved && Math.hypot(dx,dy)*layout.scale<6) return;
      d.moved=true; b.__suppressEntryClick=true; b.setAttribute('data-yk-entry-dragging','');
      var r=layout.rect,vp=layout.viewport;
      var x=Math.max(vp.x+layout.pad,Math.min(d.left+dx,vp.x+vp.w-layout.w-layout.pad));
      var y=Math.max(vp.y+layout.pad,Math.min(d.top+dy,vp.y+vp.h-layout.h-layout.pad));
      // Stay near this video's perimeter even if a finger travels far away.
      x=Math.max(r.left-layout.w-layout.gap,Math.min(x,r.right+layout.gap));
      y=Math.max(r.top-layout.h-layout.gap,Math.min(y,r.bottom+layout.gap));
      setEntryPosition(b,{x:x,y:y}); e.preventDefault();
    });
    function finish(e) {
      var d=b.__entryDrag;
      if(!d || d.id!==e.pointerId) return;
      b.__entryDrag=null; b.removeAttribute('data-yk-entry-dragging');
      if(d.moved && b.__entryLayout) {
        var r=b.getBoundingClientRect(),best=null,distance=Infinity;
        b.__entryLayout.edges.forEach(function(edge) {
          var x=Math.max(edge.x1,Math.min(r.left,edge.x2)),y=Math.max(edge.y1,Math.min(r.top,edge.y2));
          var delta=Math.hypot(x-r.left,y-r.top);
          if(delta<distance) { distance=delta;best={edge:edge.name,t:edge.x2>edge.x1?(x-edge.x1)/(edge.x2-edge.x1):edge.y2>edge.y1?(y-edge.y1)/(edge.y2-edge.y1):0}; }
        });
        if(best) b.__entryAnchor=best;
      }
      if(e.type!=='pointerup') b.__suppressEntryClick=true;
      if(b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId);
      scan();
    }
    b.addEventListener('pointerup',finish); b.addEventListener('pointercancel',finish); b.addEventListener('lostpointercapture',finish);
    return b;
  }
  function playerIframes() {
    // Require an explicit website player container. Generic ads, embeds and
    // hidden preloading frames must never become a playback candidate.
    return Array.from(document.querySelectorAll('.MacPlayer iframe,#playleft iframe,.player-container iframe,#player iframe,.embed-responsive iframe')).filter(function(f) {
      var r=f.getBoundingClientRect(),src=f.getAttribute('src')||'';
      return r.width>=100 && r.height>=100 && src && src!=='about:blank' && getComputedStyle(f).visibility!=='hidden';
    });
  }
  function openIframe(f) {
    if(!f.isConnected) return;
    box=defaultBox(f.getBoundingClientRect().width/f.getBoundingClientRect().height||16/9);
    showIframe(f.contentWindow,'float'); passthrough=true;
    activeFrame=children.get(f.contentWindow)||frameId; explicit=activeFrame!==frameId;
    window.__yiqikanInactiveFrame=activeFrame!==frameId; down({kind:'active',frameId:activeFrame});
    frameChrome=document.createElement('div');frameChrome.setAttribute('data-yk-frame-player','');
    frameChrome.innerHTML='<div data-yk-top><div data-yk-drag role="button" aria-label="拖动播放器"></div></div><div data-yk-frame-bottom></div>';
    frameChrome.querySelector('[data-yk-drag]').innerHTML=icon('grip');
    frameChrome.querySelector('[data-yk-top]').appendChild(iconButton('关闭异起看小窗','close',releaseIframe));
    frameChrome.querySelector('[data-yk-frame-bottom]').appendChild(iconButton('异起看全屏','fullscreen',function(){send({type:'REQUEST_FULLSCREEN'});}));
    var drag=null,handle=frameChrome.querySelector('[data-yk-drag]');
    handle.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY};handle.setPointerCapture(e.pointerId);e.preventDefault();});
    handle.addEventListener('pointermove',function(e){if(!drag)return;moveHosted(e.clientX-drag.x,e.clientY-drag.y,false);drag={x:e.clientX,y:e.clientY};});
    handle.addEventListener('pointerup',function(){drag=null;});handle.addEventListener('pointercancel',function(){drag=null;});
    document.documentElement.appendChild(frameChrome);positionFrameChrome(box);frameChrome.style.setProperty('--yk-scale',String(1/uiScale()));
    emitNative({frameId:frameId,payload:{type:'PLAYER_IFRAME_SELECTED',title:document.title}});scan();
  }
  function placeEntry(b,r,visible,ready) {
    var vp=viewport(), scale=uiScale(), w=96/scale, h=44/scale, pad=8/scale,gap=2/scale;
    var minX=vp.x+pad,maxX=vp.x+vp.w-w-pad,minY=vp.y+pad,maxY=vp.y+vp.h-h-pad,edges=[];
    var x1=Math.max(minX,Math.min(r.left,r.right-w)),x2=Math.min(maxX,Math.max(r.left,r.right-w));
    var y1=Math.max(minY,Math.min(r.top,r.bottom-h)),y2=Math.min(maxY,Math.max(r.top,r.bottom-h));
    function edge(name,x1,y1,x2,y2) { if(x1<=x2 && y1<=y2 && x1>=minX && x2<=maxX && y1>=minY && y2<=maxY) edges.push({name:name,x1:x1,y1:y1,x2:x2,y2:y2}); }
    edge('bottom',x1,r.bottom+gap,x2,r.bottom+gap);
    edge('top',x1,r.top-h-gap,x2,r.top-h-gap);
    edge('left',r.left-w-gap,y1,r.left-w-gap,y2);
    edge('right',r.right+gap,y1,r.right+gap,y2);
    b.__entryLayout={rect:r,viewport:vp,scale:scale,w:w,h:h,pad:pad,gap:gap,edges:edges};
    b.hidden=!visible || !edges.length || r.bottom<vp.y || r.top>vp.y+vp.h || r.right<vp.x || r.left>vp.x+vp.w;
    b.disabled=!ready; b.setAttribute('aria-label',ready?'异起看':'先在网页播放'); b.title=ready?'点击打开播放器，拖动可吸附视频四周':'请先在网页启动视频';
    b.style.setProperty('--yk-scale',String(1/scale));
    if(b.__entryDrag || !edges.length) return;
    var anchor=b.__entryAnchor || {edge:'bottom',t:1};
    var chosen=edges.find(function(e){return e.name===anchor.edge;}) || edges[0];
    b.setAttribute('data-yk-entry-edge',chosen.name);
    setEntryPosition(b,{x:chosen.x1+(chosen.x2-chosen.x1)*anchor.t,y:chosen.y1+(chosen.y2-chosen.y1)*anchor.t});
  }
  function setEntryPosition(b,p) { b.style.setProperty('left',p.x+'px','important');b.style.setProperty('top',p.y+'px','important'); }
  function sync(value) { if (localSync) localSync(value); }
  function wake() {
    if (!surface) return;
    surface.setAttribute('data-visible','true'); clearTimeout(idle);
    if (selected && !selected.paused && surface.querySelector('[data-yk-rates]').hidden) idle=setTimeout(function() { if (surface && selected && !selected.paused && !selected.seeking) surface.setAttribute('data-visible','false'); },4000);
  }
  function select(v, preservePlayback) {
    if (!v.isConnected) return;
    if (viewport().h * viewport().scale < 180) { send({type:'TOAST',message:'当前区域太小，请先收起面板或使用网页播放'}); return; }
    var previous=window.__yiqikanSelectedVideo || (window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo());
    if (selected) restore(true);
    selected=v; selectedSource=v.currentSrc || v.src || ''; controlsBefore=v.controls;
    window.__yiqikanSelectedVideo=v;
    send({type:'PLAYER_SELECTED',title:document.title || '当前视频',ratio:v.videoWidth/v.videoHeight||16/9});
    if(previous && previous!==v) previous.pause();
    var r=v.getBoundingClientRect();
    cover=document.createElement('div'); cover.setAttribute('data-yk-placeholder','');
    cover.style.cssText='width:'+r.width+'px;height:'+r.height+'px;background:#17191f;color:white;display:flex;align-items:center;justify-content:center;';
    cover.appendChild(button('视频在小窗播放 · 收回',function() { restore(true); }));
    v.parentNode.insertBefore(cover,v); unclip(v,changed);
    saveLayout(changed,v,defaultBox(v.videoWidth/v.videoHeight || 16/9)); v.controls=false;
    surface=document.createElement('div'); surface.setAttribute('data-yk-player','');
    surface.innerHTML='<div data-yk-controls><div data-yk-top><div data-yk-drag role="button" aria-label="拖动播放器"></div></div><div data-yk-center><span data-yk-status role="status"></span></div><div data-yk-bottom><input data-yk-seek type="range" min="0" max="1" step="0.1" aria-label="异起看播放进度"><div data-yk-actions><span data-yk-time></span></div></div><div data-yk-resize role="button" aria-label="缩放播放器"></div></div>';
    surface.querySelector('[data-yk-drag]').innerHTML=icon('grip');
    surface.querySelector('[data-yk-resize]').innerHTML=icon('resize');
    var togglePlay=function() {
      if (window.__isHost === false) {
        var resume=v.paused;
        if(resume && window.__yiqikanResumeInGesture) window.__yiqikanResumeInGesture();
        send({type:'PLAYER_CONTROL',action:resume?'resume':'pause'});
      }
      else sync({paused:!v.paused});
    };
    surface.querySelector('[data-yk-center]').appendChild(iconButton('异起看播放','play',togglePlay));
    surface.querySelector('[data-yk-top]').appendChild(iconButton('关闭异起看小窗','close',function() { restore(true); }));
    var actions=surface.querySelector('[data-yk-actions]');
    var playButton=iconButton('异起看暂停','pause',togglePlay); actions.insertBefore(playButton,actions.firstChild);
    var rateMenu=document.createElement('div'); rateMenu.setAttribute('data-yk-rates',''); rateMenu.hidden=true;
    [.75,1,1.25,1.5,2].forEach(function(rate) { rateMenu.appendChild(button(rate+'×',function() { sync({playbackRate:rate}); rateMenu.hidden=true; })); });
    var rateButton=button('异起看倍速',function() { if(window.__isHost===false) return; rateMenu.hidden=!rateMenu.hidden; });
    rateButton.setAttribute('data-yk-rate',''); actions.appendChild(rateButton);
    actions.appendChild(iconButton('异起看全屏','fullscreen',function() { send({type:'REQUEST_FULLSCREEN'}); }));
    // Anchor the menu to the whole picture, so wrapped rows can use its height.
    surface.appendChild(rateMenu);
    var slider=surface.querySelector('[data-yk-seek]'), sliding=false, pendingSeek=null;
    function paintSeek(value) {
      slider.style.setProperty('--yk-progress',Math.max(0,Math.min(100,value/Number(slider.max)*100))+'%');
      surface.querySelector('[data-yk-time]').textContent=time(value)+' / '+time(v.duration);
    }
    slider.addEventListener('pointerdown',function() { if(!slider.disabled) { sliding=true; pendingSeek=null; clearTimeout(idle); } });
    slider.addEventListener('input',function() { sliding=true; pendingSeek=null; clearTimeout(idle); paintSeek(Number(slider.value)); });
    slider.addEventListener('change',function() {
      if (window.__isHost !== false && isFinite(v.duration)) {
        var target=Number(slider.value);
        pendingSeek={time:target,origin:v.currentTime,at:Date.now()};
        sync({currentTime:target,paused:v.paused});
      }
      sliding=false; wake();
    });
    slider.addEventListener('pointerup',function() { setTimeout(function() {
      if(selected===v && surface && sliding) { sliding=false; surface.__update(); wake(); }
    },0); });
    slider.addEventListener('pointercancel',function() { sliding=false; pendingSeek=null; surface.__update(); wake(); });
    var handle=surface.querySelector('[data-yk-drag]'), drag=null;
    handle.addEventListener('pointerdown',function(e) { e.stopPropagation(); var x=root?e.clientX:e.screenX,y=root?e.clientY:e.screenY; drag={x:x,y:y,startX:x,startY:y,moved:false}; if(root) {var r=v.getBoundingClientRect();box={x:r.x,y:r.y,w:r.width,h:r.height,ratio:r.width/r.height};} handle.setPointerCapture(e.pointerId); clearTimeout(idle); });
    handle.addEventListener('pointermove',function(e) {
      if (!drag) return; var x=root?e.clientX:e.screenX,y=root?e.clientY:e.screenY,dx=x-drag.x,dy=y-drag.y;
      drag.moved=drag.moved || Math.hypot(x-drag.startX,y-drag.startY)>(root?3/uiScale():3); drag.x=x; drag.y=y;
      if (!root) send({type:'PLAYER_DRAG',dx:dx,dy:dy});
      else { box.x+=dx; box.y+=dy; constrain(box); resizeSelected('float'); }
    });
    function endDrag() {
      if (!drag) return; var moved=drag.moved; drag=null;
      if(!moved) { wake(); return; }
      if (!root) send({type:'PLAYER_DRAG',end:true});
      else { var vp=viewport(); box.x=box.x+box.w/2<vp.x+vp.w/2?vp.x:vp.x+vp.w-box.w; constrain(box); resizeSelected('float'); }
      wake();
    }
    handle.addEventListener('pointerup',endDrag); handle.addEventListener('pointercancel',endDrag);
    var resizeHandle=surface.querySelector('[data-yk-resize]'), resizing=null;
    function resizeBy(dx,dy,factor) {
      if(fullscreen) return;
      if(!root) send({type:'PLAYER_RESIZE',dx:dx,dy:dy,factor:factor});
      else { box=resizedBox(box,dx,dy,factor); resizeSelected('float'); }
    }
    resizeHandle.addEventListener('pointerdown',function(e) { e.stopPropagation(); resizing={x:root?e.clientX:e.screenX,y:root?e.clientY:e.screenY}; resizeHandle.setPointerCapture(e.pointerId); clearTimeout(idle); });
    resizeHandle.addEventListener('pointermove',function(e) {
      if(!resizing) return;
      var x=root?e.clientX:e.screenX,y=root?e.clientY:e.screenY;
      resizeBy(x-resizing.x,y-resizing.y); resizing={x:x,y:y};
    });
    function endResize() { resizing=null; wake(); }
    resizeHandle.addEventListener('pointerup',endResize); resizeHandle.addEventListener('pointercancel',endResize);
    var pointers=new Map(), pinchDistance=0, pinchActive=false;
    function distance() { var p=Array.from(pointers.values()); return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0; }
    surface.addEventListener('pointerdown',function(e) {
      pointers.set(e.pointerId,{x:e.screenX,y:e.screenY});
      if(pointers.size===2 && !fullscreen) { pinchDistance=distance(); pinchActive=true; drag=null; resizing=null; clearTimeout(idle); pointers.forEach(function(_,id) { surface.setPointerCapture(id); }); e.preventDefault(); e.stopPropagation(); }
    },true);
    surface.addEventListener('pointermove',function(e) {
      if(!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId,{x:e.screenX,y:e.screenY});
      if(pinchActive && pointers.size===2) { var d=distance(); if(pinchDistance>0) resizeBy(0,0,d/pinchDistance); pinchDistance=d; e.preventDefault(); e.stopPropagation(); }
    },true);
    function endPinch(e) { pointers.delete(e.pointerId); if(pinchActive) { e.stopPropagation(); if(pointers.size<2) { pinchActive=false; pinchDistance=0; wake(); } } }
    surface.addEventListener('pointerup',endPinch,true); surface.addEventListener('pointercancel',endPinch,true);
    document.documentElement.appendChild(surface); box=defaultBox(v.videoWidth/v.videoHeight || 16/9); resizeSelected('float');
    surface.addEventListener('click',function(e) {
      e.stopPropagation();
      if(e.target.closest('button,input,[data-yk-drag],[data-yk-resize],[data-yk-rates]')) return;
      if(fullscreen) { send({type:'TOGGLE_CONTROLS'}); return; }
      if(!rateMenu.hidden) { rateMenu.hidden=true; wake(); return; }
      if(surface.getAttribute('data-visible')==='false') wake();
      else if(!v.paused && !v.seeking && rateMenu.hidden) { clearTimeout(idle); surface.setAttribute('data-visible','false'); }
    });
    v.addEventListener('click',wake);
    setTimeout(function() {
      if (selected!==v || mode!=='float' || !surface) return;
      var actual=v.getBoundingClientRect(), expected=surface.getBoundingClientRect();
      if (Math.abs(actual.left-expected.left)>4 || Math.abs(actual.top-expected.top)>4 || Math.abs(actual.width-expected.width)>4 || Math.abs(actual.height-expected.height)>4) {
        restore(true); send({type:'TOAST',message:'这个网页暂不支持小窗，已恢复网页播放'});
      }
    },300);
    var waitingSince=0;
    surface.__update=function() {
      if (!selected) return;
      var label='异起看'+(window.__isHost===false ? (v.paused?'继续跟播':'本机暂停') : (v.paused?'播放':'暂停'));
      surface.setAttribute('data-paused',String(v.paused));
      var playerRect=surface.getBoundingClientRect();
      var compact=playerRect.width*uiScale()<240;
      surface.setAttribute('data-compact',String(compact));
      surface.setAttribute('data-short',String(playerRect.height*uiScale()<164));
      surface.querySelector('[data-yk-center] button').setAttribute('aria-label',label);
      playButton.setAttribute('aria-label',label);
      if(playButton.__paused!==v.paused) { playButton.innerHTML=icon(v.paused?'play':'pause'); playButton.__paused=v.paused; }
      slider.disabled=window.__isHost===false || !isFinite(v.duration) || v.duration<=0 || !v.seekable || !v.seekable.length;
      if(pendingSeek && ((!v.seeking && v.readyState>=2 && Math.abs(v.currentTime-pendingSeek.time)<.5
        && (v.currentTime!==pendingSeek.origin || Math.abs(pendingSeek.time-pendingSeek.origin)<.05)) || Date.now()-pendingSeek.at>10000)) pendingSeek=null;
      if (!sliding) { slider.max=isFinite(v.duration)&&v.duration>0?v.duration:1; slider.value=pendingSeek?pendingSeek.time:v.currentTime; }
      slider.style.setProperty('--yk-progress',Math.max(0,Math.min(100,Number(slider.value)/Number(slider.max)*100))+'%');
      rateButton.disabled=window.__isHost===false;
      rateButton.textContent=(v.playbackRate || 1)+'×';
      if (!sliding) surface.querySelector('[data-yk-time]').textContent=time(pendingSeek?pendingSeek.time:v.currentTime)+(compact?'':' / '+(isFinite(v.duration)&&v.duration>0?time(v.duration):'--:--'));
      var waiting=!v.paused && v.readyState<3;
      if(waiting && !waitingSince) waitingSince=Date.now(); if(!waiting) waitingSince=0;
      // A short looping clip seeks to zero internally. It must not reveal the
      // controls every lap or reset the idle timer on each "playing" event.
      var seeking=v.seeking && !(v.loop && v.currentTime<.3 && !sliding);
      var showWaiting=waiting && Date.now()-waitingSince>800;
      surface.querySelector('[data-yk-status]').textContent=v.error?'播放暂时不可用，可收回到网页':seeking?'正在跳转':waiting && Date.now()-waitingSince>8000?'加载较慢，可收回到网页':showWaiting?'正在加载':'';
      var blocked=v.paused || seeking || showWaiting || Boolean(v.error);
      if (blocked) { wake(); clearTimeout(idle); }
      else if(surface.__blocked) wake();
      surface.__blocked=blocked;
    };
    ['play','pause','timeupdate','seeking','seeked','loadedmetadata','waiting','playing','error','ratechange'].forEach(function(event) {
      var callback=function() { if(selected===v && surface) { surface.__update(); if(event==='play') wake(); } };
      v.addEventListener(event,callback); selectedListeners.push({video:v,event:event,callback:callback});
    });
    // This call remains in the original trusted click, important on iOS.
    if (window.__isHost !== false && !preservePlayback) sync({paused:false});
    else send({type:'REQUEST_RESYNC'});
    scan(); wake();
  }
  function time(n) { n=Math.max(0,Math.floor(n || 0)); return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
  function scan() {
    if (!document.body) return;
    if(hosted && !hosted.isConnected) expireFrame();
    if(theaterVideo && !theaterVideo.isConnected){undo(theaterChanges);theaterVideo=null;send({type:'PLAYER_EXPIRED'});}
    var videos=document.querySelectorAll('video,bwp-video');
    entries.forEach(function(entry,v) { if (!v.isConnected) { if(!root) send({type:'PLAYER_CANDIDATE',id:entry.getAttribute('data-yk-entry'),visible:false,ready:false}); entry.remove(); entries.delete(v); } });
    for (var i=0;i<videos.length;i++) {
      var v=videos[i]; if (v.id==='yiqikan-local-video' || v.VideoTogetherDisabled) continue;
      var r=v.getBoundingClientRect();
      if (!entries.has(v)) {
        (function(video) {
          var b=entryButton(function() { select(video); });
          document.documentElement.appendChild(b); entries.set(video,b);
        })(v);
      }
      var b=entries.get(v), vp=viewport(), ready=Boolean(localSync && (v.currentSrc || v.src || v.querySelector('source')));
      var allowed=typeof v.play==='function' && typeof v.pause==='function' && (!window.__yiqikanIsVideoCandidate || window.__yiqikanIsVideoCandidate(v));
      var visible=allowed && !selected && !hosted && r.width>=100 && r.height>=60 && r.bottom>vp.y && r.top<vp.y+vp.h && getComputedStyle(v).visibility!=='hidden';
      placeEntry(b,r,visible,ready);
      if(!root) {
        // A child frame cannot paint outside its own bounds. Put its entry below
        // the parent iframe when the local video leaves no room for the badge.
        var candidateVisible=visible && b.hidden, state=String(candidateVisible)+':'+String(ready);
        if(b.__candidateState!==state) { b.__candidateState=state; send({type:'PLAYER_CANDIDATE',id:b.getAttribute('data-yk-entry'),visible:candidateVisible,ready:ready}); }
      }
    }
    var candidates=root?playerIframes():[];
    frameEntries.forEach(function(candidate,key) {
      var iframe=iframeFor(candidate.source);
      if(!iframe) { candidate.button.remove(); frameEntries.delete(key); return; }
      // Keep the original iframe usable while its injected playback bridge is
      // loading; an unready relayed badge must not replace the working entry.
      var fallback=!candidate.ready && candidates.indexOf(iframe)>=0;
      placeEntry(candidate.button,iframe.getBoundingClientRect(),candidate.visible && !selected && !hosted && !fallback,candidate.ready);
    });
    if(root) {
      iframeEntries.forEach(function(b,f){if(!f.isConnected){b.remove();iframeEntries.delete(f);}});
      candidates.forEach(function(f){
        var b=iframeEntries.get(f);if(!b){b=entryButton(function(){openIframe(f);});iframeEntries.set(f,b);document.documentElement.appendChild(b);}
        var current=window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo();
        var relayedEntry=false;
        frameEntries.forEach(function(candidate){if(candidate.source===f.contentWindow && candidate.visible && candidate.ready)relayedEntry=true;});
        var r=f.getBoundingClientRect(),visible=!selected&&!hosted&&!theaterVideo&&!relayedEntry&&!(current && current.ownerDocument===document)&&!mediaFrames.has(children.get(f.contentWindow));
        placeEntry(b,r,visible,true);b.setAttribute('aria-label','异起看网页播放器');b.title='打开网页播放器，保留原网站播放控件';
      });
      iframeEntries.forEach(function(b,f){if(candidates.indexOf(f)<0)b.hidden=true;});
    }
    if (selected && (!selected.isConnected || (selected.currentSrc || selected.src || '')!==selectedSource)) { var previousMode=mode;if(window.__resetVideoSync) window.__resetVideoSync(); restore(true,true); send({type:'PLAYER_EXPIRED',previousMode:previousMode,message:'视频已切换'}); }
    if (surface && surface.__update) surface.__update();
    if(root && activeFrame===frameId)reportMedia({frameId:frameId,payload:{}});
  }
  function pauseAll() {
    if(window.__resetVideoSync)window.__resetVideoSync();
    document.querySelectorAll('video,bwp-video').forEach(function(v){try{v.pause();}catch(_){}});
    if(localSync)localSync({paused:true});
    down({kind:'command',frameId:activeFrame,method:'pauseAll'});
  }
  function present(value) {
    if(root && activeFrame!==frameId){down({kind:'command',frameId:activeFrame,method:'present',value:value});return;}
    var v=window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo();
    if(!v || v.ownerDocument!==document || v.readyState<1)return;
    if(value==='floating' || value==='fullscreen'){select(v,true);if(value==='fullscreen')window.__yiqikanPlayer.fullscreen(true);}
  }
  function followMedia(media, retried) {
    if(!root || !media || !media.episode)return false;
    var expected=media.episode, nodes=episodeOptions().filter(function(n){var r=n.getBoundingClientRect();return r.width>0 && r.height>0 && getComputedStyle(n).visibility!=='hidden';});
    var matches=nodes.filter(function(n){return episodeIdentity(label(n))===episodeIdentity(expected.label);});
    // Match an existing page control; never copy a host's tokenized iframe/CDN URL.
    var exact=matches.filter(function(n){return expected.url && n.href===expected.url;});
    var node=exact.length===1?exact[0]:matches.length===1?matches[0]:null;
    var named=/^(第\s*\d+\s*集|EP\s*\d+)$/i.test(expected.label);
    var known=episodeOptions().some(function(n){return n.matches(episodeSelector)&&episodeIdentity(label(n))===episodeIdentity(expected.label);});
    if(!node && !retried && (named || known)) {
      var menus=Array.from(document.querySelectorAll('button,[role="button"],a')).filter(function(n){var r=n.getBoundingClientRect();return /^(选集|展开选集)$/.test(label(n)) && r.width>0 && r.height>0;});
      if(menus.length===1){menus[0].click();setTimeout(function(){followMedia(media,true);},250);return true;}
    }
    if(!node)return false;
    if(node.href && /^https?:/.test(node.href))emitNative({frameId:activeFrame,payload:{type:'PLAYER_EPISODE_NAVIGATION',url:node.href}});
    var current=currentEpisode();
    if(current && episodeIdentity(current.label)===episodeIdentity(expected.label) && mediaKey && lastMediaContext && lastMediaContext.ready) {
      emitNative({frameId:activeFrame,payload:Object.assign({type:'MEDIA_CONTEXT'},lastMediaContext)});return true;
    }
    pendingEpisode={label:label(node),url:node.href || undefined};
    var allowed=window.__canNavigate;window.__canNavigate=true;
    try{node.click();}finally{window.__canNavigate=allowed;}
    return true;
  }
  var localSync=null,localQuery=null;
  function attach() {
    var bridge=window.ReactNativeWebView && window.ReactNativeWebView.postMessage;
    if (bridge && !bridge.__ykTransport) {
      if(root) nativePost=bridge.bind(window.ReactNativeWebView);
      window.ReactNativeWebView.postMessage=transport;
      if(root) send({type:'PLAYER_DOCUMENT'});
    }
    if (window.__syncCmd && !window.__syncCmd.__ykRouted) {
      localSync=window.__syncCmd;
      window.__syncCmd=function(value) {
        policy();
        // Presentation belongs to the parent even if the embedded player has
        // a stale bridge or has not finished loading its document.
        if(root && passthrough && hosted && typeof value.fullscreen==='boolean')showIframe(childWindow,value.fullscreen?'fullscreen':'float');
        if (root && activeFrame!==frameId) down({kind:'command',frameId:activeFrame,method:'sync',value:value});
        else localSync(value);
      }; window.__syncCmd.__ykRouted=true;
      // Embedded WebKit documents can throttle their periodic scan. Refresh
      // readiness as soon as the playback bridge arrives. Install styles first
      // when document-start injection ran before <head> was available.
      installCss(); scan();
    }
    if (window.__queryRealtimeStatus && !window.__queryRealtimeStatus.__ykRouted) {
      localQuery=window.__queryRealtimeStatus;
      window.__queryRealtimeStatus=function(id) {
        if (root && activeFrame!==frameId) down({kind:'command',frameId:activeFrame,method:'query',value:id}); else localQuery(id);
      }; window.__queryRealtimeStatus.__ykRouted=true;
    }
  }
  function policy() {
    if (!root) return;
    var values={__isHost:window.__isHost,__canNavigate:window.__canNavigate,__followSyncEnabled:window.__followSyncEnabled};
    var key=JSON.stringify(values); if (key!==lastPolicy) { lastPolicy=key; down({kind:'policy',values:values}); }
  }
  window.__yiqikanPlayer={attach:attach,present:present,pauseAll:pauseAll,followMedia:followMedia,wake:function(){if(root && activeFrame!==frameId)down({kind:'command',frameId:activeFrame,method:'wake'});else wake();},invalidateContext:function(){mediaKey='';},fullscreen:function(value) {
    if (!selected) {
      if(!value && theaterVideo) {undo(theaterChanges);theaterVideo=null;if(root && hosted)restoreHosted();if(!root)framePresentation('inline');scan();return true;}
      var video=window.__yiqikanCurrentVideo && window.__yiqikanCurrentVideo();
      if(value && video) {
        if(theaterVideo!==video){undo(theaterChanges);theaterVideo=video;unclip(video,theaterChanges);}
        var bounds=fullBox();
        if(root && video.ownerDocument!==document) {
          // Android injects only the main document. Its same-origin fallback can
          // still style the actual nested video and every containing iframe.
          var child=video.ownerDocument.defaultView;
          try {
            while(child && child!==window) {
              var frame=child.frameElement;if(!frame)break;
              if(frame.ownerDocument===document){showIframe(child,'fullscreen');break;}
              unclip(frame,theaterChanges);saveStyle(theaterChanges,frame,rectStyles({x:0,y:0,w:bounds.w,h:bounds.h}));
              child=child.parent;
            }
          }catch(_){}
          bounds={x:0,y:0,w:bounds.w,h:bounds.h};
        }
        saveStyle(theaterChanges,video,Object.assign(rectStyles(bounds),{'object-fit':'contain','background':'#000','border-radius':'0'}));
        if(!root)framePresentation('fullscreen');return true;
      }
      if(root && !video) {
        var iframe=hosted || playerIframes()[0];
        if(iframe){showIframe(iframe.contentWindow,value?'fullscreen':passthrough?'float':'inline');return true;}
      }
      if(!root)framePresentation(value?'fullscreen':'inline');return false;
    }
    resizeSelected(value?'fullscreen':'float'); return true;
  },restore:function() {
    if(theaterVideo){undo(theaterChanges);theaterVideo=null;if(root && hosted)restoreHosted();send({type:'PLAYER_RELEASED'});return;}
    if(root && passthrough){releaseIframe();return;}
    if (root && activeFrame!==frameId) down({kind:'command',frameId:activeFrame,method:'restore'}); else restore(true);
  }};
  function installCss() {
    if (!document.head || document.getElementById('yiqikan-player-css')) return;
    var s=document.createElement('style'); s.id='yiqikan-player-css';
    s.textContent=[
      // Sizes use physical points even on desktop pages zoomed out by WebKit.
      '[data-yk-entry]{all:initial!important;position:fixed!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:calc(5px * var(--yk-scale,1))!important;width:calc(96px * var(--yk-scale,1))!important;height:calc(44px * var(--yk-scale,1))!important;color:#fff!important;font:600 calc(12px * var(--yk-scale,1)) system-ui!important;cursor:grab!important;touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important;text-shadow:0 1px 2px rgba(124,45,18,.24)!important;}',
      '[data-yk-entry]::before{content:""!important;position:absolute!important;inset:calc(6px * var(--yk-scale,1)) 0!important;pointer-events:none!important;border-radius:999px!important;background:linear-gradient(155deg,rgba(255,139,36,.97),rgba(249,115,22,.97) 55%,rgba(234,88,12,.98))!important;border:1px solid rgba(224,90,12,.55)!important;border-top-color:rgba(255,165,73,.95)!important;box-shadow:inset 0 -1px 0 rgba(172,53,5,.15),0 3px 8px rgba(194,74,7,.23)!important;backdrop-filter:blur(10px) saturate(140%)!important;-webkit-backdrop-filter:blur(10px) saturate(140%)!important;}',
      '[data-yk-entry][data-yk-entry-dragging]{cursor:grabbing!important;}[data-yk-entry]:active::before{filter:brightness(.96)!important;}',
      '[data-yk-entry] span,[data-yk-entry] svg{position:relative!important;color:inherit!important;pointer-events:none!important;}',
      '[data-yk-entry] svg{width:calc(14px * var(--yk-scale,1))!important;height:calc(14px * var(--yk-scale,1))!important;flex:none!important;}',
      '[data-yk-entry][hidden]{display:none!important;}[data-yk-entry]:disabled{opacity:.55!important;}',
      '[data-yk-player]{box-sizing:border-box!important;border-radius:calc(12px * var(--yk-scale,1))!important;box-shadow:0 6px 24px rgba(0,0,0,.3)!important;outline:1px solid rgba(255,255,255,.15)!important;touch-action:none!important;overflow:hidden!important;}',
      '[data-yk-player] *{box-sizing:border-box!important;}',
      '[data-yk-player] button,[data-yk-frame-player] button{all:initial!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:calc(40px * var(--yk-scale,1))!important;height:calc(44px * var(--yk-scale,1))!important;flex:none!important;color:#fff!important;font:600 calc(12px * var(--yk-scale,1)) system-ui!important;cursor:pointer!important;pointer-events:auto!important;touch-action:manipulation!important;text-shadow:0 1px 3px rgba(0,0,0,.4)!important;}',
      '[data-yk-frame-player]{z-index:2147483647!important;pointer-events:none!important;background:transparent!important;overflow:hidden!important;border-radius:calc(12px * var(--yk-scale,1))!important;}[data-yk-frame-player][hidden]{display:none!important;}[data-yk-frame-bottom]{position:absolute!important;right:0!important;bottom:0!important;pointer-events:none!important;}',
      '[data-yk-player] button:disabled{opacity:.45!important;}[data-yk-player] button:focus-visible,[data-yk-entry]:focus-visible{outline:2px solid #fb923c!important;outline-offset:-3px!important;border-radius:8px!important;}',
      '[data-yk-player] button:active{opacity:.65!important;}',
      '[data-yk-player] svg,[data-yk-frame-player] svg{display:block!important;width:calc(19px * var(--yk-scale,1))!important;height:calc(19px * var(--yk-scale,1))!important;flex:none!important;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}',
      '[data-yk-controls]{position:absolute!important;inset:0!important;pointer-events:none!important;}',
      '[data-yk-top]{position:absolute!important;left:0!important;right:0!important;top:0!important;height:calc(40px * var(--yk-scale,1))!important;display:flex!important;background:linear-gradient(rgba(0,0,0,.48),transparent)!important;transition:opacity .18s;}',
      '[data-yk-top] button{position:absolute!important;right:0!important;top:0!important;width:calc(40px * var(--yk-scale,1))!important;height:calc(36px * var(--yk-scale,1))!important;}',
      '[data-yk-drag]{position:absolute!important;left:calc(40px * var(--yk-scale,1))!important;right:calc(40px * var(--yk-scale,1))!important;top:0!important;height:calc(28px * var(--yk-scale,1))!important;display:flex!important;align-items:center!important;justify-content:center!important;color:rgba(255,255,255,.8)!important;pointer-events:auto!important;touch-action:none!important;cursor:grab!important;}',
      '[data-yk-drag] svg{width:calc(24px * var(--yk-scale,1))!important;height:calc(20px * var(--yk-scale,1))!important;}',
      '[data-yk-center]{position:absolute!important;inset:0!important;display:flex!important;flex-direction:column!important;justify-content:center!important;align-items:center!important;gap:calc(8px * var(--yk-scale,1))!important;pointer-events:none!important;}',
      '[data-yk-center] button{width:calc(46px * var(--yk-scale,1))!important;height:calc(46px * var(--yk-scale,1))!important;border-radius:50%!important;background:rgba(15,18,25,.42)!important;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
      '[data-yk-center] button svg{width:calc(24px * var(--yk-scale,1))!important;height:calc(24px * var(--yk-scale,1))!important;}',
      '[data-yk-player][data-paused=false] [data-yk-center] button{display:none!important;}',
      '[data-yk-bottom]{position:absolute!important;bottom:0!important;left:0!important;right:0!important;padding:calc(14px * var(--yk-scale,1)) calc(6px * var(--yk-scale,1)) calc(2px * var(--yk-scale,1))!important;background:linear-gradient(transparent,rgba(0,0,0,.64))!important;color:white!important;pointer-events:auto!important;transition:opacity .18s;}',
      '[data-yk-seek]{all:initial!important;display:block!important;box-sizing:border-box!important;-webkit-appearance:none!important;appearance:none!important;width:calc(100% - 8px * var(--yk-scale,1))!important;height:calc(28px * var(--yk-scale,1))!important;margin:0 calc(4px * var(--yk-scale,1)) calc(-7px * var(--yk-scale,1))!important;cursor:pointer!important;touch-action:none!important;}',
      '[data-yk-seek]::-webkit-slider-runnable-track{height:calc(3px * var(--yk-scale,1));background:linear-gradient(to right,#fb923c var(--yk-progress,0%),rgba(255,255,255,.35) var(--yk-progress,0%));border-radius:99px;}',
      '[data-yk-seek]::-webkit-slider-thumb{-webkit-appearance:none;width:calc(12px * var(--yk-scale,1));height:calc(12px * var(--yk-scale,1));margin-top:calc(-4.5px * var(--yk-scale,1));border-radius:50%;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.3);}',
      '[data-yk-seek]:disabled{opacity:.55!important;}',
      '[data-yk-actions]{display:flex!important;align-items:center!important;gap:0!important;}',
      '[data-yk-time]{flex:1!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font:500 calc(10px * var(--yk-scale,1)) system-ui!important;font-variant-numeric:tabular-nums!important;color:rgba(255,255,255,.9)!important;text-shadow:0 1px 3px #000!important;pointer-events:none!important;}',
      '[data-yk-actions] button:last-child{margin-right:calc(15px * var(--yk-scale,1))!important;}',
      '[data-yk-resize]{position:absolute!important;bottom:0!important;right:0!important;width:calc(24px * var(--yk-scale,1))!important;height:calc(28px * var(--yk-scale,1))!important;display:flex!important;align-items:flex-end!important;justify-content:flex-end!important;padding:calc(3px * var(--yk-scale,1))!important;color:rgba(255,255,255,.7)!important;cursor:nwse-resize!important;pointer-events:auto!important;touch-action:none!important;}',
      '[data-yk-resize] svg{width:calc(14px * var(--yk-scale,1))!important;height:calc(14px * var(--yk-scale,1))!important;}',
      '[data-yk-player][data-visible=false] [data-yk-top],[data-yk-player][data-visible=false] [data-yk-center],[data-yk-player][data-visible=false] [data-yk-bottom]{opacity:0!important;pointer-events:none!important;}',
      '[data-yk-player][data-visible=false] button,[data-yk-player][data-visible=false] input{pointer-events:none!important;visibility:hidden!important;}',
      '[data-yk-player][data-visible=false] [data-yk-resize]{opacity:.25!important;}',
      '[data-yk-rates]{position:absolute!important;right:calc(8px * var(--yk-scale,1))!important;bottom:calc(66px * var(--yk-scale,1))!important;display:flex!important;flex-wrap:wrap!important;max-width:calc(100% - 16px * var(--yk-scale,1))!important;max-height:calc(100% - 8px * var(--yk-scale,1))!important;overflow-y:auto!important;touch-action:pan-y!important;background:rgba(17,20,27,.92)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12)!important;border-radius:calc(10px * var(--yk-scale,1))!important;pointer-events:auto!important;padding:calc(3px * var(--yk-scale,1))!important;}',
      '[data-yk-rates] button{width:calc(46px * var(--yk-scale,1))!important;}[data-yk-rates][hidden]{display:none!important;}',
      '[data-yk-player][data-compact=true] [data-yk-rates],[data-yk-player][data-short=true] [data-yk-rates]{bottom:calc(4px * var(--yk-scale,1))!important;}',
      '[data-yk-placeholder] button,[data-yk-frame-placeholder] button{font:500 14px system-ui;color:white;background:#343640;border:0;border-radius:18px;min-height:44px;padding:10px 14px;}',
      '[data-yk-status]{max-width:85%!important;text-align:center!important;font:500 calc(11px * var(--yk-scale,1)) system-ui!important;color:white!important;background:rgba(15,18,25,.7)!important;padding:calc(6px * var(--yk-scale,1)) calc(10px * var(--yk-scale,1))!important;border-radius:8px!important;}',
      '[data-yk-status]:empty{display:none!important;}'
    ].join('');
    document.head.appendChild(s);
  }
  function refreshLayout() { if(selected)resizeSelected(mode);if(theaterVideo)window.__yiqikanPlayer.fullscreen(true);if(hosted&&root)showIframe(childWindow,fullscreen?'fullscreen':'float');scan(); }
  window.addEventListener('resize',refreshLayout);
  window.addEventListener('scroll',scan,{passive:true});
  // Suppress drag-generated clicks before document capture handlers can toggle
  // native controls or trigger the website. Ordinary trusted taps still pass.
  window.addEventListener('click',function(event) {
    var target=event.target,entry=target && target.closest && target.closest('[data-yk-entry]');
    if(entry && entry.__suppressEntryClick && event.detail!==0) { event.preventDefault();event.stopImmediatePropagation(); }
  },true);
  document.addEventListener('click',function(event) {
    var option=optionFor(event.target);
    if(root && option && label(option) && !option.closest('[data-yk-player],[data-yk-frame-player]')) {
      var next={label:label(option),url:option.href || undefined};
      if(!currentEpisode() || episodeIdentity(next.label)!==episodeIdentity(currentEpisode().label)) {
        mediaContext.noteSelection(event.target);
        pendingEpisode=next;
        var pendingContext=mediaContext.read(null,{source:'pending-selection',ready:false});
        emitNative({frameId:activeFrame,payload:Object.assign({type:'MEDIA_CONTEXT'},pendingContext,{ready:false})});
      }
    }
    if(selected && event.target===selected && !fullscreen) { wake(); event.preventDefault(); event.stopImmediatePropagation(); }
  },true);
  if (window.visualViewport) { window.visualViewport.addEventListener('resize',refreshLayout); window.visualViewport.addEventListener('scroll',scan); }
  window.addEventListener('pagehide',function() {
    var presented=Boolean(selected || hosted || theaterVideo),previousMode=fullscreen || theaterVideo?'fullscreen':selected?'floating':hosted?'floating':'page';
    pauseAll();if(selected)restore(false,true);restoreHosted();
    if(presented)send({type:'PLAYER_RELEASED',reason:'navigation',previousMode:previousMode});
  });
  window.addEventListener('pageshow',function(event){if(event.persisted){mediaKey='';if(root)send({type:'PLAYER_DOCUMENT'});attach();scan();}});
  setInterval(function() { installCss(); attach(); policy(); scan(); },500);
  installCss(); attach(); scan();
  if (root) send({type:'PLAYER_DOCUMENT'});
})(__SESSION_JSON__);
true;
`;
