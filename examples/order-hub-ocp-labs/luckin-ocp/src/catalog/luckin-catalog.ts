/**
 * OCP Catalog 节点 —— 把瑞幸门店包成一个 OCP 目录。
 *
 * 关键设计：**一家门店 = 一个 Catalog**。原因是瑞幸 MCP 的检索接口本身就是门店维度的
 * （searchProductForMcp 必填 deptId），所以门店就是最自然的目录边界。好处是
 * OCP 的发现层能真的做到「同一杯咖啡在 8 家门店的可得性」这种跨独立目录聚合。
 *
 * 端点（门店维度，manifest 里声明，OCP 不规定路径）：
 *   GET  /stores/:deptId/.well-known/ocp-catalog
 *   GET  /stores/:deptId/ocp/manifest
 *   GET  /stores/:deptId/ocp/health
 *   GET  /stores/:deptId/ocp/contracts
 *   POST /stores/:deptId/ocp/query      → 瑞幸 searchProductForMcp
 *   POST /stores/:deptId/ocp/resolve    → 实时 queryProductDetailInfo + action bindings
 *
 * 所有商品数据都是**实时从 MCP 取的**，没有本地菜单快照——避免价格/规格过期。
 */
import { fail, json, type OcpReply, type Route } from '../lib/http.ts';
import { newId } from '../lib/ids.ts';
import type { LuckinTools, Product, Shop } from '../mcp/tools.ts';
import type { StoreDirectory } from './store-directory.ts';

export const LUCKIN_CATALOG_PORT = 4700;
export const LUCKIN_PROVIDER_ID = 'provider_luckin';
export const LUCKIN_QUERY_PACK = 'ocp.query.luckin.keyword.v1';
export const LUCKIN_CAPABILITY_ID = 'ocp.luckin.product.search.v1';

/** 桥接执行层的地址；OCP 的 action binding 指向它。 */
export const BRIDGE_URL = process.env.LUCKIN_BRIDGE_URL ?? 'http://127.0.0.1:4701';

const QUERY_KEYS = [
  'ocp_version',
  'kind',
  'catalog_id',
  'query_pack',
  'query_mode',
  'query',
  'filters',
  'limit',
  'offset',
  'cursor',
  'explain',
];

/** OCP 的 filters 是封闭集合（catalogQueryFiltersSchema）。 */
const OCP_FILTER_KEYS = [
  'category',
  'brand',
  'currency',
  'availability_status',
  'provider_id',
  'sku',
  'min_amount',
  'max_amount',
  'in_stock_only',
  'has_image',
];

/** 本节点真正能兑现的过滤器。 */
const HONORED_FILTERS = ['sku', 'currency', 'provider_id', 'min_amount', 'max_amount', 'has_image', 'in_stock_only'];

/** 在 OCP schema 内、但本节点无法兑现的过滤器——如实报告，而不是假装支持。 */
const UNSUPPORTED_FILTERS = ['category', 'brand', 'availability_status'];

const nowIso = (): string => new Date().toISOString();
const expiringAt = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

export const catalogIdFor = (deptId: number): string => `cat_luckin_dept_${deptId}`;
export const entryIdFor = (deptId: number, productId: number): string => `entry_luckin_${deptId}_${productId}`;

/** 从 entry_id 反解 deptId / productId；解不出返回 undefined。 */
export function parseEntryId(entryId: string): { deptId: number; productId: number } | undefined {
  const match = /^entry_luckin_(\d+)_(\d+)$/.exec(entryId);
  if (match === null) return undefined;
  return { deptId: Number(match[1]), productId: Number(match[2]) };
}

const baseUrlFor = (deptId: number): string => `http://127.0.0.1:${LUCKIN_CATALOG_PORT}/stores/${deptId}`;

/* ------------------------------------------------------------------ 条目 */

