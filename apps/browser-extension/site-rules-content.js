// Generated from packages/shared/src/site-rules/page-script.ts. Do not edit.
window.__yiqikanInstallSiteRules = function(snapshot) {
(function(snapshot) {
  if (window.__yiqikanSiteRules) return;
  var profile = null, events = [], disabled = false;
  function record(capability, status, reason) {
    var last = events[events.length - 1];
    if (last && last.capability === capability && last.status === status && last.reason === reason) { last.count = Math.min(last.count + 1, 1000000); return; }
    events.push({capability:capability,status:status,reason:reason,count:1});
    if (events.length > 32) events.shift();
  }
  function version(v) { return v.split('.').map(Number); }
  function compare(a,b) { a=version(a); b=version(b); for(var i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1; return 0; }
  function matches(rule) {
    try {
      var u = new URL(location.href);
      var matchedHost=rule.match.hosts.indexOf(u.hostname)>=0 || (rule.match.numericHosts || []).some(function(p){
        var suffix='.'+p.suffix;
        if(u.hostname.indexOf(p.prefix)!==0 || u.hostname.slice(-suffix.length)!==suffix)return false;
        var digits=u.hostname.slice(p.prefix.length,-suffix.length);
        return digits.length>=p.minDigits && digits.length<=p.maxDigits && /^[0-9]+$/.test(digits);
      });
      return /^https?:$/.test(u.protocol) && matchedHost && rule.match.pathPrefixes.some(function(p){return u.pathname.indexOf(p)===0;});
    } catch (_) { return false; }
  }
  if (snapshot && snapshot.release.enabled && snapshot.release.expiresAt > Date.now()) {
    var rules = snapshot.release.rules.filter(function(r) {
      return r.platforms.indexOf(snapshot.platform)>=0 && compare(snapshot.clientVersion,r.clientVersions.min)>=0
        && compare(snapshot.clientVersion,r.clientVersions.max)<=0 && matches(r);
    }).sort(function(a,b){return b.priority-a.priority;});
    if (rules.length && (rules.length===1 || rules[0].priority!==rules[1].priority)) profile=rules[0];
    else if(rules.length)record('profile','abstain','ambiguous-profile');
  }
  function result(capability,status,reason,value) {
    record(capability,status,reason);
    return {status:status,reason:reason,value:value};
  }
  function canRead(capability) {
    if(disabled || !profile || !matches(profile) || !snapshot || snapshot.release.expiresAt<=Date.now())return false;
    return Boolean(profile.capabilities[capability]);
  }
  function resolved(capability,value) {
    return profile.mode==='active' ? result(capability,'applied','matched',value) : result(capability,'abstain','observe');
  }
  var playback = null;
  function own(value,key) {
    var d=value && typeof value==='object' && Object.getOwnPropertyDescriptor(value,key);
    return d && Object.prototype.hasOwnProperty.call(d,'value') ? d.value : undefined;
  }
  function playbackId(value,c) {
    return typeof value==='string' && value.indexOf(c.idPrefix)===0 && /^[A-Za-z0-9_-]{8,240}$/.test(value.slice(c.idPrefix.length));
  }
  if(profile && profile.capabilities.playbackPage) {
    window.addEventListener(profile.capabilities.playbackPage.event,function(event){
      if(!canRead('playbackPage'))return;
      var c=profile.capabilities.playbackPage,f=c.fields,value=event.detail;
      if(own(value,f.active)!==true){playback=null;return;}
      var id=own(value,f.id);if(!playbackId(id,c)){playback=null;return;}
      var name=own(value,f.title),episode=Number(own(value,f.episode));
      playback={id:id,title:typeof name==='string'?name.replace(/\s+/g,' ').trim().slice(0,300):undefined,
        episode:Number.isInteger(episode)&&episode>0&&episode<1000000?episode:null};
    });
  }
  function playbackPage() {
    if(!canRead('playbackPage'))return {status:'unsupported'};
    try {
      var c=profile.capabilities.playbackPage,u=new URL(location.href);
      if(u.protocol!=='https:' || u.username || u.password)return result('playbackPage','abstain','unsafe-page');
      var privatePage=c.privatePathPrefixes.some(function(p){return u.pathname.indexOf(p)===0;});
      var id=privatePage?playback&&playback.id:u.pathname.indexOf(c.playerPathPrefix)===0?u.pathname.slice(c.playerPathPrefix.length):null;
      if(!playbackId(id,c))return resolved('playbackPage',{privatePage:privatePage});
      var state=playback&&playback.id===id?playback:null;
      var episode=state&&state.episode || Number(u.searchParams.get(c.episodeQuery));
      if(!Number.isInteger(episode)||episode<=0||episode>=1000000)episode=null;
      var route=new URL(c.playerPathPrefix+id,u.origin),identityUrl=route.href;
      if(episode)route.searchParams.set(c.episodeQuery,String(episode));
      var selectedLabel,episodeMetadata;
      // Only an opted-in site profile may replace its numeric fallback label
      // with selected DOM metadata. Ambiguous/oversized queries give no proof.
      if(c.selectedEpisode) {
        var labels=[],scanned=0,valid=true;
        for(var i=0;i<c.selectedEpisode.selectors.length;i++) {
          var nodes=document.querySelectorAll(c.selectedEpisode.selectors[i]);
          scanned+=nodes.length;if(scanned>32){valid=false;break;}
          for(var j=0;j<nodes.length;j++) {
            var label=String(nodes[j].textContent || '').slice(0,2000).replace(/\s+/g,' ').trim();
            if(label.length>c.selectedEpisode.maxChars){valid=false;break;}
            if(label && labels.indexOf(label)<0)labels.push(label);
          }
          if(!valid)break;
        }
        if(valid && labels.length<=1) {
          selectedLabel=labels[0];
          episodeMetadata={positionKey:episode?identityUrl+'|'+episode:undefined,
            selectionKey:selectedLabel?identityUrl+'|'+selectedLabel:undefined};
        }
      }
      return resolved('playbackPage',{privatePage:privatePage,shareUrl:privatePage?route.href:undefined,
        identityUrl:identityUrl,title:state&&state.title||undefined,
        episode:selectedLabel?{label:selectedLabel}:episode?{label:c.episodeLabel.prefix+episode+c.episodeLabel.suffix}:undefined,
        episodeMetadata:episodeMetadata});
    }catch(_){return result('playbackPage','abstain','invalid-metadata');}
  }
  function title() {
    if(!canRead('title'))return {status:'unsupported'};
    try {
      var c=profile.capabilities.title;
      for(var i=0;i<c.selectors.length;i++) {
        var n=document.querySelector(c.selectors[i]);
        var value=n && String(n.textContent || '').slice(0,2000).replace(/\s+/g,' ').trim().slice(0,c.maxChars);
        if(value)return resolved('title',value);
      }
      return result('title','abstain','no-match');
    }catch(_){disabled=true;return result('title','error','query-failed');}
  }
  function mediaCandidates() {
    if(!canRead('mediaCandidates'))return {status:'unsupported'};
    try {
      var c=profile.capabilities.mediaCandidates, nodes=[], scanned=0;
      for(var i=0;i<c.selectors.length;i++) {
        var found=document.querySelectorAll(c.selectors[i]);
        if(scanned+found.length>100)return result('mediaCandidates','abstain','candidate-limit');
        scanned+=found.length;
        for(var j=0;j<found.length;j++) {
          var n=found[j];
          if(!/^(VIDEO|BWP-VIDEO)$/.test(n.tagName) || nodes.indexOf(n)>=0 || !n.isConnected || c.excludeWithin.some(function(s){return Boolean(n.closest(s));}))continue;
          var r=n.getBoundingClientRect(), style=getComputedStyle(n);
          if(r.width>=100 && r.height>=60 && style.visibility!=='hidden' && style.display!=='none' && typeof n.play==='function' && typeof n.pause==='function')nodes.push(n);
        }
      }
      if(nodes.length!==1)return result('mediaCandidates','abstain',nodes.length?'ambiguous-candidate':'no-match');
      return resolved('mediaCandidates',nodes[0]);
    }catch(_){disabled=true;return result('mediaCandidates','error','query-failed');}
  }
  // No setter or remote message listener: this snapshot is pinned to the page.
  window.__yiqikanSiteRules={playbackPage:playbackPage,title:title,mediaCandidates:mediaCandidates,diagnostics:function(){return {
    sequence:snapshot?snapshot.release.sequence:null,ruleId:profile?profile.id:null,ruleVersion:profile?profile.version:null,
    mode:profile?profile.mode:null,disabled:disabled,events:events.map(function(e){return Object.assign({},e);})
  };}};
})(snapshot);
};
(()=>{var x=e=>!!(e&&typeof e=="object"&&!Array.isArray(e));function a(e,i,s=[]){return x(e)&&i.every(r=>Object.hasOwn(e,r))&&Object.keys(e).every(r=>i.includes(r)||s.includes(r))}function l(e,i,s){return Number.isSafeInteger(e)&&e>=i&&e<=s}function o(e,i,s,r){return Array.isArray(e)&&e.length>=i&&e.length<=s&&e.every(t=>typeof t=="string"&&r(t))&&new Set(e).size===e.length}function m(e){return typeof e=="string"&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(e)}function y(e,i){let s=e.split(".").map(Number),r=i.split(".").map(Number);for(let t=0;t<3;t++)if(s[t]!==r[t])return s[t]>r[t]?1:-1;return 0}function u(e){if(e.length<1||e.length>200||e.trim()!==e)return!1;let i='(?:[a-zA-Z][a-zA-Z0-9-]*)?(?:[.#][a-zA-Z_][a-zA-Z0-9_-]*|\\[[a-zA-Z_][a-zA-Z0-9_-]*(?:="[a-zA-Z0-9_-]+")?\\])*';return new RegExp("^"+i+"(?:(?: +| *> *)"+i+")*$").test(e)&&!/(^|[ >])([ >]|$)/.test(e.replace(/ *> */g,">"))}function d(e){return e.length<=253&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(e)&&e.split(".").every(i=>i.length<=63)}function b(e){return a(e,["prefix","suffix","minDigits","maxDigits"])&&typeof e.prefix=="string"&&/^[a-z][a-z0-9-]{0,31}$/.test(e.prefix)&&typeof e.suffix=="string"&&e.suffix.length<=200&&d("a."+e.suffix)&&l(e.minDigits,1,6)&&l(e.maxDigits,e.minDigits,6)}function g(e){if(!a(e,["schemaVersion","id","version","engineMajor","platforms","clientVersions","priority","match","mode","capabilities"])||!(e.schemaVersion===1&&e.engineMajor===1||e.schemaVersion===2&&e.engineMajor===2||e.schemaVersion===3&&e.engineMajor===3)||typeof e.id!="string"||!/^[a-z][a-z0-9-]{0,63}$/.test(e.id)||!l(e.version,1,Number.MAX_SAFE_INTEGER)||!l(e.priority,0,1e3)||!["observe","active"].includes(e.mode)||!o(e.platforms,1,3,t=>["ios","android","extension"].includes(t))||!a(e.clientVersions,["min","max"])||!m(e.clientVersions.min)||!m(e.clientVersions.max)||y(e.clientVersions.min,e.clientVersions.max)>0||!a(e.match,["hosts","pathPrefixes"],e.schemaVersion===3?["numericHosts"]:[])||!o(e.match.hosts,0,8,d)||!o(e.match.pathPrefixes,1,8,t=>t.length<=160&&/^\/[a-zA-Z0-9/_-]*$/.test(t)&&!t.includes("//"))||e.match.numericHosts!==void 0&&(!Array.isArray(e.match.numericHosts)||e.match.numericHosts.length<1||e.match.numericHosts.length>4||!e.match.numericHosts.every(b))||!e.match.hosts.length&&!(Array.isArray(e.match.numericHosts)&&e.match.numericHosts.length)||!a(e.capabilities,[],e.schemaVersion===1?["title","mediaCandidates"]:["title","mediaCandidates","playbackPage"])||!Object.keys(e.capabilities).length)return!1;let{title:i,mediaCandidates:s,playbackPage:r}=e.capabilities;if(r!==void 0){let t=r,f=n=>typeof n=="string"&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(n)&&!["constructor","prototype","__proto__"].includes(n),p=n=>n.length<=160&&/^\/[a-zA-Z0-9/_-]+\/$/.test(n)&&!n.includes("//");if(!a(t,["event","fields","idPrefix","privatePathPrefixes","playerPathPrefix","episodeQuery","episodeLabel"],["selectedEpisode"])||typeof t.event!="string"||!/^[a-zA-Z][a-zA-Z0-9:_-]{0,79}$/.test(t.event)||!a(t.fields,["active","id","title","episode"])||!Object.values(t.fields).every(f)||typeof t.idPrefix!="string"||!/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/.test(t.idPrefix)||!o(t.privatePathPrefixes,1,8,p)||typeof t.playerPathPrefix!="string"||!p(t.playerPathPrefix)||!f(t.episodeQuery)||!a(t.episodeLabel,["prefix","suffix"])||!Object.values(t.episodeLabel).every(n=>typeof n=="string"&&n.length<=20&&!/[<>\u0000-\u001f]/.test(n))||t.selectedEpisode!==void 0&&(!a(t.selectedEpisode,["selectors","maxChars"])||!o(t.selectedEpisode.selectors,1,8,u)||!l(t.selectedEpisode.maxChars,1,120)))return!1}return!(i!==void 0&&(!a(i,["selectors","maxChars"])||!o(i.selectors,1,8,u)||!l(i.maxChars,1,300))||s!==void 0&&(!a(s,["selectors","excludeWithin"])||!o(s.selectors,1,8,u)||!o(s.excludeWithin,0,8,u)))}var c=[{schemaVersion:3,id:"kanju-search-playback",version:5,engineMajor:3,platforms:["ios","android","extension"],clientVersions:{min:"1.0.0",max:"99.99.99"},priority:30,match:{hosts:["kanju.ai"],numericHosts:[{prefix:"kanju",suffix:"com",minDigits:1,maxDigits:6}],pathPrefixes:["/"]},mode:"active",capabilities:{title:{selectors:["h1"],maxChars:200},playbackPage:{event:"movie-search-playback-session-updated",fields:{active:"active",id:"variantId",title:"title",episode:"episode"},idPrefix:"av_",privatePathPrefixes:["/session/"],playerPathPrefix:"/player/",episodeQuery:"episode",episodeLabel:{prefix:"\u7B2C",suffix:"\u96C6"},selectedEpisode:{selectors:[".movie-episode-quick-tab.movie-button-primary",".movie-episode-grid button.movie-button-primary"],maxChars:120}}}}];function h(e,i){if(!c.every(g))throw Error("Invalid bundled site rule");let s=Date.now();return{platform:e,clientVersion:i,release:{schemaVersion:1,sequence:1,issuedAt:s,expiresAt:s+864e5,enabled:!0,rules:JSON.parse(JSON.stringify(c))}}}var w=Object.freeze({});Object.assign(window,{__yiqikanPackagedSiteRuleSnapshot:e=>h("extension",e)});})();
