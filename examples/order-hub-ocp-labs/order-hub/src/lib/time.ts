/** 与时间有关的小工具（order.ts 与 agent-demo.ts 共用）。 */

/**
 * 距离打烊还有多少分钟；解析不出营业时段时返回 undefined。
 *
 * 这个判断很关键：演示曾据此选出过一家"还剩 2 分钟打烊"的店，
 * 结果预览给出的取餐时间落在营业时间之外。
 */
export function minutesUntilClose(workHours: unknown, now = new Date()): number | undefined {
  const match = /(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/.exec(String(workHours ?? ''));
  if (match === null) return undefined;
  const closeMinutes = Number(match[3]) * 60 + Number(match[4]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return closeMinutes - nowMinutes;
}

/** 毫秒时间戳 → 北京时间字符串。 */
export function localTime(ms: unknown): string {
  return typeof ms === 'number' && ms > 0
    ? new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '—';
}

export const nowLocal = (): string => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
