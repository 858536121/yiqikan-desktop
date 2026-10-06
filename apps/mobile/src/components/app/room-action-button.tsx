import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { PlusCircle } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

export function RoomActionButton({ primary = false, title, subtitle, testID, disabled = false, onPress, icon: Icon }: {
  primary?: boolean; title: string; subtitle?: string; testID?: string; disabled?: boolean;
  onPress: () => void; icon: typeof PlusCircle;
}) {
  const gradientId = primary ? 'roomActionWarm' : 'roomActionDark';
  return <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={title}
    disabled={disabled} activeOpacity={0.8} onPress={onPress}
    style={[styles.roomActionButton, primary ? styles.primaryRoomAction : styles.secondaryRoomAction, disabled && { opacity: 0.5 }]}>
    <View style={styles.roomActionSurface}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none"><Svg width="100%" height="100%">
        <Defs><LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor={primary ? '#FF963D' : '#343230'} />
          <Stop offset="0.55" stopColor={primary ? '#FF7518' : '#242323'} />
          <Stop offset="1" stopColor={primary ? '#CB500B' : '#191919'} />
        </LinearGradient></Defs>
        <Rect width="100%" height="100%" rx="15" fill={`url(#${gradientId})`} />
      </Svg></View>
      <View style={styles.roomActionLabel}><Icon size={17} strokeWidth={2.5} color={primary ? '#fff' : '#fb923c'} /><Text style={styles.roomActionText}>{title}</Text></View>
      {!!subtitle && <Text style={[styles.roomActionHint, styles.roomActionSubtitle, primary && { color: '#fff1e6' }]}>{subtitle}</Text>}
    </View>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  roomActionButton: { flex: 1, borderRadius: 16, borderWidth: 1, shadowOffset: { width: 0, height: 5 }, shadowRadius: 12, elevation: 4 },
  primaryRoomAction: { backgroundColor: '#F97316', borderColor: '#E7772C', borderTopColor: '#FFD0A0', borderLeftColor: '#FFAC64', borderRightColor: '#E7772C', borderBottomColor: '#A9450E', shadowColor: '#F97316', shadowOpacity: 0.24 },
  secondaryRoomAction: { backgroundColor: '#252525', borderColor: '#ffffff20', borderTopColor: '#ffffff38', borderLeftColor: '#ffffff26', borderRightColor: '#ffffff20', borderBottomColor: '#ffffff12', shadowColor: '#000', shadowOpacity: 0.3 },
  roomActionSurface: { minHeight: 68, borderRadius: 15, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  roomActionLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  roomActionText: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  roomActionHint: { color: '#ccc', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  roomActionSubtitle: { fontWeight: '500' },
});
