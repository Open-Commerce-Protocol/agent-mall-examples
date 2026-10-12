/**
 * 瑞幸咖啡铺 —— 一个第三方按 OCP 规范实现的 Catalog Node。
 *
 * 六个协议端点:
 *   GET  /.well-known/ocp-catalog   发现入口:告诉 Agent「我在这」
 *   GET  /ocp/manifest              能力声明:支持哪些检索 pack、有哪些契约
 *   GET  /ocp/health                存活探测
 *   GET  /ocp/contracts             数据契约(ObjectContract)
 *   POST /ocp/query                 检索:返回「投影」(能看不能动)
 *   POST /ocp/resolve               解析:把一条结果变成「可执行的动作入口」
 *
 * 外加一个非协议端点 POST /shop/order(门店自己的下单接口,演示「协议负责把
 * Agent 送到门口,交易本身不归协议管」)。
 *
 * 核心设计:同一个 entry_id,purpose=view 返回普通 URL,purpose=checkout
 * 返回 API 下单动作 + 强制用户确认 + 10 分钟时效。
 */
import { MENU, searchableText, type Drink } from './menu';

const CATALOG_ID = process.env.CATALOG_ID ?? 'cat_luckin_demo';
const CATALOG_NAME = process.env.CATALOG_NAME ?? '瑞幸咖啡铺(浙大紫金港店)';
const PROVIDER_ID = 'luckin_zjg_store';
const PORT = Number(process.env.PORT ?? 4410);
const BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

/** 本节点声明的两个 query pack:官方同款 keyword pack(天然互通)+ 自定义 filter pack(前向扩展示范) */
const KEYWORD_PACK = 'ocp.query.keyword.v1';
const FILTER_PACK = 'luckin.query.filter.v1';
const DECLARED_PACKS = new Set([KEYWORD_PACK, FILTER_PACK]);

const entryId = (d: Drink) => `entry_${PROVIDER_ID}_${d.id}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(message: string): Response {
  return json({ error: { code: 'invalid_request', message } }, 400);
}

// ---------------------------------------------------------------- 发现与能力

function wellKnownDiscovery() {
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: CATALOG_ID,
    catalog_name: CATALOG_NAME,
    manifest_url: `${BASE_URL}/ocp/manifest`,
    health_url: `${BASE_URL}/ocp/health`,
    query_url: `${BASE_URL}/ocp/query`,
    resolve_url: `${BASE_URL}/ocp/resolve`,
    contracts_url: `${BASE_URL}/ocp/contracts`,
  };
}

function manifest() {
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${CATALOG_ID}`,
    catalog_id: CATALOG_ID,
    catalog_name: CATALOG_NAME,
    description: '瑞幸咖啡铺教学演示节点:把一杯咖啡的商品数据按 OCP 规范暴露给任意 Agent。',
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${BASE_URL}/ocp/health`, method: 'GET' },
      query: { url: `${BASE_URL}/ocp/query`, method: 'POST' },
      resolve: { url: `${BASE_URL}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${BASE_URL}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: 'luckin.menu.search.v1',
        name: 'Luckin menu search',
        description: 'Keyword + filter search over the in-store menu.',
        query_packs: [
          {
            pack_id: KEYWORD_PACK,
            description: '官方同款关键词检索:中文自然语言在 title/summary/tags 上匹配。',
            query_modes: ['keyword'],
          },
          {
            pack_id: FILTER_PACK,
            description: '自定义筛选 pack(前向扩展示范):支持 category / max_amount / in_stock_only 标准筛选字段。',
            query_modes: ['filter'],
          },
        ],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    object_contracts: [],
  };
}

function health() {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: CATALOG_ID,
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
  };
}

function contracts() {
  return {
    ocp_version: '1.0',
    kind: 'ObjectContractList',
    catalog_id: CATALOG_ID,
    object_contracts: [],
    note: '只读演示节点;商品数据来自店内内存菜单,不接受 Provider 在线接入。',
  };
}

// ---------------------------------------------------------------- 检索(query)

function toEntry(d: Drink) {
  return {
    kind: 'CatalogEntry',
    catalog_id: CATALOG_ID,
    entry_id: entryId(d),
    provider_id: PROVIDER_ID,
    object_id: d.id,
    object_type: 'ocp.commerce.product',
    title: d.title,
    summary: d.summary,
    attributes: {
      category: d.category,
      price: { currency: d.currency, amount: d.amount },
      inventory: { availability_status: d.availability },
      tags: d.tags,
      product_url: d.url,
    },
  };
}

