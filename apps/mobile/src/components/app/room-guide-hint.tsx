import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from './app-ui';
import { appControlColors } from '../../theme/colors';

export function RoomGuideHint({ message, onDismiss, testID }: {
  message: string;
  onDismiss: () => void;
  testID: string;
}) {
  return <View testID={testID} style={styles.hint}>
    <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text>
    <AppButton label="知道了" tone="quiet" onPress={onDismiss} testID={`${testID}-dismiss`} />
  </View>;
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderCurve: 'continuous',
    backgroundColor: appControlColors.surface, borderWidth: StyleSheet.hairlineWidth,
    borderColor: appControlColors.line, paddingLeft: 12, paddingVertical: 2 },
  message: { flex: 1, color: appControlColors.warmMuted, fontSize: 13, paddingVertical: 8 },
});
