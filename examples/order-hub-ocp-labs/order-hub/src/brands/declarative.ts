/**
 * 声明式品牌引擎。
 *
 * 动机：手写适配器每加一个品牌都要改代码，而"接入更多 MCP"的瓶颈正在这里。
 * 这个引擎把品牌差异收敛成**一份 JSON spec**：工具名 + 参数模板 + 字段路径。
 * 于是：
 *   - 加品牌 = 加一个 spec 文件（不改代码）；
 *   - 品牌方改了工具名 = 改 spec；
 *   - 未接入品牌 = 先跑 scripts/onboard.ts 生成 spec 草稿。
 *
 * 边界（诚实说明）：
 *   - 一个操作**一次调用**能完成。像瑞幸选规格要连续多次 switchProduct 那种
 *     有状态循环，超出本引擎表达力，仍用手写适配器（见 luckin.ts）；
 *   - 字段路径是点路径（`data.list`、`deptId`），不支持过滤/映射表达式。
 *     它覆盖"列表 + 字段重命名"这一主流形状，不试图做通用 JSON 变换语言。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BrandAdapter,
  McpLike,
  OptionGroup,
  OrderLine,
  OrderResult,
  PreviewSummary,
  Product,
  Store,
} from './types.ts';
import { BrandError } from './types.ts';

/* ---------------------------------------------------------------- spec 类型 */

export type OpSpec = { tool: string; args?: Record<string, unknown> };

export type StoresShape = {
  list: string;
  id: string;
  name: string;
  address?: string;
  lat?: string;
  lng?: string;
  hoursStart?: string;
  hoursEnd?: string;
  status?: string;
  distance?: string;
};

export type ProductsShape = {
  list: string;
  id: string;
  name: string;
  price?: string;
  sku?: string;
  image?: string;
  attrs?: string;
};

export type OptionsShape = {
  list: string;
  id: string;
  name: string;
  choices: string;
  choiceId: string;
  choiceName: string;
  choicePrice?: string;
};

export type PreviewShape = {
  payable?: string;
  initial?: string;
  privilege?: string;
  pickup?: string;
  coupons?: string;
  lines?: string;
  lineName?: string;
  lineSku?: string;
  lineAmount?: string;
  lineSpecs?: string;
};

export type BrandSpec = {
  id: string;
  name: string;
  tagline: string;
  mcpUrl: string;
  tokenHint: string;
  requiresLocation?: boolean;
  defaultLocation?: { longitude: number; latitude: number };
  orderNeedsLocation?: boolean;
  /** 各操作的映射。缺失即表示该品牌这部分尚未接通。 */
  ops: Partial<Record<'listStores' | 'searchProducts' | 'productOptions' | 'preview' | 'createOrder', OpSpec>>;
  shapes: {
    stores?: StoresShape;
    products?: ProductsShape;
    options?: OptionsShape;
    preview?: PreviewShape;
    order?: { id: string; payable?: string };
  };
  /** spec 的来源与状态，展示给访客，不含糊。 */
  specNote?: string;
  /** 为 true 时不在站点上展示该品牌——用于自证/测试用的 spec。 */
  hidden?: boolean;
};

/* --------------------------------------------------------------- 路径取值 */

/**
 * 点路径取值；任一段缺失返回 undefined，不抛错。
 * `''` 或 `'.'` 表示"就是 payload 本身"——有些品牌把数组直接放在 data 里。
 */
