import { createHash } from 'node:crypto';

const VECTOR_SIZE = 24;

const CONCEPTS = [
  { key: '轻薄', words: ['轻薄', '便携', '通勤', '出差', '旅行', '宿舍', '重量轻'] },
  { key: '游戏', words: ['游戏', '电竞', '高帧', '独显', '3a', '显卡'] },
  { key: '创作', words: ['设计', '剪辑', '视频', '创作', '渲染', '建模', '摄影'] },
  { key: '办公', words: ['办公', '商务', '会议', '工作', '生产力', '程序员', '编程'] },
  { key: '学习', words: ['学生', '学习', '校园', '网课', '论文', '大学生'] },
  { key: '续航', words: ['续航', '电池', '一天', '不插电'] },
  { key: '性能', words: ['性能', '强劲', '多任务', '旗舰', '速度快'] },
  { key: '静音', words: ['静音', '安静', '图书馆', '低噪音'] },
  { key: '屏幕', words: ['屏幕', '显示', '高刷', '色准', '护眼'] },
  { key: '二合一', words: ['二合一', '触控', '平板', '翻转', '手写'] },
  { key: '性价比', words: ['性价比', '实惠', '便宜', '预算有限', '入门'] },
  { key: '扩展', words: ['接口', '扩展', '外接', '雷电', '网口'] },
];

const STOP_WORDS = new Set(['我', '想', '要', '一台', '一个', '的', '了', '和', '或', '帮我', '推荐', '笔记本', '电脑', '适合', '需要']);

/** 将任意文本映射为可重复计算的稠密向量。 */
export function createEmbedding(text) {
  const normalized = String(text).toLowerCase();
  const vector = Array(VECTOR_SIZE).fill(0);

  for (const [conceptIndex, concept] of CONCEPTS.entries()) {
    const hits = concept.words.filter((word) => normalized.includes(word)).length;
    if (hits > 0) vector[conceptIndex] = 1 + Math.min(hits, 3) * 0.25;
  }

  const tokens = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    const index = 12 + (hash[0] % (VECTOR_SIZE - 12));
    vector[index] += 0.2;
  }

  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

/** 将商家输入的笔记本数据整理为面向检索的商品知识。 */
export function enrichLaptopProduct(input) {
  const specs = normalizeSpecs(input.specs ?? {});
  const tags = inferProductTags(input, specs);
  const semanticText = [
    input.title,
    input.brand,
    input.category ?? '笔记本电脑',
    input.description,
    ...Object.entries(specs).map(([key, value]) => `${key} ${value}`),
    ...tags,
  ].filter(Boolean).join(' ');

  const profile = {
    productType: '笔记本电脑',
    scenarios: tags.filter((tag) => ['轻薄', '游戏', '创作', '办公', '学习', '二合一'].includes(tag)),
    strengths: tags.filter((tag) => !['轻薄', '游戏', '创作', '办公', '学习', '二合一'].includes(tag)),
    normalizedSpecs: specs,
    searchTags: tags,
  };

  return {
    ...input,
    category: input.category?.trim() || '笔记本电脑',
    specs,
    aiText: semanticText,
    aiProfile: profile,
    embedding: createEmbedding(semanticText),
  };
}

/** 从自然语言需求中提取笔记本购买约束。 */
export function understandLaptopRequest(message) {
  const text = String(message).trim().toLowerCase();
  const concepts = CONCEPTS.filter((concept) => concept.words.some((word) => text.includes(word))).map((concept) => concept.key);
  const budgetMatch = text.match(/(?:预算|不超过|以内|低于|最多|价格)[^0-9]{0,5}(\d{3,6})|([1-9]\d{2,5})\s*元/);
  const minMemoryMatch = text.match(/(\d{1,3})\s*g(?:b)?\s*(?:内存|ram)/i);
  const maxWeightMatch = text.match(/(?:重量|不超过|低于)[^0-9]{0,5}(\d(?:\.\d+)?)\s*(?:kg|公斤)/i);
  const keywords = [...new Set([
    ...concepts,
    ...(text.match(/[a-z]+\s*\d*[a-z0-9-]*/gi) ?? []).map((item) => item.trim()),
  ])].filter((word) => word && !STOP_WORDS.has(word));

  return {
    original: message,
    concepts,
    keywords,
    maxPrice: budgetMatch ? Number(budgetMatch[1] ?? budgetMatch[2]) : null,
    minMemory: minMemoryMatch ? Number(minMemoryMatch[1]) : null,
    maxWeight: maxWeightMatch ? Number(maxWeightMatch[1]) : null,
    embedding: createEmbedding(`${message} ${concepts.join(' ')}`),
  };
}

/** 计算两个归一化向量之间的余弦相似度。 */
export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

/** 根据用户约束计算商品硬条件得分与解释。 */
export function scoreConstraints(intent, product) {
  let score = 1;
  const reasons = [];
  const specs = product.aiProfile.normalizedSpecs;

  if (intent.maxPrice) {
    if (product.price <= intent.maxPrice) reasons.push(`价格在 ${intent.maxPrice} 元预算内`);
    else score = 0;
  }
  if (intent.minMemory) {
    const memory = Number.parseInt(specs.内存, 10) || 0;
    if (memory >= intent.minMemory) reasons.push(`满足 ${intent.minMemory}GB 内存要求`);
    else score = 0;
  }
  if (intent.maxWeight) {
    const weight = Number.parseFloat(specs.重量) || 99;
    if (weight <= intent.maxWeight) reasons.push(`重量 ${specs.重量}`);
    else score = 0;
  }
  if (product.inventory <= 0) score = 0;

  return { score, reasons };
}

/** 生成面向前端的简短推荐回复。 */
export function composeRecommendation(intent, results) {
  if (results.length === 0) return '没有找到同时满足条件且有库存的商品。可以提高预算或减少一项限制。';
  const constraints = [
    intent.maxPrice ? `预算不超过 ${intent.maxPrice} 元` : '',
    intent.minMemory ? `至少 ${intent.minMemory}GB 内存` : '',
    intent.maxWeight ? `重量不超过 ${intent.maxWeight}kg` : '',
    ...intent.concepts,
  ].filter(Boolean);
  const prefix = constraints.length ? `我识别到：${constraints.join('、')}。` : '我结合语义和商品资料完成了检索。';
  return `${prefix}下面按综合匹配度列出 ${results.length} 款笔记本，第一款是当前条件下的首选。`;
}

function normalizeSpecs(specs) {
  return Object.fromEntries(Object.entries(specs).map(([key, value]) => [String(key).trim(), String(value).trim()]).filter(([key, value]) => key && value));
}

function inferProductTags(input, specs) {
  const text = `${input.title} ${input.description} ${Object.values(specs).join(' ')}`.toLowerCase();
  const tags = CONCEPTS.filter((concept) => concept.words.some((word) => text.includes(word))).map((concept) => concept.key);
  const weight = Number.parseFloat(specs.重量);
  const battery = Number.parseFloat(specs.续航);
  const memory = Number.parseInt(specs.内存, 10);
  if (weight && weight <= 1.4) tags.push('轻薄');
  if (battery && battery >= 12) tags.push('续航');
  if (memory && memory >= 32) tags.push('性能');
  return [...new Set(tags)];
}
