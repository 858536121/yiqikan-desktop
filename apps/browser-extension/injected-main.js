/**
 * YiVideo Extension Main-World Script
 * Runs in the webpage context at document_start to intercept window.open
 * and form submissions, keeping all navigation inside the embedded frame.
 */

(function () {
  let IS_DIRECT_EMBEDDED_FRAME = false;
  try {
    IS_DIRECT_EMBEDDED_FRAME = window.self !== window.top && window.parent === window.top;
  } catch (_) {}

  // Only run in directly embedded video iframes
  if (!IS_DIRECT_EMBEDDED_FRAME) return;

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
    // 1. Intercept window.open in Main World so popups navigate the iframe in-place
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

      // If opening current page hash, avoid full reload
      const curNoHash = window.location.href.split("#")[0];
      const resNoHash = resolved.split("#")[0];
      if (curNoHash === resNoHash && (resolved.includes("#") || curNoHash === resolved)) {
        return createDummyWindow(resolved);
      }

      window.location.href = resolved;
      return createDummyWindow(resolved);
    };

    // 2. Intercept HTMLFormElement.prototype.submit & requestSubmit
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
