export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  tag: string;
  message: string;
  data?: any;
}

const MAX_LOGS = 300;
const logBuffer: LogEntry[] = [];

function formatTime(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function sendToBridge(level: "info" | "warn" | "error", message: string, data?: any) {
  try {
    const bridge = (window as any).yiqikan;
    if (bridge?.logToTerminal) {
      bridge.logToTerminal(level, message, data);
    }
  } catch { /* ignore */ }
}

export function log(level: "info" | "warn" | "error" | "debug", tag: string, message: string, data?: any): void {
  const entry: LogEntry = {
    timestamp: formatTime(),
    level,
    tag,
    message,
    data,
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }

  const prefix = `[${entry.tag}] ${entry.message}`;
  if (level === "error") {
    console.error(prefix, data ?? "");
    sendToBridge("error", prefix, data);
  } else if (level === "warn") {
    console.warn(prefix, data ?? "");
    sendToBridge("warn", prefix, data);
  } else if (level === "debug") {
    console.debug(prefix, data ?? "");
  } else {
    console.log(prefix, data ?? "");
    sendToBridge("info", prefix, data);
  }
}

export function getLogs(): readonly LogEntry[] {
  return logBuffer;
}

export function exportLogsText(): string {
  const bridge = (window as any).yiqikan;
  const header = [
    `=== 异起看客户端运行日志 ===`,
    `导出时间: ${new Date().toLocaleString()}`,
    `应用版本: ${bridge?.runtimeContext?.client?.appVersion || "未知"}`,
    `协议版本: ${bridge?.runtimeContext?.client?.protocolVersion || "未知"}`,
    `运行平台: ${bridge?.runtimeContext?.client?.platform || "desktop"}`,
    `UserAgent: ${navigator.userAgent}`,
    `========================================\n`,
  ].join("\n");

  const body = logBuffer
    .map((e) => {
      const dataStr = e.data ? ` | ${typeof e.data === "object" ? JSON.stringify(e.data) : e.data}` : "";
      return `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.tag}] ${e.message}${dataStr}`;
    })
    .join("\n");

  return header + body;
}

export async function copyLogsToClipboard(): Promise<boolean> {
  const text = exportLogsText();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
