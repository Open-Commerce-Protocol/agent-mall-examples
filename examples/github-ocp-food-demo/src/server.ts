/**
 * OCP Food Demo —— 一个合规的 OCP Catalog Node。
 *
 * 五个协议端点 + 一个边界之外的执行入口：
 *   GET  /.well-known/ocp-catalog   发现
 *   GET  /ocp/manifest              能力声明
 *   GET  /ocp/health                存活探测
 *   GET  /ocp/contracts             数据契约 (ObjectContract)
 *   POST /ocp/query                 检索 → 数据投影（能看不能动）
 *   POST /ocp/resolve               解析 → 动作入口（可点、可下单）
 *   POST /ocp/execute               ★ 边界之外：商家自己的执行入口
 *
 * 三家 mock 店 + 一家真实 Provider（瑞幸，透过官方 MCP 接入）。
 * 瑞幸的存在证明了「适配器层」这个分层：协议层完全不关心上游是 MCP 还是别的。
 */
import { SHOPS, shopById, matchConstraints, project, type Constraints, type Shop } from './shops';
import {
  checkDiscovery, checkManifest, checkHealth, checkContracts,
  checkQueryResult, checkResolveResult, scanLeaks, type Issue,
} from './ocp-schema';
import { luckinFromEnv, type LuckinMcpClient } from './luckin-mcp';

const PORT = Number(process.env.PORT ?? 4400);
const BASE = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');

/* ───────────────────────── 路由工具 ───────────────────────── */

/** /{shopId}/ocp/query → shopId = 'noodle'。单层前缀，无歧义。 */
function parseRoute(pathname: string): { shopId: string | null; path: string } {
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length === 0) return { shopId: null, path: '/' };
  if (seg[0] === '.well-known' || seg[0] === 'ocp' || seg[0] === 'api' || seg[0] === 'assets') {
    return { shopId: null, path: pathname };
  }
  return { shopId: seg[0]!, path: '/' + seg.slice(1).join('/') };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });

const err = (code: string, message: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...extra } }, status);

async function readJson(req: Request): Promise<Record<string, any>> {
  try {
    const p = await req.json();
    return typeof p === 'object' && p !== null ? p : {};
  } catch {
    return {};
  }
}

/* ───────────────────────── 目录索引 ─────────────────────────
 * 这是一个「聚合层」，让 Agent 一句话查遍所有店铺。
 * 严格说它扮演的是 Registration Node 的角色：只索引 metadata，
 * 不持有商品对象。
 */

function catalogIndexEntry(s: Shop, deptId?: number) {
  return {
    catalog_id: catalogId(s),
    catalog_name: s.name,
    description: s.description,
    homepage: s.homepage,
    manifest_url: `${BASE}/${s.id}/ocp/manifest`,
    well_known_url: `${BASE}/${s.id}/.well-known/ocp-catalog`,
    supported_query_modes: ['keyword', 'filter'],
    supported_query_packs: ['ocp.query.keyword.v1', 'ocp.query.meal.v1'],
    supports_resolve: true,
    tags: [...new Set(s.menu.flatMap((m) => m.tags))].slice(0, 8),
    domains: s.domains,
    verification_status: s.verification,
    trust_tier: s.trust,
    health_status: s.healthy ? 'healthy' : 'degraded',
    ...(deptId ? { provider_dept_id: deptId } : {}),
  };
}

const catalogId = (s: Shop) => `${s.id}.demo`;

/* ───────────────────────── 协议端点 ───────────────────────── */

function discovery(s: Shop) {
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: catalogId(s),
    catalog_name: s.name,
    manifest_url: `${BASE}/${s.id}/ocp/manifest`,
    health_url: `${BASE}/${s.id}/ocp/health`,
    query_url: `${BASE}/${s.id}/ocp/query`,
    resolve_url: `${BASE}/${s.id}/ocp/resolve`,
    contracts_url: `${BASE}/${s.id}/ocp/contracts`,
  };
}

