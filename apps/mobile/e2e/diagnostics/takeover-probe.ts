// Temporary, opt-in diagnostic. Production screens do not import this file.
import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { WebView } from 'react-native-webview';
import { PROBE_SCRIPT } from './takeover-probe-script';

const endpoint = process.env.EXPO_PUBLIC_TAKEOVER_PROBE_URL;
const client = process.env.EXPO_PUBLIC_TAKEOVER_PROBE_CLIENT || 'app';
export function useTakeoverProbe(ref: RefObject<WebView | null>) {
  const enabled = __DEV__ && Boolean(endpoint);
  useEffect(() => {
    if (!enabled) return;
    let busy = false, active = true;
    let pending: AbortController | null = null;
    const timer = setInterval(async () => {
      if (!active || busy) return;
      busy = true;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${endpoint}/command?client=${encodeURIComponent(client)}&poll=${Date.now()}`, {
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-store' },
        });
        const cmd = await response.json();
        if (active && cmd?.id) {
          if (cmd.op === 'load') ref.current?.injectJavaScript(`location.assign(${JSON.stringify(cmd.url)}); true;`);
          else ref.current?.injectJavaScript(`window.__takeoverProbe?.run(${JSON.stringify(cmd)}); true;`);
        }
      } catch {} finally { clearTimeout(timeout); pending = null; busy = false; }
    }, 400);
    return () => { active = false; clearInterval(timer); pending?.abort(); };
  }, [enabled, ref]);
  return {
    script: enabled ? PROBE_SCRIPT : '',
    consume(data: any) {
      if(enabled && process.env.EXPO_PUBLIC_TAKEOVER_PRESERVE_FRAMES === '1' && data?.type === 'FOUND_IFRAME') {
        fetch(`${endpoint}/sample`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'iframe-found-preserved',url:data.url,parent:data.parentHost,at:Date.now()})}).catch(()=>{});
        return true;
      }
      if (!enabled || data?.type !== 'TAKEOVER_PROBE') return false;
      fetch(`${endpoint}/sample`, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data.payload)}).catch(() => {});
      return true;
    },
  };
}
