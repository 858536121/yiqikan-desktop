import type { DesktopRuntimeContext, ReleaseChannel } from "@yiqikan/shared";
import { YIQIKAN_PROTOCOL_VERSION } from "@yiqikan/shared";
import desktopPackageJson from "../../package.json";

function readBooleanFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function readReleaseChannel(value: string | undefined): ReleaseChannel {
  if (value === "alpha" || value === "beta" || value === "stable") {
    return value;
  }
  return "stable";
}

function readOptionalUrl(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const desktopRuntimeContext: DesktopRuntimeContext = {
  client: {
    appName: "异起看",
    appVersion: desktopPackageJson.version,
    protocolVersion: YIQIKAN_PROTOCOL_VERSION,
    platform: "desktop",
    releaseChannel: readReleaseChannel(process.env.YIQIKAN_RELEASE_CHANNEL),
  },
  updates: {
    enabled: readBooleanFlag(process.env.YIQIKAN_UPDATES_ENABLED, false),
    checkOnLaunch: readBooleanFlag(process.env.YIQIKAN_UPDATES_CHECK_ON_LAUNCH, false),
    allowPrerelease: readBooleanFlag(process.env.YIQIKAN_UPDATES_ALLOW_PRERELEASE, false),
    feedUrl: readOptionalUrl(process.env.YIQIKAN_UPDATES_FEED_URL),
  },
  remoteConfig: {
    enabled: readBooleanFlag(process.env.YIQIKAN_REMOTE_CONFIG_ENABLED, false),
    url: readOptionalUrl(process.env.YIQIKAN_REMOTE_CONFIG_URL),
    refreshIntervalMs: readPositiveInteger(process.env.YIQIKAN_REMOTE_CONFIG_REFRESH_MS, 300000),
  },
};
