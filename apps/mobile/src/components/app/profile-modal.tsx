import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, Linking, Platform, Image, Switch, ScrollView, Keyboard, KeyboardAvoidingView } from 'react-native';
import { X, User, Trash2, Info, ChevronRight, ChevronLeft, Edit2, Settings2, History, MessageCircle, SlidersHorizontal, HardDrive, UserRoundMinus, Flag, RefreshCw, FileText, ShieldCheck, ExternalLink, Copy } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPublicUserId, type ProfileAvatar } from '@yiqikan/shared';
import { refreshAccountProfile, saveAccountProfile, uploadProfileAvatar, useAccountProfile } from '../../services/account-auth';
import { useRoomStore } from '../../store/useRoomStore';
import { socketService } from '../../services/socket';
import { otaService } from '../../services/ota-service';
import { ConfirmDialog, ConfirmDialogProps } from './confirm-dialog';

import { openSafetyPanel } from './safety-sheet';
import { mobileTelemetry } from '../../services/telemetry';
import { openAppUpdate } from '../../services/app-update';
import { selectProfileAvatar } from '../../services/avatar-selection';
import { newFeedbackRequestId } from '../../services/help-feedback';
import { resolveWebUrl } from '../../services/environment';
import { avatarImageUrl } from '../../utils/profile-avatar';
import { HelpCenter } from './help-center';
import { ProfileAvatarView, ProfileHeader, ProfileRow, profileStyles as ps } from './profile-ui';

const USERNAME_CACHE_KEY = '@yiqikan_username';

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  embedded?: boolean;
  active?: boolean;
  onOpenHistory?: () => void;
  onBackHandlerChange?: (handler: (() => boolean) | null) => void;
  onForceUpdate?: (info: { releaseNotes: string; downloadUrl: string }) => void;
}

