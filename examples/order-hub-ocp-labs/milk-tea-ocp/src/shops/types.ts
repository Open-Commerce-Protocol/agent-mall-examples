/**
 * 奶茶数据模型。
 *
 * 这些字段刻意贴着规范里的三个 pack 走（见 packages/ocp-schema 的
 * productCorePackSchema / pricePackSchema / inventoryPackSchema），
 * 这样节点把它们映射进 entry.attributes 时不需要临时造字段。
 */

/** 规范里 inventory 的封闭枚举。 */
export type AvailabilityStatus =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'unknown';

/** 规格：中杯不加价，大杯加价。 */
export type SizeOption = { id: string; label: string; price_delta: number };

/** 一杯可卖的奶茶。 */
export type MilkTea = {
  /** 店内 SKU，同时是 entry id 的组成部分。 */
  sku: string;
  title: string;
  summary: string;
  /** 分类：奶茶 / 果茶 / 纯茶 / 限定。 */
  category: string;
  /** 茶底，例如「锡兰红茶」。 */
  base: string;
  /** 可选加料。 */
  toppings: string[];
  sizes: SizeOption[];
  sugar_levels: string[];
  temperatures: string[];
  currency: string;
  /** 中杯基准价。 */
  amount: number;
  list_amount: number;
  availability: AvailabilityStatus;
  quantity: number;
  /** 供 keyword query 命中的检索词，例如「珍珠」「波霸」。 */
  tags: string[];
  updated_at: string;
};

/** 一家奶茶铺 = 一个独立的 Catalog 节点。 */
export type Shop = {
  catalog_id: string;
  catalog_name: string;
  description: string;
  provider_id: string;
  port: number;
  base_url: string;
  registry_visibility: 'public' | 'partner' | 'private';
  /** 本店声明的 query pack id（manifest 里声明，query 时校验）。 */
  query_pack: string;
  query_capability_id: string;
  /** 门店信息，注册到 Registration 节点用。 */
  store: {
    city: string;
    address: string;
    open_hours: string;
    phone: string;
  };
  /** 店铺级检索词，让 Registration 层能按品类/地域发现它。 */
  tags: string[];
  menu: MilkTea[];
};

/** 中杯起价，用于 Registration 层的价格概览。 */
export function priceRange(shop: Shop): { min: number; max: number; currency: string } {
  const amounts = shop.menu.map((m) => m.amount);
  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    currency: shop.menu[0]?.currency ?? 'CNY',
  };
}
