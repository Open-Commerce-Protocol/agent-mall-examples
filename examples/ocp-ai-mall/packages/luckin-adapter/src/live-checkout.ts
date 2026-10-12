import { z } from 'zod';
import { LuckinMcpProbe } from './probe';

const id = z.number().int().positive().safe();
const money = z.number().finite().nonnegative().transform(value => {
  const scaled = value * 100;
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.000001) throw new Error('invalid upstream money');
  return Math.round(scaled);
});
const orderId = z.union([z.string().regex(/^\d{1,40}$/), id.transform(String)]);
function unwrap<T>(schema: z.ZodType<T>, raw: unknown): T {
  return z.object({ code: z.literal(0), success: z.literal(true), data: schema }).parse(raw).data;
}
export interface LiveBasket { deptId: number; productList: { productId: number; skuCode: string; amount: number }[] }
export interface LiveCreate extends LiveBasket { longitude: number; latitude: number; couponCodeList: string[]; remark?: string }
const previewSchema = z.object({
  discountPrice: money, totalInitialPrice: money, privilegeMoney: money, couponCodeList: z.array(z.string()),
  shopInfo: z.object({ deptId: id, deptName: z.string().min(1), address: z.string() }),
  productInfoList: z.array(z.object({ productId: id, skuCode: z.string().min(1), name: z.string().min(1), amount: id,
    additionDesc: z.string(), estimateTotalPrice: money })).min(1),
});
export type LivePreview = z.output<typeof previewSchema>;
export interface LiveOrder {
  order_id: string; status: string; status_code?: number; total_minor: number | null;
  need_pay: boolean | null; payment_url?: string; payment_qr_url?: string; pickup_code?: string;
}
// Merchant/WeChat payment destinations only, never arbitrary links from an upstream response.
export function paymentUrl(raw: unknown, qr = false): string | undefined {
  if (typeof raw !== 'string' || !raw || raw.length > 4096) return undefined;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port) return undefined;
    if (!qr && url.protocol === 'weixin:' && url.hostname === 'wxpay' && url.pathname === '/bizpayurl') return raw;
    if (url.protocol === 'https:' && (url.hostname === 'lkcoffee.com' || url.hostname.endsWith('.lkcoffee.com')
      || url.hostname === 'wx.tenpay.com' || url.hostname === 'pay.weixin.qq.com')) return raw;
  } catch { /* Invalid payment destinations are not rendered. */ }
  return undefined;
}
/** The output projection follows https://open.lkcoffee.com/mcp. Creation is never retried. */
export class LuckinLiveCheckout {
  constructor(private readonly probe: LuckinMcpProbe) {}
  async preview(input: LiveBasket): Promise<LivePreview> {
    const result = unwrap(previewSchema, await this.probe.checkout('previewOrder', input));
    const key = (line: { productId: number; skuCode: string; amount: number }) => JSON.stringify([line.productId, line.skuCode, line.amount]);
    if (result.shopInfo.deptId !== input.deptId || JSON.stringify(result.productInfoList.map(key).sort()) !== JSON.stringify(input.productList.map(key).sort())) throw new Error('preview selection mismatch');
    return result;
  }
  async create(input: LiveCreate): Promise<LiveOrder> {
    // Prefer orderIdStr: official numeric IDs can exceed JavaScript's safe integer range.
    const data = unwrap(z.object({ orderIdStr: orderId.optional(), orderId: z.unknown().optional(), needPay: z.boolean().optional(),
      discountPrice: money.optional(), payOrderUrl: z.unknown().optional(), payOrderQrCodeUrl: z.unknown().optional() }), await this.probe.checkout('createOrder', input));
    return { order_id: data.orderIdStr ?? orderId.parse(data.orderId), status: data.needPay === true ? '待付款' : '已创建，待查询状态',
      total_minor: data.discountPrice ?? null, need_pay: data.needPay ?? null,
      payment_url: paymentUrl(data.payOrderUrl), payment_qr_url: paymentUrl(data.payOrderQrCodeUrl, true) };
  }
  async query(id: string): Promise<LiveOrder> {
    const data = unwrap(z.object({ orderId, orderStatus: z.number().int(), orderStatusName: z.string().min(1), orderPayAmount: money.optional(),
      takeMealCodeInfo: z.object({ code: z.string() }).nullable().optional() }), await this.probe.checkout('queryOrderDetailInfo', { orderId: id }));
    if (data.orderId !== id) throw new Error('order identity mismatch');
    return { order_id: id, status: data.orderStatusName, status_code: data.orderStatus, total_minor: data.orderPayAmount ?? null,
      need_pay: data.orderStatus === 10, ...([60, 80].includes(data.orderStatus) && data.takeMealCodeInfo?.code ? { pickup_code: data.takeMealCodeInfo.code } : {}) };
  }
}
