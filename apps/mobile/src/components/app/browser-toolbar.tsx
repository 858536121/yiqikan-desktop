import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, TouchableOpacity, TextInput, Text, Platform, Keyboard } from 'react-native';
import { ChevronDown, ChevronLeft, ChevronUp, House, RotateCw, Search, ArrowRight, Compass, CornerUpLeft } from 'lucide-react-native';
import { APP_ACCENT, APP_BACKGROUND } from '../../theme/colors';

interface BrowserToolbarProps {
  currentUrl: string;
  urlInputValue: string;
  setUrlInputValue: (val: string) => void;
  onGoBack: () => void;
  onGoForward?: () => void;
  onReload: () => void;
  onHome: () => void;
  onSubmit: () => void;
  isHost?: boolean;
  isFollowingHost?: boolean;
  browseHint?: 'address' | 'link' | null;
  onAddressBlocked?: () => void;
  onRetryVideo?: () => void;
  onToggleFollowing?: () => void;
  onFocusChange?: (focused: boolean) => void;
  renderPlayback?: (sourceAction: React.ReactNode) => React.ReactNode;
}

export function browserAddressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.host.replace(/^www\./i, '');
    if (parsed.protocol === 'file:' || parsed.protocol === 'local:' || parsed.protocol === 'yiqikan:') return '本地视频';
  } catch {}
  return '网址与搜索';
}

