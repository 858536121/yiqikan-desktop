import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, Alert, TextInput, ActivityIndicator, Linking } from 'react-native';
import { X, User, Trash2, Info, ChevronRight, Edit2, Sparkles, RefreshCw, Smartphone } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoomStore } from '../../store/useRoomStore';
import { socketService } from '../../services/socket';
import { otaService } from '../../services/ota-service';

const USERNAME_CACHE_KEY = '@yiqikan_username';

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileModal({ visible, onClose }: ProfileModalProps) {
  const [username, setUsername] = useState('未设置昵称');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [bundleVersion, setBundleVersion] = useState('1.12.0');
  const [baseVersion, setBaseVersion] = useState('1.12.0');
  const [isChecking, setIsChecking] = useState(false);
  const roomState = useRoomStore((state) => state.roomState);

  useEffect(() => {
    if (visible) {
      AsyncStorage.getItem(USERNAME_CACHE_KEY).then((name) => {
        if (name) setUsername(name);
      });
      otaService.getCurrentBundleVersion().then((v) => {
        setBundleVersion(v);
      });
      setBaseVersion(otaService.getBaseAppVersion());
      setIsEditing(false);
    }
  }, [visible]);

  const handleSaveName = async () => {
    if (editName.trim()) {
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, editName.trim());
      setUsername(editName.trim());
      if (roomState) {
        socketService.updateMemberName(roomState.id, editName.trim());
      }
    }
    setIsEditing(false);
  };

  const handleClearCache = () => {
    Alert.alert('清理缓存', '确定要清理本地播放与历史缓存吗？（不会清除昵称）', [
      { text: '取消', style: 'cancel' },
      { text: '确定清理', style: 'destructive', onPress: async () => {
        try {
          const keys = await AsyncStorage.getAllKeys();
          const keysToClear = keys.filter(k => k !== USERNAME_CACHE_KEY);
          await AsyncStorage.multiRemove(keysToClear);
          Alert.alert('提示', '本地缓存已清理完毕');
        } catch (e) {
          Alert.alert('错误', '清理失败');
        }
      }}
    ]);
  };

  const handleCheckUpdate = async () => {
    if (isChecking) return;
    setIsChecking(true);
    try {
      const res = await otaService.checkUpdate();
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion && res.bundleUrl) {
        Alert.alert(
          '发现新版本',
          `发现新版本 UI Bundle: v${res.latestBundleVersion}\n\n更新说明：${res.releaseNotes || '性能优化与体验改进'}\n\n是否立即下载并应用？`,
          [
            { text: '稍后', style: 'cancel' },
            {
              text: '立即下载更新',
              onPress: async () => {
                try {
                  setIsChecking(true);
                  await otaService.downloadAndApply(res.bundleUrl!, res.latestBundleVersion!);
                  setBundleVersion(res.latestBundleVersion!);
                  Alert.alert(
                    '更新已就绪',
                    `已成功下载安装 v${res.latestBundleVersion} 热更包，是否立即重启应用生效？`,
                    [
                      { text: '稍后生效' },
                      {
                        text: '立即重启',
                        onPress: () => {
                          otaService.reloadApp();
                        },
                      },
                    ]
                  );
                } catch (err: any) {
                  Alert.alert('下载失败', err?.message || '下载热更包失败');
                } finally {
                  setIsChecking(false);
                }
              },
            },
          ]
        );
      } else if (res.status === 'APP_UPDATE_REQUIRED') {
        Alert.alert(
          '发现新底包版本',
          `${res.releaseNotes || '请更新至最新版本 App 以获得完整功能支持。'}`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '前往下载',
              onPress: () => {
                if (res.appDownloadUrl) {
                  Linking.openURL(res.appDownloadUrl).catch(() => {});
                }
              },
            },
          ]
        );
      } else if (res.status === 'UP_TO_DATE') {
        Alert.alert('版本检查', `当前已是最新版本 (v${bundleVersion})，无需更新。`);
      } else {
        Alert.alert('检查失败', res.error || '无法连接到更新服务器');
      }
    } catch (e: any) {
      Alert.alert('检查失败', e?.message || '检查更新失败');
    } finally {
      setIsChecking(false);
    }
  };

  const handleAbout = () => {
    Alert.alert(
      '关于 异起看 (YiQiKan)', 
      `当前版本: v${bundleVersion}\n原生底包: v${baseVersion}\n通信协议: Protocol v1\n\n异起看是一款极简、跨平台、低延迟的异地同步观影与互动工具。\n支持网页视频智能嗅探与毫秒级状态对齐。`
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Sparkles size={16} color="#F97316" style={{ marginRight: 6 }} />
              <Text style={styles.headerTitle}>个人中心 & 设置</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X color="#aaa" size={22} />
            </TouchableOpacity>
          </View>

          {/* User Info */}
          <View style={styles.userInfoContainer}>
            <View style={styles.avatarCircle}>
              <User color="#F97316" size={32} />
            </View>
            
            {isEditing ? (
              <View style={styles.editNameContainer}>
                <TextInput 
                  style={styles.nameInput}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  placeholder="输入新昵称"
                  placeholderTextColor="#666"
                  onSubmitEditing={handleSaveName}
                  onBlur={handleSaveName}
                />
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.nameDisplayContainer} 
                onPress={() => { setEditName(username); setIsEditing(true); }}
                activeOpacity={0.7}
              >
                <Text style={styles.usernameText}>{username}</Text>
                <Edit2 color="#888" size={15} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            )}
            
            <Text style={styles.userDescText}>点击昵称可直接修改并同步房间</Text>
          </View>

          {/* Settings List */}
          <View style={styles.settingsList}>
            {/* 检查更新 */}
            <TouchableOpacity style={styles.settingItem} onPress={handleCheckUpdate} activeOpacity={0.7}>
              <View style={styles.settingItemLeft}>
                <RefreshCw color="#F97316" size={18} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.settingItemText}>检查更新</Text>
                  <Text style={styles.settingSubText}>当前版本: v{bundleVersion}</Text>
                </View>
              </View>
              {isChecking ? (
                <ActivityIndicator size="small" color="#F97316" />
              ) : (
                <ChevronRight color="#555" size={18} />
              )}
            </TouchableOpacity>

            {/* 清理缓存 */}
            <TouchableOpacity style={styles.settingItem} onPress={handleClearCache} activeOpacity={0.7}>
              <View style={styles.settingItemLeft}>
                <Trash2 color="#aaa" size={18} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.settingItemText}>清理本地播放缓存</Text>
                  <Text style={styles.settingSubText}>清理历史播放与输入记录</Text>
                </View>
              </View>
              <ChevronRight color="#555" size={18} />
            </TouchableOpacity>
            
            {/* 关于 */}
            <TouchableOpacity style={styles.settingItem} onPress={handleAbout} activeOpacity={0.7}>
              <View style={styles.settingItemLeft}>
                <Info color="#aaa" size={18} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.settingItemText}>关于 异起看</Text>
                  <Text style={styles.settingSubText}>v{bundleVersion} (底包 v{baseVersion})</Text>
                </View>
              </View>
              <ChevronRight color="#555" size={18} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#18181c',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    minHeight: 380,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 26,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  userInfoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  nameDisplayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  usernameText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  editNameContainer: {
    marginBottom: 6,
    width: '65%',
  },
  nameInput: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: '#F97316',
    paddingBottom: 4,
  },
  userDescText: {
    color: '#777',
    fontSize: 12,
  },
  settingsList: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingItemText: {
    color: '#eee',
    fontSize: 14.5,
    fontWeight: '500',
  },
  settingSubText: {
    color: '#777',
    fontSize: 11.5,
    marginTop: 2,
  },
});
