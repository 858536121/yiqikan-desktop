import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, Linking, Platform, Image, Switch, ScrollView } from 'react-native';
import { X, User, Trash2, Info, ChevronRight, ChevronLeft, Edit2, Sparkles, RefreshCw, FileText, ShieldCheck, ExternalLink } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoomStore } from '../../store/useRoomStore';
import { socketService } from '../../services/socket';
import { otaService } from '../../services/ota-service';
import { ConfirmDialog, ConfirmDialogProps } from './confirm-dialog';

import { openSafetyPanel } from './safety-sheet';
import { mobileTelemetry } from '../../services/telemetry';
import { openAppUpdate } from '../../services/app-update';

const USERNAME_CACHE_KEY = '@yiqikan_username';

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  onForceUpdate?: (info: { releaseNotes: string; downloadUrl: string }) => void;
}

export function ProfileModal({ visible, onClose, onForceUpdate }: ProfileModalProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [username, setUsername] = useState('未设置昵称');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [bundleVersion, setBundleVersion] = useState('1.12.0');
  const [isChecking, setIsChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadTip, setDownloadTip] = useState('');
  const [isViewingAbout, setIsViewingAbout] = useState(false);
  const [isViewingPrivacy, setIsViewingPrivacy] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<Partial<ConfirmDialogProps> | null>(null);
  const roomState = useRoomStore((state) => state.roomState);

  const showConfirm = (opts: Omit<ConfirmDialogProps, 'visible' | 'onConfirm' | 'onCancel'> & { onConfirm?: () => void | Promise<void>; onCancel?: () => void }) => {
    setDialogConfig(opts);
  };

  const showAlert = (opts: Omit<ConfirmDialogProps, 'visible' | 'cancelText' | 'onConfirm' | 'onCancel'> & { onConfirm?: () => void | Promise<void> }) => {
    setDialogConfig({ ...opts, cancelText: null });
  };

  useEffect(() => {
    if (visible) {
      mobileTelemetry.getEnabled().then(setAnalyticsEnabled);
      AsyncStorage.getItem(USERNAME_CACHE_KEY).then((name) => {
        if (name) setUsername(name);
      });
      otaService.getCurrentBundleVersion().then((v) => {
        setBundleVersion(v);
      });
      setIsEditing(false);
      setIsViewingAbout(false);
      setIsViewingPrivacy(false);
      setDownloadProgress(null);
      setDownloadTip('');
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
    showConfirm({
      title: '清理缓存',
      message: '确定要清理本地播放与历史缓存吗？（保留昵称、房间身份和隐私选择）',
      confirmText: '确定清理',
      cancelText: '取消',
      type: 'danger',
      icon: 'alert',
      onConfirm: async () => {
        try {
          await AsyncStorage.multiRemove(['@yiqikan_playback_history', '@recent_url', '@recommend_sites']);
          useRoomStore.getState().showToast('本地缓存已清理完毕');
        } catch (e) {
          useRoomStore.getState().showToast('清理失败，请重试');
        }
      },
    });
  };

  const handleCheckUpdate = async () => {
    if (isChecking || downloadProgress !== null) return;
    if (otaService.isDownloading()) {
      useRoomStore.getState().showToast('更新正在后台下载，请稍后再检查');
      return;
    }
    setIsChecking(true);
    try {
      const res = await otaService.checkUpdate();
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion) {
        showConfirm({
          title: '发现新版本',
          message: `新版本 v${res.latestBundleVersion}\n\n更新说明：${res.releaseNotes || '性能优化与体验改进'}\n\n是否立即下载更新？`,
          confirmText: '立即下载更新',
          cancelText: '稍后',
          type: 'info',
          icon: 'info',
          onConfirm: async () => {
            try {
              setIsChecking(true);
              setDownloadTip('正在下载更新');
              setDownloadProgress(0);

              await otaService.downloadAndApply(
                res.bundleUrl!,
                res.latestBundleVersion!,
                res.bundleHash,
                (p) => setDownloadProgress(p)
              );

              setDownloadProgress(null);

              showConfirm({
                title: '更新已就绪',
                message: `新版本 v${res.latestBundleVersion} 已下载就绪，是否立即重启应用生效？`,
                confirmText: '立即重启',
                cancelText: '稍后生效',
                type: 'info',
                icon: 'info',
                onConfirm: async () => {
                  try {
                    await otaService.reloadApp();
                  } catch (error: any) {
                    showAlert({
                      title: '自动重启失败',
                      message: `更新已下载，请关闭并重新打开应用使更新生效。\n${error?.message || ''}`,
                      confirmText: '知道了', type: 'warning', icon: 'alert',
                    });
                  }
                },
              });
            } catch (err: any) {
              showAlert({
                title: '下载失败',
                message: err?.message || '下载更新失败',
                type: 'danger',
                icon: 'alert',
              });
            } finally {
              setIsChecking(false);
              setDownloadProgress(null);
            }
          },
        });
      } else if (res.status === 'APP_UPDATE_REQUIRED') {
        if (res.forceAppUpdate && onForceUpdate) {
          // 强制更新：通知父组件显示全屏遮罩
          onForceUpdate({
            releaseNotes: res.releaseNotes || '当前版本已不再支持，请更新至最新版本以继续使用。',
            downloadUrl: res.appDownloadUrl || '',
          });
          onClose();
        } else {
          // 非强制：支持应用内一键下载并自动调起安装
          showConfirm({
            title: '发现新版本',
            message: res.releaseNotes || '请更新至最新版本 App 以获得完整功能支持。',
            confirmText: Platform.OS === 'ios' ? '前往 App Store' : '立即更新',
            cancelText: '稍后',
            type: 'info',
            icon: 'info',
            onConfirm: async () => {
              if (Platform.OS === 'android' && res.appDownloadUrl) {
                try {
                  setIsChecking(true);
                  setDownloadTip('正在下载安装包');
                  setDownloadProgress(0);

                  await otaService.downloadAndInstallApk(res.appDownloadUrl, (p) => {
                    setDownloadProgress(p);
                  });
                } catch (err: any) {
                  showConfirm({
                    title: '应用内下载失败',
                    message: '未能自动调起安装，是否前往浏览器下载？',
                    confirmText: '在浏览器中打开',
                    cancelText: '取消',
                    type: 'warning',
                    icon: 'alert',
                    onConfirm: () => {
                      Linking.openURL(res.appDownloadUrl!).catch(() => {});
                    },
                  });
                } finally {
                  setIsChecking(false);
                  setDownloadProgress(null);
                }
              } else {
                openAppUpdate(res.appDownloadUrl).catch(error => useRoomStore.getState().showToast(error.message));
              }
            },
          });
        }
      } else if (res.status === 'UP_TO_DATE') {
        showAlert({
          title: '版本检查',
          message: `当前已是最新版本 (v${bundleVersion})，无需更新。`,
          confirmText: '我知道了',
          type: 'info',
          icon: 'info',
        });
      } else {
        showAlert({
          title: '检查失败',
          message: res.error || '无法连接到更新服务器',
          type: 'warning',
          icon: 'alert',
        });
      }
    } catch (e: any) {
      showAlert({
        title: '检查失败',
        message: e?.message || '检查更新失败',
        type: 'warning',
        icon: 'alert',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleAbout = () => {
    setIsViewingAbout(true);
  };

  const handleDataRequest = async () => {
    try {
      const statisticsId = await AsyncStorage.getItem('@yiqikan_telemetry_distinct_id');
      showAlert({ title: '隐私与数据请求', message: `如需查询、更正或删除服务端数据，请联系 858536121@qq.com，并提供以下标识以便核实。请勿发送房间密码或身份密钥。\n\n房间身份：${socketService.getUserId() || '尚未连接'}\n统计标识：${statisticsId || '尚未生成'}\n\n关闭使用统计会停止后续上传；本地播放缓存清理不等于删除服务端数据。`, confirmText: '知道了', type: 'info', icon: 'info' });
    } catch {
      useRoomStore.getState().showToast('读取数据标识失败，请重试');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => isViewingPrivacy ? setIsViewingPrivacy(false) : onClose()}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {isViewingPrivacy ? (
            <View style={{ flexShrink: 1 }}>
              <View style={styles.header}>
                <TouchableOpacity onPress={() => setIsViewingPrivacy(false)} style={styles.backBtn}
                  testID="privacy-settings-back-btn" accessibilityLabel="返回设置" activeOpacity={0.7}>
                  <ChevronLeft color="#F97316" size={20} />
                  <Text style={styles.backBtnText}>设置</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>隐私与数据</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}
                  testID="profile-modal-close-btn" accessibilityLabel="关闭个人中心">
                  <X color="#aaa" size={22} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.settingsList}>
                <View style={styles.settingItem}>
                  <View style={[styles.settingItemLeft, { flex: 1 }]}>
                    <ShieldCheck color="#aaa" size={18} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Text style={styles.settingItemText}>使用统计</Text>
                      <Text style={styles.settingSubText}>用于了解使用情况和改进体验，可随时关闭</Text>
                    </View>
                  </View>
                  <Switch testID="switch-telemetry-consent" accessibilityLabel="使用统计" value={analyticsEnabled} disabled={savingConsent}
                    onValueChange={async (enabled) => {
                      setSavingConsent(true);
                      try { await mobileTelemetry.setEnabled(enabled); setAnalyticsEnabled(enabled); }
                      catch { setAnalyticsEnabled(false); useRoomStore.getState().showToast('保存失败，统计保持关闭'); }
                      finally { setSavingConsent(false); }
                    }} trackColor={{ false: '#444', true: '#F97316' }} />
                </View>
                <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://yiqikan.club/privacy').catch(() => {})}
                  activeOpacity={0.7}>
                  <Text style={styles.settingItemText}>隐私政策</Text><ExternalLink color="#555" size={15} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingItem} onPress={handleDataRequest} activeOpacity={0.7}
                  testID="btn-data-request">
                  <Text style={styles.settingItemText}>查询或删除数据</Text><ChevronRight color="#555" size={18} />
                </TouchableOpacity>
              </ScrollView>
            </View>
          ) : isViewingAbout ? (
            <View>
              {/* About Header */}
              <View style={styles.header}>
                <TouchableOpacity
                  onPress={() => setIsViewingAbout(false)}
                  style={styles.backBtn}
                  activeOpacity={0.7}
                >
                  <ChevronLeft color="#F97316" size={20} />
                  <Text style={styles.backBtnText}>设置</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>关于 异起看</Text>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.closeBtn}
                  testID="profile-modal-close-btn"
                  accessibilityLabel="关闭个人中心"
                >
                  <X color="#aaa" size={22} />
                </TouchableOpacity>
              </View>

              {/* App Hero */}
              <View style={styles.aboutHero}>
                <Image
                  source={require('../../../assets/icon.png')}
                  style={styles.aboutLogo}
                  resizeMode="contain"
                />
                <Text style={styles.aboutAppName}>异起看 YiQiKan</Text>
                <Text style={styles.aboutSlogan}>为异地陪伴而生的同步观影应用</Text>
                <View style={styles.versionBadge}>
                  <Text style={styles.versionBadgeText}>
                    v{bundleVersion}
                  </Text>
                </View>
              </View>

              {/* Compliance & External Links */}
              <View style={styles.aboutLinksList}>
                <TouchableOpacity
                  style={styles.aboutLinkItem}
                  onPress={() => Linking.openURL('https://yiqikan.club/terms').catch(() => {})}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingItemLeft}>
                    <FileText color="#F97316" size={17} />
                    <Text style={styles.aboutLinkText}>用户服务协议</Text>
                  </View>
                  <ExternalLink color="#555" size={15} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.aboutLinkItem}
                  onPress={() => Linking.openURL('https://yiqikan.club/privacy').catch(() => {})}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingItemLeft}>
                    <ShieldCheck color="#22C55E" size={17} />
                    <Text style={styles.aboutLinkText}>隐私保护政策</Text>
                  </View>
                  <ExternalLink color="#555" size={15} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.aboutLinkItem}
                  onPress={() => Linking.openURL('https://yiqikan.club').catch(() => {})}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingItemLeft}>
                    <Info color="#38BDF8" size={17} />
                    <Text style={styles.aboutLinkText}>官方网站与产品更新</Text>
                  </View>
                  <ExternalLink color="#555" size={15} />
                </TouchableOpacity>
              </View>

              {/* ICP Filing & Copyright Footer */}
              <View style={styles.aboutFooter}>
                <TouchableOpacity
                  onPress={() => Linking.openURL('https://beian.miit.gov.cn/').catch(() => {})}
                  activeOpacity={0.7}
                  style={styles.icpContainer}
                >
                  <Text style={styles.icpLabel}>工信部 APP 备案号：</Text>
                  <Text style={styles.icpText}>鲁ICP备2026053440号-2A</Text>
                </TouchableOpacity>
                <Text style={styles.copyrightText}>
                  © 2026 异起看 (YiQiKan) · 保留所有权利
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ flexShrink: 1 }}>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Sparkles size={16} color="#F97316" style={{ marginRight: 6 }} />
                  <Text style={styles.headerTitle}>个人中心 & 设置</Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.closeBtn}
                  testID="profile-modal-close-btn"
                  accessibilityLabel="关闭个人中心"
                >
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
                    onPress={() => {
                      setEditName(username);
                      setIsEditing(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.usernameText}>{username}</Text>
                    <Edit2 color="#888" size={15} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                )}

                <Text style={styles.userDescText}>点击昵称可直接修改并同步房间</Text>
              </View>

              {/* Settings List */}
              <ScrollView style={styles.settingsList}>
                {/* 检查更新 */}
                <TouchableOpacity
                  testID="btn-check-update"
                  style={styles.settingItem}
                  onPress={handleCheckUpdate}
                  activeOpacity={0.7}
                  disabled={isChecking || downloadProgress !== null}
                >
                  <View style={styles.settingItemLeft}>
                    <RefreshCw color="#F97316" size={18} />
                    <View style={{ marginLeft: 12 }}>
                      <Text style={styles.settingItemText}>检查更新</Text>
                      <Text style={styles.settingSubText}>
                        {downloadProgress !== null
                          ? `${downloadTip || '正在下载'}: ${downloadProgress}%`
                          : `当前版本: v${bundleVersion}`}
                      </Text>
                    </View>
                  </View>
                  {isChecking || downloadProgress !== null ? (
                    <ActivityIndicator size="small" color="#F97316" />
                  ) : (
                    <ChevronRight color="#555" size={18} />
                  )}
                </TouchableOpacity>
                {downloadProgress !== null && (
                  <View style={styles.inlineProgressContainer}>
                    <View style={styles.inlineProgressBar}>
                      <View
                        style={[styles.inlineProgressFill, { width: `${downloadProgress}%` }]}
                      />
                    </View>
                  </View>
                )}

                <TouchableOpacity style={styles.settingItem} onPress={() => { onClose(); setTimeout(() => openSafetyPanel({ mode: 'blocks' }), 400); }}>
                  <Text style={styles.settingItemText}>已屏蔽成员</Text><ChevronRight color="#555" size={18} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingItem} onPress={() => { onClose(); setTimeout(() => openSafetyPanel({ mode: 'reports' }), 400); }}>
                  <Text style={styles.settingItemText}>我的举报</Text><ChevronRight color="#555" size={18} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('mailto:858536121@qq.com?subject=%E5%BC%82%E8%B5%B7%E7%9C%8B%E5%B8%AE%E5%8A%A9%E4%B8%8E%E5%8F%8D%E9%A6%88').catch(() => useRoomStore.getState().showToast('请发送邮件至 858536121@qq.com'))}>
                  <Text style={styles.settingItemText}>帮助与反馈</Text><ChevronRight color="#555" size={18} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingItem} onPress={() => setIsViewingPrivacy(true)}
                  testID="btn-privacy-settings" activeOpacity={0.7}>
                  <View style={styles.settingItemLeft}>
                    <ShieldCheck color="#aaa" size={18} />
                    <Text style={[styles.settingItemText, { marginLeft: 12 }]}>隐私与数据</Text>
                  </View>
                  <ChevronRight color="#555" size={18} />
                </TouchableOpacity>
                {/* 清理缓存 */}
                <TouchableOpacity
                  testID="btn-clear-cache"
                  style={styles.settingItem}
                  onPress={handleClearCache}
                  activeOpacity={0.7}
                >
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
                <TouchableOpacity
                  style={styles.settingItem}
                  onPress={handleAbout}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingItemLeft}>
                    <Info color="#aaa" size={18} />
                    <View style={{ marginLeft: 12 }}>
                      <Text style={styles.settingItemText}>关于 异起看</Text>
                      <Text style={styles.settingSubText}>
                        v{bundleVersion}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight color="#555" size={18} />
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      {dialogConfig && (
        <ConfirmDialog
          visible={Boolean(dialogConfig)}
          useNativeModal={false}
          title={dialogConfig.title || ''}
          message={dialogConfig.message}
          confirmText={dialogConfig.confirmText || '确定'}
          cancelText={dialogConfig.cancelText}
          type={dialogConfig.type || 'warning'}
          icon={dialogConfig.icon || 'alert'}
          confirmTestID={dialogConfig.confirmTestID}
          cancelTestID={dialogConfig.cancelTestID}
          onConfirm={async () => {
            const fn = dialogConfig.onConfirm;
            setDialogConfig(null);
            if (fn) await fn();
          }}
          onCancel={() => {
            const fn = dialogConfig.onCancel;
            setDialogConfig(null);
            if (fn) fn();
          }}
        />
      )}
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
    maxHeight: '90%',
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
    maxHeight: 360,
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
  inlineProgressContainer: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'rgba(249, 115, 22, 0.04)',
  },
  inlineProgressBar: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  inlineProgressFill: {
    height: '100%',
    backgroundColor: '#F97316',
    borderRadius: 1.5,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 8,
  },
  backBtnText: {
    color: '#F97316',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 2,
  },
  aboutHero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  aboutLogo: {
    width: 60,
    height: 60,
    borderRadius: 14,
    marginBottom: 10,
  },
  aboutAppName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  aboutSlogan: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
  },
  versionBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  versionBadgeText: {
    color: '#aaa',
    fontSize: 11,
  },
  aboutLinksList: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 18,
  },
  aboutLinkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  aboutLinkText: {
    color: '#ddd',
    fontSize: 14,
    marginLeft: 10,
  },
  aboutFooter: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  icpContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingVertical: 2,
  },
  icpLabel: {
    color: '#666',
    fontSize: 11.5,
  },
  icpText: {
    color: '#F97316',
    fontSize: 11.5,
    textDecorationLine: 'underline',
  },
  copyrightText: {
    color: '#555',
    fontSize: 10.5,
  },
});
