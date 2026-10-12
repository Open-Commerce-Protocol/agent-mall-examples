/**
 * 真实下单：羽衣轻体果蔬茶
 *
 * ⚠️ 默认执行真实下单 —— 会产生真实订单并按你的账号扣款。
 *    只想预览不扣款：bun run scripts/order-kale.ts --dry
 *
 * 完整链路（对应 OCP 的 query → resolve → execute）：
 *   1. queryShopList        找到门店      → 对应 /ocp/query 的门店发现
 *   2. searchProductForMcp  搜到商品      → 对应 /ocp/query
 *   3. queryProductDetailInfo 拿规格/sku  → 对应 /ocp/contracts
 *   4. previewOrder         预览价格      → resolve(purpose=view) 的「看」
 *   5. createOrder          真实下单      → resolve(purpose=checkout) + execute
 *   6. queryOrderDetailInfo 查订单        → 履约查询（协议边界之外）
 */
import { luckinFromEnv } from '../src/luckin-mcp';

const DRY = process.argv.includes('--dry');
const KEYWORD = process.env.ORDER_KEYWORD ?? '羽衣甘蓝';
const LNG = Number(process.env.DEMO_LNG ?? 120.0876);
const LAT = Number(process.env.DEMO_LAT ?? 30.3086);
const DEPT_HINT = process.env.DEPT_NAME ?? '';

const client = luckinFromEnv();
if (!client) {
  console.error('✗ 未配置 LUCKIN_MCP_URL / LUCKIN_MCP_TOKEN');
  process.exit(1);
}

const line = (s = '') => console.log(s);
const step = (n: number, t: string) => line(`\n\x1b[1m[${n}] ${t}\x1b[0m`);
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const show = (v: unknown, max = 2200) => line(JSON.stringify(v, null, 2)?.slice(0, max) ?? String(v));

await client.init();
line(`\n\x1b[1m☕ 瑞幸真实下单${DRY ? '（预览模式，不下单）' : '（真实模式，会扣款）'}\x1b[0m`);

/* ── 1. 找门店 ── */
step(1, 'queryShopList · 找门店');
const shopsRes = await client.queryShopList(LNG, LAT);
const allShops: any[] = shopsRes?.data ?? [];
if (!allShops.length) {
  console.error('✗ 附近没有门店');
  process.exit(1);
}
allShops.forEach((s) =>
  line(`   ${dim(String(s.deptId).padEnd(8))} ${s.deptName.padEnd(18)} ${dim(s.workStatus)} ${dim(`${s.distance}km`)} ${dim(s.workTimeStart + '-' + s.workTimeEnd)}`),
);

const open = allShops.filter((s) => (s.workStatus ?? '').includes('营业'));
let dept = DEPT_HINT
  ? allShops.find((s) => s.deptName.includes(DEPT_HINT))
  : (open.length ? open : allShops).sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
if (!dept) {
  console.error(`✗ 没找到门店（筛选条件: ${DEPT_HINT || '最近的营业门店'}）`);
  process.exit(1);
}
line(`   → 选定: \x1b[1m${dept.deptName}\x1b[0m (deptId=${dept.deptId})`);
line(`     ${dim(dept.address)}`);
if (String(dept.address).includes('勿点')) {
  line(`     \x1b[33m⚠ 这家店标注了「校外勿点」—— 如果你不在校内，下单可能失败\x1b[0m`);
}

/* ── 2. 搜商品 ── */
step(2, `searchProductForMcp · 搜「${KEYWORD}」`);
const searchRes = await client.searchProductForMcp(dept.deptId, KEYWORD);
const products: any[] = searchRes?.data ?? [];
if (!products.length) {
  console.error('✗ 没搜到商品，换个关键词试试（ORDER_KEYWORD 环境变量）');
  process.exit(1);
}
products.forEach((p) =>
  line(`   ${dim(String(p.productId).padEnd(7))} ${p.productName.padEnd(20)} ¥${p.estimatePrice} ${dim(`(原价¥${p.initialPrice}) sku=${p.skuCode}`)}`),
);
const target = products[0]!;
line(`   → 选定: \x1b[1m${target.productName}\x1b[0m`);

