import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { ArrowUpRight, PlusCircle } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

export function RoomActionButton({ primary = false, compact = false, expanded = false, title, subtitle, testID, accessibilityLabel = title, disabled = false, onPress, icon: Icon }: {
  primary?: boolean; compact?: boolean; expanded?: boolean; title: string; subtitle?: string; testID?: string; accessibilityLabel?: string; disabled?: boolean;
  onPress: () => void; icon: typeof PlusCircle;
}) {
  const gradientId = primary ? 'roomActionWarm' : 'roomActionDark';
  return <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    disabled={disabled} activeOpacity={0.8} onPress={onPress}
    style={[styles.roomActionButton, primary ? styles.primaryRoomAction : styles.secondaryRoomAction, compact && styles.compactRoomAction, expanded && styles.expandedRoomAction, disabled && { opacity: 0.5 }]}>
    <View style={[styles.roomActionSurface, compact && styles.compactRoomActionSurface, expanded && styles.expandedSurface]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none"><Svg width="100%" height="100%">
        <Defs><LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor={primary ? '#FF963D' : '#343230'} />
          <Stop offset="0.55" stopColor={primary ? '#FF7518' : '#242323'} />
          <Stop offset="1" stopColor={primary ? '#CB500B' : '#191919'} />
        </LinearGradient>
        {expanded && <LinearGradient id={`${gradientId}Surface`} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0" stopColor="#fff" stopOpacity={0.16} />
          <Stop offset="0.25" stopColor="#fff" stopOpacity={0} />
          <Stop offset="0.75" stopColor="#000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000" stopOpacity={0.08} />
        </LinearGradient>}</Defs>
        <Rect width="100%" height="100%" rx={compact ? 11 : 15} fill={`url(#${gradientId})`} />
        {expanded && <Rect width="100%" height="100%" rx={15} fill={`url(#${gradientId}Surface)`} />}
      </Svg></View>
      {expanded ? <>
        <Icon size={26} strokeWidth={2} color={primary ? '#fff' : '#fb923c'} />
        <View style={styles.expandedCopy}>
          <Text style={[styles.roomActionText, styles.expandedTitle]}>{title}</Text>
          {!!subtitle && <Text style={[styles.expandedSubtitle, primary && { color: '#fff1e6' }]}>{subtitle}</Text>}
        </View>
        <ArrowUpRight size={20} color={primary ? '#fff1e6' : '#aaa'} />
      </> : <>
      <View style={[styles.roomActionLabel, compact && styles.compactRoomActionLabel]}><Icon size={compact ? 14 : 17} strokeWidth={compact ? 2 : 2.5} color={primary ? '#fff' : '#fb923c'} /><Text style={[styles.roomActionText, compact && styles.compactRoomActionText]}>{title}</Text></View>
      {!!subtitle && <Text style={[styles.roomActionHint, styles.roomActionSubtitle, primary && { color: '#fff1e6' }]}>{subtitle}</Text>}
      </>}
    </View>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  roomActionButton: { flex: 1, borderRadius: 16, borderWidth: 1, shadowOffset: { width: 0, height: 5 }, shadowRadius: 12, elevation: 4 },
  primaryRoomAction: { backgroundColor: '#F97316', borderColor: '#E7772C', borderTopColor: '#FFD0A0', borderLeftColor: '#FFAC64', borderRightColor: '#E7772C', borderBottomColor: '#A9450E', shadowColor: '#F97316', shadowOpacity: 0.24 },
  secondaryRoomAction: { backgroundColor: '#252525', borderColor: '#ffffff20', borderTopColor: '#ffffff38', borderLeftColor: '#ffffff26', borderRightColor: '#ffffff20', borderBottomColor: '#ffffff12', shadowColor: '#000', shadowOpacity: 0.3 },
  compactRoomAction: { flex: 0, minHeight: 44, borderRadius: 12, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, elevation: 1 },
  compactRoomActionSurface: { minHeight: 42, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8 },
  compactRoomActionLabel: { gap: 4 },
  compactRoomActionText: { fontSize: 12 },
  expandedRoomAction: { flex: 0, width: '100%', borderBottomWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 10, elevation: 4 },
  expandedSurface: { minHeight: 124, paddingHorizontal: 20, paddingVertical: 24, flexDirection: 'row', justifyContent: 'flex-start', gap: 14 },
  expandedCopy: { flex: 1, minWidth: 0, gap: 7 },
  expandedTitle: { fontSize: 22, textAlign: 'left' },
  expandedSubtitle: { color: '#ccc', fontSize: 12, lineHeight: 19 },
  roomActionSurface: { minHeight: 68, borderRadius: 15, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  roomActionLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  roomActionText: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  roomActionHint: { color: '#ccc', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  roomActionSubtitle: { fontWeight: '500' },
});
