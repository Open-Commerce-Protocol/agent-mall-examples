import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '@ocp-catalog/shopping-contracts';
import verified from '../../../fixtures/luckin/tools-list.2026-10-11.json';

const readArguments = {
  queryShopList: z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90), deptName: z.string().max(100).optional() }).strict(),
  searchProductForMcp: z.object({ deptId: z.number().int().positive().safe(), query: z.string().min(1).max(500) }).strict(),
  queryProductDetailInfo: z.object({ deptId: z.number().int().positive().safe(), productId: z.number().int().positive().safe() }).strict(),
};
export type LuckinReadTool = keyof typeof readArguments;
const id = z.number().int().positive().safe();
const items = z.array(z.object({ amount: id.max(20), productId: id, skuCode: z.string().min(1).max(200) }).strict()).min(1).max(20);
const checkoutArguments = {
  switchProduct: z.object({ deptId: id, productId: id, skuCode: z.string().min(1).max(200), amount: id.max(20),
    attrOperationParam: z.object({ attributeId: id, subAttr: z.object({ attributeId: id, operation: z.literal(1) }).strict() }).strict() }).strict(),
  previewOrder: z.object({ deptId: id, productList: items }).strict(),
  createOrder: z.object({ deptId: id, productList: items, longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90),
    couponCodeList: z.array(z.string()).max(100), remark: z.string().max(100).optional() }).strict(),
  queryOrderDetailInfo: z.object({ orderId: z.string().regex(/^\d{1,40}$/) }).strict(),
};
export type LuckinCheckoutTool = keyof typeof checkoutArguments;

export const LUCKIN_MCP_ENDPOINT = 'https://gwmcp.lkcoffee.com/order/user/mcp';
const toolSchema = z.object({
  name: z.string().min(1), inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
});
export type McpTool = z.infer<typeof toolSchema>;
export function toolContractHash(tool: McpTool): string {
  return createHash('sha256').update(canonicalJson(toolSchema.parse(tool))).digest('hex');
}
export class McpProbeError extends Error {
  constructor(readonly code: 'unauthorized' | 'session_expired' | 'rate_limited' | 'transport' | 'protocol') { super(`MCP probe: ${code}`); }
}
/** Explicit allowlists separate read access from checkout access; no cancellation API.
 * One instance owns one account's session. Credentials and remote errors never escape it.
 */
