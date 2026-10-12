/**
 * Registration 节点 ——「奶茶导航」，发现层的实现。
 *
 * 它回答的问题只有一个：**谁在卖奶茶**。它不查商品、不碰价格，
 * 那是 Catalog 节点的事（docs/specs/registration/v1.md 的层间边界）。
 *
 * 端点取自规范 §6：
 *   GET  /health
 *   GET  /.well-known/ocp-registration
 *   GET  /ocp/registration/manifest
 *   POST /ocp/catalogs/register
 *   GET  /ocp/catalogs/:catalogId
 *   POST /ocp/catalogs/search
 *   POST /ocp/catalogs/resolve
 *   POST /ocp/catalogs/:catalogId/refresh
 *
 * register / refresh 是"真"的：节点会真的去拉目标 Catalog 的
 * /.well-known/ocp-catalog → manifest → health，再据此建路由提示（route hint），
 * 而不是把种子数据硬编码进去。
 */
import { fail, json, type OcpReply, type Route } from '../lib/http.ts';
import { newId } from '../lib/ids.ts';
import { startOrReuse } from '../lib/net.ts';
import type { Shop } from '../shops/types.ts';

export const REGISTRATION = {
  registration_id: 'reg_milktea_nav',
  registration_name: '奶茶导航 Registration 节点',
  port: 4500,
  base_url: 'http://127.0.0.1:4500',
  protocol: 'ocp.catalog.registration.v1',
  protocol_version: '1.0',
} as const;

const CACHE_TTL_SECONDS = 300;
const FETCH_TIMEOUT_MS = 3000;

/** 注册表里的一条记录。字段命名贴着 catalogRouteHintSchema。 */
type CatalogRecord = {
  catalog_id: string;
  catalog_name: string;
  description: string;
  homepage: string;
  well_known_url: string;
  manifest_url: string;
  query_url: string;
  resolve_url: string;
  health_url: string;
  supported_query_packs: string[];
  supported_query_modes: string[];
  supports_resolve: boolean;
  object_contract_count: number;
  tags: string[];
  domains: string[];
  verification_status: 'verified' | 'challenge_required' | 'failed' | 'not_required';
  trust_tier: 'unknown' | 'unverified' | 'verified' | 'trusted';
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  registration_version: number;
  snapshot_id: string;
  snapshot_fetched_at: string;
};

const REGISTRY = new Map<string, CatalogRecord>();

const nowIso = (): string => new Date().toISOString();

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { message: error instanceof Error ? error.message : String(error) } };
  }
}

type PullResult = {
  record?: CatalogRecord;
  manifest_fetch_status: 'fetched' | 'failed' | 'not_attempted';
  warnings: string[];
};

/**
 * 真的去拉一个 Catalog：discovery → manifest → health。
 *
 * health 失败不影响注册（规范允许降级为 unknown），但 manifest 拉不到就不算注册成功。
 */
