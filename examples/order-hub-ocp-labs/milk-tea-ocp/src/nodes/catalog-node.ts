/**
 * OCP Catalog 节点 —— 一家奶茶铺的协议门面。
 *
 * 端点与上游最小示例一致（examples/typescript/src/server.ts）：
 *   GET  /.well-known/ocp-catalog  发现文档
 *   GET  /ocp/manifest             能力声明
 *   GET  /ocp/health               存活
 *   GET  /ocp/contracts            对象契约（只读节点为空）
 *   POST /ocp/query                查询
 *   POST /ocp/resolve              解析成 action bindings
 *
 * 与示例的三处刻意差异，都是为了让"点单"这条链路真实可走：
 *  1. query 实现了 manifest 声明的 filters 与 policy_summary；
 *  2. resolve 按 `purpose` 返回不同绑定，且售罄时**不给**下单入口；
 *  3. 下单绑定指向本店真实的 /order 页面与 JSON API。
 *
 * 字段约束全部来自 packages/ocp-schema/src/index.ts（见 README 的"契约来源"）。
 */
import { fail, json, type Ctx, type OcpReply, type Route } from '../lib/http.ts';
import { entryIdFor, newId } from '../lib/ids.ts';
import { listOrders } from '../lib/orders.ts';
import type { MilkTea, Shop } from '../shops/types.ts';
import { shopPageRoutes } from './shop-pages.ts';

/** 查询请求里允许出现的顶层字段（Zod 的 catalogQueryRequestSchema 是 .strict()）。 */
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

/** filters 的封闭字段集，来自 catalogQueryFiltersSchema。 */
const FILTER_KEYS = [
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

type QueryFilters = {
  category?: string;
  brand?: string;
  currency?: string;
  availability_status?: string;
  provider_id?: string;
  sku?: string;
  min_amount?: number;
  max_amount?: number;
  in_stock_only?: boolean;
  has_image?: boolean;
};

const nowIso = (): string => new Date().toISOString();
const expiringAt = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

/* ------------------------------------------------------------------ 发现层 */

function wellKnownDiscovery(shop: Shop): unknown {
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: shop.catalog_id,
    catalog_name: shop.catalog_name,
    manifest_url: `${shop.base_url}/ocp/manifest`,
    health_url: `${shop.base_url}/ocp/health`,
    query_url: `${shop.base_url}/ocp/query`,
    resolve_url: `${shop.base_url}/ocp/resolve`,
    contracts_url: `${shop.base_url}/ocp/contracts`,
  };
}

function manifest(shop: Shop): unknown {
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${shop.catalog_id}`,
    catalog_id: shop.catalog_id,
    catalog_name: shop.catalog_name,
    description: shop.description,
    registry_visibility: shop.registry_visibility,
    endpoints: {
      health: { url: `${shop.base_url}/ocp/health`, method: 'GET' },
      query: { url: `${shop.base_url}/ocp/query`, method: 'POST' },
      resolve: { url: `${shop.base_url}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${shop.base_url}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: shop.query_capability_id,
        name: '奶茶关键字检索',
        description: '在品名、茶底、分类、加料与标签上做不区分大小写的关键字匹配，支持 manifest 声明的过滤器。',
        query_packs: [
          {
            pack_id: shop.query_pack,
            description: '奶茶关键字检索包：只声明 keyword 一种执行模式。',
            query_modes: ['keyword'],
          },
        ],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    // 只读节点：不接收 provider 数据同步，但该字段仍然必填。
    object_contracts: [],
  };
}

function health(shop: Shop): unknown {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: shop.catalog_id,
    status: 'healthy',
    ready: true,
    checked_at: nowIso(),
  };
}

function contracts(shop: Shop): unknown {
  return {
    ocp_version: '1.0',
    kind: 'ObjectContractList',
    catalog_id: shop.catalog_id,
    object_contracts: [],
    note: '只读演示节点：不接受 provider 对象写入。',
  };
}

/* -------------------------------------------------------------------- 条目 */

function toEntry(shop: Shop, item: MilkTea): unknown {
  return {
    kind: 'CatalogEntry',
    catalog_id: shop.catalog_id,
    entry_id: entryIdFor(shop.provider_id, item.sku),
    provider_id: shop.provider_id,
    object_id: item.sku,
    object_type: 'ocp.commerce.product',
    commercial_object_id: `co_${shop.provider_id}_${item.sku}`,
    title: item.title,
    summary: item.summary,
    attributes: {
      sku: item.sku,
      brand: shop.catalog_name,
      category: item.category,
      base: item.base,
      toppings: item.toppings,
      sizes: item.sizes,
      sugar_levels: item.sugar_levels,
      temperatures: item.temperatures,
      tags: item.tags,
      price: {
        currency: item.currency,
        amount: item.amount,
        list_amount: item.list_amount,
        price_type: 'fixed',
      },
      inventory: { availability_status: item.availability, quantity: item.quantity },
      product_url: `${shop.base_url}/menu#${item.sku}`,
      store: { city: shop.store.city, address: shop.store.address, open_hours: shop.store.open_hours },
    },
  };
}

