/**
 * 用真实 DSH 账户额度端到端验收对话功能。
 *
 * ⚠️ 这个脚本**会真实消耗你的模型额度**（每次运行约 2-5 次小请求，几百 token 量级）。
 * 它仍然**不会下单**：只走「查菜单 → 推荐 → 暂存订单」，下单要人点确认。
 *
 * 用法：node scripts/verify-dsh.ts
 */
import { readFileSync } from 'node:fs';
import { luckinToken } from './_token.ts';
import { startWeb, WEB_PORT } from '../src/web.ts';
import { llmConfig } from '../src/chat/service.ts';
import { getSession } from '../src/session.ts';

const BASE = `http://127.0.0.1:${WEB_PORT}`;
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44, ' ')} ${detail}`);
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

/* 用 DSH 账户额度 */
process.env.CHAT_LLM_PROVIDER = 'dsh-account';
delete process.env.CHAT_LLM_BASE_URL;
delete process.env.CHAT_LLM_API_KEY;

const config = llmConfig();
console.log(`\nDSH 账户额度端到端验收`);
console.log('-'.repeat(100));
record(
  '凭据加载',
  config.enabled && config.credentialSource.includes('credentials.yaml'),
  `provider=${config.provider} model=${config.model} 端点=${config.baseUrl} 凭据来源=${config.credentialSource}`,
);
record('认证头正确', config.authHeader === 'x-dsh-auth-token', `header=${config.authHeader}（DSH 账户路由用的不是 Bearer）`);

await startWeb();

const cfgApi = await (await fetch(`${BASE}/api/chat/config`)).json();
record('GET /api/chat/config', cfgApi.llmEnabled === true && cfgApi.provider === 'dsh-account', `llmEnabled=${cfgApi.llmEnabled} provider=${cfgApi.provider} mode=${cfgApi.mode}`);

const session = await post('/api/session', { brandId: 'luckin', token: luckinToken() });
const sessionId = session.data.sessionId as string;
record('建立会话（真实瑞幸 token）', session.status === 200, `${session.status} 指纹 ${session.data.tokenFingerprint}`);

/* ---- native 协议：先试它支不支持 function calling ---- */
process.env.CHAT_LLM_MODE = 'native';
const native = await post('/api/chat', { sessionId, message: '我想喝点清爽的，帮我看看有什么' });
const nativeTrace: { tool: string }[] = native.data.trace ?? [];
record(
  'native 协议（真实模型）',
  native.status === 200 && native.data.mode === 'llm' && typeof native.data.reply === 'string' && native.data.reply.length > 5,
  `${native.status} 工具调用 ${nativeTrace.length} 次　回复：「${String(native.data.reply).slice(0, 46)}…」`,
);
if (nativeTrace.length > 0) {
  console.log(`      工具链：${nativeTrace.map((t) => t.tool).join(' → ')}`);
}

/* ---- prompted 协议：不依赖 function calling，一定要能用 ---- */
process.env.CHAT_LLM_MODE = 'prompted';
const prompted = await post('/api/chat', {
  sessionId,
  message: '我要一杯生椰拿铁，热的，就要这个',
});
const pTrace: { tool: string; note: string }[] = prompted.data.trace ?? [];
record(
  'prompted 协议（真实模型）',
  prompted.status === 200 && prompted.data.mode === 'llm',
  `${prompted.status} 工具调用 ${pTrace.length} 次`,
);
for (const t of pTrace) console.log(`      🔧 ${t.tool} — ${t.note}`);
record(
  'prompted 能走通工具链',
  pTrace.length >= 1 && pTrace.some((t) => t.tool === 'search_products'),
  pTrace.length > 0 ? pTrace.map((t) => t.tool).join(' → ') : '(模型没有调用工具)',
);
record(
  'prompted 给出自然语言回复',
  typeof prompted.data.reply === 'string' && prompted.data.reply.length > 5 && !prompted.data.reply.trim().startsWith('{'),
  `「${String(prompted.data.reply).slice(0, 60)}…」`,
);
if (prompted.data.stagedOrder !== undefined) {
  const s = prompted.data.stagedOrder;
  console.log(`      暂存订单：${s.productName}　实付 ¥${s.summary?.pricing?.payable}　规格 ${s.summary?.lines?.[0]?.specs ?? '?'}`);
}

/* ---- 铁律 ---- */
const status = await post('/api/session/status', { sessionId });
record(
  '铁律 真实模型同样不能下单',
  status.data.orderCount === 0 && status.data.spendTotal === 0,
  `orderCount=${status.data.orderCount} spendTotal=¥${status.data.spendTotal}`,
);
void getSession;

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(100));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n本次验收消耗了少量你的 DSH 账户额度；未产生任何真实订单与扣款。');
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 120);