export function get(obj: unknown, path: string | undefined): unknown {
  if (path === undefined) return undefined;
  if (path === '' || path === '.') return obj;
  let current: any = obj;
  for (const segment of path.split('.')) {
    if (current === undefined || current === null) return undefined;
    current = current[segment];
  }
  return current;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const num = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/* --------------------------------------------------------- 参数模板替换 */

const unwrapPayload = (result: unknown): unknown => {
  const typed = result as { content?: { type: string; text?: string }[] };
  const first = typed?.content?.[0];
  const text = first?.type === 'text' ? (first.text ?? '') : JSON.stringify(first ?? {});
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrandError('unparsable_response', `品牌返回了无法解析的内容：${text.slice(0, 200)}`, 502);
  }
  if (parsed !== null && typeof parsed === 'object' && 'code' in parsed && parsed.code !== 0) {
    throw new BrandError('brand_error', `品牌接口业务失败 code=${parsed.code} msg=${parsed.msg ?? ''}`, 502);
  }
  // 有的品牌把数据放在 data 里，有的直接平铺——两种都兼容。
  return parsed !== null && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
};

type Vars = Record<string, unknown>;

/** 递归替换 `{{name}}` 占位符；纯占位符保持原类型（不变成字符串）。 */
function render(template: unknown, vars: Vars): unknown {
  if (typeof template === 'string') {
    const exact = /^\{\{(\w+)\}\}$/.exec(template);
    if (exact !== null) return vars[exact[1] as string];
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => str(vars[name]));
  }
  if (Array.isArray(template)) return template.map((item) => render(item, vars));
  if (template !== null && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) out[key] = render(value, vars);
    return out;
  }
  return template;
}

/* ------------------------------------------------------------- 适配器构造 */

function missing(spec: BrandSpec, what: string): never {
  throw new BrandError(
    'not_mapped',
    `品牌「${spec.name}」的「${what}」尚未接通：spec 里缺少对应操作或字段路径。` +
      '请运行 node scripts/onboard.ts 用该品牌的 token 探明工具清单，再补全 spec。',
    501,
  );
}

