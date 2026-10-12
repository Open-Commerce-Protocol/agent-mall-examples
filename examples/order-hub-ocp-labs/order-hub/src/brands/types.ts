/**
 * 品牌适配器契约。
 *
 * 设计要点：把"品牌特有的东西"全部关在适配器里，Web 层只认这套接口。
 * 之所以能做到这点，是因为一期两个品牌（瑞幸、麦当劳中国）都是
 * **Streamable HTTP MCP + Authorization: Bearer**，传输层可以完全共用
 * （见 ../mcp/client.ts）。差异只在工具名与下单参数形状。
 */

export type McpLike = {
  initialize: () => Promise<unknown>;
  listTools: () => Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export type Store = {
  storeId: number;
  name: string;
  address: string;
  workHours?: string;
  workStatus?: string;
  distanceKm?: number;
  longitude: number;
  latitude: number;
};

export type Product = {
  productId: number;
  name: string;
  skuCode?: string;
  price?: number;
  imageUrl?: string;
  /** 默认规格的可读描述，例如「大杯/冰/意式拼配」。 */
  defaultSpecs?: string;
};

export type OptionChoice = { subAttributeId: number; name: string; priceDelta: number };
export type OptionGroup = { attributeId: number; attributeName: string; choices: OptionChoice[] };

export type OrderLine = { productId: number; skuCode: string; amount: number; name?: string; specs?: string };

export type PreviewSummary = {
  storeName: string;
  storeAddress: string;
  lines: { name: string; skuCode: string; amount: number; specs?: string; unitPrice?: number | null; lineTotal?: number | null }[];
  pricing: { currency: string; totalInitial: number | null; privilege: number | null; payable: number | null };
  pickupAtMs: number | null;
  couponCodes: string[];
  /** 用于护栏：这份意图的指纹。 */
  fingerprint: string;
};

export type OrderResult = {
  orderId: string;
  payable: number | null;
  pickupAtMs: number | null;
  raw: unknown;
};

export type BrandAdapter = {
  id: string;
  name: string;
  /** 一句话说明这个品牌卖什么。 */
  tagline: string;
  /** MCP 端点。 */
  mcpUrl: string;
  /** 去哪里拿 token、长什么样——直接展示给访客。 */
  tokenHint: string;
  /** 是否需要定位才能查门店（瑞幸与麦当劳都需要）。 */
  requiresLocation: boolean;
  /** 定位缺省时的兜底坐标（杭州西湖）。 */
  defaultLocation: { longitude: number; latitude: number };
  /** 下单是否需要回传经纬度（瑞幸 createOrder 需要）。 */
  orderNeedsLocation: boolean;

  /** 未接入或未提供 token 时，用它证明端点是活的并列出工具清单。 */
  inspectTools: (mcp: McpLike) => Promise<{ name: string; description?: string }[]>;

  listStores: (mcp: McpLike, location: { longitude: number; latitude: number }) => Promise<Store[]>;
  searchProducts: (mcp: McpLike, args: { storeId: number; query: string }) => Promise<Product[]>;
  productOptions: (mcp: McpLike, args: { storeId: number; productId: number }) => Promise<OptionGroup[]>;
  configure: (
    mcp: McpLike,
    args: {
      storeId: number;
      productId: number;
      skuCode: string;
      amount: number;
      selections: { attributeId: number; subAttributeId: number }[];
    },
  ) => Promise<{ skuCode: string }>;
  preview: (mcp: McpLike, args: { storeId: number; lines: OrderLine[] }) => Promise<PreviewSummary>;
  createOrder: (
    mcp: McpLike,
    args: {
      storeId: number;
      lines: OrderLine[];
      location: { longitude: number; latitude: number };
      couponCodes?: string[];
      remark?: string;
    },
  ) => Promise<OrderResult>;
};

/** 适配器在缺少信息时统一抛这个，Web 层会把它原样展示给访客。 */
export class BrandError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'BrandError';
    this.code = code;
    this.status = status;
  }
}
