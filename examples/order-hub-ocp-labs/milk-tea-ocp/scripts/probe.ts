/**
 * 快速探针：在进程内起一个节点，依次打它的端点（含负例）并打印 PASS/FAIL。
 *
 * 用法：node scripts/probe.ts [shanhai|shiguang]
 *
 * 这是开发期的第一道验收；更严格的 schema 校验在 scripts/selfcheck.ts。
 */
import { startOrReuse } from '../src/lib/net.ts';
import { catalogRoutes } from '../src/nodes/catalog-node.ts';
import { shanhai } from '../src/shops/shanhai.ts';
import { shiguang } from '../src/shops/shiguang.ts';
import type { Shop } from '../src/shops/types.ts';

const key = process.argv[2] ?? 'shanhai';
const shop: Shop = key === 'shiguang' ? shiguang : shanhai;
const base = `http://127.0.0.1:${shop.port}`;

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46, ' ')} ${detail}`);
};

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

await startOrReuse(catalogRoutes(shop), shop.port, shop.catalog_id);
console.log(`\n探针目标：${shop.catalog_name} (${base})\n${'-'.repeat(96)}`);

/* 1. 发现文档 */
{
  const { status, body } = await getJson('/.well-known/ocp-catalog');
  record(
    'GET /.well-known/ocp-catalog',
    status === 200 && body.kind === 'WellKnownCatalogDiscovery' && typeof body.manifest_url === 'string',
    `${status} kind=${body.kind}`,
  );
}

/* 2. 存活 */
{
  const { status, body } = await getJson('/ocp/health');
  record('GET /ocp/health', status === 200 && body.status === 'healthy', `${status} status=${body.status}`);
}

/* 3. manifest */
{
  const { status, body } = await getJson('/ocp/manifest');
  const pack = body.query_capabilities?.[0]?.query_packs?.[0]?.pack_id;
  record(
    'GET /ocp/manifest',
    status === 200 && body.kind === 'CatalogManifest' && pack === shop.query_pack,
    `${status} pack=${pack} endpoints=${Object.keys(body.endpoints ?? {}).join('/')}`,
  );
}

/* 4. 契约 */
{
  const { status, body } = await getJson('/ocp/contracts');
  record(
    'GET /ocp/contracts',
    status === 200 && body.kind === 'ObjectContractList' && Array.isArray(body.object_contracts),
    `${status} contracts=${body.object_contracts?.length}`,
  );
}

/* 5. 正常查询 */
{
  const { status, body } = await postJson('/ocp/query', { query: '珍珠' });
  const titles = (body.entries ?? []).map((e: any) => e.entry.title);
  record(
    'POST /ocp/query {query:"珍珠"}',
    status === 200 && body.kind === 'CatalogQueryResult' && body.result_count > 0,
    `${status} count=${body.result_count} → ${titles.join(' / ')}`,
  );
}

/* 6. 过滤器 */
{
  const { status, body } = await postJson('/ocp/query', { query: '', filters: { in_stock_only: true } });
  const allInStock = (body.entries ?? []).every((e: any) => e.entry.attributes.inventory.availability_status === 'in_stock');
  record(
    'POST /ocp/query {filters:{in_stock_only:true}}',
    status === 200 && allInStock && body.result_count < shop.menu.length,
    `${status} count=${body.result_count}/${shop.menu.length} 全部有货=${allInStock}`,
  );
}

/* 7. 负例：未声明的 query pack */
{
  const { status, body } = await postJson('/ocp/query', { query: '珍珠', query_pack: 'ocp.query.semantic.v9' });
  record(
    '负例 未声明 query_pack → 应 400',
    status === 400 && body.error?.code === 'unsupported_query_pack',
    `${status} code=${body.error?.code}`,
  );
}

/* 8. 负例：未声明的 query_mode */
{
  const { status, body } = await postJson('/ocp/query', { query: '珍珠', query_mode: 'semantic' });
  record(
    '负例 未声明 query_mode → 应 400',
    status === 400 && body.error?.code === 'unsupported_query_mode',
    `${status} code=${body.error?.code}`,
  );
}

/* 9. 负例：未知顶层字段（请求 schema 是 .strict()） */
{
  const { status, body } = await postJson('/ocp/query', { query: '珍珠', sort_by: 'price' });
  record(
    '负例 未知字段 sort_by → 应 400',
    status === 400 && body.error?.code === 'unexpected_field',
    `${status} code=${body.error?.code}`,
  );
}

/* 10. 负例：未知过滤器 */
{
  const { status, body } = await postJson('/ocp/query', { query: '珍珠', filters: { max_sugar: '5' } });
  record(
    '负例 未知过滤器 max_sugar → 应 400',
    status === 400 && body.error?.code === 'unsupported_filter',
    `${status} code=${body.error?.code}`,
  );
}

/* 11. resolve：view */
const firstInStock = shop.menu.find((m) => m.availability === 'in_stock');
const inStockEntry = `entry_${shop.provider_id}_${firstInStock?.sku}`;
{
  const { status, body } = await postJson('/ocp/resolve', { entry_id: inStockEntry, purpose: 'view' });
  const actions = (body.action_bindings ?? []).map((b: any) => b.action_id);
  record(
    `POST /ocp/resolve purpose=view`,
    status === 200 && body.kind === 'ResolvableReference' && actions.includes('view_product'),
    `${status} actions=${actions.join('/')}`,
  );
}

/* 12. resolve：checkout（有货） */
{
  const { status, body } = await postJson('/ocp/resolve', {
    entry_id: inStockEntry,
    purpose: 'checkout',
    live_check: true,
  });
  const actions = (body.action_bindings ?? []).map((b: any) => b.action_id);
  const needsConfirm = (body.action_bindings ?? []).every((b: any) => b.requires_user_confirmation === true);
  record(
    'POST /ocp/resolve purpose=checkout（有货）',
    status === 200 && actions.includes('checkout_page') && actions.includes('checkout_api') && needsConfirm,
    `${status} actions=${actions.join('/')} 需确认=${needsConfirm}`,
  );
}

/* 13. resolve：checkout（售罄）—— 应拿不到下单入口 */
const soldOut = shop.menu.find((m) => m.availability === 'out_of_stock');
if (soldOut !== undefined) {
  const { status, body } = await postJson('/ocp/resolve', {
    entry_id: `entry_${shop.provider_id}_${soldOut.sku}`,
    purpose: 'checkout',
  });
  const actions = (body.action_bindings ?? []).map((b: any) => b.action_id);
  const liveFailed = body.live_checks?.[0]?.status === 'failed';
  record(
    'POST /ocp/resolve purpose=checkout（售罄）',
    status === 200 && actions.length === 0 && liveFailed && body.access?.permission_state === 'limited',
    `${status} actions=[${actions.join('/')}] live_check=${body.live_checks?.[0]?.status}`,
  );
}

/* 14. 负例：未知 entry_id */
{
  const { status, body } = await postJson('/ocp/resolve', { entry_id: 'entry_nobody_xxx' });
  record('负例 未知 entry_id → 应 404', status === 404 && body.error?.code === 'not_found', `${status} code=${body.error?.code}`);
}

/* 15. 商户侧菜单页 */
{
  const res = await fetch(`${base}/menu`);
  const text = await res.text();
  record('GET /menu（商户网站）', res.status === 200 && text.includes(shop.catalog_name), `${res.status} ${text.length}B`);
}

/* 16. 下单页 */
{
  const res = await fetch(`${base}/order?entry_id=${encodeURIComponent(inStockEntry)}`);
  const text = await res.text();
  record('GET /order（下单页）', res.status === 200 && text.includes('提交订单'), `${res.status} ${text.length}B`);
}

/* 17. 下单（JSON API，对应 checkout_api 绑定） */
{
  const size = firstInStock?.sizes[1]?.id ?? 'medium';
  const { status, body } = await postJson('/order', { sku: firstInStock?.sku, size, quantity: 2 });
  record(
    'POST /order JSON（模拟下单）',
    status === 201 && typeof body.order_id === 'string' && body.payment === 'simulated_not_charged',
    `${status} ${body.order_id} ¥${body.total?.amount} payment=${body.payment}`,
  );
}

/* 18. 负例：非法规格 */
{
  const { status, body } = await postJson('/order', { sku: firstInStock?.sku, size: 'gigantic' });
  record('负例 非法 size → 应 400', status === 400 && body.error?.code === 'invalid_order', `${status} code=${body.error?.code}`);
}

/* 19. 负例：对售罄商品下单 */
if (soldOut !== undefined) {
  const { status, body } = await postJson('/order', { sku: soldOut.sku, size: soldOut.sizes[0]?.id });
  record(
    '负例 售罄商品下单 → 应 400',
    status === 400 && String(body.error?.message).includes('售罄'),
    `${status} ${body.error?.code}`,
  );
}

/* 汇总 */
const failed = results.filter((r) => !r.ok);
console.log(`${'-'.repeat(96)}`);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}

process.exit(failed.length === 0 ? 0 : 1);
