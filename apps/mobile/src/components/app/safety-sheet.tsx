import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal, StyleSheet, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';
import { create } from 'zustand';
import { SAFETY_REASONS, type SafetyBlock } from '@yiqikan/shared';
import { socketService } from '../../services/socket';
import { useRoomStore } from '../../store/useRoomStore';
import { useVoice } from '../../services/voice-service';

type Target = { id: string; name: string; messageId?: string; message?: string };
type Panel = { mode: 'target'; target: Target } | { mode: 'blocks' } | { mode: 'reports' };
const useSafetyPanel = create<{ panel: Panel | null; open: (panel: Panel | null) => void }>(set => ({ panel: null, open: panel => set({ panel }) }));
export function openSafetyPanel(panel: Panel) { useSafetyPanel.getState().open(panel); }

export function SafetySheet() {
  const { panel, open } = useSafetyPanel();
  const [confirmation, setConfirmation] = useState<ConfirmDialogProps | null>(null);
  const [reason, setReason] = useState<(typeof SAFETY_REASONS)[number]>('骚扰辱骂');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [blocks, setBlocks] = useState<SafetyBlock[]>([]);
  const [reports, setReports] = useState<Awaited<ReturnType<typeof socketService.listReports>>>([]);
  const requestId = useRef('');
  const generation = useRef(0);
  const { leaveVoice } = useVoice();
  const room = useRoomStore(state => state.roomState);

  useEffect(() => {
    const current = ++generation.current;
    setReason('骚扰辱骂'); setDetails(''); setError(''); setReceipt(''); setBusy(false);
    setBlocks([]); setReports([]); setConfirmation(null);
    requestId.current = `report_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (!panel || panel.mode === 'target') return;
    setBusy(true);
    const load = panel.mode === 'blocks'
      ? socketService.listBlocks().then(value => { if (current === generation.current) setBlocks(value); })
      : socketService.listReports().then(value => { if (current === generation.current) setReports(value); });
    load.catch(err => { if (current === generation.current) setError(err.message); })
      .finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [panel]);

  if (!panel) return null;
  const target = panel.mode === 'target' ? panel.target : null;
  const close = () => { if (confirmation) { setConfirmation(null); return; } if (!busy) open(null); };
  const submit = async () => {
    if (!target || !room) { setError('你已离开房间，请通过帮助与反馈联系开发者'); return; }
    setBusy(true); setError('');
    try {
      const result = await socketService.report({ requestId: requestId.current, roomId: room.id, targetId: target.id,
        messageId: target.messageId, reason, details });
      setReceipt(result.id);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const block = () => {
    if (!target || !room) return;
    setConfirmation({
      visible: true, title: '屏蔽并离开',
      message: '将结束当前语音并退出房间，之后不能与此标识进入同一房间。重装或清除应用数据可能改变游客身份。',
      confirmText: '屏蔽并离开', type: 'danger', icon: 'logout', confirmTestID: 'confirm-block-member',
      onCancel: () => setConfirmation(null),
      onConfirm: async () => {
        setConfirmation(null); setBusy(true); setError('');
        leaveVoice();
        try { await socketService.blockAndLeave(room.id, target.id); open(null); useRoomStore.getState().showToast('已屏蔽并退出房间'); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      },
    });
  };

  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>{target ? `举报或屏蔽 ${target.name}` : panel.mode === 'blocks' ? '已屏蔽成员' : '我的举报'}</Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          {target && !receipt && <>
            <Text style={styles.hint}>{target.messageId ? '仅提交所选消息、成员标识、房间与时间及补充说明。' : '提交成员标识、房间与时间及补充说明；不录制语音。'}</Text>
            {target.message && <Text style={styles.evidence}>{target.message}</Text>}
            <View style={styles.reasons}>{SAFETY_REASONS.map(item => <TouchableOpacity key={item} accessibilityRole="button" accessibilityState={{ selected: reason === item }} onPress={() => setReason(item)} disabled={busy} style={[styles.reason, reason === item && styles.selected]}><Text style={styles.text}>{item}</Text></TouchableOpacity>)}</View>
            <TextInput accessibilityLabel="举报补充说明" placeholder="补充说明（选填，最多 500 字）" placeholderTextColor="#777" multiline maxLength={500} value={details} onChangeText={setDetails} editable={!busy} style={styles.input} />
            <TouchableOpacity testID="btn-submit-report" disabled={busy} style={styles.primary} onPress={submit}><Text style={styles.text}>提交举报</Text></TouchableOpacity>
          </>}
          {receipt && <Text testID="report-receipt" selectable style={styles.hint}>举报已收到，编号：{receipt}{'\n'}可在个人中心“我的举报”查看处理结果。</Text>}
          {target && <TouchableOpacity testID="btn-block-member" disabled={busy || !room} style={styles.button} onPress={block}><Text style={{ color: '#f87171' }}>屏蔽此人并离开房间</Text></TouchableOpacity>}
          {panel.mode === 'blocks' && <>
            <Text style={styles.hint}>屏蔽后不能共同入房。清理播放缓存会保留身份；重装或清除应用数据可能改变身份。</Text>
            {!busy && !error && !blocks.length && <Text style={styles.hint}>暂无屏蔽记录</Text>}
            {blocks.map(item => <View key={item.targetId} style={styles.row}><Text style={[styles.text, { flex: 1 }]}>{item.targetName}</Text><TouchableOpacity disabled={busy} style={styles.button} onPress={() => setConfirmation({
              visible: true, title: '解除屏蔽', message: `解除对 ${item.targetName} 的屏蔽后可以再次共同入房。`,
              confirmText: '解除屏蔽', confirmTestID: 'confirm-unblock-member', type: 'info', icon: 'info',
              onCancel: () => setConfirmation(null), onConfirm: async () => {
                setConfirmation(null); setBusy(true); setError('');
                try { await socketService.unblock(item.targetId); setBlocks(await socketService.listBlocks()); }
                catch (err) { setError((err as Error).message); }
                finally { setBusy(false); }
              },
            })}><Text style={{ color: '#fb923c' }}>解除屏蔽</Text></TouchableOpacity></View>)}
          </>}
          {panel.mode === 'reports' && <>
            {!busy && !error && !reports.length && <Text style={styles.hint}>暂无举报记录</Text>}
            {reports.map(item => <View key={item.id} style={styles.evidence}><Text selectable style={styles.text}>{item.id}</Text><Text style={styles.hint}>{new Date(item.createdAt).toLocaleDateString()} · {{ pending: '待处理', reviewing: '核查中', resolved: '已处理' }[item.status]}</Text>{item.result && <Text style={styles.text}>{item.result}</Text>}</View>)}
          </>}
          {!!error && <Text accessibilityRole="alert" style={{ color: '#f87171', marginVertical: 12 }}>{error}</Text>}
          {busy && <ActivityIndicator color="#F97316" />}
          <TouchableOpacity style={styles.button} onPress={() => Linking.openURL('mailto:858536121@qq.com?subject=%E5%BC%82%E8%B5%B7%E7%9C%8B%E5%B8%AE%E5%8A%A9%E4%B8%8E%E5%8F%8D%E9%A6%88').catch(() => setError('请发送邮件至 858536121@qq.com'))}><Text style={styles.hint}>帮助与反馈 · 858536121@qq.com</Text></TouchableOpacity>
        </ScrollView>
        <TouchableOpacity testID="safety-close" disabled={busy} style={styles.button} onPress={close}><Text style={styles.text}>关闭</Text></TouchableOpacity>
      </View>
      {confirmation && <ConfirmDialog {...confirmation} useNativeModal={false} />}
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 440, maxHeight: '85%', padding: 20, borderRadius: 20, backgroundColor: '#18181f', borderWidth: 1, borderColor: '#ffffff20', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 10 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  text: { color: '#eee', fontSize: 14 },
  hint: { color: '#aaa', fontSize: 12, lineHeight: 20, marginVertical: 8 },
  evidence: { color: '#ddd', padding: 12, backgroundColor: '#252525', borderRadius: 10, marginVertical: 8 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#444', borderRadius: 10 },
  selected: { backgroundColor: '#F9731626', borderColor: '#F97316' },
  input: { color: '#eee', backgroundColor: '#252525', borderRadius: 10, padding: 12, minHeight: 90, marginVertical: 12, textAlignVertical: 'top' },
  primary: { minHeight: 46, backgroundColor: '#F97316', borderRadius: 12, borderWidth: 1, borderTopColor: '#ffffff59', borderBottomColor: '#00000026', borderLeftColor: '#ffffff20', borderRightColor: '#ffffff20', shadowColor: '#F97316', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#333' },
});
