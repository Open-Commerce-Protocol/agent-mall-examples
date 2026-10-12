/**
 * 瑞幸咖啡官方 MCP 客户端 —— OCP 规范里的「适配器层」。
 *
 * ★ 这就是路演要讲清楚的核心分层：
 *      OCP  = 协议层  →  负责发现 / 查询 / 解析 / 路由
 *      MCP  = 适配器层 →  负责「工具怎么被调用」
 *
 *   所以正确姿势是「写一个 OCP Catalog 把 MCP 包起来」，
 *   而不是「用 MCP 去替换 OCP」。这个文件就是那个「包起来」的动作。
 *
 * 上游：https://gwmcp.lkcoffee.com/order/user/mcp (streamable HTTP, Bearer)
 * 工具：queryShopList / searchProductForMcp / switchProduct /
 *       queryProductDetailInfo / previewOrder / createOrder /
 *       queryOrderDetailInfo / cancelOrder
 */

type JsonRpc = { jsonrpc: '2.0'; id?: number; result?: any; error?: any };

/** 上游可能返回纯 JSON，也可能返回 SSE（text/event-stream）。两种都吃。 */
function parseMaybeSse(text: string): JsonRpc | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  // SSE: 逐行找 data:
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload);
      if (j && (j.result !== undefined || j.error !== undefined || j.id !== undefined)) return j;
    } catch {
      /* 跳过非 JSON 行 */
    }
  }
  return null;
}

/** MCP tool 返回 { content:[{type:'text',text:'...'}] }，text 里通常是 JSON */
function unwrapToolResult(result: any): any {
  if (result == null) return null;
  if (result.isError) {
    const msg = result.content?.map((c: any) => c.text).join('\n') ?? '未知错误';
    throw new Error(`上游工具返回错误: ${msg}`);
  }
  if (Array.isArray(result.content)) {
    const texts = result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text);
    const joined = texts.join('\n').trim();
    if (joined) {
      try {
        return JSON.parse(joined);
      } catch {
        return joined;
      }
    }
  }
  // 有些实现直接给 structuredContent
  return result.structuredContent ?? result;
}

export class LuckinMcpClient {
  private sessionId: string | null = null;
  private initialized = false;
  private nextId = 1;

  constructor(
    private url: string,
    private token: string,
    private timeoutMs = 15000,
  ) {}

  get available() {
    return Boolean(this.url && this.token);
  }

  private async post(body: unknown): Promise<JsonRpc | null> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;

      const text = await res.text();
      if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`);
      return parseMaybeSse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.available) throw new Error('未配置 LUCKIN_MCP_URL / LUCKIN_MCP_TOKEN');

    const r = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ocp-food-demo', version: '1.0.0' },
      },
    });
    if (r?.error) throw new Error(`initialize 失败: ${JSON.stringify(r.error)}`);

    // 通知类消息，上游通常返回 202 空体；失败不致命
    try {
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch {
      /* ignore */
    }
    this.initialized = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.init();
    const r = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (!r) throw new Error(`工具 ${name} 无响应`);
    if (r.error) throw new Error(`工具 ${name} 报错: ${JSON.stringify(r.error)}`);
    return unwrapToolResult(r.result);
  }

  async listTools(): Promise<any[]> {
    await this.init();
    const r = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} });
    return r?.result?.tools ?? [];
  }

  /* ───────────── 以下是 8 个上游工具的语义化包装 ───────────── */

  /** 查门店：必须传经纬度（官方限制），deptName 可选 */
  queryShopList(longitude: number, latitude: number, deptName?: string) {
    return this.callTool('queryShopList', { longitude, latitude, ...(deptName ? { deptName } : {}) });
  }

  /** 商品搜索：必须传门店 id，每次最多返回 3 款（官方限制） */
  searchProductForMcp(deptId: number, query: string) {
    return this.callTool('searchProductForMcp', { deptId, query });
  }

  queryProductDetailInfo(deptId: number, productId: number) {
    return this.callTool('queryProductDetailInfo', { deptId, productId });
  }

  /** 规格切换（糖度/冰量/杯型等）。attrOperationParam 是官方规定的对象 */
  switchProduct(deptId: number, productId: number, skuCode: string, attrOperationParam: Record<string, unknown>, amount = 1) {
    return this.callTool('switchProduct', { deptId, productId, skuCode, attrOperationParam, amount });
  }

  /** 订单预览 —— 不产生真实订单 */
  previewOrder(deptId: number, productList: unknown[]) {
    return this.callTool('previewOrder', { deptId, productList });
  }

  /** 真实下单 —— 会扣款。只在用户明确确认后调用。 */
  createOrder(deptId: number, productList: unknown[], longitude: number, latitude: number, opts: { couponCodeList?: unknown[]; remark?: string } = {}) {
    return this.callTool('createOrder', {
      deptId,
      productList,
      longitude,
      latitude,
      ...(opts.couponCodeList ? { couponCodeList: opts.couponCodeList } : {}),
      ...(opts.remark ? { remark: opts.remark } : {}),
    });
  }

  queryOrderDetailInfo(orderId: string) {
    return this.callTool('queryOrderDetailInfo', { orderId });
  }

  cancelOrder(orderId: string) {
    return this.callTool('cancelOrder', { orderId });
  }
}

/** 从 .env 造一个客户端；没配就返回 null（优雅降级） */
export function luckinFromEnv(): LuckinMcpClient | null {
  const url = process.env.LUCKIN_MCP_URL?.trim();
  const token = process.env.LUCKIN_MCP_TOKEN?.trim();
  if (!url || !token) return null;
  return new LuckinMcpClient(url, token);
}