/** MCP 商品 → OCP CatalogEntry。价格用 initialPrice，规格用默认 sku。 */
function toEntry(shop: Shop, product: Product): unknown {
  const price = product.initialPrice ?? product.price ?? product.estimatePrice ?? 0;
  return {
    kind: 'CatalogEntry',
    catalog_id: catalogIdFor(shop.deptId),
    entry_id: entryIdFor(shop.deptId, product.productId),
    provider_id: LUCKIN_PROVIDER_ID,
    object_id: String(product.productId),
    object_type: 'ocp.commerce.product',
    commercial_object_id: `co_luckin_${product.productId}`,
    title: product.productName,
    summary: `${shop.deptName} · 默认规格 ${describeDefault(product)}`,
    ...(typeof product.pictureUrl === 'string' && product.pictureUrl !== '' ? { image_url: product.pictureUrl } : {}),
    attributes: {
      sku: product.skuCode,
      brand: '瑞幸咖啡',
      category: '现制饮品',
      price: { currency: 'CNY', amount: price, price_type: 'fixed' },
      inventory: { availability_status: 'in_stock' },
      product_url: `${baseUrlFor(shop.deptId)}/ocp/manifest`,
      store: {
        deptId: shop.deptId,
        dept_name: shop.deptName,
        address: shop.address,
        work_hours: `${shop.workTimeStart ?? '?'}-${shop.workTimeEnd ?? '?'}`,
        work_status: shop.workStatus,
      },
      luckin: {
        productId: product.productId,
        default_sku_code: product.skuCode,
        attributes: (product.productAttrs ?? []).map((a) => ({
          attribute_id: a.attributeId,
          attribute_name: a.attributeName,
          options: (a.productSubAttrs ?? []).map((s) => ({ sub_attribute_id: s.attributeId, name: s.attributeName })),
        })),
      },
    },
  };
}

/** 搜索结果只带默认选中的规格，这里把它压成一行。 */
function describeDefault(product: Product): string {
  const picked: string[] = [];
  for (const attr of product.productAttrs ?? []) {
    const sub = (attr.productSubAttrs ?? [])[0];
    if (sub !== undefined) picked.push(sub.attributeName);
  }
  return picked.join('/');
}

/* ------------------------------------------------------------------ manifest */