/* -------------------------------------------------------------------- 查询 */

/** 未知字段直接拒——因为请求 schema 是 .strict()，静默丢弃会让调用方误判成功。 */
function unknownKeys(body: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(body).filter((k) => !allowed.includes(k));
}

function matchScore(item: MilkTea, term: string): { score: number; fields: string[] } | undefined {
  if (term === '') return { score: 1, fields: [] };
  const t = term.toLowerCase();
  const fields: string[] = [];
  let score = 0;
  if (item.title.toLowerCase().includes(t)) {
    score += 1;
    fields.push('title');
  }
  if (item.tags.some((x) => x.toLowerCase().includes(t))) {
    score += 0.8;
    fields.push('tags');
  }
  if (item.base.toLowerCase().includes(t)) {
    score += 0.6;
    fields.push('base');
  }
  if (item.category.toLowerCase().includes(t)) {
    score += 0.5;
    fields.push('category');
  }
  if (item.toppings.some((x) => x.toLowerCase().includes(t))) {
    score += 0.4;
    fields.push('toppings');
  }
  if (item.summary.toLowerCase().includes(t)) {
    score += 0.3;
    fields.push('summary');
  }
  return fields.length === 0 ? undefined : { score: Math.round(score * 100) / 100, fields };
}

function passFilters(shop: Shop, item: MilkTea, filters: QueryFilters): boolean {
  const f = filters;
  if (f.category !== undefined && item.category !== f.category) return false;
  if (f.brand !== undefined && shop.catalog_name !== f.brand) return false;
  if (f.currency !== undefined && item.currency !== f.currency) return false;
  if (f.availability_status !== undefined && item.availability !== f.availability_status) return false;
  if (f.provider_id !== undefined && shop.provider_id !== f.provider_id) return false;
  if (f.sku !== undefined && item.sku !== f.sku) return false;
  if (f.min_amount !== undefined && item.amount < f.min_amount) return false;
  if (f.max_amount !== undefined && item.amount > f.max_amount) return false;
  if (f.in_stock_only === true && item.availability !== 'in_stock') return false;
  // 本菜单没有配图，所以 has_image: true 必然返回空——这是真实结果，不是缺省行为。
  if (f.has_image === true) return false;
  return true;
}

function handleQuery(shop: Shop, body: Record<string, unknown>): OcpReply {
  const extra = unknownKeys(body, QUERY_KEYS);
  if (extra.length > 0) {
    return fail(
      'unexpected_field',
      `查询请求不接受字段：${extra.join(', ')}。允许的字段：${QUERY_KEYS.join(', ')}`,
      400,
    );
  }

  if (body.catalog_id !== undefined && body.catalog_id !== shop.catalog_id) {
    return fail(
      'catalog_mismatch',
      `catalog_id 应为 "${shop.catalog_id}"，收到 "${String(body.catalog_id)}"`,
      400,
    );
  }

  const pack = body.query_pack === undefined ? shop.query_pack : body.query_pack;
  if (pack !== shop.query_pack) {
    return fail(
      'unsupported_query_pack',
      `本节点只声明了 query_pack "${shop.query_pack}"，收到 "${String(body.query_pack)}"。` +
        `可先用 GET /ocp/manifest 查看能力声明。`,
      400,
    );
  }

  const mode = body.query_mode === undefined ? 'keyword' : body.query_mode;
  if (mode !== 'keyword') {
    return fail(
      'unsupported_query_mode',
      `query_pack "${shop.query_pack}" 只声明了 keyword 模式，收到 "${String(body.query_mode)}"`,
      400,
    );
  }

  const rawQuery = body.query === undefined ? '' : body.query;
  if (typeof rawQuery !== 'string') return fail('invalid_request', 'query 必须是字符串', 400);
  if (rawQuery.length > 500) return fail('invalid_request', 'query 最长 500 字符', 400);
  const term = rawQuery.trim();

  const rawFilters = body.filters === undefined ? {} : body.filters;
  if (typeof rawFilters !== 'object' || rawFilters === null || Array.isArray(rawFilters)) {
    return fail('invalid_request', 'filters 必须是 JSON 对象', 400);
  }
  const filters = rawFilters as Record<string, unknown>;
  const badFilters = unknownKeys(filters, FILTER_KEYS);
  if (badFilters.length > 0) {
    return fail(
      'unsupported_filter',
      `本节点不接受过滤器：${badFilters.join(', ')}。可用过滤器：${FILTER_KEYS.join(', ')}`,
      400,
    );
  }

  if (body.offset !== undefined && body.offset !== 0) {
    return fail('invalid_request', 'offset 目前只支持 0', 400);
  }
  if (body.limit !== undefined && (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50)) {
    return fail('invalid_request', 'limit 必须是 1..50 的整数', 400);
  }
  const limit = typeof body.limit === 'number' ? body.limit : 20;

  const typedFilters = filters as QueryFilters;
  const matched = shop.menu
    .map((item) => {
      const hit = matchScore(item, term);
      if (hit === undefined) return undefined;
      if (!passFilters(shop, item, typedFilters)) return undefined;
      return { item, hit };
    })
    .filter((x): x is { item: MilkTea; hit: { score: number; fields: string[] } } => x !== undefined)
    .sort((a, b) => b.hit.score - a.hit.score);

  const page = matched.slice(0, limit);
  const acceptedFilters = Object.keys(filters);

  return json({
    ocp_version: '1.0',
    kind: 'CatalogQueryResult',
    id: newId('qry'),
    catalog_id: shop.catalog_id,
    query_pack: shop.query_pack,
    query_mode: 'keyword',
    query: term,
    result_count: page.length,
    page: { limit, offset: 0, has_more: matched.length > page.length },
    entries: page.map(({ item, hit }) => ({
      entry: toEntry(shop, item),
      score: hit.score,
      explain: [
        hit.fields.length === 0
          ? '空查询：返回全部条目。'
          : `命中字段 ${hit.fields.join(', ')}，关键字 "${term}"。`,
      ],
    })),
    policy_summary: {
      selected_capability_id: shop.query_capability_id,
      selected_query_pack: shop.query_pack,
      query_mode: 'keyword',
      supports_explain: true,
      accepted_filters: acceptedFilters,
      rejected_filters: [],
      warnings:
        typedFilters.has_image === true
          ? ['本菜单没有配图，has_image: true 因此返回 0 条。']
          : [],
    },
    explain: [`在 ${shop.catalog_name} 的 ${shop.menu.length} 款饮品中匹配 "${term}"。`],
  });
}

