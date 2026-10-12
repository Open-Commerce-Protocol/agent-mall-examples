/**
 * Agent 编排 + OCP 客户端。
 *
 * 协议纪律（关键）：Agent 不直连商品数据，一切通过 HTTP 调用本服务的
 * OCP 端点完成 query → resolve → action 三阶段；下单必须使用 resolve
 * 返回的 buy_now action binding 中的 url 执行。
 */
const crypto = require('node:crypto');
const { parseIntent } = require('./nlu');

/**
 * OCP 客户端：基于 fetch 的最小 Catalog Node 客户端。
 */
class OcpClient {
  /**
   * @param {string} baseUrl Catalog Node 基础 URL
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.discovery = null;
    this.manifest = null;
  }

  /** 将相对路径与绝对 URL 统一为完整 URL（discovery 中的端点是绝对地址） */
  #url(pathOrUrl) {
    return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
  }

  /** 内部通用 GET，失败抛错并附状态码 */
  async #get(path) {
    const res = await fetch(this.#url(path));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }

  /** 内部通用 POST，失败抛错并附状态码 */
  async #post(path, payload) {
    const res = await fetch(this.#url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        `POST ${path} failed (${res.status}): ${JSON.stringify(body)}`,
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  /** 握手：读取 discovery 与 manifest（用于发现各端点 URL，而非硬编码路径） */
  async bootstrap() {
    this.discovery = await this.#get('/.well-known/ocp-catalog');
    this.manifest = await this.#get('/ocp/manifest');
    return { discovery: this.discovery, manifest: this.manifest };
  }

  /**
   * 调用 /ocp/query 做关键词检索。
   * @param {string} query 关键词
   * @param {number} [limit=20] 返回条数上限
   * @returns {Promise<object>} CatalogQueryResult
   */
  async query(queryText, limit = 20) {
    return this.#post(this.discovery?.query_url ?? '/ocp/query', {
      query: queryText,
      limit,
    });
  }

  /**
   * 调用 /ocp/resolve 解析候选为可执行引用。
   * @param {string} entryId 候选 entry_id
   * @returns {Promise<object>} ResolvableReference
   */
  async resolve(entryId) {
    return this.#post(this.discovery?.resolve_url ?? '/ocp/resolve', {
      entry_id: entryId,
    });
  }

  /**
   * 通过 resolve 返回的 action binding 执行任意 API 动作（协议纪律：url 必须来自 binding）。
   * @param {object} binding action binding（必须含 url）
   * @param {object} payload 动作入参
   * @returns {Promise<object>} 动作返回体
   */
  async executeAction(binding, payload) {
    const res = await fetch(binding.url, {
      method: binding.method || 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`${binding.action_id} failed (${res.status}): ${JSON.stringify(body)}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  /**
   * 通过 resolve 返回的 action binding 执行下单。
   * @param {object} resolvable ResolvableReference（必须含 buy_now binding）
   * @param {number} quantity 数量
   * @returns {Promise<object>} 订单对象
   */
  async executeBuyNow(resolvable, quantity) {
    const binding = (resolvable.action_bindings ?? []).find(
      (b) => b.action_id === 'buy_now' && b.action_type === 'api',
    );
    if (!binding) {
      throw new Error('resolve 结果中未找到 buy_now action binding');
    }
    // 协议纪律：url 必须来自 binding，不得自行拼路径
    return this.executeAction(binding, {
      entry_id: resolvable.entry_id,
      quantity,
      idempotency_key: `idem_${crypto.randomUUID()}`,
    });
  }
}

/**
 * 生成 Agent 编排器。
 * @param {string} baseUrl Catalog Node 基础 URL
 * @param {import('../mcp/bridge').McpBridge|null} [bridge] MCP↔OCP 桥接（可选；为空时全部走演示目录）
 * @returns {{client: OcpClient, handleUserMessage: Function, confirmAndOrder: Function}}
 */
function createAgent(baseUrl, bridge = null) {
  const client = new OcpClient(baseUrl);

  /**
   * 从 CatalogEntry 中取出价格（元）。
   * @param {object} entry CatalogEntry
   * @returns {number|null}
   */
  function priceOf(entry) {
    const price = entry?.attributes?.price;
    return price && typeof price.amount === 'number' ? price.amount : null;
  }

  /** 库存是否 > 0（可购买） */
  function inStock(entry) {
    return entry?.attributes?.inventory?.availability_status !== 'out_of_stock';
  }

  /** 品类是否匹配（intent.category 为空视为不限制） */
  function categoryMatch(entry, category) {
    return !category || entry?.attributes?.category === category;
  }

  /** 品牌是否匹配（intent.brand 为空视为不限制，命中按白名单原文比对） */
  function brandMatch(entry, brand) {
    return !brand || String(entry?.attributes?.brand ?? '').toLowerCase().includes(brand.toLowerCase());
  }

  /** 预算是否匹配（[budget_min, budget_max] 任一为 null 视为该侧不限） */
  function budgetMatch(entry, budgetMin, budgetMax) {
    const price = priceOf(entry);
    if (price === null) return false;
    if (budgetMin !== null && price < budgetMin) return false;
    if (budgetMax !== null && price > budgetMax) return false;
    return true;
  }

  /**
   * 关键词命中数：标题/摘要命中关键词的数量（用于排序）。
   * @param {object} entry CatalogEntry
   * @param {string[]} keywords 关键词列表
   * @returns {number}
   */
  function keywordHitCount(entry, keywords) {
    if (!keywords.length) return 0;
    const hay = `${entry.title ?? ''} ${entry.summary ?? ''}`.toLowerCase();
    return keywords.reduce(
      (acc, kw) => acc + (hay.includes(kw.toLowerCase()) ? 1 : 0),
      0,
    );
  }

  /** 库存优先级：in_stock > low_stock > out_of_stock */
  function stockRank(entry) {
    const status = entry?.attributes?.inventory?.availability_status;
    return status === 'in_stock' ? 0 : status === 'low_stock' ? 1 : 2;
  }

  /**
   * 商家 MCP 域路由：NLU 命中商家 domains 词表时走真实商家检索。
   * token 未配置时返回 merchant_unconfigured 提示；MCP 调用失败时返回 merchant_error。
   * @param {object} intent NLU 意图（含 merchant 字段）
   * @param {string} text 用户原始输入
   * @returns {Promise<object>} agent 响应
   */
  async function handleMerchantSearch(intent, text) {
    const merchantId = intent.merchant.merchant_id;
    const merchant = bridge.getMerchant(merchantId);
    const merchantInfo = merchant
      ? { id: merchant.id, name: merchant.name, domains: merchant.domains ?? [] }
      : { id: merchantId, name: merchantId, domains: [] };

    // token 缺失：明确提示用户去设置，而不是报错
    if (!bridge.isMerchantAvailable(merchantId)) {
      return {
        intent,
        merchant: merchantInfo,
        source: 'mcp',
        merchant_unconfigured: true,
        message: `商家「${merchantInfo.name}」尚未配置访问 Token。请点击页面顶部「商家 MCP」状态条输入 Token（或设置环境变量 ${merchant?.tokenEnv ?? '-'}），配置后即可真实检索与下单。`,
        candidates: [],
        recommended_entry_id: null,
      };
    }

    let candidates;
    try {
      candidates = await bridge.searchMerchant(merchantId, text);
    } catch (err) {
      return {
        intent,
        merchant: merchantInfo,
        source: 'mcp',
        merchant_error: true,
        message: `商家「${merchantInfo.name}」MCP 调用失败：${err?.message ?? err}`,
        candidates: [],
        recommended_entry_id: null,
      };
    }

    return {
      intent,
      merchant: merchantInfo,
      source: 'mcp',
      candidates,
      recommended_entry_id: candidates.length ? candidates[0].entry_id : null,
    };
  }

  /**
   * 处理一条用户自然语言需求。
   * 先做商家 domain 判定：命中商家词表且 bridge 可用时走商家 MCP 实时检索；
   * 否则走现有内存目录流程（query → 过滤 + 排序）。
   * 过滤：预算 / 品牌 / 品类 / 库存>0；排序：关键词命中数 → 库存 → 价格升序。
   * @param {string} text 用户输入
   * @returns {Promise<{intent: object, candidates: object[], recommended_entry_id: string|null}>}
   */
  async function handleUserMessage(text) {
    const intent = parseIntent(text);

    // 商家 MCP 域路由（真实商家检索与下单）
    if (intent.merchant && bridge) {
      return handleMerchantSearch(intent, text);
    }

    // ---------- 以下为现有内存目录流程（保持不变） ----------

    // 首次调用先完成握手（发现端点 URL）
    if (!client.discovery) await client.bootstrap();

    // 查询词：品类触发词 + 残余关键词（品类本身也是很好的检索词）
    const queryText = [...intent.keywords, intent.category].filter(Boolean).join(' ') || intent.raw;
    let queryResult = await client.query(queryText, 20);
    // 兜底：多词 AND 查询过严时，退化为仅品类检索，再退化为全量（后续本地过滤兜住）
    if (queryResult.result_count === 0 && intent.category) {
      queryResult = await client.query(intent.category, 20);
    }
    if (queryResult.result_count === 0) {
      queryResult = await client.query('', 20);
    }

    const all = queryResult.entries.map((e) => e.entry);

    // 过滤：库存>0 + 预算 + 品牌 + 品类（逐级放宽品类：若严格品类过滤后为空，退化为关键词命中）
    let candidates = all.filter(
      (entry) =>
        inStock(entry) &&
        budgetMatch(entry, intent.budget_min, intent.budget_max) &&
        brandMatch(entry, intent.brand) &&
        categoryMatch(entry, intent.category),
    );
    if (!candidates.length && intent.category) {
      candidates = all.filter(
        (entry) =>
          inStock(entry) &&
          budgetMatch(entry, intent.budget_min, intent.budget_max) &&
          brandMatch(entry, intent.brand),
      );
    }
    if (!candidates.length) {
      candidates = all.filter((entry) => inStock(entry) && budgetMatch(entry, intent.budget_min, intent.budget_max));
    }

    // 排序：预算内优先（budgetMatch 已保证）→ 关键词命中数多优先 → 库存充足优先 → 价格低优先
    candidates.sort((a, b) => {
      const hitDiff = keywordHitCount(b, intent.keywords) - keywordHitCount(a, intent.keywords);
      if (hitDiff !== 0) return hitDiff;
      const stockDiff = stockRank(a) - stockRank(b);
      if (stockDiff !== 0) return stockDiff;
      return (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
    });

    return {
      intent,
      candidates,
      recommended_entry_id: candidates.length ? candidates[0].entry_id : null,
    };
  }

  /**
   * 确认并下单。
   * MCP 来源 entry → 通过商家 buy_now binding.url 走 bridge 真实下单；
   * 其余 → 现有演示目录流程（resolve → 找 buy_now binding → 通过 binding.url 执行）。
   * @param {string} entryId 推荐候选 entry_id
   * @param {number} [quantity=1] 数量
   * @returns {Promise<{reference: object, order: object, mode: 'mcp'|'demo'}>}
   */
  async function confirmAndOrder(entryId, quantity = 1) {
    // MCP 来源：协议纪律 —— 通过 binding.url 执行真实下单（confirm:true 由 agent 层补齐）
    if (bridge) {
      const ref = bridge.findEntry(entryId);
      if (ref) {
        const binding = bridge.buyNowBinding();
        const order = await client.executeAction(binding, {
          merchant_id: ref.merchantId,
          entry_id: entryId,
          mcpRef: ref.mcpRef,
          quantity,
          confirm: true,
        });
        return {
          mode: 'mcp',
          reference: {
            kind: 'ResolvableReference',
            entry_id: entryId,
            provider_id: ref.merchantId,
            action_bindings: [binding],
          },
          order,
        };
      }
    }

    // 演示目录流程（保持不变）
    if (!client.discovery) await client.bootstrap();
    const reference = await client.resolve(entryId);
    const order = await client.executeBuyNow(reference, quantity);
    return { reference, order, mode: 'demo' };
  }

  return { client, handleUserMessage, confirmAndOrder };
}

module.exports = { createAgent, OcpClient };
