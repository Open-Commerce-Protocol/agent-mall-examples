/**
 * 通用 MCP（Model Context Protocol）客户端：支持 Streamable HTTP 与 stdio 两种传输。
 *
 * Streamable HTTP：JSON-RPC 2.0 over HTTP POST。
 * - 请求头固定 content-type: application/json + accept: application/json, text/event-stream
 * - initialize 响应头 mcp-session-id 会被记录并在后续请求中回传
 * - initialize 成功后发送 notifications/initialized 通知
 * - 响应可能是普通 JSON，也可能是 text/event-stream（SSE），两者均支持解析
 * - HTTP 非 2xx 抛出含状态码与响应体的 McpError（401 = token 无效）
 *
 * stdio：spawn 子进程，按 MCP stdio 惯例使用换行分隔的 JSON-RPC 消息。
 *
 * 统一接口：connect() / listTools() / callTool(name, args) / close()。
 * 请求携带递增 id，超时默认 30s。零第三方依赖，仅用 Node 内置模块。
 */
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 30000;
const CLIENT_INFO = { name: 'koudou-ocp-agent', version: '1.0.0' };

/**
 * MCP 调用错误：携带可选的 HTTP 状态码（status）、响应体（body）与 JSON-RPC 错误码（code）。
 */
class McpError extends Error {
  /**
   * @param {string} message 错误描述
   * @param {{status?: number|null, body?: string|null, code?: number|string|null}} [meta]
   */
  constructor(message, { status = null, body = null, code = null } = {}) {
    super(message);
    this.name = 'McpError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/** deflate 兼容：优先 zlib 标准格式，失败再试 raw 格式（部分服务端误标 content-encoding） */
function inflateAny(buf) {
  try {
    return zlib.inflateSync(buf);
  } catch {
    return zlib.inflateRawSync(buf);
  }
}

/**
 * 按响应头 content-encoding 解压响应体（gzip / deflate / br，支持逗号分隔的多层编码）。
 * 兼容策略：
 * - RFC 7231 中 content-encoding 按应用顺序列出，解码需逆序执行；
 * - 解压失败时回退为原始 Buffer（服务端误标、或底层 fetch 已透明解压的兜底）。
 * 调用方必须把 HTTP 响应以 Buffer 收集后传入，再对返回值一次性 toString('utf8')，
 * 禁止逐 chunk 解码（chunk 边界会截断 UTF-8 多字节字符导致中文乱码）。
 * @param {Buffer|Uint8Array} raw 原始响应体
 * @param {string|null} [encoding] content-encoding 响应头值
 * @returns {Buffer} 解压后的 Buffer（失败时为原始 Buffer）
 */
function decodeHttpBody(raw, encoding = null) {
  const original = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? new Uint8Array());
  let out = original;
  const enc = String(encoding ?? '').trim().toLowerCase();
  if (!enc || enc === 'identity') return out;
  const steps = enc.split(',').map((s) => s.trim()).filter(Boolean).reverse();
  try {
    for (const step of steps) {
      if (step === 'gzip' || step === 'x-gzip') {
        out = zlib.gunzipSync(out);
      } else if (step === 'deflate') {
        out = inflateAny(out);
      } else if (step === 'br') {
        out = zlib.brotliDecompressSync(out);
      }
      // 未知编码：跳过（按未压缩处理）
    }
    return out;
  } catch {
    return original;
  }
}

/**
 * 从 SSE 文本中解析所有 data: 行的 JSON 对象。
 * @param {string} text SSE 原始文本
 * @returns {object[]} 解析出的 JSON 消息列表（非 JSON 的 data 行被忽略）
 */
function parseSseData(text) {
  const messages = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m) continue;
    const payload = m[1].trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      messages.push(JSON.parse(payload));
    } catch {
      // 忽略非 JSON 的 data 行（如注释、心跳）
    }
  }
  return messages;
}

/**
 * 从 tools/call 结果中提取业务载荷。
 * 优先 structuredContent；否则尝试把首个 text content 解析为 JSON；都失败则返回原始 result。
 * @param {object|null} result JSON-RPC result
 * @returns {object|null}
 */
function extractToolPayload(result) {
  if (!result || typeof result !== 'object') return result ?? null;
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  if (Array.isArray(result.content)) {
    const textItem = result.content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
    if (textItem) {
      try {
        return JSON.parse(textItem.text);
      } catch {
        return result; // 文本不是 JSON，返回原始 result
      }
    }
  }
  return result;
}

/**
 * MCP 客户端。
 */
