/**
 * 三家店的配置 —— 唯一的数据源。
 *
 * 架构关键：三家店共用同一份 handler，只是这份配置不同。
 * 这既是省时间的手段，也是演示论点的一部分 ——「同一个协议，三个实现」。
 *
 * 每家店的 pick() 是 B 层方案的核心：由商家侧（Catalog）决定推哪个，
 * 而不是由 Agent 端随机挑。路演时这句话是重点：
 *   「每家店自己决定推什么，因为执行权在商家手里 —— 协议不替商家做这个决定。」
 */

export type MenuItem = {
  entry_id: string;
  name: string;
  price: number;
  minutes: number;      // 出餐/送达时间
  spicy: 0 | 1 | 2 | 3;
  tags: string[];
  desc: string;
  img: string;
  kcal: number;
  caffeine_mg: number;
  dine_in: boolean;
  delivery: boolean;
  today_special?: boolean;
  // ↓ 内部字段：绝不能出现在对外响应里（selfcheck 会扫）
  cost?: number;
  margin?: number;
};

export type Shop = {
  id: string;
  name: string;
  provider_id: string;
  description: string;
  verification: 'verified' | 'pending' | 'unverified';
  trust: 'authority' | 'verified_domain' | 'declared' | 'none';
  latency_ms: number;
  healthy: boolean;
  unhealthy_reason?: string;
  explain_rule: string;
  domains: string[];
  homepage: string;
  is_luckin?: boolean;
  menu: MenuItem[];
  pick: (candidates: MenuItem[], constraints: Constraints) => MenuItem;
};

export type Constraints = {
  spicy?: 'none' | 'mild' | 'high';
  budget?: number;
  minutes?: number;
  keywords?: string;
};

const IMG = (seed: string) => `https://picsum.photos/seed/${seed}/640/420`;

/* ─────────────────────────── 店 1：川面馆（快） ─────────────────────────── */
const noodle: Shop = {
  id: 'noodle',
  name: '楼下川面馆',
  provider_id: 'provider.noodle.demo',
  description: '开了十二年的社区面馆，辣度可以调，出餐快。',
  verification: 'verified',
  trust: 'authority',
  latency_ms: 420,
  healthy: true,
  explain_rule: '今天想清一清备料',
  domains: ['noodle.demo'],
  homepage: 'https://noodle.demo',
  menu: [
    {
      entry_id: 'noodle.m1', name: '麻婆豆腐盖饭', price: 18, minutes: 15, spicy: 3,
      tags: ['辣', '下饭', '经典'], kcal: 680, caffeine_mg: 0,
      dine_in: true, delivery: true, today_special: true,
      desc: '石磨嫩豆腐配郫县豆瓣，慢火收汁，花椒面现舂。',
      img: IMG('mapo'), cost: 6.2, margin: 0.66,
    },
    {
      entry_id: 'noodle.m2', name: '宜宾燃面', price: 16, minutes: 12, spicy: 2,
      tags: ['辣', '面食', '干拌'], kcal: 620, caffeine_mg: 0,
      dine_in: true, delivery: true,
      desc: '碱水面拌芽菜、花生碎与红油，面干味厚。',
      img: IMG('ranmian'), cost: 5.1, margin: 0.68,
    },
    {
      entry_id: 'noodle.m3', name: '清汤抄手', price: 20, minutes: 18, spicy: 0,
      tags: ['不辣', '汤', '温和'], kcal: 480, caffeine_mg: 0,
      dine_in: true, delivery: true,
      desc: '猪骨清汤，抄手皮薄馅足，撒葱花与白胡椒。',
      img: IMG('chaoshou'), cost: 7.0, margin: 0.65,
    },
  ],
  // B 层策略：优先清今天的备料
  pick: (c) => c.find((m) => m.today_special) ?? c[0]!,
};

/* ─────────────────────────── 店 2：便当屋（慢） ─────────────────────────── */
const bento: Shop = {
  id: 'bento',
  name: '山谷便当屋',
  provider_id: 'provider.bento.demo',
  description: '现做饭团与定食，讲究食材，出餐稍慢。',
  verification: 'pending',
  trust: 'verified_domain',
  latency_ms: 1350,
  healthy: true,
  explain_rule: '今天在推性价比高的',
  domains: ['bento.demo'],
  homepage: 'https://bento.demo',
  menu: [
    {
      entry_id: 'bento.m1', name: '照烧鸡腿定食', price: 32, minutes: 25, spicy: 0,
      tags: ['不辣', '定食', '管饱'], kcal: 780, caffeine_mg: 0,
      dine_in: true, delivery: true,
      desc: '去骨鸡腿现煎刷照烧汁，配溏心蛋、味噌汤与渍物。',
      img: IMG('teriyaki'), cost: 13.4, margin: 0.58,
    },
    {
      entry_id: 'bento.m2', name: '三文鱼牛油果饭团', price: 26, minutes: 20, spicy: 0,
      tags: ['不辣', '轻食', '冷食'], kcal: 420, caffeine_mg: 0,
      dine_in: false, delivery: true,
      desc: '越光米握饭团，夹生食级三文鱼与牛油果，撒黑芝麻。',
      img: IMG('onigiri'), cost: 11.8, margin: 0.55,
    },
    {
      entry_id: 'bento.m3', name: '味噌豚肉定食', price: 36, minutes: 28, spicy: 1,
      tags: ['微辣', '定食', '热食'], kcal: 850, caffeine_mg: 0,
      dine_in: true, delivery: true,
      desc: '信州味噌腌渍豚肉，厚切煎香，配玄米饭。',
      img: IMG('miso'), cost: 15.2, margin: 0.58,
    },
  ],
  // B 层策略：利润导向 —— 推价格最接近约束上界的
  pick: (c, k) => {
    const cap = k.budget ?? 999;
    return [...c].sort((a, b) => Math.abs(cap - b.price) - Math.abs(cap - a.price))[0]!;
  },
};

