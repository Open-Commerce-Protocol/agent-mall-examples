/**
 * 一致性自检：把两个 OCP 节点与桥接层的真实响应逐条过 JSON Schema。
 *
 * 来源分两类：
 *   - 官方来源：vendor/ 下从上游仓库原样复制的 22 个 *.schema.json
 *   - 派生/自定义：schemas/derived/ 下的副本（查询/解析响应上游没有 JSON Schema；
 *     桥接层不是 OCP 协议面，属于本项目自定义契约）
 *
 * ⚠️ 安全设计：`/create` 的校验用例**故意传一个不可能匹配的 expected_amount**。
 * checkGuard 的判断顺序是 未武装 → 指纹 → 金额，所以：
 *   - 护栏未武装 → 返回 428 confirmation_required
 *   - 护栏已武装 → 返回 428 price_changed
 * 两种情况都**不可能走到真正下单的分支**。这个用例因此永远不会产生真实订单。
 *
 * 用法：node scripts/selfcheck.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, createRegistry, type Registry, type SchemaDoc } from '../src/lib/schema-check.ts';
import { bootstrap } from '../src/bootstrap.ts';
import { BRIDGE_PORT } from '../src/bridge/bridge-node.ts';
import { LUCKIN_CATALOG_PORT, LUCKIN_QUERY_PACK } from '../src/catalog/luckin-catalog.ts';
import { REGISTRATION_PORT } from '../src/catalog/registration-node.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function loadSchemas(dir: string): SchemaDoc[] {
  const abs = join(projectRoot, dir);
  return readdirSync(abs)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => JSON.parse(readFileSync(join(abs, f), 'utf8')) as SchemaDoc);
}

const officialDocs = [...loadSchemas('vendor/handshake'), ...loadSchemas('vendor/registration')];
const derivedDoc = JSON.parse(
  readFileSync(join(projectRoot, 'schemas/derived/ocp.derived.v1.schema.json'), 'utf8'),
) as SchemaDoc;
const registry: Registry = createRegistry([...officialDocs, derivedDoc]);

const officialByFile = new Map<string, SchemaDoc>();
for (const doc of officialDocs) officialByFile.set(String(doc.$id), doc);

function official(fileName: string): { doc: SchemaDoc; ref: string; label: string } {
  for (const [id, doc] of officialByFile) {
    if (id.endsWith(`/${fileName}`)) return { doc, ref: '#', label: `官方 ${fileName}` };
  }
  throw new Error(`未找到官方 schema: ${fileName}`);
}
function derived(ref: string): { doc: SchemaDoc; ref: string; label: string } {
  return { doc: derivedDoc, ref, label: `派生 ${ref.replace('#/$defs/', '')}` };
}

const CATALOG = `http://127.0.0.1:${LUCKIN_CATALOG_PORT}`;
const BRIDGE = `http://127.0.0.1:${BRIDGE_PORT}`;
const REG = `http://127.0.0.1:${REGISTRATION_PORT}`;

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  return { status: res.status, body: await res.json() };
};
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, body: await res.json() };
};

/* 启动（端口占用则复用已在运行的实例） */
await bootstrap();
console.log('');

type Case = {
  name: string;
  schema: { doc: SchemaDoc; ref: string; label: string };
  run: () => Promise<{ status: number; body: any }>;
  expectStatus?: number;
  extra?: (body: any) => string | undefined;
};

const cases: Case[] = [];

/* ---------- 门店目录：全部门店的发现/能力/存活 ---------- */
const storeListing = await get(`${CATALOG}/demo/stores`);
const stores: any[] = storeListing.body.stores ?? [];
if (stores.length === 0) {
  console.log('门店缓存为空，无法自检。');
  process.exit(1);
}

for (const store of stores) {
  const base = `${CATALOG}/stores/${store.deptId}`;
  const tag = String(store.deptId);
  cases.push(
    { name: `${tag} GET /ocp/manifest`, schema: official('catalog-manifest.schema.json'), run: () => get(`${base}/ocp/manifest`) },
    { name: `${tag} GET /ocp/health`, schema: official('catalog-health.schema.json'), run: () => get(`${base}/ocp/health`) },
  );
}

/* ---------- 最近的两家门店跑完整的查询/解析面 ---------- */
const nearest = stores.slice(0, 2);
let productForBridge: { deptId: number; productId: number; skuCode: string } | undefined;

for (const store of nearest) {
  const base = `${CATALOG}/stores/${store.deptId}`;
  const tag = String(store.deptId);

  const query = await post(`${base}/ocp/query`, { query_pack: LUCKIN_QUERY_PACK, query_mode: 'keyword', query: '生椰拿铁' });
  const entry = query.body?.entries?.[0]?.entry;
  const productId = entry === undefined ? undefined : Number(entry.object_id);

  cases.push(
    { name: `${tag} GET .well-known/ocp-catalog`, schema: derived('#/$defs/WellKnownCatalogDiscovery'), run: () => get(`${base}/.well-known/ocp-catalog`) },
    { name: `${tag} GET /ocp/contracts`, schema: derived('#/$defs/ObjectContractList'), run: () => get(`${base}/ocp/contracts`) },
    { name: `${tag} POST /ocp/query`, schema: derived('#/$defs/CatalogQueryResult'), run: () => post(`${base}/ocp/query`, { query_pack: LUCKIN_QUERY_PACK, query_mode: 'keyword', query: '生椰拿铁' }) },
    { name: `${tag} POST /ocp/query 带过滤器`, schema: derived('#/$defs/CatalogQueryResult'), run: () => post(`${base}/ocp/query`, { query: '拿铁', filters: { max_amount: 100, category: '咖啡' } }) },
  );

  if (entry !== undefined && productId !== undefined) {
    for (const purpose of ['view', 'checkout', 'contact', 'workflow']) {
      cases.push({
        name: `${tag} resolve purpose=${purpose}`,
        schema: derived('#/$defs/ResolvableReference'),
        run: () => post(`${base}/ocp/resolve`, { entry_id: entry.entry_id, purpose }),
      });
    }
    if (productForBridge === undefined) {
      productForBridge = { deptId: Number(store.deptId), productId, skuCode: String(entry.attributes.sku) };
    }
  }
}