async function pullCatalog(
  wellKnownUrl: string,
  fallback: { tags: string[]; domains: string[]; homepage: string },
): Promise<PullResult> {
  const warnings: string[] = [];
  const discovery = await getJson(wellKnownUrl);
  if (!discovery.ok || discovery.body?.kind !== 'WellKnownCatalogDiscovery') {
    return {
      manifest_fetch_status: 'not_attempted',
      warnings: [`无法读取 discovery 文档 ${wellKnownUrl}（HTTP ${discovery.status}）`],
    };
  }
  const d = discovery.body;
  const manifestUrl: string = d.manifest_url;

  const manifestRes = await getJson(manifestUrl);
  if (!manifestRes.ok || manifestRes.body?.kind !== 'CatalogManifest') {
    return {
      manifest_fetch_status: 'failed',
      warnings: [`manifest 拉取失败 ${manifestUrl}（HTTP ${manifestRes.status}）`],
    };
  }
  const m = manifestRes.body;

  const endpoints = m.endpoints ?? {};
  const packs: string[] = [];
  const modes = new Set<string>();
  for (const cap of m.query_capabilities ?? []) {
    for (const pack of cap.query_packs ?? []) {
      if (typeof pack.pack_id === 'string') packs.push(pack.pack_id);
      for (const mode of pack.query_modes ?? []) modes.add(mode);
    }
  }

  let healthStatus: CatalogRecord['health_status'] = 'unknown';
  const healthUrl: string = endpoints.health?.url ?? d.health_url ?? '';
  if (healthUrl !== '') {
    const h = await getJson(healthUrl);
    if (h.ok && h.body?.status === 'healthy') healthStatus = 'healthy';
    else {
      healthStatus = 'unhealthy';
      warnings.push(`health 检查未通过 ${healthUrl}（HTTP ${h.status}）`);
    }
  } else {
    warnings.push('manifest 未声明 health endpoint，健康状态降级为 unknown');
  }

  return {
    manifest_fetch_status: 'fetched',
    warnings,
    record: {
      catalog_id: m.catalog_id ?? d.catalog_id,
      catalog_name: m.catalog_name ?? d.catalog_name,
      description: m.description ?? '',
      homepage: fallback.homepage,
      well_known_url: wellKnownUrl,
      manifest_url: manifestUrl,
      query_url: endpoints.query?.url ?? '',
      resolve_url: endpoints.resolve?.url ?? '',
      health_url: healthUrl,
      supported_query_packs: packs,
      supported_query_modes: [...modes].sort(),
      supports_resolve: typeof endpoints.resolve?.url === 'string',
      object_contract_count: Array.isArray(m.object_contracts) ? m.object_contracts.length : 0,
      tags: fallback.tags,
      domains: fallback.domains,
      // 本演示跑在 http://127.0.0.1，不做域名所有权校验，所以是 not_required。
      verification_status: 'not_required',
      trust_tier: 'unverified',
      health_status: healthStatus,
      registration_version: 1,
      snapshot_id: newId('snap'),
      snapshot_fetched_at: nowIso(),
    },
  };
}

/* ------------------------------------------------------------------ 响应构造 */

function discoveryDoc(): unknown {
  return {
    ocp_version: '1.0',
    kind: 'RegistrationDiscovery',
    registration_id: REGISTRATION.registration_id,
    registration_name: REGISTRATION.registration_name,
    registration_protocol: REGISTRATION.protocol,
    registration_protocol_version: REGISTRATION.protocol_version,
    manifest_url: `${REGISTRATION.base_url}/ocp/registration/manifest`,
    catalog_registration_url: `${REGISTRATION.base_url}/ocp/catalogs/register`,
    catalog_search_url: `${REGISTRATION.base_url}/ocp/catalogs/search`,
  };
}

function manifestDoc(): unknown {
  const base = REGISTRATION.base_url;
  return {
    ocp_version: '1.0',
    kind: 'RegistrationManifest',
    registration_id: REGISTRATION.registration_id,
    registration_name: REGISTRATION.registration_name,
    supported_protocols: [REGISTRATION.protocol],
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
    // 本演示只声明一条检索能力：按元数据找奶茶铺。
    catalog_search_capabilities: [
      {
        capability_id: 'ocp.milktea.catalog.discovery.v1',
        description: '按店名、简介、标签、域名与 query pack 检索奶茶 Catalog。',
        searchable_fields: ['catalog_name', 'description', 'tags', 'domains', 'supported_query_packs'],
        filters: [
          'query_pack',
          'query_mode',
          'supports_resolve',
          'verification_status',
          'trust_tier',
          'health_status',
          'domain',
          'tag',
        ],
      },
    ],
  };
}

/** route hint 不带 health_url：Zod 允许，但官方 JSON Schema 是 additionalProperties:false 且未列该字段。 */
function routeHint(record: CatalogRecord): unknown {
  return {
    catalog_id: record.catalog_id,
    catalog_name: record.catalog_name,
    description: record.description,
    manifest_url: record.manifest_url,
    query_url: record.query_url,
    resolve_url: record.resolve_url,
    supported_query_packs: record.supported_query_packs,
    auth_requirements: {},
    metadata: {
      registration_source: 'milktea-demo',
      snapshot_object_contract_count: record.object_contract_count,
    },
    verification_status: record.verification_status,
    trust_tier: record.trust_tier,
    trust_profile: {
      verification_status: record.verification_status,
      trust_tier: record.trust_tier,
      domain_verified: false,
      manifest_signed: false,
      downgrade_invalidates_cache: true,
    },
    health_status: record.health_status,
    cache_ttl_seconds: CACHE_TTL_SECONDS,
    snapshot_id: record.snapshot_id,
    snapshot_fetched_at: record.snapshot_fetched_at,
  };
}

