/**
 * 探测「羽衣甘蓝轻体茶」：找到 productId / skuCode / 规格结构，
 * 并摸清 previewOrder 的真实响应（不产生扣款）。
 */
import { luckinFromEnv } from '../src/luckin-mcp';

const LNG = 120.0876, LAT = 30.3086;
const client = luckinFromEnv()!;

const show = (l: string, v: unknown) => {
  console.log(`\n${'='.repeat(72)}\n### ${l}\n${'='.repeat(72)}`);
  const s = JSON.stringify(v, null, 2);
  console.log(s?.slice(0, 5000) ?? String(v));
};

await client.init();
const shops = await client.queryShopList(LNG, LAT);
const dept = shops.data.filter((x: any) => x.workStatus?.includes('营业'))
  .sort((a: any, b: any) => a.distance - b.distance)[0];
console.log(`门店: ${dept.deptName} (deptId=${dept.deptId})`);

// 找羽衣甘蓝
for (const kw of ['羽衣甘蓝', '轻体茶', '甘蓝']) {
  console.log(`\n>>> 搜索关键词: ${kw}`);
  try {
    const r = await client.searchProductForMcp(dept.deptId, kw);
    const list = r?.data ?? [];
    console.log(`  返回 ${list.length} 款:`);
    for (const p of list) {
      console.log(`   · productId=${p.productId} | ${p.productName} | skuCode=${p.skuCode} | ¥${p.estimatePrice} (原价¥${p.initialPrice})`);
    }
    if (list.length) {
      const p = list[0];
      show(`商品详情 queryProductDetailInfo(deptId=${dept.deptId}, productId=${p.productId})`,
        await client.queryProductDetailInfo(dept.deptId, p.productId));
      // 只做预览，不下单
      const preview = await client.previewOrder(dept.deptId, [{ productId: p.productId, amount: 1, skuCode: p.skuCode }]);
      show(`previewOrder(${p.productName}) —— 不扣款`, preview);

      // 把这一款的 id 留给下一步
      console.log(`\n########## 目标商品 ##########`);
      console.log(JSON.stringify({ deptId: dept.deptId, productId: p.productId, skuCode: p.skuCode, name: p.productName, price: p.estimatePrice }));
      break;
    }
  } catch (e) {
    console.log('  失败:', (e as Error).message);
  }
}
