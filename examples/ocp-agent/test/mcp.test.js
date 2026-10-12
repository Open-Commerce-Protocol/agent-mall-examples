/**
 * 商家 MCP 接入层测试：
 * 1. MCP client（streamable HTTP）：initialize / tools list / tools call / session id 回传
 * 2. SSE 响应解析（text/event-stream）
 * 3. 401 错误（token 无效）
 * 4. stdio 传输（node -e 起 echo JSON-RPC 子进程）
 * 5. bridge search → preview → createOrder 全链路（走 mock）
 * 6. /ocp/actions/mcp/buy_now 无 confirm 返回 400；confirm:true 真实下单成功
 * 7. /api/mcp/token 运行时设置 + /api/mcp/status 状态
 * 8. NLU domain 路由（商家词表命中 / 长词优先 / 未命中）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { McpClient, decodeHttpBody } = require('../src/mcp/client');
const { createMcpBridge, MCP_BUY_NOW_SCHEMA } = require('../src/mcp/bridge');
const { parseIntent, detectMerchant } = require('../src/agent/nlu');
const { createMockMerchantMcp } = require('./fixtures/mock-merchant-mcp');
const { createRealShapeMerchantMcp } = require('./fixtures/real-merchant-shape-mcp');
const { createServer } = require('../src/server');

/** 临时商家配置文件（指向 mock 服务端） */
function writeTempConfig(url, { merchantId = 'mock-coffee', tokenEnv = 'MOCK_TOKEN' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-mcp-test-'));
  const cfgPath = path.join(dir, 'mcp.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      merchants: [
        {
          id: merchantId,
          name: 'Mock咖啡',
          type: 'streamablehttp',
          url,
          tokenEnv,
          domains: ['咖啡', '奶茶', '饮品'],
          defaultLocation: { longitude: 120.026221, latitude: 30.279212 },
        },
      ],
    }),
  );
  return cfgPath;
}

/** 动态端口启动主 server，返回 { base, close } */
async function startTestServer() {
  const { server, port } = await createServer(0);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** GET helper */
async function get(base, reqPath) {
  const res = await fetch(`${base}${reqPath}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** POST JSON helper */
async function post(base, reqPath, payload) {
  const res = await fetch(`${base}${reqPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ============================================================
// 1. MCP client：streamable HTTP 基本协议面
// ============================================================
test('MCP client（streamable HTTP）：initialize / tools list / tools call / session id 回传', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  try {
    const client = new McpClient({
      type: 'streamablehttp',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: 'Bearer test-token' },
    });
    await client.connect();
    assert.equal(client.serverInfo.name, 'mock-merchant-mcp');
    assert.ok(client.sessionId, 'initialize 响应应携带 mcp-session-id');

    const tools = await client.listTools();
    assert.ok(Array.isArray(tools) && tools.length >= 6, '应有 ≥6 个工具');
    assert.ok(tools.every((t) => t.name));

    // session id 正确回传（mock 对缺失 session id 的请求返回 400，能成功即证明回传）
    const shops = await client.callTool('queryShopList', { longitude: 120.02, latitude: 30.27 });
    assert.ok(Array.isArray(shops.shopList) && shops.shopList.length >= 1);
    assert.equal(shops.shopList[0].deptId, 101);

    const preview = await client.callTool('previewOrder', {
      deptId: 101,
      productList: [{ productId: 5001, skuCode: 'SKU-5001', amount: 2 }],
    });
    assert.equal(preview.orderPreview.totalAmount, 31.8);

    await client.close();
  } finally {
    await mock.close();
  }
});

// ============================================================
// 2. SSE 响应解析
// ============================================================
test('MCP client：text/event-stream（SSE）响应可正确解析', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  try {
    const client = new McpClient({
      type: 'streamablehttp',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: 'Bearer test-token' },
      extraHeaders: { 'x-mock-sse': '1' }, // 让 mock 以 SSE 格式响应
    });
    await client.connect();
    assert.ok(client.sessionId);

    const tools = await client.listTools();
    assert.ok(tools.length >= 6);

    const result = await client.callTool('createOrder', {
      deptId: 101,
      productList: [{ productId: 5001, skuCode: 'SKU-5001', amount: 1 }],
      longitude: 120.02,
      latitude: 30.27,
    });
    assert.ok(result.orderInfo.orderId.startsWith('mock-ord-'));
    await client.close();
  } finally {
    await mock.close();
  }
});

