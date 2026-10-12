/**
 * 桥接执行层 —— OCP 与瑞幸 MCP 之间的那一跳。
 *
 * 分层理由：OCP 的 action binding 只能给出"入口"，不能给出"凭据"。所以 token 只存在于
 * 这一层（从环境变量或 DSH 配置读取），**永远不会出现在 Catalog 节点的任何响应里**。
 *
 * 端点：
 *   POST /product        商品实时详情（queryProductDetailInfo）
 *   POST /configure      选规格，可连续多次切换（switchProduct，无副作用）
 *   POST /preview        订单预览，只算价（previewOrder）
 *   POST /create         真实下单（createOrder）——**默认拒绝，需显式武装指纹**
 *   POST /order/query    查单（queryOrderDetailInfo）
 *   POST /order/cancel   取消（cancelOrder）
 *   GET  /guard          查看护栏状态
 */
import { fail, json, startServer, type OcpReply, type Route } from '../lib/http.ts';
import { checkGuard, guardState, orderFingerprint, type OrderIntent, type OrderLine } from './guard.ts';
import type { LuckinTools, PreviewOrder } from '../mcp/tools.ts';
import type { StoreDirectory } from '../catalog/store-directory.ts';

export const BRIDGE_PORT = 4701;

/* ------------------------------------------------------------- 输入解析 */

function parseProductList(raw: unknown): OrderLine[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: OrderLine[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const rec = item as Record<string, unknown>;
    const productId = Number(rec.productId);
    const amount = Number(rec.amount);
    const skuCode = typeof rec.skuCode === 'string' ? rec.skuCode : '';
    if (!Number.isInteger(productId) || productId <= 0) return undefined;
    if (!Number.isInteger(amount) || amount < 1 || amount > 10) return undefined;
    if (skuCode === '') return undefined;
    out.push({ productId, skuCode, amount });
  }
  return out;
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((x): x is string => typeof x === 'string');
}

/* --------------------------------------------------------------- 摘要 */

const aboutTimeIso = (ms: number | undefined): string | undefined =>
  typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : undefined;

/** 把瑞幸的预览结果整理成一份"给人核对"的订单摘要。 */
function summarize(
  preview: PreviewOrder,
  shop: { deptId: number; deptName: string; address: string; workTimeStart?: string; workTimeEnd?: string; distance?: number },
): unknown {
  return {
    store: {
      deptId: shop.deptId,
      dept_name: shop.deptName,
      address: shop.address,
      work_hours: `${shop.workTimeStart ?? '?'}-${shop.workTimeEnd ?? '?'}`,
      distance_km: shop.distance,
    },
    lines: (preview.productInfoList ?? []).map((l) => ({
      productId: l.productId,
      name: l.name,
      skuCode: l.skuCode,
      amount: l.amount,
      specs: l.additionDesc,
      unit_price: (l as unknown as { estimatePrice?: number }).estimatePrice ?? null,
      line_total: (l as unknown as { estimateTotalPrice?: number }).estimateTotalPrice ?? null,
    })),
    pricing: {
      currency: 'CNY',
      total_initial: preview.totalInitialPrice ?? null,
      privilege: preview.privilegeMoney ?? null,
      payable: preview.discountPrice ?? null,
    },
    pickup: {
      about_time_ms: preview.aboutTime ?? null,
      about_time_iso: aboutTimeIso(preview.aboutTime),
    },
    coupon_codes: preview.couponCodeList ?? [],
  };
}

/* --------------------------------------------------------------- 路由 */

