/**
 * 真实商家返回形状的 mock MCP 服务端（streamable HTTP，仅测试用）。
 *
 * 按主理人实测 gwmcp.lkcoffee.com 业务层真值构造（BugFix 回归 fixture）：
 * - 业务层 JSON 带 code / msg / data / success 包裹；
 * - tools/call 结果放在 MCP 信封 content[0].text（业务 JSON 的字符串形式）；
 * - queryShopList 返回含 workStatus / distance（用于门店优选：跳过打烊店）；
 * - searchProductForMcp 返回 productName / skuCode / pictureUrl / productAttrs /
 *   initialPrice / estimatePrice（用于字段映射断言）；
 * - previewOrder 返回 discountPrice / shopInfo / productInfoList / couponCodeList；
 * - createOrder 记录入参（用于 couponCodeList 透传断言）。
 *
 * 可选能力：
 * - 请求头 `x-mock-gzip: 1` → 响应以 content-encoding: gzip 返回（客户端解压测试）；
 * - 请求头 `x-mock-sse: 1` → 响应以 text/event-stream 返回；
 * - bizError: true → searchProductForMcp 返回 code:1 业务错误（业务码校验测试）。
 */
const http = require('node:http');
const zlib = require('node:zlib');

const SESSION_ID = 'real-shape-session';

/** 打烊但距离更近的门店（验证优选逻辑必须跳过它） */
const CLOSED_SHOP = {
  deptId: 888,
  deptName: '休息中的门店',
  address: '杭州市西湖区文一路 1 号',
  longitude: 120.026221,
  latitude: 30.279212,
  workTimeStart: '00:00',
  workTimeEnd: '08:00',
  distance: 100,
  workStatus: '休息中',
};

/** 营业中门店（距离更远但应被优选） */
const OPEN_SHOP = {
  deptId: 387185,
  deptName: '阿里巴巴亲橙里店',
  address: '杭州市余杭区文一西路 969 号亲橙里',
  longitude: 120.026221,
  latitude: 30.279212,
  workTimeStart: '07:00',
  workTimeEnd: '22:00',
  distance: 350,
  workStatus: '营业中',
};

/** 真实形状商品（生椰拿铁） */
const REAL_PRODUCT = {
  productId: 1262,
  productName: '生椰拿铁（原创）',
  skuCode: 'SP2077-01134',
  pictureUrl: 'https://img.example.com/coconut-latte.png',
  productAttrs: [
    {
      attributeId: 1,
      attributeName: '杯型',
      productSubAttrs: [
        { attributeId: 11, attributeName: '大杯', price: 20.0, selected: true, canSelected: true },
        { attributeId: 12, attributeName: '中杯', price: 18.0, selected: false, canSelected: true },
      ],
    },
    {
      attributeId: 2,
      attributeName: '温度',
      productSubAttrs: [
        { attributeId: 21, attributeName: '冰', selected: true, canSelected: true },
        { attributeId: 22, attributeName: '热', selected: false, canSelected: true },
      ],
    },
  ],
  tags: ['新品'],
  initialPrice: 20.0,
  estimatePrice: 10.5,
  fallback: false,
};

const UNIT_ESTIMATE = 10.5;
const UNIT_INITIAL = 20.0;

/**
 * 创建真实形状 mock 商家 MCP 服务端。
 * @param {{token?: string, port?: number, bizError?: boolean}} [options]
 * @returns {{listen: Function, close: Function, lastCreateArgs: object|null}}
 */
