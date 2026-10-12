/**
 * Agent 核心:规则 NLU(确定性,路演可控)+ 任务状态机 + 执行轨迹。
 * 阶段:PARSED → PLAN_AWAIT_CONFIRM → ORDER_AWAIT_PAY → PAID →
 *       INVOICE_AWAIT_CONFIRM → INVOICE_SUBMITTED → INVOICE_ISSUED →
 *       EMAIL_RECEIVED → ARCHIVED(done)
 * 任何失败不伪装成功(PRD 铁律)。
 */
import { CATALOGS, type Item } from './catalogs';
import { FALLBACK_DRINKS, type McpDrink } from './luckin_mcp';

export type Phase =
  | 'IDLE' | 'PARSED' | 'PLAN_AWAIT_CONFIRM' | 'ORDER_AWAIT_PAY' | 'PAID'
  | 'INVOICE_AWAIT_CONFIRM' | 'INVOICE_SUBMITTED' | 'INVOICE_ISSUED' | 'EMAIL_RECEIVED' | 'ARCHIVED'
  | 'FAILED';

export type TraceEntry = { at: string; source: 'user' | 'agent' | 'ocp' | 'merchant' | 'system' | 'mail' | 'fs'; text: string };

export type ParsedNeed = {
  raw: string;
  intent: 'procurement';
  item_query: string;
  budget?: number;
  quantity: number;
  require_invoice: boolean;
  invoice_title_type: 'personal' | 'organization';
  invoice_title: string;
  invoice_tax_id?: string;
  email: string;
  /** 团购场景:总人数(≥2 触发团购模式) */
  people_total?: number | null;
  /** 其中不喝咖啡的人数(需要非咖啡替代) */
  non_coffee?: number | null;
  /** 其中不喝冰的人数(需要热饮) */
  no_ice?: number | null;
  /** 用途(如「课题组报销」) */
  purpose?: string | null;
};

/** 团购方案选项(生成多套供用户选择) */
export type GroupOption = {
  id: string;
  label: string;
  lines: Array<{ title: string; qty: number; unit_price: number; list_price?: number; hot?: boolean; noncoffee?: boolean; note?: string; product_id?: number; sku_code?: string }>;
  total: number;
  remaining: number;
  rationale: string;
};

export type PlanItem = { item: Item; catalog_id: string; catalog_name: string; mount: string; reason: string };
export type Excluded = { title: string; catalog_name: string; reason: string };

export type Plan = {
  need: ParsedNeed;
  candidates: PlanItem[];
  recommended: PlanItem[];
  excluded: Excluded[];
  total: number;
  within_budget: boolean;
  rationale: string;
  /** true = 商家均不提供开票接口,方案采用「购买 + 本地模拟开票」回退 */
  invoice_fallback: boolean;
  /** 团购模式:多套候选方案(供选择);null = 普通单品流程 */
  group_options: GroupOption[] | null;
  /** 当前选中的团购方案原始数据(CSV/TODO 归档用) */
  group_chosen?: GroupOption | null;
  /** 菜单数据来源(团购模式) */
  menu_source?: 'real-mcp' | 'local-fallback';
};

export type Order = {
  order_id: string;
  catalog_id: string;
  catalog_name: string;
  mount: string;
  lines: Array<{ title: string; amount: number; object_id: string; qty?: number; product_id?: number; sku_code?: string }>;
  total: number;
  paid: boolean;
  /** 真实订单(瑞幸 MCP createOrder):支付走微信扫码,状态自动检测 */
  real?: boolean;
  mcp_order_id?: string;
  pay_qr_url?: string;
  pay_url?: string;
  pay_status_name?: string;
};
export type InvoiceInfo = { invoice_id: string; status: string; title: string; email: string; history: Array<{ at: string; note: string }> };
export type Archive = { dir: string; files: string[]; archived_at: string } | null;

export type TaskState = {
  phase: Phase;
  need: ParsedNeed | null;
  plan: Plan | null;
  order: Order | null;
  invoice: InvoiceInfo | null;
  archive: Archive;
  trace: TraceEntry[];
  error: string | null;
};

