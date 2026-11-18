import { useState } from 'react';
import { Alert } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { canRunQqLoginProbe, runQqLoginProbe } from '../../services/qq-login-probe';
import { ProfileRow } from './profile-ui';

export function QqLoginProbeRow() {
  const [busy, setBusy] = useState(false);
  if (!canRunQqLoginProbe) return null;

  async function authorize() {
    setBusy(true);
    try {
      const fingerprint = await runQqLoginProbe();
      if (fingerprint) Alert.alert('QQ 身份已验证', `联调身份指纹 ${fingerprint}`);
    } catch (error) {
      Alert.alert('QQ 联调失败', error instanceof Error ? error.message : '请重试');
    } finally {
      setBusy(false);
    }
  }

  return <ProfileRow
    title="QQ 登录联调"
    subtitle={busy ? '正在等待授权或校验' : '验证测试包的 QQ 授权回跳'}
    icon={ShieldCheck}
    disabled={busy}
    onPress={() => Alert.alert('测试 QQ 授权', '继续后 QQ SDK 会检查设备并发起授权。联调服务器只返回身份指纹。', [
      { text: '取消', style: 'cancel' },
      { text: '继续', onPress: () => void authorize() },
    ])}
  />;
}
