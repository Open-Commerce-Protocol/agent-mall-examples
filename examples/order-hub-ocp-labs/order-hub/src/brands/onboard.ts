/**
 * MCP 接入探测：把"接入一个新品牌"从"我改代码"变成"你贴 URL + token"。
 *
 * CLI（scripts/onboard.ts）与网站（/api/onboard/*）共用这里的启发式，
 * 避免两套逻辑各自漂移。
 */
import type { BrandSpec, OpSpec } from './declarative.ts';

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: { required?: string[]; properties?: Record<string, unknown> };
};

/** 六个操作与它们的名字启发式。 */
const HEURISTICS: { op: keyof BrandSpec['ops']; include: RegExp; exclude?: RegExp; hint: string }[] = [
  { op: 'listStores', include: /(shop|store|dept|branch|restaurant|outlet)/i, exclude: /(detail|product|menu)/i, hint: '门店/网点列表' },
  { op: 'searchProducts', include: /(product|menu|item|dish|goods|search)/i, hint: '商品/菜单检索' },
  { op: 'productOptions', include: /(detail|attr|option|spec|switch)/i, hint: '商品详情与可选规格' },
  { op: 'preview', include: /(preview|calc|estimate|settle|price)/i, exclude: /(coupon|voucher)/i, hint: '订单预览/计价' },
  { op: 'createOrder', include: /(create|submit|place|make).*order|^order$/i, exclude: /(query|detail|cancel|preview|list)/i, hint: '创建订单' },
];

export type Guess = { op: string; hint: string; tool?: string; candidates: string[] };

export function guessOps(tools: McpTool[]): Guess[] {
  return HEURISTICS.map((rule) => {
    const candidates = tools
      .filter((t) => rule.include.test(t.name) && !(rule.exclude !== undefined && rule.exclude.test(t.name)))
      .map((t) => t.name);
    return { op: rule.op as string, hint: rule.hint, ...(candidates[0] !== undefined ? { tool: candidates[0] } : {}), candidates };
  });
}

/** 按参数名猜占位符，省得人工一个个填。 */
function guessArg(arg: string): string {
  if (/lat/i.test(arg)) return '{{lat}}';
  if (/lo?n[gx]|lng/i.test(arg)) return '{{lng}}';
  if (/(shop|store|dept|branch).*id/i.test(arg)) return '{{storeId}}';
  if (/product.*id/i.test(arg)) return '{{productId}}';
  if (/sku/i.test(arg)) return '{{skuCode}}';
  if (/amount|quantity|count|num/i.test(arg)) return '{{amount}}';
  if (/list|items|products$/i.test(arg)) return '{{lines}}';
  if (/query|keyword|kw|text/i.test(arg)) return '{{query}}';
  if (/coupon/i.test(arg)) return '{{coupons}}';
  if (/remark|note|comment/i.test(arg)) return '{{remark}}';
  return '';
}

/**
 * 生成一份 spec 草稿：工具名自动匹配，参数名按语义猜占位符。
 * **`shapes` 一定是空的**——字段路径必须看真实响应才能填，这里绝不编。
 */
export function draftSpec(input: { id: string; name: string; mcpUrl: string; tokenHint?: string; tools: McpTool[] }): BrandSpec {
  const ops: Partial<Record<'listStores' | 'searchProducts' | 'productOptions' | 'preview' | 'createOrder', OpSpec>> = {};
  for (const guess of guessOps(input.tools)) {
    if (guess.tool === undefined) continue;
    const tool = input.tools.find((t) => t.name === guess.tool);
    const args: Record<string, string> = {};
    for (const arg of tool?.inputSchema?.required ?? []) args[arg] = guessArg(arg);
    ops[guess.op as 'listStores'] = { tool: guess.tool, args };
  }

  return {
    id: input.id,
    name: input.name,
    tagline: '（待填写）',
    mcpUrl: input.mcpUrl,
    tokenHint: input.tokenHint ?? '（待填写：去哪里申请该品牌的 token）',
    requiresLocation: true,
    defaultLocation: { longitude: 120.1551, latitude: 30.2741 },
    orderNeedsLocation: ops.createOrder !== undefined,
    specNote:
      `由站内接入助手于 ${new Date().toISOString()} 生成：工具名已自动匹配，` +
      '但 **shapes（字段路径）必须按真实响应填写** —— 未填之前该品牌只能查看工具清单，不能查商品。',
    ops,
    shapes: {},
  };
}

/** spec 是否足以真正查商品/下单（工具名映射齐 + 至少 3 组字段路径）。 */
export function specReadiness(spec: BrandSpec): { ready: boolean; missingOps: string[]; shapeGroups: number } {
  const required = ['listStores', 'searchProducts', 'preview', 'createOrder'] as const;
  const missingOps = required.filter((op) => spec.ops?.[op] === undefined);
  const shapeGroups = Object.keys(spec.shapes ?? {}).length;
  return { ready: missingOps.length === 0 && shapeGroups >= 3, missingOps: [...missingOps], shapeGroups };
}