function manifest(s: Shop) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${catalogId(s)}`,
    catalog_id: catalogId(s),
    catalog_name: s.name,
    description: s.description,
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${BASE}/${s.id}/ocp/health`, method: 'GET' },
      query: { url: `${BASE}/${s.id}/ocp/query`, method: 'POST' },
      resolve: { url: `${BASE}/${s.id}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${BASE}/${s.id}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: `ocp.${s.id}.meal.search.v1`,
        name: '菜品检索',
        description: '按关键词与结构化约束检索菜品。',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: '对菜名、描述、标签做关键词匹配。',
            query_modes: ['keyword'],
          },
          {
            pack_id: 'ocp.query.meal.v1',
            description: '按辣度、预算、出餐时间等结构化约束检索，并由商家侧决定推荐哪一道。',
            query_modes: ['filter'],
          },
        ],
        searchable_field_refs: ['ocp.commerce.product.core.v1#/title'],
        filterable_field_refs: ['ocp.commerce.price.v1#/amount'],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    object_contracts: [
      {
        pack_id: 'ocp.commerce.product.core.v1',
        object_type: 'ocp.commerce.product',
        name: '菜品核心属性',
        description: '菜名、描述、图片等可用于展示的字段。',
        field_rules: [
          { field_ref: 'ocp.commerce.product.core.v1#/title', requirement: 'required', usage: ['identity', 'display', 'search_visible'] },
          { field_ref: 'ocp.commerce.product.core.v1#/description', requirement: 'optional', usage: ['display'] },
        ],
      },
      {
        pack_id: 'ocp.commerce.price.v1',
        object_type: 'ocp.commerce.product',
        name: '价格',
        description: '展示价与币种。',
        field_rules: [
          { field_ref: 'ocp.commerce.price.v1#/amount', requirement: 'required', usage: ['display', 'filter'] },
          { field_ref: 'ocp.commerce.price.v1#/currency', requirement: 'required', usage: ['display'] },
        ],
      },
      {
        pack_id: 'ocp.commerce.inventory.v1',
        object_type: 'ocp.commerce.product',
        name: '履约能力',
        description: '出餐时间与堂食/外卖可用性。',
        field_rules: [
          { field_ref: 'ocp.commerce.inventory.v1#/prep_minutes', requirement: 'optional', usage: ['display', 'filter'] },
        ],
      },
    ],
  };
}

function health(s: Shop) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: catalogId(s),
    status: s.healthy ? 'healthy' : 'degraded',
    ready: s.healthy,
    checked_at: new Date().toISOString(),
    manifest_version: '1.0.0',
    details: { shop_id: s.id, ...(s.unhealthy_reason ? { reason: s.unhealthy_reason } : {}) },
    dependencies: s.is_luckin
      ? [
          {
            name: 'luckin-mcp',
            status: luckin ? (luckinUpstreamOk ? 'healthy' : 'degraded') : 'unhealthy',
            message: luckin
              ? luckinUpstreamOk
                ? `已连上 ${luckinDeptCache?.deptName ?? '门店'}`
                : '上游暂不可达'
              : '未配置 token',
          },
        ]
      : [],
  };
}

function contracts(s: Shop) {
  const m = manifest(s);
  return {
    ocp_version: '1.0',
    kind: 'ObjectContractList',
    catalog_id: catalogId(s),
    object_contracts: m.object_contracts,
  };
}

function matchSpicy(level: number, want: string) {
  if (want === 'none') return level <= 1;
  if (want === 'mild') return level <= 2;
  if (want === 'high') return level >= 2;
  return true;
}

/* ────────────────── query：返回数据投影（能看不能动） ────────────────── */

function handleQuery(s: Shop, body: any) {
  const pack = body.query_pack ?? 'ocp.query.keyword.v1';
  const mode = pack === 'ocp.query.meal.v1' ? 'filter' : 'keyword';
  const limit = Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 50);

  // 声明了不支持的 pack → 400（规范要求的边界行为）
  const declared = manifest(s).query_capabilities.flatMap((c) => c.query_packs.map((p) => p.pack_id));
  if (!declared.includes(pack)) {
    return err('unsupported_query_pack', `未声明的 query_pack: ${pack}`, 400, { declared_packs: declared });
  }

  if (!s.healthy) {
    return json({
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: catalogId(s),
      query_pack: pack,
      query_mode: mode,
      query: String(body.query ?? ''),
      result_count: 0,
      page: { limit, offset: 0, has_more: false },
      entries: [],
      merchant_pick: null,
      note: s.unhealthy_reason ?? '当前不可用',
      // 降级时也给出处 —— 反而更重要：让 Agent 知道「为什么没结果」
      provenance: {
        provider_id: s.provider_id,
        verification_status: s.verification,
        trust_tier: s.trust,
        source: s.is_luckin ? 'luckin-mcp' : 'in-memory-demo',
        health_status: 'degraded',
      },
    });
  }

  const k: Constraints = {
    spicy: body.constraints?.spicy,
    budget: body.constraints?.budget ?? body.filters?.budget_max,
    minutes: body.constraints?.minutes,
    keywords: body.query || body.constraints?.keywords,
  };

  const matched = s.menu.filter((m) => matchConstraints(m, k));

  // ★ B 层：由商家侧决定推哪个
  const picked = matched.length ? s.pick(matched, k) : undefined;

  const entries = matched.slice(0, limit).map((m) => ({
    entry: {
      kind: 'CatalogEntry',
      catalog_id: catalogId(s),
      entry_id: m.entry_id,
      provider_id: s.provider_id,
      object_id: m.entry_id,
      object_type: 'ocp.commerce.product',
      title: m.name,
      summary: m.desc,
      attributes: project(m),
    },
    score: m === picked ? 1 : 0.7,
    explain: [
      m === picked
        ? `${s.name}${s.explain_rule}，推荐了这一道。`
        : `符合你的约束，作为备选。`,
      ...(k.budget != null ? [`价格 ${m.price} 元，在你的 ${k.budget} 元预算内。`] : []),
      ...(k.minutes != null ? [`预计 ${m.minutes} 分钟。`] : []),
    ],
  }));

  return json({
    ocp_version: '1.0',
    kind: 'CatalogQueryResult',
    id: `qry_${crypto.randomUUID()}`,
    catalog_id: catalogId(s),
    query_pack: pack,
    query_mode: mode,
    query: String(body.query ?? ''),
    result_count: entries.length,
    page: { limit, offset: 0, has_more: false },
    entries,
    // 商家侧的推荐结论（B 层）—— 非协议字段，放在显式的扩展位
    merchant_pick: picked
      ? {
          entry_id: picked.entry_id,
          reason: `${s.explain_rule}，且符合你给的约束。`,
          candidates_considered: matched.length,
        }
      : null,
    provenance: {
      provider_id: s.provider_id,
      verification_status: s.verification,
      trust_tier: s.trust,
      source: s.is_luckin ? 'luckin-mcp' : 'in-memory-demo',
    },
  });
}

/**
 * 瑞幸版的 query —— 上游是实时 MCP，不是本地菜单。
 * 这是适配器真正接通的地方：对外的 CatalogQueryResult 形状和 mock 店完全一致，
 * Agent 那边看不出区别。
 */
async function handleLuckinQuery(s: Shop, body: any) {
  const pack = body.query_pack ?? 'ocp.query.keyword.v1';
  const mode = pack === 'ocp.query.meal.v1' ? 'filter' : 'keyword';
  const limit = Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 20);

  const declared = manifest(s).query_capabilities.flatMap((c) => c.query_packs.map((p) => p.pack_id));
  if (!declared.includes(pack)) {
    return err('unsupported_query_pack', `未声明的 query_pack: ${pack}`, 400, { declared_packs: declared });
  }

  const prov = {
    provider_id: s.provider_id,
    verification_status: s.verification,
    trust_tier: s.trust,
    source: 'luckin-mcp',
  };

  if (!luckin) {
    return json({
      ocp_version: '1.0', kind: 'CatalogQueryResult', id: `qry_${crypto.randomUUID()}`,
      catalog_id: catalogId(s), query_pack: pack, query_mode: mode,
      query: String(body.query ?? ''), result_count: 0,
      page: { limit, offset: 0, has_more: false }, entries: [], merchant_pick: null,
      note: '未配置瑞幸 MCP token，已降级为空结果',
      provenance: { ...prov, source: 'unavailable' },
    });
  }

  const k: Constraints = {
    budget: body.constraints?.budget ?? body.filters?.budget_max,
    minutes: body.constraints?.minutes,
    keywords: body.query || '',
  };

  try {
    const raw = await luckinFetchEntries(String(body.query ?? '咖啡'));
    // 上游给了 estimatePrice，用它做预算过滤
    const filtered = raw.filter((e) => {
      const amt = Number(e.attributes.price.amount ?? 0);
      if (k.budget != null && amt > k.budget) return false;
      return true;
    });
    const list = (filtered.length ? filtered : raw).slice(0, limit);
    const limit_note = raw.length < 3 ? `瑞幸上游每次最多返回 3 款，本次 ${raw.length} 款` : undefined;

    const entries = list.map((e, i) => ({
      entry: e,
      score: i === 0 ? 1 : 0.8,
      explain: [
        i === 0 ? `${s.name}${s.explain_rule}，推荐了这一款。` : `符合你的约束，作为备选。`,
        `来自瑞幸实时菜单（上游 provider: ${s.provider_id}）。`,
      ],
    }));

    return json({
      ocp_version: '1.0', kind: 'CatalogQueryResult', id: `qry_${crypto.randomUUID()}`,
      catalog_id: catalogId(s), query_pack: pack, query_mode: mode,
      query: String(body.query ?? ''), result_count: entries.length,
      page: { limit, offset: 0, has_more: false }, entries,
      merchant_pick: list[0]
        ? { entry_id: list[0].entry_id, reason: `${s.explain_rule}，来自门店实时菜单。`, candidates_considered: raw.length }
        : null,
      ...(limit_note ? { note: limit_note } : {}),
      provenance: prov,
    });
  } catch (e) {
    return json({
      ocp_version: '1.0', kind: 'CatalogQueryResult', id: `qry_${crypto.randomUUID()}`,
      catalog_id: catalogId(s), query_pack: pack, query_mode: mode,
      query: String(body.query ?? ''), result_count: 0,
      page: { limit, offset: 0, has_more: false }, entries: [], merchant_pick: null,
      note: `上游不可达：${(e as Error).message}`,
      provenance: { ...prov, source: 'upstream_error' },
    });
  }
}

/* ─────────────── resolve：把一条结果变成可执行的动作入口 ─────────────── */

/** 统一的「菜品视图」—— 本地菜单和瑞幸实时商品都归一到这个形状 */
type DishView = {
  entry_id: string;
  title: string;
  desc: string;
  attributes: any;
  image?: string;
  minutes: number;
  delivery: boolean;
  dineIn: boolean;
};

function dishFromMenuItem(m: any): DishView {
  return {
    entry_id: m.entry_id,
    title: m.name, desc: m.desc, attributes: project(m),
    image: m.img, minutes: m.minutes, delivery: m.delivery, dineIn: m.dine_in,
  };
}

function dishFromLuckinEntry(e: any): DishView {
  return {
    entry_id: e.entry_id,
    title: e.title, desc: e.summary, attributes: e.attributes,
    image: e.attributes?.image_url, minutes: 12, delivery: true, dineIn: false,
  };
}

/** 查一条 entry —— 先本地菜单，再瑞幸注册表 */
function lookupEntry(s: Shop, entryId: string): DishView | null {
  const local = s.menu.find((x) => x.entry_id === entryId);
  if (local) return dishFromMenuItem(local);

  const reg = luckinRegistry.get(entryId);
  if (reg) {
    return {
      entry_id: reg.entry_id,
      title: reg.title,
      desc: `${reg.title}（瑞幸咖啡实时菜单）`,
      attributes: {
        name: reg.title,
        price: { currency: 'CNY', amount: reg.price },
        prep_minutes: 12,
        tags: ['咖啡', '瑞幸'],
        description: `${reg.title}（瑞幸咖啡实时菜单）`,
        image_url: null,
        fulfillment: { dine_in: false, delivery: true, pickup: true },
        sku_code: reg.skuCode,
      },
      minutes: 12, delivery: true, dineIn: false,
    };
  }
  return null;
}

function handleResolve(s: Shop, body: any) {
  const entryId = String(body.entry_id ?? '');
  const purpose = String(body.purpose ?? 'view');
  const dish = lookupEntry(s, entryId);

  if (!dish) return err('not_found', `未知的 entry_id: ${entryId || '(缺失)'}`, 404);
  const m = dish;

  if (!['view', 'checkout'].includes(purpose)) {
    return err('unsupported_purpose', `不支持的 purpose: ${purpose}（应为 view 或 checkout）`, 400);
  }

  const now = new Date();
  const common = {
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: `res_${crypto.randomUUID()}`,
    catalog_id: catalogId(s),
    entry_id: m.entry_id,
    commercial_object_id: `co_${m.entry_id}`,
    object_id: m.entry_id,
    object_type: 'ocp.commerce.product',
    provider_id: s.provider_id,
    title: m.title,
    visible_attributes: m.attributes,
    freshness: { object_updated_at: now.toISOString(), resolved_at: now.toISOString() },
  };

  /* ── purpose=view：普通详情链接，不需要用户确认 ── */
  if (purpose === 'view') {
    return json({
      ...common,
      action_bindings: [
        {
          action_id: 'view_detail',
          action_type: 'url',
          label: `看看${m.title}的详情`,
          entrypoint: { url: `${s.homepage}/dish/${m.entry_id}`, method: 'GET' },
        },
      ],
      // view 的动作是长时不敏感的
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  }

  /* ── purpose=checkout：API 动作 + 强制用户确认 + 强制时效 ── */
  const ttlMs = 90_000;
  return json({
    ...common,
    action_bindings: [
      {
        action_id: 'checkout',
        action_type: 'api',
        label: `下单 ${m.name}`,
        entrypoint: { endpoint: `${BASE}/${s.id}/ocp/execute`, method: 'POST' },
        requires_user_confirmation: true,
        constraints: {
          fulfillment: m.delivery ? ['delivery', 'dine_in'] : ['dine_in'],
          max_quantity: 5,
          currency: 'CNY',
        },
        // 商家侧的履约信息（边界之外的信息，协议只负责透传）
        fulfillment_estimate: {
          prep_minutes: m.minutes,
          delivery_eta_minutes: m.delivery ? m.minutes + 15 : null,
          note: m.delivery
            ? '外卖时间由门店系统给出，非协议字段'
            : '该菜品仅支持堂食',
        },
      },
    ],
    // ★ 动作有时效：过期必须重新 resolve
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    expires_in_seconds: ttlMs / 1000,
    confirmation_required: true,
  });
}

/* ───────────────── 边界之外：商家自己的执行入口 ───────────────── */

/** 一次性 nonce，绑定到 resolve 出来的动作，90 秒后失效 */
const nonces = new Map<string, { entryId: string; shopId: string; expiresAt: number; used: boolean }>();

function issueNonce(shopId: string, entryId: string) {
  const n = crypto.randomUUID();
  nonces.set(n, { shopId, entryId, expiresAt: Date.now() + 90_000, used: false });
  return n;
}
function consumeNonce(n: string, shopId: string, entryId: string): string | null {
  const rec = nonces.get(n);
  if (!rec) return '这个动作已经失效了，请重新选择';
  if (rec.used) return '这个动作已经用过了';
  if (Date.now() > rec.expiresAt) return '这个动作过期了';
  if (rec.shopId !== shopId || rec.entryId !== entryId) return '动作与商品不匹配';
  rec.used = true;
  return null;
}

/* ─────────────────────── 瑞幸适配器 ─────────────────────── */

const luckin: LuckinMcpClient | null = luckinFromEnv();

/** 演示用坐标：浙大紫金港校区 */
const DEMO_LNG = Number(process.env.DEMO_LNG ?? 120.0876);
const DEMO_LAT = Number(process.env.DEMO_LAT ?? 30.3086);

let luckinDeptCache: { deptId: number; deptName: string; expiresAt: number } | null = null;
/** 上游可达性 —— 启动时探一次，health 里如实反映 */
let luckinUpstreamOk = false;

async function resolveLuckinDept(): Promise<{ deptId: number; deptName: string }> {
  if (luckinDeptCache && Date.now() < luckinDeptCache.expiresAt) return luckinDeptCache;
  if (!luckin) throw new Error('未配置瑞幸 MCP token');
  const res = await luckin.queryShopList(DEMO_LNG, DEMO_LAT);
  const list: any[] = res?.data ?? [];
  const open = list.filter((x) => (x.workStatus ?? '').includes('营业'));
  const chosen = (open.length ? open : list).sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
  if (!chosen) throw new Error('附近没有找到门店');
  luckinDeptCache = { deptId: chosen.deptId, deptName: chosen.deptName, expiresAt: Date.now() + 300_000 };
  return luckinDeptCache;
}

/**
 * 瑞幸实时商品的本地注册表。
 * resolve / execute 都靠它把 entry_id 还原成上游的 productId + skuCode。
 * 这是「适配器层」必须维护的映射 —— 协议层不关心，但适配器离不开。
 */
type LuckinEntryRec = { entry_id: string; productId: number; skuCode: string; title: string; price: number; deptId: number; raw: any };
const luckinRegistry = new Map<string, LuckinEntryRec>();

function luckinRegister(deptId: number, p: any): LuckinEntryRec {
  const entry_id = `luckin.mcp.${p.productId}`;
  const rec: LuckinEntryRec = {
    entry_id,
    productId: Number(p.productId),
    skuCode: String(p.skuCode ?? ''),
    title: String(p.productName ?? ''),
    price: Number(p.estimatePrice ?? p.initialPrice ?? 0),
    deptId,
    raw: p,
  };
  luckinRegistry.set(entry_id, rec);
  return rec;
}

/** 把瑞幸上游商品映射成 OCP 的 entry（真实数据） */
function luckinEntry(deptId: number, p: any) {
  luckinRegister(deptId, p);
  return {
    kind: 'CatalogEntry',
    catalog_id: catalogId(SHOPS.find((s) => s.is_luckin)!),
    entry_id: `luckin.mcp.${p.productId}`,
    provider_id: 'provider.luckin.mcp',
    object_id: String(p.productId),
    object_type: 'ocp.commerce.product',
    title: p.productName,
    summary: `瑞幸饮品 · 门店 ${deptId}`,
    attributes: {
      name: p.productName,
      price: { currency: 'CNY', amount: p.estimatePrice ?? p.initialPrice ?? 0, list_amount: p.initialPrice ?? null },
      image_url: p.pictureUrl,
      sku_code: p.skuCode,
      prep_minutes: 12,
      tags: ['咖啡', '瑞幸'],
      description: `${p.productName}（瑞幸咖啡实时菜单）`,
      nutrition: { kcal: null, caffeine_mg: null },
      fulfillment: { dine_in: false, delivery: true, pickup: true },
      attrs: (p.productAttrs ?? []).map((a: any) => ({
        name: a.attributeName,
        options: (a.productSubAttrs ?? []).map((sa: any) => ({ name: sa.attributeName, price: sa.price ?? 0 })),
      })),
    },
  };
}

/** 拉一批瑞幸商品（带关键词），供 query 使用 */
async function luckinFetchEntries(keyword: string): Promise<any[]> {
  if (!luckin) throw new Error('未配置瑞幸 MCP token');
  const dept = await resolveLuckinDept();
  const res = await luckin.searchProductForMcp(dept.deptId, keyword || '咖啡');
  if (process.env.OCP_DEBUG) {
    console.error('[debug] luckinFetchEntries', JSON.stringify({ deptId: dept.deptId, keyword, resType: typeof res, keys: res && typeof res === 'object' ? Object.keys(res) : null, dataLen: Array.isArray(res?.data) ? res.data.length : null, raw: JSON.stringify(res).slice(0, 200) }));
  }
  const list: any[] = res?.data ?? [];
  return list.map((p) => luckinEntry(dept.deptId, p));
}

/* ─────────────────────── 主路由 ─────────────────────── */

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  /* ── 顶层：页面 + 目录索引 ── */
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const f = Bun.file(new URL('../public/index.html', import.meta.url));
    if (await f.exists()) return new Response(f, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('未找到 public/index.html', { status: 404 });
  }

  if (pathname === '/ocp/index' || pathname === '/.well-known/ocp-index') {
    return json({
      ocp_version: '1.0',
      kind: 'CatalogIndex',
      index_id: 'ocp.food.demo',
      index_name: '今天吃什么 · 目录索引',
      updated_at: new Date().toISOString(),
      items: SHOPS.map((s) =>
        catalogIndexEntry(
          s,
          s.is_luckin && luckinDeptCache ? luckinDeptCache.deptId : undefined,
        ),
      ),
      note: '本索引只持有 metadata，不持有商品对象；商品对象在各 Catalog Node 内。',
    });
  }

  /* ── 瑞幸实时桥（真实上游，非协议接口）── */
  if (pathname === '/api/luckin/search') {
    if (!luckin) return err('luckin_unavailable', '未配置瑞幸 MCP token（可设 LUCKIN_MCP_TOKEN）', 503);
    const q = url.searchParams.get('q') ?? '拿铁';
    try {
      const dept = await resolveLuckinDept();
      const res = await luckin.searchProductForMcp(dept.deptId, q);
      const list: any[] = res?.data ?? [];
      return json({
        ok: true,
        dept,
        query: q,
        result_count: list.length,
        entries: list.map((p) => luckinEntry(dept.deptId, p)),
        upstream: 'luckin-mcp',
      });
    } catch (e) {
      return err('luckin_upstream_failed', (e as Error).message, 502);
    }
  }

  if (pathname === '/api/luckin/shops') {
    if (!luckin) return err('luckin_unavailable', '未配置瑞幸 MCP token', 503);
    try {
      const res = await luckin.queryShopList(DEMO_LNG, DEMO_LAT);
      return json({ ok: true, shops: res?.data ?? [], upstream: 'luckin-mcp' });
    } catch (e) {
      return err('luckin_upstream_failed', (e as Error).message, 502);
    }
  }

  /* ── 每店：六个协议端点 ── */
  const { shopId, path } = parseRoute(pathname);

  if (shopId) {
    const s = shopById(shopId);
    if (!s) return err('unknown_shop', `没有这家店: ${shopId}`, 404);

    if (req.method === 'GET' && (path === '/.well-known/ocp-catalog' || path === '/.well-known/ocp-catalog/'))
      return json(discovery(s));
    if (req.method === 'GET' && path === '/ocp/manifest') return json(manifest(s));
    if (req.method === 'GET' && path === '/ocp/health') return json(health(s));
    if (req.method === 'GET' && path === '/ocp/contracts') return json(contracts(s));
    if (req.method === 'POST' && path === '/ocp/query') {
      // 瑞幸走实时 MCP 上游；其余走本地菜单。对外形状完全一致。
      const body = await readJson(req);
      return s.is_luckin ? await handleLuckinQuery(s, body) : handleQuery(s, body);
    }

    if (req.method === 'POST' && path === '/ocp/resolve') {
      const body = await readJson(req);
      const r = handleResolve(s, body);
      // checkout 动作额外发一个 nonce，绑定到本次 resolve
      if (r.status === 200 && body.purpose === 'checkout') {
        const payload = await r.clone().json();
        payload.action_bindings[0].entrypoint.nonce = issueNonce(s.id, String(body.entry_id));
        return json(payload);
      }
      return r;
    }

    /* ── 边界之外：真正执行 ── */
    if (req.method === 'POST' && path === '/ocp/execute') {
      const body = await readJson(req);
      const entryId = String(body.entry_id ?? '');
      const nonce = String(body.nonce ?? '');
      const mode = String(body.fulfillment ?? 'delivery');
      const qty = Math.min(Math.max(Number(body.quantity ?? 1) || 1, 1), 5);

      const bad = consumeNonce(nonce, s.id, entryId);
      if (bad) return err('invalid_action_nonce', bad, 400);

      const dish = lookupEntry(s, entryId);

      // 瑞幸：走真实上游
      if (s.is_luckin && luckin) {
        try {
          const dept = await resolveLuckinDept();
          const reg = luckinRegistry.get(entryId);
          const productId = reg?.productId ?? Number(entryId.replace(/^luckin\.mcp\./, ''));
          const usedReal = Number.isInteger(productId) && productId > 0;
          let upstream: any = null;
          if (usedReal) {
            // 真实下单：createOrder（会扣款）
            upstream = await luckin.createOrder(
              dept.deptId,
              [{ productId, amount: qty, skuCode: body.sku_code ?? reg?.skuCode }],
              DEMO_LNG,
              DEMO_LAT,
              { remark: body.remark || 'OCP demo' },
            );
          }
          // 从上游响应里挖订单号（字段名未知，做多种兜底）
          const orderNo =
            upstream?.data?.orderId ?? upstream?.data?.orderNo ?? upstream?.orderId ??
            upstream?.data?.orderNumber ?? (upstream ? JSON.stringify(upstream).match(/"order[^"]*"\s*:\s*"([^"]+)"/i)?.[1] : null);
          return json({
            ok: true,
            executable: true,
            source: usedReal ? 'luckin-mcp-real' : 'luckin-mcp-mock',
            order_no: orderNo ?? null,
            shop: s.name,
            dept,
            entry_id: entryId,
            title: reg?.title ?? dish?.title ?? '',
            quantity: qty,
            fulfillment: { mode, estimate_minutes: mode === 'delivery' ? 27 : 12 },
            upstream_response: upstream,
            note: '★ 这个端点不属于 OCP 协议 —— 它是门店自己的执行入口。协议只负责把 Agent 送到门口。',
          });
        } catch (e) {
          return err('execute_failed', (e as Error).message, 502);
        }
      }

      // mock 店：返回一个假订单号
      if (!dish) return err('not_found', `未知的 entry_id: ${entryId}`, 404);
      if (mode === 'delivery' && !dish.delivery) return err('unsupported_fulfillment', '该菜品不支持外卖', 400);
      if (mode === 'dine_in' && !dish.dineIn) return err('unsupported_fulfillment', '该菜品不支持堂食', 400);

      const orderNo = `OCP${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
      const amount = Number(dish.attributes?.price?.amount ?? 0);
      return json({
        ok: true,
        executable: true,
        source: 'in-memory-demo',
        order_no: orderNo,
        shop: s.name,
        entry_id: entryId,
        title: dish.title,
        quantity: qty,
        amount: { currency: 'CNY', total: amount * qty },
        fulfillment: {
          mode,
          estimate_minutes: mode === 'delivery' ? dish.minutes + 15 : dish.minutes,
          note: mode === 'delivery'
            ? '外卖时间由门店系统给出 —— 这是协议边界之外的信息'
            : '堂食，到店出示订单号即可',
        },
        note: '★ 这个端点不属于 OCP 协议 —— 它是门店自己的执行入口。协议只负责把 Agent 送到门口。',
      });
    }
  }

  return err('not_found', `没有匹配的路由: ${req.method} ${pathname}`, 404);
}

