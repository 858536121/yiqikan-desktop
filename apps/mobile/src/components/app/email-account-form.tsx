import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import { SvgUri } from 'react-native-svg';
import { completeEmailAccountAction, loadEmailLoginCaptcha, sendEmailAccountCode, signInWithEmail, type EmailCodePurpose } from '../../services/account-auth';
import { socketService } from '../../services/socket';
import { appControlColors } from '../../theme/colors';
import { AppButton } from './app-ui';
import { profileStyles as ps } from './profile-ui';
import { accountSwitchMessage } from './qq-account-panel';

export type EmailAccountMode = 'login' | EmailCodePurpose;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const resendCooldownSeconds = 60;
const titles = { login: '邮箱登录', register: '注册账号', reset: '找回密码' };

export function EmailAccountForm({ mode, email, loginNotice, onEmailChange, onModeChange, onSignedIn }: {
  mode: EmailAccountMode;
  email: string;
  loginNotice: string;
  onEmailChange: (value: string) => void;
  onModeChange: (mode: EmailAccountMode, loginNotice?: string) => void;
  onSignedIn: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [answer, setAnswer] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<Awaited<ReturnType<typeof loadEmailLoginCaptcha>> | null>(null);
  const [loadingCaptcha, setLoadingCaptcha] = useState(true);
  const [busy, setBusy] = useState<'send' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [cooldown, setCooldown] = useState<{ email: string; until: number } | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const address = email.trim().toLowerCase();
  const validEmail = emailPattern.test(address);
  const validCaptcha = captcha && /^\d{4}$/.test(answer.trim());
  const retrySeconds = cooldown?.email === address ? resendSeconds : 0;
  const login = mode === 'login';

  const refreshCaptcha = useCallback(async () => {
    setLoadingCaptcha(true);
    setCaptcha(null);
    setAnswer('');
    try {
      const next = await loadEmailLoginCaptcha();
      if (mounted.current) setCaptcha(next);
    } catch {
      if (mounted.current) setError(message => message || '验证码加载失败，请点击重试');
    } finally {
      if (mounted.current) setLoadingCaptcha(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshCaptcha();
    return () => { mounted.current = false; };
  }, [refreshCaptcha]);

  useEffect(() => {
    if (!cooldown) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((cooldown.until - Date.now()) / 1000));
      setResendSeconds(seconds);
      if (!seconds) setCooldown(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    if (mode === 'login' || pending.current || !validEmail || !captcha || !validCaptcha || retrySeconds) return;
    pending.current = true;
    setBusy('send');
    setError('');
    Keyboard.dismiss();
    try {
      await sendEmailAccountCode({ email: address, purpose: mode, captchaToken: captcha.token, captchaAnswer: answer.trim() });
      if (mounted.current) {
        setSentTo(address);
        setResendSeconds(resendCooldownSeconds);
        setCooldown({ email: address, until: Date.now() + resendCooldownSeconds * 1000 });
      }
    } catch (cause) {
      if (mounted.current) {
        const seconds = (cause as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
        if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && seconds <= 3600) {
          setResendSeconds(seconds);
          setCooldown({ email: address, until: Date.now() + seconds * 1000 });
        }
        setError(cause instanceof Error ? cause.message : '验证码发送失败，请重试');
      }
    } finally {
      if (mounted.current) {
        await refreshCaptcha();
        if (mounted.current) setBusy(null);
      }
      pending.current = false;
    }
  }

  const canSubmit = validEmail && !!password && (login ? !!validCaptcha : /^\d{6}$/.test(code.trim()) && !!confirmation);

  async function submit() {
    if (pending.current || !canSubmit || (login && !captcha)) return;
    if (login && socketService.hasRoomActivity()) { setError(accountSwitchMessage); return; }
    if (!login && (password.length < 6 || password !== confirmation)) {
      setError(password.length < 6 ? '密码至少 6 位' : '两次输入的密码不一致');
      return;
    }
    pending.current = true;
    setBusy('submit');
    setError('');
    Keyboard.dismiss();
    try {
      if (mode === 'login' && captcha) {
        await signInWithEmail({ email: address, password, captchaToken: captcha.token, captchaAnswer: answer.trim() });
        socketService.resetForAccountChange();
        if (mounted.current) onSignedIn();
      } else if (mode !== 'login') {
        await completeEmailAccountAction(mode, { email: address, password, code: code.trim() });
        if (mounted.current) onModeChange('login', mode === 'register' ? '账号已注册，请登录。' : '密码已重置，请用新密码登录。');
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : `${titles[mode]}失败，请重试`);
        if (login) await refreshCaptcha();
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const passwordLabel = mode === 'reset' ? '新密码' : '密码';
  const fieldLabelStyle = login ? ps.label : [ps.label, styles.compactLabel];
  const passwordField = <>
    <Text style={fieldLabelStyle}>{passwordLabel}</Text>
    <TextInput testID="email-login-password" accessibilityLabel={passwordLabel} style={ps.input} secureTextEntry
      autoComplete={login ? 'current-password' : 'new-password'} maxLength={1024} editable={!busy} value={password} onChangeText={setPassword} />
  </>;

  return <>
    {login && !error && !!loginNotice && <Text accessibilityLiveRegion="polite" style={styles.success}>{loginNotice}</Text>}
    <Text style={ps.caption}>{login ? '使用异起看的邮箱账号和密码登录。' : '先输入图片验证码，再获取发到邮箱的验证码。'}</Text>
    <Text style={fieldLabelStyle}>邮箱</Text>
    <TextInput testID="email-login-address" accessibilityLabel="邮箱" style={ps.input} autoCapitalize="none" autoCorrect={false}
      autoComplete="email" keyboardType="email-address" maxLength={254} editable={!busy} value={email} onChangeText={value => {
        if (value.trim().toLowerCase() !== address) setCode('');
        onEmailChange(value);
      }} />
    {login && passwordField}
    <Text style={fieldLabelStyle}>图片验证码</Text>
    <View style={styles.inputRow}>
      <TextInput testID="email-login-captcha-answer" accessibilityLabel="图片验证码" style={[ps.input, styles.growInput]}
        keyboardType="number-pad" maxLength={4} editable={!busy && !!captcha} value={answer} onChangeText={setAnswer} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="更换验证码" testID="email-login-refresh-captcha"
        style={styles.captchaImage} disabled={!!busy || loadingCaptcha} onPress={() => { setError(''); void refreshCaptcha(); }}>
        {captcha ? <SvgUri uri={captcha.image} width="100%" height={48} /> : loadingCaptcha
          ? <ActivityIndicator color={appControlColors.accent} /> : <Text style={ps.linkText}>重新加载</Text>}
      </TouchableOpacity>
    </View>
    {!login && <>
      <Text style={fieldLabelStyle}>邮箱验证码</Text>
      <View style={styles.inputRow}>
        <TextInput testID="email-code" accessibilityLabel="邮箱验证码" style={[ps.input, styles.growInput]} keyboardType="number-pad"
          autoComplete="one-time-code" maxLength={6} editable={!busy} value={code} onChangeText={setCode} />
        <AppButton label={retrySeconds ? `${retrySeconds} 秒后重发` : '发送验证码'} testID="email-send-code" busy={busy === 'send'}
          disabled={!!busy || !validEmail || !validCaptcha || retrySeconds > 0} onPress={() => void sendCode()} />
      </View>
      {!!sentTo && address === sentTo && <Text accessibilityLiveRegion="polite" style={styles.success}>验证码已发送，请查收邮件。</Text>}
      {passwordField}
      <Text style={fieldLabelStyle}>{mode === 'reset' ? '确认新密码' : '确认密码'}</Text>
      <TextInput testID="email-confirm-password" accessibilityLabel={mode === 'reset' ? '确认新密码' : '确认密码'} style={ps.input}
        secureTextEntry autoComplete="new-password" maxLength={1024} editable={!busy} value={confirmation} onChangeText={setConfirmation} />
    </>}
    {!!error && <Text role="alert" style={ps.error}>{error}</Text>}
    <View style={ps.accountAction}><AppButton label={mode === 'reset' ? '重置密码' : titles[mode]} icon={Mail} tone="accent" testID="email-login-submit"
      busy={busy === 'submit'} disabled={!!busy || !canSubmit} onPress={() => void submit()} /></View>
    {login && <View style={styles.loginLinks}>
      <TouchableOpacity accessibilityRole="button" testID="email-open-register" style={ps.link} disabled={!!busy}
        onPress={() => onModeChange('register')}><Text style={ps.linkText}>注册账号</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="email-open-reset" style={ps.link} disabled={!!busy}
        onPress={() => onModeChange('reset')}><Text style={ps.linkText}>找回密码</Text></TouchableOpacity>
    </View>}
  </>;
}

const styles = StyleSheet.create({
  compactLabel: { marginTop: 14, marginBottom: 6 },
  inputRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  growInput: { flex: 1, minWidth: 0 },
  captchaImage: { width: 128, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  loginLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  success: { ...ps.caption, color: appControlColors.done },
});
