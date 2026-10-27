import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { ShieldCheck, Copy } from 'lucide-react-native';
import { formatPublicUserId, type SupportCodeResult } from '@yiqikan/shared';
import { generateSupportCode } from '../../services/account-auth';
import { useRoomStore } from '../../store/useRoomStore';

export function SupportVerificationCard({ active }: { active: boolean }) {
  const [code, setCode] = useState<SupportCodeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) { generation.current++; setCode(null); setLoading(false); setExpired(false); }
    return () => { generation.current++; };
  }, [active]);
  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((code.expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) { setCode(null); setExpired(true); }
    };
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code]);
  const createCode = async () => {
    if (loading || !active) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const legacyToken = await AsyncStorage.getItem('@yiqikan_safety_token');
      const value = await generateSupportCode(legacyToken);
      if (activeRef.current && generation.current === request) {
        setCode(value); setSeconds(value.expiresInSeconds); setExpired(false);
      }
    } catch (error) {
      if (activeRef.current && generation.current === request)
        useRoomStore.getState().showToast(error instanceof Error ? error.message : '生成失败，请联网重试');
    } finally { if (generation.current === request) setLoading(false); }
  };
  const copyCode = async () => {
    if (!code || code.expiresAt <= Date.now()) { setCode(null); setExpired(true); return; }
    try {
      await Clipboard.setStringAsync(`异起看客服核验\n用户编号：${formatPublicUserId(code.publicId)}\n客服核验码：${code.code}\n有效期内仅交给开发者核验设备身份，请勿公开发布。`);
      useRoomStore.getState().showToast('用户编号和核验码已复制，请在有效期内发给开发者');
    } catch { useRoomStore.getState().showToast('复制失败，请重试'); }
  };
  return <View style={styles.container}>
    <TouchableOpacity testID="btn-generate-support-code" accessibilityLabel="生成客服核验码" disabled={loading || !active}
      onPress={() => void createCode()} style={styles.row}>
      <ShieldCheck color="#aaa" size={18} />
      <View style={styles.heading}><Text style={styles.title}>{code ? '重新生成客服核验码' : '生成客服核验码'}</Text>
        <Text style={styles.hint}>{expired ? '核验码已过期，请重新生成' : '用于私信开发者处理账号问题'}</Text></View>
      {loading && <ActivityIndicator size="small" color="#fb923c" />}
    </TouchableOpacity>
    {code && <View testID="support-code-card" style={styles.codeCard}>
      <Text style={styles.hint}>用户编号：{formatPublicUserId(code.publicId)}</Text>
      <Text testID="support-code-value" style={styles.code}>{code.code}</Text>
      <Text style={styles.hint}>剩余 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · 核验一次后失效</Text>
      <Text style={styles.notice}>仅发给开发者，不要公开发布。重新生成会使此前的核验失效；核验不代表自动解封。</Text>
      <TouchableOpacity testID="btn-copy-support-code" accessibilityLabel="复制用户编号和核验码" onPress={() => void copyCode()} style={styles.copy}>
        <Copy color="#fb923c" size={15} /><Text style={styles.copyText}>复制编号和核验码</Text>
      </TouchableOpacity>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  container: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  heading: { marginLeft: 12, flex: 1 }, title: { color: '#eee', fontSize: 14.5, fontWeight: '500' },
  hint: { color: '#999', fontSize: 11.5, marginTop: 4 },
  codeCard: { padding: 16, margin: 12, marginTop: 0, backgroundColor: 'rgba(251,146,60,0.06)', borderRadius: 10 },
  code: { color: '#fb923c', fontSize: 23, fontWeight: '600', letterSpacing: 2, marginVertical: 9 },
  notice: { color: '#999', fontSize: 11.5, lineHeight: 18, marginTop: 8 },
  copy: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 12 },
  copyText: { color: '#fb923c', fontSize: 13 },
});
