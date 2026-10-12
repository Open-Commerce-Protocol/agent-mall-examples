/**
 * Registration 节点 —— 把 8 家瑞幸门店当作 8 个独立 Catalog 索引起来。
 *
 * 这是本接入方案里 OCP 真正增值的地方：**同一杯咖啡在多家门店的可得性**，
 * 属于"跨独立目录发现"，而不是简单的单店点单。
 *
 * 注册是"真"的：对每家门店都会去拉它的
 * /.well-known/ocp-catalog → /ocp/manifest → /ocp/health，再据此建路由提示。
 */
import { fail, json, type OcpReply, type Route } from '../lib/http.ts';
import { newId } from '../lib/ids.ts';
import { startOrReuse } from '../lib/net.ts';
import { catalogIdFor, LUCKIN_QUERY_PACK } from './luckin-catalog.ts';
import type { Shop } from '../mcp/tools.ts';
import type { StoreDirectory } from './store-directory.ts';

export const REGISTRATION_PORT = 4702;

export const REGISTRATION_INFO = {
  registration_id: 'reg_luckin_stores',
  registration_name: '瑞幸门店导航 Registration 节点',
  protocol: 'ocp.catalog.registration.v1',
  protocol_version: '1.0',
  base_url: `http://127.0.0.1:${REGISTRATION_PORT}`,
} as const;

const CACHE_TTL_SECONDS = 120;
const FETCH_TIMEOUT_MS = 5000;

type CatalogRecord = {
  catalog_id: string;
  catalog_name: string;
  description: string;
  homepage: string;
  well_known_url: string;
  manifest_url: string;
  query_url: string;
  resolve_url: string;
  supported_query_packs: string[];
  supported_query_modes: string[];
  supports_resolve: boolean;
  tags: string[];
  domains: string[];
  verification_status: string;
  trust_tier: string;
  health_status: string;
  distance_km?: number;
  work_status?: string;
  /** 营业时段，例如 "07:00-21:00"。发现层必须带上它，否则调用方无法判断"还来不来得及"。 */
  work_hours?: string;
  address?: string;
  snapshot_id: string;
  snapshot_fetched_at: string;
};

const REGISTRY = new Map<string, CatalogRecord>();
const nowIso = (): string => new Date().toISOString();

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => undefined) };
  } catch (error) {
    return { ok: false, status: 0, body: { message: error instanceof Error ? error.message : String(error) } };
  }
}

/** 真的去拉一家门店的 discovery → manifest → health。 */
async function pullStore(shop: Shop): Promise<{ record?: CatalogRecord; warnings: string[] }> {
  const warnings: string[] = [];
  const base = `http://127.0.0.1:4700/stores/${shop.deptId}`;

  const discovery = await getJson(`${base}/.well-known/ocp-catalog`);
  if (!discovery.ok || discovery.body?.kind !== 'WellKnownCatalogDiscovery') {
    return { warnings: [`discovery 读取失败 ${base}（HTTP ${discovery.status}）`] };
  }
  const manifestRes = await getJson(discovery.body.manifest_url);
  if (!manifestRes.ok || manifestRes.body?.kind !== 'CatalogManifest') {
    return { warnings: [`manifest 读取失败（HTTP ${manifestRes.status}）`] };
  }
  const m = manifestRes.body;
  const endpoints = m.endpoints ?? {};

  let healthStatus = 'unknown';
  const healthUrl: string | undefined = endpoints.health?.url;
  if (typeof healthUrl === 'string') {
    const h = await getJson(healthUrl);
    if (h.ok && typeof h.body?.status === 'string') healthStatus = h.body.status;
    else warnings.push(`health 检查未通过（HTTP ${h.status}）`);
  }

  const packs: string[] = [];
  const modes = new Set<string>();
  for (const cap of m.query_capabilities ?? []) {
    for (const pack of cap.query_packs ?? []) {
      if (typeof pack.pack_id === 'string') packs.push(pack.pack_id);
      for (const mode of pack.query_modes ?? []) modes.add(mode);
    }
  }

  return {
    warnings,
    record: {
      catalog_id: m.catalog_id,
      catalog_name: m.catalog_name,
      description: m.description ?? '',
      homepage: shop.address,
      well_known_url: `${base}/.well-known/ocp-catalog`,
      manifest_url: discovery.body.manifest_url,
      query_url: endpoints.query?.url ?? '',
      resolve_url: endpoints.resolve?.url ?? '',
      supported_query_packs: packs,
      supported_query_modes: [...modes].sort(),
      supports_resolve: typeof endpoints.resolve?.url === 'string',
      // 门店状态与距离放进 tags/metadata，让发现层能按"营业中""最近"筛。
      tags: [...(shop.deptTags ?? []), shop.workStatus ?? '状态未知', `dept:${shop.deptId}`],
      domains: [`127.0.0.1:4700`],
      verification_status: 'verified',
      trust_tier: 'unverified',
      health_status: healthStatus,
      distance_km: shop.distance,
      work_status: shop.workStatus,
      work_hours: `${shop.workTimeStart ?? '?'}-${shop.workTimeEnd ?? '?'}`,
      address: shop.address,
      snapshot_id: newId('snap'),
      snapshot_fetched_at: nowIso(),
    },
  };
}