/* -------------------------------------------------------------------- 解析 */

/**
 * 按 purpose 选择 action bindings。
 *
 * 这是整个演示最想说清楚的一处：resolve 交出去的是"入口"，不是"成交"。
 * 因此每个下单绑定都带 requires_user_confirmation，且售罄时根本不给下单入口。
 */
function bindingsFor(shop: Shop, item: MilkTea, purpose: string, expiresAt: string): unknown[] {
  const entryId = entryIdFor(shop.provider_id, item.sku);
  const view = {
    action_id: 'view_product',
    action_type: 'url',
    label: `查看 ${item.title} 详情`,
    description: '本店菜单页，锚定到该款饮品。',
    entrypoint: { url: `${shop.base_url}/menu#${item.sku}`, method: 'GET' },
    auth_requirements: {},
    requires_user_confirmation: false,
  };
  const contact = {
    action_id: 'contact_store',
    action_type: 'contact',
    label: `联系门店 ${shop.store.phone}`,
    description: `${shop.catalog_name} · ${shop.store.address} · ${shop.store.open_hours}`,
    entrypoint: { url: `${shop.base_url}/store`, method: 'GET' },
    auth_requirements: {},
    requires_user_confirmation: false,
  };
  const sellable = item.availability !== 'out_of_stock';
  const checkoutPage = {
    action_id: 'checkout_page',
    action_type: 'url',
    label: '去下单（网页）',
    description: '商户侧下单页。OCP 只提供入口，成交与支付在商户侧完成。',
    entrypoint: {
      url: `${shop.base_url}/order?entry_id=${encodeURIComponent(entryId)}`,
      method: 'GET',
    },
    auth_requirements: {},
    requires_user_confirmation: true,
    expires_at: expiresAt,
  };
  const checkoutApi = {
    action_id: 'checkout_api',
    action_type: 'api',
    label: '去下单（JSON API）',
    description: '同一路径的机器接口：POST JSON 返回 JSON 订单。',
    entrypoint: { url: `${shop.base_url}/order`, method: 'POST' },
    input_schema: {
      type: 'object',
      required: ['sku', 'size'],
      properties: {
        sku: { type: 'string', const: item.sku },
        size: { type: 'string', enum: item.sizes.map((s) => s.id) },
        sugar: { type: 'string', enum: item.sugar_levels },
        temperature: { type: 'string', enum: item.temperatures },
        toppings: { type: 'array', items: { type: 'string', enum: item.toppings } },
        quantity: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
    auth_requirements: {},
    requires_user_confirmation: true,
    expires_at: expiresAt,
  };

  const checkoutBindings = sellable ? [checkoutPage, checkoutApi] : [];

  switch (purpose) {
    case 'checkout':
      return checkoutBindings;
    case 'contact':
      return [contact];
    case 'workflow':
      return [view, ...checkoutBindings, contact];
    case 'view':
    default:
      return [view];
  }
}

function handleResolve(shop: Shop, body: Record<string, unknown>): OcpReply {
  const entryId = typeof body.entry_id === 'string' ? body.entry_id : '';
  if (entryId === '') return fail('invalid_request', 'entry_id 必填', 400);

  const item = shop.menu.find((m) => entryIdFor(shop.provider_id, m.sku) === entryId);
  if (item === undefined) {
    return fail('not_found', `本店没有 entry_id "${entryId}"。可先 query 再 resolve。`, 404);
  }

  const purpose = body.purpose === undefined ? 'view' : body.purpose;
  if (!['view', 'checkout', 'contact', 'workflow'].includes(purpose as string)) {
    return fail(
      'unsupported_purpose',
      `purpose 必须是 view | checkout | contact | workflow，收到 "${String(body.purpose)}"`,
      400,
    );
  }

  const liveCheck = body.live_check !== false;
  const expiresAt = expiringAt(60);
  const outOfStock = item.availability === 'out_of_stock';
  const checkoutRequested = purpose === 'checkout' || purpose === 'workflow';

  const policyNotes: string[] = [
    'OCP 的 resolve 只返回可执行入口，不代客下单、不代客支付。',
    checkoutRequested && outOfStock
      ? `${item.title} 当前已售罄，因此不提供下单入口。`
      : '下单与支付在商户侧完成（本演示为模拟）。',
  ];

  return json({
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: newId('res'),
    catalog_id: shop.catalog_id,
    entry_id: entryId,
    commercial_object_id: `co_${shop.provider_id}_${item.sku}`,
    object_id: item.sku,
    object_type: 'ocp.commerce.product',
    provider_id: shop.provider_id,
    title: item.title,
    visible_attributes: {
      sku: item.sku,
      brand: shop.catalog_name,
      category: item.category,
      base: item.base,
      toppings: item.toppings,
      sizes: item.sizes,
      sugar_levels: item.sugar_levels,
      temperatures: item.temperatures,
      price: {
        currency: item.currency,
        amount: item.amount,
        list_amount: item.list_amount,
        price_type: 'fixed',
      },
      inventory: { availability_status: item.availability, quantity: item.quantity },
      store: {
        city: shop.store.city,
        address: shop.store.address,
        open_hours: shop.store.open_hours,
        phone: shop.store.phone,
      },
    },
    access: {
      visibility: 'public',
      permission_state: checkoutRequested && outOfStock ? 'limited' : 'granted',
      redacted_fields: [],
      policy_notes: policyNotes,
    },
    live_checks: liveCheck
      ? [
          {
            check_id: 'inventory',
            status: outOfStock ? 'failed' : item.availability === 'low_stock' ? 'unknown' : 'passed',
            checked_at: nowIso(),
            summary: outOfStock
              ? `${item.title} 已售罄`
              : item.availability === 'low_stock'
                ? `${item.title} 仅剩 ${item.quantity} 杯`
                : `${item.title} 有货（${item.quantity} 杯）`,
            details: { availability_status: item.availability, quantity: item.quantity },
          },
        ]
      : [],
    action_bindings: bindingsFor(shop, item, purpose as string, expiresAt),
    freshness: { object_updated_at: item.updated_at, resolved_at: nowIso() },
    expires_at: expiresAt,
  });
}

/* -------------------------------------------------------------------- 装配 */

export function catalogRoutes(shop: Shop): Route[] {
  const protocol: Route[] = [
    { method: 'GET', path: '/.well-known/ocp-catalog', handler: () => json(wellKnownDiscovery(shop)) },
    { method: 'GET', path: '/ocp/manifest', handler: () => json(manifest(shop)) },
    { method: 'GET', path: '/ocp/health', handler: () => json(health(shop)) },
    { method: 'GET', path: '/ocp/contracts', handler: () => json(contracts(shop)) },
    { method: 'POST', path: '/ocp/query', handler: (ctx: Ctx) => handleQuery(shop, ctx.body) },
    { method: 'POST', path: '/ocp/resolve', handler: (ctx: Ctx) => handleResolve(shop, ctx.body) },
    // 演示辅助端点：明确放在 /demo 下，避免污染 OCP 命名空间。
    {
      method: 'GET',
      path: '/demo/orders',
      handler: () =>
        json({
          note: '演示用：本店进程内的模拟订单，未发生真实支付。',
          count: listOrders().length,
          orders: listOrders(),
        }),
    },
  ];
  return [...protocol, ...shopPageRoutes(shop)];
}
