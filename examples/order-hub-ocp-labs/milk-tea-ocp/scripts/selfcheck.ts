/**
 * 一致性自检：把三个节点的真实响应拿官方 JSON Schema 逐条校验。
 *
 * 这是"符合规范"的硬证据，而不是我说了算：
 *   - 官方来源：vendor/ 下从上游仓库复制来的 *.schema.json（原样，未改一行）
 *   - 派生来源：schemas/derived/ 下由 zodiac 定义逐字段转写的副本
 *     （query/resolve/entry 这些响应类型上游**没有** JSON Schema）
 *
 * 用法：node scripts/selfcheck.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, createRegistry, type Registry, type SchemaDoc } from '../src/lib/schema-check.ts';
import { startOrReuse } from '../src/lib/net.ts';
import { catalogRoutes } from '../src/nodes/catalog-node.ts';
import { REGISTRATION, startRegistrationNode } from '../src/nodes/registration-node.ts';
import { shanhai } from '../src/shops/shanhai.ts';
import { shiguang } from '../src/shops/shiguang.ts';
import type { Shop } from '../src/shops/types.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function loadSchemas(dir: string): SchemaDoc[] {
  const abs = join(projectRoot, dir);
  return readdirSync(abs)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => JSON.parse(readFileSync(join(abs, f), 'utf8')) as SchemaDoc);
}

const HANDSHAKE = 'vendor/handshake';
const REGISTRATION_DIR = 'vendor/registration';
const DERIVED = 'schemas/derived';

const derivedDoc = JSON.parse(
  readFileSync(join(projectRoot, DERIVED, 'ocp.derived.v1.schema.json'), 'utf8'),
) as SchemaDoc;

const registry: Registry = createRegistry([
  ...loadSchemas(HANDSHAKE),
  ...loadSchemas(REGISTRATION_DIR),
  derivedDoc,
]);

const officialByFile = new Map<string, SchemaDoc>();
for (const doc of loadSchemas(HANDSHAKE)) officialByFile.set(doc.$id, doc);
for (const doc of loadSchemas(REGISTRATION_DIR)) officialByFile.set(doc.$id, doc);

/** 取官方 schema 文档（按文件名匹配 $id 尾部）。 */
function official(fileName: string): { doc: SchemaDoc; ref: string; label: string } {
  for (const [id, doc] of officialByFile) {
    if (id.endsWith(`/${fileName}`)) return { doc, ref: '#', label: `官方 ${fileName}` };
  }
  throw new Error(`未找到官方 schema: ${fileName}`);
}

function derived(ref: string): { doc: SchemaDoc; ref: string; label: string } {
  return { doc: derivedDoc, ref, label: `派生 ${ref.replace('#/$defs/', '')}` };
}

type Case = {
  name: string;
  schema: { doc: SchemaDoc; ref: string; label: string };
  run: () => Promise<{ status: number; body: unknown }>;
  expectStatus?: number;
};

