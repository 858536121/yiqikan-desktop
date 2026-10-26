import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { ProfileAvatar } from '@yiqikan/shared';

const avatars = { yi: { text: '异', bg: '#37271e', fg: '#f2a06a' }, moon: { text: '月', bg: '#282e40', fg: '#bac2e3' },
  mountain: { text: '山', bg: '#24362c', fg: '#adc9b0' }, sea: { text: '海', bg: '#20353e', fg: '#a2cbd6' } };
export function ProfileAvatarView({ avatar = 'yi', size = 64 }: { avatar?: ProfileAvatar | string; size?: number }) {
  const preset = avatars[avatar as ProfileAvatar] || avatars.yi;
  return <View accessibilityLabel={`${preset.text}头像`} style={{ width: size, height: size + 4, borderRadius: size * .28,
    backgroundColor: preset.bg, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
    <Text style={{ color: preset.fg, fontSize: size * .43, fontWeight: '500', marginRight: 4, transform: [{ rotate: '-5deg' }] }}>{preset.text}</Text>
    <View style={{ position: 'absolute', right: 7, top: 10, bottom: 10, justifyContent: 'space-between' }}>{[0,1,2,3,4,5].map(i=><View key={i} style={{ width: 2, height: 2, backgroundColor: preset.fg, opacity: .4 }}/>)}</View>
  </View>;
}
export function ProfileHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return <View style={profileStyles.header}><TouchableOpacity onPress={onBack} accessibilityLabel="返回" testID="profile-page-back" style={profileStyles.headerBack}><ChevronLeft size={23} color="#c1c3bd"/></TouchableOpacity><Text style={profileStyles.headerTitle}>{title}</Text><View style={{ marginLeft: 'auto' }}>{action}</View></View>;
}
export function ProfileRow({ title, subtitle, icon: Icon, onPress, testID, meta, disabled = false }: {
  title: string; subtitle?: string; icon?: React.ComponentType<{ size: number; color: string }>; onPress: () => void; testID?: string; meta?: string; disabled?: boolean;
}) {
  return <TouchableOpacity testID={testID} accessibilityLabel={title} disabled={disabled} onPress={onPress} activeOpacity={.7} style={[profileStyles.row, disabled && { opacity: .45 }]}>
    {Icon && <View style={profileStyles.rowIcon}><Icon size={19} color="#a0a39b"/></View>}
    <View style={{ flex: 1 }}><Text style={profileStyles.rowTitle}>{title}</Text>{subtitle&&<Text style={profileStyles.caption}>{subtitle}</Text>}</View>
    {meta&&<Text style={profileStyles.meta}>{meta}</Text>}<ChevronRight size={17} color="#747971"/>
  </TouchableOpacity>;
}
export const profileStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111214' }, body: { paddingHorizontal: 20, paddingBottom: 26 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 60, marginBottom: 12, paddingRight: 16 },
  headerBack: { padding: 12, minWidth: 44, minHeight: 44 }, headerTitle: { color: '#f0efeb', fontSize: 18, fontWeight: '500' },
  title: { color: '#f0efeb', fontSize: 24, fontWeight: '600' }, text: { color: '#f0efeb', fontSize: 14, lineHeight: 23 },
  label: { fontSize: 12, color: '#a0a39b', marginTop: 24, marginBottom: 10, marginLeft: 3 },
  caption: { color: '#a0a39b', fontSize: 12, lineHeight: 19, marginTop: 5 },
  group: { backgroundColor: '#1c1d20', borderRadius: 18, overflow: 'hidden' }, row: { padding: 16, minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 24, alignItems: 'center' }, rowTitle: { color: '#f0efeb', fontSize: 15, fontWeight: '500' }, meta: { color: '#a0a39b', fontSize: 11 },
  primary: { minHeight: 48, padding: 13, borderRadius: 13, backgroundColor: '#ecebe4', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryText: { color: '#20221f', fontSize: 15, fontWeight: '600' }, secondary: { minHeight: 48, padding: 13, borderRadius: 13, backgroundColor: '#1c1d20', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  link: { minHeight: 44, paddingVertical: 12, justifyContent: 'center' }, linkText: { color: '#f2a06a', fontSize: 13 },
  input: { color: '#f0efeb', backgroundColor: '#1c1d20', borderColor: '#2a2c2d', borderWidth: 1, borderRadius: 12, padding: 13, fontSize: 16, minHeight: 48 },
  warning: { borderRadius: 14, backgroundColor: '#372b1d', padding: 14, marginTop: 10 }, error: { color: '#f4a59b', fontSize: 12, lineHeight: 20, marginVertical: 10 },
});