// ============================================================
// 3. 401 错误（token 无效）
// ============================================================
test('MCP client：无效 token（401）抛出含状态码的错误', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  try {
    const client = new McpClient({
      type: 'streamablehttp',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: 'Bearer wrong-token' },
    });
    await assert.rejects(
      () => client.connect(),
      (err) => err.status === 401 && /401/.test(err.message),
    );
  } finally {
    await mock.close();
  }
});

// ============================================================
// 4. stdio 传输（node -e 起 echo JSON-RPC 子进程）
// ============================================================
const STDIO_ECHO_SCRIPT = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === undefined) continue;
    let result = {};
    if (msg.method === 'initialize') {
      result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'stdio-echo', version: '1.0.0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: [{ name: 'echo', description: 'echo args', inputSchema: { type: 'object' } }] };
    } else if (msg.method === 'tools/call') {
      result = { content: [{ type: 'text', text: JSON.stringify(msg.params.arguments) }] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  }
});
`;

test('MCP client（stdio）：initialize / tools list / tools call', async () => {
  const client = new McpClient({
    type: 'stdio',
    command: process.execPath,
    args: ['-e', STDIO_ECHO_SCRIPT],
  });
  await client.connect();
  assert.equal(client.serverInfo.name, 'stdio-echo');

  const tools = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'echo');

  const echoed = await client.callTool('echo', { hello: 'mcp', n: 3 });
  assert.deepEqual(echoed, { hello: 'mcp', n: 3 });

  await client.close();
});

// ============================================================
// 5. bridge search → preview → create 全链路（走 mock）
// ============================================================
test('bridge：searchMerchant → preview → createOrder 全链路（真实下单核心链路）', async () => {
  process.env.MOCK_TOKEN = 'test-token';
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  const cfgPath = writeTempConfig(`http://127.0.0.1:${port}/mcp`);
  const bridge = createMcpBridge({ configPath: cfgPath, baseUrl: 'http://127.0.0.1:8800' });
  try {
    // --- search：投影为 CatalogEntry 兼容形状 ---
    const entries = await bridge.searchMerchant('mock-coffee', '来杯生椰拿铁');
    assert.ok(entries.length >= 1, '应有商品候选');
    const first = entries[0];
    assert.equal(first.kind, 'CatalogEntry');
    assert.equal(first.object_type, 'ocp.commerce.product');
    assert.equal(first.provider_id, 'mock-coffee');
    assert.match(first.entry_id, /^entry_mcp_mock-coffee_/);
    assert.equal(first.attributes.brand, 'Mock咖啡');
    assert.equal(first.attributes.category, '咖啡');
    assert.ok(first.attributes.price.amount > 0, 'price 有值时应填入 attributes');
    assert.ok(first.mcpRef.deptId);
    assert.equal(first.mcpRef.merchantId, 'mock-coffee');
    assert.ok(first.mcpRef.skuCode);
    // 协议纪律：binding 由 resolve/agent 层生成并指向 /ocp/actions/mcp/buy_now
    assert.equal(first.action_binding.action_id, 'buy_now');
    assert.equal(first.action_binding.url, 'http://127.0.0.1:8800/ocp/actions/mcp/buy_now');
    assert.ok(first.action_binding.input_schema.endsWith('/schemas/mcp-buy-now-request.json'));

    // --- preview：真实价格 ---
    const pv = await bridge.preview('mock-coffee', first.mcpRef, 2);
    assert.equal(pv.total_amount, first.attributes.price.amount * 2);

    // --- createOrder（mcpRef 直传）---
    const order = await bridge.createOrder('mock-coffee', first.mcpRef, 2, { remark: '少冰' });
    assert.ok(order.order_id.startsWith('mock-ord-'));
    assert.equal(order.status, 'confirmed');
    assert.equal(order.mode, 'mcp');
    assert.equal(order.total_amount, first.attributes.price.amount * 2);
    assert.equal(order.merchant.id, 'mock-coffee');
    assert.equal(order.merchant.name, 'Mock咖啡');
    assert.ok(order.items[0].quantity === 2);
    assert.ok(order.raw);

    // --- createOrder（entry_id 引用，走 entryIndex）---
    const order2 = await bridge.createOrder('mock-coffee', first.entry_id, 1);
    assert.ok(order2.order_id.startsWith('mock-ord-'));
    assert.equal(order2.total_amount, first.attributes.price.amount);

    // --- cancel / query 透传 ---
    const cancelled = await bridge.cancelOrder('mock-coffee', order.order_id);
    assert.equal(cancelled.order_id, order.order_id);
    const detail = await bridge.queryOrder('mock-coffee', order.order_id);
    assert.ok(detail.detail.orderInfo);

    // --- 错误分支 ---
    await assert.rejects(() => bridge.searchMerchant('nope', 'x'), /未知商家/);
    await assert.rejects(
      () => bridge.createOrder('mock-coffee', { productId: 9999, skuCode: 'X', deptId: 101 }, 1),
      /product not found/,
    );
  } finally {
    delete process.env.MOCK_TOKEN;
    await mock.close();
  }
});