/* ---------- Registration 发现层 ---------- */
cases.push(
  { name: 'reg GET /health', schema: derived('#/$defs/RegistrationHealth'), run: () => get(`${REG}/health`) },
  { name: 'reg GET /.well-known/ocp-registration', schema: official('registration-discovery.schema.json'), run: () => get(`${REG}/.well-known/ocp-registration`) },
  { name: 'reg GET /ocp/registration/manifest', schema: official('registration-manifest.schema.json'), run: () => get(`${REG}/ocp/registration/manifest`) },
  { name: 'reg POST /ocp/catalogs/search 空查询', schema: official('catalog-search-result.schema.json'), run: () => post(`${REG}/ocp/catalogs/search`, { query: '' }) },
  { name: 'reg POST /ocp/catalogs/search 按店名', schema: official('catalog-search-result.schema.json'), run: () => post(`${REG}/ocp/catalogs/search`, { query: '武林' }) },
  { name: 'reg POST /ocp/catalogs/search 带过滤器', schema: official('catalog-search-result.schema.json'), run: () => post(`${REG}/ocp/catalogs/search`, { query: '', filters: { query_pack: LUCKIN_QUERY_PACK, health_status: 'healthy' } }) },
  { name: 'reg POST /ocp/catalogs/resolve', schema: official('catalog-route-hint.schema.json'), run: () => post(`${REG}/ocp/catalogs/resolve`, { catalog_id: `cat_luckin_dept_${nearest[0].deptId}` }) },
  { name: 'reg GET /ocp/catalogs/:id', schema: derived('#/$defs/CatalogProfileSnapshot'), run: () => get(`${REG}/ocp/catalogs/cat_luckin_dept_${nearest[0].deptId}`) },
  { name: 'reg POST /ocp/catalogs/:id/refresh', schema: official('catalog-refresh-result.schema.json'), run: () => post(`${REG}/ocp/catalogs/cat_luckin_dept_${nearest[0].deptId}/refresh`, {}) },
);

/* ---------- 桥接层 ---------- */
cases.push({ name: 'bridge GET /health', schema: derived('#/$defs/BridgeHealth'), run: () => get(`${BRIDGE}/health`) });

if (productForBridge !== undefined) {
  const productList = [{ productId: productForBridge.productId, skuCode: productForBridge.skuCode, amount: 1 }];
  const preview = await post(`${BRIDGE}/preview`, { deptId: productForBridge.deptId, productList });
  const payable = Number(preview.body?.order_summary?.pricing?.payable ?? 0);

  cases.push({
    name: 'bridge POST /preview',
    schema: derived('#/$defs/BridgePreviewResponse'),
    run: () => post(`${BRIDGE}/preview`, { deptId: productForBridge!.deptId, productList }),
  });

  // 故意传不可能匹配的金额：让"允许下单"的分支结构上不可达。
  const bogusAmount = payable + 999;
  cases.push({
    name: 'bridge POST /create（护栏必须拒绝）',
    schema: derived('#/$defs/BridgeGuardRefusal'),
    expectStatus: 428,
    run: () => post(`${BRIDGE}/create`, { deptId: productForBridge!.deptId, productList, expected_amount: bogusAmount }),
    extra: (body) => (body?.order !== undefined ? '危险：护栏竟然放行并返回了订单！' : undefined),
  });
}

/* ---------- 逐条校验 ---------- */
let pass = 0;
let officialCount = 0;
let derivedCount = 0;
const failures: string[] = [];

console.log(`一致性自检：${cases.length} 个响应 × JSON Schema（官方优先，缺失处用派生/自定义副本）`);
console.log('-'.repeat(104));

for (const testCase of cases) {
  const problems: string[] = [];
  try {
    const result = await testCase.run();
    const expected = testCase.expectStatus ?? 200;
    if (result.status !== expected) problems.push(`HTTP 状态应为 ${expected}，实际 ${result.status}`);
    if (problems.length === 0) {
      for (const e of check(registry, testCase.schema.doc, testCase.schema.ref, result.body)) {
        problems.push(`${e.path} ${e.message}`);
      }
      const extraMessage = testCase.extra?.(result.body);
      if (extraMessage !== undefined) problems.push(extraMessage);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const ok = problems.length === 0;
  if (ok) {
    pass += 1;
    if (testCase.schema.label.startsWith('官方')) officialCount += 1;
    else derivedCount += 1;
  } else {
    failures.push(`${testCase.name}\n      ${problems.slice(0, 3).join('\n      ')}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name.padEnd(44, ' ')} ${testCase.schema.label.padEnd(34, ' ')} ${ok ? 'OK' : `${problems.length} 处不符`}`);
}

console.log('-'.repeat(104));
console.log(`${pass}/${cases.length} 通过 · 官方 schema ${officialCount} 条 · 派生/自定义 ${derivedCount} 条`);
if (failures.length > 0) {
  console.log('\n不符项：');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log('\n注：/create 用例传入了不可能的金额，因此本次自检未产生任何真实订单。');
process.exit(failures.length === 0 ? 0 : 1);
