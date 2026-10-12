/**
 * HTTP 入口：路由分发（OCP 读面 + 下单动作端点 + Agent API + 静态 UI）。
 *
 * 默认端口 8800（PORT 环境变量可覆盖）；测试可传 port=0 动态分配。
 * 除静态 UI 外所有响应 content-type: application/json。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { createOcpHandlers } = require('./catalog/ocp');
const { createOrderService, BUY_NOW_SCHEMA } = require('./catalog/order');
const { createAgent } = require('./agent/agent');
const { createMcpBridge, MCP_BUY_NOW_SCHEMA } = require('./mcp/bridge');

const DEFAULT_PORT = 8800;
const UI_PATH = path.join(__dirname, 'ui', 'index.html');

/** 统一 JSON 响应 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** 统一错误响应（协议约定的 {error:{code,message}} 形状） */
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

/** 读取并解析 JSON 请求体（容错：非法 JSON 返回空对象） */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(raw || '{}');
        resolve(typeof parsed === 'object' && parsed !== null ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * 创建 HTTP server（不自动监听，测试可直接传 port=0）。
 * @param {number} [port] 监听端口，默认取 PORT 环境变量或 8800
 * @returns {Promise<{server: import('node:http').Server, port: number}>} 监听完成后的 server 与实际端口
 */
function createServer(port) {
  const desiredPort = port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      sendError(res, 500, 'internal_error', `服务器内部错误：${err?.message ?? err}`);
    }
  });

  const ocp = null; // 占位说明：ocp/order/agent 在 listen 后按实际端口初始化
  void ocp;

  /** @type {{ocp: ReturnType<typeof createOcpHandlers>, orders: ReturnType<typeof createOrderService>, agent: ReturnType<typeof createAgent>, bridge: ReturnType<typeof createMcpBridge>}|null} */
  let services = null;

  /**
   * 路由分发。
   * 首个请求前完成服务初始化（需要实际端口拼 BASE_URL）。
   */
  async function route(req, res) {
    if (!services) {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : desiredPort;
      const baseUrl = `http://127.0.0.1:${actualPort}`;
      const ocpHandlers = createOcpHandlers(baseUrl);
      const orderService = createOrderService();
      const bridge = createMcpBridge({ baseUrl }); // 商家 MCP 注册与桥接（config/mcp.json）
      const agent = createAgent(baseUrl, bridge); // 协议纪律：Agent 走 HTTP，不直连数据
      services = { ocp: ocpHandlers, orders: orderService, agent, bridge };
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;
    const method = req.method ?? 'GET';

    // ---------- OCP 读面 ----------
    if (method === 'GET' && pathname === '/.well-known/ocp-catalog') {
      return sendJson(res, 200, services.ocp.discovery());
    }
    if (method === 'GET' && pathname === '/ocp/manifest') {
      return sendJson(res, 200, services.ocp.manifest());
    }
    if (method === 'GET' && pathname === '/ocp/health') {
      return sendJson(res, 200, services.ocp.health());
    }
    if (method === 'GET' && pathname === '/ocp/contracts') {
      return sendJson(res, 200, services.ocp.contracts());
    }
    if (method === 'POST' && pathname === '/ocp/query') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, services.ocp.query(body));
    }
    if (method === 'POST' && pathname === '/ocp/resolve') {
      const body = await readJsonBody(req);
      const result = services.ocp.resolve(body);
      if (result.__error) return sendError(res, result.status, result.__error.code, result.__error.message);
      return sendJson(res, 200, result.data);
    }

    // ---------- Action Provider（下单动作） ----------
    if (method === 'POST' && pathname === '/ocp/actions/buy_now') {
      const body = await readJsonBody(req);
      const result = services.orders.buyNow(body);
      if (result.__error) return sendError(res, result.status, result.__error.code, result.__error.message);
      return sendJson(res, 200, result.data);
    }
    if (method === 'GET' && pathname.startsWith('/ocp/orders/')) {
      const orderId = pathname.slice('/ocp/orders/'.length);
      const result = services.orders.getOrder(orderId);
      if (result.__error) return sendError(res, result.status, result.__error.code, result.__error.message);
      return sendJson(res, 200, result.data);
    }
    if (method === 'GET' && pathname === '/api/orders') {
      return sendJson(res, 200, services.orders.listOrders().data);
    }

    // ---------- Action 输入 Schema（resolve binding 的 input_schema 指向此处） ----------
    if (method === 'GET' && pathname === '/schemas/buy-now-request.json') {
      return sendJson(res, 200, BUY_NOW_SCHEMA);
    }
    if (method === 'GET' && pathname === '/schemas/mcp-buy-now-request.json') {
      return sendJson(res, 200, MCP_BUY_NOW_SCHEMA);
    }

    // ---------- Agent API（供 UI 调用） ----------
    if (method === 'POST' && pathname === '/api/agent') {
      const body = await readJsonBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return sendError(res, 400, 'bad_request', '缺少必填字段 text。');
      try {
        const result = await services.agent.handleUserMessage(text);
        return sendJson(res, 200, result);
      } catch (err) {
        if (err?.code) return sendError(res, err.status ?? 502, err.code, err.message);
        return sendError(res, 500, 'internal_error', `Agent 处理失败：${err?.message ?? err}`);
      }
    }
    if (method === 'POST' && pathname === '/api/agent/confirm') {
      const body = await readJsonBody(req);
      const entryId = String(body.entry_id ?? '').trim();
      if (!entryId) return sendError(res, 400, 'bad_request', '缺少必填字段 entry_id。');
      const quantity = Number(body.quantity ?? 1);
      try {
        const result = await services.agent.confirmAndOrder(entryId, quantity);
        return sendJson(res, 200, result);
      } catch (err) {
        // 桥接层业务错误（token 缺失 / 商家连接失败等）
        if (err?.code && err?.name === 'McpBridgeError') {
          return sendError(res, err.status ?? 502, err.code, err.message);
        }
        // 下游 OCP 调用失败（如 buy_now 返回 4xx）时透传其错误形状
        if (err?.body?.error) {
          return sendError(res, err.status ?? 502, err.body.error.code ?? 'bad_request', err.body.error.message);
        }
        return sendError(res, 502, 'action_failed', `下单动作执行失败：${err?.message ?? err}`);
      }
    }

    if (method === 'POST' && pathname === '/api/agent/resolve') {
      // 供 UI 展示 resolve 返回的 action binding 摘要（协议纪律：UI 也不直连数据）
      const body = await readJsonBody(req);
      const entryId = String(body.entry_id ?? '').trim();
      if (!entryId) return sendError(res, 400, 'bad_request', '缺少必填字段 entry_id。');
      try {
        const reference = await services.agent.client.resolve(entryId);
        return sendJson(res, 200, reference);
      } catch (err) {
        if (err?.body?.error) {
          return sendError(res, err.status ?? 502, err.body.error.code, err.body.error.message);
        }
        return sendError(res, 502, 'resolve_failed', `resolve 执行失败：${err?.message ?? err}`);
      }
    }

    // ---------- 商家 MCP：真实下单动作（Action Provider 边界与演示 buy_now 一致） ----------
    // 会花真钱的动作：请求必须显式携带 confirm:true，否则 400 拒绝
    if (method === 'POST' && pathname === '/ocp/actions/mcp/buy_now') {
      const body = await readJsonBody(req);
      if (body.confirm !== true) {
        return sendError(
          res,
          400,
          'confirm_required',
          '真实下单会向商家支付实际费用：请求必须携带 confirm:true 字段才会执行。',
        );
      }
      const merchantId = String(body.merchant_id ?? '').trim();
      if (!merchantId) return sendError(res, 400, 'bad_request', '缺少必填字段 merchant_id。');
      const quantity = Number(body.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return sendError(res, 400, 'bad_request', 'quantity 必须是 1-99 之间的整数。');
      }
      try {
        const order = await services.bridge.createOrder(
          merchantId,
          body.mcpRef ?? body.entry_id,
          quantity,
          { remark: body.remark },
        );
        return sendJson(res, 200, order);
      } catch (err) {
        if (err?.code && err?.name === 'McpBridgeError') {
          return sendError(res, err.status ?? 502, err.code, err.message);
        }
        return sendError(res, 502, 'mcp_error', `商家真实下单失败：${err?.message ?? err}`);
      }
    }

    // ---------- 商家 MCP：运行时 token 设置（设置即验证）与状态查询 ----------
    if (method === 'POST' && pathname === '/api/mcp/token') {
      const body = await readJsonBody(req);
      const merchantId = String(body.merchant_id ?? '').trim();
      const token = String(body.token ?? '').trim();
      if (!merchantId || !token) {
        return sendError(res, 400, 'bad_request', '缺少必填字段 merchant_id / token。');
      }
      try {
        // 设置即验证：用该 token 真连一次商家 MCP（initialize + tools/list）
        const verify = await services.bridge.setTokenAndVerify(merchantId, token);
        const merchants = await services.bridge.status();
        const merchant = merchants.find((m) => m.id === merchantId) ?? null;
        return sendJson(res, 200, {
          ok: true,
          connected: verify.connected,
          tool_count: verify.toolCount,
          merchant_id: merchantId,
          merchant,
        });
      } catch (err) {
        // 验证失败（如 401 Token 无效）返回错误详情，UI 弹窗展示
        if (err?.name === 'McpBridgeError') {
          return sendError(res, err.status ?? 502, err.code, err.message);
        }
        return sendError(res, 502, 'mcp_verify_failed', `Token 验证失败：${err?.message ?? err}`);
      }
    }
    if (method === 'GET' && pathname === '/api/mcp/status') {
      return sendJson(res, 200, { merchants: await services.bridge.status() });
    }

    // ---------- 静态 UI ----------
    if (method === 'GET' && (pathname === '/' || pathname === '/ui' || pathname === '/index.html')) {
      const html = fs.readFileSync(UI_PATH, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    return sendError(res, 404, 'not_found', `No route for ${method} ${pathname}`);
  }

  return new Promise((resolve) => {
    server.listen(desiredPort, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** 直接运行时启动 server；被测试导入时不启动 */
if (require.main === module) {
  createServer().then(({ server, port }) => {
    console.log(`寇豆码 OCP Catalog 演示节点已启动：http://127.0.0.1:${port}  (pid=${process.pid})`);
    void server;
  });
}

module.exports = { createServer };