function routeHint(r: CatalogRecord): unknown {
  return {
    catalog_id: r.catalog_id,
    catalog_name: r.catalog_name,
    description: r.description,
    manifest_url: r.manifest_url,
    query_url: r.query_url,
    resolve_url: r.resolve_url,
    supported_query_packs: r.supported_query_packs,
    auth_requirements: {},
    metadata: {
      address: r.address,
      work_status: r.work_status,
      work_hours: r.work_hours,
      distance_km: r.distance_km,
      store_catalog: true,
      provider: 'luckin',
    },
    verification_status: r.verification_status,
    trust_tier: r.trust_tier,
    trust_profile: {
      verification_status: r.verification_status,
      trust_tier: r.trust_tier,
      domain_verified: false,
      manifest_signed: false,
      downgrade_invalidates_cache: true,
    },
    health_status: r.health_status,
    cache_ttl_seconds: CACHE_TTL_SECONDS,
    snapshot_id: r.snapshot_id,
    snapshot_fetched_at: r.snapshot_fetched_at,
  };
}

/* ------------------------------------------------------------------ 检索 */

const SEARCH_FILTER_KEYS = ['query_mode', 'query_pack', 'supports_resolve', 'verification_status', 'trust_tier', 'health_status', 'domain', 'tag'];
const SEARCH_KEYS = ['ocp_version', 'kind', 'query', 'filters', 'limit', 'explain'];

function score(r: CatalogRecord, term: string): { score: number; fields: string[] } | undefined {
  if (term === '') return { score: 1, fields: [] };
  const t = term.toLowerCase();
  const fields: string[] = [];
  let s = 0;
  if (r.catalog_name.toLowerCase().includes(t)) {
    s += 1;
    fields.push('catalog_name');
  }
  if (r.tags.some((x) => x.toLowerCase().includes(t))) {
    s += 0.8;
    fields.push('tags');
  }
  if ((r.address ?? '').toLowerCase().includes(t)) {
    s += 0.6;
    fields.push('address');
  }
  if (r.description.toLowerCase().includes(t)) {
    s += 0.4;
    fields.push('description');
  }
  return fields.length === 0 ? undefined : { score: Math.round(s * 100) / 100, fields };
}

