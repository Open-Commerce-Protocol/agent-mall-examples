/**
 * 对话服务：先聊天推荐，再挑品牌商品下单。
 *
 * 两级能力，绝不混淆：
 *   - **推荐级**（未绑定品牌）：拿不到任何菜单数据，只聊方向、给品类建议、引导选品牌。
 *   - **品牌级**（已绑定品牌会话）：能查真实门店/商品/规格，并能**暂存**订单。
 *
 * 安全铁律：两级都**没有 createOrder 能力**。模型/推荐器只能把订单"摆到访客面前"，
 * 真正的下单必须由人在页面上勾选确认（走 /api/order 的四道门）。
 *
 * 模型接入有两种协议：native（OpenAI function calling）与 prompted（提示词内 JSON），
 * 后者让任何纯文本补全接口都能参与工具调用。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, computeFingerprint, stageConfirmation, type Session } from '../session.ts';
import type { BrandAdapter, OrderLine, OptionGroup, PreviewSummary, Product, Store } from '../brands/types.ts';
import { BrandError } from '../brands/types.ts';

/* ------------------------------------------------------------- LLM 配置 */

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  mode: 'native' | 'prompted';
  authHeader: string;
  authPrefix: string;
  provider: string;
  credentialSource: string;
  enabled: boolean;
};

/**
 * 读取 DSH 账户凭据。
 *
 * DSH 的 deepseek-account 路由不用 Authorization: Bearer，而是自定义头
 * x-dsh-auth-token（见 @deepseek-ai/dsh-llm-deepseek-account 的 README）；
 * 端点仍是 https://api.deepseek.com，且 /v1/chat/completions 是 OpenAI 兼容形状。
 *
 * 好处：**完全不经过 DSH 的 agent**，所以公网访客的文本永远碰不到 shell 工具。
 * 只读凭据文件，不修改、不外传；token 只进内存。
 */
function loadDshAccountToken(): string | undefined {
  const file = process.env.DSH_CREDENTIALS_FILE ?? join(homedir(), '.dsh', '.credentials.yaml');
  try {
    const raw = readFileSync(file, 'utf8');
    return /^\s*token:\s*(\S+)/m.exec(raw)?.[1];
  } catch {
    return undefined;
  }
}

export function llmConfig(): LlmConfig {
  const provider = process.env.CHAT_LLM_PROVIDER ?? '';
  let baseUrl = (process.env.CHAT_LLM_BASE_URL ?? '').replace(/\/+$/, '');
  let apiKey = process.env.CHAT_LLM_API_KEY ?? '';
  let model = process.env.CHAT_LLM_MODEL ?? 'deepseek-chat';
  let authHeader = process.env.CHAT_LLM_AUTH_HEADER ?? 'authorization';
  let authPrefix = process.env.CHAT_LLM_AUTH_PREFIX ?? 'Bearer ';
  let credentialSource = 'env';

  if (provider === 'dsh-account') {
    baseUrl = baseUrl === '' ? 'https://api.deepseek.com/v1' : baseUrl;
    if (apiKey === '') {
      const token = loadDshAccountToken();
      if (token !== undefined) {
        apiKey = token;
        credentialSource = '~/.dsh/.credentials.yaml';
      }
    }
    authHeader = 'x-dsh-auth-token';
    authPrefix = '';
    if (process.env.CHAT_LLM_MODEL === undefined) model = 'deepseek-flash';
  }

  const mode = process.env.CHAT_LLM_MODE === 'prompted' ? 'prompted' : 'native';
  return {
    baseUrl,
    apiKey,
    model,
    mode,
    authHeader,
    authPrefix,
    provider: provider === '' ? 'openai-compatible' : provider,
    credentialSource,
    enabled: baseUrl !== '' && apiKey !== '',
  };
}

/** 按配置拼认证头——抽象出来是为了不再把 Bearer 写死在两个调用点里。 */
function authHeaders(config: LlmConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    [config.authHeader]: `${config.authPrefix}${config.apiKey}`,
  };
}