let state: TaskState = { phase: 'IDLE', need: null, plan: null, order: null, invoice: null, archive: null, trace: [], error: null };
let invoicePollTimer: ReturnType<typeof setInterval> | null = null;
/** 由 server.ts 注入的回调,避免循环依赖 */
let hooks: {
  ocpQuery: (mount: string, body: unknown) => Promise<{ status: number; body: any }>;
  resolveCheckout: (mount: string, entryId: string) => Promise<any>;
  resolveWorkflow: (order: Order, need: ParsedNeed) => Promise<{ denied: boolean; url?: string; note?: string }>;
  luckinMenu: () => Promise<{ drinks: McpDrink[]; source: 'real-mcp' | 'local-fallback'; note?: string }>;
  realOrderEnabled: () => boolean;
  createGroupOrder: (
    lines: Array<{ object_id: string; title: string; amount: number; qty?: number; product_id?: number; sku_code?: string }>,
    catalog: { catalog_id: string; catalog_name: string; mount: string },
    opts: { real: boolean; remark: string },
  ) => Promise<{ order_id: string; real?: boolean; mcp_order_id?: string; pay_qr_url?: string; pay_url?: string }>;
  checkPayment: (mcpOrderId: string) => Promise<{ paid: boolean; cancelled: boolean; status_name: string }>;
  cancelRealOrder: (mcpOrderId: string) => Promise<boolean>;
  createOrder: (mount: string, lines: Array<{ object_id: string; title: string; amount: number }>) => Promise<{ order_id: string }>;
  payOrder: (orderId: string) => void;
  submitInvoice: (order: Order, need: ParsedNeed) => Promise<{ invoice_id: string }>;
  submitInvoiceLocal: (order: Order, need: ParsedNeed) => Promise<{ invoice_id: string }>;
  getInvoice: (id: string) => any;
  fetchInvoiceFile: (id: string) => Promise<string>;
  archiveFiles: (order: Order, invoiceHtml: string, invoiceId: string, need: ParsedNeed) => Promise<{ dir: string; files: string[] }>;
} | null = null;

export function setHooks(h: NonNullable<typeof hooks>) {
  hooks = h;
}

function log(source: TraceEntry['source'], text: string) {
  state.trace.push({ at: new Date().toISOString(), source, text });
}

export const getState = () => state;

/** 供 server 在钩子抛错时把任务置为 FAILED(而非 500 裸堆栈) */
export function failTask(message: string) {
  stopPaymentPolling();
  state.phase = 'FAILED';
  state.error = message;
  log('merchant', `❌ ${message}`);
  return state;
}

export function reset() {
  if (invoicePollTimer) clearInterval(invoicePollTimer);
  invoicePollTimer = null;
  stopPaymentPolling();
  state = { phase: 'IDLE', need: null, plan: null, order: null, invoice: null, archive: null, trace: [], error: null };
  log('system', '任务已重置');
}

// ---------------------------------------------------------------- NLU(规则式,确定性)

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function numOrCn(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, num = 0;
  for (const ch of s) {
    if (ch === '十') { total += (num || 1) * 10; num = 0; }
    else if (ch === '百') { total += (num || 1) * 100; num = 0; }
    else if (CN_NUM[ch] !== undefined) num = CN_NUM[ch];
  }
  return total + num || 1;
}

/** 从话术中提取预算:支持「100预算 / 预算100 / 100元以内 / 100元(独立出现) / 一百预算」 */
function parseBudget(raw: string): number | undefined {
  // 中文数字优先(避免「预算6个人」里的 6 被误当预算)
  const cn = raw.match(/([一二两三四五六七八九十百]{1,4})\s*(?:元|块)?\s*(?:预算|以内)|预算\s*([一二两三四五六七八九十百]{1,4})(?=\D|$)/);
  if (cn) return numOrCn(cn[1] || cn[2]);
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?\s*预算|预算\D*?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块)以内/);
  if (m) return Number(m[1] ?? m[2] ?? m[3]);
  const yuan = raw.match(/(\d+(?:\.\d+)?)\s*(?:元|块)(?=[,，。;;\s]|$)/);
  if (yuan) return Number(yuan[1]);
  return undefined;
}

export function parseNeed(raw: string): ParsedNeed {
  const budget = parseBudget(raw);
  const require_invoice = /发票|开票|报销/.test(raw);
  const isOrg = /大学|学院|实验室|单位|公司|课题组/.test(raw);
  const univ = raw.match(/([一-龥]{2,8}(?:大学|学院))/);
  const univClean = univ?.[1].replace(/^(?:随后|接着|然后|帮我|我|请|申请|抬头|发票|开|的|了|为|给|到|要|需|并|且|送)+/, '');
  const lab = raw.match(/([一-龥]{2,6}实验室)/);
  const invoice_title = univClean || lab?.[1]?.replace(/^(?:的|内|以|元)+/, '') || (isOrg ? '浙江大学' : '个人');
  const emailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const qty = raw.match(/([一二两三四五六七八九\d]+)\s*(?:套|杯|件|个)/);
  const quantity = qty ? (['一', '1'].includes(qty[1]) ? 1 : ['二', '两', '2'].includes(qty[1]) ? 2 : Number(qty[1]) || 1) : 1;
  // 团购:总人数 / 不喝咖啡人数 / 不喝冰人数 / 用途
  const pm = raw.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个|位|名)?\s*人/);
  const people_total = pm ? numOrCn(pm[1]) : null;
  const nc = raw.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个|位)?\s*人?\s*不喝咖啡/);
  const non_coffee = nc ? numOrCn(nc[1]) : null;
  const ni = raw.match(/(\d+|[一二两三四五六七八九十]+)\s*(?:个|位)?\s*人?\s*不喝(?:冰|冷)/);
  const no_ice = ni ? numOrCn(ni[1]) : null;
  const purposeM = raw.match(/([一-龥]{2,8}报销)/);
  const purpose = purposeM?.[1] ?? (/报销/.test(raw) ? '报销用' : null);
  const isCoffee = /咖啡|拿铁|美式|奶茶|果茶|茶/.test(raw);
  const item_query = isCoffee ? '咖啡' : /电子配件|配件|电阻|面包板|杜邦|万用表|模块/.test(raw) ? '电子配件' : raw.slice(0, 12);
  return {
    raw,
    intent: 'procurement',
    item_query,
    budget,
    quantity,
    require_invoice,
    invoice_title_type: isOrg ? 'organization' : 'personal',
    invoice_title,
    invoice_tax_id: isOrg ? '12100000470095XXX(测试税号)' : undefined,
    email: emailMatch?.[0] ?? 'lab-zjg@test.edu.cn',
    people_total,
    non_coffee,
    no_ice,
    purpose,
  };
}

