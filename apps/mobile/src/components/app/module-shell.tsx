import React from 'react';
import { StyleSheet, View } from 'react-native';

export type AppTab = 'room' | 'watch' | 'profile';

// The browser stays mounted at the same size beneath opaque module surfaces.
// Switching a tab never detaches, freezes or reparents its native WebView.
export function ModuleShell({ activeTab, watch, room, profile }: {
  activeTab: AppTab; watch: React.ReactNode; room: React.ReactNode; profile: React.ReactNode;
}) {
  const accessibility = (tab: AppTab) => ({
    pointerEvents: activeTab === tab ? 'auto' as const : 'none' as const,
    accessibilityElementsHidden: activeTab !== tab,
    importantForAccessibility: activeTab === tab ? 'auto' as const : 'no-hide-descendants' as const,
  });
  return (
    <View style={styles.container}>
      <View testID="观看模块" style={styles.layer} {...accessibility('watch')}>{watch}</View>
      <View testID="房间模块" style={[styles.layer, styles.surface, activeTab !== 'room' && styles.hidden]} {...accessibility('room')}>{room}</View>
      <View testID="我的模块" style={[styles.layer, styles.surface, activeTab !== 'profile' && styles.hidden]} {...accessibility('profile')}>{profile}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  surface: { backgroundColor: '#0c0d12' },
  hidden: { opacity: 0 },
});
