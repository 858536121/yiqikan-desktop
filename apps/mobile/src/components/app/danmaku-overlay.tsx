import React, { useEffect, useRef, useState, memo } from 'react';
import { StyleSheet, View, Text, Animated, Dimensions, useWindowDimensions } from 'react-native';
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
  const { width: windowWidth } = useWindowDimensions();
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const [activeDanmakus, setActiveDanmakus] = useState<ActiveDanmaku[]>([]);
  // 组件挂载时同步记录已有历史消息，避免旧弹幕集中飞出，同时确保新发送的第1条消息不被误吞
  const processedIdsRef = useRef<Set<string>>(
    new Set(
      useRoomStore
        .getState()
        .chatMessages.map((m) => m.id || `${m.actorName}_${m.message}_${m.createdAt || 0}`)
        .filter(Boolean)
    )
  );
  const nextTrackRef = useRef(0);

  useEffect(() => {
    if (!enabled || !chatMessages || chatMessages.length === 0) return;

    // 找出所有未展示的新到达消息（支持连续发送、多条批处理不漏发）
    const newMessages = chatMessages.filter((m) => {
      const key = m.id || `${m.actorName}_${m.message}_${m.createdAt || 0}`;
      return !processedIdsRef.current.has(key);
    });
    if (newMessages.length === 0) return;

    const currentWidth = windowWidth || Dimensions.get('window').width || 800;

    newMessages.forEach((msg, idx) => {
      const key = msg.id || `${msg.actorName}_${msg.message}_${msg.createdAt || 0}`;
      processedIdsRef.current.add(key);

      // 略微交错入场 X 偏移
      const animX = new Animated.Value(currentWidth + 20 + idx * 30);
      const trackIndex = nextTrackRef.current % TOTAL_TRACKS;
      nextTrackRef.current = (nextTrackRef.current + 1) % TOTAL_TRACKS;

      const newDanmaku: ActiveDanmaku = {
        id: `${msg.id}_${Date.now()}_${idx}`,
        sender: msg.actorName || '成员',
        message: msg.message,
        isSystem: (msg as any).kind === 'system',
        trackIndex,
        animX,
      };

      setActiveDanmakus((prev) => [...prev.slice(-20), newDanmaku]);

      // 6.5 秒匀速横向飘过屏幕
      Animated.timing(animX, {
        toValue: -currentWidth - 200,
        duration: 6500,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setActiveDanmakus((prev) => prev.filter((item) => item.id !== newDanmaku.id));
        }
      });
    });
  }, [chatMessages, enabled, windowWidth]);

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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
