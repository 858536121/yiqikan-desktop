import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, ClipboardPaste, Clapperboard, Compass, Ellipsis, Film, Link2, LockKeyhole, Play, Plus, Trash2, Trophy, X } from 'lucide-react-native';
import { APP_BACKGROUND, appControlColors as colors } from '../../theme/colors';
import { formatTime } from '../../utils/time';
import { historySiteName } from '../../services/playback-history';
import {
  createWatchlist, deleteWatchlist, loadWatchlists, nextWatchlistItem, recentWatchlist, removeWatchlistItem, renameWatchlist,
  saveWatchlistItem, useWatchlists, type Watchlist, type WatchlistItem,
} from '../../services/watchlists';
import { isWatchlistLinkForMedia, sameWatchlistMedia, watchlistUrl, type WatchlistLocation } from '../../utils/watchlist-media';
import { showConfirm } from '../../store/useDialogStore';
import { useRoomStore } from '../../store/useRoomStore';
import { WatchlistCover } from './watchlist-ui';
import { AppActionRow, AppActionSheet, AppButton, AppIconButton } from './app-ui';

type Editor = 'create' | 'rename' | 'link';

export function WatchlistPanel({ listId, onSelect, onClose, onPlay, onBrowse, registerBack }: {
  listId?: string;
  onSelect: (id?: string) => void;
  onClose: () => void;
  onPlay: (item: WatchlistItem, listId: string) => void;
  onBrowse: (list: Watchlist) => void;
  registerBack: (handler: (() => void) | null) => void;
}) {
  const { data, status } = useWatchlists();
  const list = data.lists.find(entry => entry.id === listId);
  const featured = recentWatchlist(data);
  const [editor, setEditor] = useState<Editor>();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const next = list && nextWatchlistItem(list);
  const finished = list?.items.filter(item => item.finished).length ?? 0;
  const notify = (message: string) => useRoomStore.getState().showToast(message);

  const goBack = () => {
    if (saving) return;
    Keyboard.dismiss();
    if (addMenu) setAddMenu(false);
    else if (editor) setEditor(undefined);
    else if (options) setOptions(false);
    else if (list) onSelect();
    else onClose();
  };
  useEffect(() => {
    registerBack(goBack);
    return () => registerBack(null);
  });
  useEffect(() => {
    setEditor(undefined);
    setOptions(false);
    setAddMenu(false);
  }, [listId]);

  function edit(mode: Editor) {
    setName(mode === 'rename' ? list?.name ?? '' : '');
    setLink('');
    setError('');
    setOptions(false);
    setEditor(mode);
  }

  function fillLink(value: string) {
    const text = value.trim();
    if (!text) { setError('剪贴板没有可粘贴的链接'); return; }
    setLink(text.slice(0, 4096));
    setError('');
  }

  async function pasteLink() {
    try { fillLink(await Clipboard.getStringAsync()); }
    catch { setError('无法读取剪贴板，可长按输入框粘贴'); }
  }

  async function save() {
    if (saving || !editor) return;
    const url = editor === 'link' ? watchlistUrl(link) : undefined;
    if (editor === 'link' && !url) { setError('请输入完整的 http 或 https 视频链接'); return; }
    if (editor !== 'link' && !name.trim()) { setError('请输入片单名称'); return; }
    setSaving(true);
    setError('');
    try {
      if (editor === 'create') onSelect((await createWatchlist(name)).id);
      if (editor === 'rename' && list) await renameWatchlist(list.id, name);
      if (editor === 'link' && list && url) {
        const result = await saveWatchlistItem({ url }, name, undefined, list.id);
        if (!result.added) { setError('这个链接已经在片单里'); return; }
      }
      Keyboard.dismiss();
      setEditor(undefined);
      notify(editor === 'link' ? '链接已保存' : '片单已保存');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  }

  const removeItem = (item: WatchlistItem, from: Watchlist) => showConfirm({
    title: '移出片单', message: `从「${from.name}」移出「${item.title}」？`, confirmText: '移出', type: 'danger',
    onConfirm: async () => { await removeWatchlistItem(from.id, item.id); notify('已移出片单'); },
  });
  const removeList = (target: Watchlist) => showConfirm({
    title: '删除片单', message: `删除「${target.name}」及其中的片单记录？`, confirmText: '删除', type: 'danger',
    onConfirm: async () => { await deleteWatchlist(target.id); onSelect(); notify('已删除片单'); },
  });
  const editorTitle = editor === 'link' ? '添加视频链接' : editor === 'rename' ? '重命名片单' : '新建片单';

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.nav}>
      <AppIconButton label="返回" testID="watchlist-back" icon={ChevronLeft} onPress={goBack} />
      <Text style={styles.navTitle} numberOfLines={1}>{editor ? '' : list?.name ?? '我的'}</Text>
      {!editor && status === 'ready' && (list ? <>
        {!!list.items.length && <AppIconButton label="添加视频" icon={Plus} highlighted testID="watchlist-add-link" onPress={() => setAddMenu(true)} />}
        <AppIconButton label="片单设置" icon={options ? X : Ellipsis} expanded={options} onPress={() => setOptions(value => !value)} />
      </> : <AppButton label="新建片单" icon={Plus} testID="watchlist-create" onPress={() => edit('create')} />)}
    </View>

    {editor ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.pageTitle}>{editorTitle}</Text>
      {editor === 'link' && !!list && <View style={styles.destination}>
        <Bookmark size={15} color={colors.accent} /><Text style={styles.meta} numberOfLines={1}>存入 {list.name}</Text>
      </View>}
      <View style={styles.form}>
        {editor === 'link' && <>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>视频链接</Text>
            {Clipboard.isPasteButtonAvailable ? <Clipboard.ClipboardPasteButton
              style={styles.nativePaste} displayMode="iconAndLabel" acceptedContentTypes={['plain-text']}
              backgroundColor={colors.surface} foregroundColor={colors.paper}
              onPress={data => { if (!saving && data.type === 'text') fillLink(data.text); }} />
              : <AppButton label="粘贴" icon={ClipboardPaste} tone="quiet" disabled={saving} onPress={() => void pasteLink()} />}
          </View>
          <TextInput testID="watchlist-url" accessibilityLabel="视频链接" style={styles.input} placeholder="https://"
            placeholderTextColor={colors.muted} value={link} onChangeText={setLink} editable={!saving}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={4096} />
        </>}
        <Text style={styles.fieldLabel}>{editor === 'link' ? '视频标题（选填）' : '片单名称'}</Text>
        <TextInput testID="watchlist-name" accessibilityLabel={editor === 'link' ? '视频标题' : '片单名称'} style={styles.input}
          placeholder={editor === 'link' ? '例如：周五一起看这部' : '例如：周五电影夜'} placeholderTextColor={colors.muted} value={name}
          onChangeText={setName} editable={!saving} maxLength={editor === 'link' ? 80 : 30} onSubmitEditing={() => void save()} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <AppButton label={editor === 'link' ? '保存链接' : '保存片单'} tone="primary" testID="watchlist-submit" busy={saving} onPress={() => void save()} />
      </View>
    </ScrollView> : status === 'loading' ? <ActivityIndicator style={styles.center} color={colors.accent} /> :
      status === 'error' ? <View style={styles.center}><Text style={styles.meta}>暂时无法读取片单</Text>
        <AppButton label="重试" onPress={() => void loadWatchlists()} /></View> :
      list ? <FlatList key={list.id} data={list.items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
        ListHeaderComponent={<>
          {options && <View style={styles.menu}>
            <AppButton label="重命名" onPress={() => edit('rename')} />
            {data.lists.length > 1 && <AppButton label="删除片单" icon={Trash2} tone="quiet" onPress={() => {
              setOptions(false);
              removeList(list);
            }} />}
          </View>}
          {next ? <ResumeCard item={next} onPlay={() => onPlay(next, list.id)} /> :
            list.items.length ? <WatchlistCover tall><View style={styles.hero}>
              <View style={styles.heroTag}><Trophy size={14} color={colors.paper} /><Text style={styles.heroTagText}>全部完成</Text></View>
              <Text accessibilityRole="header" style={styles.heroTitle}>片单已看完</Text>
              <Text style={styles.heroMeta}>{finished} 部视频已看完</Text>
            </View></WatchlistCover> : <WatchlistCover tall><View style={styles.hero}>
              <Text accessibilityRole="header" style={styles.heroTitle}>把想看的留到下次</Text>
              <Text style={styles.heroMeta}>存下视频或剧集，下次打开接着看。</Text>
              <View style={styles.heroAction}><AppButton label="添加视频" icon={Plus} tone="primary"
                testID="watchlist-add-link" onPress={() => setAddMenu(true)} /></View>
            </View></WatchlistCover>}
          {!!list.items.length && <SectionTitle title="片单内容" subtitle={`${finished} / ${list.items.length} 个已看完`} />}
        </>}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => <View style={styles.mediaRow}>
          <Pressable accessibilityRole="button" testID="watchlist-play-item" accessibilityLabel={`播放 ${item.title}，${itemSubtitle(item)}`}
            android_ripple={{ color: '#FFFFFF12' }} style={({ pressed }) => [styles.mediaBody, pressed && styles.pressed]}
            onPress={() => onPlay(item, list.id)}>
            <View style={[styles.mediaTile, item.finished && styles.completedTile]}>
              {item.finished ? <Check size={18} strokeWidth={2.2} color={colors.done} /> : <Film size={17} strokeWidth={1.75} color={colors.accent} />}
            </View>
            <View style={styles.mediaCopy}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>{itemSubtitle(item)}</Text>
            </View>
            {!options && <View style={styles.playDisc}><Play size={13} color={colors.paper} fill={colors.paper} /></View>}
          </Pressable>
          {options && <AppIconButton label={`移出 ${item.title}`} color="#DDA39A" icon={Trash2} onPress={() => removeItem(item, list)} />}
        </View>} /> :
        <FlatList data={data.lists.filter(entry => entry.id !== featured.id)} keyExtractor={entry => entry.id} contentContainerStyle={styles.content}
          ListHeaderComponent={<>
            <Text accessibilityRole="header" style={styles.pageTitle}>片单</Text>
            <View style={styles.local}><LockKeyhole size={13} color={colors.muted} /><Text style={styles.meta}>仅保存在这台设备</Text></View>
            <FeaturedList list={featured} onOpen={() => onSelect(featured.id)} />
            {data.lists.length > 1 && <SectionTitle title="其他片单" />}
          </>}
          ItemSeparatorComponent={Separator}
          renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} testID="watchlist-select"
            android_ripple={{ color: '#FFFFFF12' }} style={({ pressed }) => [styles.mediaBody, pressed && styles.pressed]} onPress={() => onSelect(item.id)}>
            <View style={styles.mediaTile}><Bookmark size={17} strokeWidth={1.75} color={colors.accent} /></View>
            <View style={styles.mediaCopy}>
              <Text style={styles.title} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.meta}>{item.items.length} 个视频</Text>
            </View>
            <ArrowUpRight size={17} color={colors.muted} />
          </Pressable>} />}
    <WatchlistAddMenu list={addMenu ? list : undefined} onClose={() => setAddMenu(false)}
      onPaste={() => { setAddMenu(false); edit('link'); }}
      onBrowse={() => { setAddMenu(false); if (list) onBrowse(list); }} />
  </KeyboardAvoidingView>;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}
  </View>;
}

