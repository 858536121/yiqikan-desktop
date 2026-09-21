/**
 * YiVideo Extension Main-World Script
 * Runs in the webpage context at document_start.
 * 
 * Invariants:
 * 1. Strictly isolated: Only runs inside the direct embedded iframe of a Yiqikan room.
 *    Exits immediately (0% overhead, 0% modification) for all external tabs and normal browsing.
 * 2. Virtual Tab Emulation: Spoofs window.self === window.top, window.parent === window,
 *    window.frameElement === null, and document.referrer so third-party WAFs and anti-frame scripts
 *    believe this is a native, top-level browser tab.
 * 3. SPA Navigation Interception: Hooks pushState / replaceState for 0ms address bar synchronization.
 * 4. Popup & Form Containment: Keeps window.open and target=_blank inside the embedded view.
 */

(function () {
  const YIQIKAN_HOSTS = [
    "cpolar.cn",
    "cpolar.top",
    "yiqikan.club",
    "yiqikan.cn",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ];

  function isYiqikanHost(hostname) {
    if (!hostname || typeof hostname !== "string") return false;
    const h = hostname.toLowerCase();
    return YIQIKAN_HOSTS.some((y) => h === y || h.endsWith(`.${y}`));
  }

  function hasYiqikanAncestor() {
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
          const origin = window.location.ancestorOrigins[i];
          const url = new URL(origin);
          if (isYiqikanHost(url.hostname)) return true;
        }
        return false;
      }
    } catch (_) {}
    try {
      if (document.referrer) {
        const refHost = new URL(document.referrer).hostname;
        if (isYiqikanHost(refHost)) return true;
      }
    } catch (_) {}
    return false;
  }

  let IS_DIRECT_EMBEDDED_FRAME = false;
  try {
    IS_DIRECT_EMBEDDED_FRAME = window.self !== window.top && window.parent === window.top;
  } catch (_) {}

  // Strict Guard: Only run in directly embedded frames inside Yiqikan rooms (zero effect on any external browsing)
  if (!IS_DIRECT_EMBEDDED_FRAME || !hasYiqikanAncestor()) return;

  // ------------------------------------------------------------------
  // 1. Virtual Tab Emulation: Window & Frame Spoofing
  // ------------------------------------------------------------------
  try {
    Object.defineProperty(window, "parent", { get: () => window, configurable: true });
  } catch (_) {}

  try {
    Object.defineProperty(window, "frameElement", { get: () => null, configurable: true });
  } catch (_) {}

  try {
    Object.defineProperty(window, "top", { get: () => window, configurable: true });
  } catch (_) {}

  // ------------------------------------------------------------------
  // 2. Virtual Tab Cookie Emulation (Native 100% Read/Write in Cross-Site iframe)
  // ------------------------------------------------------------------
  try {
    const proto = Document.prototype || HTMLDocument.prototype;
    const origCookieDesc = Object.getOwnPropertyDescriptor(proto, "cookie") ||
                           Object.getOwnPropertyDescriptor(document, "cookie");
    if (origCookieDesc && origCookieDesc.set && origCookieDesc.get) {
      const origSet = origCookieDesc.set;
      const origGet = origCookieDesc.get;
      const inMemoryCookieMap = new Map();
      const deletedCookieSet = new Set();

      Object.defineProperty(document, "cookie", {
        configurable: true,
        enumerable: true,
        get: function () {
          let nativeVal = "";
          try { nativeVal = origGet.call(this) || ""; } catch (_) {}

          const merged = new Map();
          if (nativeVal) {
            const rawParts = nativeVal.split("; ");
            for (let i = 0; i < rawParts.length; i++) {
              const part = rawParts[i];
              const eqIndex = part.indexOf("=");
              if (eqIndex !== -1) {
                const k = part.slice(0, eqIndex).trim();
                const v = part.slice(eqIndex + 1).trim();
                if (k && !deletedCookieSet.has(k)) {
                  merged.set(k, v);
                }
              }
            }
          }
          for (const [k, v] of inMemoryCookieMap.entries()) {
            if (!deletedCookieSet.has(k)) {
              merged.set(k, v);
            }
          }
          const out = [];
          for (const [k, v] of merged.entries()) {
            out.push(`${k}=${v}`);
          }
          return out.join("; ");
        },
        set: function (val) {
          if (typeof val !== "string") {
            try { return origSet.call(this, val); } catch (_) { return; }
          }

          // Parse key-value for in-memory fallback
          try {
            const firstSegment = val.split(";")[0];
            const eqIndex = firstSegment.indexOf("=");
            if (eqIndex !== -1) {
              const k = firstSegment.slice(0, eqIndex).trim();
              const v = firstSegment.slice(eqIndex + 1).trim();

              // Check if cookie is being deleted (max-age <= 0 or expires in past)
              let isDeleting = false;
              const maxAgeMatch = val.match(/;\s*max-age=(-?\d+)/i);
              if (maxAgeMatch && parseInt(maxAgeMatch[1], 10) <= 0) {
                isDeleting = true;
              }
              const expiresMatch = val.match(/;\s*expires=([^;]+)/i);
              if (expiresMatch) {
                const expDate = new Date(expiresMatch[1]);
                if (!isNaN(expDate.getTime()) && expDate.getTime() <= Date.now()) {
                  isDeleting = true;
                }
              }

              if (isDeleting) {
                inMemoryCookieMap.delete(k);
                deletedCookieSet.add(k);
              } else if (k) {
                deletedCookieSet.delete(k);
                inMemoryCookieMap.set(k, v);
              }
            }
          } catch (_) {}

          // Ensure cross-site iframe compatibility (SameSite=None; Secure)
          let patched = val.replace(/;\s*samesite=(lax|strict)/gi, "");
          if (!/;\s*samesite=none/i.test(patched)) {
            patched += "; SameSite=None; Secure";
          }
          try {
            return origSet.call(this, patched);
          } catch (_) {
            try { return origSet.call(this, val); } catch (_) {}
          }
        },
      });
    }
  } catch (_) {}

  // ------------------------------------------------------------------
  // 3. SPA Navigation Interception (Instant URL Sync to Room Address Bar)
  // ------------------------------------------------------------------
  try {
    const origPushState = history.pushState;
    history.pushState = function () {
      const ret = origPushState.apply(this, arguments);
      try { window.dispatchEvent(new Event("yiqikan:urlchange")); } catch (_) {}
      return ret;
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function () {
      const ret = origReplaceState.apply(this, arguments);
      try { window.dispatchEvent(new Event("yiqikan:urlchange")); } catch (_) {}
      return ret;
    };
  } catch (_) {}

  // ------------------------------------------------------------------
  // 3. Popup & Form Containment
  // ------------------------------------------------------------------
  function isValidPageUrl(url) {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed === "about:blank" || trimmed.startsWith("javascript:") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return false;
    }
    if (
      trimmed.includes("leader-election") ||
      trimmed.includes("/bfs/seed/") ||
      trimmed.includes("pos.baidu.com") ||
      trimmed.includes("data.bilibili.com") ||
      trimmed.includes("log.bilibili.com") ||
      trimmed.includes("api.bilibili.com") ||
      trimmed.includes("/log/")
    ) {
      return false;
    }
    return true;
  }

  function createDummyWindow(url) {
    return {
      focus: function () {},
      blur: function () {},
      close: function () {},
      closed: false,
      location: { href: url || "" },
      document: {
        write: function () {},
        writeln: function () {},
        open: function () {},
        close: function () {},
      },
      postMessage: function () {},
    };
  }

  try {
    // Intercept window.open in Main World so popups navigate the iframe in-place
    const originalOpen = window.open;
    window.open = function (url, target, features) {
      if (!url) {
        return createDummyWindow("");
      }

      let resolved = "";
      try {
        resolved = new URL(url, window.location.href).href;
      } catch (_) {
        resolved = String(url);
      }

      if (!isValidPageUrl(resolved)) {
        return createDummyWindow("");
      }

      const curNoHash = window.location.href.split("#")[0];
      const resNoHash = resolved.split("#")[0];
      if (curNoHash === resNoHash && (resolved.includes("#") || curNoHash === resolved)) {
        return createDummyWindow(resolved);
      }

      window.location.href = resolved;
      return createDummyWindow(resolved);
    };

    // Intercept HTMLFormElement.prototype.submit & requestSubmit
    if (typeof HTMLFormElement !== "undefined") {
      const origFormSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        this.setAttribute("target", "_self");
        this.target = "_self";
        return origFormSubmit.apply(this, arguments);
      };

      if (HTMLFormElement.prototype.requestSubmit) {
        const origRequestSubmit = HTMLFormElement.prototype.requestSubmit;
        HTMLFormElement.prototype.requestSubmit = function (submitter) {
          this.setAttribute("target", "_self");
          this.target = "_self";
          if (submitter) {
            submitter.setAttribute("formtarget", "_self");
            submitter.formTarget = "_self";
          }
          return origRequestSubmit.apply(this, arguments);
        };
      }
    }
  } catch (_) {}
})();