// ---------------------------------------------------------------- 阶段 A:采购

export async function startTask(raw: string) {
  reset();
  const need = parseNeed(raw);
  state.need = need;
  state.phase = 'PARSED';
  log('user', `采购需求:「${raw}」`);
  log('agent', `任务理解:${need.item_query} ×${need.quantity}${need.budget ? ` / 预算 ¥${need.budget}` : ''}${need.require_invoice ? ` / 需要${need.invoice_title_type === 'organization' ? '单位' : '个人'}发票(${need.invoice_title}) / 收件 ${need.email}` : ''}`);
  if (need.people_total && need.people_total >= 2 && /咖啡|瑞幸|奶茶|茶/.test(raw)) {
    return await startGroupTask(need);
  }

  const candidates: PlanItem[] = [];
  const excluded: Excluded[] = [];
  for (const cat of CATALOGS) {
    const res = await hooks!.ocpQuery(cat.mount, { query: need.item_query, query_pack: 'ocp.query.keyword.v1', limit: 20 });
    log('ocp', `POST ${cat.mount}/ocp/query(query="${need.item_query}") → ${res.status},${res.body?.result_count ?? 0} 条`);
    for (const e of res.body?.entries ?? []) {
      const entry = e.entry;
      const item = cat.items.find((x) => x.id === entry.object_id)!;
      candidates.push({ item, catalog_id: cat.catalog_id, catalog_name: cat.catalog_name, mount: cat.mount, reason: e.explain?.[0] ?? '命中' });
    }
  }

  const recommended: PlanItem[] = [];
  for (const c of candidates) {
    const it = c.item;
    if (it.availability === 'out_of_stock') {
      excluded.push({ title: it.title, catalog_name: c.catalog_name, reason: '缺货(out_of_stock)' });
      continue;
    }
    if (need.require_invoice && !it.invoice_supported) {
      excluded.push({ title: it.title, catalog_name: c.catalog_name, reason: `不支持在线开票(${it.invoice_note ?? '未开放'})` });
      continue;
    }
    if (need.budget !== undefined && it.amount > need.budget) {
      excluded.push({ title: it.title, catalog_name: c.catalog_name, reason: `超预算(¥${it.amount} > ¥${need.budget})` });
      continue;
    }
    recommended.push(c);
  }
  // 回退:所有候选仅因「不支持开票」被排除时,转为「购买 + 本地模拟开票」方案
  let invoice_fallback = false;
  if (!recommended.length && need.require_invoice) {
    const passOther = candidates.filter((c) => {
      const ex = excluded.find((e) => e.title === c.item.title);
      return !ex || ex.reason.includes('开票');
    });
    if (passOther.length) {
      invoice_fallback = true;
      const picked = passOther.slice(0, Math.max(need.quantity, 1));
      recommended.push(...picked);
      log('agent', `⚠️ 所有候选商家均不提供开票接口(与实测瑞幸 MCP 一致)。回退方案:正常购买 + CampusNow 本地模拟开票(非商家开具、非正式税务凭证),需用户知情确认。`);
    }
  }

  // 套装推荐:实验基础三件套优先,凑成「一套」
  const set = recommended.filter((r) => ['e-001', 'e-002', 'e-003'].includes(r.item.id));
  const finalPlan = set.length === 3 ? set : recommended.slice(0, 3);
  const total = finalPlan.reduce((s, r) => s + r.item.amount, 0);

  state.plan = {
    need, candidates, recommended: finalPlan, excluded, total,
    within_budget: need.budget === undefined || total <= need.budget,
    invoice_fallback,
    rationale: finalPlan.length
      ? `推荐 ${finalPlan.length} 件,合计 ¥${total.toFixed(2)}${invoice_fallback ? ';商家无开票接口,将生成【本地模拟收据】(非正式税务凭证)' : need.require_invoice ? ';全部支持在线开票' : ''}。`
      : '没有同时满足预算与开票条件的商品。',
  };
  state.phase = 'PLAN_AWAIT_CONFIRM';
  log('agent', `形成采购方案:${state.plan.rationale}${excluded.length ? ` 剔除 ${excluded.length} 项(${excluded.map((e) => `${e.title}:${e.reason}`).join(';')})。` : ''}`);
  return state;
}

