/**
 * 本地验收：把整条站点链路跑一遍（含护栏的每一道拒绝），**但绝不会真的下单**。
 *
 * 关键手法：用 `ORDER_MAX_AMOUNT=1` 启动，于是连"格式完全正确的下单请求"
 * 也会被金额门挡住（403 over_order_limit）。这样最后一道门被证明有效，
 * 而 ¥0 被花掉。
 *
 * 用法：ORDER_MAX_AMOUNT=1 node scripts/verify-local.ts
 */
import { readFileSync } from 'node:fs';
import { luckinToken } from './_token.ts';
import { startWeb, WEB_PORT } from '../src/web.ts';

/* ---------------------------------------------------------------- 安全联锁
 * 这个脚本里有一处 `acknowledge: true` 且 confirmToken 正确的下单请求（故意用来
 * 证明"金额门"有效）。**它靠 ORDER_MAX_AMOUNT=1 才安全**——上限大于实付时，
 * 那道门就不再拦它，请求会真的打到商户并产生扣款。
 *
 * 所以：没有显式把上限压到 1 就直接拒绝运行。
 * 加这道联锁的原因是一次真实事故：这个脚本被当成普通模块 import（它有顶层 await，
 * import 即执行），而当时没有设 ORDER_MAX_AMOUNT，默认上限 ¥100 足以放行。
 */
if (process.env.ORDER_MAX_AMOUNT !== '1') {
  console.error(
    '\n拒绝运行：这个验收脚本必须把金额上限压到 1，否则它的"超上限"用例会变成真实下单。\n\n' +
      '  正确用法：ORDER_MAX_AMOUNT=1 node scripts/verify-local.ts\n' +
      `  当前值：ORDER_MAX_AMOUNT=${process.env.ORDER_MAX_AMOUNT ?? '(未设置，默认 ¥100 —— 会放行真实订单)'}\n\n` +
      '只想看链路是否正常，请改用：node scripts/verify-entry.ts（不碰下单）\n',
  );
  process.exit(2);
}