export function BrowserToolbar({
  currentUrl, urlInputValue, setUrlInputValue, onGoBack, onReload, onHome, onSubmit,
  isHost = true, isFollowingHost = true, browseHint, onAddressBlocked, onRetryVideo, onToggleFollowing, onFocusChange, renderPlayback,
}: BrowserToolbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [sourceChoicesOpen, setSourceChoicesOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const editingRef = useRef(false);
  const canNavigate = isHost || !isFollowingHost;
  const retryVideo = !isHost && isFollowingHost && onRetryVideo;
  const sourceHighlighted = isFollowingHost && Boolean(browseHint || retryVideo);
  const showFollowStatus = isFollowingHost && !sourceHighlighted;
  const showRecovery = !isEditing && Boolean(retryVideo);
  const [recoveryPulse] = useState(() => new Animated.Value(0));

  useEffect(() => { setSourceChoicesOpen(false); }, [currentUrl, isHost, showFollowStatus]);

  useEffect(() => {
    if (!showRecovery) return;
    let active = true;
    const pulse = Animated.sequence([
      Animated.timing(recoveryPulse, { toValue: 0.85, duration: 180, useNativeDriver: true, isInteraction: false }),
      Animated.timing(recoveryPulse, { toValue: 0, duration: 620, useNativeDriver: true, isInteraction: false }),
    ]);
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (active && !reduced) pulse.start();
    }).catch(() => {});
    return () => {
      active = false;
      pulse.stop();
      recoveryPulse.setValue(0);
    };
  }, [showRecovery, recoveryPulse]);

  const finishEditing = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setIsEditing(false);
    onFocusChange?.(false);
  };
  useEffect(() => {
    if (!isEditing) return;
    const ios = Platform.OS === 'ios';
    let keyboardShown = false;
    const showListener = ios ? Keyboard.addListener('keyboardWillShow', () => { keyboardShown = true; }) : undefined;
    // Android can hide the IME without blurring the input. Do not reset the
    // draft here: keyboard dismissal can also happen during URL submission.
    const hideListener = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      // iOS can deliver a hide event from the previous responder before this field gains focus.
      if (ios && !keyboardShown) return;
      finishEditing();
      inputRef.current?.blur();
    });
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      showListener?.remove();
      hideListener.remove();
    };
  }, [isEditing, onFocusChange]);
  useEffect(() => {
    if (isEditing && (!canNavigate || !currentUrl)) {
      finishEditing();
      Keyboard.dismiss();
    }
  }, [isEditing, canNavigate, currentUrl]);

  const beginEditing = () => {
    setUrlInputValue(currentUrl);
    editingRef.current = true;
    setIsEditing(true);
    onFocusChange?.(true);
  };
  if (!currentUrl && (isHost || isFollowingHost)) return null;
  const submit = () => {
    onSubmit();
    finishEditing();
    Keyboard.dismiss();
  };
  const cancel = () => {
    setUrlInputValue(currentUrl);
    finishEditing();
    Keyboard.dismiss();
  };
  const switchSource = () => {
    if (!onToggleFollowing) return;
    setSourceChoicesOpen(false);
    onToggleFollowing();
    if (isFollowingHost && browseHint === 'address') beginEditing();
  };
  const sourceLabel = showFollowStatus ? '跟随房主中' : isFollowingHost ? '自己找视频' : '回到房主页面';
  const sourceIconColor = sourceHighlighted ? APP_ACCENT : '#a6aab7';
  const SourceChevron = sourceChoicesOpen ? ChevronUp : ChevronDown;
  const sourceAction = !isHost && <TouchableOpacity testID={isFollowingHost ? '跟随房主徽章按钮' : '自由浏览徽章按钮'}
    accessibilityRole="button" accessibilityLabel={sourceLabel}
    accessibilityState={showFollowStatus ? { expanded: sourceChoicesOpen } : undefined}
    accessibilityHint={showFollowStatus ? '查看网页跟随选项' : isFollowingHost ? '可以换个网页找同一部或同一集，播放进度仍跟随房主' : '打开房主当前的网页并恢复页面跟随'}
    style={styles.sourceButton} activeOpacity={0.65} onPress={() => {
      if (showFollowStatus) setSourceChoicesOpen(open => !open);
      else switchSource();
    }}>
    <View style={[styles.sourceButtonSurface, sourceHighlighted && styles.sourceButtonEmphasis]}>
      {showRecovery && <Animated.View pointerEvents="none" style={[styles.sourcePulse, { opacity: recoveryPulse }]} />}
      {showFollowStatus ? <View style={styles.sourceDot} /> :
        isFollowingHost ? <Compass size={14} color={sourceIconColor} /> : <CornerUpLeft size={14} color={sourceIconColor} />}
      <Text style={[styles.sourceButtonText, sourceHighlighted && styles.sourceTextEmphasis]}>{sourceLabel}</Text>
      {showFollowStatus && <SourceChevron size={12} color={sourceIconColor} />}
    </View>
  </TouchableOpacity>;

  return (
    <View testID="浏览器导航栏">
      {!isEditing && <>
        {!isHost && showFollowStatus && sourceChoicesOpen && <View style={[styles.sourceRow, styles.sourceChoices]} testID="网页跟随选项">
          <View style={styles.sourceCopy}>
            <Text style={styles.sourceText}>可换个网页找同一部或同一集</Text>
            <Text style={styles.sourceDetail}>只影响你这边，播放进度仍跟房主</Text>
          </View>
          <TouchableOpacity style={styles.sourceButton} accessibilityRole="button" accessibilityLabel="自己找视频"
            onPress={switchSource} activeOpacity={0.65} testID="选择自己找视频">
            <View style={[styles.sourceButtonSurface, styles.sourceButtonEmphasis]}>
              <Text style={[styles.sourceButtonText, styles.sourceTextEmphasis]}>自己找视频</Text>
            </View>
          </TouchableOpacity>
        </View>}
        {!isHost && (!renderPlayback || retryVideo || browseHint) && <View style={styles.sourceRow}>
          <View style={styles.sourceCopy} accessibilityLiveRegion="polite">
            {retryVideo ? <Text style={styles.sourceText} testID="浏览器视频恢复提示">暂未找到房主的视频</Text> :
              !renderPlayback && !isFollowingHost && <View style={styles.sourceStatus}>
                <View style={[styles.sourceDot, styles.sourceDotOwn]} />
                <Text style={styles.sourceText}>自己选网页</Text>
              </View>}
            {(browseHint || (!isFollowingHost && !renderPlayback)) && <Text style={styles.sourceDetail}>
              {isFollowingHost ? '可自己打开网页，进度仍跟房主' : '播放进度跟随房主'}
            </Text>}
          </View>
          {retryVideo && <TouchableOpacity style={styles.retryButton} onPress={retryVideo} testID="player-retry-media"
            accessibilityRole="button" accessibilityLabel="重试切换视频" activeOpacity={0.65}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>}
          {!renderPlayback && sourceAction}
        </View>}
        {renderPlayback?.(sourceAction)}
      </>}
      {!!currentUrl && <View style={styles.browserToolbar}>
        {!isEditing && <>
          <TouchableOpacity testID="后退按钮" accessibilityLabel="后退" accessibilityRole="button"
            accessibilityState={{ disabled: !canNavigate }} disabled={!canNavigate}
            style={[styles.iconButton, !canNavigate && styles.disabled]} onPress={onGoBack} activeOpacity={0.5}>
            <ChevronLeft color="#b0b4bf" size={22} />
          </TouchableOpacity>
          <TouchableOpacity testID="返回主页按钮" accessibilityLabel="返回首页" accessibilityRole="button"
            accessibilityState={{ disabled: !canNavigate }} disabled={!canNavigate}
            style={[styles.iconButton, !canNavigate && styles.disabled]} onPress={onHome} activeOpacity={0.5}>
            <House color="#b0b4bf" size={21} />
          </TouchableOpacity>
        </>}
        <View style={styles.address}>
          <View pointerEvents="none" style={[styles.addressFill, isEditing && styles.addressFillEditing]} />
          <Search size={15} color={isEditing ? '#fb923c' : '#787e8c'} style={styles.searchIcon} />
          {isEditing ? <TextInput ref={inputRef} testID="浏览器网址输入框" accessibilityLabel="浏览器网址输入框"
            style={styles.input} value={urlInputValue} onChangeText={setUrlInputValue}
            onBlur={finishEditing} onSubmitEditing={submit} returnKeyType="go" submitBehavior="submit"
            autoCapitalize="none" autoCorrect={false} selectTextOnFocus
            placeholder="输入网址或搜索关键词" placeholderTextColor="#787e8c" /> :
            <TouchableOpacity testID="浏览器网址输入框" accessibilityRole="button"
              accessibilityLabel="浏览器网址输入框" accessibilityHint={canNavigate ? `当前网址 ${browserAddressLabel(currentUrl)}，点击编辑` : `当前网址 ${browserAddressLabel(currentUrl)}，点击了解如何打开其他网页`}
              onPress={canNavigate ? beginEditing : onAddressBlocked} style={styles.addressDisplay} activeOpacity={0.6}>
              <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">{browserAddressLabel(currentUrl)}</Text>
            </TouchableOpacity>}
          {isEditing ? <TouchableOpacity testID="前往网址按钮" accessibilityLabel="前往网址" accessibilityRole="button"
            style={styles.iconButton} onPress={submit} activeOpacity={0.6}>
            <View style={styles.goSurface}><ArrowRight size={18} color="#fff" /></View>
          </TouchableOpacity> : <TouchableOpacity testID="刷新页面按钮" accessibilityLabel="刷新页面" accessibilityRole="button"
            style={styles.iconButton} onPress={onReload} activeOpacity={0.5}>
            <RotateCw size={18} color="#9296a2" />
          </TouchableOpacity>}
        </View>
        {isEditing ? <TouchableOpacity testID="取消网址编辑按钮" accessibilityLabel="取消网址编辑" accessibilityRole="button"
          style={styles.cancelButton} onPress={cancel} activeOpacity={0.6}><Text style={styles.cancelText}>取消</Text></TouchableOpacity> : null}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  browserToolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2, backgroundColor: APP_BACKGROUND },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  address: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center' },
  addressFill: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 5, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  addressFillEditing: { backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(251,146,60,0.3)' },
  searchIcon: { marginLeft: 10, marginRight: 7 },
  addressDisplay: { flex: 1, minWidth: 0, height: 44, justifyContent: 'center' },
  addressText: { color: '#aeb3be', fontSize: 13 },
  input: { flex: 1, minWidth: 0, height: 44, paddingHorizontal: 0, paddingVertical: 0, color: '#eef0f4', fontSize: 14 },
  goSurface: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f97316', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { minWidth: 48, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  cancelText: { color: '#c9cdd7', fontSize: 14 },
  sourceRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  sourceChoices: { backgroundColor: '#ffffff08', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ffffff1a' },
  sourceCopy: { flex: 1, paddingVertical: 4 },
  sourceStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: '#34d399' },
  sourceDotOwn: { backgroundColor: APP_ACCENT },
  sourceText: { flexShrink: 1, color: '#d5d8e1', fontSize: 13 },
  sourceDetail: { color: '#a6aab7', fontSize: 11 },
  sourceButton: { maxWidth: '45%', minHeight: 44, paddingVertical: 4, justifyContent: 'center' },
  sourceButtonSurface: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 29, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 15,
    borderWidth: 1, borderColor: '#ffffff26' },
  sourceButtonEmphasis: { borderColor: APP_ACCENT, backgroundColor: APP_ACCENT + '1A' },
  sourcePulse: { position: 'absolute', top: -4, right: -4, bottom: -4, left: -4, borderRadius: 19, borderWidth: 2, borderColor: APP_ACCENT },
  sourceButtonText: { flexShrink: 1, color: '#c9cdd7', fontSize: 13, fontWeight: '600' },
  sourceTextEmphasis: { color: APP_ACCENT },
  retryButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: APP_ACCENT, fontSize: 13, fontWeight: '600' },
});
