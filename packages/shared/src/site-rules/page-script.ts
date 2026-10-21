import { isSiteRuleVersion, validateSiteRuleRelease, type SiteRuleSnapshot } from './schema';

export function createSiteRulePageScript(snapshot: SiteRuleSnapshot | null): string {
  if (snapshot && (!['ios', 'android', 'extension'].includes(snapshot.platform) || !isSiteRuleVersion(snapshot.clientVersion)
    || !validateSiteRuleRelease(snapshot.release))) snapshot = null;
  // JSON is data inside pre-bundled source. Release Hermes does not retain
  // function source, so never stringify a function to make an injected script.
  const json = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return SITE_RULE_PAGE_SCRIPT.replace('__SITE_RULE_SNAPSHOT_JSON__', () => json);
}

export const SITE_RULE_PAGE_SCRIPT = String.raw`
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
      return /^https?:$/.test(u.protocol) && rule.match.hosts.indexOf(u.hostname)>=0 && rule.match.pathPrefixes.some(function(p){return u.pathname.indexOf(p)===0;});
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
  window.__yiqikanSiteRules={title:title,mediaCandidates:mediaCandidates,diagnostics:function(){return {
    sequence:snapshot?snapshot.release.sequence:null,ruleId:profile?profile.id:null,ruleVersion:profile?profile.version:null,
    mode:profile?profile.mode:null,disabled:disabled,events:events.map(function(e){return Object.assign({},e);})
  };}};
})(__SITE_RULE_SNAPSHOT_JSON__);
`;