test('bridge：token 缺失时明确报错；运行时 setToken 后可用；status 反映 token 状态', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  const cfgPath = writeTempConfig(`http://127.0.0.1:${port}/mcp`, { tokenEnv: 'MOCK_TOKEN_MISSING' });
  const bridge = createMcpBridge({ configPath: cfgPath, baseUrl: 'http://127.0.0.1:8800' });
  try {
    assert.equal(bridge.isMerchantAvailable('mock-coffee'), false);
    const st0 = await bridge.status();
    assert.equal(st0[0].token_present, false);
    assert.equal(st0[0].connected, false);

    await assert.rejects(
      () => bridge.searchMerchant('mock-coffee', '拿铁'),
      (err) => err.code === 'token_missing' && /Token/.test(err.message),
    );

    bridge.setToken('mock-coffee', 'test-token');
    assert.equal(bridge.isMerchantAvailable('mock-coffee'), true);
    const entries = await bridge.searchMerchant('mock-coffee', '拿铁');
    assert.ok(entries.length >= 1);

    const st1 = await bridge.status();
    assert.equal(st1[0].token_present, true);
    assert.equal(st1[0].connected, true);
    assert.ok(st1[0].tool_count >= 6);

    // 未知商家 setToken → 404
    assert.throws(() => bridge.setToken('nope', 'x'), (err) => err.status === 404);
  } finally {
    await mock.close();
  }
});

// ============================================================
// 6/7. server 路由：/api/mcp/token、/api/mcp/status、/ocp/actions/mcp/buy_now、agent confirm
// ============================================================
test('server：MCP 域路由 + token 设置 + buy_now confirm 校验 + agent confirm 全链路', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  // 用临时配置替换主 server 的商家注册：id 仍为 my-coffee（NLU 咖啡词表命中），但指向 mock
  const cfgPath = writeTempConfig(`http://127.0.0.1:${port}/mcp`, {
    merchantId: 'my-coffee',
    tokenEnv: 'MOCK_E2E_TOKEN',
  });
  process.env.OCP_MCP_CONFIG = cfgPath;
  const { base, close } = await startTestServer();
  try {
    // --- status：未配置 token ---
    const st = await get(base, '/api/mcp/status');
    assert.equal(st.status, 200);
    assert.equal(st.body.merchants[0].id, 'my-coffee');
    assert.equal(st.body.merchants[0].token_present, false);

    // --- 未配置 token 时：merchant_unconfigured 明确提示，不报错 ---
    const s1 = await post(base, '/api/agent', { text: '来杯瑞幸生椰拿铁' });
    assert.equal(s1.status, 200);
    assert.equal(s1.body.merchant_unconfigured, true);
    assert.equal(s1.body.candidates.length, 0);
    assert.ok(/Token/.test(s1.body.message));

    // --- 运行时设置 token ---
    const tk = await post(base, '/api/mcp/token', { merchant_id: 'my-coffee', token: 'test-token' });
    assert.equal(tk.status, 200);
    assert.equal(tk.body.ok, true);
    const st2 = await get(base, '/api/mcp/status');
    assert.equal(st2.body.merchants[0].token_present, true);

    // --- 商家检索：返回 MCP 候选（含 mcpRef）---
    const s2 = await post(base, '/api/agent', { text: '来杯瑞幸生椰拿铁' });
    assert.equal(s2.status, 200);
    assert.equal(s2.body.source, 'mcp');
    assert.equal(s2.body.merchant.id, 'my-coffee');
    assert.ok(s2.body.candidates.length >= 1);
    const cand = s2.body.candidates[0];
    assert.ok(cand.mcpRef);
    assert.equal(cand.action_binding.label, '真实下单（商家MCP）');
    assert.ok(s2.body.recommended_entry_id);

    // --- buy_now：无 confirm → 400（会花真钱的动作必须显式确认）---
    const b1 = await post(base, '/ocp/actions/mcp/buy_now', {
      merchant_id: 'my-coffee',
      mcpRef: cand.mcpRef,
      quantity: 1,
    });
    assert.equal(b1.status, 400);
    assert.equal(b1.body.error.code, 'confirm_required');

    // --- buy_now：confirm:true → 真实下单成功 ---
    const b2 = await post(base, '/ocp/actions/mcp/buy_now', {
      merchant_id: 'my-coffee',
      mcpRef: cand.mcpRef,
      quantity: 1,
      confirm: true,
      remark: 'e2e',
    });
    assert.equal(b2.status, 200);
    assert.equal(b2.body.status, 'confirmed');
    assert.ok(b2.body.order_id);
    assert.equal(b2.body.merchant.id, 'my-coffee');

    // --- agent confirm（经 binding.url 的协议纪律路径）---
    const c1 = await post(base, '/api/agent/confirm', {
      entry_id: s2.body.recommended_entry_id,
      quantity: 1,
    });
    assert.equal(c1.status, 200);
    assert.equal(c1.body.mode, 'mcp');
    assert.ok(c1.body.order.order_id);
    assert.equal(c1.body.reference.kind, 'ResolvableReference');
    assert.equal(c1.body.reference.action_bindings[0].url, `${base}/ocp/actions/mcp/buy_now`);

    // --- 错误形状：未知商家 404 ---
    const b3 = await post(base, '/ocp/actions/mcp/buy_now', {
      merchant_id: 'nope',
      mcpRef: cand.mcpRef,
      quantity: 1,
      confirm: true,
    });
    assert.equal(b3.status, 404);
  } finally {
    delete process.env.OCP_MCP_CONFIG;
    await close();
    await mock.close();
  }
});

