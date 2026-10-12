/**
 * 下单护栏 —— 本项目里最重要的一个文件。
 *
 * `createOrder` 会产生**真实订单与真实扣款**。所以桥接层默认**拒绝执行**，
 * 唯一的解锁方式是操作者显式设置环境变量：
 *
 *     LUCKIN_ORDER_CONFIRM=<该订单的指纹>
 *
 * 指纹覆盖门店、商品、规格、数量、券、备注——任何一项变化指纹就变，
 * 旧的确认自动作废。这样做的目的：让"确认"成为一个**必须由人做出的、针对具体订单的**
 * 动作，而不是一个可以被脚本或模型默认满足的开关。
 *
 * 这也就是 OCP 的 `requires_user_confirmation: true` 落到实处的样子。
 */
import { createHash } from 'node:crypto';

export type OrderLine = { productId: number; skuCode: string; amount: number };

export type OrderIntent = {
  deptId: number;
  productList: OrderLine[];
  couponCodeList?: string[];
  remark?: string;
};

/** 订单指纹：稳定、可复现、对顺序不敏感。 */
export function orderFingerprint(intent: OrderIntent): string {
  const lines = intent.productList
    .map((l) => `${l.productId}:${l.skuCode}:${l.amount}`)
    .sort();
  const payload = JSON.stringify({
    deptId: intent.deptId,
    lines,
    coupons: [...(intent.couponCodeList ?? [])].sort(),
    remark: intent.remark ?? '',
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export type GuardState = {
  armed: boolean;
  /** 环境变量里当前的指纹；未设置时为 undefined。 */
  expectedFingerprint: string | undefined;
};

export function guardState(): GuardState {
  const value = process.env.LUCKIN_ORDER_CONFIRM;
  return {
    armed: typeof value === 'string' && value !== '',
    expectedFingerprint: typeof value === 'string' && value !== '' ? value : undefined,
  };
}

export type GuardDecision =
  | { allowed: true; fingerprint: string }
  | { allowed: false; fingerprint: string; code: 'confirmation_required' | 'price_changed'; message: string };

/**
 * 判断这笔订单是否被授权执行。
 *
 * @param intent 订单意图
 * @param actualAmount 下单前刚刚预览得到的实付金额
 * @param expectedAmount 用户确认时看到的实付金额（可选；提供则强制一致）
 */
export function checkGuard(
  intent: OrderIntent,
  actualAmount: number | undefined,
  expectedAmount: number | undefined,
): GuardDecision {
  const fingerprint = orderFingerprint(intent);
  const { armed, expectedFingerprint } = guardState();

  if (!armed) {
    return {
      allowed: false,
      fingerprint,
      code: 'confirmation_required',
      message:
        '桥接层未武装，拒绝执行真实下单。请核对订单摘要后，设置环境变量 ' +
        `LUCKIN_ORDER_CONFIRM=${fingerprint} 并重启桥接层。`,
    };
  }
  if (expectedFingerprint !== fingerprint) {
    return {
      allowed: false,
      fingerprint,
      code: 'confirmation_required',
      message:
        `已武装的指纹是 ${expectedFingerprint}，与本订单指纹 ${fingerprint} 不一致（订单内容变过，旧确认作废）。`,
    };
  }
  if (
    expectedAmount !== undefined &&
    actualAmount !== undefined &&
    Math.abs(actualAmount - expectedAmount) > 0.001
  ) {
    return {
      allowed: false,
      fingerprint,
      code: 'price_changed',
      message: `价格与确认时不一致：你确认的是 ¥${expectedAmount}，现在预览为 ¥${actualAmount}。已拒绝下单，请重新确认。`,
    };
  }
  return { allowed: true, fingerprint };
}