// ---------------------------------------------------------------- 团购模式(多人/忌口/多方案)

/** 由真实菜单池生成三套方案:经济款 / 人气款 / 满配款(全部满足人数与忌口约束) */
function generateGroupOptions(need: ParsedNeed, drinks: McpDrink[]): GroupOption[] {
  const budget = need.budget ?? Infinity;
  const total = need.people_total ?? 6;
  const nonCoffeeN = Math.min(need.non_coffee ?? 0, total);
  const coffeeN = total - nonCoffeeN;
  const noIceN = Math.min(need.no_ice ?? 0, total);

  const coffees = drinks.filter((d) => d.coffee).sort((a, b) => a.price - b.price || a.list_price - b.list_price);
  const noncoffees = drinks.filter((d) => !d.coffee).sort((a, b) => a.price - b.price || a.list_price - b.list_price);
  // 到手价全场拉平时(如瑞幸全场 9.9 促销),经济/满配按划线价拉开梯度
  const flatPrice = new Set(coffees.map((d) => d.price)).size <= 1;
  const byList = (arr: McpDrink[], desc: boolean) => [...arr].sort((a, b) => (desc ? b.list_price - a.list_price : a.list_price - b.list_price));
  const ecoCoffeePool = flatPrice ? byList(coffees, false) : coffees;
  const premCoffeePool = flatPrice ? byList(coffees, true) : coffees;
  if (!coffees.length || (nonCoffeeN > 0 && !noncoffees.length)) return [];

  const mkLine = (d: McpDrink, qty: number, hot = false, note = '') => ({
    title: d.title, qty, unit_price: d.price, list_price: d.list_price,
    hot: hot || undefined, noncoffee: !d.coffee || undefined, note: note || undefined,
    product_id: d.product_id, sku_code: d.sku_code,
  });
  const sum = (lines: GroupOption['lines']) => Number(lines.reduce((s, l) => s + l.unit_price * l.qty, 0).toFixed(2));

  /** 给咖啡中恰好一杯标「热」(不喝冰的人):优先拿铁类;若目标行多杯则拆出单独一杯 */
  const markHot = (lines: GroupOption['lines']) => {
    if (noIceN > 0) {
      const target = lines.find((l) => /拿铁|澳白|摩卡|卡布/.test(l.title) && !l.noncoffee) ?? lines.find((l) => !l.noncoffee);
      if (target) {
        if (target.qty > 1) {
          target.qty -= 1;
          lines.push({ ...target, qty: 1, hot: true, note: '选热(不喝冰的成员)' });
        } else {
          target.hot = true;
          target.note = '选热(不喝冰的成员)';
        }
      }
    }
    for (const l of lines) if (l.noncoffee && !l.note) l.note = '不含咖啡(不喝咖啡的成员)';
    return lines;
  };

  const options: GroupOption[] = [];

  // A 经济款:最便宜的咖啡×2 品种 + 最便宜非咖
  const ecoCoffees = [ecoCoffeePool[0], ecoCoffeePool[1] ?? ecoCoffeePool[0]].map((d, i) => mkLine(d, i === 0 ? Math.ceil(coffeeN / 2) : coffeeN - Math.ceil(coffeeN / 2)));
  const ecoNon = nonCoffeeN ? [mkLine(noncoffees[0], nonCoffeeN)] : [];
  const ecoLines = markHot([...ecoCoffees, ...ecoNon]);
  options.push({ id: 'A', label: '经济款', lines: ecoLines, total: sum(ecoLines), remaining: 0, rationale: `最实惠组合:${coffeeN} 杯咖啡 + ${nonCoffeeN} 杯非咖啡替代,预算内最省。` });

  // B 人气款:招牌(原创)优先 + 中价非咖
  const popular = coffees.filter((d) => /原创|生椰|厚乳|黄油/.test(d.title));
  const popC1 = popular[0] ?? coffees[Math.min(2, coffees.length - 1)];
  const popC2 = popular[1] ?? coffees[0];
  const popNon = nonCoffeeN ? [mkLine(noncoffees[Math.min(1, noncoffees.length - 1)], nonCoffeeN)] : [];
  const popLines = markHot([mkLine(popC1, Math.ceil(coffeeN / 2)), mkLine(popC2, coffeeN - Math.ceil(coffeeN / 2)), ...popNon]);
  options.push({ id: 'B', label: '人气款', lines: popLines, total: sum(popLines), remaining: 0, rationale: `招牌优先:含人气款「${popC1.title}」,口感均衡,大家都有得喝。` });

  // C 满配款:从最贵往下凑,贴着预算但不超(全场同价时按划线价取「名义最贵」组合)
  let premLines: GroupOption['lines'] = [];
  let idx = premCoffeePool.length - 1, left = coffeeN;
  while (left > 0 && idx >= 0) { const q = Math.min(left, 2); premLines.push(mkLine(premCoffeePool[idx], q)); left -= q; idx--; }
  if (left > 0) premLines.push(mkLine(premCoffeePool[0], left));
  if (nonCoffeeN) premLines.push(mkLine(noncoffees[noncoffees.length - 1], nonCoffeeN));
  markHot(premLines);
  // 预算约束:超了就把最贵的线换成最便宜的,直到达标
  let guard = 10;
  while (sum(premLines) > budget && guard-- > 0) {
    const expensive = [...premLines].sort((a, b) => b.unit_price - a.unit_price).find((l) => !l.noncoffee);
    if (!expensive) break;
    expensive.title = coffees[0].title; expensive.unit_price = coffees[0].price; expensive.list_price = coffees[0].list_price;
  }
  options.push({ id: 'C', label: '满配款', lines: premLines, total: sum(premLines), remaining: 0, rationale: `贴近预算上限的好选择,预算利用率最高。` });

  for (const o of options) o.remaining = Number((budget === Infinity ? 0 : budget - o.total).toFixed(2));
  return options;
}

