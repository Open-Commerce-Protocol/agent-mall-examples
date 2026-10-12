/**
 * 内存商品库（Catalog 数据源）。
 *
 * 纯数据模块：只负责持有商品记录并提供按 id / entry_id 查找。
 * 金额统一使用「元」的整数表示（CNY），避免浮点误差；
 * 展示层直接拼接 `¥${amount}` 即可。
 */

/** @typedef {'in_stock'|'low_stock'|'out_of_stock'} AvailabilityStatus */

/**
 * @typedef {Object} Product
 * @property {string} id            商品唯一 id（object_id）
 * @property {string} title         商品标题
 * @property {string} summary       商品摘要
 * @property {string} brand         品牌
 * @property {string} category      品类（中文）
 * @property {string} currency      货币，固定 'CNY'
 * @property {number} amount        单价（元，整数）
 * @property {AvailabilityStatus} availability 库存状态
 * @property {string} url           商品详情页 URL
 * @property {string} updatedAt     最后更新时间（ISO 8601）
 */

/** 演示目录 id / 名称 / provider id（与官方示例命名风格一致） */
const CATALOG_ID = 'cat_koudou_demo';
const CATALOG_NAME = '寇豆码演示目录';
const PROVIDER_ID = 'koudou_inmemory';

/** @type {Product[]} 内存商品清单（≥12 个，覆盖数码/户外/服饰/家居等品类） */
const PRODUCTS = [
  {
    id: 'p001',
    title: '声阔 Space One 无线降噪耳机',
    summary: '头戴式主动降噪蓝牙耳机，40小时续航，支持高解析音频，通勤与办公皆宜。',
    brand: 'Anker Soundcore',
    category: '耳机',
    currency: 'CNY',
    amount: 999,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/soundcore-space-one',
    updatedAt: '2026-10-08T10:00:00.000Z',
  },
  {
    id: 'p002',
    title: '小米 Redmi Buds 6 活力版 真无线耳机',
    summary: '半入耳式蓝牙耳机，超长续航，轻巧佩戴，适合日常通话与音乐。',
    brand: '小米',
    category: '耳机',
    currency: 'CNY',
    amount: 199,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/redmi-buds-6',
    updatedAt: '2026-10-09T08:30:00.000Z',
  },
  {
    id: 'p003',
    title: '索尼 WH-1000XM6 旗舰降噪耳机',
    summary: '行业标杆级主动降噪头戴耳机，LDAC 高品质传输，智能免摘对话。',
    brand: '索尼',
    category: '耳机',
    currency: 'CNY',
    amount: 2899,
    availability: 'low_stock',
    url: 'https://shop.example.com/p/sony-wh1000xm6',
    updatedAt: '2026-10-10T09:00:00.000Z',
  },
  {
    id: 'p004',
    title: '罗技 MX Keys S 无线键盘',
    summary: '智能背光超薄键盘，多设备切换，Quiet Click 静音轴体，办公利器。',
    brand: '罗技',
    category: '键盘',
    currency: 'CNY',
    amount: 799,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/logitech-mx-keys-s',
    updatedAt: '2026-10-07T14:00:00.000Z',
  },
  {
    id: 'p005',
    title: 'ikbc C87 机械键盘 红轴',
    summary: '87键无冲机械键盘，PBT 键帽，Cherry 红轴，程序员手感之选。',
    brand: 'ikbc',
    category: '键盘',
    currency: 'CNY',
    amount: 399,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/ikbc-c87-red',
    updatedAt: '2026-10-06T11:20:00.000Z',
  },
  {
    id: 'p006',
    title: '小米 Sound Pro 智能音箱',
    summary: '40W 大功率 Hi-Fi 音箱，360° 全向出音，支持无损音质与小爱同学。',
    brand: '小米',
    category: '音箱',
    currency: 'CNY',
    amount: 899,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/mi-sound-pro',
    updatedAt: '2026-10-09T16:40:00.000Z',
  },
  {
    id: 'p007',
    title: '华为 Sound Joy 2 便携音箱',
    summary: '帝瓦雷联合调音，26小时续航，IP67 防尘防水，户外聚会首选。',
    brand: '华为',
    category: '音箱',
    currency: 'CNY',
    amount: 699,
    availability: 'low_stock',
    url: 'https://shop.example.com/p/huawei-sound-joy-2',
    updatedAt: '2026-10-10T10:10:00.000Z',
  },
  {
    id: 'p008',
    title: '骆驼 3人全自动速开帐篷',
    summary: '液压自动速开，防晒涂层，防风防雨，家庭露营露营装备。',
    brand: '骆驼',
    category: '帐篷',
    currency: 'CNY',
    amount: 459,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/camel-tent-3p',
    updatedAt: '2026-10-05T09:00:00.000Z',
  },
  {
    id: 'p009',
    title: '牧高笛 冷山UL2 轻量化帐篷',
    summary: '双人轻量徒步帐篷，仅1.9kg，20D 硅胶面料，专业户外之选。',
    brand: '牧高笛',
    category: '帐篷',
    currency: 'CNY',
    amount: 1099,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/mobi-garden-ul2',
    updatedAt: '2026-10-04T13:30:00.000Z',
  },
  {
    id: 'p010',
    title: '乐扣乐扣 Titan 保温水壶 1.5L',
    summary: '不锈钢真空保温壶，24小时长效保温，大容量适合出行露营。',
    brand: '乐扣乐扣',
    category: '水壶',
    currency: 'CNY',
    amount: 189,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/locknlock-titan-1.5l',
    updatedAt: '2026-10-08T18:00:00.000Z',
  },
  {
    id: 'p011',
    title: 'Stanley 经典真空保温水壶 1.1L',
    summary: '百年美式经典，军工级不锈钢，保温保冷两用，户外硬核装备。',
    brand: 'Stanley',
    category: '水壶',
    currency: 'CNY',
    amount: 429,
    availability: 'out_of_stock',
    url: 'https://shop.example.com/p/stanley-classic-1.1l',
    updatedAt: '2026-10-09T12:00:00.000Z',
  },
  {
    id: 'p012',
    title: '迪卡侬 QUECHUA 户外登山鞋 MH500',
    summary: '防水透气登山鞋，抓地大底，中帮护踝，轻装徒步首选。',
    brand: '迪卡侬',
    category: '鞋',
    currency: 'CNY',
    amount: 499,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/quechua-mh500',
    updatedAt: '2026-10-07T09:40:00.000Z',
  },
  {
    id: 'p013',
    title: 'Salomon 萨洛蒙 X ULTRA 4 GTX 登山鞋',
    summary: 'GORE-TEX 防水，Contagrip 大底，全地形稳定支撑，专业徒步。',
    brand: 'Salomon',
    category: '鞋',
    currency: 'CNY',
    amount: 1298,
    availability: 'low_stock',
    url: 'https://shop.example.com/p/salomon-x-ultra-4',
    updatedAt: '2026-10-10T15:00:00.000Z',
  },
  {
    id: 'p014',
    title: '优衣库 摇粒绒拉链外套 男款',
    summary: '轻便保暖摇粒绒，可机洗快干，秋冬叠穿百搭。',
    brand: '优衣库',
    category: '服饰',
    currency: 'CNY',
    amount: 199,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/uniqlo-fleece-zip',
    updatedAt: '2026-10-06T10:00:00.000Z',
  },
  {
    id: 'p015',
    title: '凯乐石 户外冲锋衣 三合一',
    summary: 'GORE-TEX 防水透气，内胆可拆卸，防风防雨一衣两穿。',
    brand: '凯乐石',
    category: '服饰',
    currency: 'CNY',
    amount: 1599,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/kailas-3in1-jacket',
    updatedAt: '2026-10-09T11:00:00.000Z',
  },
  {
    id: 'p016',
    title: '网易严选 记忆棉乳胶枕',
    summary: '泰国乳胶+记忆棉复合枕芯，护颈承托，抑菌透气。',
    brand: '网易严选',
    category: '家居',
    currency: 'CNY',
    amount: 259,
    availability: 'in_stock',
    url: 'https://shop.example.com/p/netease-latex-pillow',
    updatedAt: '2026-10-05T16:00:00.000Z',
  },
  {
    id: 'p017',
    title: '水星家纺 纯棉四件套 100支长绒棉',
    summary: '100支新疆长绒棉贡缎，裸睡级亲肤，卧室床品升级。',
    brand: '水星家纺',
    category: '家居',
    currency: 'CNY',
    amount: 699,
    availability: 'low_stock',
    url: 'https://shop.example.com/p/mercury-cotton-set',
    updatedAt: '2026-10-08T14:30:00.000Z',
  },
];

/** 由商品 id 推导 OCP entry_id（与官方示例公式一致） */
function entryId(productId) {
  return `entry_${PROVIDER_ID}_${productId}`;
}

/** 按 object_id 查找商品 */
function findProductById(objectId) {
  return PRODUCTS.find((p) => p.id === objectId) || null;
}

/** 按 entry_id 查找商品 */
function findProductByEntryId(entryIdValue) {
  return PRODUCTS.find((p) => entryId(p.id) === entryIdValue) || null;
}

/** 返回全量商品（调用方可自行过滤/排序，不修改内部数组） */
function allProducts() {
  return PRODUCTS.slice();
}

/** 商品是否可购买（库存>0） */
function isPurchasable(product) {
  return product.availability !== 'out_of_stock';
}

module.exports = {
  CATALOG_ID,
  CATALOG_NAME,
  PROVIDER_ID,
  PRODUCTS,
  entryId,
  findProductById,
  findProductByEntryId,
  allProducts,
  isPurchasable,
};
