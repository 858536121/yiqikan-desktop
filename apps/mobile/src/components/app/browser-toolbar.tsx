import React from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, Text } from 'react-native';
import { ChevronLeft, ChevronRight, RotateCw, Home, Search, ArrowRight, ShieldAlert } from 'lucide-react-native';

interface BrowserToolbarProps {
  currentUrl: string;
  urlInputValue: string;
  setUrlInputValue: (val: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onSubmit: () => void;
  isHost?: boolean;
}

export function BrowserToolbar({
  currentUrl,
  urlInputValue,
  setUrlInputValue,
  onGoBack,
  onGoForward,
  onReload,
  onHome,
  onSubmit,
  isHost = true,
}: BrowserToolbarProps) {
  if (!currentUrl) return null;

  return (
    <View style={styles.browserToolbar}>
      {/* 快捷主页与导航按键组 */}
      <View style={styles.navButtonGroup}>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onHome} activeOpacity={0.7}>
          <Home color="#ddd" size={18} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.toolbarBtn, !isHost && styles.disabledBtn]} 
          onPress={onGoBack} 
          disabled={!isHost}
          activeOpacity={0.7}
        >
          <ChevronLeft color={isHost ? "#ddd" : "#555"} size={20} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.toolbarBtn, !isHost && styles.disabledBtn]} 
          onPress={onGoForward} 
          disabled={!isHost}
          activeOpacity={0.7}
        >
          <ChevronRight color={isHost ? "#ddd" : "#555"} size={20} />
        </TouchableOpacity>
      </View>

      {/* 胶囊地址与搜索输入框 */}
      <View style={[styles.urlCapsule, !isHost && styles.urlCapsuleReadOnly]}>
        <Search size={14} color={isHost ? "#F97316" : "#666"} style={{ marginLeft: 10, marginRight: 6 }} />
        <TextInput 
          style={styles.urlInput} 
          value={urlInputValue} 
          onChangeText={setUrlInputValue}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={isHost ? "输入网址或搜索关键词..." : "跟随房主浏览中..."}
          placeholderTextColor="#666"
          selectTextOnFocus
          editable={isHost}
        />
        {isHost ? (
          <TouchableOpacity style={styles.goBtn} onPress={onSubmit} activeOpacity={0.7}>
            <ArrowRight size={14} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={styles.followerBadge}>
            <Text style={styles.followerBadgeText}>跟播</Text>
          </View>
        )}
      </View>

      {/* 刷新按钮 */}
      <TouchableOpacity style={styles.reloadBtn} onPress={onReload} activeOpacity={0.7}>
        <RotateCw color="#aaa" size={17} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  browserToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#141418',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  navButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginRight: 6,
  },
  toolbarBtn: {
    padding: 4,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  urlCapsule: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    height: 32,
  },
  urlCapsuleReadOnly: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  urlInput: {
    flex: 1,
    color: '#fff',
    paddingVertical: 0,
    paddingHorizontal: 3,
    fontSize: 12,
    height: '100%',
  },
  goBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 5,
  },
  followerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 6,
  },
  followerBadgeText: {
    color: '#888',
    fontSize: 10,
    fontWeight: '500',
  },
  reloadBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
