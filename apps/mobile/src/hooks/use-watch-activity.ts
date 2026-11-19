import { useEffect, useRef, useState } from 'react';
import type { PlaybackMedia, RoomState } from '@yiqikan/shared';
import type { AppTab } from '../components/app/module-shell';
import { episodeLabel } from '../utils/player-transition';

function sameContent(previous: PlaybackMedia, next: PlaybackMedia) {
  if (previous.contentId && next.contentId) return previous.contentId === next.contentId;
  if (previous.title && next.title && previous.episode && next.episode) {
    return previous.title === next.title && previous.pageUrl === next.pageUrl
      && episodeLabel(previous.episode.label) === episodeLabel(next.episode.label);
  }
  return previous.id === next.id;
}

// Observe authoritative content, rather than playback clocks or raw messages.
// This also covers snapshots after reconnect without replaying old activity.
export function useWatchActivity(room: RoomState | null, isHost: boolean, activeTab: AppTab, notify: (message: string) => void) {
  const context = room ? `${room.id}|${room.instanceId || ''}|${room.hostId}|${isHost}` : '';
  const previous = useRef<{ context: string; url: string; media: PlaybackMedia | null } | null>(null);
  const [unseenContext, setUnseenContext] = useState<string | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const url = room?.playback.url || '';
  const media = room?.playback.media;

  useEffect(() => {
    const before = previous.current;
    // Remember known content across a generation being cleared for reload.
    // A new URL's first media discovery belongs to that same navigation.
    previous.current = { context, url, media: media || (before?.context === context && before.url === url ? before.media : null) };
    if (!room || isHost || !before || before.context !== context) {
      setUnseenContext(null);
      return;
    }
    if (activeTab === 'watch' || !url) setUnseenContext(null);
    if (activeTab === 'watch' || !url) return;

    const sameMedia = before.media && media && sameContent(before.media, media);
    const changed = before.url !== url ? !sameMedia : before.media && media && !sameMedia;
    if (!changed) return;

    setUnseenContext(context);
    const host = room.members.find(member => member.id === room.hostId);
    notifyRef.current(`🎬 ${host?.name ? `「${host.name}」` : '房主'}更新了观看内容，点「观看」查看`);
  }, [context, isHost, activeTab, url, media]);

  return Boolean(room && !isHost && activeTab !== 'watch' && unseenContext === context);
}
