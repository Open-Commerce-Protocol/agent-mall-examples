/**
 * 核心链路探针：起 Catalog 节点 + 桥接层，把只读链路与**护栏**都验一遍。
 *
 * 重点：本探针**绝不走进下单成功路径**。它只验证护栏的两种拒绝：
 *   1. 未武装                 → 428 confirmation_required
 *   2. 已武装但金额不符        → 428 price_changed
 * 这样"护栏有效"是被证明的，而订单一个都不会产生。
 *
 * 用法：node scripts/probe-core.ts [关键字]
 */
import { startOrReuse } from '../src/lib/net.ts';
import { createMcpClient, loadToken } from '../src/mcp/client.ts';
import { createLuckinTools, type Product, type Shop } from '../src/mcp/tools.ts';
import { createStoreDirectory } from '../src/catalog/store-directory.ts';
import {
  LUCKIN_CATALOG_PORT,
  LUCKIN_QUERY_PACK,
  catalogIdFor,
  entryIdFor,
  luckinCatalogRoutes,
} from '../src/catalog/luckin-catalog.ts';
import { BRIDGE_PORT, bridgeRoutes } from '../src/bridge/bridge-node.ts';
import { orderFingerprint } from '../src/bridge/guard.ts';

const HERE = { longitude: 120.1551, latitude: 30.2741 };
const TERM = process.argv[2] ?? '生椰拿铁';
const CATALOG = `http://127.0.0.1:${LUCKIN_CATALOG_PORT}`;
const BRIDGE = `http://127.0.0.1:${BRIDGE_PORT}`;

