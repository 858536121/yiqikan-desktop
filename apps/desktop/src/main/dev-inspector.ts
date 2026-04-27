/**
 * Dev-only inspector HTTP server — playwright-like tools for the Electron webview.
 * Only active in dev mode (ELECTRON_RENDERER_URL is set).
 */
import http from "node:http";
import type { Session, WebContents } from "electron";

interface RequestRecord {
  id: string;
  ts: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
}

interface ConsoleRecord {
  ts: number;
  level: number;
  message: string;
  url?: string;
}

const MAX_RECORDS = 200;
const PORT = 19876;

const networkRecords: RequestRecord[] = [];
const consoleRecords: ConsoleRecord[] = [];
const pendingById = new Map<string, RequestRecord>();

let guestWC: WebContents | null = null;

export function setInspectorGuest(wc: WebContents) {
  guestWC = wc;
  wc.on("console-message", (_e, level, message, _line, sourceId) => {
    consoleRecords.push({ ts: Date.now(), level, message, url: sourceId });
    if (consoleRecords.length > MAX_RECORDS) consoleRecords.shift();
  });
}

export function captureRequest(id: string, url: string, method: string, requestHeaders: Record<string, string>) {
  pendingById.set(id, { id, ts: Date.now(), url, method, requestHeaders });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

function json(res: http.ServerResponse, data: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data, null, 2));
}

