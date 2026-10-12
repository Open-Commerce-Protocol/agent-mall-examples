/**
 * 探测脚本：摸清瑞幸 MCP 的真实响应体结构。
 * 只调只读工具（查门店 / 搜商品 / 查详情），绝不下单。
 *
 *   bun run scripts/probe-luckin.ts
 */
import { luckinFromEnv } from '../src/luckin-mcp';

// 浙大紫金港校区附近
const LNG = 120.0876;
const LAT = 30.3086;

const show = (label: string, v: unknown) => {
  console.log(`\n${'='.repeat(72)}\n### ${label}\n${'='.repeat(72)}`);
  console.log(JSON.stringify(v, null, 2)?.slice(0, 4000) ?? String(v));
};

const client = luckinFromEnv();
if (!client) {
  console.error('✗ 未配置 LUCKIN_MCP_URL / LUCKIN_MCP_TOKEN');
  process.exit(1);
}

console.log('→ 初始化 MCP 会话…');
await client.init();
console.log('✓ 会话就绪\n');

// 1) 查门店
let shops: any;
try {
  shops = await client.queryShopList(LNG, LAT);
  show('1. queryShopList', shops);
} catch (e) {
  console.error('✗ queryShopList 失败:', (e as Error).message);
  process.exit(1);
}

// 尽量挖出 deptId
function findDeptId(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (/^(deptId|dept_id|shopId|shop_id|storeId|store_id|id)$/i.test(k)) {
        const n = Number(v[k]);
        if (Number.isInteger(n) && n > 0) return n;
      }
    }
    for (const k of Object.keys(v)) {
      const r = findDeptId(v[k]);
      if (r) return r;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findDeptId(item);
        if (r) return r;
      }
    }
  }
  return null;
}

const deptId = findDeptId(shops);
console.log(`\n>>> 挖到的 deptId = ${deptId}`);
if (!deptId) {
  console.error('✗ 没能从门店响应里找到 deptId，请看上面的原始结构');
  process.exit(1);
}

// 2) 搜商品
let products: any;
try {
  products = await client.searchProductForMcp(deptId, '拿铁');
  show('2. searchProductForMcp(deptId, "拿铁")', products);
} catch (e) {
  console.error('✗ searchProductForMcp 失败:', (e as Error).message);
}

// 3) 挖 productId + skuCode 后查详情
function findKey(v: any, re: RegExp): any {
  if (v == null) return null;
  if (typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (re.test(k) && v[k] != null && v[k] !== '') return v[k];
    }
    for (const k of Object.keys(v)) {
      const r = findKey(v[k], re);
      if (r != null) return r;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findKey(item, re);
        if (r != null) return r;
      }
    }
  }
  return null;
}

const productId = Number(findKey(products, /^(productId|product_id|spuId|spu_id)$/i));
const skuCode = findKey(products, /^(skuCode|sku_code|skuId|sku_id)$/i);
console.log(`\n>>> 挖到的 productId = ${productId}  skuCode = ${skuCode}`);

if (Number.isInteger(productId) && productId > 0) {
  try {
    const detail = await client.queryProductDetailInfo(deptId, productId);
    show('3. queryProductDetailInfo', detail);
  } catch (e) {
    console.error('✗ queryProductDetailInfo 失败:', (e as Error).message);
  }
}

console.log('\n✓ 探测完成（未产生任何订单）');
