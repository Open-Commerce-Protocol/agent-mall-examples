/**
 * 对话功能验收。
 *
 * 两件事必须分开证明：
 *   A. **LLM 模式**：模型能查真实菜单、推荐、并**暂存**订单。用一个模拟 LLM
 *      （OpenAI 兼容接口）驱动工具调用闭环——因为本机没有可用的模型 API key，
 *      但工具调用这一层必须被真实验证，而不是"等配了 key 再说"。
 *   B. **本地回退**：未配置 LLM 时用真实瑞幸 MCP 做关键词推荐，且**如实声明自己不是 LLM**。
 *
 * 贯穿全场的铁律：两种模式都**不能下单**。验收会断言会话订单数始终为 0。
 *
 * 用法：node scripts/verify-chat.ts
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { luckinToken } from './_token.ts';
import { startWeb, WEB_PORT } from '../src/web.ts';
import { LIMITS, getSession } from '../src/session.ts';
import { parsePromptedCall } from '../src/chat/service.ts';

const MOCK_PORT = 8099;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50, ' ')} ${detail}`);
};

/* ------------------------------------------------------------ 模拟 LLM */

type Msg = { role: string; content: string | null; tool_calls?: any[] };

/** 一个会走完整工具链的假模型：list_stores → search_products → stage_order → 收尾。 */
function mockTools(messages: Msg[]): Record<string, unknown> {
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  const step = toolMsgs.length;

  const call = (name: string, args: unknown) => ({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: `call_${step + 1}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });

  if (step === 0) return call('list_stores', {});
  if (step === 1) {
    const stores = JSON.parse(String(toolMsgs[0]?.content ?? '[]')) as { storeId: number; name: string }[];
    const open = stores[0];
    return call('search_products', { storeId: open?.storeId, query: '生椰' });
  }
  if (step === 2) {
    const stores = JSON.parse(String(toolMsgs[0]?.content ?? '[]')) as { storeId: number }[];
    const products = JSON.parse(String(toolMsgs[1]?.content ?? '[]')) as { productId: number; name: string }[];
    return call('stage_order', { storeId: stores[0]?.storeId, productId: products[0]?.productId });
  }
  return {
    role: 'assistant',
    content: `给你挑了「${'生椰拿铁'}」——清爽不腻，¥20。确认单已经放在下面，你核对后点确认即可（我没有下单权限）。`,
  };
}

function startMockLlm(): Promise<{ close: () => void; calls: () => number; mode: (m: string) => void }> {
  let count = 0;
  let behaviour = 'tools';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      count += 1;
      const send = (payload: unknown, status = 200): void => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
        res.end(text);
      };
      if (behaviour === 'broken') return send({ oops: true });
      if (behaviour === 'http500') return send({ error: 'boom' }, 500);
      if (behaviour === 'prompted') {
        // prompted 模式：模型只被喂一段纯文本，用"输出一行 JSON"表示工具调用。
        const parsed = JSON.parse(body || '{}') as { messages?: { content: string }[] };
        const prompt = (parsed.messages ?? []).map((m) => m.content).join('\n');
        const steps = (prompt.match(/工具结果（/g) ?? []).length;
        const storeId = /"storeId":\s*(\d+)/.exec(prompt)?.[1];
        const productId = /"productId":\s*(\d+)/.exec(prompt)?.[1];
        let content: string;
        if (steps === 0) content = '{"tool":"list_stores","args":{}}';
        else if (steps === 1) content = JSON.stringify({ tool: 'search_products', args: { storeId: Number(storeId), query: '生椰' } });
        else if (steps === 2) content = JSON.stringify({ tool: 'stage_order', args: { storeId: Number(storeId), productId: Number(productId) } });
        else content = '按你的口味挑了生椰拿铁，¥20。确认单在下面，核对后点确认即可——我没有下单权限。';
        return send({ choices: [{ message: { role: 'assistant', content } }] });
      }
      const parsed = JSON.parse(body || '{}') as { messages?: Msg[] };
      send({ choices: [{ message: mockTools(parsed.messages ?? []) }] });
    });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, '127.0.0.1', () =>
      resolve({
        close: () => server.close(),
        calls: () => count,
        mode: (m: string) => {
          behaviour = m;
        },
      }),
    );
  });
}

/* ------------------------------------------------------------------ 工具 */

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  return { status: res.status, data: await res.json() };
};

/* token 读取统一走 ./_token.ts（支持 LUCKIN_TOKEN / LUCKIN_TOKEN_FILE，不写死个人目录） */

/* ------------------------------------------------------------------ 开跑 */

const mock = await startMockLlm();
await startWeb();

console.log(`\n对话功能验收（模拟 LLM 在 :${MOCK_PORT}）`);
console.log('-'.repeat(104));

/* 1. 未配置 LLM 时，配置接口必须如实说明 */
delete process.env.CHAT_LLM_BASE_URL;
delete process.env.CHAT_LLM_API_KEY;
const cfgOff = await (await fetch(`${BASE}/api/chat/config`)).json();
record(
  'GET /api/chat/config（未配置 LLM）',
  cfgOff.llmEnabled === false && String(cfgOff.note).includes('关键词推荐'),
  `llmEnabled=${cfgOff.llmEnabled}　如实标注为关键词推荐`,
);

/* 建会话（真实瑞幸 token） */
const session = await post('/api/session', { brandId: 'luckin', token: luckinToken() });
const sessionId = session.data.sessionId as string;
record('POST /api/session', session.status === 200 && typeof sessionId === 'string', `${session.status} 指纹 ${session.data.tokenFingerprint}`);

/* 2. 本地回退：用真实菜单做推荐 */
const fb = await post('/api/chat', { sessionId, message: '我想喝生椰拿铁' });
record(
  'fallback 对话（真实菜单）',
  fb.status === 200 && fb.data.mode === 'fallback' && fb.data.reply.includes('生椰拿铁（原创）'),
  `${fb.status} mode=${fb.data.mode}　命中真实商品`,
);
record(
  'fallback 如实声明不是 LLM',
  String(fb.data.reply).includes('未配置 LLM') && String(fb.data.reply).includes('关键词推荐'),
  '回复首行明确标注，不假装在聊天',
);
record(
  'fallback 带出真实价格与门店',
  String(fb.data.reply).includes('¥') && String(fb.data.reply).includes('门店'),
  String(fb.data.reply).split('\n').slice(2, 4).join(' / ').slice(0, 90),
);

/* 3. 负例：空消息 / 超长消息 */
const empty = await post('/api/chat', { sessionId, message: '   ' });
record('负例 空消息 → 应 400', empty.status === 400 && empty.data.error?.code === 'empty_message', `${empty.status} ${empty.data.error?.code}`);
const tooLong = await post('/api/chat', { sessionId, message: 'x'.repeat(501) });
record('负例 超长消息 → 应 400', tooLong.status === 400 && tooLong.data.error?.code === 'message_too_long', `${tooLong.status} ${tooLong.data.error?.code}`);

/* 4. LLM 模式：工具调用闭环 */
process.env.CHAT_LLM_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.CHAT_LLM_API_KEY = 'mock-key';
process.env.CHAT_LLM_MODEL = 'mock-model';

const cfgOn = await (await fetch(`${BASE}/api/chat/config`)).json();
record('GET /api/chat/config（已配置 LLM）', cfgOn.llmEnabled === true && cfgOn.model === 'mock-model', `llmEnabled=${cfgOn.llmEnabled} model=${cfgOn.model}`);

const chat = await post('/api/chat', { sessionId, message: '推荐一杯清爽的' });
const trace: { tool: string; note: string }[] = chat.data.trace ?? [];
record(
  'LLM 对话返回 mode=llm',
  chat.status === 200 && chat.data.mode === 'llm',
  `${chat.status} mode=${chat.data.mode}　模型调用 ${mock.calls()} 次`,
);
record(
  '工具调用链完整',
  trace.map((t) => t.tool).join('→') === 'list_stores→search_products→stage_order',
  trace.map((t) => `${t.tool}(${t.note})`).join(' → '),
);
record(
  '模型给出了自然语言回复',
  typeof chat.data.reply === 'string' && chat.data.reply.length > 10 && !chat.data.reply.includes('{'),
  `「${String(chat.data.reply).slice(0, 60)}…」`,
);
record(
  '暂存订单带确认单与实付金额',
  chat.data.stagedOrder !== undefined &&
    typeof chat.data.stagedOrder.confirmToken === 'string' &&
    typeof chat.data.stagedOrder.summary.pricing.payable === 'number',
  `实付 ¥${chat.data.stagedOrder?.summary?.pricing?.payable}　商品「${chat.data.stagedOrder?.productName}」`,
);

/* 5. 铁律：模型拿不到下单能力 */
const status = await post('/api/session/status', { sessionId });
record(
  '铁律 模型不能下单（订单数仍为 0）',
  status.data.orderCount === 0 && status.data.spendTotal === 0,
  `orderCount=${status.data.orderCount} spendTotal=¥${status.data.spendTotal}　暂存订单等待人工确认`,
);

/* 6b. prompted 模式：把工具协议写进提示词，任何纯文本补全接口都能用 */
record(
  'parsePromptedCall 纯 JSON',
  parsePromptedCall('{"tool":"list_stores","args":{}}')?.tool === 'list_stores',
  '解析出 list_stores',
);
record(
  'parsePromptedCall 夹在文字里也能抽',
  parsePromptedCall('好的，我先看看门店 {"tool":"search_products","args":{"query":"生椰"}} 然后给你推荐')?.tool === 'search_products',
  '从自然语言里抽出工具调用',
);
record(
  'parsePromptedCall 普通回复不误判',
  parsePromptedCall('给你挑了生椰拿铁，¥20，要来一杯吗？') === undefined &&
    parsePromptedCall('{"notool":1}') === undefined,
  '没有 tool 字段就不当成工具调用',
);

process.env.CHAT_LLM_MODE = 'prompted';
mock.mode('prompted');
const prompted = await post('/api/chat', { sessionId, message: '推荐一杯' });
const pTrace: { tool: string }[] = prompted.data.trace ?? [];
record(
  'prompted 模式工具闭环',
  prompted.status === 200 &&
    prompted.data.mode === 'llm' &&
    pTrace.map((t) => t.tool).join('→') === 'list_stores→search_products→stage_order',
  pTrace.map((t) => t.tool).join(' → ') || '(无工具调用)',
);
record(
  'prompted 模式给出自然语言回复',
  typeof prompted.data.reply === 'string' && prompted.data.reply.includes('生椰拿铁') && !prompted.data.reply.trim().startsWith('{'),
  `「${String(prompted.data.reply).slice(0, 54)}…」`,
);
record(
  'prompted 模式同样不能下单',
  prompted.data.stagedOrder !== undefined && (await post('/api/session/status', { sessionId })).data.orderCount === 0,
  '已暂存订单；订单数仍为 0',
);
delete process.env.CHAT_LLM_MODE;
mock.mode('tools');

/* 7. 负例：模型接口坏掉时必须如实报错，而不是假装成功 */
mock.mode('broken');
const broken = await post('/api/chat', { sessionId, message: '再来一杯' });
record(
  '负例 模型返回非 JSON → 502',
  broken.status === 502 && String(broken.data.error?.code).includes('llm'),
  `${broken.status} ${broken.data.error?.code}`,
);
mock.mode('http500');
const http500 = await post('/api/chat', { sessionId, message: '再来一杯' });
record('负例 模型 HTTP 500 → 502', http500.status === 502, `${http500.status} ${http500.data.error?.code}`);
mock.mode('tools');

/* 7. 确认门依然生效：暂存单可以走 /api/order，但未确认必须被拒 */
// 注意：不要用更早那次暂存的 token——后续用例会暂存新订单把它顶掉。
// 正确做法是"下单前记下当前暂存单，下单后比对它没被消费"。
const pendingBefore = getSession(sessionId)?.pending?.confirmToken;
if (pendingBefore !== undefined) {
  const noAck = await post('/api/order', { sessionId, confirmToken: pendingBefore, acknowledge: false });
  record('确认门 未确认 → 应 428', noAck.status === 428 && noAck.data.error?.code === 'not_acknowledged', `${noAck.status} ${noAck.data.error?.code}`);

  // ⚠️ 这里**绝不**用 acknowledge:true 去试真实下单——默认上限 ¥100 挡不住 ¥20 的单，
  // 那会真的扣钱。"确认后才放行"这条正向路径由 verify-local.ts 用 ORDER_MAX_AMOUNT=1
  // 在金额门上验证，不需要在这里重复，更不该拿真钱去试。
  record(
    '确认门 未确认不消费暂存单',
    getSession(sessionId)?.pending?.confirmToken === pendingBefore,
    '暂存单仍在且未被消费；正向下单路径不在此处验证（避免真实扣款）',
  );
} else {
  record('确认门 未确认不消费暂存单', false, '会话里没有待确认订单，说明前面的暂存失败了');
}

const finalStatus = await post('/api/session/status', { sessionId });
record(
  '铁律 全程订单数为 0',
  finalStatus.data.orderCount === 0 && finalStatus.data.spendTotal === 0,
  `orderCount=${finalStatus.data.orderCount} spendTotal=¥${finalStatus.data.spendTotal}`,
);

/* 8. 额度保护闸：接入真实 LLM 后每句话都在花钱，必须能拦住 */
let limited = false;
let attempts = 0;
while (attempts < 14 && !limited) {
  attempts += 1;
  const r = await post('/api/chat', { sessionId, message: '继续' });
  if (r.status === 429 && r.data.error?.code === 'chat_rate_limited') limited = true;
  if (r.status !== 200 && r.status !== 429) break;
}
record('限流闸 触发每分钟上限 → 429', limited, `连续发 ${attempts} 条后被拦（上限 ${LIMITS.chatPerMinute}/分钟）`);

// 限流闸测完再关模拟 LLM——它必须活到最后一刻。
mock.close();
const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(104));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n本次验收未产生任何真实订单，未产生任何扣款。');
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 100);
