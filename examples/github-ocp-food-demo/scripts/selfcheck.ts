/**
 * 自检：逐个校验每个协议响应体是否符合 OCP 规范。
 *
 * 这是「硬证据 1」—— 不是「我说自己合规」，而是逐条字段校验后的结论。
 * 校验器在 src/ocp-schema.ts，字段对齐官方 @ocp-catalog/ocp-schema (Zod)。
 *
 *   bun run selfcheck
 */

import { SHOPS } from '../src/shops';
import {
  checkDiscovery, checkManifest, checkHealth, checkContracts,
  checkQueryResult, checkResolveResult, scanLeaks, type Issue,
} from '../src/ocp-schema';

let PORT = Number(process.env.PORT ?? 4400);
const tryPorts = [PORT, 4401, 4402, 4403];

/* 起一个临时实例（不依赖外部已启动的服务） */
const { handle } = await import('../src/server');

let base = '';
let server: any = null;
for (const p of tryPorts) {
  try {
    server = Bun.serve({ port: p, fetch: handle });
    base = `http://localhost:${p}`;
    break;
  } catch (e: any) {
    if (e?.code !== 'EADDRINUSE') throw e;
  }
}
if (!base) {
  console.error('✗ 无法启动测试实例：端口全部被占用');
  process.exit(1);
}

/* ───────────────────── 断言框架 ───────────────────── */

type Result = { name: string; ok: boolean; issues: Issue[]; note?: string };
const results: Result[] = [];

function record(name: string, issues: Issue[], note?: string) {
  results.push({ name, ok: issues.length === 0, issues, note });
}

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (path: string, payload: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log(`\n自检中（实例: ${base}）…\n`);

/* ───────────────────── 1. 目录索引 ───────────────────── */
{
  const { status, body } = await get('/ocp/index');
  const issues: Issue[] = [];
  if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    issues.push({ path: 'items', message: 'items 应为非空数组' });
  }
  for (const it of body?.items ?? []) {
    for (const k of ['catalog_id', 'catalog_name', 'manifest_url', 'verification_status', 'trust_tier', 'health_status']) {
      if (it[k] === undefined) issues.push({ path: `items[${it.catalog_id}].${k}`, message: '缺少字段' });
    }
  }
  record('目录索引 /ocp/index（聚合层 metadata）', issues);
}

/* ───────────────────── 2. 每家店：五个端点 + 泄漏扫描 ───────────────────── */

