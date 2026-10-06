export function roomInvite(roomId: string, hasPassword: boolean, password: string, webUrl = 'https://yiqikan.club') {
  const base = `${webUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(roomId)}`;
  const encodedPassword = encodeURIComponent(password).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  const link = hasPassword && password ? `${base}?password=${encodedPassword}` : base;
  const passwordText = hasPassword && password ? ` 密码: ${password}` : hasPassword ? '（加入时需要房间密码）' : '';
  return `【异起看】邀请你一起看，复制本条口令打开 App 加入房间: ￥${roomId}￥${passwordText} (网页链接: ${link})`;
}

export function parseRoomInvitation(text: string): { roomId: string; password?: string } | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  let roomId: string | null = null;
  let password: string | undefined = undefined;

  // 1. 口令格式：￥0808￥ 或 #0808#
  const tokenMatch = trimmed.match(/[￥#]([a-zA-Z0-9_-]{1,12})[￥#]/);
  if (tokenMatch) {
    roomId = tokenMatch[1];
  } else {
    // 2. URL 格式：yiqikan://room/0808 或 https://.../join/0808 或 .../room/0808
    const urlMatch = trimmed.match(/(?:yiqikan:\/\/room\/|https?:\/\/[^\/]+\/(?:room|join)\/)([a-zA-Z0-9_-]{1,12})(?![a-zA-Z0-9_-])/i);
    if (urlMatch) {
      roomId = urlMatch[1];
    }
  }

  if (!roomId) return null;

  // 提取密码（优先 URL 参数 ?password=xxx，其次 中文 "密码：xxx" 或 "password: xxx"）
  const urlPwdMatch = trimmed.match(/[?&]password=([^&\s#￥()（）]+)/i);
  if (urlPwdMatch) {
    try { password = decodeURIComponent(urlPwdMatch[1]); } catch { return null; }
  } else {
    const textPwdMatch = trimmed.match(/(?:密码|pwd|password)[：:\s=]+([a-zA-Z0-9_-]+)/i);
    if (textPwdMatch) {
      password = textPwdMatch[1];
    }
  }

  return { roomId: roomId.toLowerCase(), password };
}
