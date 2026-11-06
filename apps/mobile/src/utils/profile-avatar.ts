export function avatarLetter(name?: string): string {
  const value=(name||'').trim().normalize('NFC');
  if(!value)return '影';
  const Segmenter=(Intl as any).Segmenter;
  if(Segmenter){const parts=Array.from(new Segmenter('zh',{granularity:'grapheme'}).segment(value)) as {segment:string}[];return parts[parts.length-1]?.segment||'影';}
  return Array.from(value).filter(c=>!/[\p{M}\u200d]/u.test(c)).pop()||'影';
}

export function avatarImageUrl(path: unknown, origin: string): string | null {
  return typeof path === 'string' && /^\/api\/client-avatar\/image\/[a-f0-9-]{36}$/.test(path) ? origin.replace(/\/+$/,'') + path : null;
}
