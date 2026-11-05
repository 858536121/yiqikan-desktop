import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS_LABELS, type ClientFeedbackItem, type ClientFeedbackPage, type FeedbackCategory, type FeedbackDiagnostics } from '@yiqikan/shared';
import { accountDeviceRequest } from './account-auth';
import { resolveWebUrl } from './environment';

export const DEVELOPER_XHS_URL = 'https://xhslink.com/m/3Ollypp9zy4';
export const DEVELOPER_EMAIL = '858536121@qq.com';
export const feedbackDraftKey = (accountId: string) => `@yiqikan_feedback_draft:${JSON.stringify([resolveWebUrl(),accountId])}`;
export function newFeedbackRequestId() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);}); }
const safe = (value: unknown, max: number) => String(value ?? 'unknown').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,max) || 'unknown';
export function feedbackDiagnostics(bundleVersion: string, errorCode: string | null): FeedbackDiagnostics {
  return { platform: Platform.OS, osVersion: safe(Platform.Version,40), model: safe(Platform.OS==='android' ? Platform.constants?.Model : 'iOS',80),
    appVersion: safe(Constants.nativeAppVersion || Constants.expoConfig?.version,40), bundleVersion: safe(bundleVersion,40), errorCode: (errorCode||'').replace(/[^A-Z0-9_:-]/g,'_').slice(0,64) };
}
function item(value: any): ClientFeedbackItem {
  if (!value || typeof value.id !== 'string' || typeof value.reference !== 'string' || !/^FK-[A-F0-9]{16}$/.test(value.reference) ||
    !FEEDBACK_CATEGORIES.includes(value.category) || typeof value.description !== 'string' || value.description.length > 1500 ||
    typeof value.status !== 'string' || !Object.hasOwn(FEEDBACK_STATUS_LABELS,value.status) || (value.reply!==null && typeof value.reply!=='string') ||
    !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) throw Error('反馈响应无效，请重试');
  return { id:value.id, reference:value.reference, category:value.category, description:value.description, status:value.status, reply:value.reply,
    createdAt:value.createdAt, updatedAt:value.updatedAt };
}
export async function submitFeedback(input: { requestId: string; category: FeedbackCategory; description: string; diagnostics?: FeedbackDiagnostics }) {
  return item(await accountDeviceRequest({ operation:'feedback-create', ...input }));
}
export async function listFeedback(cursor: string | null = null): Promise<ClientFeedbackPage> {
  const result = await accountDeviceRequest({ operation:'feedback-list', cursor });
  if(!result || !Array.isArray(result.items) || result.items.length>20 || (result.nextCursor!==null && typeof result.nextCursor!=='string')) throw Error('反馈列表响应无效');
  return { items: result.items.map(item), nextCursor:result.nextCursor };
}
export async function openDeveloperProfile() {
  // HTTPS app links let Android choose an installed handler and keep a web fallback.
  await Linking.openURL(DEVELOPER_XHS_URL);
}
export async function loadFeedbackDraft(accountId: string) {
  try { const raw=await AsyncStorage.getItem(feedbackDraftKey(accountId));const value=raw?JSON.parse(raw):null;
    if(value && typeof value.description==='string' && value.description.length<=1500 && FEEDBACK_CATEGORIES.includes(value.category) &&
      typeof value.requestId==='string' && /^[a-f0-9-]{36}$/.test(value.requestId) && typeof value.updatedAt==='number' && Date.now()-value.updatedAt<7*86400000)
      return value as { description:string; category:FeedbackCategory; requestId:string; updatedAt:number; pending?: Parameters<typeof submitFeedback>[0] };
  } catch {}
  return null;
}