/* -------------------------------------------------------------------- 检索 */

const SEARCH_FILTER_KEYS = [
  'query_mode',
  'query_pack',
  'supports_resolve',
  'verification_status',
  'trust_tier',
  'health_status',
  'domain',
  'tag',
];

function scoreRecord(record: CatalogRecord, term: string): { score: number; fields: string[] } | undefined {
  if (term === '') return { score: 1, fields: [] };
  const t = term.toLowerCase();
  const fields: string[] = [];
  let score = 0;
  if (record.catalog_name.toLowerCase().includes(t)) {
    score += 1;
    fields.push('catalog_name');
  }
  if (record.tags.some((x) => x.toLowerCase().includes(t))) {
    score += 0.8;
    fields.push('tags');
  }
  if (record.description.toLowerCase().includes(t)) {
    score += 0.5;
    fields.push('description');
  }
  if (record.domains.some((x) => x.toLowerCase().includes(t))) {
    score += 0.6;
    fields.push('domains');
  }
  if (record.supported_query_packs.some((x) => x.toLowerCase().includes(t))) {
    score += 0.4;
    fields.push('supported_query_packs');
  }
  return fields.length === 0 ? undefined : { score: Math.round(score * 100) / 100, fields };
}

function passSearchFilters(record: CatalogRecord, filters: Record<string, unknown>): boolean {
  if (filters.query_pack !== undefined && !record.supported_query_packs.includes(String(filters.query_pack))) return false;
  if (filters.query_mode !== undefined && !record.supported_query_modes.includes(String(filters.query_mode))) return false;
  if (filters.supports_resolve !== undefined && record.supports_resolve !== filters.supports_resolve) return false;
  if (filters.verification_status !== undefined && record.verification_status !== filters.verification_status) return false;
  if (filters.trust_tier !== undefined && record.trust_tier !== filters.trust_tier) return false;
  if (filters.health_status !== undefined && record.health_status !== filters.health_status) return false;
  if (filters.domain !== undefined && !record.domains.includes(String(filters.domain))) return false;
  if (filters.tag !== undefined && !record.tags.includes(String(filters.tag))) return false;
  return true;
}

const SEARCH_KEYS = ['ocp_version', 'kind', 'query', 'filters', 'limit', 'explain'];

function handleSearch(body: Record<string, unknown>): OcpReply {
  const extra = Object.keys(body).filter((k) => !SEARCH_KEYS.includes(k));
  if (extra.length > 0) {
    return fail('unexpected_field', `检索请求不接受字段：${extra.join(', ')}`, 400);
  }

  // 注意：官方 JSON Schema 把 query 列为必填，Zod 里它是 optional + default('')。
  // 这里按 Zod（运行时权威）放宽，省略即全量返回；自有请求始终显式传 query。
  const rawQuery = body.query === undefined ? '' : body.query;
  if (typeof rawQuery !== 'string') return fail('invalid_request', 'query 必须是字符串', 400);
  if (rawQuery.length > 500) return fail('invalid_request', 'query 最长 500 字符', 400);
  const term = rawQuery.trim();

  const rawFilters = body.filters === undefined ? {} : body.filters;
  if (typeof rawFilters !== 'object' || rawFilters === null || Array.isArray(rawFilters)) {
    return fail('invalid_request', 'filters 必须是 JSON 对象', 400);
  }
  const filters = rawFilters as Record<string, unknown>;
  const badFilters = Object.keys(filters).filter((k) => !SEARCH_FILTER_KEYS.includes(k));
  if (badFilters.length > 0) {
    return fail(
      'unsupported_filter',
      `不接受过滤器：${badFilters.join(', ')}。可用：${SEARCH_FILTER_KEYS.join(', ')}`,
      400,
    );
  }

  const limit = typeof body.limit === 'number' ? body.limit : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return fail('invalid_request', 'limit 必须是 1..50 的整数', 400);
  }

  const items = [...REGISTRY.values()]
    .map((record) => {
      const hit = scoreRecord(record, term);
      if (hit === undefined) return undefined;
      if (!passSearchFilters(record, filters)) return undefined;
      return { record, hit };
    })
    .filter((x): x is { record: CatalogRecord; hit: { score: number; fields: string[] } } => x !== undefined)
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, limit)
    .map(({ record, hit }) => ({
      catalog_id: record.catalog_id,
      catalog_name: record.catalog_name,
      description: record.description,
      score: hit.score,
      matched_query_packs: record.supported_query_packs,
      verification_status: record.verification_status,
      trust_tier: record.trust_tier,
      health_status: record.health_status,
      route_hint: routeHint(record),
      explain: [
        hit.fields.length === 0
          ? '空查询：返回全部已注册 Catalog。'
          : `命中字段 ${hit.fields.join(', ')}，关键字 "${term}"。`,
        `健康状态 ${record.health_status}，信任等级 ${record.trust_tier}。`,
      ],
    }));

  return json({
    ocp_version: '1.0',
    kind: 'CatalogSearchResult',
    id: newId('csr'),
    registration_id: REGISTRATION.registration_id,
    result_count: items.length,
    items,
    explain: [`在 ${REGISTRY.size} 个已注册 Catalog 中匹配 "${term}"。`],
  });
}

