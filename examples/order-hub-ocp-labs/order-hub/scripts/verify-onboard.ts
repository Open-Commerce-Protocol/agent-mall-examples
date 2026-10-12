/**
 * 站内接入的验收：证明"访客能在网站上自己填 token / 自己接品牌"。
 *
 * 覆盖：
 *   - 任何品牌（含"待接通"的）都能提交 token，不再被前端禁用；
 *   - SSRF 防护：非 https、回环、私有网段、非法 id 都被挡；
 *   - 探测 → 生成 spec 草稿 → 保存 → **热重载**（不重启就出现在站点上）；
 *   - 草稿里 shapes 一定为空（字段路径不许编）；
 *   - 非法 token 得到诚实的失败，而不是"未知品牌"。
 *
 * 不会下单、不消耗模型额度。
 */
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startWeb, WEB_PORT } from '../src/web.ts';
import { reloadBrands } from '../src/brands/registry.ts';

const BASE = `http://127.0.0.1:${WEB_PORT}`;
const TEST_ID = 'zz-onboard-test';
const TEST_FILE = fileURLToPath(new URL(`../src/brands/specs/${TEST_ID}.json`, import.meta.url));

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48, ' ')} ${detail}`);
};

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  return { status: res.status, data: await res.json() };
};

await startWeb();
console.log('\n站内接入验收（访客自助填 token / 自助接品牌）');
console.log('-'.repeat(106));

/* ---- 1. SSRF 与输入校验 ---- */
const httpOnly = await post('/api/onboard/inspect', { mcpUrl: 'http://mcp.example.com', id: 'x', token: 't' });
record('非 https 被拒', httpOnly.status === 400 && httpOnly.data.error?.code === 'https_required', `${httpOnly.status} ${httpOnly.data.error?.code}`);

const loopback = await post('/api/onboard/inspect', { mcpUrl: 'https://127.0.0.1:9/mcp', id: 'x', token: 't' });
record('回环地址被拒（SSRF 防护）', loopback.status === 400 && loopback.data.error?.code === 'private_host_blocked', `${loopback.status} ${loopback.data.error?.code}`);

const priv = await post('/api/onboard/inspect', { mcpUrl: 'https://192.168.1.10/mcp', id: 'x', token: 't' });
record('私有网段被拒（SSRF 防护）', priv.status === 400 && priv.data.error?.code === 'private_host_blocked', `${priv.status} ${priv.data.error?.code}`);

const badId = await post('/api/onboard/inspect', { mcpUrl: 'https://mcp.mcd.cn', id: '../../etc/passwd', token: 't' });
record('非法 id 被拒（防路径穿越）', badId.status === 400 && badId.data.error?.code === 'invalid_id', `${badId.status} ${badId.data.error?.code}`);

/* ---- 2. 真实握手：拿真 token 之前应当诚实失败 ---- */
const real = await post('/api/onboard/inspect', { mcpUrl: 'https://mcp.mcd.cn', id: 'mcd', name: '麦当劳中国', token: 'fake-token-for-test' });
record(
  '假 token 对真实 MCP → 诚实失败',
  real.status === 401 && real.data.error?.code === 'token_rejected',
  `${real.status} ${real.data.error?.code}：${String(real.data.error?.message ?? '').slice(0, 42)}`,
);

/* ---- 3. 保存草稿 → 热重载 ---- */
const draft = {
  id: TEST_ID,
  name: '验收用测试品牌',
  tagline: '（验收用，稍后自动删除）',
  mcpUrl: 'https://mcp.mcd.cn',
  tokenHint: '（验收用）',
  requiresLocation: true,
  defaultLocation: { longitude: 120.1551, latitude: 30.2741 },
  orderNeedsLocation: true,
  specNote: '由验收脚本写入。',
  ops: { listStores: { tool: 'storeQuery', args: {} } },
  shapes: {},
};
const saved = await post('/api/onboard/save', { spec: draft });
record('保存 spec 并热重载', saved.status === 200 && existsSync(TEST_FILE), `${saved.status} 写入 ${saved.data.savedTo}`);
record('热重载返回新品牌清单', Array.isArray(saved.data.brands) && saved.data.brands.some((b: { id: string }) => b.id === TEST_ID), `${saved.data.brands?.length} 个品牌`);

const brands = await (await fetch(`${BASE}/api/brands`)).json();
const created = brands.brands.find((b: { id: string }) => b.id === TEST_ID);
record('新品牌立刻出现在站点上（无需重启）', created !== undefined, created ? `status=${created.status}` : '未出现');
record(
  '新品牌如实标注缺什么',
  created?.status === 'pending-token' && Array.isArray(created?.missing) && created.missing.length > 0,
  `missing=${JSON.stringify(created?.missing ?? [])}`,
);
record('草稿的 shapes 为空（字段路径不许编）', Object.keys(created ? draft.shapes : {}).length === 0 && created?.status !== 'ready', '未编造字段路径，故不标 ready');
record('McD 现在可提交 token（不再被禁用）', brands.brands.some((b: { id: string }) => b.id === 'mcd'), `mcd status=${brands.brands.find((b: { id: string }) => b.id === 'mcd')?.status}`);

/* ---- 4. 未接通品牌也能建会话（这一步以前在前端被 disabled 挡住） ---- */
const sess = await post('/api/session', { brandId: TEST_ID, token: 'fake' });
record(
  '待接通品牌也能提交 token（曾经被前端禁用）',
  sess.status === 401 && sess.data.error?.code === 'token_rejected',
  `${sess.status} ${sess.data.error?.code}（是"token 不行"而不是"未知品牌"，说明路径通了）`,
);

/* ---- 5. 清理 ---- */
if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
reloadBrands();
const after = await (await fetch(`${BASE}/api/brands`)).json();
record('验收用品牌已清理', !after.brands.some((b: { id: string }) => b.id === TEST_ID), `剩余 ${after.brands.length} 个品牌`);

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(106));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n未下单、未扣款、未消耗模型额度。');
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 120);
