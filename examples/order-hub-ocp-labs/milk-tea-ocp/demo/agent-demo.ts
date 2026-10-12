/**
 * 命令行演示：让"AI 帮你点一杯"这条链路在终端里真的跑一遍。
 *
 * 五步完全对应 ocp-catalog 技能正文里的 Workflow：
 *   1. Registration 只用来发现 Catalog
 *   2. 先看 manifest 再查询
 *   3. 只用 manifest 声明的 query pack 查询
 *   4. 只对选中的条目 resolve，拿 action binding
 *   5. 成交与支付在商户侧（本演示为模拟）
 *
 * 用法：node demo/agent-demo.ts
 * 如果 4500 已经在跑，就复用它；否则自己把三个节点起起来。
 */
import { startServer } from '../src/lib/http.ts';
import { catalogRoutes } from '../src/nodes/catalog-node.ts';
import { REGISTRATION, startRegistrationNode } from '../src/nodes/registration-node.ts';
import { shanhai } from '../src/shops/shanhai.ts';
import { shiguang } from '../src/shops/shiguang.ts';
import type { Shop } from '../src/shops/types.ts';

const REG = REGISTRATION.base_url;

const line = (char = '─'): void => console.log(char.repeat(84));
const step = (n: number, title: string): void => {
  console.log('');
  line();
  console.log(`第 ${n} 步 · ${title}`);
  line();
};
const kv = (k: string, v: string): void => console.log(`  ${k.padEnd(22, ' ')}${v}`);

async function api(url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = { error: { code: 'bad_json', message: '响应不是 JSON' } };
  }
  return { status: res.status, data };
}

