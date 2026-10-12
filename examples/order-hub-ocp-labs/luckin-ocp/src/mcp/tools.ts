/**
 * 瑞幸 MCP 的 8 个工具的类型化封装。
 *
 * 所有工具的真实返回都是 `{code, msg, data}` 包在 MCP 的 content[0].text 里，
 * 所以统一走 unwrapData：code !== 0 视为业务失败并抛出。
 *
 * 类型是按真实响应写的（见 README 的"实测响应"一节），不是照文档猜的；
 * 下游仍按可选字段读取，避免服务端微调就崩。
 */
import type { McpClient, McpToolResult } from './client.ts';

/* ------------------------------------------------------------------ 类型 */

export type Shop = {
  deptId: number;
  deptName: string;
  address: string;
  deptTags?: string[];
  longitude: number;
  latitude: number;
  workTimeStart?: string;
  workTimeEnd?: string;
  distance?: number;
  number?: string;
  workStatus?: string;
};

export type ProductSubAttr = {
  attributeId: number;
  attributeName: string;
  selected?: unknown;
  price?: number;
  canSelected?: unknown;
};

export type ProductAttr = {
  attributeId: number;
  attributeName: string;
  productSubAttrs?: ProductSubAttr[];
};

export type Product = {
  productId: number;
  productName: string;
  skuCode?: string;
  pictureUrl?: string;
  initialPrice?: number;
  price?: number;
  estimatePrice?: number;
  productAttrs?: ProductAttr[];
};

export type OrderLineInput = {
  productId: number;
  skuCode: string;
  amount: number;
};

export type PreviewedLine = {
  productId: number;
  skuCode: string;
  name: string;
  amount: number;
  /** 例如「大杯/冰/意式拼配/默认浓度/不另外加糖/无奶油」 */
  additionDesc?: string;
  breviaryPicUrl?: string;
  productAttrs?: ProductAttr[];
};

export type PreviewOrder = {
  aboutTime?: number;
  discountPrice?: number;
  originPrice?: number;
  totalPrice?: number;
  couponCodeList?: string[];
  shopInfo?: Shop;
  productInfoList?: PreviewedLine[];
  [key: string]: unknown;
};

export type CreatedOrder = {
  orderId?: string;
  orderNo?: string;
  payAmount?: number;
  [key: string]: unknown;
};

/* ---------------------------------------------------------------- 解包 */

export function unwrapData<T>(result: McpToolResult): T {
  const first = result.content?.[0];
  const text = first?.type === 'text' ? (first.text ?? '') : JSON.stringify(first ?? {});
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`瑞幸接口返回了无法解析的内容：${text.slice(0, 240)}`);
  }
  if (parsed !== null && typeof parsed === 'object' && 'code' in parsed && parsed.code !== 0) {
    throw new Error(`瑞幸接口业务失败 code=${parsed.code} msg=${parsed.msg ?? ''}`);
  }
  return (parsed?.data ?? parsed) as T;
}

/* ------------------------------------------------------------ 工具封装 */

export type LuckinTools = {
  queryShopList: (args: { longitude: number; latitude: number; deptName?: string }) => Promise<Shop[]>;
  searchProduct: (args: { deptId: number; query: string }) => Promise<Product[]>;
  productDetail: (args: { deptId: number; productId: number }) => Promise<unknown>;
  switchProduct: (args: {
    deptId: number;
    productId: number;
    skuCode: string;
    attrOperationParam: { attributeId: number; subAttr: { attributeId: number; operation: number } };
    amount: number;
  }) => Promise<unknown>;
  previewOrder: (args: { deptId: number; productList: OrderLineInput[] }) => Promise<PreviewOrder>;
  createOrder: (args: {
    deptId: number;
    productList: OrderLineInput[];
    longitude: number;
    latitude: number;
    couponCodeList?: string[];
    remark?: string;
  }) => Promise<CreatedOrder>;
  orderDetail: (args: { orderId: string }) => Promise<unknown>;
  cancelOrder: (args: { orderId: string }) => Promise<unknown>;
};

export function createLuckinTools(client: McpClient): LuckinTools {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> =>
    unwrapData<T>(await client.callTool(name, args));

  return {
    queryShopList: (args) => call<Shop[]>('queryShopList', args),
    searchProduct: (args) => call<Product[]>('searchProductForMcp', args),
    productDetail: (args) => call<unknown>('queryProductDetailInfo', args),
    switchProduct: (args) => call<unknown>('switchProduct', args),
    previewOrder: (args) => call<PreviewOrder>('previewOrder', args),
    createOrder: (args) => call<CreatedOrder>('createOrder', args),
    orderDetail: (args) => call<unknown>('queryOrderDetailInfo', args),
    cancelOrder: (args) => call<unknown>('cancelOrder', args),
  };
}

/* ---------------------------------------------------------------- 小工具 */

/** 取商品的默认 skuCode；搜不到就返回 undefined，由上层决定是否先查详情。 */
export function defaultSkuCode(product: Product): string | undefined {
  if (typeof product.skuCode === 'string' && product.skuCode !== '') return product.skuCode;
  for (const attr of product.productAttrs ?? []) {
    const sub = (attr.productSubAttrs ?? []).find((s) => typeof s.attributeName === 'string');
    if (sub !== undefined && typeof (sub as unknown as { skuCode?: string }).skuCode === 'string') {
      return (sub as unknown as { skuCode: string }).skuCode;
    }
  }
  return undefined;
}

/** 把商品属性树压成「杯型/温度/…」一行，便于在目录条目里展示。 */
export function describeAttrs(product: Product): string {
  const parts: string[] = [];
  for (const attr of product.productAttrs ?? []) {
    const names = (attr.productSubAttrs ?? []).map((s) => s.attributeName).filter(Boolean);
    if (names.length > 0) parts.push(`${attr.attributeName}:${names.join('|')}`);
  }
  return parts.join('  ');
}
