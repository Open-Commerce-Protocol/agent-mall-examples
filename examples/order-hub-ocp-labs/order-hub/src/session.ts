/**
 * 会话与下单确认门。
 *
 * 这是公开站点里替代"环境变量武装护栏"的等价物：
 *   1. 访客必须先调 /api/preview 拿到一份确认单，服务端在会话里记下**这份**订单
 *      的指纹、金额与行项目，并发一个一次性的 confirmToken；
 *   2. 下单必须带这个 confirmToken + acknowledge=true；
 *   3. 服务端校验：token 未用过、指纹一致、金额未超单笔与累计上限。
 *
 * 由此得到两个性质：
 *   - **没有看过确认单就下不了单**（无法凭空构造请求花钱）；
 *   - 金额上限是会话级的，误操作不会无限刷。
 *
 * token 只存在于进程内存：不落盘、不写日志、不返回给任何响应。
 */
import { randomUUID, createHash } from 'node:crypto';
import { createMcpClient, type McpClient } from './mcp/client.ts';
import type { OrderLine } from './brands/types.ts';

const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const LIMITS = {
  /** 单笔上限（元） */
  maxOrderAmount: envNumber('ORDER_MAX_AMOUNT', 100),
  /** 单会话累计上限（元） */
  maxSessionSpend: envNumber('ORDER_MAX_SESSION_SPEND', 200),
  /** 会话闲置多久后回收 */
  sessionTtlMs: envNumber('ORDER_SESSION_TTL_MS', 30 * 60 * 1000),
  /** 确认单多久内有效 */
  confirmTtlMs: envNumber('ORDER_CONFIRM_TTL_MS', 5 * 60 * 1000),
  /** 单次数量上限 */
  maxLineAmount: envNumber('ORDER_MAX_LINE_AMOUNT', 10),
  /**
   * 对话限流。**这是为了保护模型额度**：站点一旦接入真实 LLM，
   * 每个访客的每句话都在花操作者的钱，必须有闸。
   */
  chatPerMinute: envNumber('CHAT_MAX_PER_MINUTE', 8),
  chatPerSession: envNumber('CHAT_MAX_PER_SESSION', 60),
};

export type PendingConfirmation = {
  confirmToken: string;
  fingerprint: string;
  payable: number;
  storeId: number;
  lines: OrderLine[];
  stagedAt: number;
};

export type Session = {
  id: string;
  brandId: string;
  /** ⚠ 仅内存。绝不返回、绝不记录。 */
  token: string;
  mcp: McpClient;
  location: { longitude: number; latitude: number };
  createdAt: number;
  lastSeenAt: number;
  spendTotal: number;
  orderCount: number;
  pending?: PendingConfirmation;
  /** 仅供访问日志用的短指纹，便于排查而不泄露 token。 */
  tokenFingerprint: string;
  /** 最近一分钟内的对话时间戳，用于限流。 */
  chatTimes: number[];
  /** 本会话累计对话条数。 */
  chatCount: number;
};

const SESSIONS = new Map<string, Session>();

export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/**
 * 订单指纹：把"确认"绑定到一份具体订单上。
 *
 * 刻意放在枢纽层而不是品牌适配器里——它是本服务的概念（确认门要用），
 * 不是品牌的概念。这样声明式 spec 也不用操心它。
 * 改任何一项（品牌/门店/规格/数量/券）指纹就变，旧确认自动作废。
 */