/* ------------------------------------------------------------- 消息类型 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

export type StagedOrder = {
  confirmToken: string;
  summary: PreviewSummary;
  store: { storeId: number; name: string; address: string; workHours?: string; distanceKm?: number };
  lines: OrderLine[];
  productName: string;
};

export type ChatTurn = {
  mode: 'llm' | 'fallback';
  /** 本轮处于哪个能力级别。 */
  phase: 'recommend' | 'brand';
  reply: string;
  /** 给界面看的工具调用轨迹，便于访客理解模型做了什么。 */
  trace: { tool: string; args: unknown; note: string }[];
  stagedOrder?: StagedOrder;
  /** 前端据此决定该不该弹出"选品牌 / 填 token"卡片。 */
  nextStep?: 'pick-brand' | 'confirm-order';
};

/** 已接入品牌的简介——推荐级模型要靠它引导访客选品牌。 */
export type BrandBrief = {
  id: string;
  name: string;
  tagline: string;
  status: string;
  canOrder: boolean;
  tokenHint: string;
};

/* --------------------------------------------------------------- 工具定义 */

/** 品牌级工具：全部无副作用，**没有 createOrder**。 */
function toolSpecs(): unknown[] {
  return [
    {
      type: 'function',
      function: {
        name: 'list_stores',
        description: '列出附近门店，返回门店 id、名称、地址、营业时段、距离与营业状态。下单前必须先确定门店。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_products',
        description: '在指定门店按关键字搜索商品。关键字要用具体商品词（如「拿铁」「生椰」），不要用「我想喝」这类口语。',
        parameters: {
          type: 'object',
          properties: { storeId: { type: 'integer' }, query: { type: 'string' } },
          required: ['storeId', 'query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'product_options',
        description: '读取某商品的全部可选规格（杯型/温度/糖度等）及其可选值与加价。',
        parameters: {
          type: 'object',
          properties: { storeId: { type: 'integer' }, productId: { type: 'integer' } },
          required: ['storeId', 'productId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'stage_order',
        description:
          '暂存一份订单并返回确认单（含实付金额与 confirmToken）。**这不会真的下单**，' +
          '只是把订单摆到访客面前等他点确认。推荐完商品、访客表示要买时调用它。',
        parameters: {
          type: 'object',
          properties: {
            storeId: { type: 'integer' },
            productId: { type: 'integer' },
            amount: { type: 'integer', minimum: 1, maximum: 10 },
            selections: {
              type: 'array',
              description: '要切换的规格；不传则用默认规格。',
              items: {
                type: 'object',
                properties: { attributeId: { type: 'integer' }, subAttributeId: { type: 'integer' } },
                required: ['attributeId', 'subAttributeId'],
              },
            },
          },
          required: ['storeId', 'productId'],
        },
      },
    },
  ];
}

/** 品牌级系统提示词。 */
function systemPrompt(brand: BrandAdapter, stores: Store[]): string {
  const open = stores.filter((s) => s.workStatus === undefined || s.workStatus === '营业中').slice(0, 5);
  return [
    `你是「${brand.name}」点单助手。品牌简介：${brand.tagline}。`,
    '你的任务：听懂访客想吃什么，用工具查真实菜单，给出 1-3 个具体推荐（带价格与理由），帮他把订单摆到面前。',
    '',
    '规则：',
    '1. 只用工具返回的真实数据说话，绝不编造商品、价格或规格。',
    '2. 搜商品时用具体商品词（「拿铁」「生椰」），别用「好喝的」这类模糊词。',
    '3. 访客明确要买时，调用 stage_order 暂存订单。**你不能直接下单**——下单要访客自己在页面上点确认。',
    '4. 回复用中文，简洁，不超过 120 字，不要罗列 JSON。',
    '5. 如果访客的需求在这家店满足不了，直说，并给出最接近的替代。',
    '',
    open.length > 0
      ? `附近可选门店（按距离）：${open.map((s) => `${s.name}(id=${s.storeId}, ${s.distanceKm ?? '?'}km, ${s.workHours ?? '?'})`).join('；')}`
      : '附近门店需先用 list_stores 查询。',
    `金额上限：单笔 ¥${LIMITS.maxOrderAmount}，单会话累计 ¥${LIMITS.maxSessionSpend}。`,
  ].join('\n');
}

/* ---------------------------------------------------------- 工具实现 */

type ToolContext = {
  /** 推荐级没有品牌绑定，因此这两个可以为空。 */
  adapter?: BrandAdapter;
  session?: Session;
  stores: Store[];
  /** 本轮 search_products 命中过的商品，供 stage_order 按 id 命中——避免瞎猜 sku。 */
  products: Map<number, Product>;
  brands: BrandBrief[];
  staged?: StagedOrder;
};

async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<{ note: string; payload: unknown }> {
  const adapter = ctx.adapter;
  const session = ctx.session;
  const mcp = session?.mcp;
  const num = (v: unknown): number => Number(v);

  /** 品牌级工具在未绑定时必须明确报错，而不是静默失败或编数据。 */
  const requireBrand = (): { adapter: BrandAdapter; session: Session } => {
    if (adapter === undefined || session === undefined) {
      throw new BrandError(
        'brand_not_bound',
        '当前是推荐级对话：还没有绑定品牌，拿不到真实菜单数据。请先选品牌并填入该品牌的 token。',
        409,
      );
    }
    return { adapter, session };
  };

  switch (name) {
    case 'list_brands': {
      return {
        note: `${ctx.brands.length} 个已接入品牌`,
        payload: ctx.brands.map((b) => ({
          id: b.id,
          name: b.name,
          tagline: b.tagline,
          canOrder: b.canOrder,
          status: b.status,
          tokenHint: b.tokenHint,
        })),
      };
    }
    case 'list_stores': {
      requireBrand();
      return { note: `${ctx.stores.length} 家门店`, payload: ctx.stores.slice(0, 10) };
    }
    case 'search_products': {
      const { adapter: bound } = requireBrand();
      const storeId = num(args.storeId);
      const query = String(args.query ?? '');
      const products = await bound.searchProducts(mcp as NonNullable<typeof mcp>, { storeId, query });
      for (const p of products) ctx.products.set(p.productId, p);
      return {
        note: `搜「${query}」得 ${products.length} 款`,
        payload: products.map((p) => ({ productId: p.productId, name: p.name, price: p.price, defaultSpecs: p.defaultSpecs })),
      };
    }
    case 'product_options': {
      const { adapter: bound } = requireBrand();
      const options = await bound.productOptions(mcp as NonNullable<typeof mcp>, {
        storeId: num(args.storeId),
        productId: num(args.productId),
      });
      return {
        note: `${options.length} 组规格`,
        payload: options.map((g: OptionGroup) => ({
          attributeId: g.attributeId,
          attributeName: g.attributeName,
          choices: g.choices.map((c) => ({ subAttributeId: c.subAttributeId, name: c.name, priceDelta: c.priceDelta })),
        })),
      };
    }
    case 'stage_order': {
      const { adapter: bound } = requireBrand();
      const storeId = num(args.storeId);
      const productId = num(args.productId);
      const amount = Number.isInteger(num(args.amount)) && num(args.amount) > 0 ? Math.min(num(args.amount), LIMITS.maxLineAmount) : 1;
      const store = ctx.stores.find((s) => s.storeId === storeId);
      if (store === undefined) throw new BrandError('unknown_store', `门店 ${storeId} 不在附近门店列表里`, 400);

      const product = ctx.products.get(productId);
      if (product === undefined || product.skuCode === undefined) {
        throw new BrandError('product_not_found', `商品 ${productId} 不在本轮搜索结果里，请先调用 search_products 再暂存订单`, 400);
      }

      const rawSelections = Array.isArray(args.selections) ? args.selections : [];
      const selections = rawSelections.map((item) => {
        const rec = (item ?? {}) as Record<string, unknown>;
        return { attributeId: num(rec.attributeId), subAttributeId: num(rec.subAttributeId) };
      });
      const sku = selections.length > 0
        ? (await bound.configure(mcp as NonNullable<typeof mcp>, { storeId, productId, skuCode: product.skuCode, amount, selections })).skuCode
        : product.skuCode;

      const lines: OrderLine[] = [{ productId, skuCode: sku, amount }];
      const summary = await bound.preview(mcp as NonNullable<typeof mcp>, { storeId, lines });
      summary.fingerprint = computeFingerprint(session.id, storeId, lines, summary.couponCodes);
      const pending = stageConfirmation(session, {
        fingerprint: summary.fingerprint,
        payable: summary.pricing.payable ?? 0,
        storeId,
        lines,
      });
      ctx.staged = {
        confirmToken: pending.confirmToken,
        summary,
        store: { storeId, name: store.name, address: store.address, workHours: store.workHours, distanceKm: store.distanceKm },
        lines,
        productName: product.name,
      };
      return {
        note: `已暂存订单，实付 ¥${summary.pricing.payable}`,
        payload: {
          ok: true,
          note: '订单已暂存，等待访客在页面上确认。你没有下单能力。',
          payable: summary.pricing.payable,
          specs: summary.lines[0]?.specs,
          pickupAtMs: summary.pickupAtMs,
        },
      };
    }
    default:
      throw new BrandError('unknown_tool', `未知工具 ${name}`, 400);
  }
}

/* ------------------------------------------------------------- LLM 调用 */

async function callLlm(config: LlmConfig, messages: ChatMessage[], tools: unknown[]): Promise<ChatMessage> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ model: config.model, messages, tools, tool_choice: 'auto', temperature: 0.3, max_tokens: 800 }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new BrandError('llm_error', `模型接口返回 ${res.status}：${text.slice(0, 200)}`, 502);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrandError('llm_bad_response', `模型接口返回了非 JSON：${text.slice(0, 160)}`, 502);
  }
  const message = parsed?.choices?.[0]?.message;
  if (message === undefined) throw new BrandError('llm_empty', `模型没有返回 message：${text.slice(0, 160)}`, 502);
  return message as ChatMessage;
}

/** prompted 模式用：单条 user 消息进、纯文本出。任何补全接口都该吃得下这个形状。 */
async function callLlmText(config: LlmConfig, prompt: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new BrandError('llm_error', `模型接口返回 ${res.status}：${text.slice(0, 200)}`, 502);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrandError('llm_bad_response', `模型接口返回了非 JSON：${text.slice(0, 160)}`, 502);
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new BrandError('llm_empty', `模型没有返回文本：${text.slice(0, 160)}`, 502);
  return content;
}

/* ------------------------------------------------- prompted 模式的工具协议 */

/**
 * 把工具清单写成提示词，让**任何纯文本补全接口**都能参与工具调用。
 * 为什么需要它：DSH 这类自有协议不一定支持 OpenAI 的 function calling。
 */
function toolCatalogText(tools: unknown[] = toolSpecs()): string {
  return [
    '你可以调用以下工具。需要调用时，**只输出一行 JSON**，不要有任何其它文字：',
    '{"tool":"工具名","args":{...}}',
    '',
    ...tools.map((spec) => {
      const fn = (spec as { function: { name: string; description: string; parameters: unknown } }).function;
      return `· ${fn.name}：${fn.description}\n  args 形状：${JSON.stringify(fn.parameters)}`;
    }),
    '',
    '不需要调用工具时，直接输出给访客看的中文回复即可（不要输出 JSON）。',
    '收到工具结果后，继续按上面的规则决定是再调工具还是给出最终回复。',
  ].join('\n');
}

/** 从模型输出里抽出「工具调用」；抽不到就说明这是最终回复。 */
export function parsePromptedCall(text: string): { tool: string; args: Record<string, unknown> } | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  const tail = text.slice(start);
  for (let end = tail.length; end > 1; end -= 1) {
    const slice = tail.slice(0, end);
    if (!slice.trimEnd().endsWith('}')) continue;
    try {
      const parsed = JSON.parse(slice) as { tool?: unknown; args?: unknown };
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, args: (parsed.args ?? {}) as Record<string, unknown> };
      }
    } catch {
      /* 不是完整 JSON，继续缩短 */
    }
  }
  return undefined;
}

