import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform } from 'react-native';
import { Clock, X } from 'lucide-react-native';
import { formatTime } from '../../utils/time';

interface ResumePlaybackPillProps {
  visible: boolean;
  targetTime: number;
  progressPercent?: number;
  onJump: () => void;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ResumePlaybackPill({
  visible,
  targetTime,
  progressPercent = 0,
  onJump,
  onDismiss,
  autoDismissMs = 6000,
}: ResumePlaybackPillProps) {
  const [rendered, setRendered] = React.useState(visible && targetTime > 0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;
  const dismissTimerRef = useRef<any>(null);

  useEffect(() => {
    if (visible && targetTime > 0) {
      setRendered(true);
      fadeAnim.setValue(0);
      slideAnim.setValue(12);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 9,
          useNativeDriver: true,
        }),
      ]).start();

      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      dismissTimerRef.current = setTimeout(() => {
        onDismiss();
      }, autoDismissMs);
    } else {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 10,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRendered(false);
      });
    }

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [visible, targetTime]);

  const handleManualClose = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    onDismiss();
  };

  if (!rendered) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.pillBox}>
        <View style={styles.iconBadge}>
          <Clock size={13} color="#F97316" />
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.titleText} numberOfLines={1}>
            上次看到 <Text style={styles.timeHighlight}>{formatTime(targetTime)}</Text>
            {progressPercent > 0 ? ` (${progressPercent}%)` : ''}
          </Text>
        </View>

        <TouchableOpacity
          testID="浮层一键跳转续播按钮"
          accessibilityLabel="一键跳转续播"
          style={styles.jumpBtn}
          onPress={() => {
            if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
            onJump();
            onDismiss();
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.jumpBtnText}>跳转续播</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="关闭续播浮层按钮"
          accessibilityLabel="关闭续播提示"
          style={styles.closeBtn}
          onPress={handleManualClose}
          activeOpacity={0.7}
        >
          <X size={13} color="#999" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 14,
    bottom: 12,
    zIndex: 999,
  },
  pillBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 18, 22, 0.92)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(249, 115, 22, 0.28)',
    borderLeftColor: 'rgba(255, 255, 255, 0.12)',
    borderRightColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 22,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  textContainer: {
    marginRight: 8,
  },
  titleText: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '500',
  },
  timeHighlight: {
    color: '#F97316',
    fontWeight: '700',
  },
  jumpBtn: {
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    marginRight: 4,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderTopWidth: 1,
  },
  jumpBtnText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
});
