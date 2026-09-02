document.getElementById("openWebRoomBtn")?.addEventListener("click", () => {
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(
      (t) => t.url && (t.url.includes("/room") || t.url.includes("localhost:3103") || t.url.includes("yiqikan"))
    );
    if (existing && existing.id) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId) {
        chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      chrome.tabs.create({ url: "https://together-ws.cpolar.cn/room" });
    }
  });
});
