import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/database.mjs';
import { composeRecommendation, cosineSimilarity, scoreConstraints, understandLaptopRequest } from './src/agents.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const store = createStore(join(ROOT, 'data', 'commerce.sqlite'));
const port = Number(process.env.PORT || 4173);

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

/** 处理用户需求并执行关键词、向量与约束混合检索。 */
function searchProducts(message) {
  const intent = understandLaptopRequest(message);
  const products = store.listProducts();
  const terms = [...intent.keywords, ...intent.concepts];
  const keywordMatches = store.searchProductKeywords(terms);
  const keywordRanks = new Map(keywordMatches.map((item, index) => [Number(item.id), 1 - index / Math.max(keywordMatches.length, 1)]));
  const scored = products.map((product) => {
    const searchable = `${product.title} ${product.brand} ${product.ai_text}`.toLowerCase();
    const keywordHits = terms.filter((term) => searchable.includes(term.toLowerCase())).length;
    const fieldScore = terms.length ? keywordHits / terms.length : 0.35;
    const keywordScore = terms.length ? fieldScore * 0.65 + (keywordRanks.get(product.id) ?? 0) * 0.35 : fieldScore;
    const vectorScore = Math.max(0, cosineSimilarity(intent.embedding, product.embedding));
    const constraint = scoreConstraints(intent, product);
    const totalScore = constraint.score === 0 ? 0 : (keywordScore * 0.36 + vectorScore * 0.44 + constraint.score * 0.2);
    const matchedTags = product.aiProfile.searchTags.filter((tag) => intent.concepts.includes(tag));
    const reasons = [...constraint.reasons, ...matchedTags.map((tag) => `匹配“${tag}”使用场景`)];
    if (reasons.length === 0) reasons.push(vectorScore > 0.5 ? '语义特征与需求接近' : '商品信息与需求相关');
    return { ...product, match: { total: totalScore, keyword: keywordScore, vector: vectorScore, reasons } };
  }).filter((product) => product.match.total > 0).sort((a, b) => b.match.total - a.match.total).slice(0, 4);
  return { intent, products: scored, answer: composeRecommendation(intent, scored) };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    return serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message || '服务器错误' });
  }
});

/** 处理 Demo 的 JSON API。 */
async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/products') return sendJson(response, 200, store.listProducts());
  if (request.method === 'GET' && url.pathname === '/api/orders') return sendJson(response, 200, store.listOrders());
  if (request.method === 'GET' && url.pathname === '/api/stats') return sendJson(response, 200, store.stats());
  if (request.method === 'POST' && url.pathname === '/api/chat') return sendJson(response, 200, searchProducts((await readJson(request)).message));
  if (request.method === 'POST' && url.pathname === '/api/products') return sendJson(response, 201, store.createProduct(await readJson(request)));
  if (request.method === 'POST' && url.pathname === '/api/orders') return sendJson(response, 201, store.createOrder(await readJson(request)));

  const inventoryMatch = url.pathname.match(/^\/api\/products\/(\d+)\/inventory$/);
  if (request.method === 'PATCH' && inventoryMatch) return sendJson(response, 200, store.updateInventory(inventoryMatch[1], (await readJson(request)).inventory));
  const statusMatch = url.pathname.match(/^\/api\/orders\/(\d+)\/status$/);
  if (request.method === 'PATCH' && statusMatch) return sendJson(response, 200, store.updateOrderStatus(statusMatch[1], (await readJson(request)).status));
  return sendJson(response, 404, { error: '接口不存在' });
}

/** 提供 public 目录中的静态文件。 */
function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname === '/merchant' ? '/merchant.html' : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(response, 403, { error: '拒绝访问' });
  try {
    if (!statSync(filePath).isFile()) throw new Error('not file');
    response.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(readFileSync(filePath));
  } catch {
    sendJson(response, 404, { error: '页面不存在' });
  }
}

/** 读取并解析请求体中的 JSON。 */
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('请求内容过大');
  }
  return body ? JSON.parse(body) : {};
}

/** 返回 JSON 响应。 */
function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

server.listen(port, '127.0.0.1', () => {
  console.log(`AI 原生电商 Demo 已启动：http://127.0.0.1:${port}`);
  console.log(`商家控制台：http://127.0.0.1:${port}/merchant`);
});
