/**
 * 两个 OCP Catalog Node 定义:瑞幸咖啡铺(不支持 Agent 开票——真实写照)
 * 与校园电子配件铺(支持开票)。每个目录暴露六个协议端点,
 * 响应形状对齐 @ocp-catalog/ocp-schema。
 */
export type Item = {
  id: string;
  title: string;
  summary: string;
  category: string;
  currency: 'CNY';
  amount: number;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock';
  tags: string[];
  invoice_supported: boolean;
  invoice_note?: string;
  url: string;
  updated_at: string;
};

export type CatalogDef = {
  mount: string; // 路由前缀,如 /elec
  catalog_id: string;
  catalog_name: string;
  description: string;
  provider_id: string;
  items: Item[];
};

const LUCKIN_ITEMS: Item[] = [
  { id: 'lk-001', title: '生椰拿铁', summary: '椰浆与浓缩咖啡,清甜顺滑。', category: 'coffee', currency: 'CNY', amount: 18, availability: 'in_stock', tags: ['热门', '微糖'], invoice_supported: false, invoice_note: 'App 内人工申请开票,未开放 Agent 接口', url: 'https://lk.demo.menu/lk-001', updated_at: '2026-10-08T02:00:00.000Z' },
  { id: 'lk-002', title: '燕麦拿铁', summary: '植物基燕麦奶,不太甜。', category: 'coffee', currency: 'CNY', amount: 19, availability: 'in_stock', tags: ['不太甜', '植物基'], invoice_supported: false, invoice_note: 'App 内人工申请开票,未开放 Agent 接口', url: 'https://lk.demo.menu/lk-002', updated_at: '2026-10-08T02:00:00.000Z' },
  { id: 'lk-005', title: '橙C美式', summary: '鲜橙汁配美式,酸爽提神。', category: 'coffee', currency: 'CNY', amount: 15, availability: 'in_stock', tags: ['酸爽', '维C'], invoice_supported: false, invoice_note: 'App 内人工申请开票,未开放 Agent 接口', url: 'https://lk.demo.menu/lk-005', updated_at: '2026-10-08T02:00:00.000Z' },
  { id: 'lk-009', title: '柠檬冰萃茶', summary: '整颗柠檬现捣,解腻。', category: 'fruit_tea', currency: 'CNY', amount: 12, availability: 'in_stock', tags: ['酸爽', '不太甜'], invoice_supported: false, invoice_note: 'App 内人工申请开票,未开放 Agent 接口', url: 'https://lk.demo.menu/lk-009', updated_at: '2026-10-08T02:00:00.000Z' },
];

const ELEC_ITEMS: Item[] = [
  { id: 'e-001', title: '面包板套装(830孔×3)', summary: '高中密度面包板三连包,免焊接原型搭建。', category: 'prototyping', currency: 'CNY', amount: 12, availability: 'in_stock', tags: ['电子配件', '基础', '实验必备'], invoice_supported: true, url: 'https://campus-elec.demo/e-001', updated_at: '2026-10-10T08:00:00.000Z' },
  { id: 'e-002', title: '杜邦线(120根混装)', summary: '公对公/公对母/母对母各40根,连接实验必备。', category: 'prototyping', currency: 'CNY', amount: 9.9, availability: 'in_stock', tags: ['电子配件', '基础', '实验必备'], invoice_supported: true, url: 'https://campus-elec.demo/e-002', updated_at: '2026-10-10T08:00:00.000Z' },
  { id: 'e-003', title: '电阻电容常用值套装', summary: '1%精度电阻40种+常用电容,实验室散件补货首选。', category: 'components', currency: 'CNY', amount: 25, availability: 'in_stock', tags: ['电子配件', '散件', '套装'], invoice_supported: true, url: 'https://campus-elec.demo/e-003', updated_at: '2026-10-10T08:00:00.000Z' },
  { id: 'e-004', title: 'USB 数字功率计', summary: 'USB-A/C 双口功率电压电流测量。', category: 'tools', currency: 'CNY', amount: 39, availability: 'in_stock', tags: ['电子配件', '测量'], invoice_supported: false, invoice_note: '该商家此品类暂不支持在线开票', url: 'https://campus-elec.demo/e-004', updated_at: '2026-10-10T08:00:00.000Z' },
  { id: 'e-005', title: '便携示波器(入门款)', summary: '单通道 200kHz,课程实验够用。', category: 'tools', currency: 'CNY', amount: 399, availability: 'in_stock', tags: ['电子配件', '大型'], invoice_supported: true, url: 'https://campus-elec.demo/e-005', updated_at: '2026-10-10T08:00:00.000Z' },
  { id: 'e-006', title: '蓝牙模块 HC-05', summary: '经典串口透传蓝牙模块。', category: 'modules', currency: 'CNY', amount: 18, availability: 'out_of_stock', tags: ['电子配件', '模块'], invoice_supported: true, url: 'https://campus-elec.demo/e-006', updated_at: '2026-10-09T08:00:00.000Z' },
  { id: 'e-007', title: '数字万用表(自动量程)', summary: '三位半自动量程,日常检修。', category: 'tools', currency: 'CNY', amount: 59, availability: 'in_stock', tags: ['电子配件', '测量'], invoice_supported: true, url: 'https://campus-elec.demo/e-007', updated_at: '2026-10-10T08:00:00.000Z' },
];