function manifest(shop: Shop): unknown {
  const base = baseUrlFor(shop.deptId);
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${catalogIdFor(shop.deptId)}`,
    catalog_id: catalogIdFor(shop.deptId),
    catalog_name: `瑞幸咖啡 · ${shop.deptName}`,
    description: `${shop.deptName}（${shop.address}）的在售饮品。数据实时取自瑞幸官方 MCP，无本地快照。`,
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${base}/ocp/health`, method: 'GET' },
      query: { url: `${base}/ocp/query`, method: 'POST' },
      resolve: { url: `${base}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${base}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: LUCKIN_CAPABILITY_ID,
        name: '瑞幸饮品关键字检索',
        description:
          '把自然语言查询交给瑞幸 MCP 的 searchProductForMcp 做匹配。' +
          `可兑现的过滤器：${HONORED_FILTERS.join(', ')}；` +
          `在 schema 内但本节点无法兑现：${UNSUPPORTED_FILTERS.join(', ')}（会在 policy_summary.rejected_filters 里如实报告）。`,
        query_packs: [
          {
            pack_id: LUCKIN_QUERY_PACK,
            description: '瑞幸饮品关键字检索包：只声明 keyword 一种执行模式。',
            query_modes: ['keyword'],
          },
        ],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    object_contracts: [],
  };
}

/* ------------------------------------------------------------------ 查询 */

function applyFilters(
  shop: Shop,
  product: Product,
  filters: Record<string, unknown>,
): { pass: boolean } {
  const price = product.initialPrice ?? product.price ?? product.estimatePrice ?? 0;
  if (filters.sku !== undefined && product.skuCode !== filters.sku) return { pass: false };
  if (filters.currency !== undefined && filters.currency !== 'CNY') return { pass: false };
  if (filters.provider_id !== undefined && filters.provider_id !== LUCKIN_PROVIDER_ID) return { pass: false };
  if (typeof filters.min_amount === 'number' && price < filters.min_amount) return { pass: false };
  if (typeof filters.max_amount === 'number' && price > filters.max_amount) return { pass: false };
  if (filters.has_image === true && (product.pictureUrl === undefined || product.pictureUrl === '')) return { pass: false };
  // 门店在售列表里的商品即可下单，所以 in_stock_only: true 天然满足。
  return { pass: true };
}

async function handleQuery(
  tools: LuckinTools,
  shop: Shop,
  body: Record<string, unknown>,
): Promise<OcpReply> {
  const extra = Object.keys(body).filter((k) => !QUERY_KEYS.includes(k));
  if (extra.length > 0) {
    return fail('unexpected_field', `查询请求不接受字段：${extra.join(', ')}。允许：${QUERY_KEYS.join(', ')}`, 400);
  }
  if (body.catalog_id !== undefined && body.catalog_id !== catalogIdFor(shop.deptId)) {
    return fail('catalog_mismatch', `catalog_id 应为 "${catalogIdFor(shop.deptId)}"`, 400);
  }
  if (body.query_pack !== undefined && body.query_pack !== LUCKIN_QUERY_PACK) {
    return fail(
      'unsupported_query_pack',
      `本节点只声明了 query_pack "${LUCKIN_QUERY_PACK}"，收到 "${String(body.query_pack)}"。可先读 manifest。`,
      400,
    );
  }
  if (body.query_mode !== undefined && body.query_mode !== 'keyword') {
    return fail('unsupported_query_mode', `本 pack 只声明 keyword 模式，收到 "${String(body.query_mode)}"`, 400);
  }

  const rawQuery = body.query === undefined ? '' : body.query;
  if (typeof rawQuery !== 'string') return fail('invalid_request', 'query 必须是字符串', 400);
  if (rawQuery.length > 500) return fail('invalid_request', 'query 最长 500 字符', 400);
  const term = rawQuery.trim();
  if (term === '') {
    return fail('invalid_request', '本节点的 query 不能为空：瑞幸检索接口要求有查询文本', 400);
  }

  const rawFilters = body.filters === undefined ? {} : body.filters;
  if (typeof rawFilters !== 'object' || rawFilters === null || Array.isArray(rawFilters)) {
    return fail('invalid_request', 'filters 必须是 JSON 对象', 400);
  }
  const filters = rawFilters as Record<string, unknown>;
  const badKeys = Object.keys(filters).filter((k) => !OCP_FILTER_KEYS.includes(k));
  if (badKeys.length > 0) {
    return fail('unsupported_filter', `不在 OCP 过滤器集合内：${badKeys.join(', ')}。可用：${OCP_FILTER_KEYS.join(', ')}`, 400);
  }

  if (body.offset !== undefined && body.offset !== 0) return fail('invalid_request', 'offset 目前只支持 0', 400);
  const limit = typeof body.limit === 'number' ? body.limit : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return fail('invalid_request', 'limit 必须是 1..50 的整数', 400);
  }

  // 实时取——没有本地菜单快照。
  let products: Product[];
  try {
    products = await tools.searchProduct({ deptId: shop.deptId, query: term });
  } catch (error) {
    return fail('upstream_error', `瑞幸检索失败：${error instanceof Error ? error.message : String(error)}`, 502);
  }
  if (!Array.isArray(products)) products = [];

  const rejected = Object.keys(filters).filter((k) => UNSUPPORTED_FILTERS.includes(k));
  const matched = products
    .filter((p) => applyFilters(shop, p, filters).pass)
    .slice(0, limit);

  const warnings: string[] = [];
  if (rejected.length > 0) {
    warnings.push(`本节点无法兑现过滤器 ${rejected.join(', ')}，已忽略（这是如实报告，不是静默丢弃）。`);
  }

  return json({
    ocp_version: '1.0',
    kind: 'CatalogQueryResult',
    id: newId('qry'),
    catalog_id: catalogIdFor(shop.deptId),
    query_pack: LUCKIN_QUERY_PACK,
    query_mode: 'keyword',
    query: term,
    result_count: matched.length,
    page: { limit, offset: 0, has_more: products.length > matched.length },
    entries: matched.map((product) => ({
      entry: toEntry(shop, product),
      score: 1,
      explain: [
        `瑞幸 searchProductForMcp 在「${shop.deptName}」匹配到该商品。`,
        `默认规格 ${describeDefault(product)}。`,
      ],
    })),
    policy_summary: {
      selected_capability_id: LUCKIN_CAPABILITY_ID,
      selected_query_pack: LUCKIN_QUERY_PACK,
      query_mode: 'keyword',
      supports_explain: true,
      accepted_filters: Object.keys(filters).filter((k) => HONORED_FILTERS.includes(k)),
      rejected_filters: rejected,
      warnings,
    },
    explain: [`在 ${shop.deptName} 实时检索「${term}」，命中 ${matched.length} 款（上游返回 ${products.length} 款）。`],
  });
}

/* ------------------------------------------------------------------ 解析 */

function bindingsFor(shop: Shop, productId: number, skuCode: string | undefined, purpose: string, expiresAt: string): unknown[] {
  const detailApi = {
    action_id: 'product_detail',
    action_type: 'api',
    label: '读取商品实时详情',
    description: '对应瑞幸 queryProductDetailInfo：返回全部可选规格与实时价格。',
    entrypoint: { url: `${BRIDGE_URL}/product`, method: 'POST' },
    input_schema: {
      type: 'object',
      required: ['deptId', 'productId'],
      properties: { deptId: { type: 'integer' }, productId: { type: 'integer' } },
    },
    auth_requirements: {},
    requires_user_confirmation: false,
    expires_at: expiresAt,
  };
  const configure = {
    action_id: 'configure_product',
    action_type: 'workflow',
    label: '选规格（多步）',
    description:
      '对应瑞幸 switchProduct。它无副作用：给定「当前 sku + 要改的属性」返回新的 skuCode 与完整属性树。' +
      '规格 id 可直接取自 resolve 的 visible_attributes.options（来自 queryProductDetailInfo）。' +
      '注意上游对杯型的展示名称不一致（detail 叫「超大杯」、switchProduct 叫「特大杯」），但 id 通用——已实测。',
    entrypoint: { url: `${BRIDGE_URL}/configure`, method: 'POST' },
    input_schema: {
      type: 'object',
      required: ['deptId', 'productId', 'skuCode', 'selections'],
      properties: {
        deptId: { type: 'integer' },
        productId: { type: 'integer' },
        skuCode: { type: 'string', description: `当前 sku，默认 ${skuCode ?? '(未知)'}` },
        amount: { type: 'integer', minimum: 1, maximum: 10 },
        selections: {
          type: 'array',
          description: '要切换的属性；按顺序依次应用。',
          items: {
            type: 'object',
            required: ['attributeId', 'subAttributeId'],
            properties: { attributeId: { type: 'integer' }, subAttributeId: { type: 'integer' } },
          },
        },
      },
    },
    auth_requirements: {},
    requires_user_confirmation: false,
    expires_at: expiresAt,
  };
  const preview = {
    action_id: 'preview_order',
    action_type: 'api',
    label: '订单预览（只算价，不产生订单）',
    description: '对应瑞幸 previewOrder：返回原价、优惠、实付、取餐时间与可用券。',
    entrypoint: { url: `${BRIDGE_URL}/preview`, method: 'POST' },
    input_schema: {
      type: 'object',
      required: ['deptId', 'productList'],
      properties: {
        deptId: { type: 'integer' },
        productList: {
          type: 'array',
          items: {
            type: 'object',
            required: ['productId', 'skuCode', 'amount'],
            properties: {
              productId: { type: 'integer' },
              skuCode: { type: 'string' },
              amount: { type: 'integer', minimum: 1, maximum: 10 },
            },
          },
        },
      },
    },
    auth_requirements: {},
    requires_user_confirmation: false,
  };
  const create = {
    action_id: 'create_order',
    action_type: 'workflow',
    label: '提交订单（真实扣款）',
    description:
      '对应瑞幸 createOrder。**会产生真实订单与实际支付。** 桥接层默认拒绝执行：' +
      '必须先用环境变量 LUCKIN_ORDER_CONFIRM 显式武装该订单的指纹，否则返回 428。',
    entrypoint: { url: `${BRIDGE_URL}/create`, method: 'POST' },
    input_schema: {
      type: 'object',
      required: ['deptId', 'productList'],
      properties: {
        deptId: { type: 'integer' },
        productList: {
          type: 'array',
          items: {
            type: 'object',
            required: ['productId', 'skuCode', 'amount'],
            properties: {
              productId: { type: 'integer' },
              skuCode: { type: 'string' },
              amount: { type: 'integer', minimum: 1, maximum: 10 },
            },
          },
        },
        couponCodeList: { type: 'array', items: { type: 'string' } },
        remark: { type: 'string' },
        /** 由 previewOrder 得到，交付时回传以对齐价格。 */
        expected_amount: { type: 'number', description: '预览得到的实付金额；不一致时拒绝下单' },
      },
    },
    auth_requirements: {},
    requires_user_confirmation: true,
    expires_at: expiresAt,
  };
  const queryOrder = {
    action_id: 'query_order',
    action_type: 'api',
    label: '查询订单详情',
    entrypoint: { url: `${BRIDGE_URL}/order/query`, method: 'POST' },
    input_schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } },
    auth_requirements: {},
    requires_user_confirmation: false,
  };
  const cancelOrder = {
    action_id: 'cancel_order',
    action_type: 'workflow',
    label: '取消订单',
    entrypoint: { url: `${BRIDGE_URL}/order/cancel`, method: 'POST' },
    input_schema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } },
    auth_requirements: {},
    requires_user_confirmation: true,
  };

  switch (purpose) {
    case 'checkout':
      return [preview, create];
    case 'workflow':
      return [detailApi, configure, preview, create, queryOrder, cancelOrder];
    case 'contact':
      // MCP 没有暴露门店电话，所以这里如实返回空而不是编一个联系方式。
      return [];
    case 'view':
    default:
      return [detailApi, configure];
  }
}

async function handleResolve(
  tools: LuckinTools,
  shop: Shop,
  body: Record<string, unknown>,
): Promise<OcpReply> {
  const entryId = typeof body.entry_id === 'string' ? body.entry_id : '';
  if (entryId === '') return fail('invalid_request', 'entry_id 必填', 400);

  const parsed = parseEntryId(entryId);
  if (parsed === undefined) {
    return fail('invalid_request', `entry_id 形状不对（应为 entry_luckin_<deptId>_<productId>）："${entryId}"`, 400);
  }
  if (parsed.deptId !== shop.deptId) {
    return fail(
      'catalog_mismatch',
      `entry_id 属于门店 ${parsed.deptId}，而本节点的门店是 ${shop.deptId}。请到对应门店的目录去 resolve。`,
      400,
    );
  }

  const purpose = body.purpose === undefined ? 'view' : body.purpose;
  if (!['view', 'checkout', 'contact', 'workflow'].includes(purpose as string)) {
    return fail('unsupported_purpose', `purpose 必须是 view | checkout | contact | workflow，收到 "${String(body.purpose)}"`, 400);
  }

  // resolve 是"实时"的：这里真的去查商品详情，而不是回放缓存。
  let detail: any;
  try {
    detail = await tools.productDetail({ deptId: shop.deptId, productId: parsed.productId });
  } catch (error) {
    return fail('upstream_error', `读取商品详情失败：${error instanceof Error ? error.message : String(error)}`, 502);
  }
  if (detail === null || typeof detail !== 'object') {
    return fail('not_found', `门店 ${shop.deptId} 没有 productId ${parsed.productId}`, 404);
  }

  const expiresAt = expiringAt(30);
  const liveCheck = body.live_check !== false;
  const storeOpen = shop.workStatus === '营业中';
  const price = detail.initialPrice ?? detail.estimatePrice ?? 0;
  const checkoutRequested = purpose === 'checkout' || purpose === 'workflow';
  const bindings = bindingsFor(shop, parsed.productId, detail.skuCode, purpose as string, expiresAt);

  const policyNotes: string[] = [
    'OCP 的 resolve 只返回可执行入口，不代客下单、不代客支付。',
    checkoutRequested
      ? 'create_order 绑定会产生真实订单与真实扣款；桥接层默认拒绝，需显式武装该订单指纹。'
      : '下单与支付在瑞幸侧完成。',
  ];
  if (!storeOpen) policyNotes.push(`门店当前状态「${shop.workStatus ?? '未知'}」，可能无法下单。`);
  if (purpose === 'contact') policyNotes.push('瑞幸 MCP 未暴露门店联系方式，因此本目录不提供 contact 绑定。');

  return json({
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: newId('res'),
    catalog_id: catalogIdFor(shop.deptId),
    entry_id: entryId,
    commercial_object_id: `co_luckin_${parsed.productId}`,
    object_id: String(parsed.productId),
    object_type: 'ocp.commerce.product',
    provider_id: LUCKIN_PROVIDER_ID,
    title: detail.productName ?? `productId ${parsed.productId}`,
    visible_attributes: {
      sku: detail.skuCode,
      brand: '瑞幸咖啡',
      category: '现制饮品',
      price: { currency: 'CNY', amount: price, price_type: 'fixed' },
      inventory: { availability_status: storeOpen ? 'in_stock' : 'unknown' },
      store: {
        deptId: shop.deptId,
        dept_name: shop.deptName,
        address: shop.address,
        work_hours: `${shop.workTimeStart ?? '?'}-${shop.workTimeEnd ?? '?'}`,
        work_status: shop.workStatus,
        distance_km: shop.distance,
      },
      /** 全部可选规格——来自瑞幸 queryProductDetailInfo，因此是实时值。 */
      options: (detail.productAttrs ?? []).map((a: any) => ({
        attribute_id: a.attributeId,
        attribute_name: a.attributeName,
        choices: (a.productSubAttrs ?? []).map((s: any) => ({
          sub_attribute_id: s.attributeId,
          name: s.attributeName,
          price_delta: s.price ?? 0,
        })),
      })),
    },
    access: {
      visibility: 'public',
      permission_state: storeOpen ? 'granted' : 'limited',
      redacted_fields: [],
      policy_notes: policyNotes,
    },
    live_checks: liveCheck
      ? [
          {
            check_id: 'store_open',
            status: storeOpen ? 'passed' : 'failed',
            checked_at: nowIso(),
            summary: `${shop.deptName}：${shop.workStatus ?? '状态未知'}（营业 ${shop.workTimeStart ?? '?'}-${shop.workTimeEnd ?? '?'}）`,
            details: { deptId: shop.deptId, work_status: shop.workStatus, distance_km: shop.distance },
          },
          {
            check_id: 'product_detail',
            status: 'passed',
            checked_at: nowIso(),
            summary: `实时读取到 ${detail.productName}，起价 ¥${price}`,
            details: { productId: parsed.productId, skuCode: detail.skuCode },
          },
        ]
      : [],
    action_bindings: bindings,
    freshness: { object_updated_at: nowIso(), resolved_at: nowIso() },
    expires_at: expiresAt,
  });
}

/* ------------------------------------------------------------------ 装配 */

export function luckinCatalogRoutes(storeDirectory: StoreDirectory, tools: LuckinTools): Route[] {
  const shopOr404 = (deptId: number): { shop?: Shop; reply?: OcpReply } => {
    const shop = storeDirectory.byDeptId(deptId);
    if (shop === undefined) {
      return { reply: fail('not_found', `门店 deptId=${deptId} 不在缓存的门店列表里。可先 GET /demo/stores 刷新。`, 404) };
    }
    return { shop };
  };

  return [
    {
      method: 'GET',
      path: '/demo/stores',
      handler: () => json({ note: '演示用：门店缓存全貌。', count: storeDirectory.list().length, loaded_at: storeDirectory.loadedAt(), stores: storeDirectory.list() }),
    },
    {
      method: 'POST',
      path: '/demo/stores/refresh',
      handler: async () => json({ note: '演示用：重新拉取门店列表。', count: (await storeDirectory.refresh()).length }),
    },
    {
      method: 'GET',
      path: '/stores/:deptId/.well-known/ocp-catalog',
      handler: (ctx) => {
        const deptId = Number(ctx.params.deptId);
        const found = shopOr404(deptId);
        if (found.reply !== undefined) return found.reply;
        const shop = found.shop as Shop;
        const base = baseUrlFor(shop.deptId);
        return json({
          ocp_version: '1.0',
          kind: 'WellKnownCatalogDiscovery',
          catalog_id: catalogIdFor(shop.deptId),
          catalog_name: `瑞幸咖啡 · ${shop.deptName}`,
          manifest_url: `${base}/ocp/manifest`,
          health_url: `${base}/ocp/health`,
          query_url: `${base}/ocp/query`,
          resolve_url: `${base}/ocp/resolve`,
          contracts_url: `${base}/ocp/contracts`,
        });
      },
    },
    {
      method: 'GET',
      path: '/stores/:deptId/ocp/manifest',
      handler: (ctx) => {
        const found = shopOr404(Number(ctx.params.deptId));
        if (found.reply !== undefined) return found.reply;
        return json(manifest(found.shop as Shop));
      },
    },
    {
      method: 'GET',
      path: '/stores/:deptId/ocp/health',
      handler: (ctx) => {
        const found = shopOr404(Number(ctx.params.deptId));
        if (found.reply !== undefined) return found.reply;
        const shop = found.shop as Shop;
        const ready = shop.workStatus === '营业中';
        return json({
          ocp_version: '1.0',
          kind: 'CatalogHealth',
          catalog_id: catalogIdFor(shop.deptId),
          status: ready ? 'healthy' : 'degraded',
          ready,
          checked_at: nowIso(),
        });
      },
    },
    {
      method: 'GET',
      path: '/stores/:deptId/ocp/contracts',
      handler: (ctx) => {
        const found = shopOr404(Number(ctx.params.deptId));
        if (found.reply !== undefined) return found.reply;
        return json({
          ocp_version: '1.0',
          kind: 'ObjectContractList',
          catalog_id: catalogIdFor((found.shop as Shop).deptId),
          object_contracts: [],
          note: '只读目录：数据实时取自瑞幸 MCP，不接受 provider 写入。',
        });
      },
    },
    {
      method: 'POST',
      path: '/stores/:deptId/ocp/query',
      handler: async (ctx) => {
        const found = shopOr404(Number(ctx.params.deptId));
        if (found.reply !== undefined) return found.reply;
        return handleQuery(tools, found.shop as Shop, ctx.body);
      },
    },
    {
      method: 'POST',
      path: '/stores/:deptId/ocp/resolve',
      handler: async (ctx) => {
        const found = shopOr404(Number(ctx.params.deptId));
        if (found.reply !== undefined) return found.reply;
        return handleResolve(tools, found.shop as Shop, ctx.body);
      },
    },
  ];
}
