/**
 * 一次性 e2e 脚本（不保留在仓库测试中）：
 * 1. 启动 mock 商家 MCP（streamable HTTP）
 * 2. 启动主 server（OCP_MCP_CONFIG 指向 mock）
 * 3. curl 式走通：/api/mcp/status → /api/mcp/token → /api/agent（search）→ /api/agent/confirm（order）
 * 4. 对真实商家 gwmcp.lkcoffee.com 做一次无 token 连通性验证（预期 401）
 * 5. 关闭全部进程
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMockMerchantMcp } = require('../test/fixtures/mock-merchant-mcp');
const { createServer } = require('../src/server');

async function main() {
  // 1. mock 商家
  const mock = createMockMerchantMcp({ token: 'e2e-token' });
  const mockPort = await mock.listen();
  console.log(`[e2e] mock merchant MCP listening on 127.0.0.1:${mockPort}`);

  // 2. 主 server
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-e2e-'));
  const cfgPath = path.join(dir, 'mcp.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    merchants: [{
      id: 'my-coffee', name: 'Mock瑞幸', type: 'streamablehttp',
      url: `http://127.0.0.1:${mockPort}/mcp`, tokenEnv: 'E2E_TOKEN',
      domains: ['咖啡', '奶茶', '饮品'],
      defaultLocation: { longitude: 120.026221, latitude: 30.279212 },
    }],
  }));
  process.env.OCP_MCP_CONFIG = cfgPath;
  const { server, port } = await createServer(0);
  const base = `http://127.0.0.1:${port}`;
  console.log(`[e2e] main server listening on ${base}`);

  const post = async (p, body) => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const get = async (p) => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, body: await res.json() };
  };

  // 3. search → confirm → order
  console.log('\n=== GET /api/mcp/status ===');
  console.log(JSON.stringify(await get('/api/mcp/status'), null, 2));

  console.log('\n=== POST /api/mcp/token ===');
  console.log(JSON.stringify(await post('/api/mcp/token', { merchant_id: 'my-coffee', token: 'e2e-token' })));

  console.log('\n=== POST /api/agent {text:"来杯瑞幸生椰拿铁 买2杯"}（search）===');
  const search = await post('/api/agent', { text: '来杯瑞幸生椰拿铁 买2杯' });
  console.log(JSON.stringify(search.body, null, 2));

  console.log('\n=== POST /api/agent/confirm（order）===');
  const confirm = await post('/api/agent/confirm', {
    entry_id: search.body.recommended_entry_id,
    quantity: 2,
  });
  console.log(JSON.stringify(confirm.body, null, 2));

  console.log('\n=== POST /ocp/actions/mcp/buy_now 无 confirm（预期 400）===');
  const noConfirm = await post('/ocp/actions/mcp/buy_now', {
    merchant_id: 'my-coffee', mcpRef: search.body.candidates[0].mcpRef, quantity: 1,
  });
  console.log(noConfirm.status, JSON.stringify(noConfirm.body));

  // 4. 真实商家一次连通性验证（无 token，预期 401）
  console.log('\n=== 真实商家连通性验证（gwmcp.lkcoffee.com，无 token，预期 401）===');
  try {
    const real = await fetch('https://gwmcp.lkcoffee.com/order/user/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'koudou-ocp-agent', version: '1.0.0' } },
      }),
    });
    const text = await real.text();
    console.log(`HTTP ${real.status}（${real.status === 401 ? '401 = 预期结果，token 无效/缺失' : 'unexpected'}）: ${text.slice(0, 200)}`);
  } catch (err) {
    console.log(`网络不可达（跳过）：${err.message}`);
  }

  // 5. 关闭
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n[e2e] all servers closed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