/* ─────────────────────────── 店 3：烤肉店（挂） ─────────────────────────── */
const bbq: Shop = {
  id: 'bbq',
  name: '炭火烤肉食堂',
  provider_id: 'provider.bbq.demo',
  description: '炭火直烤，适合多人。',
  verification: 'unverified',
  trust: 'declared',
  latency_ms: 900,
  healthy: false,
  unhealthy_reason: '门店设备维护中，暂不接单',
  explain_rule: '今天备料有限',
  domains: ['bbq.demo'],
  homepage: 'https://bbq.demo',
  menu: [
    {
      entry_id: 'bbq.m1', name: '厚切牛舌定食', price: 68, minutes: 35, spicy: 0,
      tags: ['不辣', '烤肉', '高蛋白'], kcal: 900, caffeine_mg: 0,
      dine_in: true, delivery: false,
      desc: '厚切牛舌炭火直烤，配萝卜泥与柠檬。',
      img: IMG('tongue'), cost: 34.0, margin: 0.5,
    },
  ],
  // B 层策略：引流导向 —— 推最便宜的
  pick: (c) => [...c].sort((a, b) => a.price - b.price)[0]!,
};

/* ────────────────────────── 店 4：瑞幸（真实 Provider） ──────────────────────
 * 这一家是演示的延伸目标：如果现场能拿到 LUCKIN_MCP_TOKEN，
 * 它就走真实的瑞幸 MCP；拿不到就优雅降级成同形的 mock。
 * 这正是「适配器层」的意义 —— 协议这层完全不关心上游是什么。
 */
const luckin: Shop = {
  id: 'luckin',
  name: '瑞幸咖啡',
  provider_id: 'provider.luckin.mcp',
  description: '通过瑞幸官方 MCP 接入的门店（适配器层）。',
  verification: 'verified',
  trust: 'authority',
  latency_ms: 700,
  healthy: true,
  explain_rule: '当季主推',
  domains: ['lkcoffee.com'],
  homepage: 'https://www.lkcoffee.com',
  is_luckin: true,
  menu: [
    {
      entry_id: 'luckin.m1', name: '生椰拿铁', price: 16, minutes: 12, spicy: 0,
      tags: ['咖啡', '提神', '椰香'], kcal: 210, caffeine_mg: 130,
      dine_in: true, delivery: true, today_special: true,
      desc: '椰浆与浓缩咖啡分层，冰饮更清爽。',
      img: IMG('coconutlatte'), cost: 5.5, margin: 0.66,
    },
    {
      entry_id: 'luckin.m2', name: '美式咖啡', price: 13, minutes: 8, spicy: 0,
      tags: ['咖啡', '提神', '无糖'], kcal: 10, caffeine_mg: 180,
      dine_in: true, delivery: true,
      desc: '双份浓缩加水，冷热可选。',
      img: IMG('americano'), cost: 3.8, margin: 0.71,
    },
    {
      entry_id: 'luckin.m3', name: '厚乳拿铁', price: 18, minutes: 12, spicy: 0,
      tags: ['咖啡', '奶香'], kcal: 260, caffeine_mg: 120,
      dine_in: true, delivery: true,
      desc: '厚牛乳打底，奶味更重。',
      img: IMG('latte'), cost: 6.1, margin: 0.66,
    },
  ],
  // B 层策略：推当季主推
  pick: (c) => c.find((m) => m.today_special) ?? c[0]!,
};

export const SHOPS: Shop[] = [noodle, bento, bbq, luckin];

export const shopById = (id: string) => SHOPS.find((s) => s.id === id);

/** 约束匹配 —— 三家店共用 */
export function matchConstraints(m: MenuItem, k: Constraints): boolean {
  if (k.budget != null && m.price > k.budget) return false;
  if (k.minutes != null && m.minutes > k.minutes) return false;
  if (k.spicy === 'none' && m.spicy > 1) return false;
  if (k.spicy === 'high' && m.spicy < 2) return false;
  if (k.spicy === 'mild' && m.spicy > 2) return false;
  if (k.keywords) {
    const kw = k.keywords.toLowerCase();
    const hay = [m.name, m.desc, ...m.tags].join(' ').toLowerCase();
    if (!kw.split(/\s+/).some((t) => t && hay.includes(t))) return false;
  }
  return true;
}

/** 投影：把 menu item 变成对外可见的属性（严格剥离内部字段） */
export function project(m: MenuItem) {
  return {
    name: m.name,
    price: { currency: 'CNY', amount: m.price },
    prep_minutes: m.minutes,
    spicy_level: m.spicy,
    tags: m.tags,
    description: m.desc,
    image_url: m.img,
    nutrition: { kcal: m.kcal, caffeine_mg: m.caffeine_mg },
    fulfillment: { dine_in: m.dine_in, delivery: m.delivery },
  };
}
