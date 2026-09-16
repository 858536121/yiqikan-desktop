#!/usr/bin/env node
import { createInterface } from "node:readline";

const BASE = "http://127.0.0.1:19876";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.headers.get("content-type")?.includes("image")) {
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    }
    return await res.text();
  } catch (e) { return `Error: ${e.message}`; }
}

async function post(path, body) {
  try {
    return await (await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).text();
  } catch (e) { return `Error: ${e.message}`; }
}

const TOOLS = [
  { name: "get_network", description: "Get recent webview network requests (url, method, request/response headers, status)", inputSchema: { type: "object", properties: { filter: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_console", description: "Get recent webview console logs", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "clear", description: "Clear network and console logs", inputSchema: { type: "object", properties: {} } },
  { name: "get_url", description: "Get the current webview URL", inputSchema: { type: "object", properties: {} } },
  { name: "navigate", description: "Navigate the webview to a URL", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } },
  { name: "reload", description: "Reload the webview", inputSchema: { type: "object", properties: {} } },
  { name: "go_back", description: "Go back in webview history", inputSchema: { type: "object", properties: {} } },
  { name: "go_forward", description: "Go forward in webview history", inputSchema: { type: "object", properties: {} } },
  { name: "eval", description: "Execute JavaScript in the webview and return the result", inputSchema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } },
  { name: "snapshot", description: "Get the page DOM structure (like playwright snapshot) — returns tag/text/attrs tree", inputSchema: { type: "object", properties: {} } },
  { name: "screenshot", description: "Take a screenshot of the webview, returns base64 PNG", inputSchema: { type: "object", properties: {} } },
  { name: "click", description: "Click an element by CSS selector", inputSchema: { type: "object", required: ["selector"], properties: { selector: { type: "string" } } } },
  { name: "fill", description: "Fill an input element by CSS selector", inputSchema: { type: "object", required: ["selector", "value"], properties: { selector: { type: "string" }, value: { type: "string" } } } },
  { name: "type", description: "Type text into an element (simulates keystrokes)", inputSchema: { type: "object", required: ["selector", "text"], properties: { selector: { type: "string" }, text: { type: "string" } } } },
  { name: "press_key", description: "Press a key (e.g. Enter, Escape, Tab)", inputSchema: { type: "object", required: ["key"], properties: { key: { type: "string" } } } },
  { name: "select", description: "Select an option in a <select> element", inputSchema: { type: "object", required: ["selector", "value"], properties: { selector: { type: "string" }, value: { type: "string" } } } },
  { name: "query", description: "Query elements by CSS selector, returns text/attrs of matched elements", inputSchema: { type: "object", required: ["selector"], properties: { selector: { type: "string" } } } },
  { name: "wait_for", description: "Wait for a CSS selector to appear in the page", inputSchema: { type: "object", required: ["selector"], properties: { selector: { type: "string" }, timeout: { type: "number", description: "Timeout in ms (default 5000)" } } } },
];

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "electron-inspector", version: "3.0.0" } } });
    return;
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") { send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } }); return; }

  if (msg.method === "tools/call") {
    const { name, arguments: args = {} } = msg.params;
    let result;

    switch (name) {
      case "get_network": { const p = new URLSearchParams(); if (args.filter) p.set("filter", args.filter); if (args.limit) p.set("limit", String(args.limit)); result = await get(`/network?${p}`); break; }
      case "get_console": { const p = new URLSearchParams(); if (args.limit) p.set("limit", String(args.limit)); result = await get(`/console?${p}`); break; }
      case "clear": result = await get("/clear"); break;
      case "get_url": result = await get("/url"); break;
      case "reload": result = await get("/reload"); break;      case "go_back": result = await get("/go-back"); break;
      case "go_forward": result = await get("/go-forward"); break;
      case "navigate": result = await post("/navigate", { url: args.url }); break;
      case "eval": result = await post("/eval", { code: args.code }); break;
      case "snapshot": result = await get("/snapshot"); break;
      case "screenshot": {
        const b64 = await get("/screenshot");
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "image", data: b64, mimeType: "image/png" }] } });
        return;
      }
      case "click": result = await post("/click", { selector: args.selector }); break;
      case "fill": result = await post("/fill", { selector: args.selector, value: args.value }); break;
      case "type": result = await post("/type", { selector: args.selector, text: args.text }); break;
      case "press_key": result = await post("/press-key", { key: args.key }); break;
      case "select": result = await post("/select", { selector: args.selector, value: args.value }); break;
      case "query": result = await post("/query", { selector: args.selector }); break;
      case "wait_for": result = await post("/wait-for", { selector: args.selector, timeout: args.timeout }); break;
      default: result = `Unknown tool: ${name}`;
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] } });
    return;
  }

  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
});