function passFilters(r: CatalogRecord, f: Record<string, unknown>): boolean {
  if (f.query_pack !== undefined && !r.supported_query_packs.includes(String(f.query_pack))) return false;
  if (f.query_mode !== undefined && !r.supported_query_modes.includes(String(f.query_mode))) return false;
  if (f.supports_resolve !== undefined && r.supports_resolve !== f.supports_resolve) return false;
  if (f.verification_status !== undefined && r.verification_status !== f.verification_status) return false;
  if (f.trust_tier !== undefined && r.trust_tier !== f.trust_tier) return false;
  if (f.health_status !== undefined && r.health_status !== f.health_status) return false;
  if (f.domain !== undefined && !r.domains.includes(String(f.domain))) return false;
  if (f.tag !== undefined && !r.tags.includes(String(f.tag))) return false;
  return true;
}

function handleSearch(body: Record<string, unknown>): OcpReply {
  const extra = Object.keys(body).filter((k) => !SEARCH_KEYS.includes(k));
  if (extra.length > 0) return fail('unexpected_field', `检索请求不接受字段：${extra.join(', ')}`, 400);

  const rawQuery = body.query === undefined ? '' : body.query;
  if (typeof rawQuery !== 'string') return fail('invalid_request', 'query 必须是字符串', 400);
  if (rawQuery.length > 500) return fail('invalid_request', 'query 最长 500 字符', 400);
  const term = rawQuery.trim();

  const rawFilters = body.filters === undefined ? {} : body.filters;
  if (typeof rawFilters !== 'object' || rawFilters === null || Array.isArray(rawFilters)) {
    return fail('invalid_request', 'filters 必须是 JSON 对象', 400);
  }
  const filters = rawFilters as Record<string, unknown>;
  const bad = Object.keys(filters).filter((k) => !SEARCH_FILTER_KEYS.includes(k));
  if (bad.length > 0) return fail('unsupported_filter', `不接受过滤器：${bad.join(', ')}。可用：${SEARCH_FILTER_KEYS.join(', ')}`, 400);

  const limit = typeof body.limit === 'number' ? body.limit : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail('invalid_request', 'limit 必须是 1..50 的整数', 400);

  const items = [...REGISTRY.values()]
    .map((r) => {
      const hit = score(r, term);
      if (hit === undefined) return undefined;
      if (!passFilters(r, filters)) return undefined;
      return { r, hit };
    })
    .filter((x): x is { r: CatalogRecord; hit: { score: number; fields: string[] } } => x !== undefined)
    // 空查询时按距离近的优先——这才是"帮我点一杯"真正想要的排序。
    .sort((a, b) => (term === '' ? (a.r.distance_km ?? 99) - (b.r.distance_km ?? 99) : b.hit.score - a.hit.score))
    .slice(0, limit)
    .map(({ r, hit }) => ({
      catalog_id: r.catalog_id,
      catalog_name: r.catalog_name,
      description: r.description,
      score: hit.score,
      matched_query_packs: r.supported_query_packs,
      verification_status: r.verification_status,
      trust_tier: r.trust_tier,
      health_status: r.health_status,
      route_hint: routeHint(r),
      explain: [
        hit.fields.length === 0 ? '空查询：按距离由近到远返回。' : `命中字段 ${hit.fields.join(', ')}。`,
        `${r.work_status ?? '状态未知'}，距离 ${r.distance_km ?? '?'} km。`,
      ],
    }));

  return json({
    ocp_version: '1.0',
    kind: 'CatalogSearchResult',
    id: newId('csr'),
    registration_id: REGISTRATION_INFO.registration_id,
    result_count: items.length,
    items,
    explain: [`在 ${REGISTRY.size} 家门店中匹配 "${term}"。`],
  });
}

/* ------------------------------------------------------------------ 装配 */

