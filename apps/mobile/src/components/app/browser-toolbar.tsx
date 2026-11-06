import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, Text, Platform, Keyboard } from 'react-native';
import { ChevronLeft, House, RotateCw, Search, ArrowRight } from 'lucide-react-native';

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
  onToggleFollowing?: () => void;
  onFocusChange?: (focused: boolean) => void;
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
  isHost = true, isFollowingHost = true, onToggleFollowing, onFocusChange,
}: BrowserToolbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const editingRef = useRef(false);
  const canNavigate = isHost || !isFollowingHost;

  const finishEditing = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setIsEditing(false);
    onFocusChange?.(false);
  };
  useEffect(() => {
    if (!isEditing) return;
    // Android can hide the IME without blurring the input. Do not reset the
    // draft here: keyboard dismissal can also happen during URL submission.
    const listener = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      finishEditing();
      inputRef.current?.blur();
    });
    return () => listener.remove();
  }, [isEditing, onFocusChange]);
  useEffect(() => {
    if (isEditing && (!canNavigate || !currentUrl)) {
      finishEditing();
      Keyboard.dismiss();
    }
  }, [isEditing, canNavigate, currentUrl]);

  if (!currentUrl) return null;
  const beginEditing = () => {
    if (!canNavigate) return;
    setUrlInputValue(currentUrl);
    editingRef.current = true;
    setIsEditing(true);
    onFocusChange?.(true);
  };
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

  return (
    <View style={styles.browserToolbar} testID="浏览器导航栏">
      {!isEditing && <>
        <TouchableOpacity testID="后退按钮" accessibilityLabel="后退" accessibilityRole="button"
          accessibilityState={{ disabled: !canNavigate }} disabled={!canNavigate}
          style={[styles.iconButton, !canNavigate && styles.disabled]} onPress={onGoBack} activeOpacity={0.5}>
          <ChevronLeft color="#b0b4bf" size={22} />
        </TouchableOpacity>
        <TouchableOpacity testID="返回主页按钮" accessibilityLabel="返回首页" accessibilityRole="button"
          style={styles.iconButton} onPress={onHome} activeOpacity={0.5}>
          <House color="#b0b4bf" size={21} />
        </TouchableOpacity>
      </>}
      <View style={styles.address}>
        <View pointerEvents="none" style={[styles.addressFill, isEditing && styles.addressFillEditing]} />
        <Search size={15} color={isEditing ? '#fb923c' : '#787e8c'} style={styles.searchIcon} />
        {isEditing ? <TextInput ref={inputRef} autoFocus testID="浏览器网址输入框" accessibilityLabel="浏览器网址输入框"
          style={styles.input} value={urlInputValue} onChangeText={setUrlInputValue}
          onBlur={finishEditing} onSubmitEditing={submit} returnKeyType="go" submitBehavior="submit"
          autoCapitalize="none" autoCorrect={false} selectTextOnFocus
          placeholder="输入网址或搜索关键词" placeholderTextColor="#787e8c" /> :
          <TouchableOpacity testID="浏览器网址输入框" accessibilityRole="button"
            accessibilityLabel="浏览器网址输入框" accessibilityHint={canNavigate ? `当前网址 ${browserAddressLabel(currentUrl)}，点击编辑` : `当前网址 ${browserAddressLabel(currentUrl)}，跟随房主浏览中`}
            accessibilityState={{ disabled: !canNavigate }} disabled={!canNavigate}
            onPress={beginEditing} style={styles.addressDisplay} activeOpacity={0.6}>
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
        style={styles.cancelButton} onPress={cancel} activeOpacity={0.6}><Text style={styles.cancelText}>取消</Text></TouchableOpacity> :
        !isHost && <TouchableOpacity testID={isFollowingHost ? '跟随房主徽章按钮' : '自由浏览徽章按钮'}
          accessibilityRole="button" accessibilityLabel={isFollowingHost ? '跟随房主页面，点击自由浏览选择片源，视频仍跟播' : '自由浏览中，视频仍跟播，点击回房主恢复页面跟随'}
          style={styles.followButton} onPress={onToggleFollowing} activeOpacity={0.6}>
          {isFollowingHost && <View style={styles.followerDot} />}
          <Text style={[styles.followText, !isFollowingHost && styles.freeText]} numberOfLines={1}>{isFollowingHost ? '跟播' : '回房主'}</Text>
        </TouchableOpacity>}
    </View>
  );
}

const styles = StyleSheet.create({
  browserToolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#0c0d12' },
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
  followButton: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  followerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#34d399', marginRight: 4 },
  followText: { color: '#9296a2', fontSize: 11 },
  freeText: { color: '#fb923c' },
});