/* ---------------------------------------------------------------- 注册/刷新 */

function validateRegistration(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const require = (key: string, kind = 'string'): void => {
    const v = body[key];
    if (kind === 'string' && (typeof v !== 'string' || v.length === 0)) errors.push(`${key} 必须是非空字符串`);
  };
  if (body.ocp_version !== '1.0') errors.push('ocp_version 必须是 "1.0"');
  if (body.kind !== 'CatalogRegistration') errors.push('kind 必须是 "CatalogRegistration"');
  for (const key of ['id', 'registration_id', 'catalog_id', 'updated_at', 'homepage', 'well_known_url']) {
    require(key);
  }
  if (typeof body.registration_version !== 'number' || !Number.isInteger(body.registration_version) || body.registration_version < 1) {
    errors.push('registration_version 必须是 >= 1 的整数');
  }
  if (!Array.isArray(body.claimed_domains) || body.claimed_domains.length === 0) {
    errors.push('claimed_domains 必须是非空数组');
  }
  return errors;
}

async function handleRegister(body: Record<string, unknown>, registrationId: string): Promise<OcpReply> {
  const errors = validateRegistration(body);
  if (errors.length > 0) return fail('invalid_registration', errors.join('; '), 400);

  const catalogId = String(body.catalog_id);
  const incomingVersion = Number(body.registration_version);
  const existing = REGISTRY.get(catalogId);
  if (existing !== undefined && incomingVersion < existing.registration_version) {
    // 规范里 status 有 stale_ignored 一档，这里真的用上。
    return json({
      ocp_version: '1.0',
      kind: 'CatalogRegistrationResult',
      id: newId('reg'),
      registration_id: registrationId,
      catalog_id: catalogId,
      status: 'stale_ignored',
      effective_registration_version: existing.registration_version,
      manifest_fetch_status: 'not_attempted',
      verification_status: existing.verification_status,
      health_status: existing.health_status,
      indexed: true,
      warnings: [`收到 registration_version ${incomingVersion}，低于已索引的 ${existing.registration_version}，已忽略。`],
      verification_challenges: [],
      message: 'stale registration ignored',
    });
  }

  const claimedDomains = (body.claimed_domains as unknown[]).filter((d): d is string => typeof d === 'string');
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const pulled = await pullCatalog(String(body.well_known_url), {
    tags,
    domains: claimedDomains,
    homepage: String(body.homepage),
  });

  if (pulled.record === undefined) {
    return json(
      {
        ocp_version: '1.0',
        kind: 'CatalogRegistrationResult',
        id: newId('reg'),
        registration_id: registrationId,
        catalog_id: catalogId,
        status: 'rejected',
        manifest_fetch_status: pulled.manifest_fetch_status,
        verification_status: 'not_required',
        health_status: 'unknown',
        indexed: false,
        warnings: pulled.warnings,
        verification_challenges: [],
        message: 'discovery 或 manifest 无法读取，注册被拒。',
      },
      200,
    );
  }

  // 声明的身份必须与目标自己 manifest 里自报的 catalog_id 一致。
  // 否则就是"甲来注册、指向乙的目录"，必须拒绝而不是静默记下。
  if (pulled.record.catalog_id !== catalogId) {
    return json(
      {
        ocp_version: '1.0',
        kind: 'CatalogRegistrationResult',
        id: newId('reg'),
        registration_id: registrationId,
        catalog_id: catalogId,
        status: 'rejected',
        manifest_fetch_status: 'fetched',
        verification_status: 'failed',
        health_status: pulled.record.health_status,
        indexed: false,
        warnings: [
          ...pulled.warnings,
          `声明的 catalog_id "${catalogId}" 与目标 manifest 自报的 "${pulled.record.catalog_id}" 不一致。`,
        ],
        verification_challenges: [],
        message: '目录身份不匹配，注册被拒。',
      },
      200,
    );
  }

  pulled.record.registration_version = incomingVersion;
  REGISTRY.set(catalogId, pulled.record);

  return json(
    {
      ocp_version: '1.0',
      kind: 'CatalogRegistrationResult',
      id: newId('reg'),
      registration_id: registrationId,
      catalog_id: catalogId,
      status: pulled.record.health_status === 'healthy' ? 'accepted_indexed' : 'accepted_limited',
      effective_registration_version: incomingVersion,
      manifest_fetch_status: 'fetched',
      verification_status: 'not_required',
      health_status: pulled.record.health_status,
      indexed: true,
      warnings: pulled.warnings,
      verification_challenges: [],
      message: `已索引 ${pulled.record.catalog_name}（health=${pulled.record.health_status}）`,
    },
    201,
  );
}