// ============================================================
// 8. NLU domain 路由
// ============================================================
test('NLU：商家 domain 路由（词表命中 / 长词优先 / 未命中）', () => {
  assert.equal(parseIntent('来杯瑞幸生椰拿铁').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('一杯奶茶').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('麦当劳麦乐鸡套餐').merchant.merchant_id, 'mcd-mcp');
  assert.equal(parseIntent('来个汉堡').merchant.merchant_id, 'mcd-mcp');
  // 长词优先：「麦咖啡」命中麦当劳（3 字）而非瑞幸「咖啡」（2 字）
  assert.equal(parseIntent('来份麦咖啡').merchant.merchant_id, 'mcd-mcp');
  // 未命中 → 走现有内存目录流程
  assert.equal(parseIntent('1000元以内的无线降噪耳机').merchant, null);
  assert.equal(detectMerchant('随便逛逛'), null);
});

// ============================================================
// 9. MCP_BUY_NOW_SCHEMA 形状
// ============================================================
test('MCP_BUY_NOW_SCHEMA：confirm 为必填字段', () => {
  assert.equal(MCP_BUY_NOW_SCHEMA.$id, 'mcp-buy-now-request.json');
  assert.ok(MCP_BUY_NOW_SCHEMA.required.includes('merchant_id'));
  assert.ok(MCP_BUY_NOW_SCHEMA.required.includes('confirm'));
  assert.equal(MCP_BUY_NOW_SCHEMA.properties.confirm.type, 'boolean');
});

// ============================================================
// 10. 传输层健壮化：gzip 解压 + chunk 边界多字节截断回归（BugFix）
// ============================================================
test('MCP client：gzip 压缩响应正确解压且中文无乱码（真实商家服务器默认压缩）', async () => {
  const mock = createRealShapeMerchantMcp();
  const port = await mock.listen();
  try {
    const client = new McpClient({
      type: 'streamablehttp',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: 'Bearer test-token' },
      extraHeaders: { 'x-mock-gzip': '1' },
    });
    await client.connect();
    assert.ok(client.sessionId);

    const shops = await client.callTool('queryShopList', { longitude: 120.02, latitude: 30.27 });
    assert.equal(shops.code, 0);
    assert.equal(shops.msg, 'success');
    // 中文门店名完整无乱码（content-encoding: gzip + Buffer 一次性 UTF-8 解码）
    assert.equal(shops.data[1].deptName, '阿里巴巴亲橙里店');
    assert.equal(shops.data[1].workStatus, '营业中');

    const products = await client.callTool('searchProductForMcp', { deptId: 387185, query: '生椰拿铁' });
    assert.equal(products.data[0].productName, '生椰拿铁（原创）');
    assert.equal(products.data[0].estimatePrice, 10.5);
    await client.close();
  } finally {
    await mock.close();
  }
});