export function bridgeRoutes(tools: LuckinTools, storeDirectory: StoreDirectory): Route[] {
  const shopOf = (deptId: number) => storeDirectory.byDeptId(deptId);

  return [
    {
      method: 'GET',
      path: '/health',
      handler: () => json({ status: 'healthy', service: 'luckin-ocp-bridge', guard: guardState(), checked_at: new Date().toISOString() }),
    },
    {
      method: 'GET',
      path: '/guard',
      handler: () =>
        json({
          ...guardState(),
          note: '未武装时 /create 一律返回 428。解锁方式：设置环境变量 LUCKIN_ORDER_CONFIRM=<订单指纹> 并重启桥接层。',
        }),
    },

    /* 商品实时详情 */
    {
      method: 'POST',
      path: '/product',
      handler: async (ctx): Promise<OcpReply> => {
        const deptId = Number(ctx.body.deptId);
        const productId = Number(ctx.body.productId);
        if (!Number.isInteger(deptId) || !Number.isInteger(productId)) {
          return fail('invalid_request', 'deptId 与 productId 必须是整数', 400);
        }
        try {
          const detail = await tools.productDetail({ deptId, productId });
          return json(detail);
        } catch (error) {
          return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
        }
      },
    },

    /* 选规格：把多次 switchProduct 串起来 */
    {
      method: 'POST',
      path: '/configure',
      handler: async (ctx): Promise<OcpReply> => {
        const deptId = Number(ctx.body.deptId);
        const productId = Number(ctx.body.productId);
        let skuCode = typeof ctx.body.skuCode === 'string' ? ctx.body.skuCode : '';
        const amount = ctx.body.amount === undefined ? 1 : Number(ctx.body.amount);
        const selections = Array.isArray(ctx.body.selections) ? ctx.body.selections : undefined;

        if (!Number.isInteger(deptId) || !Number.isInteger(productId)) {
          return fail('invalid_request', 'deptId 与 productId 必须是整数', 400);
        }
        if (skuCode === '') {
          return fail('invalid_request', 'skuCode 必填（可先用 /product 取默认 sku）', 400);
        }
        if (selections === undefined) return fail('invalid_request', 'selections 必须是数组', 400);
        if (!Number.isInteger(amount) || amount < 1 || amount > 10) {
          return fail('invalid_request', 'amount 必须是 1..10 的整数', 400);
        }

        const applied: { attributeId: number; subAttributeId: number; skuCodeAfter: string }[] = [];
        let current = skuCode;
        try {
          for (const raw of selections) {
            const rec = (raw ?? {}) as Record<string, unknown>;
            const attributeId = Number(rec.attributeId);
            const subAttributeId = Number(rec.subAttributeId);
            if (!Number.isInteger(attributeId) || !Number.isInteger(subAttributeId)) {
              return fail('invalid_request', 'selections 每项需要整数 attributeId 与 subAttributeId', 400);
            }
            const result: any = await tools.switchProduct({
              deptId,
              productId,
              skuCode: current,
              attrOperationParam: { attributeId, subAttr: { attributeId: subAttributeId, operation: 1 } },
              amount,
            });
            const next = typeof result?.skuCode === 'string' && result.skuCode !== '' ? result.skuCode : current;
            applied.push({ attributeId, subAttributeId, skuCodeAfter: next });
            current = next;
          }
        } catch (error) {
          return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
        }

        const firstDetail: any = await tools.productDetail({ deptId, productId }).catch(() => undefined);
        return json({
          deptId,
          productId,
          initial_sku_code: skuCode,
          final_sku_code: current,
          applied,
          /** 以 switchProduct 的返回树为准，因为它带 selected/price/canSelected。 */
          selected_options: (firstDetail?.productAttrs ?? []).map((a: any) => ({
            attribute_id: a.attributeId,
            attribute_name: a.attributeName,
          })),
          note: 'switchProduct 无副作用：它按「当前 sku + 要改的属性」重新推导出新的 skuCode。',
        });
      },
    },

    /* 订单预览（只读） */
    {
      method: 'POST',
      path: '/preview',
      handler: async (ctx): Promise<OcpReply> => {
        const deptId = Number(ctx.body.deptId);
        const productList = parseProductList(ctx.body.productList);
        if (!Number.isInteger(deptId) || productList === undefined) {
          return fail('invalid_request', '需要整数 deptId 与合法的 productList[{productId,skuCode,amount}]', 400);
        }
        const shop = shopOf(deptId);
        if (shop === undefined) return fail('not_found', `门店 deptId=${deptId} 不在缓存里`, 404);
        try {
          const preview = await tools.previewOrder({ deptId, productList });
          return json({
            order_summary: summarize(preview, shop),
            fingerprint: orderFingerprint({ deptId, productList }),
            note: '这是只读预览，未产生任何订单。',
          });
        } catch (error) {
          return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
        }
      },
    },

    /* 真实下单 —— 护栏在这里 */
    {
      method: 'POST',
      path: '/create',
      handler: async (ctx): Promise<OcpReply> => {
        const deptId = Number(ctx.body.deptId);
        const productList = parseProductList(ctx.body.productList);
        const couponCodeList = parseStringArray(ctx.body.couponCodeList);
        if (!Number.isInteger(deptId) || productList === undefined || couponCodeList === undefined) {
          return fail('invalid_request', '需要整数 deptId、合法 productList、以及字符串数组 couponCodeList（可省略）', 400);
        }
        const shop = shopOf(deptId);
        if (shop === undefined) return fail('not_found', `门店 deptId=${deptId} 不在缓存里`, 404);

        const remark = typeof ctx.body.remark === 'string' ? ctx.body.remark : undefined;
        const expectedAmount =
          ctx.body.expected_amount === undefined ? undefined : Number(ctx.body.expected_amount);
        const intent: OrderIntent = { deptId, productList, couponCodeList, remark };

        // 无论是否授权，都先真的预览一次——这样"拒绝"本身也是有信息量的。
        let preview: PreviewOrder;
        try {
          preview = await tools.previewOrder({ deptId, productList });
        } catch (error) {
          return fail('upstream_error', `预览失败，未下单：${error instanceof Error ? error.message : String(error)}`, 502);
        }
        const summary = summarize(preview, shop);

        const decision = checkGuard(intent, preview.discountPrice, expectedAmount);
        if (!decision.allowed) {
          return json(
            {
              error: { code: decision.code, message: decision.message },
              order_summary: summary,
              fingerprint: decision.fingerprint,
              armed_fingerprint: guardState().expectedFingerprint ?? null,
              how_to_arm: {
                step_1: '核对 order_summary：门店、商品、规格、数量、实付金额。',
                step_2: `确认无误后设置环境变量 LUCKIN_ORDER_CONFIRM=${decision.fingerprint}`,
                step_3: '重启桥接层，然后在请求里带上 expected_amount 与本订单一致的 productList。',
              },
              note: '未发生任何订单，未产生任何扣款。',
            },
            428,
          );
        }

        try {
          const created = await tools.createOrder({
            deptId,
            productList,
            longitude: shop.longitude,
            latitude: shop.latitude,
            ...(couponCodeList.length > 0 ? { couponCodeList } : {}),
            ...(remark !== undefined ? { remark } : {}),
          });
          return json(
            {
              order: created,
              order_summary: summary,
              fingerprint: decision.fingerprint,
              placed_at: new Date().toISOString(),
              warning: '真实订单已提交，可能已产生实际扣款。',
            },
            201,
          );
        } catch (error) {
          return fail('upstream_error', `下单失败：${error instanceof Error ? error.message : String(error)}`, 502);
        }
      },
    },

    /* 查单 / 取消 */
    {
      method: 'POST',
      path: '/order/query',
      handler: async (ctx): Promise<OcpReply> => {
        const orderId = typeof ctx.body.orderId === 'string' ? ctx.body.orderId : '';
        if (orderId === '') return fail('invalid_request', 'orderId 必填', 400);
        try {
          return json(await tools.orderDetail({ orderId }));
        } catch (error) {
          return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
        }
      },
    },
    {
      method: 'POST',
      path: '/order/cancel',
      handler: async (ctx): Promise<OcpReply> => {
        const orderId = typeof ctx.body.orderId === 'string' ? ctx.body.orderId : '';
        if (orderId === '') return fail('invalid_request', 'orderId 必填', 400);
        try {
          return json(await tools.cancelOrder({ orderId }));
        } catch (error) {
          return fail('upstream_error', error instanceof Error ? error.message : String(error), 502);
        }
      },
    },
  ];
}

export async function startBridge(tools: LuckinTools, storeDirectory: StoreDirectory): Promise<number> {
  await startServer(bridgeRoutes(tools, storeDirectory), BRIDGE_PORT, 'bridge');
  return BRIDGE_PORT;
}
