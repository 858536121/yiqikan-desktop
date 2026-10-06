import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, Text, Image, Platform } from 'react-native';
import { ChevronLeft, RotateCw, Search, ArrowRight } from 'lucide-react-native';

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
}

export function BrowserToolbar({
  currentUrl,
  urlInputValue,
  setUrlInputValue,
  onGoBack,
  onReload,
  onHome,
  onSubmit,
  isHost = true,
}: BrowserToolbarProps) {
  const [isFocused, setIsFocused] = useState(false);

  if (!currentUrl) return null;

  // 判断是否处于“输入新网址/待提交”的编辑状态
  const isEditing = isFocused || (urlInputValue.trim() !== '' && urlInputValue.trim() !== currentUrl.trim());

  return (
    <View style={styles.browserToolbar}>
      {/* 1. 左侧品牌彩色 Logo + “首页” 组合按钮 */}
      <TouchableOpacity 
        testID="返回主页按钮" 
        accessibilityLabel="返回首页" 
        style={styles.brandHomeBtn} 
        onPress={onHome} 
        activeOpacity={0.72}
      >
        <Image 
          source={require('../../../assets/icon.png')} 
          style={styles.brandLogo} 
          resizeMode="contain" 
        />
        <Text style={styles.brandHomeText}>首页</Text>
      </TouchableOpacity>

      {/* 2. 高频后退按钮（移除冗余前进键，释放宽度） */}
      <TouchableOpacity 
        testID="后退按钮"
        accessibilityLabel="后退" 
        style={[styles.backBtn, !isHost && styles.disabledBtn]} 
        onPress={onGoBack} 
        disabled={!isHost}
        activeOpacity={0.7}
      >
        <ChevronLeft color={isHost ? "#ddd" : "#555"} size={18} />
      </TouchableOpacity>

      {/* 3. 超宽圆角地址与搜索输入胶囊 */}
      <View style={[
        styles.urlCapsule, 
        isFocused && styles.urlCapsuleFocused,
        !isHost && styles.urlCapsuleReadOnly
      ]}>
        <Search size={13} color={isHost ? (isFocused ? "#F97316" : "#aaa") : "#666"} style={{ marginLeft: 8, marginRight: 5 }} />
        <TextInput 
          testID="浏览器网址输入框"
          accessibilityLabel="浏览器网址输入框"
          style={styles.urlInput} 
          value={urlInputValue} 
          onChangeText={setUrlInputValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={isHost ? "输入网址或搜索关键词..." : "跟随房主浏览中..."}
          placeholderTextColor="#666"
          selectTextOnFocus
          editable={isHost}
        />

        {/* 4. 胶囊右侧动态自适应操作区（刷新与前往合二为一） */}
        {isHost ? (
          isEditing ? (
            // 编辑态：亮橙高光“前往”按钮
            <TouchableOpacity 
              testID="前往网址按钮"
              accessibilityLabel="前往网址" 
              style={styles.actionBtnGo} 
              onPress={onSubmit} 
              activeOpacity={0.75}
            >
              <ArrowRight size={12} color="#fff" />
            </TouchableOpacity>
          ) : (
            // 常态浏览：深嵌胶囊内的克制“刷新”按钮（零边缘误触风险）
            <TouchableOpacity 
              testID="刷新页面按钮"
              accessibilityLabel="刷新页面" 
              style={styles.actionBtnReload} 
              onPress={onReload} 
              activeOpacity={0.65}
            >
              <RotateCw color="#888" size={13} />
            </TouchableOpacity>
          )
        ) : (
          // 房员跟播态：小巧标签
          <View style={styles.followerBadge}>
            <Text style={styles.followerBadgeText}>跟播</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  browserToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#121318',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  brandHomeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.18)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(0, 0, 0, 0.25)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.08)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.08)' : undefined,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    marginRight: 6,
  },
  brandLogo: {
    width: 16,
    height: 16,
    borderRadius: 4,
    marginRight: 4,
  },
  brandHomeText: {
    color: '#ddd',
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  backBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  disabledBtn: {
    opacity: 0.35,
  },
  urlCapsule: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    height: 32,
    paddingRight: 4,
  },
  urlCapsuleFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  urlCapsuleReadOnly: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  urlInput: {
    flex: 1,
    color: '#fff',
    paddingVertical: 0,
    paddingHorizontal: 4,
    fontSize: 12,
    height: '100%',
  },
  actionBtnGo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 3,
  },
  actionBtnReload: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
  },
  followerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginRight: 4,
  },
  followerBadgeText: {
    color: '#888',
    fontSize: 10,
    fontWeight: '500',
  },
});