const results: { name: string; ok: boolean; detail: string }[] = [];
/** 复用外部实例时无法在本进程武装护栏，该项诚实跳过并单独计数。 */
let skipped = 0;
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46, ' ')} ${detail}`);
};

async function post(url: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, data: await res.json() };
}
async function get(url: string): Promise<{ status: number; data: any }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  return { status: res.status, data: await res.json() };
}

/* 启动 */
const { token, source } = loadToken();
console.log(`\ntoken 来源 ${source}`);
const client = createMcpClient({ token, clientName: 'luckin-ocp-probe-core' });
const tools = createLuckinTools(client);
const stores = createStoreDirectory(tools, HERE);
await stores.refresh();

const catalogStart = await startOrReuse(luckinCatalogRoutes(stores, tools), LUCKIN_CATALOG_PORT, 'luckin-catalog');
const bridgeStart = await startOrReuse(bridgeRoutes(tools, stores), BRIDGE_PORT, 'bridge');
/** 复用了外部实例时，本进程改 process.env 影响不到服务方，武装护栏那一项无法在本进程完成。 */
const canArmLocally = !catalogStart.reused && !bridgeStart.reused;
console.log(`Catalog 节点 :${LUCKIN_CATALOG_PORT}   桥接层 :${BRIDGE_PORT}${canArmLocally ? '' : '（复用外部实例）'}`);
console.log('-'.repeat(100));

/* 1. 门店缓存 */
const shops = stores.list();
record('门店缓存', shops.length > 0, `${shops.length} 家门店`);
const shop: Shop | undefined = shops.find((s) => s.workStatus === '营业中') ?? shops[0];
if (shop === undefined) {
  console.log('没有可用门店，终止。');
  process.exit(1);
}
console.log(`      选定 ${shop.deptName}（deptId=${shop.deptId}，${shop.address}）`);
const base = `${CATALOG}/stores/${shop.deptId}`;

/* 2. manifest */
const manifest = await get(`${base}/ocp/manifest`);
record(
  'GET manifest',
  manifest.status === 200 && manifest.data.catalog_id === catalogIdFor(shop.deptId),
  `${manifest.status} ${manifest.data.catalog_name}`,
);

/* 3. health */
const health = await get(`${base}/ocp/health`);
record('GET health', health.status === 200 && health.data.ready === true, `${health.status} ${health.data.status}`);

/* 4. query */
const query = await post(`${base}/ocp/query`, { query_pack: LUCKIN_QUERY_PACK, query_mode: 'keyword', query: TERM });
const entries = query.data.entries ?? [];
record(
  `POST query "${TERM}"`,
  query.status === 200 && entries.length > 0,
  `${query.status} 命中 ${query.data.result_count} 款 → ${entries.map((e: any) => e.entry.title).join(' / ')}`,
);

/* 5. 负例：空 query */
const emptyQuery = await post(`${base}/ocp/query`, { query: '' });
record('负例 空 query → 应 400', emptyQuery.status === 400 && emptyQuery.data.error?.code === 'invalid_request', `${emptyQuery.status} ${emptyQuery.data.error?.code}`);

/* 6. 负例：未声明的 pack */
const badPack = await post(`${base}/ocp/query`, { query: TERM, query_pack: 'ocp.query.semantic.v9' });
record('负例 未声明 pack → 应 400', badPack.status === 400 && badPack.data.error?.code === 'unsupported_query_pack', `${badPack.status} ${badPack.data.error?.code}`);

/* 7. 过滤器：可兑现 vs 如实报告不可兑现 */
const filterQuery = await post(`${base}/ocp/query`, {
  query: TERM,
  filters: { max_amount: 100, category: '咖啡' },
});
const ps = filterQuery.data.policy_summary;
record(
  '过滤器 可兑现/不可兑现分流',
  filterQuery.status === 200 && (ps?.accepted_filters ?? []).includes('max_amount') && (ps?.rejected_filters ?? []).includes('category'),
  `accepted=[${(ps?.accepted_filters ?? []).join(',')}] rejected=[${(ps?.rejected_filters ?? []).join(',')}]`,
);

/* 8. 负例：不在 OCP 过滤器集合内 */
const badFilter = await post(`${base}/ocp/query`, { query: TERM, filters: { store_id: 1 } });
record('负例 非法过滤器 → 应 400', badFilter.status === 400 && badFilter.data.error?.code === 'unsupported_filter', `${badFilter.status} ${badFilter.data.error?.code}`);

const product: Product | undefined = undefined;
const firstEntry = entries[0]?.entry;
const productId = firstEntry === undefined ? undefined : Number(firstEntry.object_id);
if (productId === undefined) {
  console.log('未取到商品，后续步骤跳过。');
  process.exit(1);
}
const entryId = entryIdFor(shop.deptId, productId);
record('entry_id 形状可反解', entryId === firstEntry.entry_id, entryId);

/* 9. resolve purpose=checkout */
const resolved = await post(`${base}/ocp/resolve`, { entry_id: entryId, purpose: 'checkout' });
const actions = (resolved.data.action_bindings ?? []).map((b: any) => b.action_id);
const createBinding = (resolved.data.action_bindings ?? []).find((b: any) => b.action_id === 'create_order');
const options = resolved.data.visible_attributes?.options ?? [];
record(
  'resolve purpose=checkout',
  resolved.status === 200 && actions.includes('preview_order') && actions.includes('create_order') && createBinding?.requires_user_confirmation === true,
  `${resolved.status} actions=[${actions.join(',')}] 需确认=${createBinding?.requires_user_confirmation}`,
);
record(
  'resolve 返回实时全量规格',
  options.length > 0 && options.some((o: any) => o.choices.length > 1),
  `${options.length} 组属性：${options.map((o: any) => `${o.attribute_name}(${o.choices.length})`).join(' ')}`,
);
void product;

/* 10. 桥接层：商品详情 */
const detail = await post(`${BRIDGE}/product`, { deptId: shop.deptId, productId });
record('bridge POST /product', detail.status === 200 && typeof detail.data.skuCode === 'string', `${detail.status} sku=${detail.data.skuCode}`);

/* 11. 桥接层：选规格（无副作用） */
const tempAttr = (detail.data.productAttrs ?? []).find((a: any) => a.attributeName === '温度');
const hot = (tempAttr?.productSubAttrs ?? []).find((s: any) => String(s.attributeName).includes('热'));
let configuredSku: string = detail.data.skuCode;
if (tempAttr !== undefined && hot !== undefined) {
  const configured = await post(`${BRIDGE}/configure`, {
    deptId: shop.deptId,
    productId,
    skuCode: detail.data.skuCode,
    amount: 1,
    selections: [{ attributeId: tempAttr.attributeId, subAttributeId: hot.attributeId }],
  });
  configuredSku = configured.data.final_sku_code ?? configuredSku;
  record(
    'bridge POST /configure 切温度→热',
    configured.status === 200 && configuredSku !== detail.data.skuCode,
    `${configured.status} ${detail.data.skuCode} → ${configuredSku}`,
  );
} else {
  record('bridge POST /configure', false, '详情里没找到「热」选项');
}

/* 12. 桥接层：预览（只读） */
const productList = [{ productId, skuCode: configuredSku, amount: 1 }];
const preview = await post(`${BRIDGE}/preview`, { deptId: shop.deptId, productList });
const summary = preview.data.order_summary;
const payable = summary?.pricing?.payable;
record(
  'bridge POST /preview（只读）',
  preview.status === 200 && typeof payable === 'number' && typeof preview.data.fingerprint === 'string',
  `${preview.status} 实付 ¥${payable} 原价 ¥${summary?.pricing?.total_initial} 券=${JSON.stringify(summary?.coupon_codes)} 指纹=${preview.data.fingerprint}`,
);
console.log(`      规格 ${summary?.lines?.[0]?.specs ?? '?'}`);
console.log(`      取餐 ${summary?.pickup?.about_time_iso ?? '?'}`);

/* 13. 护栏：未武装必须拒绝 */
const denied = await post(`${BRIDGE}/create`, { deptId: shop.deptId, productList });
record(
  '护栏 未武装 → 应 428',
  denied.status === 428 && denied.data.error?.code === 'confirmation_required',
  `${denied.status} ${denied.data.error?.code}`,
);
record(
  '护栏 拒绝时仍给出可核对摘要',
  denied.data.order_summary?.lines?.length > 0 && typeof denied.data.fingerprint === 'string',
  `摘要含 ${denied.data.order_summary?.lines?.length} 行，指纹 ${denied.data.fingerprint}`,
);

/* 14. 护栏：武装但金额不符必须拒绝（价格漂移保护） */
if (canArmLocally) {
  const realFingerprint = orderFingerprint({ deptId: shop.deptId, productList });
  process.env.LUCKIN_ORDER_CONFIRM = realFingerprint;
  const drifted = await post(`${BRIDGE}/create`, {
    deptId: shop.deptId,
    productList,
    expected_amount: Number(payable) + 100,
  });
  record(
    '护栏 价格漂移 → 应 428 price_changed',
    drifted.status === 428 && drifted.data.error?.code === 'price_changed',
    `${drifted.status} ${drifted.data.error?.code}`,
  );
  record(
    '护栏 指纹一致但金额不符仍拒绝',
    drifted.data.armed_fingerprint === realFingerprint,
    `armed=${drifted.data.armed_fingerprint} 订单=${drifted.data.fingerprint}`,
  );
  delete process.env.LUCKIN_ORDER_CONFIRM;
} else {
  // 诚实跳过而不是假装通过：武装需要在本进程设置环境变量，复用外部实例时做不到。
  skipped += 1;
  console.log(
    'SKIP  护栏 价格漂移 → price_changed              复用外部实例，无法在本进程武装护栏；' +
      '请先停掉 npm start 起的栈再跑本探针以获得完整覆盖。',
  );
}

/* 15. 未注册门店应 404 */
const noStore = await post(`${CATALOG}/stores/999999/ocp/query`, { query: TERM });
record('负例 未知门店 → 应 404', noStore.status === 404, `${noStore.status} ${noStore.data.error?.code}`);

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(100));
console.log(`${results.length - failed.length}/${results.length} 通过${skipped > 0 ? `（另 ${skipped} 项跳过）` : ''}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('本次探针未产生任何真实订单。');
process.exit(failed.length === 0 ? 0 : 1);
