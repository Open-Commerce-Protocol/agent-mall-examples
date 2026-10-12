/**
 * Mock 商家 MCP 服务端（streamable HTTP 传输，仅测试用）。
 *
 * 实现 JSON-RPC 2.0 最小协议面：
 * - initialize → 返回 serverInfo，并通过 mcp-session-id 响应头下发会话 id
 * - notifications/initialized 等无 id 通知 → 202 空响应体
 * - tools/list → 6 个工具（queryShopList / searchProductForMcp / previewOrder /
 *   createOrder / queryOrderDetailInfo / cancelOrder）
 * - tools/call → 内存实现各工具（tools/call 结果放在 content[0].text 的 JSON 字符串中）
 *
 * 鉴权：Authorization 必须为 `Bearer <token>`，否则 401。
 * 会话校验：initialize 之后的请求必须回传 mcp-session-id，否则 400。
 * SSE 模式：请求带 `x-mock-sse: 1` 头时，响应以 text/event-stream 格式返回（用于客户端 SSE 解析测试）。
 */
const http = require('node:http');

const SESSION_ID = 'mock-session-001';

/**
 * 创建 mock 商家 MCP 服务端。
 * @param {{token?: string, port?: number}} [options]
 * @returns {{listen: Function, close: Function, orders: object[], shops: object[], products: object[]}}
 */
function createMockMerchantMcp({ token = 'test-token', port = 0 } = {}) {
  const shops = [
    { deptId: 101, deptName: '杭州西湖店' },
    { deptId: 102, deptName: '杭州滨江店' },
  ];
  const products = [
    { productId: 5001, skuCode: 'SKU-5001', name: '生椰拿铁', price: 15.9 },
    { productId: 5002, skuCode: 'SKU-5002', name: '厚乳拿铁', price: 18.5 },
  ];
  const orders = [];

  /** 工具清单 */
  function toolsList() {
    const def = (name, description) => ({ name, description, inputSchema: { type: 'object' } });
    return {
      tools: [
        def('queryShopList', '查询附近门店列表（含 deptId）'),
        def('searchProductForMcp', '按自然语言匹配商品推荐（含 productId/skuCode）'),
        def('previewOrder', '订单预览（真实价格、优惠券）'),
        def('createOrder', '创建真实订单（返回 orderId）'),
        def('queryOrderDetailInfo', '查询订单详情'),
        def('cancelOrder', '取消订单'),
      ],
    };
  }

  /** 把业务对象包装为 tools/call 标准返回（content[0].text 为 JSON 字符串） */
  function textResult(obj) {
    return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
  }

  /** 依据入参里的第一个 productList 项找到商品 */
  function findProductFromArgs(args) {
    const item = (args.productList ?? [])[0] ?? {};
    return products.find((p) => String(p.productId) === String(item.productId)) ?? null;
  }

  /** tools/call 分发 */
  function handleToolCall(params) {
    const name = params.name;
    const args = params.arguments ?? {};
    switch (name) {
      case 'queryShopList':
        return textResult({ shopList: shops });
      case 'searchProductForMcp': {
        // 简单模拟：命中「厚乳」只返回厚乳拿铁，否则全量返回
        const hit = /厚乳/.test(String(args.query ?? ''))
          ? products.filter((p) => p.name.includes('厚乳'))
          : products;
        return textResult({ recommendList: hit });
      }
      case 'previewOrder': {
        const qty = Number((args.productList ?? [])[0]?.amount ?? 1);
        const p = findProductFromArgs(args);
        if (!p) return { isError: true, content: [{ type: 'text', text: 'product not found' }] };
        return textResult({
          orderPreview: {
            totalAmount: Number((p.price * qty).toFixed(2)),
            discountAmount: 0,
            couponCodeList: ['MOCK-COUPON-1'],
            productList: args.productList,
          },
        });
      }
      case 'createOrder': {
        const qty = Number((args.productList ?? [])[0]?.amount ?? 1);
        const p = findProductFromArgs(args);
        if (!p) return { isError: true, content: [{ type: 'text', text: 'product not found' }] };
        const order = {
          orderId: `mock-ord-${1000 + orders.length}`,
          status: 'CREATED',
          totalAmount: Number((p.price * qty).toFixed(2)),
          deptId: args.deptId ?? null,
          remark: args.remark ?? null,
        };
        orders.push(order);
        return textResult({ orderInfo: order });
      }
      case 'queryOrderDetailInfo':
        return textResult({ orderInfo: orders.find((o) => o.orderId === args.orderId) ?? null });
      case 'cancelOrder':
        return textResult({ result: true });
      default:
        return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] };
    }
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      // 鉴权：Bearer token 校验
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json' }));
        return;
      }
      // 通知（无 id）：202 空响应体
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      // 会话校验：initialize 之后的请求必须回传 mcp-session-id
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== SESSION_ID) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: 'missing or invalid mcp-session-id' },
        }));
        return;
      }
      let result;
      if (msg.method === 'initialize') {
        result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-merchant-mcp', version: '1.0.0' },
        };
      } else if (msg.method === 'tools/list') {
        result = toolsList();
      } else if (msg.method === 'tools/call') {
        result = handleToolCall(msg.params ?? {});
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'method not found' },
        }));
        return;
      }

      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (req.headers['x-mock-sse'] === '1') {
        // SSE 模式：text/event-stream + data: 行
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SESSION_ID });
        res.write(`event: message\ndata: ${payload}\n\n`);
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION_ID });
        res.end(payload);
      }
    });
  });

  return {
    shops,
    products,
    orders,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { createMockMerchantMcp, SESSION_ID };
