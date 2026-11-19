/**
 * 格式化秒数为时间显示字符串
 * - 当时间达到或超过 1 小时（>= 3600s），或指定 forceHours 为 true 时，按 HH:MM:SS 划分（如 01:15:30）
 * - 纯分钟（< 3600s 且 forceHours 为 false）按 MM:SS 划分（如 04:20）
 */
export function formatTime(seconds: number, forceHours: boolean = false): string {
  if (isNaN(seconds) || seconds < 0) {
    return forceHours ? '00:00:00' : '00:00';
  }
  const totalSecs = Math.floor(seconds);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  if (h > 0 || forceHours) {
    const hh = h < 10 ? `0${h}` : `${h}`;
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
