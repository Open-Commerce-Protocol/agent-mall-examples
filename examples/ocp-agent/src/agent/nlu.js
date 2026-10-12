/**
 * NLU：自然语言 → 查询意图（中文规则解析，零依赖）。
 *
 * 输出 {keywords, category, budget_min, budget_max, brand, quantity, raw}：
 * - keywords：去掉数量/预算/品牌词后的残余检索词
 * - category：品类同义词组命中后的规范品类名
 * - budget_min / budget_max：预算区间（元），无预算时为 null
 * - brand：品牌白名单命中（null 表示未识别）
 * - quantity：购买数量，默认 1
 */

/** 品类同义词组：值 = 规范品类名（与 store.js 中 category 一致），键 = 触发词 */
const CATEGORY_SYNONYMS = new Map([
  // 耳机
  ['耳机', '耳机'], ['降噪耳机', '耳机'], ['蓝牙耳机', '耳机'], ['头戴耳机', '耳机'],
  ['耳麦', '耳机'], ['耳机降噪', '耳机'],
  // 键盘
  ['键盘', '键盘'], ['机械键盘', '键盘'], ['无线键盘', '键盘'],
  // 音箱
  ['音箱', '音箱'], ['音响', '音箱'], ['扬声器', '音箱'], ['蓝牙音箱', '音箱'],
  // 帐篷
  ['帐篷', '帐篷'], ['露营帐篷', '帐篷'], ['天幕', '帐篷'],
  // 水壶
  ['水壶', '水壶'], ['保温壶', '水壶'], ['保温杯', '水壶'], ['保温瓶', '水壶'],
  // 鞋
  ['鞋', '鞋'], ['登山鞋', '鞋'], ['徒步鞋', '鞋'], ['跑鞋', '鞋'], ['运动鞋', '鞋'],
  // 服饰
  ['衣服', '服饰'], ['外套', '服饰'], ['冲锋衣', '服饰'], ['服装', '服饰'],
  ['摇粒绒', '服饰'], ['上衣', '服饰'],
  // 家居
  ['枕头', '家居'], ['乳胶枕', '家居'], ['床品', '家居'], ['四件套', '家居'],
  ['被子', '家居'], ['家居', '家居'],
]);

/** 品牌白名单（大小写不敏感匹配） */
const BRAND_WHITELIST = [
  'anker soundcore', 'soundcore', '小米', '索尼', '罗技', 'ikbc', '华为',
  '骆驼', '牧高笛', '乐扣乐扣', 'Stanley', '迪卡侬', 'Salomon', '萨洛蒙',
  '优衣库', '凯乐石', '网易严选', '水星家纺',
];

/** 中文数字映射（用于「两副」「三件」等数量表达） */
const CN_NUMBERS = new Map([
  ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5],
  ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
]);

/** 量词：用于识别「买2个」「两副」「买个」中的数量表达（数字可省略） */
const QUANTIFIER_RE = /(?:买|来|要)?\s*((?:\d+|[一两二三四五六七八九十])?)\s*(个|只|副|台|件|双|把|套|条|支|杯)/;

/**
 * 商家 domain 词表：命中即把请求路由到对应商家 MCP（config/mcp.json 注册）。
 * 未命中任何词时走现有内存目录流程。
 */
const MERCHANT_DOMAINS = new Map([
  [
    'my-coffee',
    [
      '咖啡', '拿铁', '生椰', '奶茶', '瑞幸', '美式', '摩卡', '澳白', '气泡水', '饮品',
      '轻乳茶', '浓缩', 'Dirty', 'dirty', '丝绒拿铁', '橙C', '柚C',
    ],
  ],
  [
    'mcd-mcp',
    [
      '麦当劳', '汉堡', '麦乐鸡', '薯条', '快餐', '巨无霸', '板烧', '麦咖啡', '麦辣',
      '麦麦', '板烧鸡腿', '1+1',
    ],
  ],
]);

/**
 * 商家 domain 判定：在全部商家词表中取「最长命中词」所属商家（避免「麦咖啡」被「咖啡」抢先路由到瑞幸）。
 * @param {string} text 原始输入
 * @returns {{merchant_id: string, matched_word: string}|null} 未命中为 null
 */
function detectMerchant(text) {
  const t = String(text ?? '');
  let best = null;
  for (const [merchantId, words] of MERCHANT_DOMAINS) {
    for (const word of words) {
      if (t.includes(word) && (!best || word.length > best.matched_word.length)) {
        best = { merchant_id: merchantId, matched_word: word };
      }
    }
  }
  return best;
}

/** 口语填充词（剥除后不参与检索） */
const FILLER_RE = /[的了想找看看都来要买]/g;

/**
 * 从文本中提取预算区间（元）。
 * 支持：「1000元以内」「预算500」「低于300」「300-800」「500以内」「不超过800」「800以下」等。
 * @param {string} text 原始输入
 * @returns {{budget_min: number|null, budget_max: number|null}} 无预算时均为 null
 */
