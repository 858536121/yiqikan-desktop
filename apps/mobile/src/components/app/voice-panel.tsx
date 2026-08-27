import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import Slider from '@react-native-community/slider';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  PhoneOff, 
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  X
} from 'lucide-react-native';
import { useVoice } from '../../services/voice-service';

interface VoicePanelProps {
  roomId: string;
  myUserId: string;
  myName: string;
  compact?: boolean;
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

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 1. 未加入语音 (Idle 状态)
  if (voiceStatus === 'idle') {
    return (
      <TouchableOpacity 
        style={styles.compactJoinBtn} 
        onPress={() => joinVoice(roomId, myUserId, myName)}
        activeOpacity={0.75}
      >
        <Mic size={12} color="#fff" style={{ marginRight: 4 }} />
        <Text style={styles.compactJoinBtnText}>进入语音</Text>
      </TouchableOpacity>
    );
  }

  // 2. 连接中状态
  if (voiceStatus === 'connecting') {
    return (
      <TouchableOpacity style={styles.compactConnectingPill} onPress={leaveVoice} activeOpacity={0.7}>
        <ActivityIndicator size="small" color="#F97316" style={{ marginRight: 4, transform: [{ scale: 0.75 }] }} />
        <Text style={styles.compactConnectingText}>连麦中…</Text>
      </TouchableOpacity>
    );
  }

  // 3. 错误状态
  if (voiceStatus === 'error') {
    return (
      <TouchableOpacity 
        style={styles.compactErrorPill} 
        onPress={() => joinVoice(roomId, myUserId, myName)}
        activeOpacity={0.7}
      >
        <RefreshCw size={12} color="#FB7185" style={{ marginRight: 4 }} />
        <Text style={styles.compactErrorText}>重试语音</Text>
      </TouchableOpacity>
    );
  }

  // 4. 语音已连接通话中 (Connected 状态)
  return (
    <>
      <View style={styles.compactConnectedRow}>
        {/* 说话呼吸绿点 */}
        <View style={[
          styles.compactLivingDot, 
          isMuted && styles.compactLivingDotMuted, 
          stats.isLocalSpeaking && styles.compactLivingDotSpeaking
        ]} />

        {/* 麦克风静音切换 */}
        <TouchableOpacity
          style={[styles.compactIconBtn, isMuted && styles.compactIconBtnMuted]}
          onPress={toggleMute}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {isMuted ? (
            <MicOff size={12} color="#FB7185" />
          ) : (
            <Mic size={12} color={stats.isLocalSpeaking ? "#4ADE80" : "#E4E4E7"} />
          )}
        </TouchableOpacity>

        {/* 听筒/音量设置 */}
        <TouchableOpacity
          style={[styles.compactIconBtn, (isDeafened || isSettingsOpen) && styles.compactIconBtnActive]}
          onPress={() => setIsSettingsOpen(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {isDeafened ? (
            <VolumeX size={12} color="#FB7185" />
          ) : (
            <Volume2 size={12} color={stats.isRemoteSpeaking ? "#60A5FA" : "#E4E4E7"} />
          )}
        </TouchableOpacity>

        {/* 挂断按钮 */}
        <TouchableOpacity
          style={styles.compactHangupBtn}
          onPress={leaveVoice}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <PhoneOff size={12} color="#FB7185" />
        </TouchableOpacity>
      </View>

      {/* 语音高级设置弹窗 (音量 / 闭听 / 降噪) */}
      <Modal 
        visible={isSettingsOpen} 
        transparent 
        animationType="fade" 
        onRequestClose={() => setIsSettingsOpen(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setIsSettingsOpen(false)}
        >
          <View style={styles.modalDialog} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalDialogTitle}>语音通话控制</Text>
              <TouchableOpacity onPress={() => setIsSettingsOpen(false)} style={{ padding: 4 }}>
                <X size={18} color="#888" />
              </TouchableOpacity>
            </View>

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
                <Text style={styles.drawerLabel}>AI 降噪与回声消除</Text>
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
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  // 紧凑胶囊按钮 (Idle)
  compactJoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  compactJoinBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: 'bold',
  },

  // 紧凑连接中 (Connecting)
  compactConnectingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  compactConnectingText: {
    color: '#FDBA74',
    fontSize: 11,
    fontWeight: '600',
  },

  // 紧凑错误 (Error)
  compactErrorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  compactErrorText: {
    color: '#FB7185',
    fontSize: 11,
    fontWeight: '600',
  },

  // 紧凑通话控制条 (Connected)
  compactConnectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 4,
  },
  compactLivingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginRight: 2,
    marginLeft: 2,
  },
  compactLivingDotMuted: {
    backgroundColor: '#FB7185',
  },
  compactLivingDotSpeaking: {
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 3,
  },
  compactIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactIconBtnMuted: {
    backgroundColor: 'rgba(244, 63, 94, 0.15)',
  },
  compactIconBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
  },
  compactHangupBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: 'rgba(244, 63, 94, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 设置 Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalDialog: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#1c1c22',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    paddingBottom: 10,
  },
  modalDialogTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  drawerLabel: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '500',
  },
  volumeValueText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
  },
  volumeSlider: {
    width: 130,
    height: 30,
  },
  togglePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
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
    fontSize: 11,
  },
  togglePillTextActive: {
    color: '#F97316',
    fontWeight: '600',
  },
});