function Separator() {
  return <View style={styles.separator} />;
}

function itemSubtitle(item: WatchlistItem) {
  return [item.episode, item.finished ? '已看完' : item.currentTime ? `看到 ${formatTime(item.currentTime)}` : '待看', historySiteName(item.url)].filter(Boolean).join(' · ');
}

function FeaturedList({ list, onOpen }: { list: Watchlist; onOpen: () => void }) {
  const finished = list.items.filter(item => item.finished).length;
  return <Pressable testID="watchlist-select" accessibilityLabel={list.name} accessibilityRole="button" onPress={onOpen}
    android_ripple={{ color: '#FFFFFF20' }} style={({ pressed }) => [styles.featured, pressed && styles.pressed]}>
    <WatchlistCover tall>
      <View style={styles.hero}>
        <View style={styles.heroTag}><Clapperboard size={14} color={colors.paper} /><Text style={styles.heroTagText}>最近使用</Text></View>
        <Text style={styles.heroTitle} numberOfLines={2}>{list.name}</Text>
        <View style={styles.featuredFoot}>
          <View style={styles.mediaCopy}>
            <Text style={styles.heroMeta}>{list.items.length ? `${list.items.length} 个视频 · ${finished} 个已看完` : '添加想看的网页视频'}</Text>
            {!!list.items.length && <Progress value={finished / list.items.length} />}
          </View>
          <View style={styles.openDisc}><ArrowUpRight size={21} strokeWidth={1.9} color="#332016" /></View>
        </View>
      </View>
    </WatchlistCover>
  </Pressable>;
}

