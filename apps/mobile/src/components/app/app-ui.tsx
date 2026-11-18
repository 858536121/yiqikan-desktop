import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, type LucideIcon } from 'lucide-react-native';
import { appControlColors as colors } from '../../theme/colors';

type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'muted' | 'accent';

const buttonInk: Record<ButtonTone, string> = {
  primary: '#321D15',
  secondary: colors.ink,
  quiet: colors.accent,
  muted: colors.muted,
  accent: colors.accentButton.ink,
};

export function AppButton({ label, icon: Icon, iconImage, tone = 'secondary', onPress, testID, busy = false, disabled = false, compact = false }: {
  label: string; icon?: LucideIcon; iconImage?: ImageSourcePropType; tone?: ButtonTone;
  onPress: () => void; testID?: string; busy?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const color = buttonInk[tone];
  const isAccent = tone === 'accent';
  const surface = tone === 'muted' ? styles.quiet : styles[tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: disabled || busy }}
    testID={testID} onPress={onPress} disabled={disabled || busy}
    android_ripple={{ color: isAccent ? colors.accentButton.ripple : tone === 'primary' ? '#36160C17' : '#FFFFFF16' }}
    style={({ pressed }) => [styles.button, surface, compact && styles.compactButton, disabled && styles.disabled,
      pressed && (isAccent ? styles.accentPressed : styles.pressed)]}>
    {iconImage ? <View style={[styles.buttonImageTile, busy && styles.busyContent]}>
      <Image source={iconImage} accessible={false} resizeMode="contain" fadeDuration={0} style={styles.buttonImage} />
    </View> : Icon && <Icon size={isAccent ? 18 : 17} color={color} strokeWidth={2} opacity={busy ? 0 : 1} />}
    <Text style={[styles.buttonText, { color }, busy && styles.busyContent]}>{label}</Text>
    {busy && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.buttonProgress]}>
      <ActivityIndicator size="small" color={color} />
    </View>}
  </Pressable>;
}

export function AppIconButton({ label, icon: Icon, onPress, testID, highlighted = false, expanded, color }: {
  label: string; icon: LucideIcon; onPress: () => void; testID?: string; highlighted?: boolean;
  expanded?: boolean; color?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} testID={testID}
    onPress={onPress} android_ripple={{ color: '#FFFFFF20', borderless: false }}
    style={({ pressed }) => [styles.iconButton, highlighted && styles.iconHighlighted, pressed && styles.pressed]}>
    <Icon size={20} strokeWidth={1.85} color={color ?? (highlighted ? colors.accent : colors.ink)} />
  </Pressable>;
}

export function AppActionSheet({ visible, heading, description, onClose, onDismiss, closeTestID, children, tone = 'default' }: {
  visible: boolean;
  heading: string;
  description?: string;
  onClose: () => void;
  onDismiss?: () => void;
  closeTestID?: string;
  children: React.ReactNode;
  tone?: 'default' | 'accent';
}) {
  const insets = useSafeAreaInsets();
  const isAccent = tone === 'accent';
  return <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose} onDismiss={onDismiss}>
    <View style={styles.backdrop}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.sheet, isAccent && styles.accentSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <View style={[styles.sheetHandle, isAccent && styles.accentSheetHandle]} />
        <View style={styles.sheetHeader}>
          <View style={styles.copy}><Text accessibilityRole="header" style={[styles.sheetTitle, isAccent && styles.accentSheetTitle]}>{heading}</Text>
            {!!description && <Text style={styles.description} numberOfLines={1}>{description}</Text>}
          </View>
          <AppIconButton label="关闭" icon={X} testID={closeTestID} onPress={onClose} />
        </View>
        {children}
      </View>
    </View>
  </Modal>;
}