/* --------------------------------------------------------- 本地回退推荐 */

const FILLER = /(我想|想要|要喝|想吃|来一?[杯个份]|推荐|建议|帮我|请|有什么|喝什么|吃什么|点一?[杯个份]|可以|吧|呢|吗|的|了|啊|一下|看看)/g;

/**
 * 从口语里抽出**有序的**检索候选词，长的优先。
 *
 * 单取一个词不够用：检索接口要求关键字真的出现在商品名/属性里，
 * 「我想喝生椰拿铁」直接拿去搜会 0 结果。所以先剥掉口语成分，再生成 n-gram 候选，
 * 由调用方逐个试到出结果为止。
 */
export function queryCandidates(message: string): string[] {
  const cleaned = message
    .replace(FILLER, ' ')
    .replace(/[，。！？、,.!?~～\s]+/g, ' ')
    .trim();
  const base = cleaned === '' ? message.trim() : cleaned;
  const out: string[] = [];
  const push = (value: string): void => {
    const text = value.trim();
    if (text.length >= 2 && !out.includes(text)) out.push(text);
  };

  push(base);
  for (const token of base.split(' ')) push(token);

  // 剥掉开头的动词（喝/吃/点/来/要/买），剩下的通常就是商品名。
  const stripped = base.replace(/^[吃喝点来要买]+/, '');
  push(stripped);

  // n-gram 兜底：从长到短，让「喝生椰拿铁」也能切出「生椰拿铁」。
  for (let length = stripped.length - 1; length >= 2; length -= 1) {
    for (let start = 0; start + length <= stripped.length; start += 1) {
      push(stripped.slice(start, start + length));
    }
  }
  return out.slice(0, 12);
}

