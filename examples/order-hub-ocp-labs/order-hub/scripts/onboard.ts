/**
 * MCP 接入助手 —— 把"接入更多 MCP"从写代码变成填配置。
 *
 * 给它一个 MCP 端点和 token，它会：
 *   1. 握手并列出真实工具清单（含每个工具的必填参数）；
 *   2. 按工具名启发式猜测六个操作各对应哪个工具；
 *   3. 输出一份 spec 草稿（--write 则直接写进 src/brands/specs/）。
 *
 * 它**只调用 initialize / tools/list**，不会调用任何下单类工具。
 *
 * 用法：
 *   node scripts/onboard.ts --url https://mcp.mcd.cn --token XXX --id mcd
 *   node scripts/onboard.ts --url https://mcp.mcd.cn --token XXX --id mcd --write
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpClient } from '../src/mcp/client.ts';

const SPEC_DIR = fileURLToPath(new URL('../src/brands/specs', import.meta.url));

type Tool = { name: string; description?: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> } };

function argValue(index: number): string {
  const args = process.argv.slice(2);
  return args[index] ?? '';
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/* ------------------------------------------------------------ 操作启发式 */

const HEURISTICS: { op: string; include: RegExp; exclude?: RegExp; hint: string }[] = [
  { op: 'listStores', include: /(shop|store|dept|branch|restaurant|outlet)/i, exclude: /(queryShopList|detail)/i.test('') ? undefined : undefined, hint: '门店/网点列表' },
  { op: 'searchProducts', include: /(product|menu|item|dish|goods|search)/i, hint: '商品/菜单检索' },
  { op: 'productOptions', include: /(detail|attr|option|spec|sku|switch)/i, hint: '商品详情与可选规格' },
  { op: 'preview', include: /(preview|calc|estimate|settle|price)/i, exclude: /(coupon|voucher)/i, hint: '订单预览/计价' },
  { op: 'createOrder', include: /(create|submit|place|make).*order|^order$/i, exclude: /(query|detail|cancel|preview|list)/i, hint: '创建订单' },
];

function guess(tools: Tool[]): { op: string; tool?: string; candidates: string[] }[] {
  return HEURISTICS.map((rule) => {
    const candidates = tools
      .filter((t) => rule.include.test(t.name) && !(rule.exclude !== undefined && rule.exclude.test(t.name)))
      .map((t) => t.name);
    return { op: rule.op, tool: candidates[0], candidates, hint: rule.hint };
  });
}

/* ------------------------------------------------------------------ 主体 */

async function main(): Promise<void> {
  const url = option('--url');
  const token = option('--token') ?? process.env.MCP_TOKEN;
  const id = option('--id') ?? 'new-brand';
  const name = option('--name') ?? id;

  if (url === undefined || token === undefined || token === '') {
    console.error('用法：node scripts/onboard.ts --url <mcpUrl> --token <token> [--id <brandId>] [--name <名称>] [--write]');
    process.exit(1);
  }

  const mcp = createMcpClient({ token, url, clientName: 'order-hub-onboard' });
  console.log(`\n接入探测　${url}`);
  const init = await mcp.initialize();
  console.log(`握手成功　${init.serverInfo?.name} v${init.serverInfo?.version}　协议 ${init.protocolVersion}`);

  const tools = (await mcp.listTools()) as Tool[];
  console.log(`\n工具清单（${tools.length} 个）：`);
  for (const tool of tools) {
    const required = tool.inputSchema?.required ?? [];
    const optional = Object.keys(tool.inputSchema?.properties ?? {}).filter((k) => !required.includes(k));
    console.log(`  · ${tool.name}`);
    if (tool.description !== undefined) console.log(`      ${tool.description.replace(/\s+/g, ' ').slice(0, 110)}`);
    if (required.length > 0) console.log(`      必填: ${required.join(', ')}`);
    if (optional.length > 0) console.log(`      可选: ${optional.slice(0, 10).join(', ')}`);
  }

  const guesses = guess(tools);
  console.log('\n操作映射猜测（按工具名启发式，需人工确认参数名）：');
  for (const g of guesses) {
    const status = g.tool === undefined ? '未找到候选' : `→ ${g.tool}`;
    const extra = g.candidates.length > 1 ? `（另有候选：${g.candidates.slice(1).join(', ')}）` : '';
    console.log(`  ${g.op.padEnd(16)} ${g.hint.padEnd(14)} ${status}${extra}`);
  }

  // spec 草稿：参数名用占位符，字段路径留空待人工填写。
  const ops: Record<string, { tool: string; args: Record<string, string> }> = {};
  for (const g of guesses) {
    if (g.tool === undefined) continue;
    const tool = tools.find((t) => t.name === g.tool);
    const required = tool?.inputSchema?.required ?? [];
    const args: Record<string, string> = {};
    for (const arg of required) {
      if (/lat/i.test(arg)) args[arg] = '{{lat}}';
      else if (/lo?n[gx]|lng/i.test(arg)) args[arg] = '{{lng}}';
      else if (/(shop|store|dept|branch).*id/i.test(arg)) args[arg] = '{{storeId}}';
      else if (/product.*id/i.test(arg)) args[arg] = '{{productId}}';
      else if (/sku/i.test(arg)) args[arg] = '{{skuCode}}';
      else if (/amount|quantity|count|num/i.test(arg)) args[arg] = '{{amount}}';
      else if (/list|items|products$/i.test(arg)) args[arg] = '{{lines}}';
      else if (/query|keyword|kw|text/i.test(arg)) args[arg] = '{{query}}';
      else if (/coupon/i.test(arg)) args[arg] = '{{coupons}}';
      else if (/remark|note|comment/i.test(arg)) args[arg] = '{{remark}}';
      else args[arg] = '';
    }
    ops[g.op] = { tool: g.tool, args };
  }

  const draft = {
    id,
    name,
    tagline: '（待填写）',
    mcpUrl: url,
    tokenHint: '（待填写：去哪里申请该品牌的 token）',
    requiresLocation: true,
    defaultLocation: { longitude: 120.1551, latitude: 30.2741 },
    orderNeedsLocation: /createOrder/i.test(Object.keys(ops).join(',')) ? true : false,
    specNote: `由 scripts/onboard.ts 于 ${new Date().toISOString()} 自动生成草稿：工具名已自动匹配，**字段路径（shapes）需要人工按真实响应填写**。`,
    ops,
    shapes: {},
  };

  console.log('\nspec 草稿：');
  console.log(JSON.stringify(draft, null, 2));

  if (flag('--write')) {
    const file = `${SPEC_DIR}/${id}.json`;
    writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    console.log(`\n已写入 ${file}`);
    console.log('下一步：填入 shapes（字段路径），然后重启站点即可看到该品牌。');
  } else {
    console.log('\n（加 --write 可直接写入 src/brands/specs/）');
  }
  process.exit(0);
}

void argValue;
await main();
