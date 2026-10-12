/**
 * Action Provider：下单动作与订单查询（POST /ocp/actions/buy_now 等）。
 *
 * 职责边界遵循 _spec/resolve-actions.md：Catalog 暴露动作入口，
 * 真正的执行与状态迁移由 Action Provider（本模块）完成，含幂等与库存校验。
 * 金额统一使用「元」整数，总额 = 单价 × 数量（整数乘法，无浮点误差）。
 */
const crypto = require('node:crypto');
const { CATALOG_ID, entryId, findProductByEntryId, isPurchasable } = require('./store');

/**
 * 创建订单服务实例。
 * @returns {OrderService} 含 buyNow / getOrder / listOrders
 */
function createOrderService() {
  /** @type {Map<string, object>} 订单表：order_id -> order */
  const orders = new Map();
  /** @type {Map<string, string>} 幂等表：idempotency_key -> order_id */
  const idempotencyIndex = new Map();

  /**
   * 执行下单动作。
   * 协议纪律：调用方必须使用 resolve 返回的 buy_now binding URL 发起请求。
   * @param {{entry_id?: string, quantity?: number, idempotency_key?: string}} body 请求体
   * @returns {{__error?: object, status?: number, data?: object}} 成功返回 {data}，失败返回 {__error, status}
   */
  function buyNow(body) {
    const entryIdValue = String(body.entry_id ?? '');
    const idempotencyKey = String(body.idempotency_key ?? '');
    const quantity = Number(body.quantity ?? 1);

    // 1. 参数校验
    if (!entryIdValue) {
      return {
        __error: { code: 'bad_request', message: '缺少必填字段 entry_id。' },
        status: 400,
      };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return {
        __error: { code: 'bad_request', message: 'quantity 必须是 1-99 之间的整数。' },
        status: 400,
      };
    }

    // 2. 幂等：同一 idempotency_key 直接返回同一订单
    if (idempotencyKey) {
      const existingOrderId = idempotencyIndex.get(idempotencyKey);
      if (existingOrderId) {
        return { data: { ...orders.get(existingOrderId) } };
      }
    }

    // 3. entry 存在性校验
    const product = findProductByEntryId(entryIdValue);
    if (!product) {
      return {
        __error: { code: 'not_found', message: `Unknown entry_id: ${entryIdValue}` },
        status: 404,
      };
    }

    // 4. 库存校验
    if (!isPurchasable(product)) {
      return {
        __error: {
          code: 'bad_request',
          message: `商品「${product.title}」当前缺货（out_of_stock），无法下单。`,
        },
        status: 400,
      };
    }

    // 5. 创建订单
    const order = {
      order_id: `ord_${crypto.randomUUID()}`,
      status: 'confirmed',
      catalog_id: CATALOG_ID,
      entry_id: entryId(product.id),
      object_id: product.id,
      title: product.title,
      unit_price: { currency: product.currency, amount: product.amount },
      quantity,
      total_amount: product.amount * quantity,
      currency: 'CNY',
      created_at: new Date().toISOString(),
    };
    orders.set(order.order_id, order);
    if (idempotencyKey) {
      idempotencyIndex.set(idempotencyKey, order.order_id);
    }
    return { data: { ...order } };
  }

  /**
   * 按 order_id 查询订单。
   * @param {string} orderId 订单 id
   * @returns {{__error?: object, status?: number, data?: object}}
   */
  function getOrder(orderId) {
    const order = orders.get(orderId);
    if (!order) {
      return {
        __error: { code: 'not_found', message: `Unknown order_id: ${orderId}` },
        status: 404,
      };
    }
    return { data: { ...order } };
  }

  /**
   * 订单列表（按创建时间倒序，供 UI 底部展示）。
   * @returns {{data: object[]}}
   */
  function listOrders() {
    const list = Array.from(orders.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    return { data: { count: list.length, orders: list } };
  }

  return { buyNow, getOrder, listOrders };
}

/** buy_now 动作入参的 JSON Schema（由 resolve binding 的 input_schema 指向） */
const BUY_NOW_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'buy-now-request.json',
  title: 'BuyNowRequest',
  type: 'object',
  required: ['entry_id'],
  properties: {
    entry_id: { type: 'string', description: 'resolve 返回的 entry_id' },
    quantity: { type: 'integer', minimum: 1, maximum: 99, default: 1, description: '购买数量' },
    idempotency_key: { type: 'string', description: '幂等键：同 key 重复请求返回同一订单' },
  },
};

module.exports = { createOrderService, BUY_NOW_SCHEMA };
