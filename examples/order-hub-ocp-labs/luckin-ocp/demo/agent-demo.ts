/**
 * 端到端演示：用 OCP 协议点一杯瑞幸。
 *
 * 五步与 ocp-catalog 技能正文的 Workflow 一一对应，只是把"奶茶铺"换成了"瑞幸门店"：
 *   1. Registration 只用来发现 Catalog
 *   2. 先读 manifest 再查询
 *   3. 只用 manifest 声明的 query pack 查询
 *   4. 只对选中条目 resolve，拿 action binding
 *   5. 成交与支付在商户侧
 *
 * ⚠️ 本脚本**不会真实下单**。第 6 步刻意展示护栏拒绝（428）与解锁方式，
 * 真实 createOrder 必须由人在核对确认单后显式武装指纹才会执行。
 *
 * 用法：node demo/agent-demo.ts [关键字]
 */
import { bootstrap } from '../src/bootstrap.ts';
import { BRIDGE_PORT } from '../src/bridge/bridge-node.ts';
import { LUCKIN_CATALOG_PORT, LUCKIN_QUERY_PACK } from '../src/catalog/luckin-catalog.ts';
import { REGISTRATION_PORT } from '../src/catalog/registration-node.ts';
import { localTime, minutesUntilClose } from '../src/lib/time.ts';

const TERM = process.argv[2] ?? '生椰拿铁';
const CATALOG = `http://127.0.0.1:${LUCKIN_CATALOG_PORT}`;
const BRIDGE = `http://127.0.0.1:${BRIDGE_PORT}`;
const REG = `http://127.0.0.1:${REGISTRATION_PORT}`;