export class LuckinMcpProbe {
  private session?: string;
  private version = '2025-06-18';
  private sequence = 0;
  private ready = false;
  constructor(private readonly token: () => Promise<string>, private readonly options: {
    endpoint?: string; fetch?: typeof fetch; timeoutMs?: number; fixture?: boolean;
  } = {}) {
    const endpoint = options.endpoint ?? LUCKIN_MCP_ENDPOINT;
    const url = new URL(endpoint);
    if (endpoint !== LUCKIN_MCP_ENDPOINT && !(options.fixture && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('untrusted MCP endpoint');
    }
  }
  private async rpc(method: 'initialize' | 'notifications/initialized' | 'tools/list' | 'tools/call', params: unknown): Promise<unknown> {
    const notification = method === 'notifications/initialized';
    const id = ++this.sequence;
    try {
      const token = await this.token();
      if (!token || /[\r\n]/.test(token)) throw new McpProbeError('unauthorized');
      const response = await (this.options.fetch ?? fetch)(this.options.endpoint ?? LUCKIN_MCP_ENDPOINT, {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
          ...(this.session ? { 'mcp-session-id': this.session } : {}),
          ...(method !== 'initialize' ? { 'mcp-protocol-version': this.version } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      });
      if ([401, 403].includes(response.status)) throw new McpProbeError('unauthorized');
      if (response.status === 404) { this.ready = false; this.session = undefined; throw new McpProbeError('session_expired'); }
      if (response.status === 429) throw new McpProbeError('rate_limited');
      if (!response.ok) throw new McpProbeError('transport');
      if (notification) { await response.body?.cancel(); return undefined; }
      if (method === 'initialize') this.session = response.headers.get('mcp-session-id') ?? undefined;
      const type = response.headers.get('content-type') ?? '';
      if (!response.body) throw new McpProbeError('protocol');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; let size = 0;
      const parse = (value: string): unknown => {
        const message = JSON.parse(value) as Record<string, unknown>;
        if (message.jsonrpc !== '2.0') throw new McpProbeError('protocol');
        if (message.id !== id) return undefined;
        if (message.error || !('result' in message)) throw new McpProbeError('protocol');
        return message.result;
      };
      try {
        while (true) {
          const chunk = await reader.read();
          size += chunk.value?.byteLength ?? 0;
          if (size > 2_000_000) throw new McpProbeError('protocol');
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          if (type.includes('text/event-stream')) {
            buffer = buffer.replaceAll('\r\n', '\n');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) { const result = parse(data); if (result !== undefined) return result; }
            }
          } else if (!type.includes('application/json')) throw new McpProbeError('protocol');
          if (chunk.done) break;
        }
        if (type.includes('application/json')) {
          const result = parse(buffer); if (result !== undefined) return result;
        }
        throw new McpProbeError('protocol');
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (error instanceof McpProbeError) throw error;
      throw new McpProbeError('transport');
    }
  }
  async inspect(): Promise<{ tools: McpTool[]; fingerprints: Record<string, string> }> {
    if (!this.ready) {
      const init = z.object({ protocolVersion: z.enum(['2025-06-18', '2025-03-26', '2024-11-05']), capabilities: z.object({ tools: z.unknown().optional() }) })
        .safeParse(await this.rpc('initialize', { protocolVersion: this.version, capabilities: {}, clientInfo: { name: 'ocp-luckin-readonly-probe', version: '0.1.0' } }));
      if (!init.success || !('tools' in init.data.capabilities)) throw new McpProbeError('protocol');
      this.version = init.data.protocolVersion;
      await this.rpc('notifications/initialized', {}); this.ready = true;
    }
    const tools: McpTool[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const parsed = z.object({ tools: z.array(toolSchema), nextCursor: z.string().min(1).optional() }).safeParse(await this.rpc('tools/list', cursor ? { cursor } : {}));
      if (!parsed.success) throw new McpProbeError('protocol');
      tools.push(...parsed.data.tools);
      if (tools.length > 1000 || new Set(tools.map(tool => tool.name)).size !== tools.length) throw new McpProbeError('protocol');
      cursor = parsed.data.nextCursor;
      if (!cursor) return { tools, fingerprints: Object.fromEntries(tools.map(tool => [tool.name, toolContractHash(tool)])) };
      if (cursors.has(cursor)) throw new McpProbeError('protocol');
      cursors.add(cursor);
    }
    throw new McpProbeError('protocol');
  }
  async read(name: LuckinReadTool, input: unknown): Promise<unknown> {
    if (!Object.hasOwn(readArguments, name)) throw new McpProbeError('protocol');
    const args = readArguments[name].parse(input);
    return this.invoke(name, args);
  }
  async checkout(name: LuckinCheckoutTool, input: unknown): Promise<unknown> {
    if (!Object.hasOwn(checkoutArguments, name)) throw new McpProbeError('protocol');
    return this.invoke(name, checkoutArguments[name].parse(input));
  }
  private async invoke(name: LuckinReadTool | LuckinCheckoutTool, args: unknown): Promise<unknown> {
    const current = await this.inspect();
    if (current.fingerprints[name] !== verified.fingerprints[name]) throw new McpProbeError('protocol');
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const result = z.object({ isError: z.boolean().optional(), structuredContent: z.record(z.string(), z.unknown()).optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).safeParse(raw);
    if (!result.success || result.data.isError) throw new McpProbeError('protocol');
    if (result.data.structuredContent) return result.data.structuredContent;
    const blocks = result.data.content?.filter(block => block.type === 'text' && block.text);
    if (blocks?.length !== 1) throw new McpProbeError('protocol');
    try { return JSON.parse(blocks[0]!.text!); } catch { throw new McpProbeError('protocol'); }
  }
}
