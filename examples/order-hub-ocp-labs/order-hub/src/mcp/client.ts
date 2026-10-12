/**
 * 瑞幸 MCP 客户端（Streamable HTTP）。
 *
 * 移植自工作区里已有的 luckin.cjs —— 它已经趟平了两个容易踩的坑：
 *   1. 服务端会下发 `mcp-session-id`，后续请求必须带上；
 *   2. 响应可能是 SSE 帧（`data: {...}`）而不是纯 JSON。
 *
 * 这里额外做严的两件事：
 *   - SSE 可能有多帧，逐帧尝试解析而不是把多帧拼成一个字符串（拼接必然 parse 失败）；
 *   - notification 没有 id，服务端可能回 202 + 空 body，不能当错误处理。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LUCKIN_MCP_URL = 'https://gwmcp.lkcoffee.com/order/user/mcp';

/** MCP 工具的返回结构。 */
export type McpToolResult = {
  content?: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: unknown;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpInitResult = {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
  instructions?: string;
};

export type McpClientOptions = {
  url?: string;
  token: string;
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
};

export type McpClient = {
  initialize: () => Promise<McpInitResult>;
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<McpToolResult>;
  currentSessionId: () => string | undefined;
};

/**
 * 从响应文本里取出 JSON-RPC 消息。
 * 纯 JSON 直接解析；SSE 则逐帧尝试——多帧拼接是 parse 失败的头号原因。
 */
function parseResponse(text: string): any {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const frames = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter((l) => l !== '');
  for (const frame of frames) {
    try {
      return JSON.parse(frame);
    } catch {
      /* 这一帧不是完整 JSON，试下一帧 */
    }
  }
  throw new Error(`无法从 MCP 响应中解析 JSON：${trimmed.slice(0, 240)}`);
}

export function createMcpClient(options: McpClientOptions): McpClient {
  const url = options.url ?? LUCKIN_MCP_URL;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${options.token}`,
  };

  let sessionId: string | undefined;
  let nextId = 1;

  async function rpc(method: string, params?: unknown): Promise<any> {
    const headers: Record<string, string> = { ...baseHeaders };
    if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: params ?? {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid !== null) sessionId = sid;

    const text = await res.text();
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}: ${text.slice(0, 300)}`);

    const message = parseResponse(text);
    if (message === undefined) return undefined;
    if (message.error !== undefined) throw new Error(`${method} 返回 MCP 错误: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  /** notification 没有 id，服务端可能回 202 + 空 body；失败也不该中断流程。 */
  async function notify(method: string, params?: unknown): Promise<void> {
    const headers: Record<string, string> = { ...baseHeaders };
    if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      /* 通知只是礼节，忽略失败 */
    }
  }

  return {
    initialize: async () => {
      const result = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: options.clientName ?? 'luckin-ocp-bridge', version: options.clientVersion ?? '0.1.0' },
      });
      await notify('notifications/initialized');
      return result as McpInitResult;
    },
    listTools: async () => {
      const result = await rpc('tools/list');
      return (result?.tools ?? []) as McpTool[];
    },
    callTool: async (name, args) => {
      const result = await rpc('tools/call', { name, arguments: args ?? {} });
      return (result ?? {}) as McpToolResult;
    },
    currentSessionId: () => sessionId,
  };
}

/**
 * 读取 token。优先环境变量，其次本机 DSH 配置里的 Authorization 头。
 * 全程不打印、不落盘。
 *
 * 默认路径用 `homedir()` 推导，不写死任何个人目录——否则别人 clone 下来直接跑不了。
 * 需要自定义就设 `LUCKIN_DSH_CONFIG`，或直接给 `LUCKIN_MCP_TOKEN`。
 */
export function loadToken(): { token: string; source: string } {
  const fromEnv = process.env.LUCKIN_MCP_TOKEN;
  if (fromEnv !== undefined && fromEnv !== '') return { token: fromEnv, source: '环境变量 LUCKIN_MCP_TOKEN' };

  const configPath =
    process.env.LUCKIN_DSH_CONFIG ??
    join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  let cfg: string;
  try {
    cfg = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(
      '没有可用的 Luckin token。请任选一种方式提供：\n' +
        '  1) export LUCKIN_MCP_TOKEN=<你的 token>\n' +
        '  2) export LUCKIN_DSH_CONFIG=<含 "Authorization: Bearer <token>" 的文件>\n' +
        `（当前尝试读取的是：${configPath}）`,
    );
  }
  const match = /Authorization:\s*Bearer\s+(\S+)/.exec(cfg);
  const token = match?.[1];
  if (token === undefined || /REPLACE_WITH/.test(token)) {
    throw new Error(`在 ${configPath} 里没有可用的 Luckin token`);
  }
  return { token, source: configPath };
}