const api = async (url: string, body?: unknown): Promise<any> => {
  const res = await fetch(url, body === undefined ? { signal: AbortSignal.timeout(60_000) } : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return res.json();
};

const line = (char = '─'): void => console.log(char.repeat(88));
const step = (n: number, title: string): void => {
  console.log('');
  line();
  console.log(`第 ${n} 步 · ${title}`);
  line();
};
const kv = (k: string, v: string): void => console.log(`  ${k.padEnd(22, ' ')}${v}`);
const cny = (n: unknown): string => (typeof n === 'number' ? `¥${n}` : '—');

console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  OCP × 瑞幸 MCP：OCP 管发现与协商，MCP 管执行                                        ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');

const stack = await bootstrap();
void stack;

/* ------------------------------------------------------------------ 第 1 步 */
step(1, '发现：哪些门店在卖（Registration 只回答这个）');
const disc = await api(`${REG}/.well-known/ocp-registration`);
kv('发现文档', `${disc.registration_name} (${disc.registration_id})`);
kv('协议', `${disc.registration_protocol} v${disc.registration_protocol_version}`);
const regManifest = await api(disc.manifest_url);
kv('检索端点', regManifest.endpoints.catalog_search);

const search = await api(regManifest.endpoints.catalog_search, { query: '' });
console.log(`\n  空查询 → 按距离由近到远返回 ${search.result_count} 家门店 Catalog：`);
for (const item of search.items) {
  const m = item.route_hint.metadata;
  const left = minutesUntilClose(m.work_hours);
  const leftText = left === undefined ? '' : left <= 0 ? '（已过营业时间）' : `（还剩 ${left} 分钟）`;
  console.log(
    `    · ${item.catalog_name.padEnd(30, '　')} ${String(m.distance_km ?? '?').padStart(6)}km  ` +
      `${String(m.work_hours ?? '?').padEnd(11)} ${String(m.work_status).padEnd(4)} ${leftText}`,
  );
}

const byName = await api(regManifest.endpoints.catalog_search, { query: '武林' });
console.log(`\n  按店名「武林」检索 → ${byName.result_count} 家：${byName.items.map((i: any) => i.catalog_name.replace('瑞幸咖啡 · ', '')).join(' / ')}`);

/* ------------------------------------------------------------------ 第 2 步 */
step(2, '选定一家，先读它的 manifest');
const openStores = search.items.filter((i: any) => i.route_hint.metadata.work_status === '营业中');
/** 距打烊至少留这么多分钟，否则不选它——免得取餐时间落在营业时间之外。 */
const MIN_LEAD_MINUTES = 30;
const withTime = openStores.map((i: any) => ({ item: i, left: minutesUntilClose(i.route_hint.metadata.work_hours) }));
const risky = withTime.filter((x: any) => x.left !== undefined && x.left < MIN_LEAD_MINUTES);
const safe = withTime.filter((x: any) => x.left === undefined || x.left >= MIN_LEAD_MINUTES);
if (risky.length > 0) {
  console.log(`\n  跳过 ${risky.length} 家即将打烊的门店（距打烊不足 ${MIN_LEAD_MINUTES} 分钟）：`);
  for (const r of risky) {
    console.log(
      `    · ${r.item.catalog_name.replace('瑞幸咖啡 · ', '')} 营业至 ${r.item.route_hint.metadata.work_hours}` +
        `（还剩 ${r.left} 分钟，取餐时间会落在营业时间之外）`,
    );
  }
}
const chosen = (safe[0] ?? withTime[0]).item;
const deptId = Number(String(chosen.route_hint.query_url).match(/stores\/(\d+)/)?.[1]);
kv('选中的目录', `${chosen.catalog_name}`);
kv('catalog_id', chosen.catalog_id);
kv('query 端点', chosen.route_hint.query_url);
kv('resolve 端点', chosen.route_hint.resolve_url);
kv('营业 / 距离', `${chosen.route_hint.metadata.work_status} · ${chosen.route_hint.metadata.work_hours} · ${chosen.route_hint.metadata.distance_km}km`);

const manifest = await api(`${CATALOG}/stores/${deptId}/ocp/manifest`);
kv('manifest', `${manifest.kind} v${manifest.ocp_version}`);
const pack = manifest.query_capabilities[0].query_packs[0];
kv('声明的 query pack', pack.pack_id);
kv('声明的执行模式', pack.query_modes.join(', '));

/* ------------------------------------------------------------------ 第 3 步 */
step(3, `查询：只用 manifest 声明的 pack（关键字「${TERM}」）`);
const query = await api(`${CATALOG}/stores/${deptId}/ocp/query`, {
  query_pack: pack.pack_id,
  query_mode: 'keyword',
  query: TERM,
});
console.log(`  命中 ${query.result_count} 款：`);
for (const match of query.entries) {
  const a = match.entry.attributes;
  console.log(`    · productId=${String(a.luckin.productId).padEnd(5)} ${match.entry.title.padEnd(24, '　')} ${cny(a.price.amount)}`);
}
kv('policy_summary', `接受过滤 [${query.policy_summary.accepted_filters.join(', ') || '无'}]`);

console.log('\n  负例：故意用未声明的 pack');
const badPack = await api(`${CATALOG}/stores/${deptId}/ocp/query`, { query_pack: 'ocp.query.semantic.v9', query: TERM });
console.log(`    HTTP ${badPack.error ? '400' : '200'}  ${badPack.error?.code}`);

/* ---------------------------------------------- 跨门店聚合（OCP 的增值点） */
step(3.5, '跨门店聚合：同一杯在各门店的可得性与价格');
console.log('  这是 OCP 真正增值的地方——8 家门店是 8 个独立 Catalog，聚合属于发现层的工作。\n');
for (const item of search.items.slice(0, 4)) {
  const d = Number(String(item.route_hint.query_url).match(/stores\/(\d+)/)?.[1]);
  const q = await api(`${CATALOG}/stores/${d}/ocp/query`, { query_pack: LUCKIN_QUERY_PACK, query_mode: 'keyword', query: TERM });
  const first = q.entries?.[0]?.entry;
  const price = first?.attributes?.price?.amount;
  console.log(
    `    · ${item.catalog_name.padEnd(30, '　')} ${String(item.route_hint.metadata.distance_km).padStart(6)}km  ` +
      `命中 ${q.result_count} 款  ${first ? `${first.title} ${cny(price)}` : '（无）'}`,
  );
}

/* ------------------------------------------------------------------ 第 4 步 */
step(4, '解析：拿点单入口（purpose=checkout）');
const entry = query.entries[0].entry;
const productId = Number(entry.object_id);
const resolved = await api(`${CATALOG}/stores/${deptId}/ocp/resolve`, { entry_id: entry.entry_id, purpose: 'checkout' });
kv('entry_id', resolved.entry_id);
kv('permission_state', resolved.access.permission_state);
for (const check of resolved.live_checks) kv(`check ${check.check_id}`, `${check.status} — ${check.summary}`);

console.log('\n  实时全量规格（来自瑞幸 queryProductDetailInfo）：');
for (const option of resolved.visible_attributes.options) {
  const choices = option.choices
    .map((c: any) => `${c.name}${c.price_delta ? `(+${cny(c.price_delta)})` : ''}`)
    .join(' ');
  console.log(`    attrId=${String(option.attribute_id).padEnd(5)} ${String(option.attribute_name).padEnd(6)} ${choices}`);
}

console.log('\n  action_bindings：');
for (const b of resolved.action_bindings) {
  const flag = b.requires_user_confirmation ? '  ⚠ 需要用户确认' : '';
  console.log(`    · ${b.action_id.padEnd(16)} ${b.action_type.padEnd(8)} ${b.label}${flag}`);
  console.log(`      ${b.entrypoint.method} ${b.entrypoint.url}`);
}
for (const note of resolved.access.policy_notes) console.log(`  policy_note: ${note}`);

/* ------------------------------------------------------------------ 第 5 步 */
step(5, '选规格 + 预览（都还没下单）');
const detail = await api(`${BRIDGE}/product`, { deptId, productId });
const tempAttr = (detail.productAttrs ?? []).find((a: any) => a.attributeName === '温度');
const hot = (tempAttr?.productSubAttrs ?? []).find((s: any) => String(s.attributeName).includes('热'));

let skuCode: string = detail.skuCode;
if (tempAttr !== undefined && hot !== undefined) {
  const configured = await api(`${BRIDGE}/configure`, {
    deptId,
    productId,
    skuCode,
    amount: 1,
    selections: [{ attributeId: tempAttr.attributeId, subAttributeId: hot.attributeId }],
  });
  console.log(`  切规格「温度→热」：${skuCode} → ${configured.final_sku_code}（switchProduct 无副作用）`);
  skuCode = configured.final_sku_code;
}

const productList = [{ productId, skuCode, amount: 1 }];
const preview = await api(`${BRIDGE}/preview`, { deptId, productList });
const s = preview.order_summary;
console.log('');
line('═');
console.log('  订单确认单（由 previewOrder 实时算出）');
line('═');
kv('门店', s.store.dept_name);
kv('地址', s.store.address);
kv('营业 / 距离', `${s.store.work_hours} · ${s.store.distance_km}km`);
for (const l of s.lines) {
  kv('商品', `${l.name} ×${l.amount}`);
  kv('规格', String(l.specs));
  kv('skuCode', l.skuCode);
}
kv('原价', cny(s.pricing.total_initial));
kv('优惠', cny(s.pricing.privilege));
kv('实付', cny(s.pricing.payable));
kv('优惠券', s.coupon_codes.length > 0 ? s.coupon_codes.join(', ') : '（无可用券）');
kv('取餐时间', localTime(s.pickup.about_time_ms));
kv('订单指纹', preview.fingerprint);
line('═');

/* ------------------------------------------------------------------ 第 6 步 */
step(6, '尝试下单 → 护栏拒绝（这一步刻意不产生订单）');
const attempt = await api(`${BRIDGE}/create`, { deptId, productList, expected_amount: s.pricing.payable });
console.log(`  桥接层返回 guard.error.code = ${attempt.error?.code}`);
console.log(`  ${attempt.error?.message}`);
console.log('\n  解锁方式（必须由人完成）：');
kv('step 1', attempt.how_to_arm?.step_1 ?? '');
kv('step 2', attempt.how_to_arm?.step_2 ?? '');
kv('step 3', attempt.how_to_arm?.step_3 ?? '');
kv('armed_fingerprint', String(attempt.armed_fingerprint));
console.log(`\n  ${attempt.note}`);

/* ---------------------------------------------------------------- 收尾 */
console.log('');
line('═');
console.log('这条链路里每一跳都是协议规定的：');
console.log('  Registration 只用来发现门店 → manifest 决定能怎么查 → query 只用声明的 pack');
console.log('  → resolve 只给入口（create_order 标了 requires_user_confirmation）');
console.log('  → 选规格与预览都无副作用 → 真实扣款必须由人在核对确认单后显式解锁。');
console.log('');
console.log('  一致性自检：npm run selfcheck');
console.log('  token 只存在于桥接层，从不进入 OCP 响应（OCP 的 auth_requirements 不定义凭据传递）。');
line('═');

setTimeout(() => process.exit(0), 80);
