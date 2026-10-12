/**
 * node:test 测试套件：
 * 1. 五个 OCP 端点的 kind 形状断言
 * 2. query 命中与预算过滤
 * 3. resolve 含 buy_now action binding
 * 4. 下单幂等（同 key 两次同一 order_id）
 * 5. 库存不足拒绝
 * 6. e2e：「1000元以内的无线降噪耳机」→ query → resolve → order 全链路
 * 7. NLU 单测（预算 / 品牌 / 数量 / 品类）
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../src/server');
const { parseIntent } = require('../src/agent/nlu');

/** 动态端口启动 server，返回 { base, close } */
async function startTestServer() {
  const { server, port } = await createServer(0);
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** GET helper */
async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** POST JSON helper */
async function post(base, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ============================================================
// 1. OCP 五个读面端点形状
// ============================================================
test('OCP 五个读面端点返回正确的 kind 形状', async () => {
  const { base, close } = await startTestServer();
  try {
    const discovery = await get(base, '/.well-known/ocp-catalog');
    assert.equal(discovery.status, 200);
    assert.equal(discovery.body.kind, 'WellKnownCatalogDiscovery');
    assert.equal(discovery.body.ocp_version, '1.0');
    assert.ok(discovery.body.manifest_url.endsWith('/ocp/manifest'));
    assert.ok(discovery.body.query_url.endsWith('/ocp/query'));
    assert.ok(discovery.body.resolve_url.endsWith('/ocp/resolve'));
    assert.ok(discovery.body.health_url.endsWith('/ocp/health'));
    assert.ok(discovery.body.contracts_url.endsWith('/ocp/contracts'));

    const manifest = await get(base, '/ocp/manifest');
    assert.equal(manifest.body.kind, 'CatalogManifest');
    assert.equal(manifest.body.registry_visibility, 'public');
    assert.deepEqual(manifest.body.endpoints.query, {
      url: `${base}/ocp/query`,
      method: 'POST',
    });
    assert.equal(manifest.body.query_capabilities[0].query_packs[0].pack_id, 'ocp.query.keyword.v1');
    assert.deepEqual(manifest.body.query_capabilities[0].query_packs[0].query_modes, ['keyword']);
    assert.equal(manifest.body.query_capabilities[0].supports_explain, true);
    assert.equal(manifest.body.query_capabilities[0].supports_resolve, true);
    assert.deepEqual(manifest.body.object_contracts, []);

    const health = await get(base, '/ocp/health');
    assert.equal(health.body.kind, 'CatalogHealth');
    assert.equal(health.body.status, 'healthy');
    assert.equal(health.body.ready, true);
    assert.ok(health.body.checked_at);

    const contracts = await get(base, '/ocp/contracts');
    assert.equal(contracts.body.kind, 'ObjectContractList');
    assert.deepEqual(contracts.body.object_contracts, []);

    const queryRes = await post(base, '/ocp/query', { query: '耳机', limit: 5 });
    assert.equal(queryRes.body.kind, 'CatalogQueryResult');
    assert.match(queryRes.body.id, /^qry_/);
    assert.equal(queryRes.body.query_pack, 'ocp.query.keyword.v1');
    assert.equal(queryRes.body.query_mode, 'keyword');
    assert.equal(typeof queryRes.body.result_count, 'number');
    assert.deepEqual(queryRes.body.page, { limit: 5, offset: 0, has_more: false });
    const first = queryRes.body.entries[0];
    assert.equal(first.entry.kind, 'CatalogEntry');
    assert.equal(first.entry.object_type, 'ocp.commerce.product');
    assert.ok(first.entry.entry_id);
    assert.ok(first.entry.attributes.price.currency === 'CNY');
    assert.ok(['in_stock', 'low_stock', 'out_of_stock'].includes(
      first.entry.attributes.inventory.availability_status,
    ));
    assert.ok(Array.isArray(first.explain) && first.explain.length > 0);
  } finally {
    await close();
  }
});

test('未知路由返回 404 与统一错误形状', async () => {
  const { base, close } = await startTestServer();
  try {
    const res = await get(base, '/no/such/route');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
    assert.ok(res.body.error.message);
  } finally {
    await close();
  }
});

// ============================================================
// 2. query 命中与预算过滤（Agent 编排层）
// ============================================================
test('Agent：query 命中关键词且预算过滤正确', async () => {
  const { base, close } = await startTestServer();
  try {
    // 耳机品类，预算 ≤1000：应排除 2899 的索尼
    const res = await post(base, '/api/agent', { text: '1000元以内的无线降噪耳机' });
    assert.equal(res.status, 200);
    assert.equal(res.body.intent.category, '耳机');
    assert.equal(res.body.intent.budget_max, 1000);
    assert.ok(res.body.candidates.length > 0, '应有候选');
    for (const entry of res.body.candidates) {
      assert.equal(entry.attributes.category, '耳机');
      assert.ok(entry.attributes.price.amount <= 1000, `价格 ${entry.attributes.price.amount} 应 ≤1000`);
      assert.notEqual(entry.attributes.inventory.availability_status, 'out_of_stock');
    }
    // 推荐位应有货且命中「降噪」
    assert.ok(res.body.recommended_entry_id);
    const rec = res.body.candidates.find((e) => e.entry_id === res.body.recommended_entry_id);
    assert.ok(rec, '推荐 id 应在候选中');
    assert.ok(/降噪/.test(`${rec.title}${rec.summary}`), '推荐商品应命中「降噪」关键词');
  } finally {
    await close();
  }
});

test('Agent：预算过滤过紧时返回空候选而不报错', async () => {
  const { base, close } = await startTestServer();
  try {
    const res = await post(base, '/api/agent', { text: '100元以内的索尼旗舰降噪耳机' });
    assert.equal(res.status, 200);
    // 100 元以内的索尼耳机不存在（严格品牌+品类过滤后为空是合法结果）
    if (res.body.candidates.length > 0) {
      for (const entry of res.body.candidates) {
        assert.ok(entry.attributes.price.amount <= 100);
      }
    }
  } finally {
    await close();
  }
});

// ============================================================
// 3. resolve 含 buy_now binding
// ============================================================
test('resolve 返回 ResolvableReference 且包含 buy_now API binding', async () => {
  const { base, close } = await startTestServer();
  try {
    const queryRes = await post(base, '/ocp/query', { query: '耳机' });
    const entryId = queryRes.body.entries[0].entry.entry_id;

    const res = await post(base, '/ocp/resolve', { entry_id: entryId });
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, 'ResolvableReference');
    assert.match(res.body.id, /^res_/);
    assert.equal(res.body.entry_id, entryId);
    assert.equal(res.body.object_type, 'ocp.commerce.product');
    assert.ok(res.body.freshness.resolved_at);
    assert.ok(res.body.expires_at);

    const buyNow = res.body.action_bindings.find((b) => b.action_id === 'buy_now');
    assert.ok(buyNow, '必须包含 buy_now binding');
    assert.equal(buyNow.action_type, 'api');
    assert.equal(buyNow.method, 'POST');
    assert.ok(buyNow.url.endsWith('/ocp/actions/buy_now'));
    assert.ok(buyNow.input_schema.endsWith('/schemas/buy-now-request.json'));

    const view = res.body.action_bindings.find((b) => b.action_id === 'view');
    assert.ok(view, '必须包含 view binding');
    assert.equal(view.action_type, 'url');
    assert.equal(view.entrypoint.method, 'GET');

    // resolve 未知 entry → 404
    const missing = await post(base, '/ocp/resolve', { entry_id: 'entry_xxx_none' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');
  } finally {
    await close();
  }
});

// ============================================================
// 4. 下单幂等
// ============================================================
test('buy_now 幂等：同一 idempotency_key 两次请求返回同一订单', async () => {
  const { base, close } = await startTestServer();
  try {
    const queryRes = await post(base, '/ocp/query', { query: '键盘' });
    const entryId = queryRes.body.entries[0].entry.entry_id;

    const payload = { entry_id: entryId, quantity: 2, idempotency_key: 'idem_test_001' };
    const first = await post(base, '/ocp/actions/buy_now', payload);
    const second = await post(base, '/ocp/actions/buy_now', payload);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.status, 'confirmed');
    assert.equal(first.body.order_id, second.body.order_id, '幂等键相同应返回同一订单');
    assert.equal(first.body.total_amount, first.body.unit_price.amount * 2);
    assert.equal(first.body.currency, 'CNY');

    // 订单查询端点
    const order = await get(base, `/ocp/orders/${first.body.order_id}`);
    assert.equal(order.status, 200);
    assert.equal(order.body.order_id, first.body.order_id);
  } finally {
    await close();
  }
});

test('buy_now 校验：缺 entry_id 400 / 未知 entry 404 / 非法数量 400', async () => {
  const { base, close } = await startTestServer();
  try {
    const noEntry = await post(base, '/ocp/actions/buy_now', { quantity: 1 });
    assert.equal(noEntry.status, 400);
    assert.equal(noEntry.body.error.code, 'bad_request');

    const unknown = await post(base, '/ocp/actions/buy_now', { entry_id: 'entry_xxx_none' });
    assert.equal(unknown.status, 404);

    const badQty = await post(base, '/ocp/actions/buy_now', { entry_id: 'entry_xxx', quantity: 0 });
    assert.equal(badQty.status, 400);
  } finally {
    await close();
  }
});

// ============================================================
// 5. 库存不足拒绝
// ============================================================
test('buy_now 对缺货商品（out_of_stock）拒绝下单', async () => {
  const { base, close } = await startTestServer();
  try {
    // 找到缺货商品：Stanley 保温水壶
    const queryRes = await post(base, '/ocp/query', { query: 'Stanley' });
    assert.ok(queryRes.body.result_count > 0, '应能查到 Stanley 商品');
    const oosEntry = queryRes.body.entries[0].entry;
    assert.equal(oosEntry.attributes.inventory.availability_status, 'out_of_stock');

    const res = await post(base, '/ocp/actions/buy_now', {
      entry_id: oosEntry.entry_id,
      quantity: 1,
      idempotency_key: 'idem_oos_001',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
    assert.match(res.body.error.message, /缺货|out_of_stock/);
  } finally {
    await close();
  }
});

// ============================================================
// 6. e2e：自然语言 → query → resolve → order 全链路（协议纪律）
// ============================================================
test('e2e：「1000元以内的无线降噪耳机」全链路下单成功', async () => {
  const { base, close } = await startTestServer();
  try {
    // 第一步：Agent 检索（/api/agent 内部走 /ocp/query）
    const search = await post(base, '/api/agent', { text: '1000元以内的无线降噪耳机' });
    assert.equal(search.status, 200);
    assert.ok(search.body.recommended_entry_id, '应有推荐候选');

    // 第二步：confirm（内部走 /ocp/resolve → buy_now binding url）
    const confirm = await post(base, '/api/agent/confirm', {
      entry_id: search.body.recommended_entry_id,
      quantity: 1,
    });
    assert.equal(confirm.status, 200, `confirm 应成功：${JSON.stringify(confirm.body)}`);
    assert.equal(confirm.body.order.status, 'confirmed');
    assert.equal(confirm.body.reference.kind, 'ResolvableReference');
    assert.equal(confirm.body.order.currency, 'CNY');
    assert.equal(confirm.body.order.quantity, 1);
    assert.ok(confirm.body.order.total_amount <= 1000);

    // 第三步：订单列表应包含该订单
    const list = await get(base, '/api/orders');
    assert.equal(list.status, 200);
    assert.ok(list.body.count >= 1);
    const ids = list.body.orders.map((o) => o.order_id);
    assert.ok(ids.includes(confirm.body.order.order_id), '订单应在列表中');
  } finally {
    await close();
  }
});

// ============================================================
// 7. NLU 单测
// ============================================================
test('NLU：预算解析（以内 / 预算 / 低于 / 区间）', () => {
  assert.deepEqual(
    { min: parseIntent('1000元以内的耳机').budget_min, max: parseIntent('1000元以内的耳机').budget_max },
    { min: null, max: 1000 },
  );
  assert.equal(parseIntent('预算500买个键盘').budget_max, 500);
  assert.equal(parseIntent('低于300的保温杯').budget_max, 300);
  const range = parseIntent('300-800元的蓝牙音箱');
  assert.equal(range.budget_min, 300);
  assert.equal(range.budget_max, 800);
  assert.equal(parseIntent('随便看看耳机').budget_max, null);
  assert.equal(parseIntent('随便看看耳机').budget_min, null);
});

test('NLU：品牌识别（白名单）', () => {
  assert.equal(parseIntent('索尼降噪耳机').brand, '索尼');
  assert.equal(parseIntent('Salomon 登山鞋').brand, 'Salomon');
  assert.equal(parseIntent('来个好用的键盘').brand, null);
});

test('NLU：数量解析（数字与中文数字）', () => {
  assert.equal(parseIntent('买2个保温水壶').quantity, 2);
  assert.equal(parseIntent('两副耳机').quantity, 2);
  assert.equal(parseIntent('来三台音箱').quantity, 3);
  assert.equal(parseIntent('买一个键盘').quantity, 1);
  assert.equal(parseIntent('耳机').quantity, 1);
});

test('NLU：品类识别与关键词拆分', () => {
  const intent = parseIntent('1000元以内的无线降噪耳机');
  assert.equal(intent.category, '耳机');
  assert.ok(intent.raw.includes('降噪'));
  assert.equal(parseIntent('露营用的帐篷').category, '帐篷');
  assert.equal(parseIntent('登山鞋').category, '鞋');
  assert.equal(parseIntent('机械键盘').category, '键盘');
  assert.equal(parseIntent('乳胶枕').category, '家居');
  assert.equal(parseIntent('今天天气不错').category, null);
});
