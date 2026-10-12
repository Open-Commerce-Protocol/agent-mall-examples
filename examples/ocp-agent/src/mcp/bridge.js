/**
 * MCP ↔ OCP 桥接：把商家 MCP 服务端的商品检索与下单能力接入 agent 流程。
 *
 * 职责：
 * - searchMerchant：queryShopList 取门店 → searchProductForMcp 检索商品，
 *   投影成 CatalogEntry 兼容形状（附带 mcpRef 便于下单）
 * - preview / createOrder / cancelOrder / queryOrder：商家真实下单链路
 * - 协议纪律：真实下单动作以 OCP resolve 的 ActionBinding 形态暴露，
 *   由 agent 通过 binding.url（POST /ocp/actions/mcp/buy_now）执行
 *
 * Token 解析优先级：env(tokenEnv) > 配置内联 token 字段 > 运行时 API 设置的内存 token。
 * 位置优先级：env OCP_AGENT_LON/LAT > 配置 defaultLocation > 内置默认（杭州坐标）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { McpClient, McpError } = require('./client');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'mcp.json');
const DEFAULT_LOCATION = { longitude: 120.026221, latitude: 30.279212 };

/** 商家 MCP 业务错误（code/status 供路由层映射 HTTP 响应） */
class McpBridgeError extends Error {
  /**
   * @param {string} message 错误描述
   * @param {string} [code] 错误码
   * @param {number} [status] HTTP 状态码
   */
  constructor(message, code = 'mcp_error', status = 502) {
    super(message);
    this.name = 'McpBridgeError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 在任意嵌套结构中递归查找第一个「元素均为对象且包含指定键」的数组。
 * 用于兼容不同商家 MCP 返回的包裹层（shopList / data.list / recommendList 等）。
 * @param {unknown} obj 任意结构
 * @param {string[]} mustHaveKeys 元素必须包含的键
 * @param {number} [depth] 递归深度上限控制
 * @param {Set<object>} [seen] 环引用保护
 * @returns {Array<object>|null}
 */
function findArrayWith(obj, mustHaveKeys, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || depth > 8 || seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj.every((it) => it && typeof it === 'object' && mustHaveKeys.every((k) => k in it))) {
      return obj;
    }
    for (const it of obj) {
      const found = findArrayWith(it, mustHaveKeys, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(obj)) {
    const found = findArrayWith(v, mustHaveKeys, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

/**
 * 递归查找第一个「键名匹配正则且值为 number」的字段值。
 * @param {unknown} obj 任意结构
 * @param {RegExp} keyPattern 键名正则
 * @param {number} [depth] 递归深度上限控制
 * @returns {number|null}
 */
function findNumberUnder(obj, keyPattern, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const found = findNumberUnder(it, keyPattern, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keyPattern.test(k) && typeof v === 'number') return v;
    const found = findNumberUnder(v, keyPattern, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 递归查找第一个「键名匹配正则且值为非空 string」的字段值。
 * @param {unknown} obj 任意结构
 * @param {RegExp} keyPattern 键名正则
 * @param {number} [depth] 递归深度上限控制
 * @returns {string|null}
 */
function findStringUnder(obj, keyPattern, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const found = findStringUnder(it, keyPattern, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keyPattern.test(k) && typeof v === 'string' && v.length > 0) return v;
    const found = findStringUnder(v, keyPattern, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** 提取商家原始返回摘要（截断，避免响应过大） */
function summarize(result) {
  try {
    const json = JSON.stringify(result);
    return json.length > 500 ? `${json.slice(0, 500)}…(截断)` : json;
  } catch {
    return String(result);
  }
}

/**
 * 校验商家业务层返回：code !== 0 或 success === false 时抛错（带 msg 内容）。
 * 兼容无 code / success 字段的返回（如旧 mock，视为成功）。
 * @param {object|null} result 商家工具返回的业务层 JSON
 * @param {string} merchantName 商家名（用于错误消息）
 * @param {string} toolName 工具名（用于错误消息）
 */
function assertBusinessOk(result, merchantName, toolName) {
  if (!result || typeof result !== 'object') return;
  const codeFailed = result.code !== undefined && result.code !== 0;
  const successFailed = result.success === false;
  if (codeFailed || successFailed) {
    throw new McpBridgeError(
      `商家「${merchantName}」工具 ${toolName} 返回业务错误：code=${result.code ?? '-'}，msg=${result.msg ?? result.message ?? '(空)'}`,
      'merchant_error',
      502,
    );
  }
}

/** 取业务层数据节点：优先 data 字段，否则整个结果 */
function businessData(result) {
  return result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : result;
}

/**
 * 从订单返回中提取总额（元）。
 * 优先级：discountPrice（真实商家折后价）> totalAmount/totalPrice/payAmount/total
 * > productInfoList[].estimateTotalPrice 求和 > 递归兜底查找。
 * @param {object|null} node 业务层数据
 * @returns {number|null}
 */
function extractTotalAmount(node) {
  if (!node || typeof node !== 'object') return null;
  const direct = [node.discountPrice, node.totalAmount, node.totalPrice, node.payAmount, node.total]
    .find((v) => typeof v === 'number' && Number.isFinite(v));
  if (typeof direct === 'number') return direct;
  if (Array.isArray(node.productInfoList) && node.productInfoList.length > 0) {
    const sum = node.productInfoList.reduce(
      (acc, it) => acc + (typeof it?.estimateTotalPrice === 'number' ? it.estimateTotalPrice : 0),
      0,
    );
    if (sum > 0) return Number(sum.toFixed(2));
  }
  return findNumberUnder(node, /^(discountPrice|totalAmount|totalPrice|total|payAmount)$/i);
}

/**
 * 从订单预览返回中递归提取优惠券码列表（couponCodeList 可为字符串数组或对象数组）。
 * @param {unknown} node 任意结构
 * @returns {string[]|null}
 */
function findCouponCodes(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node.couponCodeList) && node.couponCodeList.length > 0) {
    const codes = node.couponCodeList
      .map((c) => (typeof c === 'string' ? c : c?.couponCode))
      .filter((c) => typeof c === 'string' && c.length > 0);
    if (codes.length > 0) return codes;
  }
  if (Array.isArray(node)) {
    for (const it of node) {
      const found = findCouponCodes(it, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') {
      const found = findCouponCodes(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 门店优选：优先 workStatus === '营业中'，其中 distance 最小者优先；
 * 无 workStatus / distance 字段时保持原顺序（兼容旧 mock）。
 * @param {Array<object>} shops 门店列表
 * @param {string|null} [deptName] 可选门店名筛选（包含匹配）
 * @returns {object|null}
 */
function pickShop(shops, deptName = null) {
  let pool = shops;
  if (deptName) {
    const matched = shops.filter((s) => String(s.deptName ?? '').includes(deptName));
    if (matched.length > 0) pool = matched;
  }
  const open = pool.filter((s) => !s.workStatus || s.workStatus === '营业中');
  const candidates = open.length > 0 ? open : pool;
  const withDistance = candidates.filter(
    (s) => typeof s.distance === 'number' && Number.isFinite(s.distance),
  );
  if (withDistance.length > 0) {
    return withDistance.reduce((a, b) => (b.distance < a.distance ? b : a));
  }
  return candidates[0] ?? null;
}

/**
 * 把商品规格属性（productAttrs）压缩为简述字符串（如「大杯/冰」）。
 * 取每个属性下 selected 的子属性，否则取第一个可选子属性。
 * @param {unknown} productAttrs 商品规格属性数组
 * @returns {string|null}
 */
function describeSpec(productAttrs) {
  if (!Array.isArray(productAttrs)) return null;
  const picks = [];
  for (const attr of productAttrs) {
    const subs = Array.isArray(attr?.productSubAttrs) ? attr.productSubAttrs : [];
    if (subs.length === 0) continue;
    const chosen =
      subs.find((s) => s?.selected === true) ??
      subs.find((s) => s?.canSelected !== false) ??
      subs[0];
    if (chosen?.attributeName) picks.push(String(chosen.attributeName));
  }
  return picks.length > 0 ? picks.join('/') : null;
}

/** buy_now 动作入参的 JSON Schema（由 binding 的 input_schema 指向） */
const MCP_BUY_NOW_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'mcp-buy-now-request.json',
  title: 'McpBuyNowRequest',
  type: 'object',
  required: ['merchant_id', 'confirm'],
  properties: {
    merchant_id: { type: 'string', description: '商家 id（config/mcp.json 注册）' },
    entry_id: { type: 'string', description: 'searchMerchant 返回的 entry_id（与 mcpRef 二选一）' },
    mcpRef: { type: 'object', description: '候选商品携带的 mcpRef（与 entry_id 二选一）' },
    quantity: { type: 'integer', minimum: 1, maximum: 99, default: 1, description: '购买数量' },
    remark: { type: 'string', description: '订单备注' },
    confirm: { type: 'boolean', description: '必须为 true：真实下单会向商家支付实际费用' },
  },
};

/**
 * 创建 MCP↔OCP 桥接实例。
 * @param {{configPath?: string, baseUrl?: string}} [options]
 * @returns {McpBridge} 桥接实例
 */
function createMcpBridge({ configPath = process.env.OCP_MCP_CONFIG ?? DEFAULT_CONFIG_PATH, baseUrl = 'http://127.0.0.1:8800' } = {}) {
  const BASE = baseUrl.replace(/\/$/, '');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  /** @type {Map<string, object>} merchantId -> 配置 */
  const merchants = new Map();
  for (const m of config.merchants ?? []) merchants.set(m.id, m);

  /** @type {Map<string, McpClient>} merchantId -> 已连接客户端 */
  const clients = new Map();
  /** @type {Map<string, string>} merchantId -> 运行时内存 token */
  const memoryTokens = new Map();
  /** @type {Map<string, {merchantId: string, mcpRef: object}>} entry_id -> 下单引用 */
  const entryIndex = new Map();

  /** 读取商家配置（不存在返回 null） */
  function getMerchant(merchantId) {
    return merchants.get(merchantId) ?? null;
  }

  /** Token 解析：env > 配置内联 > 内存 */
  function resolveToken(merchant) {
    return (merchant.tokenEnv && process.env[merchant.tokenEnv]) || merchant.token || memoryTokens.get(merchant.id) || null;
  }

  /** 商家是否可用（已注册且 token 存在） */
  function isMerchantAvailable(merchantId) {
    const merchant = merchants.get(merchantId);
    return !!(merchant && resolveToken(merchant));
  }

  /** 下单位置（env OCP_AGENT_LON/LAT > 配置 defaultLocation > 内置默认） */
  function location() {
    return {
      longitude: Number(process.env.OCP_AGENT_LON ?? DEFAULT_LOCATION.longitude),
      latitude: Number(process.env.OCP_AGENT_LAT ?? DEFAULT_LOCATION.latitude),
    };
  }

  /** 运行时设置内存 token（重启失效；token 变更后旧连接失效） */
  function setToken(merchantId, token) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    if (!token) throw new McpBridgeError('token 不能为空。', 'bad_request', 400);
    memoryTokens.set(merchantId, token);
    const old = clients.get(merchantId);
    if (old) {
      clients.delete(merchantId);
      old.close().catch(() => {});
    }
    return true;
  }

  /**
   * 运行时设置内存 token 并立即验证：用该 token 真连一次（initialize + tools/list）。
   * 验证成功返回 { connected:true, toolCount }；失败抛 McpBridgeError（401 → code=unauthorized）。
   * 注意：验证失败时 token 仍保留在内存中（便于查看已设置的值），但连接状态为未连接。
   * @param {string} merchantId 商家 id
   * @param {string} token 访问 token
   * @returns {Promise<{connected: boolean, toolCount: number}>}
   */
  async function setTokenAndVerify(merchantId, token) {
    setToken(merchantId, token);
    try {
      const client = await getClient(merchantId);
      const tools = await client.listTools();
      return { connected: true, toolCount: Array.isArray(tools) ? tools.length : 0 };
    } catch (err) {
      const unauthorized = err?.code === 'unauthorized' || /401/.test(String(err?.message ?? ''));
      throw new McpBridgeError(
        unauthorized
          ? `Token 验证失败：Token 无效或已过期（商家服务器返回 401）。详情：${err?.message ?? err}`
          : `Token 验证失败：${err?.message ?? err}`,
        unauthorized ? 'unauthorized' : 'mcp_verify_failed',
        unauthorized ? 400 : 502,
      );
    }
  }

  /** 获取（或建立）商家 MCP 连接；token 缺失 / 连接失败时抛出带 code 的错误 */
  async function getClient(merchantId) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    const token = resolveToken(merchant);
    if (!token) {
      throw new McpBridgeError(
        `商家「${merchant.name}」尚未配置访问 Token（env ${merchant.tokenEnv ?? '-'} / 配置 token / 运行时 API 均未设置）。`,
        'token_missing',
        400,
      );
    }
    const existing = clients.get(merchantId);
    if (existing && existing.connected && existing.token === token) return existing;
    if (existing) {
      clients.delete(merchantId);
      await existing.close().catch(() => {});
    }
    const client = new McpClient({
      type: merchant.type,
      url: merchant.url,
      headers: { Authorization: `Bearer ${token}` },
      token,
      timeoutMs: merchant.timeoutMs ?? 30000,
    });
    try {
      await client.connect();
    } catch (err) {
      const unauthorized = err instanceof McpError && err.status === 401;
      throw new McpBridgeError(
        `连接商家 MCP（${merchant.name}）失败：${err?.message ?? err}`,
        unauthorized ? 'unauthorized' : 'mcp_connect_failed',
        unauthorized ? 400 : 502,
      );
    }
    clients.set(merchantId, client);
    return client;
  }

  /** 工具调用包装：把 McpError 翻译为带 code 的桥接错误 */
  async function callToolOrBridgeError(client, merchant, name, args) {
    try {
      return await client.callTool(name, args);
    } catch (err) {
      const unauthorized = err instanceof McpError && err.status === 401;
      throw new McpBridgeError(
        `调用商家「${merchant.name}」工具 ${name} 失败：${err?.message ?? err}`,
        unauthorized ? 'unauthorized' : 'mcp_call_failed',
        unauthorized ? 400 : 502,
      );
    }
  }

  /** 校验商家并解析下单引用（支持直接传 mcpRef 对象或 searchMerchant 返回的 entry_id） */
  async function requireRef(merchantId, refOrEntryId) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    let mcpRef = null;
    if (refOrEntryId && typeof refOrEntryId === 'object') {
      mcpRef = refOrEntryId;
    } else {
      const indexed = entryIndex.get(String(refOrEntryId ?? ''));
      if (indexed) mcpRef = indexed.mcpRef;
    }
    if (!mcpRef || !mcpRef.productId) {
      throw new McpBridgeError(
        '缺少有效的商品引用：请传入 searchMerchant 返回的 entry_id 或候选携带的 mcpRef。',
        'bad_request',
        400,
      );
    }
    if (mcpRef.merchantId && mcpRef.merchantId !== merchantId) {
      throw new McpBridgeError(
        `mcpRef.merchantId（${mcpRef.merchantId}）与请求的 merchant_id（${merchantId}）不一致。`,
        'bad_request',
        400,
      );
    }
    return { merchant, mcpRef };
  }

  /** resolve/agent 层暴露给 MCP 来源 entry 的 ActionBinding（协议纪律：由 binding.url 执行） */
  function buyNowBinding() {
    return {
      action_id: 'buy_now',
      action_type: 'api',
      label: '真实下单（商家MCP）',
      url: `${BASE}/ocp/actions/mcp/buy_now`,
      method: 'POST',
      input_schema: `${BASE}/schemas/mcp-buy-now-request.json`,
    };
  }

  /** 把商家 MCP 商品投影为 CatalogEntry 兼容形状（附带 mcpRef 与 action_binding） */
  function projectEntry(merchant, shop, p) {
    const productId = p.productId ?? p.productID ?? p.id;
    const skuCode = p.skuCode ?? p.sku ?? null;
    const name = p.productName ?? p.name ?? p.title ?? `商品 ${productId}`;
    // 价格优先级：真实商家折后价 estimatePrice > 常规 price 系列 > 原价 initialPrice
    const priceVal =
      [p.estimatePrice, p.price, p.sellPrice, p.salePrice, p.finalPrice, p.minPrice, p.initialPrice]
        .find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) ??
      findNumberUnder(p, /^(price|sellPrice|salePrice|finalPrice|minPrice|estimatePrice)$/i);
    const spec = describeSpec(p.productAttrs ?? p.attrs);
    const imageUrl = p.pictureUrl ?? p.imageUrl ?? p.image_url ?? p.url ?? p.productUrl ?? null;
    const entryIdValue = `entry_mcp_${merchant.id}_${productId}${skuCode ? `_${skuCode}` : ''}`;
    const mcpRef = {
      merchantId: merchant.id,
      deptId: shop.deptId,
      deptName: shop.deptName ?? null,
      productId,
      skuCode,
      productName: name,
      name,
    };
    const attributes = {
      brand: merchant.name,
      category: (merchant.domains ?? [])[0] ?? '商家商品',
      inventory: { availability_status: 'in_stock' },
    };
    if (priceVal !== null) attributes.price = { currency: 'CNY', amount: priceVal };
    if (imageUrl) attributes.image_url = imageUrl;
    if (spec) attributes.spec = spec;
    if (Array.isArray(p.tags) && p.tags.length > 0) attributes.tags = p.tags;
    const specSuffix = spec ? `（规格：${spec}）` : '';
    const entry = {
      kind: 'CatalogEntry',
      catalog_id: `cat_mcp_${merchant.id}`,
      entry_id: entryIdValue,
      provider_id: merchant.id,
      object_id: String(productId),
      object_type: 'ocp.commerce.product',
      title: name,
      summary: `${merchant.name}「${shop.deptName ?? '门店'}」在售商品${specSuffix}，由商家 MCP 实时返回。`,
      attributes,
      explain: [
        `来自商家「${merchant.name}」MCP 实时检索（门店：${shop.deptName ?? '-'}${spec ? `；规格：${spec}` : ''}）`,
      ],
      mcpRef,
      action_binding: buyNowBinding(),
    };
    entryIndex.set(entryIdValue, { merchantId: merchant.id, mcpRef });
    return entry;
  }

  /**
   * 商家商品检索：queryShopList 取门店 → searchProductForMcp 检索 → 投影 CatalogEntry。
   * @param {string} merchantId 商家 id
   * @param {string} queryText 自然语言检索词
   * @param {{deptName?: string|null}} [options] 可选门店名筛选
   * @returns {Promise<object[]>} CatalogEntry 列表（含 mcpRef / action_binding）
   */
  async function searchMerchant(merchantId, queryText, { deptName = null } = {}) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    const client = await getClient(merchantId);
    const loc = location();
    const shopArgs = { longitude: loc.longitude, latitude: loc.latitude };
    if (deptName) shopArgs.deptName = deptName;
    const shopResult = await callToolOrBridgeError(client, merchant, 'queryShopList', shopArgs);
    assertBusinessOk(shopResult, merchant.name, 'queryShopList');
    const shops = findArrayWith(shopResult, ['deptId']);
    if (!shops || shops.length === 0) {
      throw new McpBridgeError(`商家「${merchant.name}」未返回可用门店。`, 'no_shop', 502);
    }
    const shop = pickShop(shops, deptName);
    const productResult = await callToolOrBridgeError(client, merchant, 'searchProductForMcp', {
      deptId: shop.deptId,
      query: queryText,
    });
    assertBusinessOk(productResult, merchant.name, 'searchProductForMcp');
    const products = findArrayWith(productResult, ['productId']) ?? [];
    return products.slice(0, 8).map((p) => projectEntry(merchant, shop, p));
  }

  /**
   * 订单预览（真实价格 / 优惠）。
   * @param {string} merchantId 商家 id
   * @param {object|string} refOrEntryId mcpRef 或 entry_id
   * @param {number} [quantity=1] 数量
   */
  async function preview(merchantId, refOrEntryId, quantity = 1) {
    const { merchant, mcpRef } = await requireRef(merchantId, refOrEntryId);
    const client = await getClient(merchantId);
    const productList = [{ productId: mcpRef.productId, skuCode: mcpRef.skuCode, amount: quantity }];
    const result = await callToolOrBridgeError(client, merchant, 'previewOrder', {
      deptId: mcpRef.deptId,
      productList,
    });
    assertBusinessOk(result, merchant.name, 'previewOrder');
    const data = businessData(result);
    return {
      merchant_id: merchant.id,
      mcpRef,
      quantity,
      total_amount: extractTotalAmount(data),
      currency: 'CNY',
      shop_name: data?.shopInfo?.deptName ?? mcpRef.deptName ?? null,
      raw: summarize(result),
    };
  }

  /**
   * 真实下单：previewOrder（取真实价与优惠券）→ createOrder。
   * @param {string} merchantId 商家 id
   * @param {object|string} refOrEntryId mcpRef 或 entry_id
   * @param {number} [quantity=1] 数量
   * @param {{remark?: string}} [options] 下单选项
   * @returns {Promise<object>} 统一订单形状（含 raw 商家原始返回摘要）
   */
  async function createOrder(merchantId, refOrEntryId, quantity = 1, options = {}) {
    const { merchant, mcpRef } = await requireRef(merchantId, refOrEntryId);
    const client = await getClient(merchantId);
    const productList = [{ productId: mcpRef.productId, skuCode: mcpRef.skuCode, amount: quantity }];

    // 先预览：取真实价格与可用优惠券（预览失败不阻断下单，total_amount 留空）
    let totalAmount = null;
    let couponCodeList;
    let shopName = mcpRef.deptName ?? null;
    try {
      const previewResult = await client.callTool('previewOrder', {
        deptId: mcpRef.deptId,
        productList,
      });
      assertBusinessOk(previewResult, merchant.name, 'previewOrder');
      const previewData = businessData(previewResult);
      totalAmount = extractTotalAmount(previewData);
      if (previewData?.shopInfo?.deptName) shopName = previewData.shopInfo.deptName;
      couponCodeList = findCouponCodes(previewData); // couponCodeList 原样透传给 createOrder
    } catch {
      // 忽略预览失败
    }

    const loc = location();
    const createArgs = {
      deptId: mcpRef.deptId,
      productList,
      longitude: loc.longitude,
      latitude: loc.latitude,
    };
    if (couponCodeList && couponCodeList.length > 0) createArgs.couponCodeList = couponCodeList;
    if (options.remark) createArgs.remark = options.remark;
    const result = await callToolOrBridgeError(client, merchant, 'createOrder', createArgs);
    assertBusinessOk(result, merchant.name, 'createOrder');
    const resultData = businessData(result);
    const createTotal = extractTotalAmount(resultData);
    if (createTotal !== null) totalAmount = createTotal;
    const orderId = findStringUnder(resultData ?? result, /^(orderId|order_id|orderNo)$/i) ?? '';
    if (!orderId) {
      throw new McpBridgeError(
        `商家「${merchant.name}」下单未返回订单号：${summarize(result)}`,
        'order_failed',
        502,
      );
    }
    return {
      order_id: String(orderId),
      status: 'confirmed',
      mode: 'mcp',
      merchant: { id: merchant.id, name: merchant.name, dept_name: shopName },
      items: [
        {
          name: mcpRef.name ?? null,
          product_id: String(mcpRef.productId),
          sku_code: mcpRef.skuCode ?? null,
          quantity,
        },
      ],
      quantity,
      total_amount: totalAmount,
      currency: 'CNY',
      created_at: new Date().toISOString(),
      raw: summarize(result),
    };
  }

  /** 取消商家订单（透传） */
  async function cancelOrder(merchantId, orderId) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    const client = await getClient(merchantId);
    const result = await callToolOrBridgeError(client, merchant, 'cancelOrder', { orderId });
    return { merchant_id: merchantId, order_id: orderId, raw: summarize(result) };
  }

  /** 查询商家订单详情（透传） */
  async function queryOrder(merchantId, orderId) {
    const merchant = merchants.get(merchantId);
    if (!merchant) throw new McpBridgeError(`未知商家：${merchantId}`, 'not_found', 404);
    const client = await getClient(merchantId);
    const result = await callToolOrBridgeError(client, merchant, 'queryOrderDetailInfo', { orderId });
    return { merchant_id: merchantId, order_id: orderId, detail: result };
  }

  /** entry_id 是否为 MCP 来源（agent confirm 路由用） */
  function findEntry(entryIdValue) {
    return entryIndex.get(String(entryIdValue ?? '')) ?? null;
  }

  /**
   * 各商家连接状态（供 GET /api/mcp/status）。
   * @returns {Promise<object[]>}
   */
  async function status() {
    const out = [];
    for (const merchant of merchants.values()) {
      const token = resolveToken(merchant);
      const client = clients.get(merchant.id);
      let toolCount = null;
      if (client && client.connected && token) {
        try {
          toolCount = (await client.listToolsCached()).length;
        } catch {
          toolCount = null;
        }
      }
      out.push({
        id: merchant.id,
        name: merchant.name,
        domains: merchant.domains ?? [],
        token_env: merchant.tokenEnv ?? null,
        token_present: !!token,
        connected: !!(client && client.connected && token),
        tool_count: toolCount,
      });
    }
    return out;
  }

  return {
    getMerchant,
    isMerchantAvailable,
    setToken,
    setTokenAndVerify,
    searchMerchant,
    preview,
    createOrder,
    cancelOrder,
    queryOrder,
    findEntry,
    buyNowBinding,
    status,
  };
}

module.exports = { createMcpBridge, McpBridgeError, MCP_BUY_NOW_SCHEMA };
