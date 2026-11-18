import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Download, ImagePlus, Share2 } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { PROD_WEB_URL } from '../../services/environment';
import { appControlColors as colors } from '../../theme/colors';
import { avatarLetter } from '../../utils/profile-avatar';
import {
  MEMORY_IMAGE_MAX_HEIGHT, MEMORY_IMAGE_WIDTH, MEMORY_PREVIEW_TILE_HEIGHT, viewingMemoryArtworkDocument,
  type ViewingMemoryArtwork, type ViewingMemoryFormat, type ViewingMemorySource,
} from '../../webview/viewing-memory-artwork';
import { AppActionSheet, AppButton } from './app-ui';

const formats = [
  { id: 'chat', label: '聊天长图' },
  { id: 'card', label: '观影卡片' },
  { id: 'poster', label: '观影海报' },
] as const;
const PNG_PREFIX = 'data:image/png;base64,iVBORw0KGgo';
const renderError = '图片生成失败，请重试';
type CanvasImage = { png: string; height: number };
type CanvasResult = (CanvasImage & { previewTiles?: CanvasImage[] }) | { error: string };
type EditorAction = 'pick' | 'save' | 'share';

function hasPng(image: CanvasImage) {
  return typeof image?.png === 'string' && image.png.startsWith(PNG_PREFIX);
}

function hasValidPreviewTiles(height: number, tiles?: CanvasImage[]) {
  if (height <= MEMORY_PREVIEW_TILE_HEIGHT) return tiles === undefined;
  return Array.isArray(tiles) && tiles.length === Math.ceil(height / MEMORY_PREVIEW_TILE_HEIGHT)
    && tiles.every((tile, index) => hasPng(tile)
      && tile.height === Math.min(MEMORY_PREVIEW_TILE_HEIGHT, height - index * MEMORY_PREVIEW_TILE_HEIGHT));
}

function MemoryCanvas({ artwork, onResult }: { artwork: ViewingMemoryArtwork; onResult: (result: CanvasResult) => void }) {
  const html = useMemo(() => ({
    html: viewingMemoryArtworkDocument(artwork, `${PROD_WEB_URL}/#download`),
  }), [artwork]);
  const callback = useRef(onResult);
  callback.current = onResult;
  const finished = useRef(false);
  const finish = (result: CanvasResult) => {
    if (finished.current) return;
    finished.current = true;
    callback.current(result);
  };
  const fail = () => finish({ error: renderError });
  useEffect(() => {
    const timer = setTimeout(fail, 10000);
    return () => clearTimeout(timer);
  }, []);
  return <WebView source={html} style={styles.canvas} containerStyle={styles.canvas}
    accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    originWhitelist={['*']} onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false} cacheEnabled={false} domStorageEnabled={false}
    onError={fail} onContentProcessDidTerminate={fail} onRenderProcessGone={fail}
    onMessage={({ nativeEvent }) => {
      try {
        const result = JSON.parse(nativeEvent.data) as CanvasResult;
        if ('error' in result && typeof result.error === 'string') finish({ error: result.error });
        else if ('png' in result && hasPng(result) && Number.isInteger(result.height)
          && result.height > 0 && result.height <= MEMORY_IMAGE_MAX_HEIGHT
          && hasValidPreviewTiles(result.height, result.previewTiles)) finish(result);
        else fail();
      } catch { fail(); }
    }} />;
}