for (const s of SHOPS) {
  const tag = `${s.name}`;

  // 2.1 discovery
  {
    const { status, body } = await get(`/${s.id}/.well-known/ocp-catalog`);
    const issues = checkDiscovery(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    issues.push(...scanLeaks(body));
    record(`${tag} · /.well-known/ocp-catalog`, issues);
  }

  // 2.2 manifest
  {
    const { status, body } = await get(`/${s.id}/ocp/manifest`);
    const issues = checkManifest(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    issues.push(...scanLeaks(body));
    record(`${tag} · /ocp/manifest (CatalogManifest)`, issues);
  }

  // 2.3 health
  {
    const { status, body } = await get(`/${s.id}/ocp/health`);
    const issues = checkHealth(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    issues.push(...scanLeaks(body));
    record(`${tag} · /ocp/health (CatalogHealth)`, issues);
  }

  // 2.4 contracts
  {
    const { status, body } = await get(`/${s.id}/ocp/contracts`);
    const issues = checkContracts(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    if (!Array.isArray(body?.object_contracts) || body.object_contracts.length === 0) {
      issues.push({ path: 'object_contracts', message: '应为非空数组（本节点声明了三个契约）' });
    }
    issues.push(...scanLeaks(body));
    record(`${tag} · /ocp/contracts (ObjectContractList)`, issues);
  }

  // 2.5 query — keyword pack
  {
    const { status, body } = await post(`/${s.id}/ocp/query`, {
      query_pack: 'ocp.query.keyword.v1',
      query: '饭',
      limit: 20,
    });
    const issues = checkQueryResult(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    issues.push(...scanLeaks(body));
    record(`${tag} · /ocp/query (ocp.query.keyword.v1)`, issues);
  }

  // 2.6 query — meal pack（B 层：商家侧决定推哪个）
  {
    const { status, body } = await post(`/${s.id}/ocp/query`, {
      query_pack: 'ocp.query.meal.v1',
      query: '',
      constraints: { budget: 40, minutes: 40 },
    });
    const issues = checkQueryResult(body);
    if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
    issues.push(...scanLeaks(body));
    if (body?.provenance === undefined) {
      issues.push({ path: 'provenance', message: '缺少出处信息（provider_id / verification / trust）' });
    }
    record(`${tag} · /ocp/query (ocp.query.meal.v1 · B层pick)`, issues);
  }

  // 2.7 resolve — purpose=view
  {
    if (s.healthy && s.menu.length) {
      const { status, body } = await post(`/${s.id}/ocp/resolve`, {
        entry_id: s.menu[0]!.entry_id,
        purpose: 'view',
      });
      const issues = checkResolveResult(body);
      if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
      issues.push(...scanLeaks(body));
      const b = body?.action_bindings?.[0];
      if (b?.action_type !== 'url') {
        issues.push({ path: 'action_bindings[0].action_type', message: `view 应返回 url，实际 ${b?.action_type}` });
      }
      record(`${tag} · /ocp/resolve (purpose=view → url)`, issues);
    } else {
      record(`${tag} · /ocp/resolve (purpose=view)`, [], '跳过：门店不健康');
    }
  }

  // 2.8 resolve — purpose=checkout（核心：动作 + 强制确认 + 时效）
  {
    if (s.healthy && s.menu.length) {
      const { status, body } = await post(`/${s.id}/ocp/resolve`, {
        entry_id: s.menu[0]!.entry_id,
        purpose: 'checkout',
      });
      const issues = checkResolveResult(body);
      if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
      const b = body?.action_bindings?.[0];
      if (b?.action_type !== 'api') {
        issues.push({ path: 'action_bindings[0].action_type', message: `checkout 应返回 api，实际 ${b?.action_type}` });
      }
      if (b?.requires_user_confirmation !== true) {
        issues.push({ path: 'action_bindings[0].requires_user_confirmation', message: '必须为 true' });
      }
      if (!b?.entrypoint?.nonce) {
        issues.push({ path: 'action_bindings[0].entrypoint.nonce', message: 'checkout 动作应带一次性 nonce' });
      }
      const ttl = Date.parse(body?.expires_at ?? '');
      if (!Number.isFinite(ttl) || ttl <= Date.now()) {
        issues.push({ path: 'expires_at', message: 'checkout 动作必须是未来时间' });
      } else if (ttl - Date.now() > 5 * 60_000) {
        issues.push({ path: 'expires_at', message: `${Math.round((ttl - Date.now()) / 1000)}s —— 动作时效过长，应 <= 5 分钟` });
      }
      issues.push(...scanLeaks(body));
      record(`${tag} · /ocp/resolve (purpose=checkout → api + 确认 + 时效)`, issues);
    } else {
      record(`${tag} · /ocp/resolve (purpose=checkout)`, [], '跳过：门店不健康');
    }
  }
}

/* ───────────────────── 3. 边界行为（规范要求的错误处理） ───────────────────── */

{
  const { status } = await post('/noodle/ocp/resolve', { entry_id: 'nope.xxx', purpose: 'view' });
  record('边界 · 不存在的 entry_id → 404',
    status === 404 ? [] : [{ path: 'http', message: `期望 404，实际 ${status}` }]);
}
{
  const { status } = await post('/noodle/ocp/resolve', { entry_id: 'noodle.m1', purpose: 'teleport' });
  record('边界 · 不支持的 purpose → 400',
    status === 400 ? [] : [{ path: 'http', message: `期望 400，实际 ${status}` }]);
}
{
  const { status, body } = await post('/noodle/ocp/query', { query_pack: 'ocp.query.undeclared.v1', query: 'x' });
  const issues: Issue[] = [];
  if (status !== 400) issues.push({ path: 'http', message: `期望 400，实际 ${status}` });
  if (!body?.error?.declared_packs) issues.push({ path: 'error.declared_packs', message: '应回显已声明的 pack 列表' });
  record('边界 · 未声明的 query_pack → 400', issues);
}
{
  const { status } = await get('/nosuchshop/ocp/manifest');
  record('边界 · 不存在的店铺 → 404',
    status === 404 ? [] : [{ path: 'http', message: `期望 404，实际 ${status}` }]);
}
{
  // 不健康门店：应优雅返回空结果 + 说明，而不是 500
  const { status, body } = await post('/bbq/ocp/query', { query_pack: 'ocp.query.meal.v1', query: '' });
  const issues: Issue[] = checkQueryResult(body);
  if (status !== 200) issues.push({ path: 'http', message: `期望 200，实际 ${status}` });
  if (body?.result_count !== 0) issues.push({ path: 'result_count', message: '不健康门店应返回 0 条结果' });
  if (!body?.note) issues.push({ path: 'note', message: '应说明为何没有结果' });
  record('边界 · 不健康门店优雅降级（0 结果 + 说明）', issues);
}

/* ───────────────────── 4. 执行边界：nonce 一次性 ───────────────────── */

{
  const r1 = await post('/noodle/ocp/resolve', { entry_id: 'noodle.m1', purpose: 'checkout' });
  const nonce = r1.body?.action_bindings?.[0]?.entrypoint?.nonce;
  const issues: Issue[] = [];
  if (!nonce) {
    issues.push({ path: 'nonce', message: '未能取得 nonce' });
  } else {
    const e1 = await post('/noodle/ocp/execute', { entry_id: 'noodle.m1', nonce, fulfillment: 'delivery', quantity: 1 });
    if (e1.status !== 200) issues.push({ path: 'execute#1', message: `期望 200，实际 ${e1.status}` });
    if (!e1.body?.order_no) issues.push({ path: 'execute#1.order_no', message: '应返回订单号' });
    const e2 = await post('/noodle/ocp/execute', { entry_id: 'noodle.m1', nonce, fulfillment: 'delivery', quantity: 1 });
    if (e2.status !== 400) issues.push({ path: 'execute#2', message: `重复使用 nonce 应被拒绝(400)，实际 ${e2.status}` });
  }
  record('执行 · 一次性 nonce（重复使用被拒）', issues);
}
{
  const { status } = await post('/noodle/ocp/execute', { entry_id: 'noodle.m1', nonce: 'forged-nonce', fulfillment: 'delivery' });
  record('执行 · 伪造 nonce → 400',
    status === 400 ? [] : [{ path: 'http', message: `期望 400，实际 ${status}` }]);
}
{
  // 堂食限制：便当屋的饭团不支持堂食
  const r1 = await post('/bento/ocp/resolve', { entry_id: 'bento.m2', purpose: 'checkout' });
  const nonce = r1.body?.action_bindings?.[0]?.entrypoint?.nonce;
  const { status } = await post('/bento/ocp/execute', { entry_id: 'bento.m2', nonce, fulfillment: 'delivery' });
  record('执行 · 合法下单（外卖）',
    status === 200 ? [] : [{ path: 'http', message: `期望 200，实际 ${status}` }]);
}

/* ───────────────────── 5. 瑞幸适配器（若配置了 token） ───────────────────── */

{
  const { status, body } = await get('/api/luckin/shops');
  if (status === 503) {
    record('瑞幸适配器 · MCP 上游', [], '跳过：未配置 token（将降级为 mock）');
  } else if (status !== 200) {
    record('瑞幸适配器 · MCP 上游', [{ path: 'http', message: `期望 200，实际 ${status}: ${JSON.stringify(body).slice(0, 200)}` }]);
  } else {
    const issues: Issue[] = [];
    if (!Array.isArray(body?.shops) || body.shops.length === 0) {
      issues.push({ path: 'shops', message: '应返回非空门店列表' });
    }
    record(`瑞幸适配器 · /api/luckin/shops（真实 MCP，${body?.shops?.length ?? 0} 家门店）`, issues);
  }
}
{
  const { status, body } = await get('/api/luckin/search?q=' + encodeURIComponent('拿铁'));
  if (status === 503) {
    record('瑞幸适配器 · 真实商品检索', [], '跳过：未配置 token');
  } else if (status !== 200) {
    record('瑞幸适配器 · 真实商品检索', [{ path: 'http', message: `期望 200，实际 ${status}: ${JSON.stringify(body).slice(0, 200)}` }]);
  } else {
    const issues: Issue[] = [];
    if (!body?.dept?.deptId) issues.push({ path: 'dept.deptId', message: '应解析出门店 deptId' });
    if (!Array.isArray(body?.entries)) issues.push({ path: 'entries', message: '应为数组' });
    for (const e of body?.entries ?? []) {
      for (const k of ['kind', 'catalog_id', 'entry_id', 'provider_id', 'object_id', 'title', 'attributes']) {
        if (e[k] === undefined) issues.push({ path: `entries[${e.entry_id}].${k}`, message: '缺少字段' });
      }
    }
    record(`瑞幸适配器 · 真实商品检索（${body?.entries?.length ?? 0} 款 @ ${body?.dept?.deptName ?? '?'}）`, issues);
  }
}

/* ───────────────────── 汇总 ───────────────────── */

server?.stop?.(true);

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;

console.log('');
for (const r of results) {
  if (r.ok) {
    console.log(`  ✓ ${r.name}${r.note ? `  — ${r.note}` : ''}`);
  } else {
    console.log(`  ✗ ${r.name}`);
    for (const i of r.issues) console.log(`      · ${i.path}: ${i.message}`);
  }
}

console.log(`\n${'─'.repeat(68)}`);
console.log(`  ${pass} 项通过 / ${results.length} 项总计${fail ? `  —— ${fail} 项失败` : '  —— 全部通过 🎉'}`);
console.log(`${'─'.repeat(68)}\n`);

process.exit(fail ? 1 : 0);
