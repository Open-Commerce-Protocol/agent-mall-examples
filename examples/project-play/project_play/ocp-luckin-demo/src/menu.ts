/**
 * 瑞幸咖啡铺的「货架」—— 内存里的菜单。
 *
 * 真实世界的 Luckin 会通过 Provider + Handshake 协议把商品同步进 Catalog;
 * 教学演示里直接硬编码。tags 字段是给自然语言检索用的(如「不太甜」「微糖」),
 * 其余字段对齐 @ocp-catalog/ocp-schema 的 product core / price / inventory pack。
 */
export type Drink = {
  id: string;
  title: string;
  summary: string;
  category: 'coffee' | 'milk_tea' | 'fruit_tea';
  currency: 'CNY';
  amount: number;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock';
  /** 内部字段:成本与供应商,绝不能出现在对 Agent 的投影里(selfcheck 第 11 项扫描它) */
  internal_cost: number;
  internal_supplier: string;
  tags: string[];
  url: string;
  updated_at: string;
};

export const MENU: Drink[] = [
  {
    id: 'lk-001',
    title: '生椰拿铁',
    summary: '椰浆与浓缩咖啡的经典组合,清甜顺滑,微糖不腻。',
    category: 'coffee',
    currency: 'CNY',
    amount: 18,
    availability: 'in_stock',
    internal_cost: 5.2,
    internal_supplier: 'luckin-store-001',
    tags: ['热门', '微糖'],
    url: 'https://lk.demo.menu/lk-001',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-002',
    title: '燕麦拿铁',
    summary: '植物基燕麦奶,口感清淡,不太甜,乳糖不耐友好。',
    category: 'coffee',
    currency: 'CNY',
    amount: 19,
    availability: 'in_stock',
    internal_cost: 6.0,
    internal_supplier: 'luckin-store-001',
    tags: ['不太甜', '植物基'],
    url: 'https://lk.demo.menu/lk-002',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-003',
    title: '小黑杯·SOE 耶加雪菲美式',
    summary: '单一产地手冲级豆子,柑橘果酸明亮,无糖,不太甜。',
    category: 'coffee',
    currency: 'CNY',
    amount: 20,
    availability: 'in_stock',
    internal_cost: 7.5,
    internal_supplier: 'luckin-store-002',
    tags: ['无糖', '不太甜', 'SOE'],
    url: 'https://lk.demo.menu/lk-003',
    updated_at: '2026-10-09T02:00:00.000Z',
  },
  {
    id: 'lk-004',
    title: '厚乳拿铁',
    summary: '冷萃厚牛乳,奶香醇厚,口感浓郁。',
    category: 'coffee',
    currency: 'CNY',
    amount: 17,
    availability: 'low_stock',
    internal_cost: 5.0,
    internal_supplier: 'luckin-store-001',
    tags: ['醇厚'],
    url: 'https://lk.demo.menu/lk-004',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-005',
    title: '橙C美式',
    summary: '鲜橙汁与美式的碰撞,酸爽提神,富含维C。',
    category: 'coffee',
    currency: 'CNY',
    amount: 15,
    availability: 'in_stock',
    internal_cost: 4.5,
    internal_supplier: 'luckin-store-003',
    tags: ['酸爽', '维C'],
    url: 'https://lk.demo.menu/lk-005',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-006',
    title: '茉莉花香拿铁',
    summary: '茉莉花茶底拿铁,花香轻盈,微糖,不太甜。',
    category: 'coffee',
    currency: 'CNY',
    amount: 18,
    availability: 'in_stock',
    internal_cost: 5.4,
    internal_supplier: 'luckin-store-002',
    tags: ['花香', '微糖', '不太甜'],
    url: 'https://lk.demo.menu/lk-006',
    updated_at: '2026-10-09T02:00:00.000Z',
  },
  {
    id: 'lk-007',
    title: '桂花龙井拿铁',
    summary: '秋季限定,龙井茶底配桂花香,甜度适中。',
    category: 'milk_tea',
    currency: 'CNY',
    amount: 16,
    availability: 'in_stock',
    internal_cost: 4.8,
    internal_supplier: 'luckin-store-002',
    tags: ['秋季限定'],
    url: 'https://lk.demo.menu/lk-007',
    updated_at: '2026-10-10T02:00:00.000Z',
  },
  {
    id: 'lk-008',
    title: '抹茶拿铁',
    summary: '石臼抹茶与鲜奶,茶香回甘,微苦清爽。',
    category: 'milk_tea',
    currency: 'CNY',
    amount: 18,
    availability: 'in_stock',
    internal_cost: 5.6,
    internal_supplier: 'luckin-store-001',
    tags: ['微糖'],
    url: 'https://lk.demo.menu/lk-008',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-009',
    title: '柠檬冰萃茶',
    summary: '整颗柠檬现捣,冰萃乌龙茶底,酸爽解腻,不太甜。',
    category: 'fruit_tea',
    currency: 'CNY',
    amount: 12,
    availability: 'in_stock',
    internal_cost: 3.2,
    internal_supplier: 'luckin-store-003',
    tags: ['酸爽', '不太甜', '解腻'],
    url: 'https://lk.demo.menu/lk-009',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
  {
    id: 'lk-010',
    title: '葡萄冰萃茶',
    summary: '巨峰葡萄果肉,配冰萃绿茶,果香浓郁。',
    category: 'fruit_tea',
    currency: 'CNY',
    amount: 15,
    availability: 'in_stock',
    internal_cost: 4.0,
    internal_supplier: 'luckin-store-003',
    tags: ['果肉', '甜'],
    url: 'https://lk.demo.menu/lk-010',
    updated_at: '2026-10-09T02:00:00.000Z',
  },
  {
    id: 'lk-011',
    title: '生酪拿铁',
    summary: '芝士奶酪风味拿铁,咸甜交织,浓醇饱腹。',
    category: 'coffee',
    currency: 'CNY',
    amount: 19,
    availability: 'out_of_stock',
    internal_cost: 6.2,
    internal_supplier: 'luckin-store-002',
    tags: ['浓郁'],
    url: 'https://lk.demo.menu/lk-011',
    updated_at: '2026-10-07T02:00:00.000Z',
  },
  {
    id: 'lk-012',
    title: '标准美式',
    summary: '双份浓缩,苦感干净利落,无糖零负担。',
    category: 'coffee',
    currency: 'CNY',
    amount: 13,
    availability: 'in_stock',
    internal_cost: 3.5,
    internal_supplier: 'luckin-store-001',
    tags: ['无糖', '提神'],
    url: 'https://lk.demo.menu/lk-012',
    updated_at: '2026-10-08T02:00:00.000Z',
  },
];

/** 检索面:title + summary + category + tags(不含 internal_* 字段) */
export function searchableText(d: Drink): string {
  return [d.title, d.summary, d.category, ...d.tags].join(' ').toLowerCase();
}