/** 从口语里读出规格偏好。 */
function readPreferences(message: string): { temperature?: string; size?: string; sugar?: string } {
  const prefs: { temperature?: string; size?: string; sugar?: string } = {};
  if (/热|热的|温的/.test(message)) prefs.temperature = '热';
  else if (/冰|冷的/.test(message)) prefs.temperature = '冰';
  if (/超大杯|特大杯|大杯/.test(message)) prefs.size = /超大杯|特大杯/.test(message) ? '超大杯' : '大杯';
  if (/少糖|少甜|微糖|不另外加糖|无糖/.test(message)) prefs.sugar = '少甜';
  return prefs;
}

/** 品牌级在没有模型时的退路：关键词检索 + 真实菜单。 */
async function fallbackChat(ctx: ToolContext, message: string): Promise<ChatTurn> {
  const trace: ChatTurn['trace'] = [];
  // 只有品牌级才会走到这里（推荐级没有 adapter），故此处断言非空。
  const adapter = ctx.adapter as BrandAdapter;
  const session = ctx.session as Session;
  const mcp = session.mcp;
  const store = ctx.stores.find((s) => s.workStatus === undefined || s.workStatus === '营业中') ?? ctx.stores[0];
  if (store === undefined) {
    return { mode: 'fallback', phase: 'brand', reply: '没查到可用门店，请先刷新门店列表。', trace };
  }

  const candidates = queryCandidates(message);
  const firstCandidate = candidates[0] ?? message.trim();
  let query = firstCandidate;
  let products: Product[] = [];
  // 逐个候选试到出结果为止——口语直接搜通常 0 命中，必须靠候选词回退。
  for (const candidate of candidates.slice(0, 4)) {
    query = candidate;
    trace.push({ tool: 'search_products', args: { storeId: store.storeId, query: candidate }, note: '本地回退：按关键字检索真实菜单' });
    products = await adapter.searchProducts(mcp, { storeId: store.storeId, query: candidate });
    if (products.length > 0) break;
  }

  if (products.length === 0) {
    return {
      mode: 'fallback',
      phase: 'brand',
      reply:
        '（提示：当前未配置 LLM，这是基于菜单的关键词推荐）\n' +
        `在「${store.name}」没找到和「${firstCandidate}」相关的商品。换个更具体的词试试，比如「拿铁」「生椰」「奶茶」。`,
      trace,
    };
  }

  const top = products.slice(0, 3);
  const lines = top.map((p, i) => `${i + 1}. ${p.name}　${p.price !== undefined ? `¥${p.price}` : ''}${p.defaultSpecs ? `　默认 ${p.defaultSpecs}` : ''}`);
  const prefs = readPreferences(message);
  const prefText = Object.entries(prefs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k === 'temperature' ? '温度' : k === 'size' ? '杯型' : '糖度'}=${String(v)}`)
    .join('、');

  let staged: StagedOrder | undefined;
  if (/就(这|那)?个|要这个|下单|买了|来这个|第一个|第1/.test(message) || top.length === 1) {
    // 只有明确要买、或只有一个候选时才暂存订单——避免自作主张。
    try {
      const first = top[0] as Product;
      const options = await adapter.productOptions(mcp, { storeId: store.storeId, productId: first.productId });
      trace.push({ tool: 'product_options', args: { storeId: store.storeId, productId: first.productId }, note: `${options.length} 组规格` });
      const selections: { attributeId: number; subAttributeId: number }[] = [];
      for (const [key, want] of Object.entries(prefs)) {
        const group = options.find((g) =>
          key === 'temperature' ? /温度/.test(g.attributeName) : key === 'size' ? /杯型|规格/.test(g.attributeName) : /糖/.test(g.attributeName),
        );
        const choice = group?.choices.find((c) => c.name.includes(String(want)));
        if (group !== undefined && choice !== undefined) {
          selections.push({ attributeId: group.attributeId, subAttributeId: choice.subAttributeId });
        }
      }
      const sku = selections.length > 0 && first.skuCode !== undefined
        ? (await adapter.configure(mcp, { storeId: store.storeId, productId: first.productId, skuCode: first.skuCode, amount: 1, selections })).skuCode
        : first.skuCode;
      if (sku !== undefined) {
        const orderLines: OrderLine[] = [{ productId: first.productId, skuCode: sku, amount: 1 }];
        const summary = await adapter.preview(mcp, { storeId: store.storeId, lines: orderLines });
        summary.fingerprint = computeFingerprint(session.id, store.storeId, orderLines, summary.couponCodes);
        const pending = stageConfirmation(session, {
          fingerprint: summary.fingerprint,
          payable: summary.pricing.payable ?? 0,
          storeId: store.storeId,
          lines: orderLines,
        });
        staged = {
          confirmToken: pending.confirmToken,
          summary,
          store: { storeId: store.storeId, name: store.name, address: store.address, workHours: store.workHours, distanceKm: store.distanceKm },
          lines: orderLines,
          productName: first.name,
        };
        trace.push({ tool: 'stage_order', args: { storeId: store.storeId, productId: first.productId }, note: `已暂存，实付 ¥${summary.pricing.payable}` });
      }
    } catch {
      /* 暂存失败不影响推荐；下面的回复会提示 */
    }
  }

  const reply = [
    `（提示：当前未配置 LLM，这是基于「${store.name}」真实菜单的关键词推荐，不是模型对话）`,
    '',
    `按「${query}」找到 ${products.length} 款，推荐：`,
    ...lines,
    '',
    staged !== undefined
      ? `已按你的偏好${prefText !== '' ? `（${prefText}）` : ''}暂存：${staged.productName}，实付 ¥${staged.summary.pricing.payable}。`
      : prefText !== ''
        ? `记下你的偏好：${prefText}。`
        : '',
    `门店：${store.name}　${store.workHours ?? ''}　${store.distanceKm ?? '?'}km`,
    staged === undefined ? '想要哪一款？说「就要第一个」我就把它摆到确认单上。' : '已生成确认单，请在下面核对后点确认下单。',
  ].join('\n');

  return {
    mode: 'fallback',
    phase: 'brand',
    reply,
    trace,
    ...(staged !== undefined ? { stagedOrder: staged, nextStep: 'confirm-order' as const } : {}),
  };
}

/* ------------------------------------------------- 推荐级提示词与工具 */

function recommendSystemPrompt(brands: BrandBrief[]): string {
  return [
    '你是点单推荐助手，正在和访客聊天，帮他想清楚现在想吃什么、喝什么。',
    '',
    '**重要边界（务必遵守）**：你此刻**还没有拿到任何品牌的菜单权限**，所以：',
    '1. 可以基于常识聊口味、场景、天气、提神/解腻/暖胃等，给出**品类层面**的建议；',
    '2. **绝不能**报出具体商品名、价格或库存——那些要等访客选好品牌并填入该品牌 token 后才能查；',
    '3. 不要编造商品。被问到具体有什么时，就说"接上品牌我帮你查"。',
    '',
    '风格：短、有主张、一次给 2-3 个方向，别追问一堆问题。可以先问一两个关键信息（比如想喝还是想吃、要不要提神）。',
    '',
    '当访客表达出方向后，引导他从下面这些已接入品牌里选一个：',
    ...brands.map((b) => `· ${b.name}（id=${b.id}）：${b.tagline}。${b.canOrder ? '已接通下单' : '尚未接通下单'}。token：${b.tokenHint}`),
    '',
    '访客说要选某个品牌时，回复里明确说出品牌名，并提示他点页面上的「选品牌并填 token」。',
  ].join('\n');
}

function recommendTools(): unknown[] {
  return [
    {
      type: 'function',
      function: {
        name: 'list_brands',
        description: '列出本站已接入的品牌、各自能否下单、以及去哪里申请 token。访客问"能点哪些/有哪些品牌"时调用。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];
}

/* ------------------------------------------------------------------ 循环 */

/**
 * 跑一轮 LLM 对话（native / prompted 两种协议共用的循环）。
 * 安全铁律：工具集合里永远没有 createOrder。
 */
async function runLlmLoop(
  config: LlmConfig,
  system: string,
  tools: unknown[],
  history: { role: 'user' | 'assistant'; text: string }[],
  message: string,
  ctx: ToolContext,
  phase: 'recommend' | 'brand',
): Promise<ChatTurn> {
  const trace: ChatTurn['trace'] = [];
  const finish = (reply: string): ChatTurn => ({
    mode: 'llm',
    phase,
    reply,
    trace,
    ...(ctx.staged !== undefined ? { stagedOrder: ctx.staged, nextStep: 'confirm-order' as const } : {}),
    ...(ctx.staged === undefined && phase === 'recommend' ? { nextStep: 'pick-brand' as const } : {}),
  });

  if (config.mode === 'native') {
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...history.map((h): ChatMessage => ({ role: h.role, content: h.text })),
      { role: 'user', content: message },
    ];
    for (let round = 0; round < 6; round += 1) {
      const reply = await callLlm(config, messages, tools);
      messages.push(reply);
      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) return finish((reply.content ?? '').trim() || '（模型没有给出文字回复）');

      for (const call of calls) {
        let payload: unknown;
        let note = '';
        try {
          const args = call.function.arguments === '' ? {} : (JSON.parse(call.function.arguments) as Record<string, unknown>);
          const result = await runTool(ctx, call.function.name, args);
          payload = result.payload;
          note = result.note;
          trace.push({ tool: call.function.name, args, note });
        } catch (error) {
          payload = { error: error instanceof Error ? error.message : String(error) };
          note = `失败：${String((error as Error).message).slice(0, 60)}`;
          trace.push({ tool: call.function.name, args: {}, note });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
      }
    }
    return finish('（工具调用轮数用尽，请把问题说得更具体一点）');
  }

  const transcript: string[] = [`系统指令：\n${system}\n\n${toolCatalogText(tools)}`];
  for (const h of history) transcript.push(`${h.role === 'user' ? '访客' : '你'}：${h.text}`);
  transcript.push(`访客：${message}`);

  for (let round = 0; round < 6; round += 1) {
    const reply = await callLlmText(config, transcript.join('\n\n'));
    const call = parsePromptedCall(reply);
    if (call === undefined) return finish(reply.trim() || '（模型没有给出文字回复）');

    let payload: unknown;
    let note = '';
    try {
      const result = await runTool(ctx, call.tool, call.args);
      payload = result.payload;
      note = result.note;
      trace.push({ tool: call.tool, args: call.args, note });
    } catch (error) {
      payload = { error: error instanceof Error ? error.message : String(error) };
      note = `失败：${String((error as Error).message).slice(0, 60)}`;
      trace.push({ tool: call.tool, args: call.args, note });
    }
    transcript.push(`你输出：${reply}`);
    transcript.push(`工具结果（${call.tool}）：${JSON.stringify(payload).slice(0, 2000)}`);
    transcript.push('请继续：按规则要么再输出一行 JSON 调工具，要么给出给访客看的中文回复。');
  }
  return finish('（工具调用轮数用尽，请把问题说得更具体一点）');
}

/* ------------------------------------------------------------------ 出口 */

/** 品牌级：已绑定品牌会话，能查真实门店/商品/规格，能暂存订单。 */
export async function runChat(
  session: Session,
  adapter: BrandAdapter,
  message: string,
  history: { role: 'user' | 'assistant'; text: string }[] = [],
  brands: BrandBrief[] = [],
): Promise<ChatTurn> {
  const stores = await adapter.listStores(session.mcp, session.location);
  const ctx: ToolContext = { adapter, session, stores, products: new Map(), brands };
  const config = llmConfig();
  if (!config.enabled) return fallbackChat(ctx, message);
  return runLlmLoop(config, systemPrompt(adapter, stores), toolSpecs(), history, message, ctx, 'brand');
}

/**
 * 统一入口——**新流程的正确起点**。
 *
 * 未绑定品牌 → 推荐级：只聊方向、引导选品牌，拿不到任何商品数据。
 * 已绑定品牌 → 品牌级：查真实菜单并暂存订单。
 */
export async function runChatTurn(
  input: {
    brands: BrandBrief[];
    session?: Session;
    adapter?: BrandAdapter;
    history?: { role: 'user' | 'assistant'; text: string }[];
  },
  message: string,
): Promise<ChatTurn> {
  const history = input.history ?? [];
  const config = llmConfig();

  if (input.session !== undefined && input.adapter !== undefined) {
    return runChat(input.session, input.adapter, message, history, input.brands);
  }

  /* ---- 推荐级 ---- */
  if (!config.enabled) {
    return {
      mode: 'fallback',
      phase: 'recommend',
      reply:
        '（提示：当前未配置 LLM，无法做对话式推荐）\n\n已接入的品牌：\n' +
        input.brands.map((b) => `· ${b.name} — ${b.tagline}${b.canOrder ? '' : '（尚未接通下单）'}`).join('\n') +
        '\n\n选一个品牌并填入它的 token，我就能查真实菜单帮你挑。',
      trace: [],
      nextStep: 'pick-brand',
    };
  }

  const ctx: ToolContext = { stores: [], products: new Map(), brands: input.brands };
  return runLlmLoop(config, recommendSystemPrompt(input.brands), recommendTools(), history, message, ctx, 'recommend');
}