export function ProfileModal({ visible, onClose, onForceUpdate, embedded = false, active = visible, onOpenHistory, onBackHandlerChange }: ProfileModalProps) {
  const insets = useSafeAreaInsets();
  const profileScroll = useRef<ScrollView | null>(null);
  const nicknameY = useRef(0);
  const nicknameFocused = useRef(false);
  const revealNickname = () => {
    if (nicknameFocused.current) profileScroll.current?.scrollTo({ y: Math.max(0, nicknameY.current - 16), animated: true });
  };
  const [section, setSection] = useState<'home'|'edit'|'help'|'settings'|'security'|'storage'>('home');
  const [pickingAvatar,setPickingAvatar] = useState(false);
  const [avatarImage,setAvatarImage] = useState<string|null>(null);
  const [avatarId,setAvatarId] = useState<string|null>(null);
  const uploadId = useRef('');
  const editSession = useRef(0);
  const saveInFlight = useRef(false);
  const pickInFlight = useRef(false);
  const mounted = useRef(true);
  const profileVisible = useRef(visible && active);
  profileVisible.current = visible && active;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; editSession.current++; }; }, []);
  const [avatar, setAvatar] = useState<ProfileAvatar>('yi');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const helpBack = useRef<(() => boolean) | null>(null);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [username, setUsername] = useState('未设置昵称');
  const [editName, setEditName] = useState('');
  const [bundleVersion, setBundleVersion] = useState('1.12.0');
  const [isChecking, setIsChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadTip, setDownloadTip] = useState('');
  const [isViewingAbout, setIsViewingAbout] = useState(false);
  const [isViewingPrivacy, setIsViewingPrivacy] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<Partial<ConfirmDialogProps> | null>(null);
  const roomState = useRoomStore((state) => state.roomState);
  const isConnected = useRoomStore((state) => state.isConnected);
  const errorCode = useRoomStore((state) => state.errorCode);
  const account = useAccountProfile((state) => state.summary);
  const accountLoading = useAccountProfile((state) => state.loading);
  const accountError = useAccountProfile((state) => state.error);
  const accountCached = useAccountProfile((state) => state.cached);
  const restriction = account?.restriction;
  const restrictionActive = restriction && restriction.until > Date.now();
  const accountRestricted = account?.disabled || account?.deviceRevoked || restrictionActive;
  const legacyId = !account ? socketService?.getUserId?.() : null;
  const legacyFeedbackId = legacyId && /^safe:[a-f0-9]{64}$/.test(legacyId) ? legacyId : null;
  useEffect(() => {
    if (account?.profileUpdatedAt && account.nickname) {
      setUsername(account.nickname);
      void AsyncStorage.setItem(USERNAME_CACHE_KEY, account.nickname).catch(() => {});
    }
  }, [account?.profileUpdatedAt, account?.nickname]);
  const refreshProfile = () => {
    void AsyncStorage.getItem('@yiqikan_safety_token')
      .then(token => refreshAccountProfile(token))
      .catch(() => {
        if (!useAccountProfile.getState().error) useAccountProfile.setState({
          error: '读取账号信息失败，请点击刷新重试', cached: Boolean(useAccountProfile.getState().summary),
        });
      });
  };
  const feedbackInfo = () => [
    '异起看帮助与反馈',
    `用户编号：${account ? formatPublicUserId(account.publicId) : '尚未生成'}`,
    ...(legacyFeedbackId ? [`旧版房间身份：${legacyFeedbackId}`] : []),
    `平台：${Platform.OS}`,
    `App 版本：${Constants.nativeAppVersion || Constants.expoConfig?.version || '未知'}`,
    `热更新版本：${bundleVersion}`,
    `错误码：${errorCode || '无'}`,
    accountCached ? '账号状态：待联网确认' : `账号状态：${account?.disabled ? '已停用' : account?.deviceRevoked ? '设备已撤销' : restrictionActive ? restriction.action === 'ban' ? '临时封禁' : '禁言' : account ? '正常' : '未获取'}`,
    '问题描述：',
  ].join('\n');
  const copyAccountInfo = async (feedback = false) => {
    try {
      if (!feedback && !account) return;
      await Clipboard.setStringAsync(feedback ? feedbackInfo() : formatPublicUserId(account!.publicId));
      useRoomStore.getState().showToast(feedback ? '反馈信息已复制，可私信给开发者并补充问题' : '用户编号已复制');
    } catch { useRoomStore.getState().showToast('复制失败，请重试'); }
  };

  useEffect(() => {
    if (visible && active) refreshProfile();
  }, [visible, active, isConnected, errorCode]);

  useEffect(() => {
    if (!visible || !active || section !== 'edit') return;
    const shown = Keyboard.addListener('keyboardDidShow', revealNickname);
    return () => { shown.remove(); nicknameFocused.current = false; };
  }, [visible, active, section]);

  const handleBack = () => {
    if (section === 'help' && helpBack.current?.()) return true;
    if (isViewingPrivacy) { setIsViewingPrivacy(false); return true; }
    if (isViewingAbout) { setIsViewingAbout(false); return true; }
    if (section !== 'home') { if (section === 'edit') { editSession.current++; nicknameFocused.current = false; Keyboard.dismiss(); } setSection(section === 'storage' ? 'settings' : 'home'); return true; }
    return false;
  };
  useEffect(() => {
    if (!embedded || !active || !onBackHandlerChange) return;
    onBackHandlerChange(handleBack);
    return () => onBackHandlerChange(null);
  }, [embedded, active, section, isViewingPrivacy, isViewingAbout, onBackHandlerChange]);

  const showConfirm = (opts: Omit<ConfirmDialogProps, 'visible' | 'onConfirm' | 'onCancel'> & { onConfirm?: () => void | Promise<void>; onCancel?: () => void }) => {
    setDialogConfig(opts);
  };

  const showAlert = (opts: Omit<ConfirmDialogProps, 'visible' | 'cancelText' | 'onConfirm' | 'onCancel'> & { onConfirm?: () => void | Promise<void> }) => {
    setDialogConfig({ ...opts, cancelText: null });
  };

  useEffect(() => {
    if (visible && active) {
      mobileTelemetry.getEnabled().then(setAnalyticsEnabled);
      AsyncStorage.getItem(USERNAME_CACHE_KEY).then((name) => {
        if (name && !useAccountProfile.getState?.().summary?.profileUpdatedAt) setUsername(name);
      });
      otaService.getCurrentBundleVersion().then((v) => {
        setBundleVersion(v);
      });
      if (!embedded) {
        setSection('home');
        setIsViewingAbout(false);
        setIsViewingPrivacy(false);
        setDownloadProgress(null);
        setDownloadTip('');
      }
    }
  }, [visible, active, embedded]);

  useEffect(()=>{if(section!=='edit'||!active||!visible){editSession.current++;setPickingAvatar(false);setAvatarImage(null);}},[section,active,visible]);
  const chooseAvatar = async () => {
    if (pickInFlight.current || saveInFlight.current) return;
    const ticket = editSession.current;
    const currentEdit = () => mounted.current && profileVisible.current && ticket === editSession.current;
    Keyboard.dismiss();
    pickInFlight.current = true;
    setPickingAvatar(true); setProfileSaveError('');
    try {
      const image = await selectProfileAvatar();
      if (currentEdit() && image) { setAvatarImage(image); uploadId.current = newFeedbackRequestId(); }
    } catch (error) {
      if (currentEdit()) setProfileSaveError(error instanceof Error ? error.message : '无法选择照片，请重试或更新安装包');
    } finally { pickInFlight.current = false; if (mounted.current) setPickingAvatar(false); }
  };
  const handleSaveName = async () => {
    if (saveInFlight.current || pickInFlight.current) return;
    if (!editName.trim() || editName.trim().length > 30) { setProfileSaveError('请填写 1 至 30 字的昵称'); return; }
    const ticket = editSession.current;
    const currentEdit = () => mounted.current && profileVisible.current && ticket === editSession.current;
    Keyboard.dismiss();
    saveInFlight.current = true;
    setSavingProfile(true); setProfileSaveError('');
    try {
      const selectedId=avatarImage ? (await uploadProfileAvatar(avatarImage,uploadId.current)).avatarId : avatarId;
      await saveAccountProfile(editName.trim(), avatar, selectedId);
      if (mounted.current) setUsername(editName.trim());
      try { await AsyncStorage.setItem(USERNAME_CACHE_KEY, editName.trim()); } catch { useRoomStore.getState().showToast('资料已保存，本地缓存失败，请联网刷新'); }
      if (roomState) socketService.updateMemberName(roomState.id, editName.trim());
      // A committed save still updates the account, but may not redirect a newer page or draft.
      if (currentEdit()) setSection('home');
    } catch (error) { if (currentEdit()) setProfileSaveError(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { saveInFlight.current = false; if (mounted.current) setSavingProfile(false); }
  };
  const handleClearRecords = (kind: 'cache'|'history'|'input') => {
    const title = kind === 'history' ? '清空观看历史' : kind === 'input' ? '清空输入记录' : '清理首页配置缓存';
    showConfirm({ title, message: kind === 'history' ? '清除本机观看记录后无法恢复。保留昵称、账号身份和其他设置。' : kind === 'input' ? '仅清除本机搜索和地址输入记录，保留观看历史。' : '下次联网会重新获取首页配置。保留观看历史、昵称和账号身份。',
      confirmText: '确认清除', cancelText: '取消', type: 'danger', icon: 'alert', onConfirm: async () => {
        try {
          if (kind === 'cache') {
            const keys = await AsyncStorage.getAllKeys();
            await AsyncStorage.multiRemove(keys.filter(key => key === '@recommend_sites' || key.startsWith('@recommend_sites:') || key.startsWith('@search_template:')));
          } else await AsyncStorage.removeItem(kind === 'history' ? '@yiqikan_playback_history' : '@recent_url');
          useRoomStore.getState().showToast('已清除');
        } catch { useRoomStore.getState().showToast('清除失败，请重试'); }
      } });
  };

  const handleCheckUpdate = async () => {
    if (isChecking || downloadProgress !== null) return;
    if (otaService.isDownloading()) {
      useRoomStore.getState().showToast('更新正在后台下载，请稍后再检查');
      return;
    }
    if (!otaService.beginUpdateFlow()) {
      useRoomStore.getState().showToast('正在检查更新，请稍后再试');
      return;
    }
    setIsChecking(true);
    try {
      const res = await otaService.checkUpdate();
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion) {
        try {
          setDownloadTip('正在下载更新');
          setDownloadProgress(0);

          await otaService.downloadAndApply(
            res.bundleUrl!,
            res.latestBundleVersion!,
            res.bundleHash,
            (p) => setDownloadProgress(p)
          );

          setDownloadProgress(null);

          otaService.markRestartPromptShown(res.latestBundleVersion);
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
          setDownloadProgress(null);
        }
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
      otaService.endUpdateFlow();
    }
  };

  const handleAbout = () => {
    setIsViewingAbout(true);
  };

  const handleDataRequest = async () => {
    try {
      const statisticsId = await AsyncStorage.getItem('@yiqikan_telemetry_distinct_id');
      showAlert({ title: '隐私与数据请求', message: `如需查询、更正或删除服务端数据，请联系 858536121@qq.com，并提供以下标识以便核实。请勿发送房间密码或身份密钥。\n\n用户编号：${account ? formatPublicUserId(account.publicId) : '尚未生成，请联网刷新'}${legacyFeedbackId ? `\n旧版房间身份：${legacyFeedbackId}` : ''}\n统计标识：${statisticsId || '尚未生成'}\n\n用户编号仅用于定位，涉及数据操作时还需核验账号归属。关闭使用统计会停止后续上传；本地播放缓存清理不等于删除服务端数据。`, confirmText: '知道了', type: 'info', icon: 'info' });
    } catch {
      useRoomStore.getState().showToast('读取数据标识失败，请重试');
    }
  };

  const AboutContainer = embedded ? ScrollView : View;
  const content = (
    <>
      <View style={[styles.overlay, embedded && styles.pageOverlay]}>
        <View style={[styles.modalContent, embedded && styles.pageContent, !embedded && section === 'edit' && styles.editModalContent]}>
          {isViewingPrivacy ? (
            <View style={embedded ? styles.pageBody : { flexShrink: 1 }}>
              <View style={styles.header}>
                <TouchableOpacity onPress={() => setIsViewingPrivacy(false)} style={styles.backBtn}
                  testID="privacy-settings-back-btn" accessibilityLabel="返回设置" activeOpacity={0.7}>
                  <ChevronLeft color="#F97316" size={20} />
                  <Text style={styles.backBtnText}>设置</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>隐私与数据</Text>
                <TouchableOpacity onPress={onClose} style={[styles.closeBtn, embedded && styles.hiddenClose]}
                  testID="profile-modal-close-btn" accessibilityLabel="关闭个人中心">
                  <X color="#aaa" size={22} />
                </TouchableOpacity>
              </View>
              <ScrollView style={[styles.settingsList, embedded && styles.pageSettingsList]}>
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
            <AboutContainer style={embedded ? styles.pageBody : undefined}>
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
                  style={[styles.closeBtn, embedded && styles.hiddenClose]}
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
            </AboutContainer>
          ) : (
            <View style={embedded || section === 'edit' ? styles.pageBody : { flexShrink: 1 }}>
              {section === 'help' ? <View style={{flex:1,marginHorizontal:-20}}><HelpCenter key={account?.userId ?? 'unidentified'} active={visible && active} accountId={account?.userId ?? null} bundleVersion={bundleVersion} errorCode={errorCode}
                onBack={() => setSection('home')} onBackHandlerChange={handler => { helpBack.current = handler; }} copyFeedback={() => void copyAccountInfo(true)}/></View> : <>
              {section === 'home' ? <View style={styles.homeHeader}><Text style={ps.title}>我的</Text><TouchableOpacity accessibilityLabel="打开设置" testID="btn-profile-settings" onPress={() => setSection('settings')} style={{padding:12}}><SlidersHorizontal color="#c1c3bd" size={22}/></TouchableOpacity></View>
                : <ProfileHeader title={{edit:'编辑资料',settings:'设置',security:'隐私与安全',storage:'存储与记录'}[section]} onBack={handleBack}
                  action={section === 'edit' ? <TouchableOpacity disabled={savingProfile||pickingAvatar} testID="btn-save-profile" onPress={() => void handleSaveName()} style={{padding:12}}><Text style={ps.linkText}>{savingProfile?'保存中…':'保存'}</Text></TouchableOpacity> : undefined}/>}
              <ScrollView ref={profileScroll} testID="profile-content-scroll" style={embedded || section === 'edit' ? {flex:1} : undefined} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onLayout={revealNickname} contentContainerStyle={{paddingBottom:28}}>
              {section === 'home' && <>
                <View style={styles.compactProfile}>
                  <TouchableOpacity testID="btn-edit-profile" accessibilityLabel="编辑个人资料" onPress={() => {editSession.current++;setEditName(username);setAvatar(account?.avatar ?? 'yi');setAvatarId(account?.avatarId??null);setAvatarImage(null);setProfileSaveError('');setSection('edit');}} style={{flexDirection:'row',alignItems:'center',gap:14,flex:1}}>
                    <ProfileAvatarView avatar={account?.avatar} name={username} imageUri={avatarImageUrl(account?.avatarPath,resolveWebUrl())}/><View style={{flex:1}}><Text style={styles.compactName}>{username}</Text><Text style={ps.caption}>编辑个人资料</Text></View>
                  </TouchableOpacity>
                  <ChevronRight size={19} color="#747971"/>
                </View>
                <View style={styles.compactId}>
                  <TouchableOpacity testID="btn-copy-user-id" accessibilityLabel="复制用户编号" disabled={!account} onPress={() => void copyAccountInfo()} style={{flexDirection:'row',alignItems:'center',gap:7,paddingVertical:8,flexShrink:1}}>
                    <Text style={styles.accountIdText}>{account ? `用户编号：${formatPublicUserId(account.publicId)}` : accountLoading ? '正在获取用户编号…' : '用户编号尚未生成'}</Text>{account&&<Copy size={13} color="#a0a39b"/>}
                  </TouchableOpacity>
                  {(!account || accountCached || accountError)&&<TouchableOpacity testID="btn-refresh-account" accessibilityLabel="刷新账号状态" disabled={accountLoading} onPress={refreshProfile} style={{padding:10}}>{accountLoading?<ActivityIndicator size="small" color="#a0a39b"/>:<RefreshCw size={15} color="#a0a39b"/>}</TouchableOpacity>}
                </View>
                {accountCached&&<Text style={ps.caption}>编号已保存，账号状态待联网确认</Text>}
                {!accountCached&&accountRestricted&&<View style={ps.warning}>
                  <Text testID="account-restriction-summary" style={ps.text}>{[account?.disabled?'账号已停用':'',account?.deviceRevoked?'当前设备已撤销':'',restrictionActive?`${restriction.action==='ban'?'临时封禁':'禁言'}至 ${new Date(restriction.until).toLocaleString('zh-CN')}`:''].filter(Boolean).join(' · ')}</Text>
                  <Text style={ps.caption}>仍可查看记录、提交问题和联系开发者复核。</Text><TouchableOpacity style={ps.link} testID="btn-account-review" onPress={()=>setSection('help')}><Text style={ps.linkText}>查看帮助与申请复核</Text></TouchableOpacity>
                </View>}
                {accountError&&<Text testID="account-profile-error" style={ps.error}>{accountError}，可点击刷新重试</Text>}
                <Text style={ps.label}>我的观看</Text><View style={ps.group}><ProfileRow testID="观看历史入口" title="观看历史" subtitle="找回上次看过的内容" icon={History} onPress={()=>onOpenHistory?.()} disabled={!onOpenHistory}/></View>
                <Text style={ps.label}>支持与设置</Text><View style={ps.group}><ProfileRow title="帮助与反馈" subtitle="遇到问题，在这里告诉我们" icon={MessageCircle} testID="btn-help-center" onPress={()=>setSection('help')}/><ProfileRow title="隐私与安全" icon={ShieldCheck} testID="btn-profile-security" onPress={()=>setSection('security')}/><ProfileRow title="设置" icon={SlidersHorizontal} onPress={()=>setSection('settings')}/></View>
                <Text style={styles.brandFoot}>异起看 · 好时光，一起看</Text>
              </>}
              {section === 'edit' && <>
                <View style={{alignItems:'center',paddingVertical:22}}><ProfileAvatarView avatar={avatar} name={editName||username} imageUri={avatarImage ? `data:image/jpeg;base64,${avatarImage}` : avatarId ? avatarImageUrl(`/api/client-avatar/image/${avatarId}`,resolveWebUrl()) : null}/><Text style={[ps.caption,{marginTop:14}]}>{avatarImage||avatarId?'照片头像':'默认使用昵称最后一个字'}</Text></View>
                <TouchableOpacity accessibilityLabel="从相册选择头像" testID="btn-pick-avatar" disabled={savingProfile||pickingAvatar} onPress={()=>void chooseAvatar()} style={ps.secondary}><Text style={ps.text}>{pickingAvatar?'正在选择照片…':'从相册选择头像'}</Text></TouchableOpacity>
                {(avatarImage||avatarId)&&<TouchableOpacity testID="btn-reset-avatar" disabled={savingProfile||pickingAvatar} onPress={()=>{setAvatarImage(null);setAvatarId(null);}} style={ps.link}><Text style={ps.linkText}>恢复昵称头像</Text></TouchableOpacity>}
                <Text style={ps.caption}>选择照片后可调整裁剪；点击保存才会上传并同步给房间成员。</Text>
                <Text style={[ps.label,{marginTop:4}]}>昵称</Text><TextInput testID="profile-nickname" accessibilityLabel="昵称" style={ps.input} value={editName} editable={!savingProfile&&!pickingAvatar} maxLength={30} onLayout={event => { nicknameY.current = event.nativeEvent.layout.y; revealNickname(); }} onFocus={() => { nicknameFocused.current = true; revealNickname(); }} onBlur={() => { nicknameFocused.current = false; }} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} onChangeText={setEditName} placeholder="给自己取个昵称" placeholderTextColor="#858980"/>
                <Text style={ps.caption}>保存后同步到账号和房间。受限账号请先联系开发者复核。</Text>
                {profileSaveError&&<Text role="alert" style={ps.error}>{profileSaveError}</Text>}
                <TouchableOpacity testID="btn-copy-user-id" accessibilityLabel="复制用户编号" disabled={!account} onPress={()=>void copyAccountInfo()} style={{paddingVertical:22}}><Text style={ps.caption}>{account?`用户编号：${formatPublicUserId(account.publicId)}`:'用户编号尚未生成'}</Text></TouchableOpacity>
              </>}
              {section === 'settings' && <><Text style={ps.label}>使用偏好</Text><View style={ps.group}><ProfileRow title="存储与记录" subtitle="缓存和观看历史分开管理" icon={HardDrive} testID="btn-profile-storage" onPress={()=>setSection('storage')}/><ProfileRow title="使用统计与数据" icon={ShieldCheck} testID="btn-privacy-settings" onPress={()=>setIsViewingPrivacy(true)}/></View><Text style={ps.label}>应用信息</Text><View style={ps.group}><ProfileRow testID="btn-check-update" title="检查更新" subtitle={downloadProgress!==null ? `${downloadTip||'正在下载'} ${downloadProgress}%` : `当前版本 v${bundleVersion}`} meta={isChecking?'检查中…':undefined} icon={RefreshCw} disabled={isChecking||downloadProgress!==null} onPress={()=>void handleCheckUpdate()}/><ProfileRow title="关于 异起看" subtitle="应用信息与协议" icon={Info} onPress={handleAbout}/></View></>}
              {section === 'security' && <><Text style={ps.label}>互动管理</Text><View style={ps.group}><ProfileRow title="已屏蔽成员" icon={UserRoundMinus} onPress={()=>{onClose();setTimeout(()=>openSafetyPanel({mode:'blocks'}),400);}}/><ProfileRow title="我的举报" icon={Flag} onPress={()=>{onClose();setTimeout(()=>openSafetyPanel({mode:'reports'}),400);}}/></View><Text style={ps.label}>账号与数据</Text><View style={ps.group}><ProfileRow title="账号问题与复核" icon={MessageCircle} onPress={()=>setSection('help')}/><ProfileRow title="使用统计与数据" icon={ShieldCheck} testID="btn-privacy-settings" onPress={()=>setIsViewingPrivacy(true)}/></View></>}
              {section === 'storage' && <><Text style={ps.label}>可重新获取的内容</Text><View style={ps.group}><ProfileRow title="清理首页配置缓存" subtitle="联网后重新获取，保留观看历史和身份" testID="btn-clear-cache" icon={HardDrive} onPress={()=>handleClearRecords('cache')}/></View><Text style={ps.label}>个人记录</Text><View style={ps.group}><ProfileRow title="清空观看历史" subtitle="仅清除本机观看记录，无法恢复" testID="btn-clear-history" icon={History} onPress={()=>handleClearRecords('history')}/><ProfileRow title="清空输入记录" subtitle="仅清除本机搜索和地址输入记录" testID="btn-clear-input" icon={Trash2} onPress={()=>handleClearRecords('input')}/></View></>}
              </ScrollView>
              </>}

            </View>
          )}
        </View>
      </View>

        <ConfirmDialog
          visible={Boolean(dialogConfig)}
          useNativeModal={embedded}
          title={dialogConfig?.title || ''}
          message={dialogConfig?.message}
          confirmText={dialogConfig?.confirmText || '确定'}
          cancelText={dialogConfig?.cancelText}
          type={dialogConfig?.type || 'warning'}
          icon={dialogConfig?.icon || 'alert'}
          confirmTestID={dialogConfig?.confirmTestID}
          cancelTestID={dialogConfig?.cancelTestID}
          onConfirm={async () => {
            const fn = dialogConfig?.onConfirm;
            setDialogConfig(null);
            if (fn) await fn();
          }}
          onCancel={() => {
            const fn = dialogConfig?.onCancel;
            setDialogConfig(null);
            if (fn) fn();
          }}
        />
    </>
  );
  // Resize only this module; the persistent watching WebView keeps its original bounds.
  const keyboardContent = <KeyboardAvoidingView testID="profile-keyboard-avoidance" style={{flex:1}} enabled={visible && active && section === 'edit'} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>{content}</KeyboardAvoidingView>;
  return embedded ? <View style={{ flex: 1 }}>{keyboardContent}</View> : (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!handleBack()) onClose(); }}>{keyboardContent}</Modal>
  );
}