/** 把选中的团购方案转成与单品流程同构的 plan(兼容既有 UI/开票/归档链路) */
function optionToPlan(need: ParsedNeed, opt: GroupOption): Plan {
  const luckin = { catalog_id: 'cat_luckin_demo', catalog_name: '瑞幸咖啡铺(浙大紫金港店)', mount: '/luckin' };
  return {
    need,
    candidates: [],
    recommended: opt.lines.map((l) => ({
      item: {
        id: `mcp_${l.title}`, title: `${l.title}${l.qty > 1 ? ` ×${l.qty}` : ''}`, summary: l.note ?? '',
        category: l.noncoffee ? 'non_coffee' : 'coffee', currency: 'CNY' as const,
        amount: Number((l.unit_price * l.qty).toFixed(2)),
        availability: 'in_stock' as const,
        tags: [l.hot ? '热饮' : '常规', ...(l.noncoffee ? ['无咖啡'] : []), ...(l.list_price && l.list_price > l.unit_price ? [`划线价¥${l.list_price}`] : [])],
        invoice_supported: false, invoice_note: '瑞幸未提供 Agent 开票接口(实测 MCP 无开票工具)',
        url: 'https://open.lkcoffee.com/mcp', updated_at: new Date().toISOString(),
      },
      ...luckin,
      reason: l.note ?? '真实菜单(瑞幸 MCP)',
    })),
    excluded: [],
    total: opt.total,
    within_budget: need.budget === undefined || opt.total <= need.budget,
    invoice_fallback: true,
    group_options: null,
    group_chosen: opt,
    rationale: `团购方案「${opt.label}」:${opt.total.toFixed(2)} 元 / ${need.people_total} 人${need.purpose ? ` · 用途:${need.purpose}` : ''}。`,
  };
}

async function startGroupTask(need: ParsedNeed) {
  log('agent', `团购模式:${need.people_total} 人 · ${need.non_coffee ?? 0} 人不喝咖啡 · ${need.no_ice ?? 0} 人不喝冰${need.purpose ? ` · 用途「${need.purpose}」` : ''}。正在拉取瑞幸真实菜单…`);
  const menu = await hooks!.luckinMenu();
  const drinks = menu.drinks.length ? menu.drinks : FALLBACK_DRINKS;
  log(menu.source === 'real-mcp' ? 'merchant' : 'system', `菜单来源:${menu.source}(${menu.note ?? ''};可用咖啡款 ${drinks.filter((d) => d.coffee).length} / 非咖啡款 ${drinks.filter((d) => !d.coffee).length})`);

  const options = generateGroupOptions(need, drinks).filter((o) => need.budget === undefined || o.total <= need.budget);
  if (!options.length) {
    state.phase = 'FAILED';
    state.error = '预算内无法凑齐满足人数与忌口约束的组合';
    log('agent', '❌ 无法生成合规方案:预算不足。');
    return state;
  }
  const plan = optionToPlan(need, options[0]);
  plan.group_options = options;
  plan.menu_source = menu.source;
  state.plan = plan;
  state.phase = 'PLAN_AWAIT_CONFIRM';
  log('agent', `生成 ${options.length} 套方案:${options.map((o) => `${o.label} ¥${o.total}(余 ¥${o.remaining})`).join(' | ')}。默认推荐「${options[0].label}」,等待用户选择…`);
  return state;
}

