import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { cleanHistoryTitle, historySiteName } from './playback-history';
import {
  isWatchlistLinkForMedia, matchesWatchlistLaunch, sameWatchlistMedia, watchlistOpenUrl, watchlistUrl,
  type WatchlistLocation, type WatchlistSample,
} from '../utils/watchlist-media';

const STORAGE_KEY = '@yiqikan_watchlists_v1';
const DEFAULT_LIST = 'next';
const MAX_TITLE = 80;

export interface WatchlistItem extends WatchlistLocation {
  id: string;
  title: string;
  currentTime: number;
  duration: number;
  finished: boolean;
  watchedAt: number;
}

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
}

interface WatchlistData {
  lists: Watchlist[];
  recentListId: string;
}

const initial: WatchlistData = { lists: [{ id: DEFAULT_LIST, name: '下次一起看', items: [] }], recentListId: DEFAULT_LIST };
export const useWatchlists = create<{
  data: WatchlistData;
  status: 'loading' | 'ready' | 'error';
}>(() => ({ data: initial, status: 'loading' }));

let loading: Promise<void> | undefined;
let writes = Promise.resolve();
let sequence = 0;
const id = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const seconds = (time: number) => Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;

export async function loadWatchlists() {
  if (useWatchlists.getState().status === 'ready') return;
  if (loading) return loading;
  useWatchlists.setState({ status: 'loading' });
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const data: WatchlistData = raw ? JSON.parse(raw) : initial;
      if (!Array.isArray(data?.lists) || !data.lists.length || !data.lists.every(list =>
        typeof list.id === 'string' && typeof list.name === 'string' && Array.isArray(list.items) &&
        list.items.every(item => typeof item.id === 'string' && typeof item.title === 'string' && watchlistUrl(item.url) &&
          (!item.episodeUrl || watchlistUrl(item.episodeUrl)) && Number.isFinite(item.currentTime) &&
          Number.isFinite(item.duration) && Number.isFinite(item.watchedAt) && typeof item.finished === 'boolean'))) {
        throw new Error('无法读取片单');
      }
      useWatchlists.setState({ data, status: 'ready' });
    } catch {
      useWatchlists.setState({ status: 'error' });
    } finally { loading = undefined; }
  })();
  return loading;
}

function change<T>(update: (data: WatchlistData) => [WatchlistData, T]) {
  const operation = writes.then(async () => {
    await loadWatchlists();
    const { status, data } = useWatchlists.getState();
    if (status !== 'ready') throw new Error('无法读取片单，请重试');
    const [next, result] = update(data);
    if (next !== data) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      useWatchlists.setState({ data: next });
    }
    return result;
  });
  writes = operation.then(() => {}, () => {});
  return operation;
}

export function recentWatchlist(data: WatchlistData) {
  return data.lists.find(list => list.id === data.recentListId) ?? data.lists[0];
}

export function nextWatchlistItem(list: Watchlist) {
  return list.items.reduce<WatchlistItem | undefined>((next, item) =>
    !item.finished && (!next || item.watchedAt > next.watchedAt) ? item : next, undefined);
}

export function rememberWatchlist(listId: string) {
  return change(data => [data.recentListId !== listId && data.lists.some(list => list.id === listId)
    ? { ...data, recentListId: listId } : data, undefined]);
}

export function createWatchlist(name: string) {
  const title = name.trim().slice(0, 30);
  return change(data => {
    if (!title) throw new Error('请输入片单名称');
    if (data.lists.some(list => list.name === title)) throw new Error('已经有同名片单');
    const list = { id: id(), name: title, items: [] };
    return [{ lists: [...data.lists, list], recentListId: list.id }, list];
  });
}

export function renameWatchlist(listId: string, name: string) {
  const title = name.trim().slice(0, 30);
  return change(data => {
    if (!title) throw new Error('请输入片单名称');
    if (data.lists.some(list => list.id !== listId && list.name === title)) throw new Error('已经有同名片单');
    return [{ ...data, lists: data.lists.map(list => list.id === listId ? { ...list, name: title } : list) }, undefined];
  });
}

