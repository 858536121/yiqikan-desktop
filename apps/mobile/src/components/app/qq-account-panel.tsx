import { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { LogOut, Mail } from 'lucide-react-native';
import { formatPublicUserId } from '@yiqikan/shared';
import type { QqProfilePreview } from '@yiqikan/shared/qq-login';
import { hasDeviceAuthentication, importQqProfile, signInWithQq, signOutAccount, useAccountProfile } from '../../services/account-auth';
import { authorizeQq, canUseQqLogin } from '../../services/qq-auth';
import { socketService } from '../../services/socket';
import { useRoomStore } from '../../store/useRoomStore';
import { AppButton } from './app-ui';
import { ProfileAvatarView, profileStyles as ps } from './profile-ui';

export const accountSwitchMessage = '请先退出房间，再切换账号。';
const qqLogo = require('../../../assets/qq-logo.png');

export function QqAccountPanel({ displayName, onEmail }: { displayName: string; onEmail: () => void }) {
  const account = useAccountProfile(state => state.summary);
  const inRoom = useRoomStore(state => Boolean(state.roomState));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'qq' | 'sign-out' | 'profile' | null>(null);
  const [switching, setSwitching] = useState(false);
  const [preview, setPreview] = useState<(QqProfilePreview & { accountId: string }) | null>(null);
  const pending = useRef(false);
  const signedIn = account?.profileEditable === true;
  const unavailable = Boolean(account?.disabled || account?.deviceRevoked || (account?.restriction?.action === 'ban' && account.restriction.until > Date.now()));
  const profile = preview && preview.accountId === account?.userId ? preview : null;

  async function perform(intent: 'qq' | 'sign-out') {
    if (pending.current) return;
    pending.current = true;
    setBusy(intent);
    setNotice('');
    setError('');
    setPreview(null);
    try {
      if (socketService.hasRoomActivity()) throw new Error(accountSwitchMessage);
      if (intent === 'sign-out') {
        await signOutAccount();
        socketService.resetForAccountChange();
        const room = useRoomStore.getState();
        if (room.errorCode === 'SESSION_REVOKED') room.setError(null);
        setNotice('已退出账号，当前为游客');
      } else {
        const credential = await authorizeQq();
        if (!credential) return;
        if (socketService.hasRoomActivity()) throw new Error(accountSwitchMessage);
        const { switched, account, qqProfile } = await signInWithQq(credential);
        if (switched) socketService.resetForAccountChange();
        if (qqProfile) setPreview({ ...qqProfile, accountId: account.userId });
        setNotice(qqProfile ? '已用 QQ 登录' : '已用 QQ 登录，暂未获取到 QQ 资料');
      }
      setSwitching(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作暂未完成，请重试');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function importProfile() {
    if (!profile || !account || pending.current) return;
    pending.current = true;
    setBusy('profile');
    setError('');
    try {
      if (useAccountProfile.getState().summary?.userId !== profile.accountId) throw new Error('当前账号已切换，请重新登录');
      await importQqProfile(profile.grant, displayName);
      setPreview(null);
      setNotice('已更新 QQ 资料');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'QQ 资料保存失败，请重试');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return <>
    <Text style={ps.label}>当前账号</Text>
    <View style={ps.group}>
      <View style={ps.row}><View>
        <Text style={ps.rowTitle}>{displayName}</Text>
        {account && <Text style={ps.caption}>用户编号 {formatPublicUserId(account.publicId)}</Text>}
      </View></View>
    </View>
    {(!signedIn || switching) && <>
      <Text style={ps.label}>选择登录方式</Text>
      <Text style={ps.caption}>{signedIn ? '本机的片单和观看记录会保留。' : '登录后可设置昵称和头像，本机的片单和观看记录会保留。'}</Text>
      {canUseQqLogin && <View style={ps.accountAction}><AppButton label="QQ 登录" iconImage={qqLogo} tone="accent" testID="qq-sign-in"
        busy={busy === 'qq'} disabled={busy !== null || unavailable || inRoom} onPress={() => void perform('qq')} /></View>}
      {hasDeviceAuthentication() && <View style={ps.accountAction}><AppButton label="邮箱登录" icon={Mail} tone={canUseQqLogin ? 'secondary' : 'accent'}
        testID="email-sign-in" disabled={busy !== null || unavailable || inRoom} onPress={onEmail} /></View>}
    </>}
    {signedIn && !notice && <Text style={ps.caption}>已登录</Text>}
    {profile && <>
      <Text style={ps.label}>QQ 资料</Text>
      <View style={ps.group}><View style={ps.row}>
        {profile.avatarUrl && <ProfileAvatarView size={44} name={profile.nickname ?? displayName} imageUri={profile.avatarUrl} />}
        <View style={{ flex: 1 }}><Text style={ps.rowTitle}>{profile.nickname ?? 'QQ 头像'}</Text></View>
      </View></View>
      <Text style={ps.caption}>确认后会用这些资料更新你的异起看账号。</Text>
      <View style={ps.accountAction}><AppButton label="使用 QQ 资料" tone="accent" busy={busy === 'profile'} disabled={busy !== null || unavailable}
        testID="qq-import-profile" onPress={() => void importProfile()} /></View>
      <AppButton label="保留当前资料" tone="quiet" disabled={busy !== null} onPress={() => { setPreview(null); setError(''); }} />
    </>}
    {signedIn && !profile && !switching && (canUseQqLogin || hasDeviceAuthentication()) && <View style={ps.accountAction}>
      <AppButton label="使用其他登录方式" tone="quiet" testID="account-switch" disabled={busy !== null || inRoom || unavailable}
        onPress={() => { setError(''); setSwitching(true); }} />
    </View>}
    {signedIn && <View style={ps.accountAction}><AppButton label="退出账号" icon={LogOut} tone="quiet" busy={busy === 'sign-out'}
      testID="account-sign-out" disabled={busy !== null || inRoom} onPress={() => Alert.alert('退出账号？', '退出后可以继续以游客身份使用，片单和观看记录保留在本机。', [
        { text: '取消', style: 'cancel' }, { text: '退出账号', style: 'destructive', onPress: () => void perform('sign-out') },
      ])} /></View>}
    {inRoom && <Text style={ps.caption}>{accountSwitchMessage}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={ps.caption}>{notice}</Text>}
    {!!error && <Text role="alert" style={ps.error}>{error}</Text>}
  </>;
}
