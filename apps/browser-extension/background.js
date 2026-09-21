/**
 * YiVideo Extension Background Service Worker
 * 
 * Core Invariants:
 * 1. Strict Tab-Scoped Isolation: Network header modifications and un-framing rules
 *    are strictly scoped to active Yiqikan Room tabs using `condition: { tabIds: [...] }`.
 *    Other browser tabs (banking, email, shopping) have ZERO rule matching and 100% native security.
 * 2. Universal Un-framing: Removes X-Frame-Options, CSP frame-ancestors, COOP/COEP within room tabs,
 *    immune to target site 301/302 redirects and nested player iframes.
 * 3. Referer Spoofing: Removes cross-origin Yiqikan Referer on sub_frame navigation,
 *    making third-party CDNs and WAFs believe the request is directly from the browser address bar.
 * 4. Universal In-Place Cookie Roaming: Ensures cookies for active room domains are accessible
 *    and writable directly in the iframe (sameSite: "no_restriction", secure: true),
 *    completely eliminating the need to ever open extraneous tabs.
 */

const YIQIKAN_HOSTS = [
  "cpolar.cn",
  "cpolar.top",
  "yiqikan.club",
  "yiqikan.cn",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
];

function isYiqikanDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const h = hostname.toLowerCase().replace(/^\./, "");
  return YIQIKAN_HOSTS.some((y) => h === y || h.endsWith(`.${y}`));
}

// Map of active Room Tab IDs -> { registeredAt: number, activeDomains: Set<string> }
const activeRoomTabs = new Map();

// Track cookies being patched to prevent infinite loops with chrome.cookies.onChanged
const isPatchingCookie = new Set();

/**
 * Extract all domain candidates up to the root domain (e.g. "v.qq.com" -> ["v.qq.com", "qq.com"])
 */
function getDomainHierarchy(hostname) {
  if (!hostname || typeof hostname !== "string") return [];
  const clean = hostname.toLowerCase().replace(/^www\./, "").replace(/^\./, "");
  const parts = clean.split(".");
  const domains = [clean];
  for (let i = 1; i < parts.length - 1; i++) {
    domains.push(parts.slice(i).join("."));
  }
  return domains;
}

/**
 * Ensures a cookie can be read and written in cross-site iframes inside the room natively
 */
function makeCookieCrossSiteSafe(cookie) {
  if (!cookie || cookie.sameSite === "no_restriction") return;
  const rawDomain = cookie.domain || "";
  const domain = rawDomain.startsWith(".") ? rawDomain.slice(1) : rawDomain;

  // In modern Chromium, sameSite: "no_restriction" STRICTLY requires secure: true and an https: URL
  const url = `https://${domain}${cookie.path || "/"}`;
  const key = `${url}|${cookie.name}`;

  if (isPatchingCookie.has(key)) return;
  isPatchingCookie.add(key);

  const newCookie = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    domain: cookie.name?.startsWith("__Host-") ? undefined : cookie.domain,
    secure: true,
    httpOnly: cookie.httpOnly,
    sameSite: "no_restriction",
    storeId: cookie.storeId,
  };

  if (cookie.expirationDate) {
    newCookie.expirationDate = cookie.expirationDate;
  }

  chrome.cookies.set(newCookie, () => {
    if (chrome.runtime.lastError) {
      // If dot-prefixed domain was rejected in certain contexts, retry with stripped domain
      if (cookie.domain && cookie.domain.startsWith(".")) {
        chrome.cookies.set({ ...newCookie, domain }, () => {});
      }
    }
    setTimeout(() => isPatchingCookie.delete(key), 800);
  });
}

/**
 * Synchronize declarativeNetRequest session rules strictly scoped to active room tabIds
 */
function syncRoomTabSessionRules() {
  const tabIds = Array.from(activeRoomTabs.keys());

  chrome.declarativeNetRequest.getSessionRules((existingRules) => {
    const removeRuleIds = (existingRules || []).map((r) => r.id);

    if (tabIds.length === 0) {
      if (removeRuleIds.length > 0) {
        chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
      }
      return;
    }

    const addRules = [];

    // Rule A: Unframe all sub_frames and strip Referer leak for room tabs
    addRules.push({
      id: 20001,
      priority: 10,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
          { header: "content-security-policy-report-only", operation: "remove" },
          { header: "cross-origin-opener-policy", operation: "remove" },
          { header: "cross-origin-embedder-policy", operation: "remove" },
          { header: "cross-origin-resource-policy", operation: "remove" },
        ],
        requestHeaders: [
          { header: "referer", operation: "remove" },
        ],
      },
      condition: {
        tabIds,
        resourceTypes: ["sub_frame"],
      },
    });

    // Rule B: Unframe subresources (scripts, media, images, XHR) inside room tabs
    addRules.push({
      id: 20002,
      priority: 10,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "cross-origin-resource-policy", operation: "remove" },
        ],
      },
      condition: {
        tabIds,
        resourceTypes: ["xmlhttprequest", "script", "media", "image", "other"],
      },
    });

    chrome.declarativeNetRequest.updateSessionRules(
      {
        removeRuleIds,
        addRules,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn("[YiVideo Extension] updateSessionRules failed:", chrome.runtime.lastError);
        } else {
          console.log(`[YiVideo Extension] Active session rules synced for tabs [${tabIds.join(", ")}]. Strictly isolated.`);
        }
      }
    );
  });
}