export function computeFingerprint(
  brandId: string,
  storeId: number,
  lines: OrderLine[],
  coupons: string[] = [],
): string {
  const payload = JSON.stringify({
    brandId,
    storeId,
    lines: lines.map((l) => `${l.productId}:${l.skuCode}:${l.amount}`).sort(),
    coupons: [...coupons].sort(),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function createSession(
  brandId: string,
  mcpUrl: string,
  token: string,
  location: { longitude: number; latitude: number },
): Session {
  const session: Session = {
    id: randomUUID(),
    brandId,
    token,
    mcp: createMcpClient({ token, url: mcpUrl, clientName: 'order-hub', timeoutMs: 120_000 }),
    location,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    spendTotal: 0,
    orderCount: 0,
    tokenFingerprint: fingerprintToken(token),
    chatTimes: [],
    chatCount: 0,
  };
  SESSIONS.set(session.id, session);
  return session;
}

/**
 * 对话限流闸。接入真实 LLM 后，每句话都在花操作者的钱，所以必须有。
 * @returns 允许则放行并记账；否则给出拒绝理由。
 */
export function allowChat(session: Session): { ok: true } | { ok: false; message: string; status: number } {
  const now = Date.now();
  session.chatTimes = session.chatTimes.filter((at) => now - at < 60_000);
  if (session.chatTimes.length >= LIMITS.chatPerMinute) {
    return {
      ok: false,
      status: 429,
      message: `对话过于频繁：每分钟最多 ${LIMITS.chatPerMinute} 条（这是为了让模型额度不被刷掉），请稍后再试。`,
    };
  }
  if (session.chatCount >= LIMITS.chatPerSession) {
    return {
      ok: false,
      status: 429,
      message: `本会话对话已达上限 ${LIMITS.chatPerSession} 条。请重新建立会话继续（会重新验证 token）。`,
    };
  }
  session.chatTimes.push(now);
  session.chatCount += 1;
  return { ok: true };
}

export function getSession(id: string): Session | undefined {
  const session = SESSIONS.get(id);
  if (session === undefined) return undefined;
  if (Date.now() - session.lastSeenAt > LIMITS.sessionTtlMs) {
    SESSIONS.delete(id);
    return undefined;
  }
  session.lastSeenAt = Date.now();
  return session;
}

export function dropSession(id: string): void {
  SESSIONS.delete(id);
}

export function sweepSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, session] of SESSIONS) {
    if (now - session.lastSeenAt > LIMITS.sessionTtlMs) {
      SESSIONS.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function sessionStats(): { active: number; orders: number; spendTotal: number } {
  let orders = 0;
  let spendTotal = 0;
  for (const session of SESSIONS.values()) {
    orders += session.orderCount;
    spendTotal += session.spendTotal;
  }
  return { active: SESSIONS.size, orders, spendTotal: Math.round(spendTotal * 100) / 100 };
}

/** 登记一份待确认订单，返回一次性 confirmToken。 */
export function stageConfirmation(
  session: Session,
  staged: Omit<PendingConfirmation, 'confirmToken' | 'stagedAt'>,
): PendingConfirmation {
  const pending: PendingConfirmation = {
    ...staged,
    confirmToken: randomUUID(),
    stagedAt: Date.now(),
  };
  session.pending = pending;
  return pending;
}

export type ConfirmDenial = { ok: false; code: string; message: string; status: number };
export type ConfirmApproval = { ok: true; pending: PendingConfirmation };

/**
 * 校验下单请求是否有资格执行。任何一个条件不满足都拒绝——这是花钱前的最后一道门。
 */
export function consumeConfirmation(session: Session, confirmToken: string, acknowledge: boolean): ConfirmDenial | ConfirmApproval {
  if (acknowledge !== true) {
    return { ok: false, code: 'not_acknowledged', message: '必须显式确认（acknowledge=true）才能下单。', status: 428 };
  }
  const pending = session.pending;
  if (pending === undefined) {
    return { ok: false, code: 'no_preview', message: '请先获取订单确认单再下单。', status: 428 };
  }
  if (pending.confirmToken !== confirmToken) {
    return {
      ok: false,
      code: 'stale_confirmation',
      message: '确认令牌与当前待确认订单不符（订单内容变过，或确认单已被替换）。请重新预览。',
      status: 428,
    };
  }
  if (Date.now() - pending.stagedAt > LIMITS.confirmTtlMs) {
    return { ok: false, code: 'confirmation_expired', message: '确认单已过期，请重新预览。', status: 428 };
  }
  if (!Number.isFinite(pending.payable) || pending.payable <= 0) {
    return { ok: false, code: 'invalid_amount', message: '确认单金额异常，已拒绝下单。', status: 428 };
  }
  if (pending.payable > LIMITS.maxOrderAmount) {
    return {
      ok: false,
      code: 'over_order_limit',
      message: `本单实付 ¥${pending.payable} 超过单笔上限 ¥${LIMITS.maxOrderAmount}，已拒绝。`,
      status: 403,
    };
  }
  if (session.spendTotal + pending.payable > LIMITS.maxSessionSpend) {
    return {
      ok: false,
      code: 'over_session_limit',
      message: `本会话累计已花 ¥${session.spendTotal}，再加本单 ¥${pending.payable} 会超过会话上限 ¥${LIMITS.maxSessionSpend}，已拒绝。`,
      status: 403,
    };
  }
  return { ok: true, pending };
}

/** 下单成功后记账，并让确认令牌失效（同一份确认不能重复下单）。 */
export function commitOrder(session: Session, payable: number): void {
  session.spendTotal = Math.round((session.spendTotal + payable) * 100) / 100;
  session.orderCount += 1;
  session.pending = undefined;
}