export function registrationRoutes(): Route[] {
  const base = REGISTRATION_INFO.base_url;
  return [
    {
      method: 'GET',
      path: '/health',
      handler: () =>
        json({
          ocp_version: '1.0',
          registration_id: REGISTRATION_INFO.registration_id,
          status: 'healthy',
          indexed_catalogs: REGISTRY.size,
          checked_at: nowIso(),
        }),
    },
    {
      method: 'GET',
      path: '/.well-known/ocp-registration',
      handler: () =>
        json({
          ocp_version: '1.0',
          kind: 'RegistrationDiscovery',
          registration_id: REGISTRATION_INFO.registration_id,
          registration_name: REGISTRATION_INFO.registration_name,
          registration_protocol: REGISTRATION_INFO.protocol,
          registration_protocol_version: REGISTRATION_INFO.protocol_version,
          manifest_url: `${base}/ocp/registration/manifest`,
          catalog_registration_url: `${base}/ocp/catalogs/register`,
          catalog_search_url: `${base}/ocp/catalogs/search`,
        }),
    },
    {
      method: 'GET',
      path: '/ocp/registration/manifest',
      handler: () =>
        json({
          ocp_version: '1.0',
          kind: 'RegistrationManifest',
          registration_id: REGISTRATION_INFO.registration_id,
          registration_name: REGISTRATION_INFO.registration_name,
          supported_protocols: [REGISTRATION_INFO.protocol],
          endpoints: {
            catalog_registration: `${base}/ocp/catalogs/register`,
            catalog_search: `${base}/ocp/catalogs/search`,
            catalog_resolve: `${base}/ocp/catalogs/resolve`,
            catalog_verify: `${base}/ocp/catalogs/verify`,
            catalog_refresh: `${base}/ocp/catalogs/refresh`,
            catalog_token_rotate: `${base}/ocp/catalogs/token/rotate`,
          },
          catalog_registration: {
            registration_modes: ['open_intake'],
            default_status: 'accepted_indexed',
            requires_domain_verification: false,
            requires_https: false,
          },
          catalog_search_capabilities: [
            {
              capability_id: 'ocp.luckin.store.discovery.v1',
              description: '按店名、地址、营业状态与 query pack 检索瑞幸门店 Catalog；空查询按距离排序。',
              searchable_fields: ['catalog_name', 'address', 'tags', 'supported_query_packs'],
              filters: SEARCH_FILTER_KEYS,
            },
          ],
        }),
    },
    { method: 'POST', path: '/ocp/catalogs/search', handler: (ctx) => handleSearch(ctx.body) },
    {
      method: 'POST',
      path: '/ocp/catalogs/resolve',
      handler: (ctx): OcpReply => {
        const catalogId = typeof ctx.body.catalog_id === 'string' ? ctx.body.catalog_id : '';
        if (catalogId === '') return fail('invalid_request', 'catalog_id 必填', 400);
        const record = REGISTRY.get(catalogId);
        if (record === undefined) return fail('not_found', `未索引的 catalog_id "${catalogId}"`, 404);
        return json(routeHint(record));
      },
    },
    {
      method: 'GET',
      path: '/ocp/catalogs/:catalogId',
      handler: (ctx): OcpReply => {
        const record = REGISTRY.get(ctx.params.catalogId ?? '');
        if (record === undefined) return fail('not_found', '未索引的 catalog_id', 404);
        return json({
          ocp_version: '1.0',
          kind: 'CatalogProfileSnapshot',
          id: record.snapshot_id,
          registration_id: REGISTRATION_INFO.registration_id,
          catalog_id: record.catalog_id,
          catalog_name: record.catalog_name,
          description: record.description,
          homepage: `http://127.0.0.1:4700/stores/${String(record.tags.find((t) => t.startsWith('dept:')) ?? '').slice(5)}/ocp/manifest`,
          well_known_url: record.well_known_url,
          manifest_url: record.manifest_url,
          query_capabilities: record.supported_query_packs.map((p) => ({ pack_id: p, query_modes: record.supported_query_modes })),
          object_contract_summaries: [],
          metadata: { address: record.address, work_status: record.work_status, distance_km: record.distance_km },
          verification_status: record.verification_status,
          health_status: record.health_status,
          trust_tier: record.trust_tier,
          freshness: { manifest_fetched_at: record.snapshot_fetched_at, health_checked_at: record.snapshot_fetched_at },
        });
      },
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/refresh',
      handler: async (ctx): Promise<OcpReply> => {
        const catalogId = typeof ctx.body.catalog_id === 'string' ? ctx.body.catalog_id : '';
        if (catalogId === '') return fail('invalid_request', 'catalog_id 必填', 400);
        return refreshOne(catalogId);
      },
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/:catalogId/refresh',
      handler: (ctx) => refreshOne(ctx.params.catalogId ?? ''),
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/verify',
      handler: () => fail('not_implemented', '本演示不做域名所有权校验（verification_status 恒为 verified 的门店级信任）。', 501),
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/token/rotate',
      handler: () => fail('not_implemented', '本演示不签发 catalog_access_token，因此没有令牌轮换。', 501),
    },
    {
      method: 'GET',
      path: '/demo/catalogs',
      handler: () => json({ note: '演示用：已索引门店全貌。', count: REGISTRY.size, catalogs: [...REGISTRY.values()] }),
    },
  ];
}