/** 用户在多套方案中选择一套 */
export async function choosePlan(optionId: string) {
  if (state.phase !== 'PLAN_AWAIT_CONFIRM' || !state.plan?.group_options?.length || !state.need) return state;
  const opt = state.plan.group_options.find((o) => o.id === optionId) ?? state.plan.group_options[0];
  const prevSource = state.plan.menu_source;
  state.plan = optionToPlan(state.need, opt);
  state.plan.group_options = null;
  state.plan.menu_source = prevSource;
  log('user', `选择了方案「${opt.label}」(¥${opt.total})`);
  log('agent', `方案已切换为「${opt.label}」,等待确认下单。`);
  return state;
}



export async function confirmPlan() {
  if (state.phase !== 'PLAN_AWAIT_CONFIRM' || !state.plan?.recommended.length) return state;
  log('user', '确认采购方案');

  // 团购分支:商品来自瑞幸真实 MCP 菜单;真实模式经 MCP createOrder 下真单,否则模拟
  if (state.plan.group_chosen) {
    const opt = state.plan.group_chosen;
    const real = state.plan.menu_source === 'real-mcp' && hooks!.realOrderEnabled();
    log('agent', `下单依据:瑞幸 MCP 真实菜单(${state.plan.menu_source === 'real-mcp' ? '实时拉取' : '本地降级数据'});按 OCP resolve(checkout) 的动作治理语义执行:需用户确认、有时效。`);
    if (state.plan.menu_source !== 'real-mcp') {
      log('system', '菜单为本地降级数据,订单将以模拟方式创建(不调用真实下单接口)。');
    }
    const lines = opt.lines.map((l) => ({
      object_id: `p_${l.product_id ?? l.title}`,
      title: `${l.title}${l.qty > 1 ? ` ×${l.qty}` : ''}`,
      amount: Number((l.unit_price * l.qty).toFixed(2)),
      qty: l.qty,
      product_id: l.product_id,
      sku_code: l.sku_code,
    }));
    const order = await hooks!.createGroupOrder(lines, {
      catalog_id: 'cat_luckin_demo',
      catalog_name: '瑞幸咖啡铺(浙大紫金港店)',
      mount: '/luckin',
    }, { real, remark: `CampusNow 团购·${state.need?.purpose ?? '演示'}` }).catch((e: unknown) => {
      const msg = String(e);
      if (msg.includes('未支付订单')) {
        throw new Error('瑞幸账户存在未支付订单,商家拒绝新单:请在瑞幸 App/微信支付该订单或等它自动过期(约 15 分钟)后重试。');
      }
      throw e;
    });
    state.order = {
      order_id: order.order_id,
      catalog_id: 'cat_luckin_demo',
      catalog_name: '瑞幸咖啡铺(浙大紫金港店)',
      mount: '/luckin',
      lines,
      total: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
      paid: false,
      real: order.real,
      mcp_order_id: order.mcp_order_id,
      pay_qr_url: order.pay_qr_url,
      pay_url: order.pay_url,
      pay_status_name: order.real ? '待付款' : undefined,
    };
    state.phase = 'ORDER_AWAIT_PAY';
    if (order.real) {
      log('merchant', `真实订单已创建(瑞幸 MCP):${order.mcp_order_id} · ${opt.label} · 合计 ¥${state.order.total.toFixed(2)} · 待扫码支付。`);
      log('system', '请用微信扫描支付二维码完成付款;系统每 3 秒自动检测支付状态,未支付前可随时撤单(不产生费用)。');
      startPaymentPolling();
    } else {
      log('merchant', `团购模拟订单 ${order.order_id} 已创建:${opt.label},合计 ¥${state.order.total.toFixed(2)}(共 ${lines.reduce((s, l) => s + (l.qty ?? 1), 0)} 杯,待支付)`);
    }
    return state;
  }

  const first = state.plan.recommended[0];
  const res = await hooks!.resolveCheckout(first.mount, `entry_${CATALOGS.find((c) => c.mount === first.mount)!.provider_id}_${first.item.id}`);
  log('ocp', `POST ${first.mount}/ocp/resolve(purpose=checkout) → 200,动作 ${res.action_bindings?.[0]?.action_type}:${res.action_bindings?.[0]?.entrypoint?.method} ${res.action_bindings?.[0]?.entrypoint?.url}`);
  log('agent', '下单动作已获取,requires_user_confirmation=true,创建待支付订单…');
  const lines = state.plan.recommended.map((r) => ({ object_id: r.item.id, title: r.item.title, amount: r.item.amount }));
  const order = await hooks!.createOrder(first.mount, lines);
  const cat = CATALOGS.find((c) => c.mount === first.mount)!;
  state.order = {
    order_id: order.order_id,
    catalog_id: cat.catalog_id,
    catalog_name: cat.catalog_name,
    mount: first.mount,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    paid: false,
  };
  state.phase = 'ORDER_AWAIT_PAY';
  log('merchant', `订单 ${order.order_id} 已创建(待支付,模拟)· 合计 ¥${state.order.total.toFixed(2)}`);
  return state;
}