const styles = StyleSheet.create({
  homeHeader: {flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12},
  compactProfile: {flexDirection:'row',alignItems:'center',paddingTop:12,gap:10},
  compactName: {color:'#f0efeb',fontSize:20,fontWeight:'600'},
  compactId: {flexDirection:'row',alignItems:'center',paddingLeft:78,marginTop:2,marginBottom:4},
  brandFoot: {color:'#858980',fontSize:11,letterSpacing:1.4,textAlign:'center',marginTop:34,marginBottom:15},
  pageOverlay: { backgroundColor: '#111214', justifyContent: 'flex-start' },
  pageContent: { flex: 1, minHeight: 0, maxHeight: '100%', borderRadius: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderWidth: 0, backgroundColor: '#111214', padding: 20 },
  pageBody: { flex: 1 },
  editModalContent: {height:'90%',minHeight:0,maxHeight:'100%'},
  pageTitle: { fontSize: 24, fontWeight: '600' },
  pageSettingsList: { flex: 1, maxHeight: '100%' },
  hiddenClose: { display: 'none' },
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
  accountIdRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, maxWidth: '100%' },
  accountIdCopy: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, paddingVertical: 8 },
  accountIdText: { color: '#bbb', fontSize: 12, flexShrink: 1, fontVariant: ['tabular-nums'] },
  accountWarning: { color: '#fb923c', fontSize: 11, marginTop: 6, textAlign: 'center', lineHeight: 17 },
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
