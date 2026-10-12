/**
 * OCP Catalog 读面处理器（discovery / manifest / health / contracts / query / resolve）。
 *
 * 响应形状严格对齐官方 TypeScript 最小示例（_spec/server.ts），
 * resolve 额外携带 buy_now 下单 action binding（参考 _spec/resolve-actions.md）。
 */
const crypto = require('node:crypto');
const {
  CATALOG_ID,
  CATALOG_NAME,
  PROVIDER_ID,
  entryId,
  findProductByEntryId,
  allProducts,
} = require('./store');

/**
 * 构造 OCP 读面处理器集合。
 * @param {string} baseUrl 服务对外基础 URL（如 http://127.0.0.1:8800），用于拼接端点与 action 地址
 * @returns {OcpHandlers} 各读面处理函数，返回纯数据对象（错误分支返回 {__error, status} 标记）
 */
function createOcpHandlers(baseUrl) {
  const BASE = baseUrl.replace(/\/$/, '');

  /** 组装单个 CatalogEntry（纯数据映射） */
  function toEntry(product) {
    return {
      kind: 'CatalogEntry',
      catalog_id: CATALOG_ID,
      entry_id: entryId(product.id),
      provider_id: PROVIDER_ID,
      object_id: product.id,
      object_type: 'ocp.commerce.product',
      title: product.title,
      summary: product.summary,
      attributes: {
        brand: product.brand,
        category: product.category,
        price: { currency: product.currency, amount: product.amount },
        inventory: { availability_status: product.availability },
        product_url: product.url,
        image_url: `${BASE}/images/${product.id}.svg`,
      },
    };
  }

  /**
   * GET /.well-known/ocp-catalog —— 目录发现
   * @returns {object} WellKnownCatalogDiscovery
   */
  function discovery() {
    return {
      ocp_version: '1.0',
      kind: 'WellKnownCatalogDiscovery',
      catalog_id: CATALOG_ID,
      catalog_name: CATALOG_NAME,
      manifest_url: `${BASE}/ocp/manifest`,
      health_url: `${BASE}/ocp/health`,
      query_url: `${BASE}/ocp/query`,
      resolve_url: `${BASE}/ocp/resolve`,
      contracts_url: `${BASE}/ocp/contracts`,
    };
  }

  /**
   * GET /ocp/manifest —— 能力清单
   * @returns {object} CatalogManifest
   */
  function manifest() {
    return {
      ocp_version: '1.0',
      kind: 'CatalogManifest',
      id: `manifest_${CATALOG_ID}`,
      catalog_id: CATALOG_ID,
      catalog_name: CATALOG_NAME,
      description: '寇豆码 OCP Catalog 演示节点：内存商品 + 关键词检索 + Agent 自助下单。',
      registry_visibility: 'public',
      endpoints: {
        health: { url: `${BASE}/ocp/health`, method: 'GET' },
        query: { url: `${BASE}/ocp/query`, method: 'POST' },
        resolve: { url: `${BASE}/ocp/resolve`, method: 'POST' },
        contracts: { url: `${BASE}/ocp/contracts`, method: 'GET' },
      },
      query_capabilities: [
        {
          capability_id: 'ocp.koudou.product.search.v1',
          name: '关键词商品搜索',
          description: '对内存商品列表的标题、摘要、品牌、品类做大小写不敏感的关键词匹配。',
          query_packs: [
            {
              pack_id: 'ocp.query.keyword.v1',
              description: '对 title / summary / brand / category 的关键词检索。',
              query_modes: ['keyword'],
            },
          ],
          supports_explain: true,
          supports_resolve: true,
        },
      ],
      object_contracts: [],
    };
  }

  /**
   * GET /ocp/health —— 存活探针
   * @returns {object} CatalogHealth
   */
  function health() {
    return {
      ocp_version: '1.0',
      kind: 'CatalogHealth',
      catalog_id: CATALOG_ID,
      status: 'healthy',
      ready: true,
      checked_at: new Date().toISOString(),
    };
  }

  /**
   * GET /ocp/contracts —— 对象契约列表（只读节点，返回空）
   * @returns {object} ObjectContractList
   */
  function contracts() {
    return {
      ocp_version: '1.0',
      kind: 'ObjectContractList',
      catalog_id: CATALOG_ID,
      object_contracts: [],
      note: '只读演示节点，不接受 provider 对象摄取。',
    };
  }

  /**
   * POST /ocp/query —— 关键词检索。
   * @param {{query?: string, limit?: number}} body 请求体
   * @returns {object} CatalogQueryResult
   */
  function query(body) {
    const term = String(body.query ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 50);
    const products = allProducts();
    // 多词查询按空格拆分为 token，要求每个 token 都命中（AND 语义）
    const tokens = term ? term.split(/\s+/).filter(Boolean) : [];
    const matches = tokens.length
      ? products.filter((p) =>
          tokens.every((t) =>
            [p.title, p.summary, p.brand, p.category].some((f) =>
              f.toLowerCase().includes(t),
            ),
          ),
        )
      : products;
    const page = matches.slice(0, limit);
    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      id: `qry_${crypto.randomUUID()}`,
      catalog_id: CATALOG_ID,
      query_pack: 'ocp.query.keyword.v1',
      query_mode: 'keyword',
      query: String(body.query ?? ''),
      result_count: page.length,
      page: { limit, offset: 0, has_more: matches.length > page.length },
      entries: page.map((product) => ({
        entry: toEntry(product),
        score: 1,
        explain: [`Keyword match for "${String(body.query ?? '')}".`],
      })),
    };
  }

  /**
   * POST /ocp/resolve —— 将一个 entry 解析为可执行引用（含 action bindings）。
   * @param {{entry_id?: string}} body 请求体
   * @returns {{__error?: object, status?: number, data?: object}} 成功返回 {data}，失败返回 {__error, status}
   */
  function resolve(body) {
    const targetEntryId = String(body.entry_id ?? '');
    const product = findProductByEntryId(targetEntryId);
    if (!product) {
      return {
        __error: {
          code: 'not_found',
          message: `Unknown entry_id: ${targetEntryId || '(missing)'}`,
        },
        status: 404,
      };
    }
    const now = new Date().toISOString();
    const data = {
      ocp_version: '1.0',
      kind: 'ResolvableReference',
      id: `res_${crypto.randomUUID()}`,
      catalog_id: CATALOG_ID,
      entry_id: entryId(product.id),
      commercial_object_id: `co_${product.id}`,
      object_id: product.id,
      object_type: 'ocp.commerce.product',
      provider_id: PROVIDER_ID,
      title: product.title,
      visible_attributes: {
        brand: product.brand,
        category: product.category,
        price: { currency: product.currency, amount: product.amount },
        availability: product.availability,
      },
      action_bindings: [
        {
          action_id: 'buy_now',
          action_type: 'api',
          label: '立即下单',
          url: `${BASE}/ocp/actions/buy_now`,
          method: 'POST',
          input_schema: `${BASE}/schemas/buy-now-request.json`,
        },
        {
          action_id: 'view',
          action_type: 'url',
          label: '查看商品',
          entrypoint: { url: product.url, method: 'GET' },
        },
      ],
      freshness: { object_updated_at: product.updatedAt, resolved_at: now },
      // 解析结果是短时效引用：一小时后过期。
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    return { data };
  }

  return { toEntry, discovery, manifest, health, contracts, query, resolve };
}

module.exports = { createOcpHandlers };