/* ── 3. 查详情（拿规格 + skuCode） ── */
step(3, 'queryProductDetailInfo · 拿规格');
const detailRes = await client.queryProductDetailInfo(dept.deptId, target.productId);
const detail = detailRes?.data ?? {};
const specs: string[] = [];
for (const attr of detail.productAttrs ?? []) {
  const sel = (attr.productSubAttrs ?? []).find((x: any) => x.selected) ?? attr.productSubAttrs?.[0];
  if (sel) specs.push(`${attr.attributeName}=${sel.attributeName}`);
}
line(`   skuCode: ${dim(target.skuCode)}`);
line(`   默认规格: \x1b[1m${specs.join(' / ')}\x1b[0m`);
if (detail.productAttrs?.length) {
  line(`   ${dim('可选规格：')}`);
  for (const attr of detail.productAttrs) {
    const opts = (attr.productSubAttrs ?? []).map((x: any) => `${x.attributeName}${x.price ? `(+${x.price})` : ''}`).join('、');
    line(`     ${dim(attr.attributeName.padEnd(6))} ${opts}`);
  }
}

/* ── 4. 预览价格（不扣款） ── */
step(4, 'previewOrder · 预览价格（不扣款）');
const productList = [{ productId: target.productId, amount: 1, skuCode: target.skuCode }];
const previewRes = await client.previewOrder(dept.deptId, productList);
const pv = previewRes?.data ?? {};
line(`   应付金额: \x1b[1m¥${pv.discountPrice ?? pv.totalInitialPrice}\x1b[0m  ${dim(`(原价 ¥${pv.totalInitialPrice}，优惠 ¥${pv.privilegeMoney ?? 0})`)}`);
line(`   门店: ${pv.shopInfo?.deptName ?? dept.deptName}`);
for (const p of pv.productInfoList ?? []) {
  line(`   商品: ${p.name} × ${p.amount}  ${dim(p.additionDesc ?? '')}`);
}
line(`   ${dim(`取餐时间戳: ${pv.aboutTime} → ${new Date(pv.aboutTime).toLocaleString('zh-CN')}`)}`);

if (DRY) {
  line(`\n\x1b[33m预览模式结束 —— 没有产生任何订单。\x1b[0m`);
  line(`去掉 --dry 参数即可真实下单。\n`);
  process.exit(0);
}

/* ── 5. 真实下单 ── */
step(5, 'createOrder · \x1b[33m真实下单\x1b[0m');
line(`   ${dim('这一步会产生真实订单并按你的账号扣款…')}`);
const orderRes = await client.createOrder(dept.deptId, productList, LNG, LAT, { remark: 'OCP Demo' });
line(`\n   上游响应:`);
show(orderRes, 2600);

/* ── 6. 挖订单号并查订单 ── */
const raw = JSON.stringify(orderRes);
// ⚠️ orderId 是 19 位数字，超出 JS 安全整数范围（2^53-1），JSON.parse 会丢精度。
//    必须优先用字符串形式的 orderIdStr。
const orderId =
  orderRes?.data?.orderIdStr ?? orderRes?.orderIdStr ??
  raw.match(/"orderIdStr"\s*:\s*"(\d+)"/)?.[1] ??
  orderRes?.data?.orderNo ?? raw.match(/"order(?:Id|No|Number)"\s*:\s*"(\d+)"/i)?.[1];

const payUrl = orderRes?.data?.payOrderQrCodeUrl ?? orderRes?.data?.payOrderUrl;
if (payUrl) {
  step('5.1', '付款信息');
  line(`   需要付款: \x1b[1m${orderRes?.data?.needPay ? '是' : '否'}\x1b[0m`);
  line(`   付款二维码: ${orderRes?.data?.payOrderQrCodeUrl ?? dim('(无)')}`);
  line(`   微信拉起链接: ${orderRes?.data?.payOrderUrl ?? dim('(无)')}`);
}

if (orderId) {
  step(6, `queryOrderDetailInfo · 查订单 ${orderId}`);
  try {
    const od = await client.queryOrderDetailInfo(String(orderId));
    const d = od?.data ?? {};
    line(`   状态: \x1b[1m${d.orderStatusName ?? '?'}\x1b[0m  ${dim(`(orderStatus=${d.orderStatus})`)}`);
    line(`   门店: ${d.shopInfo?.deptName ?? '?'}`);
    line(`   金额: ¥${d.orderPayAmount ?? '?'}`);
    line(`   下单时间: ${d.createTime ?? '?'}`);
    for (const c of d.orderCommodityList ?? []) {
      line(`   商品: ${c.commodityName}  应付¥${c.payableMoney} / 已付¥${c.payMoney}`);
    }
  } catch (e) {
    line(`   查询失败: ${(e as Error).message}`);
  }
} else {
  line(`\n   ${dim('（没从响应里识别出 orderId，看上面的原始响应）')}`);
}

line(`\n${'─'.repeat(60)}`);
line(`\x1b[32m\x1b[1m下单流程走完\x1b[0m`);
line(`门店: ${dept.deptName}`);
line(`商品: ${target.productName}  ${specs.join(' / ')}`);
line(`金额: ¥${pv.discountPrice ?? '?'}`);
line(`${'─'.repeat(60)}\n`);