/** 中文友好:先整体子串匹配,失败则退化成 2-gram 滑窗,按命中 gram 数打分 */
function keywordScore(query: string, d: Drink): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0.5;
  const text = searchableText(d);
  if (text.includes(q)) return 1;
  const grams = [...q].length >= 2 ? q.match(/.{2}/g) ?? [] : [q];
  const hits = grams.filter((g) => text.includes(g)).length;
  return grams.length ? Number((hits / grams.length).toFixed(2)) : 0;
}

type QueryFilters = {
  category?: string;
  brand?: string;
  min_amount?: number;
  max_amount?: number;
  in_stock_only?: boolean;
  has_image?: boolean;
};

const FILTER_FIELDS = new Set(['category', 'brand', 'min_amount', 'max_amount', 'in_stock_only', 'has_image']);

function query(body: Record<string, unknown>): Response {
  const pack = (body.query_pack as string | undefined) ?? KEYWORD_PACK;
  if (!DECLARED_PACKS.has(pack)) {
    return badRequest(`Undeclared query_pack "${pack}". Manifest declares: ${[...DECLARED_PACKS].join(', ')}`);
  }
  const offset = (body.offset as number | undefined) ?? 0;
  if (offset !== 0) {
    return badRequest('Pagination beyond offset 0 is not supported in this node (page.offset must be 0).');
  }
  const filters = (body.filters as QueryFilters | undefined) ?? {};
  const unknownFilters = Object.keys(filters).filter((k) => !FILTER_FIELDS.has(k));
  if (unknownFilters.length) {
    return badRequest(`Unknown filter field(s): ${unknownFilters.join(', ')}`);
  }
  if (pack === KEYWORD_PACK && Object.keys(filters).length > 0) {
    return badRequest(`Pack ${KEYWORD_PACK} does not declare filter support; use ${FILTER_PACK}.`);
  }

  const text = (body.query as string | undefined) ?? '';
  const limit = Math.min(Math.max((body.limit as number | undefined) ?? 20, 1), 50);

  let candidates: { drink: Drink; score: number; explain: string[] }[];
  if (pack === FILTER_PACK) {
    candidates = MENU.filter((d) => {
      if (filters.category && d.category !== filters.category) return false;
      if (filters.brand && PROVIDER_ID !== filters.brand && '瑞幸' !== filters.brand) return false;
      if (filters.min_amount !== undefined && d.amount < filters.min_amount) return false;
      if (filters.max_amount !== undefined && d.amount > filters.max_amount) return false;
      if (filters.in_stock_only && d.availability !== 'in_stock') return false;
      return true;
    }).map((d) => ({
      drink: d,
      score: 1,
      explain: [
        `filter match: ${Object.entries(filters)
          .map(([k, v]) => `${k}=${v}`)
          .join(' & ') || 'no filter'}`,
      ],
    }));
  } else {
    candidates = MENU.map((d) => ({ drink: d, score: keywordScore(text, d), explain: [`keyword match for "${text}"`] }))
      .filter((m) => m.score > 0.3)
      .sort((a, b) => b.score - a.score);
  }

  const page = candidates.slice(0, limit);
  return json({
    ocp_version: '1.0',
    kind: 'CatalogQueryResult',
    id: `qry_${crypto.randomUUID()}`,
    catalog_id: CATALOG_ID,
    query_pack: pack,
    query_mode: pack === FILTER_PACK ? 'filter' : 'keyword',
    query: text,
    result_count: page.length,
    page: { limit, offset: 0, has_more: candidates.length > page.length },
    entries: page.map((m) => ({ entry: toEntry(m.drink), score: m.score, explain: m.explain })),
    policy_summary: {
      selected_capability_id: 'luckin.menu.search.v1',
      selected_query_pack: pack,
      query_mode: pack === FILTER_PACK ? 'filter' : 'keyword',
      supports_explain: true,
      accepted_filters: pack === FILTER_PACK ? Object.keys(filters) : [],
      rejected_filters: [],
      warnings: [],
    },
  });
}

// ---------------------------------------------------------------- 解析(resolve)

