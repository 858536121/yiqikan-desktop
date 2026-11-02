const WEB_ROOM_URL = "https://yiqikan.club/room";
const LEGACY_WEB_HOSTS = new Set([
  "yiqikan.cpolar.cn",
  "yiqikan.cpolar.top",
  "yiqikan.cn",
  "www.yiqikan.cn",
]);

function getWebRoomTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.pathname !== "/room" && !url.pathname.startsWith("/room/")) return null;
    if (url.origin === "https://yiqikan.club" ||
        ["localhost:3103", "127.0.0.1:3103"].includes(url.host)) {
      return { url: url.href, migrate: false };
    }
    if (LEGACY_WEB_HOSTS.has(url.hostname) || url.origin === "http://yiqikan.club") {
      // Move old room links to the public website, keeping the room ID.
      return { url: `https://yiqikan.club${url.pathname}${url.search}${url.hash}`, migrate: true };
    }
  } catch (_) {}
  return null;
}

// Check current active tab to display contextual status
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const currentTab = tabs[0];
  let isCurrentYiqikan = false;

  if (currentTab && currentTab.url) {
    const target = getWebRoomTarget(currentTab.url);
    isCurrentYiqikan = Boolean(target && !target.migrate);
  }

  const badge = document.getElementById("statusBadge");
  const desc = document.getElementById("statusDesc");
  const fIcon1 = document.getElementById("featIcon1");
  const fText1 = document.getElementById("featText1");
  const fIcon2 = document.getElementById("featIcon2");
  const fText2 = document.getElementById("featText2");
  const fIcon3 = document.getElementById("featIcon3");
  const fText3 = document.getElementById("featText3");
  const btn = document.getElementById("openWebRoomBtn");

  if (isCurrentYiqikan) {
    if (badge) {
      badge.className = "badge active";
      badge.textContent = "运行中";
    }
    if (desc) {
      desc.textContent = "当前处于异起看放映室，插件正在提供全网解嵌与毫秒级跨屏同步。";
    }
    if (fIcon1) fIcon1.textContent = "✓";
    if (fText1) fText1.textContent = "全网影视直接畅享播放";
    if (fIcon2) fIcon2.textContent = "✓";
    if (fText2) fText2.textContent = "毫秒级异地跨屏音视频同步";
    if (fIcon3) fIcon3.textContent = "✓";
    if (fText3) fText3.textContent = "原生超频音量增强与防抖";
    if (btn) btn.textContent = "回到异起看 Web 房间";
  } else {
    if (badge) {
      badge.className = "badge inactive";
      badge.textContent = "已自动休眠";
    }
    if (desc) {
      desc.textContent = "当前网页非异起看放映室，插件已自动休眠，0 性能开销。";
    }
    if (fIcon1) fIcon1.textContent = "•";
    if (fText1) fText1.textContent = "仅在异起看放映室内自动运行";
    if (fIcon2) fIcon2.textContent = "•";
    if (fText2) fText2.textContent = "其它网页完全静默、0 资源占用";
    if (fIcon3) fIcon3.textContent = "•";
    if (fText3) fText3.textContent = "智能环境识别，无需手动操作";
    if (btn) btn.textContent = "进入异起看 Web 房间";
  }
});

document.getElementById("openWebRoomBtn")?.addEventListener("click", () => {
  chrome.tabs.query({}, (tabs) => {
    const rooms = tabs
      .filter((tab) => tab.id != null)
      .map((tab) => ({ tab, target: getWebRoomTarget(tab.url) }))
      .filter(({ target }) => target);
    // Prefer a working room over a stale tab on the retired domain.
    const existing = rooms.find(({ target }) => !target.migrate) || rooms[0];
    if (existing) {
      const { tab, target } = existing;
      chrome.tabs.update(tab.id, target.migrate
        ? { active: true, url: target.url }
        : { active: true });
      if (tab.windowId != null) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: WEB_ROOM_URL });
    }
  });
});
