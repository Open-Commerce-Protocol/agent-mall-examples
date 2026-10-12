/**
 * 声明式引擎的自证：用**同一份真实瑞幸数据**跑两条路径并逐项比对。
 *
 *   A 路径：手写适配器（luckin.ts，已在 luckin-ocp 里逐个工具实测）
 *   B 路径：声明式 spec（specs/luckin-decl.json，只有工具名 + 字段路径）
 *
 * 两者结果一致，才说明"加品牌只需写 JSON"这句话是站得住的。
 *
 * 只调用只读操作（门店/商品/规格/预览），**不会下单**。
 *
 * 用法：node scripts/verify-declarative.ts
 */
import { readFileSync } from 'node:fs';
import { luckinToken } from './_token.ts';
import { fileURLToPath } from 'node:url';
import { buildAdapter, type BrandSpec } from '../src/brands/declarative.ts';
import { luckinAdapter } from '../src/brands/luckin.ts';
import { createMcpClient } from '../src/mcp/client.ts';

const SPEC_FILE = fileURLToPath(new URL('../src/brands/specs/luckin-decl.json', import.meta.url));
const LOCATION = { longitude: 120.1551, latitude: 30.2741 };

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48, ' ')} ${detail}`);
};

/* token 读取统一走 ./_token.ts（支持 LUCKIN_TOKEN / LUCKIN_TOKEN_FILE，不写死个人目录） */

const spec = JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as BrandSpec;
const declared = buildAdapter(spec);

const token = luckinToken();
const mcpA = createMcpClient({ token, url: luckinAdapter.mcpUrl, clientName: 'verify-hand' });
const mcpB = createMcpClient({ token, url: spec.mcpUrl, clientName: 'verify-decl' });

console.log(`\n声明式引擎自证：手写适配器 vs 声明式 spec`);
console.log(`spec ${spec.id}　共 ${Object.keys(spec.ops).length} 个操作、${Object.keys(spec.shapes).length} 组字段路径`);
console.log('-'.repeat(100));

/* 1. 门店 */
const storesA = await luckinAdapter.listStores(mcpA, LOCATION);
const storesB = await declared.listStores(mcpB, LOCATION);
record(
  'listStores 数量一致',
  storesA.length === storesB.length && storesA.length > 0,
  `手写 ${storesA.length} 家 / 声明式 ${storesB.length} 家`,
);
record(
  'listStores 首店名称一致',
  storesA[0]?.name === storesB[0]?.name,
  `「${storesA[0]?.name}」 vs 「${storesB[0]?.name}」`,
);
record(
  'listStores 营业时段与距离一致',
  storesA[0]?.workHours === storesB[0]?.workHours && storesA[0]?.distanceKm === storesB[0]?.distanceKm,
  `${storesB[0]?.workHours} / ${storesB[0]?.distanceKm}km`,
);

const store = storesB.find((s) => s.workStatus === '营业中') ?? storesB[0];
if (store === undefined) {
  console.log('没有可用门店，终止。');
  process.exit(1);
}

/* 2. 商品 */
const productsA = await luckinAdapter.searchProducts(mcpA, { storeId: store.storeId, query: '生椰拿铁' });
const productsB = await declared.searchProducts(mcpB, { storeId: store.storeId, query: '生椰拿铁' });
record(
  'searchProducts 数量与名称一致',
  productsA.length === productsB.length && productsA.every((p, i) => p.name === productsB[i]?.name),
  `手写 [${productsA.map((p) => p.name).join(', ')}] / 声明式 [${productsB.map((p) => p.name).join(', ')}]`,
);
record(
  'searchProducts 价格与 sku 一致',
  productsA[0]?.price === productsB[0]?.price && productsA[0]?.skuCode === productsB[0]?.skuCode,
  `¥${productsB[0]?.price} / ${productsB[0]?.skuCode}`,
);

const product = productsB[0];
if (product === undefined || product.skuCode === undefined) {
  console.log('商品缺少 skuCode，终止。');
  process.exit(1);
}

/* 3. 规格 */
const optionsA = await luckinAdapter.productOptions(mcpA, { storeId: store.storeId, productId: product.productId });
const optionsB = await declared.productOptions(mcpB, { storeId: store.storeId, productId: product.productId });
record(
  'productOptions 属性组一致',
  optionsA.length === optionsB.length &&
    optionsA.every((g, i) => g.attributeName === optionsB[i]?.attributeName && g.choices.length === optionsB[i]?.choices.length),
  `手写 ${optionsA.length} 组 / 声明式 ${optionsB.length} 组：${optionsB.map((g) => `${g.attributeName}(${g.choices.length})`).join(' ')}`,
);
record(
  'productOptions 子选项 id 与名称一致',
  optionsB.every((g, i) => g.choices.every((c, j) => c.subAttributeId === optionsA[i]?.choices[j]?.subAttributeId && c.name === optionsA[i]?.choices[j]?.name)),
  `例如杯型：${optionsB.find((g) => g.attributeName === '杯型')?.choices.map((c) => `${c.subAttributeId}:${c.name}`).join(' ')}`,
);

/* 4. 预览（用默认 sku，不换规格——声明式引擎不表达多步循环） */
const lines = [{ productId: product.productId, skuCode: product.skuCode, amount: 1 }];
const previewA = await luckinAdapter.preview(mcpA, { storeId: store.storeId, lines });
const previewB = await declared.preview(mcpB, { storeId: store.storeId, lines });
record(
  'preview 实付金额一致',
  previewA.pricing.payable === previewB.pricing.payable && previewB.pricing.payable !== null,
  `手写 ¥${previewA.pricing.payable} / 声明式 ¥${previewB.pricing.payable}`,
);
record(
  'preview 原价与优惠一致',
  previewA.pricing.totalInitial === previewB.pricing.totalInitial && previewA.pricing.privilege === previewB.pricing.privilege,
  `原价 ¥${previewB.pricing.totalInitial}　优惠 ¥${previewB.pricing.privilege}`,
);
record(
  'preview 券列表一致',
  JSON.stringify(previewA.couponCodes) === JSON.stringify(previewB.couponCodes),
  `[${previewB.couponCodes.join(', ')}]`,
);
record(
  'preview 规格描述一致',
  previewA.lines[0]?.specs === previewB.lines[0]?.specs,
  `${previewB.lines[0]?.specs}`,
);
record(
  'preview 取餐时间落在同一分钟',
  previewA.pickupAtMs !== null && previewB.pickupAtMs !== null &&
    Math.abs((previewA.pickupAtMs as number) - (previewB.pickupAtMs as number)) <= 60_000,
  `${new Date(previewB.pickupAtMs as number).toLocaleString('zh-CN')}`,
);

/* 5. 边界：声明式引擎不该假装支持多步循环 */
let configureRejected = false;
try {
  await declared.configure(mcpB, { storeId: store.storeId, productId: product.productId, skuCode: product.skuCode, amount: 1, selections: [] });
} catch (error) {
  configureRejected = (error as { code?: string }).code === 'not_mapped';
}
record(
  'configure 如实报不支持（而非静默出错）',
  configureRejected,
  '声明式引擎对多步循环抛 not_mapped，边界清楚',
);

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(100));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n本次自证只调用只读操作，未下单、未扣款。');
process.exit(failed.length === 0 ? 0 : 1);