test('decodeHttpBody：Buffer 聚合一次性解码（chunk 边界回归）+ gzip/deflate/br 解压 + 误标回退', () => {
  const obj = { message: '访问受限：Token 无效或已过期（中文完整性校验）✅' };
  const text = JSON.stringify(obj);
  const raw = Buffer.from(text, 'utf8');

  // 按非对齐字节拆块再聚合：一次性 toString('utf8') 必须无乱码
  const chunks = [];
  for (let i = 0; i < raw.length; i += 3) chunks.push(raw.subarray(i, i + 3));
  assert.equal(Buffer.concat(chunks).toString('utf8'), text);
  assert.deepEqual(JSON.parse(decodeHttpBody(Buffer.concat(chunks), null).toString('utf8')), obj);

  // gzip / deflate / deflate-raw 误标 / br 四种编码
  assert.equal(decodeHttpBody(zlib.gzipSync(raw), 'gzip').toString('utf8'), text);
  assert.equal(decodeHttpBody(zlib.deflateSync(raw), 'deflate').toString('utf8'), text);
  assert.equal(decodeHttpBody(zlib.deflateRawSync(raw), 'deflate').toString('utf8'), text);
  assert.equal(decodeHttpBody(zlib.brotliCompressSync(raw), 'br').toString('utf8'), text);

  // 误标压缩（实际未压缩）→ 回退原始 Buffer
  assert.equal(decodeHttpBody(raw, 'gzip').toString('utf8'), text);

  // 回归对比：在多字节字符中间切割并逐 chunk 解码会产生乱码，证明聚合解码的必要性
  // （'{"message":"' 共 12 个 ASCII 字节，第 13 字节落在「访」字的 UTF-8 三字节中间）
  const midMultibyte = raw.subarray(0, 13).toString('utf8') + raw.subarray(13).toString('utf8');
  assert.notEqual(midMultibyte, text);
});

// ============================================================
// 11. 真实商家返回形状映射（BugFix：estimatePrice→price、门店优选、coupon 透传）
// ============================================================
test('bridge：真实形状映射（estimatePrice→price / 门店优选营业中 / spec / image_url / couponCodeList 透传 / 业务码校验）', async () => {
  process.env.MOCK_TOKEN = 'test-token';
  const mock = createRealShapeMerchantMcp();
  const port = await mock.listen();
  const cfgPath = writeTempConfig(`http://127.0.0.1:${port}/mcp`);
  const bridge = createMcpBridge({ configPath: cfgPath, baseUrl: 'http://127.0.0.1:8800' });
  try {
    // --- search：字段映射对齐真实商家真值 ---
    const entries = await bridge.searchMerchant('mock-coffee', '生椰拿铁');
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.title, '生椰拿铁（原创）');
    assert.equal(e.attributes.price.amount, 10.5); // estimatePrice（折后价），非 initialPrice 20
    assert.equal(e.attributes.price.currency, 'CNY');
    assert.equal(e.attributes.image_url, 'https://img.example.com/coconut-latte.png');
    assert.equal(e.attributes.spec, '大杯/冰'); // productAttrs 压缩简述（selected 子属性）
    assert.deepEqual(e.attributes.tags, ['新品']);
    // 门店优选：跳过距离更近的打烊店（workStatus=休息中），选营业中门店
    assert.equal(e.mcpRef.deptId, 387185);
    assert.equal(e.mcpRef.deptName, '阿里巴巴亲橙里店');
    assert.equal(e.mcpRef.productId, 1262);
    assert.equal(e.mcpRef.skuCode, 'SP2077-01134');
    assert.equal(e.mcpRef.productName, '生椰拿铁（原创）');
    assert.equal(e.mcpRef.merchantId, 'mock-coffee');

    // --- preview：data.discountPrice → total_amount；shopInfo.deptName → shop_name ---
    const pv = await bridge.preview('mock-coffee', e.mcpRef, 2);
    assert.equal(pv.total_amount, 21); // 10.5 × 2
    assert.equal(pv.shop_name, '阿里巴巴亲橙里店');

    // --- createOrder：couponCodeList 原样透传 + shopInfo 回执 ---
    const order = await bridge.createOrder('mock-coffee', e.mcpRef, 2, { remark: '少冰' });
    assert.ok(order.order_id.startsWith('real-ord-'));
    assert.equal(order.status, 'confirmed');
    assert.equal(order.total_amount, 21);
    assert.equal(order.merchant.dept_name, '阿里巴巴亲橙里店');
    assert.deepEqual(mock.lastCreateArgs.couponCodeList, ['SY120231970779897049']);
    assert.equal(mock.lastCreateArgs.remark, '少冰');
    assert.deepEqual(mock.lastCreateArgs.productList, [
      { productId: 1262, skuCode: 'SP2077-01134', amount: 2 },
    ]);

    // --- 业务码校验：code:1 → 明确抛错并带 msg ---
    const mock2 = createRealShapeMerchantMcp({ bizError: true });
    const port2 = await mock2.listen();
    try {
      const cfg2 = writeTempConfig(`http://127.0.0.1:${port2}/mcp`);
      const bridge2 = createMcpBridge({ configPath: cfg2, baseUrl: 'http://127.0.0.1:8800' });
      await assert.rejects(
        () => bridge2.searchMerchant('mock-coffee', '生椰拿铁'),
        /商品检索服务暂不可用/,
      );
    } finally {
      await mock2.close();
    }
  } finally {
    delete process.env.MOCK_TOKEN;
    await mock.close();
  }
});

