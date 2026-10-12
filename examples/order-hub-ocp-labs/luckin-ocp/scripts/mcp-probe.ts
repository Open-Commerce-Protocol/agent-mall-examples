/**
 * 验证 MCP 客户端与工具封装（只读）。
 *
 * 只调用只读工具：queryShopList / searchProductForMcp / previewOrder。
 * **不会调用 createOrder**，不产生任何订单。
 *
 * 用法：node scripts/mcp-probe.ts [关键字]
 */
import { createMcpClient, loadToken } from '../src/mcp/client.ts';
import { createLuckinTools, describeAttrs, defaultSkuCode, type PreviewOrder } from '../src/mcp/tools.ts';
import { createHash } from 'node:crypto';

/** 杭州市中心（西湖区）附近，让 queryShopList 有坐标可用。 */
const HERE = { longitude: 120.1551, latitude: 30.2741 };
const TERM = process.argv[2] ?? '生椰拿铁';

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40, ' ')} ${detail}`);
};

const { token, source } = loadToken();
const fingerprint = createHash('sha256').update(token).digest('hex').slice(0, 8);
console.log(`\ntoken 来源 ${source}`);
console.log(`token 长度 ${token.length}，指纹 ${fingerprint}（不打印明文）`);
console.log('-'.repeat(96));

const client = createMcpClient({ token, clientName: 'luckin-ocp-probe' });
const tools = createLuckinTools(client);

/* 1. 握手 */
const init = await client.initialize();
record(
  'MCP initialize',
  typeof init.serverInfo?.name === 'string',
  `${init.serverInfo?.name} v${init.serverInfo?.version} 协议 ${init.protocolVersion} 会话 ${client.currentSessionId() ?? '(无)'}`,
);

/* 2. 工具清单 */
const toolList = await client.listTools();
const expected = [
  'queryShopList',
  'searchProductForMcp',
  'switchProduct',
  'queryProductDetailInfo',
  'previewOrder',
  'createOrder',
  'queryOrderDetailInfo',
  'cancelOrder',
];
const missing = expected.filter((n) => !toolList.some((t) => t.name === n));
record('tools/list', toolList.length === 8 && missing.length === 0, `${toolList.length} 个工具，缺失 ${missing.length}`);

/* 3. 门店（只读） */
const shops = await tools.queryShopList(HERE);
record('queryShopList', Array.isArray(shops) && shops.length > 0, `${shops.length} 家门店`);
for (const s of shops.slice(0, 4)) {
  console.log(`      · deptId=${s.deptId} ${s.deptName} [${s.workStatus ?? '?'}] ${s.workTimeStart ?? '?'}-${s.workTimeEnd ?? '?'} ${s.distance ?? '?'}km`);
}

const store = shops.find((s) => s.workStatus === '营业中') ?? shops[0];
if (store === undefined) {
  console.log('\n没有可用门店，后续只读步骤跳过。');
  process.exit(1);
}
console.log(`\n  选定门店：${store.deptName}（deptId=${store.deptId}）`);

/* 4. 商品搜索（只读） */
const products = await tools.searchProduct({ deptId: store.deptId, query: TERM });
record(`searchProductForMcp("${TERM}")`, Array.isArray(products) && products.length > 0, `${products.length} 个商品`);
for (const p of products.slice(0, 4)) {
  console.log(`      · productId=${p.productId} ${p.productName} 起价=${p.initialPrice ?? p.price ?? '?'} sku=${defaultSkuCode(p) ?? '(需详情)'}`);
  const attrs = describeAttrs(p);
  if (attrs !== '') console.log(`        属性 ${attrs}`);
}

/* 5. 订单预览（只读，不产生订单） */
const candidate = products[0];
const skuCode = candidate === undefined ? undefined : defaultSkuCode(candidate);
if (candidate !== undefined && skuCode !== undefined) {
  const preview: PreviewOrder = await tools.previewOrder({
    deptId: store.deptId,
    productList: [{ productId: candidate.productId, skuCode, amount: 1 }],
  });
  const line = preview.productInfoList?.[0];
  record(
    'previewOrder（只读）',
    typeof preview.discountPrice === 'number',
    `实付 ¥${preview.discountPrice} 原价 ¥${preview.originPrice ?? '?'} 券=${JSON.stringify(preview.couponCodeList ?? [])}`,
  );
  console.log(`      规格 ${line?.additionDesc ?? '?'}`);
  console.log(`      取餐时间 aboutTime=${preview.aboutTime ?? '?'}`);
} else {
  record('previewOrder（只读）', false, '商品未给出 skuCode，需先走 switchProduct / 详情接口');
}

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(96));
console.log(`${results.length - failed.length}/${results.length} 通过 · 全程未调用 createOrder`);
process.exit(failed.length === 0 ? 0 : 1);
