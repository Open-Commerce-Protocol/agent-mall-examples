/**
 * 极简 HTTP 微框架 —— 零依赖，只用 node:http。
 *
 * 两个刻意的取舍：
 *  1. 不用上游示例的 `Bun.serve`：本机没有 Bun（CLI 也没法跑，见 README）。
 *  2. 不引入 express/fastify：本机 npm registry 不可达（自签名证书）。
 *
 * 因此这里只做三件事：路由匹配（支持 :param）、读 body、带 CORS 回写 JSON。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * 一个响应的最小表示：要么是 JSON body，要么是 HTML 字符串。
 *
 * 用联合类型而不是"把 HTML 塞进 body"，是为了让 JSON 路由不可能误返回 HTML——
 * 协议端点必须永远是 JSON。
 */
export type OcpReply = { status: number; body: unknown } | { status: number; html: string };

/** 处理器的输入上下文。 */
export type Ctx = {
  method: string;
  url: URL;
  params: Record<string, string>;
  /** 已解析的 JSON body；非 JSON 或空 body 时为 {}。 */
  body: Record<string, unknown>;
  /** 已解析的表单 body（点单页用 application/x-www-form-urlencoded 提交）。 */
  form: URLSearchParams;
  /** 原始 body 文本，便于校验器报错时回显。 */
  rawText: string;
  raw: IncomingMessage;
};

export type Handler = (ctx: Ctx) => OcpReply | Promise<OcpReply>;
export type Route = { method: string; path: string; handler: Handler };

export const json = (body: unknown, status = 200): OcpReply => ({ status, body });

/** OCP 各示例节点一致的错误形状。 */
export const fail = (code: string, message: string, status = 400): OcpReply => ({
  status,
  body: { error: { code, message } },
});

/** 演示面板（4600）要跨端口调用三个节点，所以必须带 CORS。 */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key, x-ocp-trace-id',
  'access-control-max-age': '600',
};

/**
 * 把路由模板与真实路径做逐段比对。
 * @returns 命中时返回提取到的 params，未命中返回 undefined。
 */
function matchRoute(route: Route, method: string, pathname: string): Record<string, string> | undefined {
  if (route.method !== method) return undefined;
  const template = route.path.split('/').filter((s) => s.length > 0);
  const actual = pathname.split('/').filter((s) => s.length > 0);
  if (template.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < template.length; i += 1) {
    const seg = template[i] as string;
    const got = actual[i] as string;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(got);
      continue;
    }
    if (seg !== got) return undefined;
  }
  return params;
}

async function readRaw(raw: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of raw) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, reply: OcpReply): void {
  if ('html' in reply) {
    res.writeHead(reply.status, {
      ...CORS,
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(reply.html),
    });
    res.end(reply.html);
    return;
  }
  const payload = JSON.stringify(reply.body, null, 2);
  res.writeHead(reply.status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** 商户侧的人工可见页面（菜单、门店、下单页）。 */
export const html = (markup: string, status = 200): OcpReply => ({ status, html: markup });

async function handle(
  routes: Route[],
  raw: IncomingMessage,
  res: ServerResponse,
  label: string,
): Promise<void> {
  const started = Date.now();
  const method = raw.method ?? 'GET';
  const url = new URL(raw.url ?? '/', `http://${raw.headers.host ?? '127.0.0.1'}`);

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const rawText = await readRaw(raw);
  const contentType = String(raw.headers['content-type'] ?? '');

  const form = new URLSearchParams(
    contentType.includes('application/x-www-form-urlencoded') ? rawText : '',
  );

  let body: Record<string, unknown> = {};
  if (rawText.trim() !== '' && !form.toString()) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
    } catch {
      /* 非 JSON body 交给 handler 判空，与上游示例的 readJson 行为一致。 */
    }
  }

  let reply: OcpReply;
  try {
    let matched: { route: Route; params: Record<string, string> } | undefined;
    for (const route of routes) {
      const params = matchRoute(route, method, url.pathname);
      if (params !== undefined) {
        matched = { route, params };
        break;
      }
    }
    if (matched === undefined) {
      reply = fail('not_found', `No route for ${method} ${url.pathname}`, 404);
    } else {
      const ctx: Ctx = { method, url, params: matched.params, body, form, rawText, raw };
      reply = await matched.route.handler(ctx);
    }
  } catch (error) {
    reply = fail('internal_error', error instanceof Error ? error.message : String(error), 500);
  }

  // 演示时要在终端里看清"谁被调用了"，所以每个请求都打一行日志。
  console.log(
    `[${label}] ${method} ${url.pathname}${url.search} -> ${reply.status} (${Date.now() - started}ms)`,
  );
  send(res, reply);
}

/**
 * 启动一个 HTTP 服务。
 *
 * @param host 绑定地址。默认只监听回环；公网隧道场景下隧道客户端连的是本机回环，
 *   所以默认值够用。需要局域网直连时传 '0.0.0.0'。
 */
export function startServer(routes: Route[], port: number, label: string, host = '127.0.0.1'): Promise<Server> {
  const server = createServer((raw, res) => {
    void handle(routes, raw, res, label);
  });
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