export function deleteWatchlist(listId: string) {
  return change(data => {
    if (data.lists.length < 2) throw new Error('请至少保留一个片单');
    const lists = data.lists.filter(list => list.id !== listId);
    return [{ lists, recentListId: data.recentListId === listId ? lists[0].id : data.recentListId }, undefined];
  });
}

export function saveWatchlistItem(location: WatchlistLocation, title?: string, sample?: WatchlistSample, listId?: string) {
  return change(data => {
    const list = listId ? data.lists.find(entry => entry.id === listId) : recentWatchlist(data);
    const url = watchlistUrl(location.url);
    if (!list) throw new Error('这张片单已移除');
    if (!url) throw new Error('请输入完整的视频网址');
    const episodeUrl = watchlistUrl(location.episodeUrl);
    const target = { ...location, url, episodeUrl };
    const existing = list.items.find(item => sameWatchlistMedia(item, target) || isWatchlistLinkForMedia(item, target));
    const playback = sample && sameWatchlistMedia(target, sample.location) && sample.duration > 0 ? sample : undefined;
    const item: WatchlistItem = existing ?? {
      ...target,
      id: id(),
      title: title?.trim().slice(0, MAX_TITLE) || historySiteName(url),
      currentTime: playback ? Math.min(seconds(playback.currentTime), seconds(playback.duration)) : 0,
      duration: playback ? seconds(playback.duration) : 0,
      finished: Boolean(playback && complete(playback)),
      watchedAt: playback && playback.currentTime > 0 ? Date.now() : 0,
    };
    const next = existing ? data : { lists: data.lists.map(entry => entry.id === list.id ? { ...entry, items: [...entry.items, item] } : entry),
      recentListId: list.id };
    return [next, { listId: list.id, listName: list.name, item, added: !existing }];
  });
}

export function removeWatchlistItem(listId: string, itemId: string) {
  return change(data => [{ ...data, lists: data.lists.map(list => list.id === listId ?
    { ...list, items: list.items.filter(item => item.id !== itemId) } : list) }, undefined]);
}

function complete(sample: WatchlistSample) {
  return sample.duration > 0 && (sample.ended === true || sample.currentTime / sample.duration >= .96);
}

function matchesProgress(item: WatchlistItem, sample: WatchlistSample, launchedItemId?: string) {
  return sameWatchlistMedia(item, sample.location) ||
    (item.id === launchedItemId && matchesWatchlistLaunch(item, sample.location));
}

export function hasWatchlistProgressTarget(sample: WatchlistSample, launchedItemId?: string) {
  const { data, status } = useWatchlists.getState();
  return status === 'ready' && data.lists.some(list => list.items.some(item => matchesProgress(item, sample, launchedItemId)));
}

export function recordWatchlistProgress(sample: WatchlistSample, launchedItemId?: string) {
  if (!Number.isFinite(sample.currentTime) || sample.currentTime < 1 || !Number.isFinite(sample.duration) || sample.duration < 1) return Promise.resolve();
  return change(data => {
    let changed = false;
    const lists = data.lists.map(list => {
      let changedList = false;
      const items = list.items.map(item => {
        if (!matchesProgress(item, sample, launchedItemId)) return item;
        const duration = seconds(sample.duration), currentTime = Math.min(duration, seconds(sample.currentTime));
        const title = item.title === historySiteName(item.url) ? cleanHistoryTitle(sample.title, item.url) : item.title;
        const finished = item.finished || complete(sample);
        if (item.duration === duration && item.currentTime === currentTime && item.finished === finished && item.title === title) return item;
        changed = changedList = true;
        const location = sameWatchlistMedia(item, sample.location) ? item : sample.location;
        return { ...item, ...location, title, duration, currentTime, finished, watchedAt: Date.now() };
      });
      return changedList ? { ...list, items } : list;
    });
    return [changed ? { ...data, lists } : data, undefined];
  });
}

export { watchlistOpenUrl };
