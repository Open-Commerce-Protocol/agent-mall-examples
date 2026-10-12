/**
 * 瑞幸咖啡适配器 —— 8 个工具已在 luckin-ocp 项目里逐个实测过，这里是把那条
 * 已验证的链路收敛成统一接口。
 *
 * 工具：queryShopList / searchProductForMcp / queryProductDetailInfo /
 *       switchProduct / previewOrder / createOrder / queryOrderDetailInfo / cancelOrder
 */
import { createHash } from 'node:crypto';
import { unwrapData } from '../mcp/unwrap.ts';
import {
  BrandError,
  type BrandAdapter,
  type McpLike,
  type OptionGroup,
  type OrderLine,
  type OrderResult,
  type PreviewSummary,
  type Product,
  type Store,
} from './types.ts';

type Shop = {
  deptId: number;
  deptName: string;
  address: string;
  longitude: number;
  latitude: number;
  workTimeStart?: string;
  workTimeEnd?: string;
  distance?: number;
  workStatus?: string;
};

type RawProduct = {
  productId: number;
  productName: string;
  skuCode?: string;
  pictureUrl?: string;
  initialPrice?: number;
  estimatePrice?: number;
  productAttrs?: { attributeId: number; attributeName: string; productSubAttrs?: { attributeId: number; attributeName: string; price?: number }[] }[];
};

type RawPreview = {
  aboutTime?: number;
  discountPrice?: number;
  totalInitialPrice?: number;
  privilegeMoney?: number;
  couponCodeList?: string[];
  shopInfo?: Shop;
  productInfoList?: { productId: number; skuCode: string; name: string; amount: number; additionDesc?: string; estimatePrice?: number; estimateTotalPrice?: number }[];
};

const call = async <T>(mcp: McpLike, name: string, args: Record<string, unknown>): Promise<T> =>
  unwrapData<T>(await mcp.callTool(name, args));

const round = (n: number): number => Math.round(n * 100) / 100;

