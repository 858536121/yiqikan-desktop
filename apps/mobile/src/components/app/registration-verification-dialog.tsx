import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Image, Pressable, StyleSheet, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useRegistrationVerification, loadRegistrationImage, solveRegistrationImage, finishRegistrationVerification } from '../../services/registration-verification';
import type { RegistrationImage } from '@yiqikan/shared';

export function RegistrationVerificationDialog() {
  const pending = useRegistrationVerification(s => s.pending);
  const [visible, setVisible] = useState(false), [image, setImage] = useState<RegistrationImage | null>(null);
  const [answer, setAnswer] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const completion = useRef<{ token?: string } | null>(null), revision = useRef(0);
  async function refresh() {
    if (!pending || completion.current) return;
    const current = ++revision.current; setBusy(true); setError(''); setAnswer(''); setImage(null);
    try { const next = await loadRegistrationImage(pending); if (current === revision.current) setImage(next); }
    catch (e) { if (current === revision.current) setError((e as Error).message); }
    finally { if (current === revision.current) setBusy(false); }
  }
  useEffect(() => { if (pending) { completion.current = null; setVisible(true); void refresh(); } }, [pending]);
  useEffect(() => () => { revision.current++; finishRegistrationVerification(); }, []);
  function dismissed() {
    if (!completion.current) return; const result = completion.current; completion.current = null; finishRegistrationVerification(result.token);
  }
  function finish(token?: string) {
    if (completion.current) return; revision.current++; completion.current = { token }; setVisible(false);
    if (Platform.OS !== 'ios') dismissed();
  }
  async function submit() {
    if (!pending || !image || busy || answer.length !== 6) return;
    const current = ++revision.current; setBusy(true); setError('');
    try { const token = await solveRegistrationImage(pending, image.challengeId, answer); if (current === revision.current) finish(token); }
    catch (e) { if (current === revision.current) { setError((e as Error).message); setAnswer(''); } }
    finally { if (current === revision.current) setBusy(false); }
  }
  return <Modal visible={visible} transparent animationType="fade" onDismiss={dismissed} onRequestClose={() => finish()}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
      <View style={styles.frame} accessibilityViewIsModal={Platform.OS === 'ios'}>
      <ScrollView style={styles.body} contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>完成验证后继续</Text>
        <Text style={styles.description}>当前网络的注册较集中，验证一次即可继续。</Text>
        {image ? <Image source={{ uri: image.image }} style={styles.image} accessibilityLabel="注册图片验证码" /> : <Text style={styles.description}>{busy ? '正在加载图片…' : '图片暂不可用'}</Text>}
        <Pressable disabled={busy} onPress={() => { void refresh(); }}><Text style={styles.link}>换一张</Text></Pressable>
        <TextInput accessibilityLabel="图片中的6位数字" testID="registration-verification-answer" style={styles.input}
          keyboardType="number-pad" maxLength={6} placeholder="图片中的6位数字" placeholderTextColor="#71717a" value={answer}
          onChangeText={value => setAnswer(value.replace(/\D/g, '').slice(0, 6))} returnKeyType="done" onSubmitEditing={() => { void submit(); }} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </ScrollView>
        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.cancel]} onPress={() => finish()}><Text style={styles.buttonText}>取消</Text></Pressable>
          <Pressable testID="registration-verification-submit" style={[styles.button, { opacity: busy || answer.length !== 6 || !image ? .5 : 1 }]}
            disabled={busy || answer.length !== 6 || !image} onPress={() => { void submit(); }}><Text style={styles.buttonText}>{busy ? '请稍候…' : '验证并继续'}</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  frame: { width: '100%', maxWidth: 380, maxHeight: '100%', flexShrink: 1, borderRadius: 20, backgroundColor: '#18181b', overflow: 'hidden' },
  body: { flexGrow: 0, flexShrink: 1 },
  card: { padding: 24, paddingBottom: 14, gap: 14 },
  title: { fontSize: 20, fontWeight: '700', color: '#fafafa' }, description: { fontSize: 14, color: '#a1a1aa', lineHeight: 22 },
  image: { width: 240, height: 88, alignSelf: 'center', borderRadius: 10 }, link: { color: '#fdba74', textAlign: 'center', padding: 6 },
  input: { borderWidth: 1, borderColor: '#52525b', borderRadius: 10, padding: 12, color: '#fafafa', fontSize: 18, backgroundColor: '#09090b' },
  error: { color: '#fda4af', fontSize: 13 }, actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingBottom: 24 },
  button: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#ea580c', alignItems: 'center' }, cancel: { backgroundColor: '#3f3f46' },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#fafafa' },
});