export function startDevInspector(yiqikanSession: Session) {
  if (!process.env.ELECTRON_RENDERER_URL) return;

  yiqikanSession.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    const record = pendingById.get(String(details.id));
    if (record) {
      record.statusCode = details.statusCode;
      record.responseHeaders = Object.fromEntries(
        Object.entries(details.responseHeaders ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])
      );
      pendingById.delete(String(details.id));
      networkRecords.push(record);
      if (networkRecords.length > MAX_RECORDS) networkRecords.shift();
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const wc = guestWC && !guestWC.isDestroyed() ? guestWC : null;

    // ── GET endpoints ──────────────────────────────────────────────
    if (req.method === "GET") {
      if (url.pathname === "/network") {
        const filter = url.searchParams.get("filter");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const data = filter ? networkRecords.filter(r => r.url.includes(filter)) : networkRecords;
        return json(res, data.slice(-limit));
      }
      if (url.pathname === "/console") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return json(res, consoleRecords.slice(-limit));
      }
      if (url.pathname === "/clear") {
        networkRecords.length = 0; consoleRecords.length = 0;
        return json(res, { ok: true });
      }
      if (url.pathname === "/url") {
        return json(res, { url: wc?.getURL() ?? null });
      }
      if (url.pathname === "/reload") {
        wc?.reload();
        return json(res, { ok: !!wc });
      }
      if (url.pathname === "/go-back") {
        if (wc?.canGoBack()) { wc.goBack(); return json(res, { ok: true }); }
        return json(res, { ok: false, error: "cannot go back" });
      }
      if (url.pathname === "/go-forward") {
        if (wc?.canGoForward()) { wc.goForward(); return json(res, { ok: true }); }
        return json(res, { ok: false, error: "cannot go forward" });
      }
      if (url.pathname === "/screenshot") {
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const img = await wc.capturePage();
          const png = img.toPNG();
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(png);
        } catch (e: any) { json(res, { ok: false, error: e.message }); }
        return;
      }
      if (url.pathname === "/snapshot") {
        // Accessibility tree snapshot (like playwright's snapshot)
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              function nodeInfo(el, depth) {
                if (depth > 8) return null;
                const tag = el.tagName ? el.tagName.toLowerCase() : '#text';
                const text = el.innerText ? el.innerText.trim().substring(0, 100) : '';
                const attrs = {};
                if (el.id) attrs.id = el.id;
                if (el.className && typeof el.className === 'string') attrs.class = el.className.trim().substring(0, 80);
                if (el.href) attrs.href = el.href;
                if (el.src) attrs.src = el.src;
                if (el.type) attrs.type = el.type;
                if (el.name) attrs.name = el.name;
                if (el.value !== undefined && el.tagName && ['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) attrs.value = el.value;
                if (el.placeholder) attrs.placeholder = el.placeholder;
                const children = [];
                if (el.children) {
                  for (let i = 0; i < Math.min(el.children.length, 20); i++) {
                    const child = nodeInfo(el.children[i], depth + 1);
                    if (child) children.push(child);
                  }
                }
                return { tag, text: text || undefined, attrs: Object.keys(attrs).length ? attrs : undefined, children: children.length ? children : undefined };
              }
              return JSON.stringify(nodeInfo(document.body, 0));
            })()
          `, true);
          return json(res, { ok: true, snapshot: JSON.parse(result) });
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }
    }

    // ── POST endpoints ─────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await readBody(req);
      let args: any = {};
      try { args = JSON.parse(body); } catch { /* ignore */ }

      if (url.pathname === "/navigate") {
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try { wc.loadURL(args.url); return json(res, { ok: true }); }
        catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/eval") {
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(args.code, true);
          return json(res, { ok: true, result });
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/click") {
        // Click element by CSS selector
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(args.selector)});
              if (!el) return { ok: false, error: 'element not found: ' + ${JSON.stringify(args.selector)} };
              el.click();
              return { ok: true };
            })()
          `, true);
          return json(res, result);
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/fill") {
        // Fill input by CSS selector
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(args.selector)});
              if (!el) return { ok: false, error: 'element not found: ' + ${JSON.stringify(args.selector)} };
              el.focus();
              el.value = ${JSON.stringify(args.value)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            })()
          `, true);
          return json(res, result);
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/wait-for") {
        // Wait for selector to appear (polls up to timeout ms)
        if (!wc) return json(res, { ok: false, error: "no webview" });
        const timeout = args.timeout ?? 5000;
        const interval = 200;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          try {
            const found = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(args.selector)})`, true);
            if (found) return json(res, { ok: true });
          } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, interval));
        }
        return json(res, { ok: false, error: `timeout waiting for ${args.selector}` });
      }

      if (url.pathname === "/select") {
        // Select option in <select> by CSS selector + value
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(args.selector)});
              if (!el) return { ok: false, error: 'element not found' };
              el.value = ${JSON.stringify(args.value)};
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            })()
          `, true);
          return json(res, result);
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/type") {
        // Type text into focused element (simulates keystrokes)
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(args.selector)}) || document.activeElement;
              if (!el) return { ok: false, error: 'no element' };
              el.focus();
              const text = ${JSON.stringify(args.text)};
              for (const char of text) {
                el.value = (el.value || '') + char;
                el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
                el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
              }
              return { ok: true };
            })()
          `, true);
          return json(res, result);
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/press-key") {
        // Press a key (e.g. Enter, Escape)
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const el = document.activeElement || document.body;
              const key = ${JSON.stringify(args.key)};
              el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
              return { ok: true };
            })()
          `, true);
          return json(res, result);
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }

      if (url.pathname === "/query") {
        // Query elements by CSS selector, return text/attrs
        if (!wc) return json(res, { ok: false, error: "no webview" });
        try {
          const result = await wc.executeJavaScript(`
            (function() {
              const els = Array.from(document.querySelectorAll(${JSON.stringify(args.selector)})).slice(0, 50);
              return els.map(el => ({
                tag: el.tagName.toLowerCase(),
                text: el.innerText ? el.innerText.trim().substring(0, 200) : undefined,
                id: el.id || undefined,
                class: el.className && typeof el.className === 'string' ? el.className.trim() : undefined,
                href: el.href || undefined,
                value: el.value !== undefined ? el.value : undefined,
                placeholder: el.placeholder || undefined,
              }));
            })()
          `, true);
          return json(res, { ok: true, elements: result });
        } catch (e: any) { return json(res, { ok: false, error: e.message }); }
      }
    }

    res.statusCode = 404;
    json(res, { error: "not found" });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[yiqikan dev] inspector at http://127.0.0.1:${PORT}`);
  });
}