// ============================================================
// 12. token 设置即验证（BugFix：保存后立即真连一次）
// ============================================================
test('server：/api/mcp/token 设置即验证（401 返回「Token 无效或已过期」；成功返回 connected+tool_count）', async () => {
  const mock = createMockMerchantMcp();
  const port = await mock.listen();
  const cfgPath = writeTempConfig(`http://127.0.0.1:${port}/mcp`, { tokenEnv: 'VERIFY_TOKEN' });
  process.env.OCP_MCP_CONFIG = cfgPath;
  const { base, close } = await startTestServer();
  try {
    // 无效 token：验证失败 → 400 + unauthorized + 明确提示
    const bad = await post(base, '/api/mcp/token', { merchant_id: 'mock-coffee', token: 'wrong-token' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'unauthorized');
    assert.ok(/Token 无效或已过期/.test(bad.body.error.message));

    // 失败后 status 应为未连接（缓存的真实连接状态）
    const st0 = await get(base, '/api/mcp/status');
    assert.equal(st0.body.merchants[0].connected, false);

    // 有效 token：验证成功 → connected:true + tool_count
    const good = await post(base, '/api/mcp/token', { merchant_id: 'mock-coffee', token: 'test-token' });
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.connected, true);
    assert.ok(good.body.tool_count >= 6);

    // 验证成功后 status 反映真实连接
    const st1 = await get(base, '/api/mcp/status');
    assert.equal(st1.body.merchants[0].token_present, true);
    assert.equal(st1.body.merchants[0].connected, true);
  } finally {
    delete process.env.OCP_MCP_CONFIG;
    await close();
    await mock.close();
  }
});

// ============================================================
// 13. NLU 词表补充（BugFix：浓缩/Dirty/丝绒拿铁/橙C/柚C + 麦麦/板烧鸡腿/1+1）
// ============================================================
test('NLU：新增词表命中（饮品补词 + 麦当劳补词）', () => {
  // 瑞幸补充词
  assert.equal(parseIntent('一杯丝绒拿铁').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('来份浓缩').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('dirty 要冰的').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('点一杯 Dirty').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('橙C 美式').merchant.merchant_id, 'my-coffee');
  assert.equal(parseIntent('柚C 气泡茶').merchant.merchant_id, 'my-coffee');
  // 麦当劳补充词
  assert.equal(parseIntent('麦当劳麦麦鸡腿堡').merchant.merchant_id, 'mcd-mcp');
  assert.equal(parseIntent('板烧鸡腿堡').merchant.merchant_id, 'mcd-mcp');
  assert.equal(parseIntent('点个1+1套餐').merchant.merchant_id, 'mcd-mcp');
  // 长词优先不回归：「麦咖啡」仍路由麦当劳
  assert.equal(parseIntent('来份麦咖啡').merchant.merchant_id, 'mcd-mcp');
  // 未命中仍走本地目录
  assert.equal(detectMerchant('随便逛逛'), null);
});
