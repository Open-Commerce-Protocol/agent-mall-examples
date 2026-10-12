/**
 * 证据 2 · 一键走查:起服务 → 十步(全部由官方未修改的 CLI / HTTP 驱动)→ 停服务。
 *
 * 十步对应《用 OCP 做一个奶茶铺:从零复现指引》第 3 节:
 *   1 发现入口  2 官方 CLI 读 manifest  3 官方 schema 校验  4 自然语言检索
 *   5 检索前本地校验  6 结构化筛选检索  7 resolve(view)  8 resolve(checkout)
 *   9 真正下单(非协议端点)  10 边界用例
 *
 * 跑法:bun run demo   —— 结束打印「全流程通过」且退出码为 0 即复现成功。
 */
import { $ } from 'bun';

const ROOT = import.meta.dir.replace('/scripts', '');
const PORT = 4410;
const BASE = `http://localhost:${PORT}`;
const OCP = ['bunx', '@ocp-catalog/ocp-cli@0.1.3'];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(step: string, name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ [${step}] ${name}`);
  } else {
    failed++;
    failures.push(`[${step}] ${name}${detail ? ` —— ${detail}` : ''}`);
    console.log(`  ❌ [${step}] ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function http(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function ocp(args: string[]): Promise<any> {
  const proc = Bun.spawnSync([...OCP, ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const out = proc.stdout.toString();
  if (proc.exitCode !== 0) throw new Error(`CLI 失败:ocp ${args.join(' ')}\n${out}\n${proc.stderr.toString()}`);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

async function waitForServer(retries = 30): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/ocp/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(200);
  }
  return false;
}

async function main() {
  console.log('🚀 瑞幸咖啡铺 · 十步走查(官方工具链驱动)\n');
  const server = Bun.spawn(['bun', 'run', 'src/server.ts'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });

  try {
    if (!(await waitForServer())) throw new Error('服务未能在 6 秒内就绪');
    console.log(`☕ 服务已就绪:${BASE}\n`);

    // ── 步骤 1 · 发现入口 ─────────────────────────────────────────────
    console.log('步骤 1 · 发现入口:GET /.well-known/ocp-catalog');
    const s1 = await http('GET', '/.well-known/ocp-catalog');
    ok('1', '返回发现信息,含 query_url / resolve_url', !!s1.data.query_url && !!s1.data.resolve_url);
    console.log(`     catalog: ${s1.data.catalog_name} (${s1.data.catalog_id})`);

    // ── 步骤 2 · 官方 CLI 读 manifest ────────────────────────────────
    console.log('\n步骤 2 · 官方 CLI 读取能力声明:ocp catalog inspect');
    const s2 = await ocp(['catalog', 'inspect', `${BASE}/ocp/manifest`]);
    ok('2', `官方 CLI 认出本节点 catalog_id=${s2.catalog_id ?? s2.manifest?.catalog_id}`, (s2.catalog_id ?? s2.manifest?.catalog_id) === 'cat_luckin_demo');

    // ── 步骤 3 · 官方 schema 校验(硬证据)───────────────────────────
    console.log('\n步骤 3 · 官方 schema 校验:ocp validate manifest');
    const s3 = await ocp(['validate', 'manifest', `${BASE}/ocp/manifest`]);
    ok('3', `validate manifest -> ok:${s3.ok}`, s3.ok === true);

    // ── 步骤 4 · 自然语言检索 ────────────────────────────────────────
    console.log('\n步骤 4 · 用一句人话查菜单:检索「不太甜的咖啡」');
    const s4 = await ocp(['catalog', 'query', '--query-url', `${BASE}/ocp/query`, '--query', '不太甜的咖啡', '--query-pack', 'ocp.query.keyword.v1']);
    const hit = (s4.entries ?? []).find((e: any) => e.entry.title.includes('燕麦拿铁'));
    ok('4a', `命中 ${s4.result_count} 条`, s4.result_count >= 1);
    ok('4b', `首选推荐:「${hit?.entry?.title}」`, !!hit);
    const ENTRY_ID = hit?.entry?.entry_id;
    const OBJECT_ID = hit?.entry?.object_id;
    (s4.entries ?? []).slice(0, 3).forEach((e: any) => console.log(`     - ${e.entry.title}  ¥${e.entry.attributes.price.amount}  score=${e.score}`));

    // ── 步骤 5 · 检索前的本地校验 ────────────────────────────────────
    console.log('\n步骤 5 · 不联网校验自定义 pack 的请求体:ocp validate query');
    const s5 = await ocp(['validate', 'query', '--manifest', `${BASE}/ocp/manifest`, '--query-pack', 'luckin.query.filter.v1', '--filters', '{"category":"fruit_tea","max_amount":20}']);
    ok('5', `validate query -> ok:${s5.ok}`, s5.ok === true);

    // ── 步骤 6 · 带结构化筛选的检索 ──────────────────────────────────
    console.log('\n步骤 6 · 筛选检索:果茶 且 ≤20 元(自定义 filter pack)');
    const s6 = await http('POST', '/ocp/query', { query: '', query_pack: 'luckin.query.filter.v1', filters: { category: 'fruit_tea', max_amount: 20 } });
    const s6entries = (s6.data.entries ?? []).map((e: any) => e.entry);
    ok('6a', `返回 ${s6entries.length} 条果茶`, s6entries.length >= 1 && s6entries.every((e: any) => e.attributes.category === 'fruit_tea'));
    ok('6b', '全部 ≤ 20 元', s6entries.every((e: any) => e.attributes.price.amount <= 20));
    s6entries.forEach((e: any) => console.log(`     - ${e.title}  ¥${e.attributes.price.amount}`));

    // ── 步骤 7 · resolve:只想看看详情 ───────────────────────────────
    console.log('\n步骤 7 · resolve(purpose=view):只看详情,不要下单');
    const s7 = await http('POST', '/ocp/resolve', { entry_id: ENTRY_ID, purpose: 'view' });
    const viewBinding = s7.data.action_bindings?.[0];
    ok('7a', `返回 ${viewBinding?.action_type} 动作「${viewBinding?.label}」`, viewBinding?.action_type === 'url');
    ok('7b', '查看详情无需用户确认', viewBinding?.requires_user_confirmation === false);

    // ── 步骤 8 · resolve:要下单(演示高潮)─────────────────────────
    console.log('\n步骤 8 · resolve(purpose=checkout):同一个 entry,换成下单');
    const s8 = await http('POST', '/ocp/resolve', { entry_id: ENTRY_ID, purpose: 'checkout' });
    const orderBinding = s8.data.action_bindings?.[0];
    ok('8a', `动作从 url 变为 ${orderBinding?.action_type}(${orderBinding?.entrypoint?.method} ${orderBinding?.entrypoint?.url})`, orderBinding?.action_type === 'api');
    ok('8b', '强制 requires_user_confirmation=true', orderBinding?.requires_user_confirmation === true);
    ok('8c', `带 10 分钟时效 expires_at:${orderBinding?.expires_at}`, !!orderBinding?.expires_at && new Date(orderBinding.expires_at).getTime() > Date.now());
    console.log(`     label: ${orderBinding?.label}`);
    console.log(`     input_schema: ${JSON.stringify(orderBinding?.input_schema)}`);

    // ── 步骤 9 · 真正下单(协议边界之外)─────────────────────────────
    console.log('\n步骤 9 · 真正下单:POST /shop/order(门店自有接口,非协议端点)');
    const s9 = await http('POST', '/shop/order', { object_id: OBJECT_ID, quantity: 1, confirmation: true });
    ok('9a', `下单成功,订单号 ${s9.data.order_id}`, s9.status === 201 && !!s9.data.order_id);
    ok('9b', `支付方式:${s9.data.payment}`, s9.data.payment?.includes('mock'));
    console.log(`     ☕ ${s9.data.drink} ×${s9.data.quantity} = ¥${s9.data.total},取餐码 ${s9.data.pickup_code}`);

    // ── 步骤 10 · 边界用例 ──────────────────────────────────────────
    console.log('\n步骤 10 · 边界:不存在的 ID、未声明的 pack、不支持的翻页');
    const s10a = await http('POST', '/ocp/resolve', { entry_id: 'entry_不存在', purpose: 'view' });
    ok('10a', `未知 entry_id -> ${s10a.status} not_found`, s10a.status === 404 && s10a.data.error?.code === 'not_found');
    const s10b = await http('POST', '/ocp/query', { query: '咖啡', query_pack: 'someone.else.pack.v1' });
    ok('10b', `未声明 pack -> ${s10b.status} invalid_request`, s10b.status === 400 && s10b.data.error?.code === 'invalid_request');
    const s10c = await http('POST', '/ocp/query', { query: '咖啡', offset: 1 });
    ok('10c', `offset=1 翻页 -> ${s10c.status} invalid_request`, s10c.status === 400);
  } finally {
    server.kill();
    await Bun.sleep(200);
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`断言:${passed} 通过,${failed} 失败`);
  if (failed === 0) {
    console.log('✅ 全流程通过 —— 一个第三方按规范写的 Catalog Node,能被未修改的官方工具链直接驱动。');
    process.exit(0);
  } else {
    failures.forEach((f) => console.log(`   ${f}`));
    process.exit(1);
  }
}

main();
