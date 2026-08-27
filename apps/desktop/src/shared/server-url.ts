const PROD_SERVER_URL = "wss://together-ws.cpolar.cn";

export function resolveDesktopServerUrl() {
  // Explicit override always wins (e.g. set via env for staging/testing)
  const override = process.env.YIQIKAN_SERVER_URL?.trim();
  if (override) return override;

  // In dev builds, electron-vite injects YIQIKAN_DEV_SERVER_URL at compile time
  const devUrl = process.env.YIQIKAN_DEV_SERVER_URL?.trim();
  if (devUrl) return devUrl;

  return PROD_SERVER_URL;
}

export const desktopServerUrlFallback = PROD_SERVER_URL;