class McpClient {
  /**
   * @param {{
   *   type?: 'streamablehttp'|'stdio',
   *   url?: string|null,
   *   headers?: object,
   *   extraHeaders?: object,
   *   command?: string|null,
   *   args?: string[],
   *   token?: string|null,
   *   timeoutMs?: number
   * }} options 传输配置
   */
  constructor(options = {}) {
    this.type = options.type === 'stdio' ? 'stdio' : 'streamablehttp';
    this.url = options.url ?? null;
    this.headers = { ...(options.headers ?? {}) };
    this.extraHeaders = { ...(options.extraHeaders ?? {}) };
    this.command = options.command ?? null;
    this.args = options.args ?? [];
    this.token = options.token ?? null;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionId = null;
    this.connected = false;
    this.serverInfo = null;
    this.toolsCache = null;
    this.nextId = 1;
    // stdio 子进程状态
    this.child = null;
    this.stdoutBuffer = '';
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pending = new Map();
  }

  #nextRequestId() {
    return this.nextId++;
  }

  /** 构建每次 HTTP 请求的头部（含商家鉴权与 session id） */
  #buildHttpHeaders() {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.headers,
      ...this.extraHeaders,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    return headers;
  }

  /**
   * 统一 JSON-RPC 请求入口（带 id，等待响应）。
   * @param {string} method 方法名
   * @param {object} params 参数
   * @returns {Promise<object|null>} JSON-RPC result
   */
  async request(method, params = {}) {
    if (!this.connected && method !== 'initialize') {
      throw new McpError('MCP 客户端尚未连接，请先调用 connect()');
    }
    const message = { jsonrpc: '2.0', id: this.#nextRequestId(), method, params };
    return this.type === 'stdio' ? this.#requestStdio(message) : this.#requestHttp(message);
  }

  /**
   * JSON-RPC 通知（无 id，不期待响应）。
   * @param {string} method 通知方法名
   * @param {object} params 参数
   */
  async notify(method, params = {}) {
    const message = { jsonrpc: '2.0', method, params };
    if (this.type === 'stdio') {
      this.#sendStdio(message);
    } else {
      await this.#notifyHttp(message);
    }
  }

  /**
   * 建立 MCP 会话：initialize → notifications/initialized。
   * @returns {Promise<McpClient>} this（便于链式调用）
   */
  async connect() {
    if (this.connected) return this;
    const params = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    };
    const result =
      this.type === 'stdio'
        ? await this.request('initialize', params)
        : await this.#initializeHttp(params);
    this.serverInfo = result?.serverInfo ?? null;
    this.connected = true;
    await this.notify('notifications/initialized', {});
    return this;
  }

  /**
   * 列出服务端工具（带缓存，供状态展示用；callTool 不走缓存）。
   * @returns {Promise<object[]>}
   */
  async listToolsCached() {
    if (Array.isArray(this.toolsCache)) return this.toolsCache;
    this.toolsCache = await this.listTools();
    return this.toolsCache;
  }

  /**
   * 列出服务端工具（每次实时请求）。
   * @returns {Promise<object[]>}
   */
  async listTools() {
    const result = await this.request('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /**
   * 调用服务端工具。
   * @param {string} name 工具名
   * @param {object} args 工具入参
   * @returns {Promise<object|null>} 解析后的业务载荷（structuredContent 或 content 文本 JSON）
   */
  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args ?? {} });
    if (result?.isError) {
      const text = Array.isArray(result.content)
        ? result.content.map((c) => c?.text ?? '').join('\n')
        : JSON.stringify(result);
      throw new McpError(`工具 ${name} 调用失败：${text}`);
    }
    return extractToolPayload(result);
  }

  /** 关闭连接（stdio 杀掉子进程；HTTP 无持久连接，仅重置状态） */
  async close() {
    this.connected = false;
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // 子进程可能已退出
      }
      this.child = null;
    }
    for (const p of this.pending.values()) {
      p.reject(new McpError('MCP 客户端已关闭'));
    }
    this.pending.clear();
  }

  // ==================== Streamable HTTP 传输 ====================

  /** HTTP：initialize（需捕获 mcp-session-id 响应头） */
  async #initializeHttp(params) {
    const message = { jsonrpc: '2.0', id: this.#nextRequestId(), method: 'initialize', params };
    const { result, headers } = await this.#httpPost(message);
    const sid = headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    return result;
  }

  /** HTTP：发通知（无 id；服务端可能返回 202 空响应体） */
  async #notifyHttp(message) {
    let res;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.#buildHttpHeaders(),
        body: JSON.stringify(message),
      });
    } catch (err) {
      throw new McpError(`MCP 通知发送失败（${this.url}）：${err?.message ?? err}`);
    }
    if (!res.ok) {
      const rawBody = Buffer.from(await res.arrayBuffer().catch(() => new Uint8Array()));
      const bodyText = decodeHttpBody(rawBody, res.headers.get('content-encoding')).toString('utf8');
      throw new McpError(`MCP 通知失败（HTTP ${res.status}）：${bodyText.slice(0, 300) || '(空响应体)'}`, {
        status: res.status,
        body: bodyText.slice(0, 300),
      });
    }
  }

  /**
   * HTTP：POST 一条 JSON-RPC 消息，自动兼容 JSON 与 SSE 两种响应格式。
   * 响应体统一以 Buffer 收集、按 content-encoding 解压后一次性 UTF-8 解码，
   * 避免 chunk 边界截断多字节字符导致的中文乱码。
   * @returns {Promise<{result: object|null, headers: Headers, payload: object|null}>}
   */
  async #httpPost(message) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: this.#buildHttpHeaders(),
        body: JSON.stringify(message),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new McpError(`MCP 请求失败（${this.url}）：${err?.message ?? err}`);
    }
    let rawBody;
    try {
      rawBody = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      clearTimeout(timer);
      throw new McpError(`MCP 响应体读取失败（${this.url}）：${err?.message ?? err}`);
    }
    clearTimeout(timer);
    // 无论是否压缩：先按 content-encoding 解压，再对完整 Buffer 一次性 UTF-8 解码
    const bodyText = decodeHttpBody(rawBody, res.headers.get('content-encoding')).toString('utf8');
    if (!res.ok) {
      throw new McpError(
        `MCP 请求失败（HTTP ${res.status}）：${bodyText.slice(0, 300) || '(空响应体)'}`,
        { status: res.status, body: bodyText.slice(0, 300) },
      );
    }
    const contentType = String(res.headers.get('content-type') ?? '');
    let payload = null;
    if (contentType.includes('text/event-stream')) {
      // SSE 响应：解析 data: 行，取与请求 id 匹配（或首个带 result/error）的 JSON-RPC 消息
      const messages = parseSseData(bodyText);
      payload =
        messages.find((m) => m && m.id === message.id) ??
        messages.find((m) => m && (m.result !== undefined || m.error !== undefined)) ??
        null;
      if (!payload && bodyText.trim()) {
        throw new McpError(`MCP SSE 响应中未找到有效 data 消息（前 300 字符）：${bodyText.slice(0, 300)}`);
      }
    } else {
      if (bodyText.trim()) {
        try {
          payload = JSON.parse(bodyText);
        } catch {
          // 附原始 body 前 300 字符便于排查（乱码 / 非法 HTML 错误页等）
          throw new McpError(`MCP 响应不是合法 JSON（前 300 字符）：${bodyText.slice(0, 300)}`);
        }
      }
    }
    return { result: payload?.result ?? null, headers: res.headers, payload };
  }

  /** HTTP：请求入口（含 JSON-RPC error 检查） */
  async #requestHttp(message) {
    const { result, payload } = await this.#httpPost(message);
    if (payload?.error) {
      throw new McpError(`MCP 错误 ${payload.error.code}: ${payload.error.message}`, {
        code: payload.error.code,
        body: payload.error,
      });
    }
    return result ?? null;
  }

  // ==================== stdio 传输 ====================

  /** 确保 stdio 子进程已启动，并挂好按行解析逻辑 */
  #ensureStdioChild() {
    if (this.child) return this.child;
    this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk;
      let idx;
      while ((idx = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, idx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // 非 JSON 行（如子进程日志）忽略
        }
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new McpError(`MCP 错误 ${msg.error.code}: ${msg.error.message}`, { code: msg.error.code }));
          } else {
            pending.resolve(msg.result ?? null);
          }
        }
      }
    });
    this.child.on('exit', () => {
      this.child = null;
      for (const p of this.pending.values()) {
        p.reject(new McpError('MCP stdio 子进程已退出'));
      }
      this.pending.clear();
    });
    return this.child;
  }

  /** stdio：写入一行 JSON-RPC 消息 */
  #sendStdio(message) {
    const child = this.#ensureStdioChild();
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** stdio：请求入口（按 id 等待响应行） */
  #requestStdio(message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new McpError(`MCP stdio 请求超时（${this.timeoutMs}ms）`));
      }, this.timeoutMs);
      this.pending.set(message.id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#sendStdio(message);
    });
  }
}

module.exports = { McpClient, McpError, parseSseData, extractToolPayload, decodeHttpBody, PROTOCOL_VERSION };