async function stackIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${REG}/health`, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

/* 准备环境：能复用就复用，避免端口冲突 */
if (await stackIsUp()) {
  console.log('检测到 4500 已在运行，复用现有节点。');
} else {
  for (const shop of [shanhai, shiguang] as Shop[]) {
    await startServer(catalogRoutes(shop), shop.port, shop.catalog_id);
  }
  await startRegistrationNode([shanhai, shiguang]);
}

console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  用 OCP 协议点一杯奶茶 —— 全程只走协议，不手工拼任何 URL                          ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

/* ------------------------------------------------------------------ 第 1 步 */
step(1, '发现：谁在卖奶茶（Registration 只回答这个）');
const disc = await api(`${REG}/.well-known/ocp-registration`);
kv('发现文档 kind', disc.data.kind);
kv('注册节点', `${disc.data.registration_name} (${disc.data.registration_id})`);
kv('协议', `${disc.data.registration_protocol} v${disc.data.registration_protocol_version}`);

const regManifest = await api(disc.data.manifest_url);
kv('检索端点', regManifest.data.endpoints.catalog_search);

const TERM = '珍珠';
const search = await api(regManifest.data.endpoints.catalog_search, { query: TERM });
console.log(`\n  检索「${TERM}」→ 命中 ${search.data.result_count} 个 Catalog：`);
for (const item of search.data.items) {
  console.log(
    `    · ${item.catalog_name.padEnd(8, '　')} ${item.catalog_id.padEnd(20)} ` +
      `health=${item.health_status.padEnd(8)} trust=${item.trust_tier.padEnd(10)} score=${item.score}`,
  );
  console.log(`      └ ${item.explain[0]}`);
}

/* ------------------------------------------------------------------ 第 2 步 */
step(2, '选定一家，先读它的 manifest');
const chosen = search.data.items[0];
kv('选中的目录', `${chosen.catalog_name} (${chosen.catalog_id})`);

const route = await api(`${REG}/ocp/catalogs/resolve`, { catalog_id: chosen.catalog_id });
kv('路由提示 manifest', route.data.manifest_url);
kv('路由提示 query', route.data.query_url);
kv('快照', `${route.data.snapshot_id} @ ${route.data.snapshot_fetched_at}`);

const manifest = await api(route.data.manifest_url);
kv('manifest kind', manifest.data.kind);
kv('可见性', manifest.data.registry_visibility);
kv('对象契约', `${manifest.data.object_contracts.length} 条（只读节点为空，但字段必填）`);
console.log('  端点：');
for (const [name, ep] of Object.entries(manifest.data.endpoints)) {
  console.log(`    · ${name.padEnd(10)} ${ep.method.padEnd(5)} ${ep.url}`);
}
const pack = manifest.data.query_capabilities[0].query_packs[0];
kv('声明的 query pack', pack.pack_id);
kv('声明的执行模式', pack.query_modes.join(', '));

/* ------------------------------------------------------------------ 第 3 步 */
step(3, '查询：只用 manifest 声明的 pack');
const query = await api(manifest.data.endpoints.query.url, {
  ocp_version: '1.0',
  query_pack: pack.pack_id,
  query_mode: 'keyword',
  query: TERM,
});
console.log(`  命中 ${query.data.result_count} 款（query_pack=${query.data.query_pack}）：`);
for (const match of query.data.entries) {
  const a = match.entry.attributes;
  console.log(
    `    · ${match.entry.title.padEnd(14, '　')} ¥${String(a.price.amount).padEnd(4)} ` +
      `${a.inventory.availability_status.padEnd(14)} ${match.entry.entry_id}`,
  );
}
kv('policy_summary', `接受过滤 [${query.data.policy_summary.accepted_filters.join(', ')}]`);

console.log('\n  负例：故意用一个未声明的 pack');
const badPack = await api(manifest.data.endpoints.query.url, {
  ocp_version: '1.0',
  query_pack: 'ocp.query.semantic.v9',
  query: TERM,
});
console.log(`    HTTP ${badPack.status}  ${badPack.data.error.code}`);
console.log(`    ${badPack.data.error.message}`);

/* ------------------------------------------------------------------ 第 4 步 */
const inStock = query.data.entries.find(
  (m: any) => m.entry.attributes.inventory.availability_status === 'in_stock',
);

step(4, '解析：拿到点单入口（purpose=checkout）');
console.log(`  目标：${inStock.entry.title}`);
const resolved = await api(manifest.data.endpoints.resolve.url, {
  entry_id: inStock.entry.entry_id,
  purpose: 'checkout',
  live_check: true,
});
kv('kind', resolved.data.kind);
kv('permission_state', resolved.data.access.permission_state);
for (const check of resolved.data.live_checks) {
  kv(`live_check ${check.check_id}`, `${check.status} — ${check.summary}`);
}
console.log('  action_bindings：');
for (const b of resolved.data.action_bindings) {
  console.log(`    · ${b.action_id.padEnd(14)} ${b.action_type.padEnd(5)} ${b.label}`);
  console.log(`      ${b.entrypoint.method} ${b.entrypoint.url}`);
  if (b.requires_user_confirmation) console.log('      ⚠ requires_user_confirmation = true（协议要求人工确认）');
}
for (const note of resolved.data.access.policy_notes) console.log(`  policy_note: ${note}`);

console.log('\n  负例：售罄的那杯，resolve 应当拿不到下单入口');
const soldQuery = await api(manifest.data.endpoints.query.url, {
  ocp_version: '1.0', query_pack: pack.pack_id, query_mode: 'keyword', query: '姜母',
});
const sold = soldQuery.data.entries[0];
if (sold !== undefined) {
  const soldResolve = await api(manifest.data.endpoints.resolve.url, {
    entry_id: sold.entry.entry_id,
    purpose: 'checkout',
  });
  kv('目标', sold.entry.title);
  kv('action_bindings', `${soldResolve.data.action_bindings.length} 条`);
  kv('live_check', `${soldResolve.data.live_checks[0]?.status} — ${soldResolve.data.live_checks[0]?.summary}`);
  kv('permission_state', soldResolve.data.access.permission_state);
  console.log(`    结论：${soldResolve.data.access.policy_notes[1] ?? ''}`);
} else {
  console.log('    （本次检索没有售罄款，跳过）');
}

/* ------------------------------------------------------------------ 第 5 步 */
step(5, '下单：走商户侧的入口（此处已离开 OCP 协议面）');
const checkoutApi = resolved.data.action_bindings.find((b: any) => b.action_id === 'checkout_api');
const checkoutPage = resolved.data.action_bindings.find((b: any) => b.action_id === 'checkout_page');
console.log(`  POST ${checkoutApi.entrypoint.url}`);
console.log(`  商户声明的 input_schema.const(sku) = ${JSON.stringify(checkoutApi.input_schema.properties.sku.const)}`);

const order = await api(checkoutApi.entrypoint.url, {
  sku: checkoutApi.input_schema.properties.sku.const,
  size: 'large',
  sugar: '五分糖',
  temperature: '少冰',
  quantity: 1,
});
console.log(`\n  HTTP ${order.status}`);
kv('订单号', order.data.order_id);
kv('门店', `${order.data.store} · ${order.data.store_address}`);
kv('合计', `¥${order.data.total.amount}`);
kv('payment', order.data.payment);
console.log(`  ${order.data.note}`);

/* ---------------------------------------------------------------- 收尾 */
console.log('');
line('═');
console.log('完成。这条链路里每一跳都是协议规定的：');
console.log('  Registration 只用来发现 → manifest 决定能怎么查 → query 只用声明的 pack');
console.log('  → resolve 只给入口，且售罄就不给 → 成交发生在商户侧，OCP 不碰钱。');
console.log('');
console.log(`  想在下单页手点一次：${checkoutPage?.entrypoint.url ?? '(无)'}`);
console.log('  可视化面板（浏览器）：npm start 后打开 http://127.0.0.1:4600');
console.log('  一致性自检：npm run selfcheck');
line('═');

// 进程内起过的节点随本进程退出而结束；留一点时间让 stdout 刷干净。
setTimeout(() => process.exit(0), 80);