function createRealShapeMerchantMcp({ token = 'test-token', port = 0, bizError = false } = {}) {
  const state = { lastCreateArgs: null };
  let orderSeq = 1;

  /** 工具清单 */
  function toolsList() {
    const def = (name, description) => ({ name, description, inputSchema: { type: 'object' } });
    return {
      tools: [
        def('queryShopList', '查询附近门店列表'),
        def('searchProductForMcp', '按自然语言匹配商品推荐'),
        def('previewOrder', '订单预览'),
        def('createOrder', '创建订单'),
        def('queryOrderDetailInfo', '查询订单详情'),
        def('cancelOrder', '取消订单'),
      ],
    };
  }

  /** 业务结果包装为 MCP 信封（content[0].text 为业务 JSON 字符串） */
  function envelope(business) {
    return { content: [{ type: 'text', text: JSON.stringify(business) }] };
  }

  /** tools/call 分发 */
  function handleToolCall(params) {
    const name = params.name;
    const args = params.arguments ?? {};
    switch (name) {
      case 'queryShopList':
        return envelope({
          code: 0,
          msg: 'success',
          data: [CLOSED_SHOP, OPEN_SHOP],
          success: true,
        });
      case 'searchProductForMcp':
        if (bizError) {
          return envelope({ code: 1, msg: '商品检索服务暂不可用', success: false });
        }
        return envelope({ code: 0, msg: 'success', data: [REAL_PRODUCT], success: true });
      case 'previewOrder': {
        const qty = Number((args.productList ?? [])[0]?.amount ?? 1);
        return envelope({
          code: 0,
          msg: 'success',
          data: {
            aboutTime: '预计 10 分钟完成',
            discountPrice: Number((UNIT_ESTIMATE * qty).toFixed(2)),
            shopInfo: { ...OPEN_SHOP },
            productInfoList: [
              {
                productId: REAL_PRODUCT.productId,
                skuCode: REAL_PRODUCT.skuCode,
                name: REAL_PRODUCT.productName,
                amount: qty,
                additionDesc: '大杯/冰',
                initPrice: UNIT_INITIAL,
                estimatePrice: UNIT_ESTIMATE,
                estimateTotalPrice: Number((UNIT_ESTIMATE * qty).toFixed(2)),
              },
            ],
            couponCodeList: ['SY120231970779897049'],
            privilegeMoney: Number((UNIT_INITIAL * qty - UNIT_ESTIMATE * qty).toFixed(2)),
            totalInitialPrice: Number((UNIT_INITIAL * qty).toFixed(2)),
          },
          success: true,
        });
      }
      case 'createOrder': {
        state.lastCreateArgs = args;
        const qty = Number((args.productList ?? [])[0]?.amount ?? 1);
        return envelope({
          code: 0,
          msg: 'success',
          data: {
            orderId: `real-ord-${1000 + orderSeq++}`,
            status: 'CREATED',
            discountPrice: Number((UNIT_ESTIMATE * qty).toFixed(2)),
            couponCodeList: Array.isArray(args.couponCodeList) ? args.couponCodeList : [],
          },
          success: true,
        });
      }
      case 'queryOrderDetailInfo':
        return envelope({ code: 0, msg: 'success', data: { orderId: args.orderId ?? null }, success: true });
      case 'cancelOrder':
        return envelope({ code: 0, msg: 'success', data: { result: true }, success: true });
      default:
        return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] };
    }
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.headers.authorization !== `Bearer ${token}`) {
        // 与真实商家一致：401 响应体含中文（用于验证无乱码）
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 401, message: '访问受限：Token 无效或已过期' }));
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
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
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
          serverInfo: { name: 'real-shape-merchant-mcp', version: '1.0.0' },
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
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SESSION_ID });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }
      if (req.headers['x-mock-gzip'] === '1') {
        // gzip 压缩响应（真实商家服务器默认压缩）
        const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'));
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'mcp-session-id': SESSION_ID,
        });
        res.end(gz);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION_ID });
      res.end(payload);
    });
  });

  return {
    shops: [CLOSED_SHOP, OPEN_SHOP],
    product: REAL_PRODUCT,
    get lastCreateArgs() {
      return state.lastCreateArgs;
    },
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { createRealShapeMerchantMcp, SESSION_ID };