async function handleRefresh(catalogId: string): Promise<OcpReply> {
  const existing = REGISTRY.get(catalogId);
  if (existing === undefined) return fail('not_found', `未注册的 catalog_id "${catalogId}"`, 404);

  const pulled = await pullCatalog(existing.well_known_url, {
    tags: existing.tags,
    domains: existing.domains,
    homepage: existing.homepage,
  });
  if (pulled.record === undefined) {
    return json({
      ocp_version: '1.0',
      kind: 'CatalogRefreshResult',
      id: newId('ref'),
      registration_id: REGISTRATION.registration_id,
      catalog_id: catalogId,
      status: 'rejected',
      snapshot_id: existing.snapshot_id,
      health_status: existing.health_status,
      indexed: true,
      warnings: pulled.warnings,
      refreshed_at: nowIso(),
    });
  }

  pulled.record.registration_version = existing.registration_version;
  pulled.record.tags = existing.tags;
  pulled.record.domains = existing.domains;
  REGISTRY.set(catalogId, pulled.record);

  return json({
    ocp_version: '1.0',
    kind: 'CatalogRefreshResult',
    id: newId('ref'),
    registration_id: REGISTRATION.registration_id,
    catalog_id: catalogId,
    status: 'refreshed',
    snapshot_id: pulled.record.snapshot_id,
    health_status: pulled.record.health_status,
    indexed: true,
    warnings: pulled.warnings,
    refreshed_at: nowIso(),
  });
}

/* -------------------------------------------------------------------- 装配 */