function Progress({ value }: { value: number }) {
  return <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(1, Math.max(0, value)) * 100}%` }]} /></View>;
}

function ResumeCard({ item, onPlay }: { item: WatchlistItem; onPlay: () => void }) {
  return <WatchlistCover tall><View style={styles.hero}>
    <View style={styles.heroTag}><Play size={13} color={colors.paper} fill={colors.paper} /><Text style={styles.heroTagText}>{item.currentTime ? '接着看' : '下次看'}</Text></View>
    <Text accessibilityRole="header" style={styles.heroTitle} numberOfLines={2}>{item.title}</Text>
    <Text style={styles.heroMeta} numberOfLines={1}>{[item.episode, historySiteName(item.url)].filter(Boolean).join(' · ')}</Text>
    {item.currentTime > 0 && item.duration > 0 && <View style={styles.resumeProgress}>
      <Progress value={item.currentTime / item.duration} />
      <View style={styles.timeRow}><Text style={styles.time}>{formatTime(item.currentTime)}</Text><Text style={styles.time}>{formatTime(item.duration)}</Text></View>
    </View>}
    <View style={styles.heroAction}><AppButton label={item.currentTime ? '继续播放' : '打开播放'} icon={Play}
      tone="primary" testID="watchlist-resume" onPress={onPlay} /></View>
  </View></WatchlistCover>;
}

function WatchlistAddMenu({ list, onClose, onPaste, onBrowse }: {
  list?: Watchlist;
  onClose: () => void;
  onPaste: () => void;
  onBrowse: () => void;
}) {
  const actions = [
    { id: 'watchlist-add-paste', title: '粘贴链接', description: '手里已经有视频网址', icon: Link2, onPress: onPaste },
    { id: 'watchlist-add-browse', title: '去观看页选', description: '找到视频或某一集再保存', icon: Compass, onPress: onBrowse },
  ];
  return <AppActionSheet visible={!!list} heading="添加视频" description={list?.name} onClose={onClose}>
    <View style={styles.sheetLists}>
      {actions.map(({ id, title, description, icon: Icon, onPress }, index) => <React.Fragment key={id}>
        {!!index && <Separator />}
        <AppActionRow testID={id} title={title} description={description} icon={Icon} trailingIcon={ChevronRight} onPress={onPress} />
      </React.Fragment>)}
    </View>
  </AppActionSheet>;
}

export function WatchlistPicker({ target, title, onClose, onSelect, onRemove }: {
  target: WatchlistLocation | null;
  title?: string;
  onClose: () => void;
  onSelect: (list: Watchlist) => void;
  onRemove: (list: Watchlist) => void;
}) {
  const lists = useWatchlists(state => state.data.lists);
  return <AppActionSheet visible={!!target} heading="存入片单" description={title} onClose={onClose} closeTestID="watchlist-picker-close">
    <ScrollView contentContainerStyle={styles.sheetLists}>
      {target && lists.map((list, index) => <React.Fragment key={list.id}>
        {!!index && <Separator />}
        <WatchlistPickerRow target={target} list={list} onSelect={onSelect} onRemove={onRemove} />
      </React.Fragment>)}
    </ScrollView>
  </AppActionSheet>;
}

function WatchlistPickerRow({ target, list, onSelect, onRemove }: {
  target: WatchlistLocation; list: Watchlist; onSelect: (list: Watchlist) => void; onRemove: (list: Watchlist) => void;
}) {
  const saved = list.items.some(item => sameWatchlistMedia(item, target) || isWatchlistLinkForMedia(item, target));
  return <View style={styles.mediaRow}>
    <AppActionRow title={list.name} description={saved ? '已存入 · 仅本机' : '仅本机'} icon={saved ? Check : Bookmark}
      trailingIcon={saved ? undefined : Plus} selected={saved} onPress={() => onSelect(list)} />
    {saved && <AppIconButton label={`从 ${list.name} 移出`} icon={Trash2} color={colors.muted} onPress={() => onRemove(list)} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: APP_BACKGROUND },
  nav: { minHeight: 58, paddingLeft: 9, paddingRight: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  navTitle: { flex: 1, minWidth: 0, color: colors.ink, fontWeight: '600', fontSize: 16 },
  pageTitle: { color: colors.ink, fontSize: 32, fontWeight: '800', lineHeight: 41, marginBottom: 7 },
  content: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 27 },
  local: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 18 },
  featured: { overflow: 'hidden', borderRadius: 23 },
  hero: { flex: 1, minHeight: 226, padding: 20, justifyContent: 'flex-end', gap: 8 },
  heroTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#241319B5',
    borderColor: '#FFE4CD45', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 9, paddingVertical: 4 },
  heroTagText: { color: colors.paper, fontWeight: '700', fontSize: 11 },
  heroTitle: { color: colors.ink, fontSize: 28, lineHeight: 36, fontWeight: '800' },
  heroMeta: { color: colors.warmMuted, fontSize: 13, lineHeight: 19 },
  heroAction: { alignSelf: 'flex-start', marginTop: 4 },
  featuredFoot: { flexDirection: 'row', alignItems: 'center', gap: 19 },
  openDisc: { width: 43, height: 43, borderRadius: 23, backgroundColor: colors.paper, justifyContent: 'center', alignItems: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 7, marginTop: 22, marginBottom: 8 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  mediaRow: { flexDirection: 'row', alignItems: 'center' },
  mediaBody: { flex: 1, minHeight: 69, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 3, paddingVertical: 10, borderRadius: 12, overflow: 'hidden' },
  mediaTile: { width: 38, height: 45, borderRadius: 12, backgroundColor: '#291E25',
    borderColor: '#FFBC9522', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', alignItems: 'center' },
  completedTile: { borderColor: '#A6DBBF28', backgroundColor: '#182823' },
  mediaCopy: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  playDisc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFDCBF10' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 50, backgroundColor: colors.line },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13 },
  resumeProgress: { marginTop: 2, gap: 5 },
  track: { height: 3, backgroundColor: '#FFECDB3A', borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.paper, borderRadius: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.warmMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  menu: { marginBottom: 12, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  destination: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  form: { marginTop: 18, gap: 10 },
  fieldHeader: { minHeight: 45, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 53, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16, color: colors.ink,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF29', fontSize: 16 },
  nativePaste: { width: 97, height: 44 },
  error: { color: '#FFB7A5', fontSize: 13 },
  sheetLists: { paddingBottom: 6 },
  pressed: { opacity: 0.79 },
});