export const CATALOGS: CatalogDef[] = [
  {
    mount: '/elec',
    catalog_id: 'cat_campus_electronics',
    catalog_name: '校园电子配件铺(紫金港)',
    description: '实验室电子配件 OCP 目录;全品类支持电子发票在线申请(workflow resolve)。',
    provider_id: 'campus_elec_zjg',
    items: ELEC_ITEMS,
  },
  {
    mount: '/luckin',
    catalog_id: 'cat_luckin_demo',
    catalog_name: '瑞幸咖啡铺(浙大紫金港店)',
    description: '咖啡饮品目录;开票仅支持 App 内人工申请,未开放 Agent 接口。',
    provider_id: 'luckin_zjg_store',
    items: LUCKIN_ITEMS,
  },
];

// --------------------------------------------------------------- 协议响应构造

const KEYWORD_PACK = 'ocp.query.keyword.v1';
const FILTER_PACK = 'campus.query.filter.v1';

export function wellKnown(def: CatalogDef, base: string) {
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: def.catalog_id,
    catalog_name: def.catalog_name,
    manifest_url: `${base}${def.mount}/ocp/manifest`,
    health_url: `${base}${def.mount}/ocp/health`,
    query_url: `${base}${def.mount}/ocp/query`,
    resolve_url: `${base}${def.mount}/ocp/resolve`,
    contracts_url: `${base}${def.mount}/ocp/contracts`,
  };
}