export function payOrder() {
  if (state.phase !== 'ORDER_AWAIT_PAY' || !state.order) return state;
  if (state.order.real) {
    log('user', '触发支付状态检查(真实订单请扫码支付,系统自动检测到账)');
    void checkPayment();
    return state;
  }
  log('user', '用户完成模拟支付');
  hooks!.payOrder(state.order.order_id);
  state.order.paid = true;
  state.phase = 'PAID';
  log('merchant', `订单 ${state.order.order_id} 状态 → 已支付(测试)`);
  if (state.need?.require_invoice) {
    state.phase = 'INVOICE_AWAIT_CONFIRM';
    log('agent', '检测到开票需求,已填好开票资料,等待用户核对…');
  }
  return state;
}

// ---- 真实订单:支付状态自动检测 + 手动检查 + 撤单 ----

let paymentTimer: ReturnType<typeof setInterval> | null = null;

function startPaymentPolling() {
  stopPaymentPolling();
  paymentQueryMisses = 0;
  paymentTimer = setInterval(() => void checkPayment(), 3000);
}
function stopPaymentPolling() {
  if (paymentTimer) clearInterval(paymentTimer);
  paymentTimer = null;
}

let paymentQueryMisses = 0;

export async function checkPayment() {
  if (!state.order?.real || !state.order.mcp_order_id || state.phase !== 'ORDER_AWAIT_PAY') return state;
  try {
    const r = await hooks!.checkPayment(state.order.mcp_order_id);
    paymentQueryMisses = 0;
    if (r.status_name && r.status_name !== state.order.pay_status_name) {
      state.order.pay_status_name = r.status_name;
      log('merchant', `真实订单状态:${r.status_name}`);
    }
    if (r.cancelled) {
      stopPaymentPolling();
      state.phase = 'FAILED';
      state.error = `真实订单已被取消(${state.order.mcp_order_id})。可重置任务重新发起。`;
      return state;
    }
    if (r.paid) {
      stopPaymentPolling();
      state.order.paid = true;
      state.phase = 'PAID';
      log('merchant', `✅ 支付已确认(瑞幸订单 ${state.order.mcp_order_id} 状态:${r.status_name})。`);
      log('system', `取餐码请以瑞幸 App/短信为准;本演示继续走本地模拟开票归档(真实订单也可在瑞幸 App 内人工申请正式发票)。`);
      if (state.need?.require_invoice) {
        state.phase = 'INVOICE_AWAIT_CONFIRM';
        log('agent', '检测到开票需求,已填好开票资料,等待用户核对…');
      }
    }
  } catch (e) {
    if (String(e).includes('未找到')) {
      // 连续多次查无此单才判定作废(容忍瞬时抖动);瑞幸未支付订单约 15 分钟自动过期
      paymentQueryMisses++;
      if (paymentQueryMisses >= 5) {
        stopPaymentPolling();
        state.phase = 'FAILED';
        state.error = `订单 ${state.order.mcp_order_id} 未支付超时,已自动作废(零费用)。可重新发起任务。`;
        log('merchant', `瑞幸侧已无此订单(连续 ${paymentQueryMisses} 次查询未找到,未支付超时自动作废),停止轮询。`);
      } else {
        log('system', `订单查询未找到(第 ${paymentQueryMisses}/5 次,可能是瞬时抖动),继续观察…`);
      }
    } else {
      log('system', `支付状态查询失败(将继续重试):${String(e).slice(0, 80)}`);
    }
  }
  return state;
}

export async function cancelRealOrder() {
  if (!state.order?.real || !state.order.mcp_order_id) return state;
  stopPaymentPolling();
  try {
    const ok = await hooks!.cancelRealOrder(state.order.mcp_order_id);
    if (ok) {
      state.phase = 'FAILED';
      state.error = `真实订单 ${state.order.mcp_order_id} 已撤销(未支付,零费用)。`;
      log('merchant', `订单已撤销:${state.order.mcp_order_id}(未支付,不产生任何费用)`);
    } else {
      log('merchant', `撤单失败:${state.order.mcp_order_id}(可能已支付,已支付的订单无法撤销)`);
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('已取消')) {
      state.phase = 'FAILED';
      state.error = `订单 ${state.order.mcp_order_id} 已取消(未支付,零费用)。`;
      log('merchant', `订单已取消:${state.order.mcp_order_id}(瑞幸确认,零费用)`);
    } else if (msg.includes('未找到')) {
      state.phase = 'FAILED';
      state.error = `订单 ${state.order.mcp_order_id} 已自动过期作废(未支付,零费用)。`;
      log('merchant', `瑞幸侧已无此订单(未支付超时自动作废):${state.order.mcp_order_id},零费用。`);
    } else {
      state.phase = 'FAILED';
      state.error = `撤单失败:${msg.slice(0, 100)}`;
      log('merchant', `撤单异常:${msg.slice(0, 100)}`);
    }
  }
  return state;
}

