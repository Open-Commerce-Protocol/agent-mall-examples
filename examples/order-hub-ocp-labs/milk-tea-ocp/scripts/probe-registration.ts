/**
 * Registration 层探针：在进程内起「两家奶茶铺 + 奶茶导航」，然后打发现层的端点。
 *
 * 用法：node scripts/probe-registration.ts
 *
 * 注意：所有中文都通过 fetch 发送。不要用 PowerShell 的 Invoke-RestMethod 测中文，
 * 它的 body 编码会把中文改坏，让人误判成节点 bug。
 */
import { startOrReuse } from '../src/lib/net.ts';
import { catalogRoutes } from '../src/nodes/catalog-node.ts';
import { registrationRoutes, REGISTRATION, startRegistrationNode } from '../src/nodes/registration-node.ts';
import { shanhai } from '../src/shops/shanhai.ts';
import { shiguang } from '../src/shops/shiguang.ts';

const base = REGISTRATION.base_url;
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48, ' ')} ${detail}`);
};

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

void registrationRoutes; // 仅用于类型/路由自检，探针走真实 HTTP

// 先起两家奶茶铺：Registration 节点注册时会真的去拉它们的 discovery/manifest/health。
for (const shop of [shanhai, shiguang]) {
  await startOrReuse(catalogRoutes(shop), shop.port, shop.catalog_id);
}

const { registered } = await startRegistrationNode([shanhai, shiguang]);
console.log(`\n探针目标：${REGISTRATION.registration_name} (${base})`);
console.log(`已注册：${registered.join(', ')}\n${'-'.repeat(100)}`);

/* 1. 存活 */
{
  const { status, body } = await getJson('/health');
  record('GET /health', status === 200 && body.status === 'healthy' && body.indexed_catalogs === 2, `${status} indexed=${body.indexed_catalogs}`);
}

/* 2. 发现文档 */
{
  const { status, body } = await getJson('/.well-known/ocp-registration');
  record(
    'GET /.well-known/ocp-registration',
    status === 200 && body.kind === 'RegistrationDiscovery' && body.registration_protocol === 'ocp.catalog.registration.v1',
    `${status} kind=${body.kind}`,
  );
}

/* 3. registration manifest */
{
  const { status, body } = await getJson('/ocp/registration/manifest');
  const need = ['catalog_registration', 'catalog_search', 'catalog_resolve', 'catalog_verify', 'catalog_refresh', 'catalog_token_rotate'];
  const missing = need.filter((k) => typeof body.endpoints?.[k] !== 'string');
  record(
    'GET /ocp/registration/manifest',
    status === 200 && body.kind === 'RegistrationManifest' && missing.length === 0,
    `${status} endpoints=${Object.keys(body.endpoints ?? {}).length} 缺=${missing.length}`,
  );
}

/* 4. 全量检索 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { query: '' });
  const names = (body.items ?? []).map((i: any) => i.catalog_name);
  const hintOk = (body.items ?? []).every((i: any) => typeof i.route_hint?.query_url === 'string' && i.route_hint.query_url.length > 0);
  record(
    'POST /ocp/catalogs/search {query:""}',
    status === 200 && body.result_count === 2 && hintOk,
    `${status} count=${body.result_count} → ${names.join(' / ')} route_hint.query_url 齐全=${hintOk}`,
  );
}

/* 5. 按关键字（跨目录发现） */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { query: '珍珠' });
  const names = (body.items ?? []).map((i: any) => i.catalog_name);
  record(
    'POST /ocp/catalogs/search {query:"珍珠"}',
    status === 200 && body.result_count === 1 && names[0] === '山海茶铺',
    `${status} count=${body.result_count} → ${names.join(' / ')}`,
  );
}

/* 6. 按标签过滤 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { query: '', filters: { tag: '生椰' } });
  const names = (body.items ?? []).map((i: any) => i.catalog_name);
  record(
    'POST /ocp/catalogs/search {filters:{tag:"生椰"}}',
    status === 200 && body.result_count === 1 && names[0] === '拾光茶铺',
    `${status} count=${body.result_count} → ${names.join(' / ')}`,
  );
}

/* 7. 按 query pack 过滤 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { filters: { query_pack: 'ocp.query.milktea.keyword.v1' } });
  record('POST /ocp/catalogs/search {filters:{query_pack}}', status === 200 && body.result_count === 2, `${status} count=${body.result_count}`);
}

/* 8. 过滤器：无匹配 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { filters: { health_status: 'unhealthy' } });
  record('POST /ocp/catalogs/search {filters:{health_status:unhealthy}}', status === 200 && body.result_count === 0, `${status} count=${body.result_count}`);
}

/* 9. 负例：未知过滤器 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { query: '', filters: { price_max: 20 } });
  record('负例 未知过滤器 → 应 400', status === 400 && body.error?.code === 'unsupported_filter', `${status} code=${body.error?.code}`);
}

/* 10. 负例：query 超长 */
{
  const { status, body } = await postJson('/ocp/catalogs/search', { query: 'x'.repeat(501) });
  record('负例 query 超 500 字符 → 应 400', status === 400 && body.error?.code === 'invalid_request', `${status} code=${body.error?.code}`);
}

/* 11. 路由解析 */
{
  const { status, body } = await postJson('/ocp/catalogs/resolve', { catalog_id: shanhai.catalog_id });
  record(
    'POST /ocp/catalogs/resolve',
    status === 200 &&
      body.catalog_id === shanhai.catalog_id &&
      typeof body.query_url === 'string' &&
      typeof body.snapshot_id === 'string' &&
      typeof body.cache_ttl_seconds === 'number',
    `${status} ${body.catalog_name} query_url=${body.query_url}`,
  );
}

/* 12. 负例：resolve 未注册的 catalog */
{
  const { status, body } = await postJson('/ocp/catalogs/resolve', { catalog_id: 'cat_nope' });
  record('负例 resolve 未注册 catalog → 应 404', status === 404 && body.error?.code === 'not_found', `${status} code=${body.error?.code}`);
}

/* 13. 刷新（会真的重新拉 manifest + health） */
{
  const { status, body } = await postJson(`/ocp/catalogs/${shanhai.catalog_id}/refresh`, {});
  record(
    'POST /ocp/catalogs/:id/refresh',
    status === 200 && body.status === 'refreshed' && body.health_status === 'healthy' && body.indexed === true,
    `${status} status=${body.status} health=${body.health_status}`,
  );
}

/* 14. 负例：刷新未注册 */
{
  const { status, body } = await postJson('/ocp/catalogs/cat_nope/refresh', {});
  record('负例 refresh 未注册 → 应 404', status === 404, `${status} code=${body.error?.code}`);
}

/* 15. 重新注册（版本递增） */
{
  const { status, body } = await postJson('/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'regdoc_shanhai_v2',
    registration_id: REGISTRATION.registration_id,
    catalog_id: shanhai.catalog_id,
    registration_version: 2,
    updated_at: new Date().toISOString(),
    homepage: shanhai.base_url,
    well_known_url: `${shanhai.base_url}/.well-known/ocp-catalog`,
    claimed_domains: [`127.0.0.1:${shanhai.port}`],
    tags: shanhai.tags,
  });
  record(
    'POST /ocp/catalogs/register 版本 2',
    status === 201 && body.status === 'accepted_indexed' && body.manifest_fetch_status === 'fetched',
    `${status} status=${body.status} version=${body.effective_registration_version}`,
  );
}

/* 16. 过期注册：版本回退必须被忽略 */
{
  const { status, body } = await postJson('/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'regdoc_shanhai_v1',
    registration_id: REGISTRATION.registration_id,
    catalog_id: shanhai.catalog_id,
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: shanhai.base_url,
    well_known_url: `${shanhai.base_url}/.well-known/ocp-catalog`,
    claimed_domains: [`127.0.0.1:${shanhai.port}`],
    tags: shanhai.tags,
  });
  record(
    '负例 旧版本注册 → stale_ignored',
    status === 200 && body.status === 'stale_ignored' && body.indexed === true,
    `${status} status=${body.status} 已索引版本=${body.effective_registration_version}`,
  );
}

/* 17. 负例：注册文档缺字段 */
{
  const { status, body } = await postJson('/ocp/catalogs/register', { kind: 'CatalogRegistration', catalog_id: 'cat_x' });
  record('负例 注册缺字段 → 应 400', status === 400 && body.error?.code === 'invalid_registration', `${status} code=${body.error?.code}`);
}

/* 18. 负例：注册一个拉不到 discovery 的地址 */
{
  const { status, body } = await postJson('/ocp/catalogs/register', {
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'regdoc_dead',
    registration_id: REGISTRATION.registration_id,
    catalog_id: 'cat_dead',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: 'http://127.0.0.1:4599',
    well_known_url: 'http://127.0.0.1:4599/.well-known/ocp-catalog',
    claimed_domains: ['127.0.0.1:4599'],
    tags: [],
  });
  record(
    '负例 注册拉不到 discovery → rejected',
    status === 200 && body.status === 'rejected' && body.indexed === false,
    `${status} status=${body.status} warnings=${body.warnings?.length}`,
  );
}

/* 19. 店铺档案 */
{
  const { status, body } = await getJson(`/ocp/catalogs/${shiguang.catalog_id}`);
  record(
    'GET /ocp/catalogs/:catalogId',
    status === 200 && body.kind === 'CatalogProfileSnapshot' && body.catalog_id === shiguang.catalog_id,
    `${status} ${body.catalog_name} packs=${body.query_capabilities?.length}`,
  );
}

/* 20. 未实现端点必须如实 501，而不是假装成功 */
{
  const verify = await postJson('/ocp/catalogs/verify', {});
  const rotate = await postJson('/ocp/catalogs/token/rotate', {});
  record(
    'POST /ocp/catalogs/verify + token/rotate',
    verify.status === 501 && rotate.status === 501,
    `verify=${verify.status} rotate=${rotate.status} code=${verify.body.error?.code}`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(100));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(failed.length === 0 ? 0 : 1);
