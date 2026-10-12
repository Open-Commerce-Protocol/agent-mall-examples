/**
 * 订单存储与校价。
 *
 * 重要边界：这里生成的是**模拟订单**。OCP 的 resolve 只负责给出"下单入口"，
 * 真正的成交与支付发生在商户侧；本演示不接任何支付通道，所以订单上明确带
 * payment: 'simulated_not_charged'，让接收方一眼看出没扣钱。
 */
import { newId } from './ids.ts';
import type { MilkTea, Shop } from '../shops/types.ts';

export type OrderInput = {
  sku?: unknown;
  size?: unknown;
  sugar?: unknown;
  temperature?: unknown;
  toppings?: unknown;
  quantity?: unknown;
  note?: unknown;
};

export type OrderLine = {
  sku: string;
  title: string;
  size: string;
  size_label: string;
  sugar: string;
  temperature: string;
  toppings: string[];
  quantity: number;
  unit_amount: number;
  total_amount: number;
  currency: string;
};

export type Order = {
  order_id: string;
  catalog_id: string;
  provider_id: string;
  store: string;
  store_address: string;
  lines: OrderLine[];
  total: { currency: string; amount: number };
  status: 'created';
  created_at: string;
  payment: 'simulated_not_charged';
  note: string;
};

export type OrderValidation =
  | { ok: true; line: OrderLine }
  | { ok: false; errors: string[] };

const MAX_QUANTITY = 10;

/**
 * 校验并计算一行的价格。
 *
 * 这里刻意实现的就是 action binding 里 `input_schema` 声明的那套约束——
 * 节点不能声明一套、执行另一套。
 */
export function validateAndPrice(shop: Shop, item: MilkTea, input: OrderInput): OrderValidation {
  const errors: string[] = [];

  const sizeId = typeof input.size === 'string' ? input.size : '';
  const size = item.sizes.find((s) => s.id === sizeId);
  if (!size) {
    errors.push(`size 必须是 ${item.sizes.map((s) => s.id).join(' | ')} 之一，收到 "${String(input.size)}"`);
  }

  const sugar = typeof input.sugar === 'string' ? input.sugar : item.sugar_levels[0];
  if (!item.sugar_levels.includes(sugar as string)) {
    errors.push(`sugar 必须是 ${item.sugar_levels.join(' | ')} 之一，收到 "${String(input.sugar)}"`);
  }

  const temperature = typeof input.temperature === 'string' ? input.temperature : item.temperatures[0];
  if (!item.temperatures.includes(temperature as string)) {
    errors.push(`temperature 必须是 ${item.temperatures.join(' | ')} 之一，收到 "${String(input.temperature)}"`);
  }

  const rawToppings = input.toppings === undefined ? [] : input.toppings;
  if (!Array.isArray(rawToppings)) {
    errors.push('toppings 必须是字符串数组');
  }
  const toppings = Array.isArray(rawToppings) ? rawToppings.filter((t): t is string => typeof t === 'string') : [];
  const badToppings = toppings.filter((t) => !item.toppings.includes(t));
  if (badToppings.length > 0) {
    errors.push(`toppings 含本店未提供的加料：${badToppings.join(', ')}（可选：${item.toppings.join(' | ') || '无'}）`);
  }

  const rawQuantity = input.quantity === undefined ? 1 : input.quantity;
  const quantity = typeof rawQuantity === 'number' ? rawQuantity : Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.push(`quantity 必须是 1..${MAX_QUANTITY} 的整数，收到 "${String(input.quantity)}"`);
  }

  if (item.availability === 'out_of_stock') {
    errors.push(`${item.title} 当前已售罄，无法下单`);
  }

  if (errors.length > 0 || !size) return { ok: false, errors };

  const unit = item.amount + size.price_delta;
  return {
    ok: true,
    line: {
      sku: item.sku,
      title: item.title,
      size: size.id,
      size_label: size.label,
      sugar: sugar as string,
      temperature: temperature as string,
      toppings,
      quantity,
      unit_amount: unit,
      total_amount: unit * quantity,
      currency: item.currency,
    },
  };
}

const ORDERS = new Map<string, Order>();

export const STORE_NOTE =
  '模拟订单：未接入任何支付通道，未发生真实扣款。真实场景中这一步由商户侧完成。';

export function createOrder(shop: Shop, line: OrderLine): Order {
  const order: Order = {
    order_id: newId('ord'),
    catalog_id: shop.catalog_id,
    provider_id: shop.provider_id,
    store: shop.catalog_name,
    store_address: shop.store.address,
    lines: [line],
    total: { currency: line.currency, amount: line.total_amount },
    status: 'created',
    created_at: new Date().toISOString(),
    payment: 'simulated_not_charged',
    note: STORE_NOTE,
  };
  ORDERS.set(order.order_id, order);
  return order;
}

export const getOrder = (orderId: string): Order | undefined => ORDERS.get(orderId);

export const listOrders = (): Order[] => [...ORDERS.values()];

export const orderCount = (): number => ORDERS.size;
