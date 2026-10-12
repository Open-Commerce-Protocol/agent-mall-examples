/**
 * 新流程验收：**先聊天推荐，再挑品牌填 token，然后才能查真实菜单**。
 *
 * 这条顺序是重点，所以要证明：
 *   1. 建立对话**不需要任何 token**；
 *   2. 推荐级对话拿不到任何商品数据（工具里没有品牌工具，且调用会明确报错）；
 *   3. 填入 token 绑定品牌后，同一段对话升级为品牌级，能查真实菜单并暂存订单；
 *   4. 全程仍然不能下单。
 *
 * ⚠️ 会消耗少量模型额度（约 2-3 次小请求）。不会下单。
 *
 * 用法：node scripts/verify-flow.ts
 */
import { readFileSync } from 'node:fs';
import { luckinToken } from './_token.ts';
import { startWeb, WEB_PORT } from '../src/web.ts';
import { getSession } from '../src/session.ts';

const BASE = `http://127.0.0.1:${WEB_PORT}`;
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46, ' ')} ${detail}`);
};

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });
  return { status: res.status, data: await res.json() };
};

/* token 读取统一走 ./_token.ts（支持 LUCKIN_TOKEN / LUCKIN_TOKEN_FILE，不写死个人目录） */

await startWeb();
console.log('\n新流程验收（先聊天 → 再挑品牌填 token）');
console.log('-'.repeat(104));

/* 1. 建对话：不需要 token */
const created = await post('/api/conversation', {});
const conversationId = created.data.conversationId as string;
record(
  'POST /api/conversation（无需任何 token）',
  created.status === 200 && typeof conversationId === 'string' && created.data.phase === 'recommend',
  `${created.status} phase=${created.data.phase} 品牌 ${created.data.brands.length} 个`,
);

/* 2. 推荐级聊天：应当只给方向，不能报具体商品 */
const rec = await post('/api/chat', { conversationId, message: '下午有点困，想喝点提神的，但我不太能接受太甜的东西' });
const recReply = String(rec.data.reply ?? '');
record('推荐级聊天返回', rec.status === 200 && rec.data.phase === 'recommend' && recReply.length > 10, `${rec.status} phase=${rec.data.phase}`);
console.log(`      模型：${recReply.replace(/\n/g, ' ').slice(0, 96)}`);
record(
  '推荐级不含品牌工具调用',
  (rec.data.trace ?? []).every((t: { tool: string }) => t.tool === 'list_brands'),
  (rec.data.trace ?? []).length === 0 ? '未调用任何工具' : (rec.data.trace ?? []).map((t: { tool: string }) => t.tool).join(','),
);
record('推荐级提示前端弹出品牌选择', rec.data.nextStep === 'pick-brand', `nextStep=${rec.data.nextStep}`);
record('推荐级未暂存任何订单', rec.data.stagedOrder === undefined, '没有 stagedOrder（拿不到菜单，本就不该有）');

/* 3. 负例：推荐级下拿不到门店数据 */
const storesBefore = await post('/api/stores', { conversationId });
record(
  '负例 推荐级调 /api/stores → 必须失败',
  storesBefore.status !== 200,
  `${storesBefore.status} ${storesBefore.data.error?.code ?? ''}（没有品牌会话，取不到门店是对的）`,
);

/* 4. 填 token 建品牌会话，再绑定到这段对话 */
const session = await post('/api/session', { brandId: 'luckin', token: luckinToken() });
const sessionId = session.data.sessionId as string;
record('POST /api/session（此时才需要 token）', session.status === 200, `${session.status} 指纹 ${session.data.tokenFingerprint}`);

const bound = await post('/api/chat/bind', { conversationId, sessionId });
record(
  'POST /api/chat/bind（把品牌接进同一段对话）',
  bound.status === 200 && bound.data.phase === 'brand' && bound.data.brandName === '瑞幸咖啡',
  `${bound.status} phase=${bound.data.phase} 品牌=${bound.data.brandName}`,
);

/* 5. 品牌级聊天：此时才可能查真实菜单并暂存 */
const brandTurn = await post('/api/chat', { conversationId, message: '那我就要一杯生椰拿铁，要热的，就这个' });
const trace: { tool: string; note: string }[] = brandTurn.data.trace ?? [];
record(
  '品牌级聊天（真实菜单）',
  brandTurn.status === 200 && brandTurn.data.phase === 'brand' && trace.length > 0,
  `${brandTurn.status} 工具调用 ${trace.length} 次`,
);
for (const t of trace) console.log(`      🔧 ${t.tool} — ${t.note}`);
console.log(`      模型：${String(brandTurn.data.reply ?? '').replace(/\n/g, ' ').slice(0, 96)}`);
record(
  '品牌级用上真实商品数据',
  trace.some((t) => t.tool === 'search_products' || t.tool === 'list_stores'),
  trace.some((t) => t.tool === 'search_products') ? '确实查了真实商品' : '（模型这轮没搜商品，但工具已可用）',
);
record('同一段对话升级为品牌级', brandTurn.data.bound === true && brandTurn.data.brandId === 'luckin', `bound=${brandTurn.data.bound}`);

/* 6. 铁律 */
const status = await post('/api/session/status', { sessionId });
record(
  '铁律 全程不能下单',
  status.data.orderCount === 0 && status.data.spendTotal === 0,
  `orderCount=${status.data.orderCount} spendTotal=¥${status.data.spendTotal}`,
);
void getSession;

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(104));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n消耗了少量模型额度；未产生任何真实订单。');
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 120);