function extractBudget(text) {
  let m;
  // 区间：300-800 / 300到800 / 300～800
  m = text.match(/(\d+(?:\.\d+)?)\s*[-~～到]\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (m) {
    return { budget_min: Number(m[1]), budget_max: Number(m[2]) };
  }
  // 上限：以内 / 以下 / 不超过 / 低于 / 最多
  m = text.match(/(?:以内|以内|以下|不超过|不高于|低于|最多|小于)\s*(\d+(?:\.\d+)?)|(?:预算|价格)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?\s*(?:以内|以内|以下)/);
  if (m) {
    return { budget_min: null, budget_max: Number(m[1] ?? m[2]) };
  }
  // 「预算500」「预算 500 元」
  m = text.match(/预算\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (m) {
    return { budget_min: null, budget_max: Number(m[1]) };
  }
  // 「xx元以内 / xx元以下」已覆盖；再兜底「不超过/低于」前置数字
  m = text.match(/(?:不超过|不高于|低于|小于)\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/);
  if (m) {
    return { budget_min: null, budget_max: Number(m[1]) };
  }
  return { budget_min: null, budget_max: null };
}

/**
 * 从文本中提取购买数量。
 * @param {string} text 原始输入
 * @returns {number} 数量（默认 1）
 */
function extractQuantity(text) {
  const m = text.match(QUANTIFIER_RE);
  if (!m) return 1;
  const numPart = m[1];
  if (!numPart) return 1;
  if (/^\d+$/.test(numPart)) {
    const n = Number(numPart);
    return n >= 1 && n <= 99 ? n : 1;
  }
  const n = CN_NUMBERS.get(numPart) ?? 1;
  return n;
}

/**
 * 匹配品牌白名单。
 * @param {string} text 原始输入
 * @returns {string|null} 命中的品牌（保留白名单原始写法），未命中为 null
 */
function extractBrand(text) {
  const lower = text.toLowerCase();
  for (const brand of BRAND_WHITELIST) {
    if (lower.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

/**
 * 提取品类与关键词。
 * 先按同义词组识别品类；再从文本剥离数量、预算、品牌、品类触发词，
 * 残余的有意义词作为 keywords（用于 /ocp/query 的关键词检索）。
 * @param {string} text 原始输入
 * @returns {{category: string|null, keywords: string[], matchedTrigger: string|null}}
 */
function extractCategoryAndKeywords(text) {
  let category = null;
  let matchedTrigger = null;
  // 品类触发词按长度降序匹配（「降噪耳机」优先于「耳机」）
  const triggers = Array.from(CATEGORY_SYNONYMS.keys()).sort((a, b) => b.length - a.length);
  for (const trigger of triggers) {
    if (text.includes(trigger)) {
      category = CATEGORY_SYNONYMS.get(trigger);
      matchedTrigger = trigger;
      break;
    }
  }

  // 剥离：预算表达、数量表达、口语填充词、标点
  let residue = text
    .replace(/(?:\d+(?:\.\d+)?\s*[-~～到]\s*\d+(?:\.\d+)?)\s*(?:元|块)?/g, ' ')
    .replace(/(?:以内|以下|不超过|不高于|低于|最多|小于)\s*\d+(?:\.\d+)?\s*(?:元|块)?/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:元|块)?\s*(?:以内|以下)/g, ' ')
    .replace(/预算\s*\d+(?:\.\d+)?\s*(?:元|块)?/g, ' ')
    .replace(QUANTIFIER_RE, ' ')
    .replace(FILLER_RE, ' ')
    .replace(/[，。、,.\s]+/g, ' ');

  // 剥离品类触发词（避免把「耳机」本身当关键词重复检索，但保留规范品类供过滤）
  if (matchedTrigger) {
    residue = residue.split(matchedTrigger).join(' ');
  }

  const keywords = [matchedTrigger, ...residue.split(/\s+/)]
    .filter((w) => w && w.length >= 1);
  // 去重（触发词可能与残余词重复）
  return { category, keywords: Array.from(new Set(keywords)), matchedTrigger };
}

/**
 * 解析自然语言需求为查询意图。
 * @param {string} text 用户输入（如「1000元以内的无线降噪耳机 买2个」）
 * @returns {{keywords: string[], category: string|null, budget_min: number|null,
 *            budget_max: number|null, brand: string|null, quantity: number,
 *            merchant: {merchant_id: string, matched_word: string}|null, raw: string}}
 */
function parseIntent(text) {
  const raw = String(text ?? '').trim();
  const budget = extractBudget(raw);
  const quantity = extractQuantity(raw);
  const brand = extractBrand(raw);
  const { category, keywords } = extractCategoryAndKeywords(raw);
  const merchant = detectMerchant(raw);
  return {
    keywords,
    category,
    budget_min: budget.budget_min,
    budget_max: budget.budget_max,
    brand,
    quantity,
    merchant,
    raw,
  };
}

module.exports = {
  parseIntent,
  extractBudget,
  extractQuantity,
  extractBrand,
  detectMerchant,
};
