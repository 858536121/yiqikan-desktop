import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowUpRight, ChevronRight, Download, Link2, PlusCircle, Share2 } from 'lucide-react-native';
import type Svg from 'react-native-svg';
import { PROD_WEB_URL, resolveWebUrl } from '../../services/environment';
import { roomInviteLink } from '../../services/room-invite';
import { useRoomStore } from '../../store/useRoomStore';
import { APP_BACKGROUND } from '../../theme/colors';
import { InviteArtwork, InviteEntryArtwork, inviteArtworkHeight, INVITE_ARTWORK_WIDTH, type InviteChannel } from './invite-artwork';

const downloadUrl = `${PROD_WEB_URL}/#download`;
const defaultNote = '给你留了一个座位，今晚一起看？';
const defaultTitle = '今晚一起看';
const ios = Platform.OS === 'ios';
// UIKit renders at screen density and uses the SVG view's bounds to lay out the artwork.
const captureScale = ios ? 0.5 : 1;
const captureWidth = INVITE_ARTWORK_WIDTH * captureScale;

const channels = [
  { id: 'friend', text: '发给好友' },
  { id: 'moments', text: '朋友圈' },
  { id: 'notes', text: '小红书' },
] satisfies { id: InviteChannel; text: string }[];

const captions = {
  moments: '今晚，一起看点什么？异起看可以同步播放、边看边聊。想约一场的来找我。',
  notes: '异地也能一起看电影｜远距离的观影小约会\n\n想和远方的朋友看一部片时，我们会开个房间同步播放，边看边聊。你们最近一起看了什么？',
};

export function ProfileInviteCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity testID="profile-invite-entry" accessibilityRole="button" accessibilityLabel="请朋友一起看，发一张电影票"
      onPress={onPress} style={styles.card} activeOpacity={0.88}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>请朋友一起看</Text>
        <View style={styles.cardAction}>
          <Text style={styles.cardSubtitle}>发一张电影票</Text>
          <ArrowUpRight size={15} color="#653a31" strokeWidth={2} />
        </View>
      </View>
      <View style={styles.cardStub} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <InviteEntryArtwork />
        <View style={[styles.cardNotch, styles.topNotch]} />
        <View style={[styles.cardNotch, styles.bottomNotch]} />
      </View>
    </TouchableOpacity>
  );
}

function captureInvite(artwork: Svg, channel: InviteChannel) {
  return new Promise<string>((resolve, reject) => {
    const fail = () => reject(new Error('图片生成失败，请重试'));
    const timeout = setTimeout(fail, 5000);
    try {
      artwork.toDataURL(image => {
        clearTimeout(timeout);
        if (image) resolve(image);
        else fail();
      }, { width: captureWidth, height: inviteArtworkHeight[channel] * captureScale });
    } catch {
      clearTimeout(timeout);
      fail();
    }
  });
}

type InviteAction = 'share' | 'save' | 'copy-image' | 'copy-text';