const get = async (base: string, path: string) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};
const post = async (base: string, path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/* 启动全部节点（端口被占用则复用已在运行的实例） */
for (const shop of [shanhai, shiguang] as Shop[]) {
  await startOrReuse(catalogRoutes(shop), shop.port, shop.catalog_id);
}
await startRegistrationNode([shanhai, shiguang]);

const regBase = REGISTRATION.base_url;
const cases: Case[] = [];

for (const shop of [shanhai, shiguang] as Shop[]) {
  const base = shop.base_url;
  const inStock = shop.menu.find((m) => m.availability === 'in_stock');
  const soldOut = shop.menu.find((m) => m.availability === 'out_of_stock');
  const inStockEntry = `entry_${shop.provider_id}_${inStock?.sku}`;
  const tag = shop.catalog_id;

  cases.push(
    { name: `${tag} GET /.well-known/ocp-catalog`, schema: derived('#/$defs/WellKnownCatalogDiscovery'), run: () => get(base, '/.well-known/ocp-catalog') },
    { name: `${tag} GET /ocp/manifest`, schema: official('catalog-manifest.schema.json'), run: () => get(base, '/ocp/manifest') },
    { name: `${tag} GET /ocp/health`, schema: official('catalog-health.schema.json'), run: () => get(base, '/ocp/health') },
    { name: `${tag} GET /ocp/contracts`, schema: derived('#/$defs/ObjectContractList'), run: () => get(base, '/ocp/contracts') },
    { name: `${tag} POST /ocp/query 关键字`, schema: derived('#/$defs/CatalogQueryResult'), run: () => post(base, '/ocp/query', { query: '珍珠' }) },
    {
      name: `${tag} POST /ocp/query 带过滤器`,
      schema: derived('#/$defs/CatalogQueryResult'),
      run: () => post(base, '/ocp/query', { query: '', filters: { in_stock_only: true, max_amount: 30 } }),
    },
    { name: `${tag} POST /ocp/query 空查询`, schema: derived('#/$defs/CatalogQueryResult'), run: () => post(base, '/ocp/query', {}) },
    { name: `${tag} resolve purpose=view`, schema: derived('#/$defs/ResolvableReference'), run: () => post(base, '/ocp/resolve', { entry_id: inStockEntry, purpose: 'view' }) },
    { name: `${tag} resolve purpose=checkout`, schema: derived('#/$defs/ResolvableReference'), run: () => post(base, '/ocp/resolve', { entry_id: inStockEntry, purpose: 'checkout' }) },
    { name: `${tag} resolve purpose=contact`, schema: derived('#/$defs/ResolvableReference'), run: () => post(base, '/ocp/resolve', { entry_id: inStockEntry, purpose: 'contact' }) },
    { name: `${tag} resolve purpose=workflow`, schema: derived('#/$defs/ResolvableReference'), run: () => post(base, '/ocp/resolve', { entry_id: inStockEntry, purpose: 'workflow' }) },
  );
  if (soldOut !== undefined) {
    cases.push({
      name: `${tag} resolve 售罄 purpose=checkout`,
      schema: derived('#/$defs/ResolvableReference'),
      run: () => post(base, '/ocp/resolve', { entry_id: `entry_${shop.provider_id}_${soldOut.sku}`, purpose: 'checkout' }),
    });
  }
}

cases.push(
  { name: 'reg GET /health', schema: derived('#/$defs/RegistrationHealth'), run: () => get(regBase, '/health') },
  { name: 'reg GET /.well-known/ocp-registration', schema: official('registration-discovery.schema.json'), run: () => get(regBase, '/.well-known/ocp-registration') },
  { name: 'reg GET /ocp/registration/manifest', schema: official('registration-manifest.schema.json'), run: () => get(regBase, '/ocp/registration/manifest') },
  { name: 'reg POST /ocp/catalogs/search 全量', schema: official('catalog-search-result.schema.json'), run: () => post(regBase, '/ocp/catalogs/search', { query: '' }) },
  { name: 'reg POST /ocp/catalogs/search 关键字', schema: official('catalog-search-result.schema.json'), run: () => post(regBase, '/ocp/catalogs/search', { query: '奶茶' }) },
  {
    name: 'reg POST /ocp/catalogs/search 带过滤器',
    schema: official('catalog-search-result.schema.json'),
    run: () => post(regBase, '/ocp/catalogs/search', { query: '', filters: { query_pack: 'ocp.query.milktea.keyword.v1', health_status: 'healthy' } }),
  },
  { name: 'reg POST /ocp/catalogs/resolve', schema: official('catalog-route-hint.schema.json'), run: () => post(regBase, '/ocp/catalogs/resolve', { catalog_id: shanhai.catalog_id }) },
  {
    name: 'reg POST /ocp/catalogs/register',
    schema: official('catalog-registration-result.schema.json'),
    expectStatus: 201,
    run: () =>
      post(regBase, '/ocp/catalogs/register', {
        ocp_version: '1.0',
        kind: 'CatalogRegistration',
        id: 'regdoc_selfcheck',
        registration_id: REGISTRATION.registration_id,
        catalog_id: shiguang.catalog_id,
        registration_version: 1,
        updated_at: new Date().toISOString(),
        homepage: shiguang.base_url,
        well_known_url: `${shiguang.base_url}/.well-known/ocp-catalog`,
        claimed_domains: [`127.0.0.1:${shiguang.port}`],
        tags: shiguang.tags,
      }),
  },
  { name: 'reg POST /ocp/catalogs/:id/refresh', schema: official('catalog-refresh-result.schema.json'), run: () => post(regBase, `/ocp/catalogs/${shanhai.catalog_id}/refresh`, {}) },
  { name: 'reg GET /ocp/catalogs/:id', schema: derived('#/$defs/CatalogProfileSnapshot'), run: () => get(regBase, `/ocp/catalogs/${shanhai.catalog_id}`) },
);

/* 逐条校验 */
let pass = 0;
let officialCount = 0;
let derivedCount = 0;
const failures: string[] = [];

console.log(`\n一致性自检：${cases.length} 个响应 × JSON Schema（官方优先，缺失处用派生副本）`);
console.log('-'.repeat(104));

for (const testCase of cases) {
  let status = 0;
  let body: unknown = undefined;
  const problems: string[] = [];
  try {
    const result = await testCase.run();
    status = result.status;
    body = result.body;
    if (testCase.expectStatus !== undefined && status !== testCase.expectStatus) {
      problems.push(`HTTP 状态应为 ${testCase.expectStatus}，实际 ${status}`);
    } else if (testCase.expectStatus === undefined && status !== 200) {
      problems.push(`HTTP 状态应为 200，实际 ${status}`);
    }
    if (problems.length === 0) {
      const errors = check(registry, testCase.schema.doc, testCase.schema.ref, body);
      for (const e of errors) problems.push(`${e.path} ${e.message}`);
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
    failures.push(`${testCase.name}\n      ${problems.slice(0, 4).join('\n      ')}`);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${testCase.name.padEnd(42, ' ')} ${testCase.schema.label.padEnd(30, ' ')} ${ok ? 'OK' : `${problems.length} 处不符`}`,
  );
}

console.log('-'.repeat(104));
console.log(`${pass}/${cases.length} 通过 · 官方 schema 校验 ${officialCount} 条 · 派生 schema 校验 ${derivedCount} 条`);
if (failures.length > 0) {
  console.log('\n不符项：');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
