/**
 * YiVideo Extension Background Service Worker
 * 1. Universally patches verification/auth cookies to SameSite=None; Secure
 * 2. Dynamically syncs top-level cookies into subframe request headers via declarativeNetRequest
 * 3. Supports silent background verification for CDN/WAF challenge pages.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[YiVideo Extension] Installed successfully.");
  patchAllCookies();
});

chrome.runtime.onStartup.addListener(() => {
  patchAllCookies();
});

const isPatchingCookie = new Set();

function isVerificationOrAuthCookie(c) {
  if (!c || !c.name) return false;
  const n = c.name.toLowerCase();
  return (
    n.includes("cdn_") ||
    n.includes("cf_") ||
    n.includes("__cf") ||
    n.includes("waf") ||
    n.includes("shield") ||
    n.includes("verify") ||
    n.includes("pow") ||
    n.includes("token") ||
    n.includes("sess") ||
    n.includes("auth") ||
    c.sameSite !== "no_restriction"
  );
}

function patchCookie(cookie) {
  if (cookie.sameSite === "no_restriction") return;

  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const protocol = cookie.secure ? "https:" : "http:";
  const url = `${protocol}//${domain}${cookie.path || "/"}`;
  const key = `${url}|${cookie.name}`;

  if (isPatchingCookie.has(key)) return;
  isPatchingCookie.add(key);

  const newCookie = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    domain: cookie.domain,
    secure: true, // SameSite=None requires Secure: true
    httpOnly: cookie.httpOnly,
    sameSite: "no_restriction",
    storeId: cookie.storeId,
  };

  if (cookie.expirationDate) {
    newCookie.expirationDate = cookie.expirationDate;
  }

  chrome.cookies.set(newCookie, () => {
    setTimeout(() => isPatchingCookie.delete(key), 800);
  });
}

let syncTimer = null;
function debouncedSyncDynamicRules() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncDynamicCookieRules, 300);
}

function syncDynamicCookieRules() {
  chrome.cookies.getAll({}, (cookies) => {
    if (!cookies) return;

    const cookiesByDomain = new Map();
    for (const c of cookies) {
      const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      if (!cookiesByDomain.has(d)) cookiesByDomain.set(d, []);
      cookiesByDomain.get(d).push(`${c.name}=${c.value}`);
    }

    const addRules = [];
    let ruleId = 1000;

    for (const [domain, cookieList] of cookiesByDomain.entries()) {
      const hasShieldCookie = cookieList.some(
        (str) =>
          str.includes("cdn_") ||
          str.includes("cf_") ||
          str.includes("__cf") ||
          str.includes("PHPSESSID") ||
          str.includes("verify")
      );

      if (hasShieldCookie) {
        const cookieValue = cookieList.join("; ");
        addRules.push({
          id: ruleId++,
          priority: 5,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "cookie", operation: "set", value: cookieValue },
              { header: "referer", operation: "set", value: `https://${domain}/` },
            ],
          },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: [
              "sub_frame",
              "stylesheet",
              "script",
              "image",
              "font",
              "media",
              "xmlhttprequest",
              "other",
            ],
          },
        });
      }
    }

    chrome.declarativeNetRequest.getDynamicRules((existingRules) => {
      const removeRuleIds = (existingRules || []).map((r) => r.id);
      chrome.declarativeNetRequest.updateDynamicRules(
        {
          removeRuleIds,
          addRules,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn("[YiVideo Extension] Failed to update dynamic rules:", chrome.runtime.lastError);
          } else {
            console.log(`[YiVideo Extension] Synced ${addRules.length} dynamic cookie rules.`);
          }
        }
      );
    });
  });
}

function patchAllCookies() {
  chrome.cookies.getAll({}, (cookies) => {
    if (!cookies) return;
    for (const c of cookies) {
      if (isVerificationOrAuthCookie(c)) {
        patchCookie(c);
      }
    }
    syncDynamicCookieRules();
  });
}

// Listen to cookie changes in real-time
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo.removed && changeInfo.cookie) {
    const c = changeInfo.cookie;
    if (isVerificationOrAuthCookie(c)) {
      patchCookie(c);
    }
  }
  debouncedSyncDynamicRules();
});

// ------------------------------------------------------------------
// Silent Background Verification Helper (Auto-Pass Challenge)
// ------------------------------------------------------------------
const activeVerifyingDomains = new Set();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "auto-verify-url" && request.url) {
    let domain = "";
    try {
      domain = new URL(request.url).hostname;
    } catch (_) {
      return;
    }

    if (activeVerifyingDomains.has(domain)) {
      sendResponse({ status: "already_verifying" });
      return;
    }
    activeVerifyingDomains.add(domain);

    console.log(`[YiVideo Extension] Launching silent verification tab for: ${request.url}`);

    // Create invisible background tab to solve JS-POW / Challenge in top-level window
    chrome.tabs.create(
      {
        url: request.url,
        active: false, // Runs silently in background without grabbing focus
      },
      (tab) => {
        if (!tab || !tab.id) {
          activeVerifyingDomains.delete(domain);
          return;
        }

        const tabId = tab.id;
        let resolved = false;

        const checkCookieListener = (changeInfo) => {
          if (!changeInfo.removed && changeInfo.cookie) {
            const cookieDomain = changeInfo.cookie.domain;
            if (cookieDomain && cookieDomain.includes(domain)) {
              if (isVerificationOrAuthCookie(changeInfo.cookie)) {
                resolved = true;
                cleanUp();
              }
            }
          }
        };

        const cleanUp = () => {
          chrome.cookies.onChanged.removeListener(checkCookieListener);
          setTimeout(() => {
            try {
              chrome.tabs.remove(tabId, () => {});
            } catch (_) {}
            activeVerifyingDomains.delete(domain);
            patchAllCookies();
            // Notify active web rooms to reload the iframe smoothly
            chrome.tabs.query({}, (tabs) => {
              for (const t of tabs) {
                if (t.id) {
                  chrome.tabs.sendMessage(t.id, {
                    action: "shield-verification-complete",
                    domain,
                    url: request.url,
                  }).catch(() => {});
                }
              }
            });
          }, 1200);
        };

        chrome.cookies.onChanged.addListener(checkCookieListener);

        // Safety timeout: auto close after 6 seconds if not resolved
        setTimeout(() => {
          if (!resolved) {
            cleanUp();
          }
        }, 6000);
      }
    );

    sendResponse({ status: "verifying_started" });
  }
});