export function ProfileInvitePanel({ onCreateRoom }: { onCreateRoom?: () => void }) {
  const room = useRoomStore(state => state.roomState);
  const connected = useRoomStore(state => state.isConnected);
  const password = useRoomStore(state => state.savedPassword);
  const [channel, setChannel] = useState<InviteChannel>('friend');
  const [note, setNote] = useState(defaultNote);
  const [editing, setEditing] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [action, setAction] = useState<InviteAction | null>(null);
  const artwork = useRef<Svg>(null);
  const processing = useRef(false);
  const friend = channel === 'friend';
  const needsPassword = room?.hasPassword && !password;
  const blocked = friend && !!room && (!connected || needsPassword);
  const busy = action !== null;
  const movie = room?.playback.media?.title || room?.playback.pageTitle || defaultTitle;
  const episode = room?.playback.media?.episode?.label;
  const webOrigin = resolveWebUrl();
  const link = channel === 'notes' || blocked ? undefined
    : friend && room ? roomInviteLink(room.id, room.hasPassword, password, webOrigin) : downloadUrl;
  const previewHeight = friend ? 244 : 316;
  const aspectRatio = INVITE_ARTWORK_WIDTH / inviteArtworkHeight[channel];
  const width = Math.max(1, Math.min(layoutWidth - 20, previewHeight * aspectRatio));

  const checkInvite = () => {
    const current = useRoomStore.getState();
    if (friend && (current.roomState?.id !== room?.id || current.roomState?.instanceId !== room?.instanceId
      || current.roomState?.hasPassword !== room?.hasPassword || (room?.hasPassword && current.savedPassword !== password))) {
      throw new Error('房间状态已变化，请重新分享');
    }
    if (friend && room && (!current.isConnected || needsPassword)) throw new Error('当前房间暂时无法分享');
  };

  const sendInvite = async (next: InviteAction) => {
    if (processing.current) return;
    processing.current = true;
    setAction(next);
    const notify = (message: string) => useRoomStore.getState().showToast(message);
    try {
      checkInvite();
      if (next === 'copy-text') {
        const text = channel === 'friend' ? link : captions[channel];
        if (!text) throw new Error('当前房间暂时无法分享');
        await Clipboard.setStringAsync(text);
        notify(friend ? '邀请已复制' : '配文已复制，可按你的语气修改');
        return;
      }
      if (!artwork.current) throw new Error('图片还在准备，请重试');
      const image = await captureInvite(artwork.current, channel);
      checkInvite();
      if (next === 'copy-image') {
        await Clipboard.setImageAsync(image);
        notify('图片已复制');
        return;
      }
      const { saveInviteImage, shareInviteImage } = await import('../../services/invite-image');
      checkInvite();
      if (next === 'save') {
        await saveInviteImage(image, checkInvite);
        notify('图片已保存到相册');
        return;
      }
      await shareInviteImage(image, friend ? '分享电影票' : '分享观影海报', checkInvite);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      notify(/^(房间状态|当前房间|图片还在|图片生成|请允许|无法打开图片)/.test(message)
        ? message : ({ share: '无法打开图片分享，可以先保存到相册', save: '保存失败，请检查相册权限后重试',
          'copy-image': '无法复制图片，可以改用分享或保存', 'copy-text': '复制失败，请重试' }[next]));
    } finally {
      setAction(null);
      processing.current = false;
    }
  };

  const disabled = blocked || busy || editing || !layoutWidth;
  const instructions = channel === 'notes' ? '3:4 封面 · 保存后搭配自己的观影笔记发布'
    : channel === 'moments' ? '扫码打开异起看，海报里没有房号'
      : !room ? '这张票可扫码下载，创建房间后可发入房票'
        : !connected ? '正在恢复房间连接'
          : needsPassword ? '当前设备没有保存入房密码，请房主发票'
            : room.hasPassword ? '二维码含入房凭证，适合私聊发送' : '扫码即可打开这间房';

  return (
    <View style={styles.panel}>
      <View style={styles.channels} accessibilityLabel="分享场景">
        {channels.map(option => (
          <TouchableOpacity key={option.id} testID={`profile-invite-channel-${option.id}`} accessibilityRole="button"
            accessibilityState={{ selected: channel === option.id, disabled: busy }} disabled={busy}
            onPress={() => { setEditing(false); setChannel(option.id); }} activeOpacity={0.75}
            style={[styles.channel, channel === option.id && styles.activeChannel]}>
            <Text style={[styles.channelText, channel === option.id && styles.activeChannelText]}>{option.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View testID="profile-invite-artwork" style={styles.stage} onLayout={event => setLayoutWidth(event.nativeEvent.layout.width)}>
        {layoutWidth > 0 && (
          <View style={[styles.preview, ios && { width, height: width / aspectRatio }]}>
            <View style={ios ? [styles.iosArtwork, { width: captureWidth, height: captureWidth / aspectRatio,
              transform: [{ scale: width / captureWidth }] }] : undefined}>
              <InviteArtwork artworkRef={artwork} channel={channel} width={ios ? captureWidth : width} title={movie}
                episode={episode} note={note.trim() || defaultNote} link={link} roomId={friend ? room?.id : undefined} />
            </View>
          </View>
        )}
      </View>
      <View style={styles.previewDetails}>
        <Text style={styles.hint}>{instructions}</Text>
        {friend && (
          <TouchableOpacity testID="profile-invite-edit-note" accessibilityRole="button" disabled={busy}
            onPress={() => setEditing(value => !value)} style={styles.editNote}>
            <Text style={styles.linkText}>{editing ? '完成' : '改留言'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {editing && (
        <TextInput testID="profile-invite-note" accessibilityLabel="写给好友的留言" autoFocus maxLength={21}
          returnKeyType="done" onSubmitEditing={() => setEditing(false)} style={styles.noteInput}
          placeholder="写给好友的留言" placeholderTextColor="#aaa1ad" value={note} onChangeText={setNote} />
      )}
      <View style={styles.actions}>
        <TouchableOpacity testID="profile-share-invite" accessibilityRole="button"
          accessibilityState={{ disabled }} disabled={disabled} onPress={() => void sendInvite('share')}
          activeOpacity={0.75} style={[styles.action, styles.primary, disabled && styles.disabled]}>
          <Share2 size={17} color="#301b13" />
          <Text style={styles.primaryText}>{action === 'share' ? '正在准备…' : friend ? '分享电影票' : '分享图片'}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="profile-save-invite" accessibilityRole="button"
          accessibilityState={{ disabled }} disabled={disabled} onPress={() => void sendInvite('save')}
          activeOpacity={0.75} style={[styles.action, styles.secondary, disabled && styles.disabled]}>
          <Download size={17} color="#eee6e3" />
          <Text style={styles.secondaryText}>{action === 'save' ? '正在保存…' : '存到相册'}</Text>
        </TouchableOpacity>
      </View>
      {friend && !room && onCreateRoom && (
        <TouchableOpacity testID="profile-create-invite-room" accessibilityRole="button" disabled={busy}
          onPress={onCreateRoom} activeOpacity={0.75} style={styles.createRoom}>
          <PlusCircle size={18} color="#f6af85" />
          <Text style={styles.secondaryText}>创建房间后发入房票</Text>
          <ChevronRight size={17} color="#c09a8d" />
        </TouchableOpacity>
      )}
      <View style={styles.textActions}>
        <TouchableOpacity testID="profile-copy-invite" accessibilityRole="button" disabled={blocked || busy || editing}
          onPress={() => void sendInvite('copy-text')} style={styles.textAction}>
          <Link2 size={15} color="#eeb499" />
          <Text style={styles.linkText}>{friend ? '复制邀请链接' : '复制配文'}</Text>
        </TouchableOpacity>
        {friend && (
          <TouchableOpacity testID="profile-copy-invite-image" accessibilityRole="button" disabled={disabled}
            onPress={() => void sendInvite('copy-image')} style={styles.textAction}>
            <Text style={styles.linkText}>复制电影票图片</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', marginTop: 12, minHeight: 72, borderRadius: 13, overflow: 'hidden', backgroundColor: '#f2e4cf' },
  cardCopy: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 16 },
  cardTitle: { color: '#2e201e', fontSize: 17, fontWeight: '700' },
  cardAction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  cardSubtitle: { color: '#653a31', fontSize: 12, fontWeight: '600' },
  cardStub: { width: 84, backgroundColor: '#342632', alignItems: 'center', justifyContent: 'center' },
  cardNotch: { backgroundColor: APP_BACKGROUND, borderRadius: 8, position: 'absolute', left: -7, width: 14, height: 14 },
  topNotch: { top: -7 },
  bottomNotch: { bottom: -7 },
  panel: { gap: 9, paddingBottom: 8 },
  channels: { flexDirection: 'row', gap: 4, padding: 4, backgroundColor: '#1a1a23', borderRadius: 12 },
  channel: { flex: 1, minHeight: 44, minWidth: 0, justifyContent: 'center', alignItems: 'center', padding: 4, borderRadius: 9 },
  activeChannel: { backgroundColor: '#49312e' },
  channelText: { color: '#bcb1bf', fontSize: 13, textAlign: 'center' },
  activeChannelText: { color: '#ffd1b2', fontWeight: '700' },
  stage: { minHeight: 80, backgroundColor: '#17171e', borderColor: '#2a2834', borderWidth: 1,
    borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  preview: { borderRadius: 10, overflow: 'hidden' },
  iosArtwork: { position: 'absolute', top: 0, left: 0, transformOrigin: 'top left' },
  previewDetails: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
  hint: { color: '#b9aebd', fontSize: 12, lineHeight: 18, flex: 1, minWidth: 0 },
  editNote: { minHeight: 44, paddingLeft: 6, justifyContent: 'center' },
  noteInput: { minHeight: 44, color: '#f7e4db', backgroundColor: '#23202a', borderColor: '#54424a',
    borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 48, padding: 8, borderRadius: 11 },
  primary: { backgroundColor: '#ffab78' },
  primaryText: { color: '#301b13', fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  secondary: { backgroundColor: '#25222d', borderColor: '#38323e', borderWidth: 1 },
  secondaryText: { color: '#eee6e3', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  textActions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  textAction: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 6 },
  linkText: { color: '#eeb499', fontSize: 13, flexShrink: 1 },
  createRoom: { flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 9,
    paddingHorizontal: 11, backgroundColor: '#221c23', borderRadius: 10 },
  disabled: { opacity: 0.45 },
});