async function refreshOne(catalogId: string): Promise<OcpReply> {
  const existing = REGISTRY.get(catalogId);
  if (existing === undefined) return fail('not_found', `未索引的 catalog_id "${catalogId}"`, 404);
  const deptId = Number(String(existing.tags.find((t) => t.startsWith('dept:')) ?? '').slice(5));
  const shop = SHOPS.find((s) => s.deptId === deptId);
  if (shop === undefined) return fail('not_found', `找不到 deptId=${deptId} 对应的门店`, 404);
  const pulled = await pullStore(shop);
  if (pulled.record === undefined) {
    return json({ ocp_version: '1.0', kind: 'CatalogRefreshResult', id: newId('ref'), registration_id: REGISTRATION_INFO.registration_id, catalog_id: catalogId, status: 'rejected', health_status: existing.health_status, indexed: true, warnings: pulled.warnings, refreshed_at: nowIso() });
  }
  REGISTRY.set(catalogId, pulled.record);
  return json({ ocp_version: '1.0', kind: 'CatalogRefreshResult', id: newId('ref'), registration_id: REGISTRATION_INFO.registration_id, catalog_id: catalogId, status: 'refreshed', snapshot_id: pulled.record.snapshot_id, health_status: pulled.record.health_status, indexed: true, warnings: pulled.warnings, refreshed_at: nowIso() });
}

/** 启动时索引的门店列表，refresh 时要用。 */
let SHOPS: Shop[] = [];

/** 启动 Registration 节点，并真的把每家门店拉一遍。 */
export async function startRegistrationNode(
  storeDirectory: StoreDirectory,
): Promise<{ port: number; indexed: string[]; warnings: string[]; reused: boolean }> {
  SHOPS = storeDirectory.list();
  const outcome = await startOrReuse(registrationRoutes(), REGISTRATION_PORT, REGISTRATION_INFO.registration_id);

  // 复用一个已在运行的实例时，它的索引是它自己启动时建的。
  if (outcome.reused) {
    return { port: REGISTRATION_PORT, indexed: SHOPS.map((s) => catalogIdFor(s.deptId)), warnings: [], reused: true };
  }

  const indexed: string[] = [];
  const allWarnings: string[] = [];
  for (const shop of SHOPS) {
    const pulled = await pullStore(shop);
    if (pulled.record === undefined) {
      allWarnings.push(`${shop.deptName}: ${pulled.warnings.join('; ')}`);
      continue;
    }
    REGISTRY.set(pulled.record.catalog_id, pulled.record);
    indexed.push(pulled.record.catalog_id);
    if (pulled.warnings.length > 0) allWarnings.push(`${shop.deptName}: ${pulled.warnings.join('; ')}`);
  }
  return { port: REGISTRATION_PORT, indexed, warnings: allWarnings, reused: false };
}

export { catalogIdFor, LUCKIN_QUERY_PACK };
