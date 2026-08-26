import React, { useEffect, useRef, useState, memo } from 'react';
import { StyleSheet, View, Text, Animated, Dimensions } from 'react-native';
import { useRoomStore } from '../../store/useRoomStore';

interface DanmakuOverlayProps {
  enabled: boolean;
}

interface ActiveDanmaku {
  id: string;
  sender: string;
  message: string;
  isSystem?: boolean;
  trackIndex: number;
  animX: Animated.Value;
}

const TOTAL_TRACKS = 4;
const TRACK_HEIGHT = 38;
const TOP_OFFSET = 20;

export const DanmakuOverlay = memo(function DanmakuOverlay({ enabled }: DanmakuOverlayProps) {
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const [activeDanmakus, setActiveDanmakus] = useState<ActiveDanmaku[]>([]);
  const lastProcessedIdRef = useRef<string | null>(null);
  const nextTrackRef = useRef(0);

  useEffect(() => {
    if (!enabled || !chatMessages || chatMessages.length === 0) return;

    const latest = chatMessages[chatMessages.length - 1];
    if (!latest || latest.id === lastProcessedIdRef.current) return;

    lastProcessedIdRef.current = latest.id;

    const screenWidth = Dimensions.get('window').width || 600;
    const animX = new Animated.Value(screenWidth + 20);
    const trackIndex = nextTrackRef.current % TOTAL_TRACKS;
    nextTrackRef.current = (nextTrackRef.current + 1) % TOTAL_TRACKS;

    const newDanmaku: ActiveDanmaku = {
      id: `${latest.id}_${Date.now()}`,
      sender: latest.actorName || '成员',
      message: latest.message,
      isSystem: (latest as any).kind === 'system',
      trackIndex,
      animX,
    };

    setActiveDanmakus((prev) => [...prev.slice(-15), newDanmaku]);

    // Animate across screen in 6.5 seconds
    Animated.timing(animX, {
      toValue: -screenWidth - 100,
      duration: 6500,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setActiveDanmakus((prev) => prev.filter((item) => item.id !== newDanmaku.id));
      }
    });
  }, [chatMessages, enabled]);

  if (!enabled || activeDanmakus.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {activeDanmakus.map((d) => (
        <Animated.View
          key={d.id}
          style={[
            styles.danmakuBubble,
            d.isSystem ? styles.systemBubble : null,
            {
              top: TOP_OFFSET + d.trackIndex * TRACK_HEIGHT,
              transform: [{ translateX: d.animX }],
            },
          ]}
        >
          {!d.isSystem && (
            <Text style={styles.senderText}>{d.sender}: </Text>
          )}
          <Text style={[styles.messageText, d.isSystem ? styles.systemText : null]}>
            {d.message}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    overflow: 'hidden',
  },
  danmakuBubble: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 18, 20, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  systemBubble: {
    backgroundColor: 'rgba(249, 115, 22, 0.25)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
  },
  senderText: {
    color: '#fb923c',
    fontSize: 13,
    fontWeight: 'bold',
    marginRight: 4,
  },
  messageText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  systemText: {
    color: '#fdba74',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
