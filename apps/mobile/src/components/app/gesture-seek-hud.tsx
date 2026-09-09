import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { FastForward, Rewind } from 'lucide-react-native';

interface GestureSeekHudProps {
  visible: boolean;
  deltaSeconds: number;
  targetTime: number;
  duration: number;
}

export function GestureSeekHud({
  visible,
  deltaSeconds,
  targetTime,
  duration,
}: GestureSeekHudProps) {
  if (!visible) return null;

  const isForward = deltaSeconds >= 0;
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (targetTime / duration) * 100)) : 0;

  return (
    <View style={styles.hudContainer} pointerEvents="none">
      <View style={styles.hudCard}>
        <View style={styles.iconRow}>
          {isForward ? (
            <FastForward color="#F97316" size={28} />
          ) : (
            <Rewind color="#F97316" size={28} />
          )}
          <Text style={styles.deltaText}>
            {isForward ? `+${Math.round(deltaSeconds)}s` : `${Math.round(deltaSeconds)}s`}
          </Text>
        </View>

        <Text style={styles.timeText}>
          <Text style={styles.currentTimeText}>{formatTime(targetTime)}</Text>
          <Text style={styles.durationText}> / {formatTime(duration)}</Text>
        </Text>

        {/* Mini progress bar */}
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hudContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 95,
  },
  hudCard: {
    backgroundColor: 'rgba(18, 18, 20, 0.88)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  deltaText: {
    color: '#F97316',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  timeText: {
    fontSize: 14,
    marginBottom: 10,
  },
  currentTimeText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  durationText: {
    color: '#888888',
  },
  progressBarBg: {
    width: 140,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F97316',
    borderRadius: 2,
  },
});
