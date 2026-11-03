import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Inbox, ScanLine, MessageCircle, Copy, SquarePen, Check } from 'lucide-react-native';
import { FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS, FEEDBACK_STATUS_LABELS, type FeedbackCategory, type ClientFeedbackItem } from '@yiqikan/shared';
import { ProfileHeader, ProfileRow, profileStyles as s } from './profile-ui';
import { SupportVerificationCard } from './support-verification-card';
import { DEVELOPER_EMAIL, DEVELOPER_XHS_URL, feedbackDiagnostics, feedbackDraftKey, listFeedback, loadFeedbackDraft, newFeedbackRequestId, openDeveloperProfile, submitFeedback } from '../../services/help-feedback';
import { useRoomStore } from '../../store/useRoomStore';

type Page = 'home' | 'compose' | 'tickets' | 'contact' | 'verify' | 'receipt';
type Submission = Parameters<typeof submitFeedback>[0];
export function HelpCenter({ active, accountId, bundleVersion, errorCode, onBack, onBackHandlerChange, copyFeedback, initiallyVerify = false }: {
  active: boolean; accountId: string | null; bundleVersion: string; errorCode: string | null; onBack: () => void;
  onBackHandlerChange: (handler: (() => boolean) | null) => void; copyFeedback: () => void; initiallyVerify?: boolean;
}) {
  const [page,setPage] = useState<Page>(initiallyVerify ? 'verify':'home');
  const [category,setCategory] = useState<FeedbackCategory>('playback'), [description,setDescription] = useState('');
  const [consent,setConsent] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [items,setItems] = useState<ClientFeedbackItem[]>([]), [cursor,setCursor] = useState<string|null>(null), [loaded,setLoaded] = useState(false);
  const [receipt,setReceipt] = useState<ClientFeedbackItem|null>(null), [question,setQuestion] = useState<number|null>(null);
  const mounted=useRef(true), sequence=useRef(0), requestId=useRef(newFeedbackRequestId()), pending=useRef<Submission|null>(null);
  const draftLoaded=useRef(false), writes=useRef(Promise.resolve()), latestDraft=useRef<Record<string,unknown>|null>(null);
  const dirty=useRef(false);
  const diagnostic=useRef(feedbackDiagnostics(bundleVersion,errorCode));
  const scroll=useRef<ScrollView|null>(null);
  useEffect(()=>{scroll.current?.scrollTo({y:0,animated:false});},[page]);
  const toast=(value:string)=>useRoomStore.getState().showToast(value);
  const draftKey=accountId?feedbackDraftKey(accountId):null;
  latestDraft.current = description.trim() ? { category,description,requestId:requestId.current,updatedAt:Date.now(),pending:pending.current } : null;
  function storeDraft() {
    if(!draftKey||!draftLoaded.current)return;
    const value=latestDraft.current;
    writes.current=writes.current.catch(()=>{}).then(()=>value?AsyncStorage.setItem(draftKey,JSON.stringify(value)):AsyncStorage.removeItem(draftKey));
    void writes.current.catch(()=>{if(mounted.current)toast('本地草稿保存失败，请暂时不要关闭页面');});
  }
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;sequence.current++;storeDraft();};
  },[draftKey]);
  useEffect(()=>{
    if(!accountId)return;let valid=true;
    void loadFeedbackDraft(accountId).then(value=>{if(!valid)return;draftLoaded.current=true;if(dirty.current)return;
      if(value){setCategory(value.category);setDescription(value.description);requestId.current=value.requestId;
        if(value.pending && value.pending.requestId===value.requestId && value.pending.description===value.description.trim() && value.pending.category===value.category) {
          pending.current=value.pending;setConsent(Boolean(value.pending.diagnostics));
        }
      }
      draftLoaded.current=true;
    });return()=>{valid=false;};
  },[accountId]);
  useEffect(()=>{if(!draftLoaded.current)return;const timer=setTimeout(storeDraft,350);return()=>clearTimeout(timer);},[category,description,consent]);
  function go(next:Page) { sequence.current++;setBusy(false);setError('');if(page==='compose')storeDraft();setPage(next); }
  function back() { if(page!=='home'){go('home');return true;}return false; }
  useEffect(()=>{if(!active){sequence.current++;setBusy(false);storeDraft();}onBackHandlerChange(active?back:null);return()=>onBackHandlerChange(null);},[active,page,draftKey]);
  async function load(more=false) {
    if(busy)return;const ticket=++sequence.current;setBusy(true);setError('');
    try{const result=await listFeedback(more?cursor:null);if(mounted.current&&ticket===sequence.current){setItems(old=>more?[...old,...result.items.filter(i=>!old.some(o=>o.id===i.id))]:result.items);setCursor(result.nextCursor);setLoaded(true);}}
    catch(e){if(mounted.current&&ticket===sequence.current)setError(e instanceof Error?e.message:'获取失败');}
    finally{if(mounted.current&&ticket===sequence.current)setBusy(false);}
  }
  useEffect(()=>{if(page==='tickets'&&active)void load();},[page,active]);
  function edited() {dirty.current=true;if(pending.current){requestId.current=newFeedbackRequestId();pending.current=null;}setError('');}
  async function submit() {
    if(busy)return;
    if(description.trim().length<5){setError('请再描述具体一点，至少填写 5 个字');return;}
    const ticket=++sequence.current;setBusy(true);setError('');
    if(!pending.current)pending.current={requestId:requestId.current,category,description:description.trim(),...(consent?{diagnostics:diagnostic.current}:{})};
    const payload=pending.current;
    latestDraft.current={category,description,requestId:requestId.current,updatedAt:Date.now(),pending:payload};storeDraft();
    try{
      const value=await submitFeedback(payload);
      if(!mounted.current||ticket!==sequence.current)return;
      latestDraft.current=null;pending.current=null;requestId.current=newFeedbackRequestId();setDescription('');storeDraft();
      setReceipt(value);setPage('receipt');
    }catch(e){if(mounted.current&&ticket===sequence.current)setError((e instanceof Error?e.message:'提交失败')+'。内容已保留，可重试或联系开发者。');}
    finally{if(mounted.current&&ticket===sequence.current)setBusy(false);}
  }
  const titles:Record<Page,string>={home:'帮助与反馈',compose:'提交问题',tickets:'我的反馈',contact:'联系开发者',verify:'客服身份核验',receipt:'提交结果'};
  const button=(label:string,fn:()=>void,testID?:string,secondary=false)=><TouchableOpacity testID={testID} accessibilityRole="button" disabled={busy || (!accountId && ['提交问题','提交反馈'].includes(label))} onPress={fn} style={[secondary?s.secondary:s.primary,busy&&{opacity:.5}]}><Text style={secondary?s.text:s.primaryText}>{label}</Text></TouchableOpacity>;
  const copy=async(value:string)=>{try{await Clipboard.setStringAsync(value);toast('已复制');}catch{toast('复制失败，请重试');}};
  return <View style={s.page}>
    <ProfileHeader title={titles[page]} onBack={()=>{if(!back())onBack();}}/>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
      {page==='home'&&<>
        <Text style={[s.title,{marginTop:12}]}>有什么可以帮你？</Text><Text style={[s.caption,{marginTop:10,marginBottom:20}]}>先看看常见问题，也可以直接告诉我们。</Text>
        {['为什么我和对方的画面不同步？','播放失败或一直加载怎么办？','账号受限，如何申请复核？'].map((title,index)=><View key={title} style={{borderBottomWidth:1,borderColor:'#2a2c2d'}}>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:question===index}} onPress={()=>setQuestion(question===index?null:index)} style={{paddingVertical:17,minHeight:48}}><Text style={s.text}>{title}</Text></TouchableOpacity>
          {question===index&&<Text style={[s.caption,{marginTop:0,marginBottom:16}]}>{['请确认双方播放的是同一个视频，成员可在房间尝试「同步房主」。持续异常时请提交问题。','检查网络后重试，并说明站点和现象。请勿提供房间密码或私密观看链接。','通过「提交问题」选择账号与限制并说明情况。开发者需要进一步核验时，再生成客服核验码。'][index]}</Text>}
        </View>)}
        {button('提交问题',()=>go('compose'),'btn-submit-problem')}{button('联系开发者 · 小红书',()=>go('contact'),'btn-contact-developer',true)}
        {!accountId&&<Text style={s.caption}>联网获取用户编号后可提交问题，也可直接联系开发者。</Text>}
        <View style={[s.group,{marginTop:24}]}><ProfileRow title="我的反馈" subtitle="查看处理状态和回复" icon={Inbox} onPress={()=>go('tickets')} testID="btn-my-feedback"/>
          <ProfileRow title="客服身份核验" subtitle="开发者要求核验时使用" icon={ScanLine} onPress={()=>go('verify')} testID="btn-support-verification"/></View>
        <TouchableOpacity testID="btn-copy-feedback" onPress={copyFeedback} style={s.link}><Text style={s.linkText}>复制反馈信息</Text></TouchableOpacity>
      </>}
      {page==='compose'&&<>
        <Text style={[s.caption,{marginBottom:18}]}>描述发生了什么，我们会在「我的反馈」回复你。</Text>
        <Text style={s.label}>问题类型</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10}}>{FEEDBACK_CATEGORIES.map(key=><TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{selected:key===category}} disabled={busy} testID={`feedback-category-${key}`} onPress={()=>{edited();setCategory(key);}} style={{padding:11,borderRadius:10,backgroundColor:key===category?'#37271e':'#1c1d20'}}><Text style={{color:key===category?'#f2a06a':'#c1c3bd',fontSize:13}}>{FEEDBACK_CATEGORY_LABELS[key]}</Text></TouchableOpacity>)}</View>
        <Text style={s.label}>问题描述</Text><TextInput testID="feedback-description" accessibilityLabel="问题描述" editable={!busy} value={description} multiline maxLength={1500} textAlignVertical="top" placeholder="例如：进入房间后，对方暂停了，我这边还在播放……" placeholderTextColor="#858980" onChangeText={value=>{edited();setDescription(value);}} style={[s.input,{minHeight:130}]}/>
        <View style={{flexDirection:'row',alignItems:'center',gap:12,marginVertical:14}}><Text style={[s.text,{flex:1}]}>附带诊断信息，帮助定位问题</Text><Switch testID="feedback-diagnostics-consent" accessibilityLabel="附带诊断信息" disabled={busy} value={consent} onValueChange={value=>{edited();setConsent(value);}} trackColor={{false:'#454941',true:'#ad643b'}}/></View>
        {consent&&<View style={[s.group,{padding:14}]}><Text style={s.caption}>平台：{diagnostic.current.platform} · 系统：{diagnostic.current.osVersion}{'\n'}设备：{diagnostic.current.model}{'\n'}安装包：{diagnostic.current.appVersion} · 更新：{diagnostic.current.bundleVersion}{'\n'}错误码：{diagnostic.current.errorCode||'无'}{'\n'}同时关联当前用户编号；不含聊天、观看链接和身份凭证。</Text></View>}
        {error&&<Text role="alert" style={s.error}>{error}</Text>}
        {button(busy?'提交中…':'提交反馈',()=>void submit(),'btn-send-feedback')}
        <Text style={s.caption}>只在你确认提交时上传；诊断信息保存 30 天，反馈记录保存 180 天。请勿填写账号密码等敏感信息。</Text>
        <TouchableOpacity style={s.link} onPress={()=>go('contact')}><Text style={s.linkText}>暂时无法提交？联系开发者</Text></TouchableOpacity>
      </>}
      {page==='receipt'&&receipt&&<>
        <View style={{alignItems:'center',paddingVertical:32}}><Check size={40} color="#f2a06a"/><Text style={[s.title,{marginTop:20}]}>问题已收到</Text><Text style={[s.caption,{textAlign:'center',marginTop:12}]}>处理进展会显示在「我的反馈」。</Text><Text selectable style={[s.text,{marginVertical:24,fontVariant:['tabular-nums']}]}>{receipt.reference}</Text></View>
        {button('查看我的反馈',()=>go('tickets'),'btn-view-submitted-feedback')}
      </>}
      {page==='tickets'&&<>
        <TouchableOpacity style={s.link} disabled={busy} onPress={()=>void load()} testID="btn-refresh-feedback"><Text style={s.linkText}>刷新处理进展</Text></TouchableOpacity>
        {busy&&<ActivityIndicator color="#f2a06a"/>}{error&&<Text role="alert" style={s.error}>{error}</Text>}
        {loaded&&!items.length&&!busy&&<Text style={[s.caption,{paddingVertical:24,textAlign:'center'}]}>你还没有提交过问题</Text>}
        {items.map(item=><View key={item.id} style={[s.group,{padding:16,marginBottom:14}]}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}><Text style={s.text}>{FEEDBACK_CATEGORY_LABELS[item.category]}</Text><Text style={s.linkText}>{FEEDBACK_STATUS_LABELS[item.status]}</Text></View><Text selectable style={[s.text,{marginVertical:12}]}>{item.description}</Text>{item.reply&&<View style={{borderTopWidth:1,borderColor:'#343731',paddingTop:12}}><Text style={s.caption}>开发者回复</Text><Text selectable style={s.text}>{item.reply}</Text></View>}<Text selectable style={[s.caption,{marginTop:15}]}>{item.reference}{'\n'}{new Date(item.createdAt).toLocaleString('zh-CN')}</Text></View>)}
        {cursor&&button('加载更多',()=>void load(true),undefined,true)}
      </>}
      {page==='contact'&&<>
        <Text style={[s.title,{marginTop:22}]}>异起看开发者</Text><Text style={[s.caption,{marginTop:12,marginBottom:16}]}>在小红书聊聊使用体验，也欢迎告诉我你想要的新功能。私信时附上反馈编号，方便找到你的记录。</Text>
        {button('打开小红书主页',()=>{void openDeveloperProfile().catch(()=>{setError('未能打开小红书，请复制主页链接到浏览器打开。');});},'btn-open-xiaohongshu')}
        {button('复制主页链接',()=>void copy(DEVELOPER_XHS_URL),'btn-copy-xiaohongshu',true)}
        {error&&<Text role="alert" style={s.error}>{error}</Text>}
        <View style={[s.group,{marginTop:24}]}><ProfileRow title="先提交问题" subtitle="附上反馈编号，沟通更方便" icon={SquarePen} onPress={()=>go('compose')}/><ProfileRow title="复制反馈信息" icon={Copy} onPress={copyFeedback}/></View>
        <TouchableOpacity style={s.link} onPress={()=>void copy(DEVELOPER_EMAIL)}><Text style={s.linkText}>复制联系邮箱</Text></TouchableOpacity>
      </>}
      {page==='verify'&&<><Text style={[s.title,{marginTop:18}]}>确认是你在操作</Text><Text style={[s.caption,{marginVertical:16}]}>仅在开发者要求核验账号时使用。核验不代表自动解封，普通问题反馈无需生成。</Text><View style={s.group}><SupportVerificationCard active={active&&page==='verify'}/></View></>}
    </ScrollView>
  </View>;
}
