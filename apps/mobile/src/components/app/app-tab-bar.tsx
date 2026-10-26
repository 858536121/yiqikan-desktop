import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Clapperboard, UserRound, Users } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { AppTab } from './module-shell';

const tabs = [{ id: 'watch', title: '观看', icon: Clapperboard }, { id: 'room', title: '房间', icon: Users }, { id: 'profile', title: '我的', icon: UserRound }] as const;

export function AppTabBar({ activeTab, onChange, unreadCount }: { activeTab: AppTab; onChange: (tab: AppTab) => void; unreadCount: number }) {
  const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
  const position = useRef(new Animated.Value(activeIndex)).current;
  const [width, setWidth] = useState(0);
  const slotWidth = width / tabs.length;
  const glassWidth = Math.min(82, Math.max(0, slotWidth - 20));
  useEffect(() => {
    const animation = Animated.spring(position, { toValue: activeIndex, damping: 23, stiffness: 240, mass: 0.8, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [activeIndex, position]);
  return (
    <SafeAreaView edges={['bottom']} style={styles.surface}>
    <View style={styles.bar} accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && <Animated.View pointerEvents="none" testID="tab-glass-indicator" style={[styles.glass, {
        width: glassWidth, left: (slotWidth - glassWidth) / 2,
        transform: [{ translateX: position.interpolate({ inputRange: [0, 1, 2], outputRange: [0, slotWidth, slotWidth * 2] }) }],
      }]}>
        <Svg width="100%" height="100%">
          <Defs><LinearGradient id="tabGlass" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor="#fff" stopOpacity={0.10} /><Stop offset="0.5" stopColor="#fff" stopOpacity={0.04} /><Stop offset="1" stopColor="#fff" stopOpacity={0.015} />
          </LinearGradient></Defs>
          <Rect x="0.5" y="0.5" width={Math.max(0, glassWidth - 1)} height="49" rx="18" fill="url(#tabGlass)" stroke="rgba(255,255,255,0.09)" strokeWidth="0.7" />
        </Svg>
      </Animated.View>}
      {tabs.map(({ id, title, icon: Icon }) => {
        const selected = activeTab === id;
        const count = id === 'room' ? unreadCount : 0;
        return (
          <TouchableOpacity key={id} testID={`app-tab-${id}`} accessibilityRole="tab" accessibilityState={{ selected }}
            accessibilityLabel={`${title}${count ? `，${count}条未读消息` : ''}`} onPress={() => onChange(id)} style={styles.tab} activeOpacity={0.7}>
            <View style={styles.icon}>
              <Icon size={24} color={selected ? '#fb923c' : '#9296a2'} strokeWidth={selected ? 2.2 : 1.8} />
              {count > 0 && <View testID="房间未读角标" style={styles.badge}><Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text></View>}
            </View>
            <Text style={[styles.label, selected && styles.selected]}>{title}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: '#0c0d12' },
  bar: { flexDirection: 'row', height: 60 },
  glass: { position: 'absolute', top: 5, height: 50, borderRadius: 18, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  icon: { position: 'relative', width: 42, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  label: { fontSize: 12, color: '#9296a2', fontWeight: '500' },
  selected: { color: '#fb923c' },
  badge: { position: 'absolute', top: -3, left: 26, backgroundColor: '#e15c62', minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#fff' },
});