export function buildAdapter(spec: BrandSpec): BrandAdapter {
  const callOp = async (mcp: McpLike, op: OpSpec, vars: Vars): Promise<unknown> =>
    unwrapPayload(await mcp.callTool(op.tool, render(op.args ?? {}, vars) as Record<string, unknown>));

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    mcpUrl: spec.mcpUrl,
    tokenHint: spec.tokenHint,
    requiresLocation: spec.requiresLocation ?? true,
    defaultLocation: spec.defaultLocation ?? { longitude: 120.1551, latitude: 30.2741 },
    orderNeedsLocation: spec.orderNeedsLocation ?? true,

    inspectTools: async (mcp) => {
      const tools = await mcp.listTools();
      return tools.map((t) => ({ name: t.name, description: t.description }));
    },

    listStores: async (mcp, location) => {
      const op = spec.ops.listStores;
      const shape = spec.shapes.stores;
      if (op === undefined || shape === undefined) missing(spec, '查询门店');
      const payload = await callOp(mcp, op, { lat: location.latitude, lng: location.longitude, ...location });
      return asArray(get(payload, shape.list)).map<Store>((row) => ({
        storeId: Number(get(row, shape.id)),
        name: str(get(row, shape.name)),
        address: str(get(row, shape.address)),
        workHours: str(get(row, shape.hoursStart)) !== '' ? `${str(get(row, shape.hoursStart))}-${str(get(row, shape.hoursEnd))}` : undefined,
        workStatus: str(get(row, shape.status)) || undefined,
        distanceKm: num(get(row, shape.distance)),
        longitude: num(get(row, shape.lng)) ?? location.longitude,
        latitude: num(get(row, shape.lat)) ?? location.latitude,
      }));
    },

    searchProducts: async (mcp, { storeId, query }) => {
      const op = spec.ops.searchProducts;
      const shape = spec.shapes.products;
      if (op === undefined || shape === undefined) missing(spec, '搜索商品');
      if (query.trim() === '') throw new BrandError('empty_query', '请输入关键字');
      const payload = await callOp(mcp, op, { storeId, query, kw: query });
      return asArray(get(payload, shape.list)).map<Product>((row) => ({
        productId: Number(get(row, shape.id)),
        name: str(get(row, shape.name)),
        skuCode: str(get(row, shape.sku)) || undefined,
        price: num(get(row, shape.price)),
        imageUrl: str(get(row, shape.image)) || undefined,
        defaultSpecs: str(get(row, shape.attrs)) || undefined,
      }));
    },

    productOptions: async (mcp, { storeId, productId }) => {
      const op = spec.ops.productOptions;
      const shape = spec.shapes.options;
      if (op === undefined || shape === undefined) missing(spec, '读取商品规格');
      const payload = await callOp(mcp, op, { storeId, productId });
      return asArray(get(payload, shape.list)).map<OptionGroup>((group) => ({
        attributeId: Number(get(group, shape.id)),
        attributeName: str(get(group, shape.name)),
        choices: asArray(get(group, shape.choices)).map((choice) => ({
          subAttributeId: Number(get(choice, shape.choiceId)),
          name: str(get(choice, shape.choiceName)),
          priceDelta: num(get(choice, shape.choicePrice)) ?? 0,
        })),
      }));
    },

    /**
     * 声明式引擎不表达"连续多次调用"，所以 configure 只能在 spec 用单次调用表达；
     * 需要循环的品牌（如瑞幸）请用手写适配器。
     */
    configure: async () => missing(spec, '选规格（需要多步循环，请改用适配器）'),

    preview: async (mcp, { storeId, lines }) => {
      const op = spec.ops.preview;
      const shape = spec.shapes.preview;
      if (op === undefined || shape === undefined) missing(spec, '订单预览');
      const payload = await callOp(mcp, op, {
        storeId,
        lines: lines.map((l) => ({ productId: l.productId, skuCode: l.skuCode, amount: l.amount })),
      });
      const rawLines = shape.lines === undefined ? [] : asArray(get(payload, shape.lines));
      return {
        storeName: '',
        storeAddress: '',
        lines: rawLines.map((row) => ({
          name: str(get(row, shape.lineName)),
          skuCode: str(get(row, shape.lineSku)),
          amount: num(get(row, shape.lineAmount)) ?? 0,
          specs: str(get(row, shape.lineSpecs)) || undefined,
        })),
        pricing: {
          currency: 'CNY',
          totalInitial: num(get(payload, shape.initial)) ?? null,
          privilege: num(get(payload, shape.privilege)) ?? null,
          payable: num(get(payload, shape.payable)) ?? null,
        },
        pickupAtMs: num(get(payload, shape.pickup)) ?? null,
        couponCodes: asArray(get(payload, shape.coupons)).map(str),
        fingerprint: '',
      } satisfies PreviewSummary;
    },

    createOrder: async (mcp, { storeId, lines, location, couponCodes, remark }) => {
      const op = spec.ops.createOrder;
      if (op === undefined) missing(spec, '提交订单');
      const payload = await callOp(mcp, op, {
        storeId,
        lines: lines.map((l) => ({ productId: l.productId, skuCode: l.skuCode, amount: l.amount })),
        lat: location.latitude,
        lng: location.longitude,
        coupons: couponCodes ?? [],
        remark: remark ?? '',
      });
      const idShape = spec.shapes.order?.id ?? 'orderId';
      const id = str(get(payload, idShape));
      if (id === '') {
        throw new BrandError('no_order_id', `下单返回里取不到订单号（路径 "${idShape}"）：${JSON.stringify(payload).slice(0, 200)}`, 502);
      }
      return {
        orderId: id,
        payable: num(get(payload, spec.shapes.order?.payable)) ?? null,
        pickupAtMs: null,
        raw: payload,
      } satisfies OrderResult;
    },
  };
}

/* ---------------------------------------------------------------- spec 装载 */

export function loadSpecs(dir: string): BrandSpec[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const specs: BrandSpec[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as BrandSpec;
      if (typeof parsed.id === 'string' && typeof parsed.mcpUrl === 'string') specs.push(parsed);
      else console.error(`[specs] ${file} 缺少 id 或 mcpUrl，已跳过`);
    } catch (error) {
      console.error(`[specs] ${file} 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return specs;
}