/* ─────────────────────── 启动 ─────────────────────── */

// 端口占用时自动顺延，避免现场翻车
function start(port: number, attempt = 0): void {
  try {
    const server = Bun.serve({ port, fetch: handle });
    console.log(`\n  🍜 OCP Food Demo 已启动`);
    console.log(`     → http://localhost:${server.port}`);
    console.log(`     → 目录索引: http://localhost:${server.port}/ocp/index`);
    console.log(`\n     店铺: ${SHOPS.map((s) => `${s.name}(${s.healthy ? '✓' : '✗'})`).join('  ')}`);
    console.log(`     瑞幸 MCP: ${luckin ? '✓ 已连接' : '✗ 未配置 token（将降级为 mock）'}`);
    console.log(`\n`);
  } catch (e: any) {
    if (e?.code === 'EADDRINUSE' && attempt < 5) {
      console.warn(`  ⚠ 端口 ${port} 被占用，尝试 ${port + 1}…`);
      start(port + 1, attempt + 1);
    } else {
      throw e;
    }
  }
}

if (import.meta.main) {
  // 启动时探一次瑞幸上游，health 才能如实反映
  if (luckin) {
    resolveLuckinDept()
      .then((d) => {
        luckinUpstreamOk = true;
        console.log(`     ✓ 瑞幸上游已连上：${d.deptName} (deptId ${d.deptId})`);
      })
      .catch((e) => {
        luckinUpstreamOk = false;
        console.warn(`     ⚠ 瑞幸上游不可达：${(e as Error).message}（适配器会如实报 degraded）`);
      });
  }
  start(PORT);
}

export { handle };