function resolve(body: Record<string, unknown>): Response {
  const drink = MENU.find((d) => entryId(d) === body.entry_id);
  if (!drink) {
    return json(
      { error: { code: 'not_found', message: `Unknown entry_id: ${String(body.entry_id ?? '(missing)')}` } },
      404,
    );
  }
  const purpose = (body.purpose as string | undefined) ?? 'view';
  const now = new Date();
  const common = {
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: `res_${crypto.randomUUID()}`,
    catalog_id: CATALOG_ID,
    entry_id: entryId(drink),
    commercial_object_id: `co_${drink.id}`,
    object_id: drink.id,
    object_type: 'ocp.commerce.product',
    provider_id: PROVIDER_ID,
    title: drink.title,
    visible_attributes: {
      category: drink.category,
      price: { currency: drink.currency, amount: drink.amount },
      availability: drink.availability,
      tags: drink.tags,
    },
    live_checks: [
      {
        check_id: `chk_${drink.id}`,
        status: drink.availability === 'out_of_stock' ? 'failed' : 'passed',
        checked_at: now.toISOString(),
        summary: `店内库存:${drink.availability === 'in_stock' ? '有货' : drink.availability === 'low_stock' ? '少量' : '售罄'}`,
      },
    ],
    freshness: { object_updated_at: drink.updated_at, resolved_at: now.toISOString() },
    expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  } as const;

  if (purpose === 'view') {
    return json({
      ...common,
      action_bindings: [
        {
          action_id: 'view',
          action_type: 'url',
          label: '查看商品详情',
          entrypoint: { url: drink.url, method: 'GET' },
          requires_user_confirmation: false,
        },
      ],
    });
  }

  if (purpose === 'checkout') {
    return json({
      ...common,
      // 下单动作 10 分钟内有效
      expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      action_bindings: [
        {
          action_id: 'order',
          action_type: 'api',
          label: `下单一杯「${drink.title}」`,
          description: '门店自有下单接口(非 OCP 协议端点);调用前必须获得用户确认。',
          entrypoint: { url: `${BASE_URL}/shop/order`, method: 'POST' },
          input_schema: {
            object_id: 'string (= resolve 返回的 object_id)',
            quantity: 'integer, default 1',
            confirmation: 'boolean, 必须为 true(用户已确认)',
          },
          auth_requirements: { payment: 'mock' },
          requires_user_confirmation: true,
          expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        },
      ],
    });
  }

  return badRequest(`Purpose "${purpose}" is not supported for ocp.commerce.product in this node.`);
}

// ---------------------------------------------------------------- 下单(非协议)

const orders: Array<{ order_id: string; drink: string; total: number; pickup_code: string }> = [];

async function placeOrder(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Body must be JSON.');
  }
  if (body.confirmation !== true) {
    return badRequest('requires_user_confirmation: 用户未确认,拒绝下单。');
  }
  const drink = MENU.find((d) => d.id === body.object_id);
  if (!drink) {
    return json({ error: { code: 'not_found', message: `Unknown object_id: ${String(body.object_id ?? '(missing)')}` } }, 404);
  }
  if (drink.availability === 'out_of_stock') {
    return json({ error: { code: 'conflict', message: `「${drink.title}」已售罄。` } }, 409);
  }
  const quantity = Math.min(Math.max(Number(body.quantity ?? 1), 1), 9);
  const order = {
    order_id: `LK${Date.now().toString().slice(-8)}`,
    drink: drink.title,
    total: Number((drink.amount * quantity).toFixed(2)),
    pickup_code: String(1000 + orders.length + 1),
  };
  orders.push(order);
  return json({
    ...order,
    currency: 'CNY',
    quantity,
    payment: 'mock-paid(演示环境,未产生真实扣款)',
    status: 'accepted',
    store: CATALOG_NAME,
  }, 201);
}

// ---------------------------------------------------------------- 路由

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (method === 'GET' && pathname === '/.well-known/ocp-catalog') return json(wellKnownDiscovery());
  if (method === 'GET' && pathname === '/ocp/manifest') return json(manifest());
  if (method === 'GET' && pathname === '/ocp/health') return json(health());
  if (method === 'GET' && pathname === '/ocp/contracts') return json(contracts());
  if (method === 'POST' && pathname === '/ocp/query') return query(await readJson(request));
  if (method === 'POST' && pathname === '/ocp/resolve') return resolve(await readJson(request));
  if (method === 'POST' && pathname === '/shop/order') return placeOrder(request);
  if (method === 'GET' && pathname === '/shop/orders') return json({ orders });

  return json({ error: { code: 'not_found', message: `No route for ${method} ${pathname}` } }, 404);
}

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: handle });
  console.log(`☕ 瑞幸咖啡铺 OCP Catalog Node 已开门:${BASE_URL}`);
  console.log(`   发现入口:GET ${BASE_URL}/.well-known/ocp-catalog`);
}