export function manifest(def: CatalogDef, base: string) {
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${def.catalog_id}`,
    catalog_id: def.catalog_id,
    catalog_name: def.catalog_name,
    description: def.description,
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${base}${def.mount}/ocp/health`, method: 'GET' },
      query: { url: `${base}${def.mount}/ocp/query`, method: 'POST' },
      resolve: { url: `${base}${def.mount}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${base}${def.mount}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: `${def.provider_id}.search.v1`,
        name: `${def.catalog_name} search`,
        description: 'Keyword + filter 检索;filter pack 支持标准 category/max_amount/in_stock_only 及扩展 invoice_supported。',
        query_packs: [
          { pack_id: KEYWORD_PACK, description: '关键词检索 title/summary/tags。', query_modes: ['keyword'] },
          { pack_id: FILTER_PACK, description: '结构化筛选,含开票能力筛选(前向扩展)。', query_modes: ['filter'] },
        ],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    object_contracts: [],
  };
}

export const health = (def: CatalogDef) => ({
  ocp_version: '1.0',
  kind: 'CatalogHealth',
  catalog_id: def.catalog_id,
  status: 'healthy',
  ready: true,
  checked_at: new Date().toISOString(),
});

export const contracts = (def: CatalogDef) => ({
  ocp_version: '1.0',
  kind: 'ObjectContractList',
  catalog_id: def.catalog_id,
  object_contracts: [],
  note: `${def.catalog_name}:发票能力以条目 attributes.invoice_supported 为准,支持项可经 resolve(purpose=workflow) 获取开票动作。`,
});

const entryId = (def: CatalogDef, it: Item) => `entry_${def.provider_id}_${it.id}`;

export function toEntry(def: CatalogDef, it: Item) {
  return {
    kind: 'CatalogEntry',
    catalog_id: def.catalog_id,
    entry_id: entryId(def, it),
    provider_id: def.provider_id,
    object_id: it.id,
    object_type: 'ocp.commerce.product',
    title: it.title,
    summary: it.summary,
    attributes: {
      category: it.category,
      price: { currency: it.currency, amount: it.amount },
      inventory: { availability_status: it.availability },
      tags: it.tags,
      invoice_supported: it.invoice_supported,
      invoice_note: it.invoice_note ?? null,
      product_url: it.url,
    },
  };
}

const text = (it: Item) => [it.title, it.summary, it.category, ...it.tags].join(' ').toLowerCase();

export function query(def: CatalogDef, body: Record<string, unknown>): { status: number; body: unknown } {
  const pack = (body.query_pack as string | undefined) ?? KEYWORD_PACK;
  if (![KEYWORD_PACK, FILTER_PACK].includes(pack)) {
    return { status: 400, body: { error: { code: 'invalid_request', message: `Undeclared query_pack "${pack}"` } } };
  }
  if (((body.offset as number | undefined) ?? 0) !== 0) {
    return { status: 400, body: { error: { code: 'invalid_request', message: 'offset 翻页未支持(offset 必须为 0)' } } };
  }
  const filters = (body.filters as Record<string, unknown> | undefined) ?? {};
  const limit = Math.min(Math.max((body.limit as number | undefined) ?? 20, 1), 50);

  let matched: Array<{ it: Item; score: number; why: string }>;
  if (pack === FILTER_PACK) {
    matched = def.items
      .filter((it) => {
        if (filters.category && it.category !== filters.category) return false;
        if (filters.max_amount !== undefined && it.amount > Number(filters.max_amount)) return false;
        if (filters.in_stock_only === true && it.availability === 'out_of_stock') return false;
        if (filters.invoice_supported === true && !it.invoice_supported) return false;
        return true;
      })
      .map((it) => ({ it, score: 1, why: `filter ${JSON.stringify(filters)}` }));
  } else {
    const q = String(body.query ?? '').trim().toLowerCase();
    matched = def.items
      .map((it) => {
        const t = text(it);
        if (q && t.includes(q)) return { it, score: 1, why: `命中「${q}」` };
        const grams = q.length >= 2 ? q.match(/.{2}/g) ?? [] : q ? [q] : [];
        const hits = grams.filter((g) => t.includes(g)).length;
        return { it, score: grams.length ? Number((hits / grams.length).toFixed(2)) : 0.5, why: `关键词部分命中 ${hits}/${grams.length}` };
      })
      .filter((m) => m.score >= 0.3);
  }

  const page = matched.slice(0, limit);
  return {
    status: 200,
    body: {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: def.catalog_id,
      query_pack: pack,
      query_mode: pack === FILTER_PACK ? 'filter' : 'keyword',
      query: String(body.query ?? ''),
      result_count: page.length,
      page: { limit, offset: 0, has_more: matched.length > page.length },
      entries: page.map((m) => ({ entry: toEntry(def, m.it), score: m.score, explain: [m.why] })),
    },
  };
}

export function resolve(def: CatalogDef, base: string, body: Record<string, unknown>): { status: number; body: unknown } {
  const it = def.items.find((x) => `entry_${def.provider_id}_${x.id}` === body.entry_id);
  if (!it) {
    return { status: 404, body: { error: { code: 'not_found', message: `Unknown entry_id: ${String(body.entry_id ?? '')}` } } };
  }
  const purpose = String(body.purpose ?? 'view');
  const now = new Date();
  const common = {
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: `res_${crypto.randomUUID()}`,
    catalog_id: def.catalog_id,
    entry_id: entryId(def, it),
    commercial_object_id: `co_${it.id}`,
    object_id: it.id,
    object_type: 'ocp.commerce.product',
    provider_id: def.provider_id,
    title: it.title,
    visible_attributes: {
      category: it.category,
      price: { currency: it.currency, amount: it.amount },
      availability: it.availability,
      invoice_supported: it.invoice_supported,
    },
    live_checks: [{ check_id: `chk_${it.id}`, status: it.availability === 'out_of_stock' ? 'failed' : 'passed', checked_at: now.toISOString(), summary: `库存:${it.availability}` }],
    freshness: { object_updated_at: it.updated_at, resolved_at: now.toISOString() },
    expires_at: new Date(now.getTime() + 3600_000).toISOString(),
  };

  if (purpose === 'view') {
    return {
      status: 200,
      body: {
        ...common,
        action_bindings: [{ action_id: 'view', action_type: 'url', label: '查看商品', entrypoint: { url: it.url, method: 'GET' }, requires_user_confirmation: false }],
      },
    };
  }
  if (purpose === 'checkout') {
    return {
      status: 200,
      body: {
        ...common,
        expires_at: new Date(now.getTime() + 600_000).toISOString(),
        action_bindings: [{
          action_id: 'order',
          action_type: 'api',
          label: `下单一套「${it.title}」(模拟)`,
          entrypoint: { url: `${base}${def.mount}/shop/order`, method: 'POST' },
          input_schema: { object_id: 'string', quantity: 'integer', confirmation: 'boolean,必须 true' },
          auth_requirements: { payment: 'mock' },
          requires_user_confirmation: true,
          expires_at: new Date(now.getTime() + 600_000).toISOString(),
        }],
      },
    };
  }
  if (purpose === 'workflow') {
    if (!it.invoice_supported) {
      return {
        status: 200,
        body: {
          ...common,
          action_bindings: [],
          access: { visibility: 'public', permission_state: 'denied', redacted_fields: [], policy_notes: [`该商品不支持在线开票:${it.invoice_note ?? '商家未开放'}`] },
        },
      };
    }
    return {
      status: 200,
      body: {
        ...common,
        expires_at: new Date(now.getTime() + 600_000).toISOString(),
        action_bindings: [{
          action_id: 'request_invoice',
          action_type: 'workflow',
          label: `为「${it.title}」申请电子发票(测试)`,
          description: '开票属于商家工作流(非 OCP 标准动作);提交抬头/税号/邮箱,结果为测试发票,非正式税务凭证。',
          entrypoint: { url: `${base}${def.mount}/shop/invoice`, method: 'POST' },
          input_schema: { order_id: 'string', title_type: 'personal|organization', title: 'string', tax_id: 'string?', email: 'string' },
          auth_requirements: {},
          requires_user_confirmation: true,
          expires_at: new Date(now.getTime() + 600_000).toISOString(),
        }],
      },
    };
  }
  return { status: 400, body: { error: { code: 'invalid_request', message: `purpose "${purpose}" 不支持` } } };
}