export function ViewingMemoryEditor({ source, onClose }: { source: ViewingMemorySource; onClose: () => void }) {
  const [format, setFormat] = useState<ViewingMemoryFormat>(source.kind === 'history' ? 'poster' : 'chat');
  const [title, setTitle] = useState(source.title ?? '');
  const [companions, setCompanions] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [includeQuote, setIncludeQuote] = useState(false);
  const [avatars, setAvatars] = useState<{ urls: string[]; images: ReadonlyMap<string, string> }>();
  const [action, setAction] = useState<EditorAction | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const operation = useRef<EditorAction | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const chatSource = source.kind === 'chat' ? source : null;
  const hasPhotoOption = format !== 'chat';
  const showMessageOptions = !!chatSource && (format !== 'poster' || includeQuote);
  const date = dateLabel(source.date);
  const avatarUrls = useMemo(() => {
    const messages = chatSource?.messages ?? [];
    const urls = new Set<string>();
    messages.forEach(message => { if (message.mine && message.avatarUrl) urls.add(message.avatarUrl); });
    messages.forEach(message => { if (message.avatarUrl) urls.add(message.avatarUrl); });
    return [...urls];
  }, [chatSource]);
  const avatarImages = avatars?.urls === avatarUrls ? avatars.images : undefined;
  const waitingForAvatars = showMessageOptions && !anonymous && avatarUrls.length > 0 && !avatarImages;
  useEffect(() => {
    if (!waitingForAvatars) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    void import('../../services/viewing-memory-image').then(({ loadViewingMemoryAvatars }) =>
      loadViewingMemoryAvatars(avatarUrls, controller.signal)).catch(() => new Map<string, string>()).then(images => {
      if (active) setAvatars({ urls: avatarUrls, images });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [avatarUrls, waitingForAvatars]);

  const draft = useMemo<ViewingMemoryArtwork>(() => {
    const messages = showMessageOptions ? chatSource?.messages ?? [] : [];
    const senders = [...new Map(messages.map(message => [message.senderId, message])).values()];
    const senderIndex = new Map(senders.map((sender, index) => [sender.senderId, index]));
    return {
      format, title: hasPhotoOption ? title.trim() : '', date,
      companions: format === 'poster' ? companions.trim() : '',
      cover: hasPhotoOption ? photo : null,
      participants: senders.map((sender, index) => ({
        name: anonymous ? `成员 ${index + 1}` : sender.sender,
        letter: anonymous ? String(index + 1) : avatarLetter(sender.sender),
        mine: sender.mine,
        avatar: !anonymous && sender.avatarUrl ? avatarImages?.get(sender.avatarUrl) : undefined,
      })),
      messages: messages.map(message => ({
        participant: senderIndex.get(message.senderId)!,
        text: message.text,
      })),
    };
  }, [anonymous, avatarImages, chatSource, companions, date, format, hasPhotoOption, photo, showMessageOptions, title]);
  const [job, setJob] = useState(() => ({ id: 0, draft }));
  const [rendered, setRendered] = useState<{ id: number; result: CanvasResult }>();
  const latestJob = useRef(job);
  latestJob.current = job;
  useEffect(() => {
    if (job.draft === draft) return;
    const timer = setTimeout(() => setJob(current => ({ id: current.id + 1, draft })), 180);
    return () => clearTimeout(timer);
  }, [draft, job.draft]);
  const currentDraftReady = !waitingForAvatars && job.draft === draft;
  const activeResult = currentDraftReady && rendered?.id === job.id ? rendered.result : null;
  const image = activeResult && 'png' in activeResult ? activeResult : null;
  const busy = action !== null;
  const label = formats.find(item => item.id === format)?.label ?? '观影留念';

  async function run(next: EditorAction) {
    if (operation.current || (next !== 'pick' && !image)) return;
    operation.current = next;
    setAction(next);
    setFeedback(null);
    try {
      if (next === 'pick') {
        const { pickViewingMemoryImage } = await import('../../services/viewing-memory-image');
        const result = await pickViewingMemoryImage();
        if (result && mounted.current) setPhoto(result);
      } else if (image) {
        const { shareArtworkImage, saveArtworkImage } = await import('../../services/invite-image');
        const base64 = image.png.slice('data:image/png;base64,'.length);
        const validate = () => {
          if (!mounted.current) throw new Error('预览已关闭');
        };
        validate();
        if (next === 'share') await shareArtworkImage(base64, label, validate, 'viewing-memory-artwork');
        else {
          await saveArtworkImage(base64, validate, 'viewing-memory-artwork');
          if (mounted.current) setFeedback({ message: '已保存到相册' });
        }
      }
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : '';
        const fallback = { pick: '选图失败，请重新选择', save: '保存失败，请检查相册权限后重试', share: '无法打开分享，可以先保存到相册' };
        setFeedback({ message: /^(请更新安装包|请允许|无法读取这张照片)/.test(message) ? message : fallback[next], error: true });
      }
    } finally {
      operation.current = null;
      if (mounted.current) setAction(null);
    }
  }

  return <AppActionSheet visible heading={source.kind === 'history' ? '观影海报' : '图片预览'} closeTestID="memory-preview-close"
    onClose={() => { if (!operation.current) onClose(); }}>
    {chatSource && <View style={styles.formats} accessibilityLabel="图片版式">
      {formats.map(option => <Pressable key={option.id} testID={`memory-format-${option.id}`}
        accessibilityRole="button" accessibilityState={{ selected: option.id === format, disabled: busy }}
        disabled={busy} onPress={() => { setFormat(option.id); setFeedback(null); }}
        style={({ pressed }) => [styles.format, option.id === format && styles.formatSelected, pressed && styles.pressed]}>
        <Text style={[styles.formatText, option.id === format && styles.selectedText]}>{option.label}</Text>
      </Pressable>)}
    </View>}
    <ScrollView style={styles.scroll} contentContainerStyle={styles.controls} keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      {hasPhotoOption && <>
        <TextInput accessibilityLabel="片名" testID="memory-title" value={title} placeholder="片名"
          placeholderTextColor={colors.muted} onChangeText={setTitle} editable={!busy} maxLength={90}
          returnKeyType="done" style={styles.input} />
        {format === 'poster' && <TextInput accessibilityLabel="一起看的人（选填）" value={companions}
          placeholder="一起看的人（选填）" placeholderTextColor={colors.muted} onChangeText={setCompanions}
          editable={!busy} maxLength={48} returnKeyType="done" style={styles.input} />}
        <View style={styles.row}>
          <AppButton icon={ImagePlus} label={photo ? '更换配图' : '从相册选图'} tone="secondary" testID="memory-pick-photo"
            disabled={busy && action !== 'pick'} busy={action === 'pick'} onPress={() => void run('pick')} />
          {photo && <AppButton label="移除配图" tone="quiet" disabled={busy} onPress={() => { setPhoto(null); setFeedback(null); }} />}
        </View>
      </>}
      {!!chatSource && format === 'poster' && <MemorySwitch label="带上选中的消息"
        value={includeQuote} disabled={busy} onChange={setIncludeQuote} />}
      {showMessageOptions && <MemorySwitch label="隐藏昵称和头像" value={anonymous} disabled={busy} onChange={setAnonymous} />}
      <View style={styles.stage} onLayout={event => setWidth(Math.max(0, event.nativeEvent.layout.width - 16))}>
        {image && width > 0 ? <View testID="memory-preview-image" accessible accessibilityRole="image"
          accessibilityLabel={label} style={styles.image}>
          {(image.previewTiles ?? [image]).map((tile, index) => <Image key={index}
            source={{ uri: tile.png }} resizeMode="stretch" resizeMethod={Platform.OS === 'android' ? 'none' : undefined} fadeDuration={0}
            style={{ width, height: width * tile.height / MEMORY_IMAGE_WIDTH }} />)}
        </View> :
          activeResult && 'error' in activeResult ? <View style={styles.placeholder}>
            <Text accessibilityRole="alert" style={styles.status}>{activeResult.error}</Text>
            <AppButton tone="quiet" label="重新生成" onPress={() => setJob(current => ({ id: current.id + 1, draft }))} />
          </View> : <ActivityIndicator accessibilityLabel="正在生成图片" color={colors.accent} style={styles.placeholder} />}
      </View>
    </ScrollView>
    {currentDraftReady && (!rendered || rendered.id !== job.id) && <View pointerEvents="none" style={styles.canvas}>
      <MemoryCanvas key={job.id} artwork={job.draft} onResult={result => {
        if (latestJob.current === job && mounted.current) setRendered({ id: job.id, result });
      }} />
    </View>}
    <View style={styles.footer}>
      {feedback && <Text accessibilityRole={feedback.error ? 'alert' : undefined} accessibilityLiveRegion="polite"
        style={[styles.status, !feedback.error && styles.success]}>{feedback.message}</Text>}
      <View style={styles.row}>
        <View style={styles.action}><AppButton label="保存到相册" icon={Download} tone="primary" testID="memory-save"
          disabled={!image || (busy && action !== 'save')} busy={action === 'save'} onPress={() => void run('save')} /></View>
        <View style={styles.action}><AppButton label="分享图片" icon={Share2} testID="memory-share"
          disabled={!image || (busy && action !== 'share')} busy={action === 'share'} onPress={() => void run('share')} /></View>
      </View>
    </View>
  </AppActionSheet>;
}

function dateLabel(timestamp?: number) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('.');
}

function MemorySwitch({ label, value, disabled, onChange }: { label: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <View style={[styles.row, styles.switchRow]}>
    <Text style={styles.switchLabel}>{label}</Text>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled}
      trackColor={{ false: colors.watchControls.edge, true: colors.accentButton.fill }} />
  </View>;
}

const styles = StyleSheet.create({
  formats: { flexDirection: 'row', borderRadius: 12, backgroundColor: colors.surface, padding: 4, gap: 4, marginBottom: 8 },
  format: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 3 },
  formatSelected: { backgroundColor: colors.watchControls.accentSurface },
  formatText: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  selectedText: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  controls: { gap: 8, paddingBottom: 6 },
  input: { color: colors.ink, fontSize: 16, minHeight: 44, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.watchControls.edge, backgroundColor: colors.surface, borderRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  switchRow: { justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { color: colors.ink, fontSize: 14, flexShrink: 1 },
  stage: { borderRadius: 12, backgroundColor: colors.surface, padding: 8, alignItems: 'center' },
  image: { borderRadius: 6, overflow: 'hidden' },
  placeholder: { minHeight: 132, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  status: { color: colors.warmMuted, textAlign: 'center', fontSize: 13 },
  success: { color: colors.done },
  canvas: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingTop: 10, gap: 7 },
  action: { flexGrow: 1, flexBasis: '45%' },
});
