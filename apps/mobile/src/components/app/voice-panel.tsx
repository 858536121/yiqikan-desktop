import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated } from 'react-native';
import Slider from '@react-native-community/slider';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  PhoneOff, 
  Radio, 
  Sparkles, 
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw
} from 'lucide-react-native';
import { useVoice } from '../../services/voice-service';

interface VoicePanelProps {
  roomId: string;
  myUserId: string;
  myName: string;
}

export const VoicePanel: React.FC<VoicePanelProps> = ({
  roomId,
  myUserId,
  myName,
}) => {
  const {
    voiceStatus,
    errorMessage,
    isMuted,
    isDeafened,
    callVolume,
    noiseCancellation,
    stats,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    setCallVolume,
    toggleNoiseCancellation,
  } = useVoice();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  if (voiceStatus === 'idle') {
    return (
      <View style={styles.idleCard}>
        <View style={styles.idleLeft}>
          <View style={styles.idleIconWrap}>
            <Mic size={18} color="#F97316" />
          </View>
          <View style={styles.idleTextGroup}>
            <Text style={styles.idleTitle}>实时语音频道</Text>
            <Text style={styles.idleSubtitle}>低延迟多人连麦 · 异地同步开黑</Text>
          </View>
        </View>
        <TouchableOpacity 
          style={styles.joinBtn} 
          onPress={() => joinVoice(roomId, myUserId, myName)}
          activeOpacity={0.8}
        >
          <Radio size={14} color="#fff" style={{ marginRight: 4 }} />
          <Text style={styles.joinBtnText}>进入语音</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (voiceStatus === 'connecting') {
    return (
      <View style={styles.connectingCard}>
        <View style={styles.connectingLeft}>
          <Radio size={18} color="#F97316" />
          <Text style={styles.connectingText}>正在连接语音服务器...</Text>
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={leaveVoice} activeOpacity={0.7}>
          <Text style={styles.cancelBtnText}>取消</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (voiceStatus === 'error') {
    return (
      <View style={styles.errorCard}>
        <View style={styles.errorLeft}>
          <AlertCircle size={18} color="#FB7185" />
          <View style={{ marginLeft: 8, flex: 1 }}>
            <Text style={styles.errorTitle}>语音连接失败</Text>
            <Text style={styles.errorSubtitle} numberOfLines={2}>
              {errorMessage || '无法连接语音服务器'}
            </Text>
          </View>
        </View>
        <TouchableOpacity 
          style={styles.retryBtn} 
          onPress={() => joinVoice(roomId, myUserId, myName)}
          activeOpacity={0.7}
        >
          <RefreshCw size={13} color="#fff" style={{ marginRight: 4 }} />
          <Text style={styles.retryBtnText}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 通话中
  const statusDescription = isMuted
    ? '麦克风已静音'
    : stats.isLocalSpeaking
    ? '正在说话…'
    : stats.isRemoteSpeaking
    ? '对方正在说话…'
    : '麦克风就绪';

  return (
    <View style={styles.connectedCard}>
      {/* 状态总览行 */}
      <View style={styles.connectedHeader}>
        <View style={styles.statusIndicatorGroup}>
          <View style={[styles.livingDot, isMuted && styles.livingDotMuted]} />
          <View style={{ marginLeft: 8 }}>
            <Text style={styles.connectedTitle}>语音通话中</Text>
            <Text style={[styles.connectedSubtitle, stats.isLocalSpeaking && styles.speakingSubtitle]}>
              {statusDescription}
            </Text>
          </View>
        </View>

        {/* 快捷操作按钮组 */}
        <View style={styles.actionBtnsGroup}>
          {/* 麦克风按键 */}
          <TouchableOpacity
            style={[
              styles.iconBtn,
              isMuted
                ? styles.iconBtnMuted
                : stats.isLocalSpeaking
                ? styles.iconBtnSpeaking
                : styles.iconBtnNormal,
            ]}
            onPress={toggleMute}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isMuted ? <MicOff size={16} color="#FB7185" /> : <Mic size={16} color={stats.isLocalSpeaking ? "#4ADE80" : "#E4E4E7"} />}
          </TouchableOpacity>

          {/* 闭听与设置展开按键 */}
          <TouchableOpacity
            style={[
              styles.iconBtn,
              isDrawerOpen
                ? styles.iconBtnActive
                : isDeafened
                ? styles.iconBtnMuted
                : stats.isRemoteSpeaking
                ? styles.iconBtnRemoteSpeaking
                : styles.iconBtnNormal,
            ]}
            onPress={() => setIsDrawerOpen(prev => !prev)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isDeafened ? <VolumeX size={16} color="#FB7185" /> : <Volume2 size={16} color={stats.isRemoteSpeaking ? "#60A5FA" : "#E4E4E7"} />}
          </TouchableOpacity>

          {/* 挂断按键 */}
          <TouchableOpacity
            style={styles.hangupBtn}
            onPress={leaveVoice}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <PhoneOff size={16} color="#FB7185" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 展开的通话设置与音量抽屉 */}
      {isDrawerOpen && (
        <View style={styles.drawerContainer}>
          {/* 闭听切换 */}
          <View style={styles.drawerRow}>
            <Text style={styles.drawerLabel}>静音所有成员 (闭听)</Text>
            <TouchableOpacity 
              style={[styles.togglePill, isDeafened && styles.togglePillActive]} 
              onPress={toggleDeafen}
              activeOpacity={0.7}
            >
              <Text style={[styles.togglePillText, isDeafened && styles.togglePillTextActive]}>
                {isDeafened ? '已开启闭听' : '正常接收声音'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 通话音量调节 */}
          <View style={styles.drawerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.drawerLabel}>通话音量</Text>
              <Text style={styles.volumeValueText}>{callVolume}%</Text>
            </View>
            <Slider
              style={styles.volumeSlider}
              minimumValue={0}
              maximumValue={100}
              value={callVolume}
              minimumTrackTintColor="#F97316"
              maximumTrackTintColor="rgba(255, 255, 255, 0.15)"
              thumbTintColor="#F97316"
              onValueChange={setCallVolume}
            />
          </View>

          {/* AI 降噪与回声消除 */}
          <View style={[styles.drawerRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ShieldCheck size={14} color="#F97316" style={{ marginRight: 6 }} />
              <Text style={styles.drawerLabel}>降噪与回声消除</Text>
            </View>
            <TouchableOpacity 
              style={[styles.togglePill, noiseCancellation && styles.togglePillActive]} 
              onPress={toggleNoiseCancellation}
              activeOpacity={0.7}
            >
              <Text style={[styles.togglePillText, noiseCancellation && styles.togglePillTextActive]}>
                {noiseCancellation ? '已开启' : '已关闭'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  idleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(24, 24, 28, 0.95)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 12,
  },
  idleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  idleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  idleTextGroup: {
    flex: 1,
  },
  idleTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  idleSubtitle: {
    color: '#888',
    fontSize: 10,
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  connectingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(32, 24, 20, 0.95)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.25)',
    marginBottom: 12,
  },
  connectingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectingText: {
    color: '#FDBA74',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelBtnText: {
    color: '#aaa',
    fontSize: 11,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(36, 18, 22, 0.95)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
    marginBottom: 12,
  },
  errorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  errorTitle: {
    color: '#FB7185',
    fontSize: 12,
    fontWeight: '700',
  },
  errorSubtitle: {
    color: '#FDA4AF',
    fontSize: 10,
    marginTop: 1,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 63, 94, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.4)',
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  connectedCard: {
    backgroundColor: 'rgba(18, 22, 20, 0.95)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    marginBottom: 12,
  },
  connectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIndicatorGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  livingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
  },
  livingDotMuted: {
    backgroundColor: '#FB7185',
  },
  connectedTitle: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '700',
  },
  connectedSubtitle: {
    color: '#86EFAC',
    fontSize: 10,
    marginTop: 1,
  },
  speakingSubtitle: {
    color: '#F97316',
    fontWeight: '600',
  },
  actionBtnsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBtnNormal: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  iconBtnSpeaking: {
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
    borderColor: '#22C55E',
  },
  iconBtnRemoteSpeaking: {
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    borderColor: '#3B82F6',
  },
  iconBtnMuted: {
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  iconBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    borderColor: '#F97316',
  },
  hangupBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  drawerLabel: {
    color: '#ccc',
    fontSize: 11,
    fontWeight: '500',
  },
  volumeValueText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
  },
  volumeSlider: {
    width: 140,
    height: 30,
  },
  togglePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  togglePillActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
  },
  togglePillText: {
    color: '#888',
    fontSize: 10,
  },
  togglePillTextActive: {
    color: '#F97316',
    fontWeight: '600',
  },
});