/** 订单指纹：让"确认"绑定到具体订单，改任何一项都会失效。 */
export function luckinFingerprint(storeId: number, lines: OrderLine[], coupons: string[] = []): string {
  const payload = JSON.stringify({
    brand: 'luckin',
    storeId,
    lines: lines.map((l) => `${l.productId}:${l.skuCode}:${l.amount}`).sort(),
    coupons: [...coupons].sort(),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

const defaultSpecs = (p: RawProduct): string =>
  (p.productAttrs ?? [])
    .map((a) => a.productSubAttrs?.[0]?.attributeName)
    .filter((x): x is string => typeof x === 'string')
    .join('/');

export const luckinAdapter: BrandAdapter = {
  id: 'luckin',
  name: '瑞幸咖啡',
  tagline: '现制咖啡与轻食，支持到店自取',
  mcpUrl: 'https://gwmcp.lkcoffee.com/order/user/mcp',
  tokenHint:
    '手机号登录瑞幸 AI 开放平台 https://open.lkcoffee.com 领取个人访问 Token（约 30 天有效，形如以 mcpLUCKIN_MCP_AI 结尾的字符串）。',
  requiresLocation: true,
  defaultLocation: { longitude: 120.1551, latitude: 30.2741 },
  orderNeedsLocation: true,

  inspectTools: async (mcp) => {
    const tools = await mcp.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description }));
  },

  listStores: async (mcp, location) => {
    const shops = await call<Shop[]>(mcp, 'queryShopList', {
      longitude: location.longitude,
      latitude: location.latitude,
    });
    return (Array.isArray(shops) ? shops : []).map<Store>((s) => ({
      storeId: s.deptId,
      name: s.deptName,
      address: s.address,
      workHours: `${s.workTimeStart ?? '?'}-${s.workTimeEnd ?? '?'}`,
      workStatus: s.workStatus,
      distanceKm: s.distance,
      longitude: s.longitude,
      latitude: s.latitude,
    }));
  },

  searchProducts: async (mcp, { storeId, query }) => {
    if (query.trim() === '') throw new BrandError('empty_query', '请输入想喝的饮品关键字（瑞幸检索接口要求有查询文本）');
    const products = await call<RawProduct[]>(mcp, 'searchProductForMcp', { deptId: storeId, query });
    return (Array.isArray(products) ? products : []).map<Product>((p) => ({
      productId: p.productId,
      name: p.productName,
      skuCode: p.skuCode,
      price: p.initialPrice ?? p.estimatePrice,
      imageUrl: p.pictureUrl,
      defaultSpecs: defaultSpecs(p),
    }));
  },

  productOptions: async (mcp, { storeId, productId }) => {
    const detail = await call<RawProduct>(mcp, 'queryProductDetailInfo', { deptId: storeId, productId });
    return (detail.productAttrs ?? []).map<OptionGroup>((a) => ({
      attributeId: a.attributeId,
      attributeName: a.attributeName,
      choices: (a.productSubAttrs ?? []).map((s) => ({
        subAttributeId: s.attributeId,
        name: s.attributeName,
        priceDelta: s.price ?? 0,
      })),
    }));
  },

  configure: async (mcp, { storeId, productId, skuCode, amount, selections }) => {
    let current = skuCode;
    for (const selection of selections) {
      const result = await call<RawProduct>(mcp, 'switchProduct', {
        deptId: storeId,
        productId,
        skuCode: current,
        amount,
        attrOperationParam: {
          attributeId: selection.attributeId,
          subAttr: { attributeId: selection.subAttributeId, operation: 1 },
        },
      });
      if (typeof result?.skuCode === 'string' && result.skuCode !== '') current = result.skuCode;
    }
    return { skuCode: current };
  },

  preview: async (mcp, { storeId, lines }) => {
    const preview = await call<RawPreview>(mcp, 'previewOrder', {
      deptId: storeId,
      productList: lines.map((l) => ({ productId: l.productId, skuCode: l.skuCode, amount: l.amount })),
    });
    return {
      storeName: preview.shopInfo?.deptName ?? '',
      storeAddress: preview.shopInfo?.address ?? '',
      lines: (preview.productInfoList ?? []).map((l) => ({
        name: l.name,
        skuCode: l.skuCode,
        amount: l.amount,
        specs: l.additionDesc,
        unitPrice: l.estimatePrice ?? null,
        lineTotal: l.estimateTotalPrice ?? null,
      })),
      pricing: {
        currency: 'CNY',
        totalInitial: preview.totalInitialPrice ?? null,
        privilege: preview.privilegeMoney ?? null,
        payable: preview.discountPrice ?? null,
      },
      pickupAtMs: preview.aboutTime ?? null,
      couponCodes: preview.couponCodeList ?? [],
      fingerprint: luckinFingerprint(storeId, lines, preview.couponCodeList ?? []),
    } satisfies PreviewSummary;
  },

  createOrder: async (mcp, { storeId, lines, location, couponCodes, remark }) => {
    const productList = lines.map((l) => ({ productId: l.productId, skuCode: l.skuCode, amount: l.amount }));
    const created = await call<Record<string, unknown>>(mcp, 'createOrder', {
      deptId: storeId,
      productList,
      longitude: round(location.longitude),
      latitude: round(location.latitude),
      ...(couponCodes !== undefined && couponCodes.length > 0 ? { couponCodeList: couponCodes } : {}),
      ...(remark !== undefined && remark !== '' ? { remark } : {}),
    });
    const orderId =
      (typeof created.orderId === 'string' && created.orderId) ||
      (typeof created.orderNo === 'string' && created.orderNo) ||
      JSON.stringify(created).slice(0, 60);
    return {
      orderId: String(orderId),
      payable: typeof created.payAmount === 'number' ? created.payAmount : null,
      pickupAtMs: null,
      raw: created,
    } satisfies OrderResult;
  },
};