export function registrationRoutes(registrationId: string): Route[] {
  return [
    {
      method: 'GET',
      path: '/health',
      handler: () =>
        json({
          ocp_version: '1.0',
          registration_id: REGISTRATION.registration_id,
          status: 'healthy',
          indexed_catalogs: REGISTRY.size,
          checked_at: nowIso(),
        }),
    },
    { method: 'GET', path: '/.well-known/ocp-registration', handler: () => json(discoveryDoc()) },
    { method: 'GET', path: '/ocp/registration/manifest', handler: () => json(manifestDoc()) },
    { method: 'POST', path: '/ocp/catalogs/register', handler: (ctx) => handleRegister(ctx.body, registrationId) },
    { method: 'POST', path: '/ocp/catalogs/search', handler: (ctx) => handleSearch(ctx.body) },
    {
      method: 'POST',
      path: '/ocp/catalogs/resolve',
      handler: (ctx): OcpReply => {
        const catalogId = typeof ctx.body.catalog_id === 'string' ? ctx.body.catalog_id : '';
        if (catalogId === '') return fail('invalid_request', 'catalog_id 必填', 400);
        const record = REGISTRY.get(catalogId);
        if (record === undefined) return fail('not_found', `未注册的 catalog_id "${catalogId}"`, 404);
        return json(routeHint(record));
      },
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/refresh',
      handler: (ctx): OcpReply | Promise<OcpReply> => {
        const catalogId = typeof ctx.body.catalog_id === 'string' ? ctx.body.catalog_id : '';
        if (catalogId === '') return fail('invalid_request', 'catalog_id 必填', 400);
        return handleRefresh(catalogId);
      },
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/:catalogId/refresh',
      handler: (ctx) => handleRefresh(ctx.params.catalogId ?? ''),
    },
    {
      method: 'GET',
      path: '/ocp/catalogs/:catalogId',
      handler: (ctx): OcpReply => {
        const record = REGISTRY.get(ctx.params.catalogId ?? '');
        if (record === undefined) return fail('not_found', '未注册的 catalog_id', 404);
        return json({
          ocp_version: '1.0',
          kind: 'CatalogProfileSnapshot',
          id: record.snapshot_id,
          registration_id: REGISTRATION.registration_id,
          catalog_id: record.catalog_id,
          catalog_name: record.catalog_name,
          description: record.description,
          homepage: record.homepage,
          well_known_url: record.well_known_url,
          manifest_url: record.manifest_url,
          query_capabilities: record.supported_query_packs.map((pack) => ({
            pack_id: pack,
            query_modes: record.supported_query_modes,
          })),
          object_contract_summaries: [],
          metadata: { tags: record.tags, domains: record.domains, resolve_url: record.resolve_url },
          verification_status: record.verification_status,
          health_status: record.health_status,
          trust_tier: record.trust_tier,
          freshness: { manifest_fetched_at: record.snapshot_fetched_at, health_checked_at: record.snapshot_fetched_at },
        });
      },
    },
    // 规范要求 manifest 声明 verify / token_rotate，但本演示不实现——如实返回 501 而不是假装成功。
    {
      method: 'POST',
      path: '/ocp/catalogs/verify',
      handler: () =>
        fail(
          'not_implemented',
          '本演示不做域名所有权校验（登记时为 requires_domain_verification:false，verification_status 恒为 not_required）。',
          501,
        ),
    },
    {
      method: 'POST',
      path: '/ocp/catalogs/token/rotate',
      handler: () => fail('not_implemented', '本演示不签发 catalog_access_token，因此没有令牌轮换。', 501),
    },
    {
      method: 'GET',
      path: '/demo/catalogs',
      handler: () => json({ note: '演示用：Registration 节点的索引全貌。', count: REGISTRY.size, catalogs: [...REGISTRY.values()] }),
    },
  ];
}

/** 启动 Registration 节点，并把两家奶茶铺真的注册进去。 */
export async function startRegistrationNode(shops: Shop[]): Promise<{ port: number; registered: string[] }> {
  const outcome = await startOrReuse(
    registrationRoutes(REGISTRATION.registration_id),
    REGISTRATION.port,
    REGISTRATION.registration_id,
  );

  // 复用一个已在运行的实例时，它的注册表是它自己启动时建的，这里不再重复播种。
  if (outcome.reused) return { port: REGISTRATION.port, registered: shops.map((s) => s.catalog_id) };

  const registered: string[] = [];
  for (const shop of shops) {
    const result = await handleRegister(
      {
        ocp_version: '1.0',
        kind: 'CatalogRegistration',
        id: `regdoc_${shop.catalog_id}`,
        registration_id: REGISTRATION.registration_id,
        catalog_id: shop.catalog_id,
        registration_version: 1,
        updated_at: nowIso(),
        homepage: shop.base_url,
        well_known_url: `${shop.base_url}/.well-known/ocp-catalog`,
        claimed_domains: [`127.0.0.1:${shop.port}`],
        operator: { display_name: `${shop.catalog_name} 门店运营` },
        intended_visibility: 'public',
        tags: shop.tags,
      },
      REGISTRATION.registration_id,
    );
    const body = result.body as { status?: string; message?: string };
    console.log(`[boot] 注册 ${shop.catalog_name}：${body.status} — ${body.message ?? ''}`);
    if (body.status === 'accepted_indexed' || body.status === 'accepted_limited') registered.push(shop.catalog_id);
  }
  return { port: REGISTRATION.port, registered };
}