// ---------------------------------------------------------------- 阶段 C:开票

export async function confirmInvoice() {
  if (state.phase !== 'INVOICE_AWAIT_CONFIRM' || !state.order || !state.need) return state;
  log('user', `确认开票资料:${state.need.invoice_title_type === 'organization' ? '单位' : '个人'} · ${state.need.invoice_title}${state.need.invoice_tax_id ? ` · ${state.need.invoice_tax_id}` : ''} · ${state.need.email}`);

  // 回退分支:商家无开票接口 → 本地模拟开票,不调商家服务
  if (state.plan?.invoice_fallback) {
    log('ocp', `POST ${state.order.mount}/ocp/resolve(purpose=workflow) → permission_state=denied:商家未声明开票能力(实测瑞幸 MCP 亦无开票工具)`);
    log('agent', '启用本地模拟开票:生成显著标注的模拟收据文件,不伪装成商家发票…');
    const inv = await hooks!.submitInvoiceLocal(state.order, state.need);
    state.invoice = { invoice_id: inv.invoice_id, status: 'submitted', title: state.need.invoice_title, email: state.need.email, history: [{ at: new Date().toISOString(), note: '本地模拟开票已启动' }] };
    state.phase = 'INVOICE_SUBMITTED';
    log('merchant', `本地模拟开票 ${inv.invoice_id}(标注:非商家开具、非正式税务凭证)`);
    startInvoicePolling(inv.invoice_id);
    return state;
  }

  const res = await hooks!.resolveWorkflow(state.order, state.need);
  if (res.denied) {
    state.phase = 'FAILED';
    state.error = `商家拒绝开票:${res.note}`;
    log('ocp', `resolve(purpose=workflow) → permission_state=denied:${res.note}`);
    return state;
  }
  log('ocp', `POST ${state.order.mount}/ocp/resolve(purpose=workflow) → 200,动作 workflow:${res.url}`);
  const inv = await hooks!.submitInvoice(state.order, state.need);
  state.invoice = { invoice_id: inv.invoice_id, status: 'submitted', title: state.need.invoice_title, email: state.need.email, history: [{ at: new Date().toISOString(), note: '已提交' }] };
  state.phase = 'INVOICE_SUBMITTED';
  log('merchant', `开票申请 ${inv.invoice_id} 已提交(测试服务)`);
  startInvoicePolling(inv.invoice_id);
  return state;
}

function startInvoicePolling(invoiceId: string) {
  invoicePollTimer = setInterval(async () => {
    const inv = hooks!.getInvoice(invoiceId);
    if (!inv) return;
    if (state.invoice && inv.status !== state.invoice.status) {
      state.invoice.status = inv.status;
      state.invoice.history = inv.history.map((h: any) => ({ at: h.at, note: h.note }));
      log(inv.status === 'emailed' ? 'mail' : 'merchant', `开票状态 → ${inv.status}(${inv.history.at(-1)?.note ?? ''})`);
      if (inv.status === 'issued') state.phase = 'INVOICE_ISSUED';
      if (inv.status === 'emailed') {
        state.phase = 'EMAIL_RECEIVED';
        clearInterval(invoicePollTimer!);
        invoicePollTimer = null;
        await archive(invoiceId);
      }
      // 本地模拟开票:issued 即归档,无邮件环节
      if (inv.local && inv.status === 'issued') {
        clearInterval(invoicePollTimer!);
        invoicePollTimer = null;
        await archive(invoiceId);
      }
    }
  }, 700);
}

// ---------------------------------------------------------------- 阶段 D:归档

async function archive(invoiceId: string) {
  try {
    const html = await hooks!.fetchInvoiceFile(invoiceId);
    log('agent', `已从邮件附件下载测试发票(${html.length} 字节)`);
    const res = await hooks!.archiveFiles(state.order!, html, invoiceId, state.need!);
    state.archive = { dir: res.dir, files: res.files, archived_at: new Date().toISOString() };
    state.phase = 'ARCHIVED';
    log('fs', `归档完成:${res.dir}/(${res.files.map((f) => f.split('/').pop()).join(', ')})`);
    log('agent', '任务完成:发票文件已写入本地并与订单关联 ✅');
  } catch (e) {
    state.phase = 'FAILED';
    state.error = `归档失败:${String(e)}`;
    log('fs', `归档失败:${String(e)}`);
  }
}