export function AppActionRow({ title, description, icon: Icon, trailingIcon: TrailingIcon, selected = false, onPress, testID, tone = 'default' }: {
  title: string;
  description: string;
  icon: LucideIcon;
  trailingIcon?: LucideIcon;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  tone?: 'default' | 'accent' | 'accentPrimary' | 'filledAccent';
}) {
  const isAccent = tone !== 'default';
  const primary = tone === 'accentPrimary';
  const filled = tone === 'filledAccent';
  const iconColor = selected ? colors.done : primary || filled ? colors.accentButton.ink : isAccent ? colors.accentButton.edge : colors.accent;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={description}
    accessibilityState={{ selected, disabled: selected }} disabled={selected} onPress={onPress}
    android_ripple={{ color: filled ? colors.accentButton.ripple : isAccent ? colors.accentSheet.ripple : '#FFFFFF12' }}
    style={({ pressed }) => [styles.actionRow, isAccent && styles.accentActionRow, primary && styles.primaryActionRow,
      filled && styles.filledActionRow, pressed && (filled ? styles.accentPressed : isAccent ? styles.accentActionPressed : styles.pressed)]}>
    <View style={[styles.actionTile, isAccent && styles.accentActionTile, primary && styles.primaryActionTile,
      filled && styles.filledActionTile, selected && styles.selectedTile]}>
      <Icon size={19} color={iconColor} strokeWidth={1.8} />
    </View>
    <View style={styles.copy}>
      <Text style={[styles.actionTitle, filled && styles.filledActionText]} numberOfLines={2}>{title}</Text>
      <Text style={[styles.description, filled && styles.filledActionText]}>{description}</Text>
    </View>
    {TrailingIcon && <TrailingIcon size={18} color={filled ? colors.accentButton.ink : primary ? colors.accentButton.edge : colors.muted} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { borderRadius: 26, minHeight: 46, justifyContent: 'center', alignItems: 'center',
    flexDirection: 'row', gap: 7, paddingHorizontal: 15, paddingVertical: 10, overflow: 'hidden' },
  compactButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 8 },
  primary: { backgroundColor: colors.paper, borderColor: '#FFF0E4', borderWidth: StyleSheet.hairlineWidth },
  accent: { minHeight: 48, paddingHorizontal: 18, gap: 8, backgroundColor: colors.accentButton.fill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentButton.edge },
  accentPressed: { backgroundColor: colors.accentButton.pressed },
  secondary: { backgroundColor: '#FFFFFF0B', borderColor: '#FFFFFF22', borderWidth: StyleSheet.hairlineWidth },
  quiet: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.77 },
  buttonText: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  buttonImageTile: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center' },
  buttonImage: { width: 20, height: 20 },
  busyContent: { opacity: 0 },
  buttonProgress: { alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconHighlighted: { backgroundColor: '#F7AE771C' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000A' },
  sheet: { maxHeight: '78%', backgroundColor: '#19171F', borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 19, paddingTop: 10 },
  sheetHandle: { width: 32, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: '#675965' },
  accentSheet: { backgroundColor: colors.accentSheet.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.accentSheet.edge },
  accentSheetHandle: { backgroundColor: colors.accentSheet.handle },
  accentSheetTitle: { color: colors.accentButton.edge },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 8 },
  sheetTitle: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  actionRow: { flex: 1, minHeight: 69, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 3, paddingVertical: 10, borderRadius: 12, overflow: 'hidden' },
  actionTile: { width: 38, height: 45, borderRadius: 12, backgroundColor: '#291E25',
    borderColor: '#FFBC9522', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', alignItems: 'center' },
  accentActionRow: { paddingHorizontal: 10, marginBottom: 4 },
  primaryActionRow: { backgroundColor: colors.accentSheet.row },
  accentActionPressed: { backgroundColor: colors.accentSheet.pressed },
  accentActionTile: { width: 40, height: 40, backgroundColor: colors.accentSheet.tile, borderColor: colors.accentSheet.edge },
  primaryActionTile: { backgroundColor: colors.accentButton.fill, borderColor: colors.accentButton.edge },
  filledActionRow: { backgroundColor: colors.accentButton.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentButton.edge },
  filledActionTile: { backgroundColor: colors.paper, borderColor: colors.accentButton.edge },
  filledActionText: { color: colors.accentButton.ink },
  selectedTile: { borderColor: '#A6DBBF28', backgroundColor: '#182823' },
  actionTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  description: { color: colors.muted, fontSize: 12, lineHeight: 17 },
});