const BASE = `http://127.0.0.1:${WEB_PORT}`;
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46, ' ')} ${detail}`);
};

const get = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) });
  return { status: res.status, data: await res.json() };
};
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, data: await res.json() };
};

/** token 从 DSH 配置读（本机已有瑞幸 token）；不打印明文。 */
/* token 读取统一走 ./_token.ts（支持 LUCKIN_TOKEN / LUCKIN_TOKEN_FILE，不写死个人目录） */

await startWeb();
console.log(`\n本地验收（上限被压到 ¥${process.env.ORDER_MAX_AMOUNT} 以防真实扣款）`);
console.log(`服务 ${BASE}`);
console.log('-'.repeat(100));

/* 1. 健康与品牌 */
const health = await get('/api/health');
record('GET /api/health', health.status === 200 && health.data.status === 'healthy', `${health.status} brands=${health.data.brands}`);
const brands = await get('/api/brands');
const ready = (brands.data.brands ?? []).filter((b: any) => b.status === 'ready').length;
record(
  'GET /api/brands',
  brands.status === 200 && ready >= 1,
  `${brands.status} 共 ${brands.data.brands.length} 个品牌，${ready} 个已接通；二期 ${brands.data.planned.length} 个`,
);

/* 2. 负例：不存在的品牌 */
const badBrand = await post('/api/session', { brandId: 'nope', token: 'x' });
record('负例 未知品牌 → 应 400', badBrand.status === 400 && badBrand.data.error?.code === 'unknown_brand', `${badBrand.status} ${badBrand.data.error?.code}`);

/* 3. 负例：空 token */
const emptyToken = await post('/api/session', { brandId: 'luckin', token: '' });
record('负例 空 token → 应 400', emptyToken.status === 400 && emptyToken.data.error?.code === 'missing_token', `${emptyToken.status} ${emptyToken.data.error?.code}`);

/* 4. 负例：无效 token 必须被品牌 MCP 拒绝 */
const badToken = await post('/api/session', { brandId: 'luckin', token: 'definitely-not-a-valid-token' });
record(
  '负例 无效 token → 应 401',
  badToken.status === 401 && badToken.data.error?.code === 'token_rejected',
  `${badToken.status} ${badToken.data.error?.code}`,
);

/* 5. 正路：建会话 */
const session = await post('/api/session', { brandId: 'luckin', token: luckinToken() });
const sessionId = session.data.sessionId;
record(
  'POST /api/session（瑞幸真实 token）',
  session.status === 200 && typeof sessionId === 'string' && session.data.tokenFingerprint?.length === 8,
  `${session.status} 指纹 ${session.data.tokenFingerprint} 服务器 ${session.data.serverInfo?.serverInfo?.name}`,
);
record(
  '响应中不含 token 明文',
  !JSON.stringify(session.data).includes(luckinToken()),
  '已检查：响应体里搜不到 token',
);

/* 6. 门店 */
const stores = await post('/api/stores', { sessionId });
const storeList: any[] = stores.data.stores ?? [];
record('POST /api/stores', stores.status === 200 && storeList.length > 0, `${stores.status} ${storeList.length} 家门店`);
const store = storeList.find((s) => s.workStatus === '营业中') ?? storeList[0];

/* 7. 商品 */
const products = await post('/api/products', { sessionId, storeId: store.storeId, query: '生椰拿铁' });
const productList: any[] = products.data.products ?? [];
record(
  'POST /api/products',
  products.status === 200 && productList.length > 0,
  `${products.status} ${productList.length} 款 → ${productList.map((p) => p.name).join(' / ')}`,
);
const product = productList[0];

/* 8. 规格 */
const options = await post('/api/options', { sessionId, storeId: store.storeId, productId: product.productId });
const groups: any[] = options.data.options ?? [];
record(
  'POST /api/options',
  options.status === 200 && groups.length > 0,
  `${options.status} ${groups.length} 组属性：${groups.map((g) => `${g.attributeName}(${g.choices.length})`).join(' ')}`,
);

/* 9. 选规格（温度→热） */
const tempGroup = groups.find((g) => g.attributeName === '温度');
const hot = tempGroup?.choices.find((c: any) => String(c.name).includes('热'));
let skuCode: string = product.skuCode;
if (tempGroup !== undefined && hot !== undefined) {
  const configured = await post('/api/configure', {
    sessionId,
    storeId: store.storeId,
    productId: product.productId,
    skuCode: product.skuCode,
    amount: 1,
    selections: [{ attributeId: tempGroup.attributeId, subAttributeId: hot.subAttributeId }],
  });
  skuCode = configured.data.skuCode ?? skuCode;
  record('POST /api/configure（温度→热）', configured.status === 200 && skuCode !== product.skuCode, `${configured.status} ${product.skuCode} → ${skuCode}`);
} else {
  record('POST /api/configure（温度→热）', false, '没找到「热」选项');
}

/* 10. 预览 */
const lines = [{ productId: product.productId, skuCode, amount: 1 }];
const preview = await post('/api/preview', { sessionId, storeId: store.storeId, lines });
const summary = preview.data.summary;
record(
  'POST /api/preview',
  preview.status === 200 && typeof preview.data.confirmToken === 'string' && typeof summary?.pricing?.payable === 'number',
  `${preview.status} 实付 ¥${summary?.pricing?.payable} 指纹 ${summary?.fingerprint} 确认令牌已发`,
);

/* 11. 护栏 A：未确认 */
const noAck = await post('/api/order', { sessionId, confirmToken: preview.data.confirmToken, acknowledge: false });
record('护栏 未确认 → 应 428', noAck.status === 428 && noAck.data.error?.code === 'not_acknowledged', `${noAck.status} ${noAck.data.error?.code}`);

/* 12. 护栏 B：确认令牌不对 */
const staleToken = await post('/api/order', { sessionId, confirmToken: 'wrong-token', acknowledge: true });
record('护栏 令牌不符 → 应 428', staleToken.status === 428 && staleToken.data.error?.code === 'stale_confirmation', `${staleToken.status} ${staleToken.data.error?.code}`);

/* 13. 护栏 C：没预览过就下单 */
const noPreview = await post('/api/order', { sessionId: 'no-such-session', confirmToken: 'x', acknowledge: true });
record('护栏 会话不存在 → 应 401', noPreview.status === 401 && noPreview.data.error?.code === 'session_expired', `${noPreview.status} ${noPreview.data.error?.code}`);

/* 14. 护栏 D：格式完全正确的下单，被金额上限挡住（关键：证明最后一道门有效且不花钱） */
const overLimit = await post('/api/order', { sessionId, confirmToken: preview.data.confirmToken, acknowledge: true });
record(
  '护栏 金额超上限 → 应 403（且未下单）',
  overLimit.status === 403 && overLimit.data.error?.code === 'over_order_limit' && overLimit.data.order === undefined,
  `${overLimit.status} ${overLimit.data.error?.code}：${String(overLimit.data.error?.message).slice(0, 46)}…`,
);

/* 15. 会话统计：确认没有任何订单被创建 */
const statusCheck = await post('/api/session/status', { sessionId });
record(
  '会话统计 订单数必须为 0',
  statusCheck.status === 200 && statusCheck.data.orderCount === 0 && statusCheck.data.spendTotal === 0,
  `orderCount=${statusCheck.data.orderCount} spendTotal=¥${statusCheck.data.spendTotal}`,
);

/* 16. 麦当劳：填入 token 后即可列出工具（此处无 token，验证拒绝路径） */
const mcdSession = await post('/api/session', { brandId: 'mcd', token: 'placeholder-token' });
record(
  '麦当劳 无有效 token → 应 401（端点活着）',
  mcdSession.status === 401,
  `${mcdSession.status} ${mcdSession.data.error?.code}`,
);

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(100));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
console.log('\n本次验收未产生任何真实订单，未产生任何扣款。');
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 80);
