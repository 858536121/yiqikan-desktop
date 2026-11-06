// Runs in the viewed top-level page, independent of the selected video iframe.
export function createSiteIconScript(session: string): string {
  return SITE_ICON_SCRIPT.replace('__SITE_ICON_SESSION__', JSON.stringify(session));
}
const SITE_ICON_SCRIPT = String.raw`(
function captureSiteIcon(session) {
  if (window !== window.top || !/^https?:$/.test(location.protocol) || typeof Image === 'undefined') return;
  let last = '', timer;
  const capture = () => {
    const pageUrl = location.href;
    const link = document.querySelector('link[rel~="icon"]');
    let icon;
    try { icon = new URL(link?.href || '/favicon.ico', pageUrl); } catch { return; }
    if (!/^https?:$/.test(icon.protocol) || icon.username || icon.password) return;
    const stamp = pageUrl + '|' + icon.href;
    if (stamp === last) return; last = stamp;
    const attempt = (url, fallback) => {
      const image = new Image();
      if (new URL(url).origin !== location.origin) image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (pageUrl !== location.href) return;
        try {
          const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
          const context = canvas.getContext('2d'); if (!context) return;
          context.drawImage(image, 0, 0, 32, 32);
          const png = canvas.toDataURL('image/png');
          if (png.length <= 12000) window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'PAGE_SITE_ICON', session, pageUrl, siteIcon: png }));
        } catch { if (!fallback) attempt(location.origin + '/favicon.ico', true); }
      };
      image.onerror = () => { if (!fallback && pageUrl === location.href) attempt(location.origin + '/favicon.ico', true); };
      image.src = url;
    };
    attempt(icon.href, false);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(capture, 400); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true }); else schedule();
  if (document.head) new MutationObserver(schedule).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
}

)(__SITE_ICON_SESSION__);true;`;
