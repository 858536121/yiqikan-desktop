import AsyncStorage from '@react-native-async-storage/async-storage';

export const PLAYBACK_HISTORY_STORAGE_KEY = '@yiqikan_playback_history';
export const LEGACY_RECENT_URL_KEY = '@recent_url';
const MAX_HISTORY_ITEMS = 20;

export interface PlaybackHistoryItem {
  url: string;
  title?: string;
  currentTime: number;
  duration: number;
  progressPercent: number;
  isFinished?: boolean;
  updatedAt: number;
}

export interface SaveProgressPayload {
  url: string;
  currentTime: number;
  duration: number;
  title?: string;
}

/**
 * 格式化或清洗影片/网页标题，去除 SEO 水印
 */
export function cleanHistoryTitle(rawTitle?: string, fallbackUrl?: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') {
    if (!fallbackUrl) return '影视内容';
    try {
      const u = new URL(fallbackUrl.startsWith('http') ? fallbackUrl : `https://${fallbackUrl}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return '影视内容';
    }
  }

  let cleaned = rawTitle
    .replace(/_哔哩哔哩_bilibili.*$/i, '')
    .replace(/- 腾讯视频.*$/i, '')
    .replace(/- 优酷.*$/i, '')
    .replace(/- 爱奇艺.*$/i, '')
    .replace(/_芒果TV.*$/i, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim();

  // 若清洗后为空，从 url 提取 hostname
  if (!cleaned && fallbackUrl) {
    try {
      const u = new URL(fallbackUrl.startsWith('http') ? fallbackUrl : `https://${fallbackUrl}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return '影视内容';
    }
  }

  return cleaned.length > 40 ? cleaned.slice(0, 40) + '...' : (cleaned || '影视内容');
}

/**
 * 获取完整的播放历史记录列表
 */
export async function getRecentPlaybackList(limit = 10): Promise<PlaybackHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYBACK_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const list: PlaybackHistoryItem[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.slice(0, limit);
  } catch (e) {
    console.warn('[PlaybackHistory] 读取播放历史失败:', e);
    return [];
  }
}

/**
 * 获取最新一条播放记录（大厅卡片使用）
 */
export async function getLatestPlayback(): Promise<PlaybackHistoryItem | null> {
  const list = await getRecentPlaybackList(1);
  return list.length > 0 ? list[0] : null;
}

/**
 * 根据 URL 匹配历史进度
 */
export async function getPlaybackProgress(url: string): Promise<PlaybackHistoryItem | null> {
  if (!url || url.startsWith('about:blank')) return null;
  const list = await getRecentPlaybackList(MAX_HISTORY_ITEMS);
  const found = list.find((item) => item.url === url);
  return found || null;
}

/**
 * 保存或更新播放进度（内置防抖/节流与有效门槛过滤）
 */
let lastSaveTime = 0;
let pendingSaveTimer: any = null;
let lastPendingPayload: SaveProgressPayload | null = null;

/**
 * 立即执行未完成的暂存进度，直接写入磁盘
 * （在按 Home 键切后台、离开播放器或销毁时调用）
 */
export async function flushPlaybackProgress(): Promise<void> {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (lastPendingPayload) {
    const payload = lastPendingPayload;
    lastPendingPayload = null;
    await executeSaveProgress(payload);
  }
}

export async function savePlaybackProgress(payload: SaveProgressPayload, immediate = false): Promise<void> {
  const { url, currentTime, duration, title } = payload;
  if (!url || url.startsWith('about:blank') || typeof currentTime !== 'number' || currentTime < 0) {
    return;
  }
  lastPendingPayload = payload;

  const now = Date.now();
  // 非立即存盘且处于3秒节流期内：延迟等待防抖
  if (!immediate && now - lastSaveTime < 3000) {
    if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => {
      flushPlaybackProgress();
    }, 3000);
    return;
  }

  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }

  lastSaveTime = now;
  lastPendingPayload = null;
  await executeSaveProgress(payload);
}

/**
 * 执行真实的存储写入
 */
async function executeSaveProgress(payload: SaveProgressPayload): Promise<void> {
  try {
    const { url, currentTime, duration = 0, title } = payload;
    
    // 计算进度百分比与是否已完结
    let progressPercent = 0;
    let isFinished = false;
    if (duration > 0) {
      progressPercent = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
      // 如果剩余时长不足 15 秒或进度超过 96%，视为已看完
      if (currentTime >= duration - 15 || progressPercent >= 96) {
        isFinished = true;
      }
    }

    const currentList = await getRecentPlaybackList(MAX_HISTORY_ITEMS);
    // 过滤旧的同一 URL 记录
    const filtered = currentList.filter((item) => item.url !== url);

    const safeTitle = cleanHistoryTitle(title, url);

    const newItem: PlaybackHistoryItem = {
      url,
      title: safeTitle,
      currentTime: Math.floor(currentTime),
      duration: Math.floor(duration),
      progressPercent,
      isFinished,
      updatedAt: Date.now(),
    };

    // 最多保留 20 条
    const updatedList = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    await AsyncStorage.setItem(PLAYBACK_HISTORY_STORAGE_KEY, JSON.stringify(updatedList));

    // 兼容历史老字段 @recent_url
    await AsyncStorage.setItem(LEGACY_RECENT_URL_KEY, url);
  } catch (e) {
    console.warn('[PlaybackHistory] 保存进度失败:', e);
  }
}

/**
 * 移除指定历史记录
 */
export async function removeHistoryItem(url: string): Promise<void> {
  try {
    const currentList = await getRecentPlaybackList(MAX_HISTORY_ITEMS);
    const updatedList = currentList.filter((item) => item.url !== url);
    await AsyncStorage.setItem(PLAYBACK_HISTORY_STORAGE_KEY, JSON.stringify(updatedList));
  } catch (e) {
    console.warn('[PlaybackHistory] 移除历史记录失败:', e);
  }
}

/**
 * 清空全部播放历史
 */
export async function clearPlaybackHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PLAYBACK_HISTORY_STORAGE_KEY);
    await AsyncStorage.removeItem(LEGACY_RECENT_URL_KEY);
  } catch (e) {
    console.warn('[PlaybackHistory] 清空历史记录失败:', e);
  }
}