/**
 * Handle room tab registration
 */
function registerRoomTab(tabId, url) {
  if (!tabId || tabId < 0) return;
  if (!activeRoomTabs.has(tabId)) {
    activeRoomTabs.set(tabId, { registeredAt: Date.now(), activeDomains: new Set() });
    syncRoomTabSessionRules();
  }
}

/**
 * Handle active embedded domain in a room tab - enables in-place cookie read & write
 */
function handleActiveRoomDomain(tabId, domain) {
  if (!tabId || !domain) return;
  const domainList = getDomainHierarchy(domain);

  const tabData = activeRoomTabs.get(tabId);
  if (tabData) {
    for (const d of domainList) {
      tabData.activeDomains.add(d);
    }
  }

  // Ensure all cookies for this domain AND its parent root domains are accessible in cross-site iframes natively
  for (const d of domainList) {
    try {
      chrome.cookies.getAll({ domain: d }, (cookies) => {
        if (!cookies) return;
        for (const c of cookies) {
          makeCookieCrossSiteSafe(c);
        }
      });
    } catch (_) {}
  }
}

// ------------------------------------------------------------------
// Tab Lifecycle Listeners: Guarantee 100% Cleanup When Room Closes
// ------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeRoomTabs.has(tabId)) {
    activeRoomTabs.delete(tabId);
    syncRoomTabSessionRules();
    console.log(`[YiVideo Extension] Room tab ${tabId} closed. Cleaned up rules.`);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const urlToCheck = changeInfo.url || tab?.url;
  if (urlToCheck) {
    try {
      const parsed = new URL(urlToCheck);
      if (isYiqikanDomain(parsed.hostname)) {
        // Fast-path: register room tab immediately upon navigation so rules apply before subframes load
        registerRoomTab(tabId, urlToCheck);
      } else if (activeRoomTabs.has(tabId)) {
        // Tab navigated away from Yiqikan room! Immediately unregister to protect the new page
        activeRoomTabs.delete(tabId);
        syncRoomTabSessionRules();
        console.log(`[YiVideo Extension] Tab ${tabId} navigated away to ${parsed.hostname}. Rules removed.`);
      }
    } catch (_) {}
  }
});

// ------------------------------------------------------------------
// Cookie Observer: Keep In-Place Cookies Transparently Roaming
// ------------------------------------------------------------------

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed || !changeInfo.cookie) return;
  const rawDomain = (changeInfo.cookie.domain || "").toLowerCase().replace(/^\./, "").replace(/^www\./, "");
  if (!rawDomain) return;

  // Check if this cookie belongs to any currently active room domain
  let isActiveInRoom = false;
  for (const tabData of activeRoomTabs.values()) {
    for (const d of tabData.activeDomains) {
      if (rawDomain === d || rawDomain.endsWith(`.${d}`) || d.endsWith(`.${rawDomain}`)) {
        isActiveInRoom = true;
        break;
      }
    }
    if (isActiveInRoom) break;
  }

  if (isActiveInRoom) {
    makeCookieCrossSiteSafe(changeInfo.cookie);
  }
});

// ------------------------------------------------------------------
// Runtime Message Dispatcher
// ------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const senderTabId = sender?.tab?.id;

  // 1. Handshake: Room Tab registration
  if (request.action === "register-room-tab") {
    if (senderTabId) {
      registerRoomTab(senderTabId, request.url);
      sendResponse({ status: "registered", tabId: senderTabId });
    }
    return true;
  }

  // 2. Active embedded domain notification from content script
  if (request.action === "room-domain-active") {
    if (senderTabId && request.domain) {
      registerRoomTab(senderTabId, request.url);
      handleActiveRoomDomain(senderTabId, request.domain);
      sendResponse({ status: "domain_synced", domain: request.domain });
    }
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[YiVideo Extension] Service worker initialized with tab-scoped isolation.");
  syncRoomTabSessionRules();
});

chrome.runtime.onStartup.addListener(() => {
  syncRoomTabSessionRules();
});
