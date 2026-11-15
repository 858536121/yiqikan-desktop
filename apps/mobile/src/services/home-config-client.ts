export interface RecommendSite {
  name: string;
  url: string;
  color: string;
  tag: string;
}

export const DEFAULT_POPULAR_SITES: RecommendSite[] = [
  { name: '本地视频', url: 'yiqikan://player', color: '#10B981', tag: '免插件' },
  { name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#00AEEC', tag: 'B站' },
];
export const DEFAULT_SEARCH_TEMPLATE = 'https://www.baidu.com/s?wd=%s';

export interface HomeConfigSnapshot {
  recommendSites: RecommendSite[];
  searchTemplate: string;
  refreshing: boolean;
  unavailable: boolean;
  showSettings: boolean;
}

type Resource = 'sites' | 'search';
interface ResourceState { lastSuccess: number | null; failures: number; remoteLoaded: boolean }
interface Options {
  platform: string;
  appVersion: string;
  webUrl: string;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

const RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000];
const REQUEST_TIMEOUT = 8000;
const FRESH_FOR = 5 * 60 * 1000;
const resources: Resource[] = ['sites', 'search'];

function parseSites(value: unknown): RecommendSite[] {
  if (!Array.isArray(value) || !value.every(site => site && typeof site.name === 'string'
    && site.name.trim() && typeof site.url === 'string' && /^(https?:\/\/|yiqikan:\/\/|local:\/\/)/i.test(site.url)
    && (site.color === undefined || typeof site.color === 'string')
    && (site.tag === undefined || typeof site.tag === 'string'))) throw new Error('Invalid recommendations');
  // An intentional empty list is a successful configuration, including in cache.
  return value.map(site => ({ name: site.name, url: site.url, color: site.color || '#F97316', tag: site.tag || '' }));
}

function parseTemplate(value: unknown): string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || !value.includes('%s')) {
    throw new Error('Invalid search template');
  }
  return value;
}

/** Screen-scoped configuration: local content first, bounded foreground recovery. */
export class HomeConfigClient {
  private snapshot: HomeConfigSnapshot = {
    recommendSites: DEFAULT_POPULAR_SITES, searchTemplate: DEFAULT_SEARCH_TEMPLATE,
    refreshing: false, unavailable: false, showSettings: false,
  };
  private listeners = new Set<() => void>();
  private states: Record<Resource, ResourceState> = {
    sites: { lastSuccess: null, failures: 0, remoteLoaded: false },
    search: { lastSuccess: null, failures: 0, remoteLoaded: false },
  };
  private active = false;
  private generation = 0;
  private cacheGeneration = 0;
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelRequests = new Set<() => void>();
  private pendingRecovery = false;

  constructor(private options: Options) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<HomeConfigSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch,
      unavailable: resources.some(key => this.states[key].failures > 0),
      showSettings: resources.some(key => this.states[key].failures >= 3),
    };
    for (const listener of this.listeners) listener();
  }

  private cacheKey(key: Resource) {
    return `@${key === 'sites' ? 'recommend_sites' : 'search_template'}:${this.options.platform}:${this.options.appVersion}`;
  }

  loadCache() {
    const generation = ++this.cacheGeneration;
    for (const key of resources) {
      void Promise.resolve().then(() => this.options.storage.getItem(this.cacheKey(key))).then(cached => {
        if (!cached || generation !== this.cacheGeneration || this.states[key].remoteLoaded) return;
        const data = JSON.parse(cached);
        this.publish(key === 'sites' ? { recommendSites: parseSites(data) } : { searchTemplate: parseTemplate(data) });
      }).catch(() => {});
    }
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) this.recover();
    else {
      this.generation++;
      this.clearRetry();
      for (const cancel of this.cancelRequests) cancel();
      this.cancelRequests.clear();
      this.pendingRecovery = false;
      this.publish({ refreshing: false });
    }
  }

  /** Network and foreground signals are hints; only a valid API response proves success. */
  recover = () => {
    if (!this.active) return;
    if (this.snapshot.refreshing) { this.pendingRecovery = true; return; }
    this.retryIndex = 0;
    this.clearRetry();
    void this.refresh(false);
  };

  retry = () => {
    if (!this.active || this.snapshot.refreshing) return;
    this.retryIndex = 0;
    this.clearRetry();
    void this.refresh(true);
  };

  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private request(key: Resource): Promise<unknown> {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, data?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.cancelRequests.delete(cancel);
        if (error) { controller.abort(); reject(error); }
        else resolve(data);
      };
      const cancel = () => finish(new Error('Cancelled'));
      const timeout = setTimeout(() => finish(new Error('Timed out')), REQUEST_TIMEOUT);
      this.cancelRequests.add(cancel);
      const query = `platform=${encodeURIComponent(this.options.platform)}&version=${encodeURIComponent(this.options.appVersion)}`;
      // The deadline also covers response-body parsing, even if a fetch implementation ignores abort.
      void Promise.resolve().then(() => this.options.fetch(
        `${this.options.webUrl}/api/${key === 'sites' ? 'recommend-sites' : 'search-config'}?${query}`,
        { cache: 'no-store', signal: controller.signal },
      )).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then(data => finish(null, data), error => finish(error));
    });
  }

  private async refresh(force: boolean) {
    const due = resources.filter(key => force || this.states[key].failures > 0
      || this.states[key].lastSuccess === null || Date.now() - this.states[key].lastSuccess! >= FRESH_FOR);
    if (!this.active || this.snapshot.refreshing || !due.length) return;
    const generation = ++this.generation;
    this.publish({ refreshing: true });
    await Promise.all(due.map(async key => {
      try {
        const data = await this.request(key);
        if (!this.active || generation !== this.generation) return;
        const value = key === 'sites' ? parseSites(data) : parseTemplate((data as { templateUrl?: unknown })?.templateUrl);
        this.states[key] = { lastSuccess: Date.now(), failures: 0, remoteLoaded: true };
        this.publish(key === 'sites' ? { recommendSites: value as RecommendSite[] } : { searchTemplate: value as string });
        // Cache failures must never turn a successful network refresh into an error.
        void Promise.resolve().then(() => this.options.storage.setItem(this.cacheKey(key), JSON.stringify(value))).catch(() => {});
      } catch {
        if (!this.active || generation !== this.generation) return;
        this.states[key].failures++;
        this.publish();
      }
    }));
    if (!this.active || generation !== this.generation) return;
    this.publish({ refreshing: false });
    if (this.pendingRecovery) {
      this.pendingRecovery = false;
      this.recover();
    } else if (this.snapshot.unavailable && this.retryIndex < RETRY_DELAYS.length) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.refresh(false);
      }, RETRY_DELAYS[this.retryIndex++]);
    }
  }

  dispose() {
    this.cacheGeneration++;
    this.setActive(false);
  }
}
