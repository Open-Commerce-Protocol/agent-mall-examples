#!/usr/bin/env node
/**
 * 一键点单：把"最后一公里"做成可复现的一步，而不是每次手拼脚本。
 *
 * 安全设计（三道）：
 *   1. **默认 dry-run**：只走 发现 → 查询 → 解析 → 选规格 → 预览，打印确认单与指纹，
 *      **绝不调用 createOrder**。
 *   2. 只有显式 `--execute` 才会请求真实下单；而桥接层的护栏还会二次把关——
 *      需要环境变量 LUCKIN_ORDER_CONFIRM 等于该订单的指纹，否则返回 428。
 *   3. 下单请求带上 `expected_amount` = 预览实付金额；若下单前价格有偏差，护栏拒绝。
 *
 * 用法：
 *   node scripts/order.ts                                  # dry-run：默认一杯生椰拿铁
 *   node scripts/order.ts --set 温度=热 --set 杯型=超大杯       # 改规格
 *   node scripts/order.ts --store 武林门 --drink 拿铁 --amount 2
 *   node scripts/order.ts --execute                        # 真实下单（仍需护栏已武装）
 *
 * 选项：
 *   --drink <关键字>     想喝什么（默认「生椰拿铁」）
 *   --store <店名子串>   选哪家店（默认：营业中且距打烊 ≥30 分钟里最近的一家）
 *   --set 属性=值        可重复。属性名/值来自 resolve 的实时规格
 *   --amount <n>         数量 1..10（默认 1）
 *   --remark <文本>      订单备注
 *   --coupon <券码>      可重复
 *   --execute            真实下单
 *   --help               显示本帮助
 */
import { bootstrap } from '../src/bootstrap.ts';
import { BRIDGE_PORT } from '../src/bridge/bridge-node.ts';
import { LUCKIN_QUERY_PACK } from '../src/catalog/luckin-catalog.ts';
import { REGISTRATION_PORT } from '../src/catalog/registration-node.ts';
import { minutesUntilClose, nowLocal } from '../src/lib/time.ts';

const BRIDGE = `http://127.0.0.1:${BRIDGE_PORT}`;
const REG = `http://127.0.0.1:${REGISTRATION_PORT}`;

/* ------------------------------------------------------------ 参数解析 */

type Options = {
  drink: string;
  store?: string;
  sets: { attribute: string; value: string }[];
  amount: number;
  remark?: string;
  coupons: string[];
  execute: boolean;
};

const HELP = `用法：node scripts/order.ts [选项]

  --drink <关键字>     想喝什么（默认「生椰拿铁」）
  --store <店名子串>   选哪家店（默认：营业中且距打烊 ≥30 分钟里最近的一家）
  --set 属性=值        可重复，例如 --set 温度=热 --set 糖度=少甜
  --amount <n>         数量 1..10（默认 1）
  --remark <文本>      订单备注
  --coupon <券码>      可重复
  --execute            真实下单（默认只预览）
  --help               显示本帮助`;

function parseArgs(argv: string[]): Options {
  const options: Options = { drink: '生椰拿铁', sets: [], amount: 1, coupons: [], execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`参数 ${String(flag)} 缺少取值`);
      i += 1;
      return value;
    };
    switch (flag) {
      case '--drink': options.drink = next(); break;
      case '--store': options.store = next(); break;
      case '--amount': options.amount = Number(next()); break;
      case '--remark': options.remark = next(); break;
      case '--coupon': options.coupons.push(next()); break;
      case '--execute': options.execute = true; break;
      case '--set': {
        const raw = next();
        const eq = raw.indexOf('=');
        if (eq <= 0) throw new Error(`--set 需要「属性=值」形式，收到 "${raw}"`);
        options.sets.push({ attribute: raw.slice(0, eq), value: raw.slice(eq + 1) });
        break;
      }
      case '--help':
      case '-h':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数 "${String(flag)}"（用 --help 看用法）`);
    }
  }
  if (!Number.isInteger(options.amount) || options.amount < 1 || options.amount > 10) {
    throw new Error('--amount 必须是 1..10 的整数');
  }
  return options;
}

/* ------------------------------------------------------------------ 主体 */

const api = async (url: string, body?: unknown): Promise<any> => {
  const res = await fetch(url, body === undefined ? { signal: AbortSignal.timeout(60_000) } : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return res.json();
};

const kv = (k: string, v: unknown): void => console.log(`  ${k.padEnd(22, ' ')}${String(v)}`);
const rule = (char = '─'): void => console.log(char.repeat(80));

function die(message: string, code = 1): never {
  console.error(`\n错误：${message}`);
  process.exit(code);
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  console.log(`\n一键点单　${nowLocal()}　模式：${options.execute ? '真实下单' : 'dry-run（只预览）'}`);
  await bootstrap();

  /* 1. 发现门店 */
  const discovery = await api(`${REG}/.well-known/ocp-registration`);
  const regManifest = await api(discovery.manifest_url);
  const search = await api(regManifest.endpoints.catalog_search, { query: '' });

  let candidates: any[] = search.items ?? [];
  if (options.store !== undefined) {
    candidates = candidates.filter((i) => String(i.catalog_name).includes(options.store as string));
    if (candidates.length === 0) die(`没有匹配「${options.store}」的门店`);
  } else {
    // 默认：营业中、距打烊 ≥30 分钟、距离最近。
    const usable = candidates.filter((i) => {
      const m = i.route_hint.metadata;
      if (m.work_status !== '营业中') return false;
      const left = minutesUntilClose(m.work_hours);
      return left === undefined || left >= 30;
    });
    if (usable.length > 0) candidates = usable;
  }
  const store = candidates[0];
  if (store === undefined) die('没有可用的门店');
  const deptId = Number(String(store.route_hint.query_url).match(/stores\/(\d+)/)?.[1]);
  const storeMeta = store.route_hint.metadata;
  console.log(`\n门店　${store.catalog_name}　${storeMeta.work_hours}　${storeMeta.distance_km}km　${storeMeta.address}`);

  /* 2. manifest → query pack */
  const manifest = await api(store.route_hint.manifest_url);
  const pack = manifest.query_capabilities[0].query_packs[0].pack_id;

  /* 3. 查询商品 */
  const query = await api(store.route_hint.query_url, { query_pack: pack, query_mode: 'keyword', query: options.drink });
  const entry = query.entries?.[0]?.entry;
  if (entry === undefined) die(`「${options.drink}」在这家店没搜到`);
  const productId = Number(entry.object_id);
  console.log(`商品　${entry.title}　productId=${productId}　列表价 ¥${entry.attributes.price.amount}`);

  /* 4. resolve 拿实时规格 */
  const resolved = await api(store.route_hint.resolve_url, { entry_id: entry.entry_id, purpose: 'checkout' });
  const optionGroups: any[] = resolved.visible_attributes?.options ?? [];
  if (optionGroups.length === 0) die('resolve 没返回可选规格');

  /* 5. 把 --set 映射成 id 并切换 */
  let skuCode: string = entry.attributes.sku;
  if (options.sets.length > 0) {
    const selections: { attributeId: number; subAttributeId: number }[] = [];
    for (const want of options.sets) {
      const group = optionGroups.find((g) => String(g.attribute_name) === want.attribute);
      if (group === undefined) {
        die(`没有「${want.attribute}」这个属性。可用：${optionGroups.map((g) => g.attribute_name).join('、')}`);
      }
      const choice =
        group.choices.find((c: any) => String(c.name) === want.value) ??
        group.choices.find((c: any) => String(c.name).includes(want.value));
      if (choice === undefined) {
        die(`「${want.attribute}」没有「${want.value}」。可选：${group.choices.map((c: any) => c.name).join('、')}`);
      }
      selections.push({ attributeId: Number(group.attribute_id), subAttributeId: Number(choice.sub_attribute_id) });
      const delta = Number(choice.price_delta ?? 0);
      console.log(`规格　${want.attribute} → ${choice.name}${delta ? `（+¥${delta}）` : ''}　subAttrId=${choice.sub_attribute_id}`);
    }
    const configured = await api(`${BRIDGE}/configure`, { deptId, productId, skuCode, amount: options.amount, selections });
    if (configured.final_sku_code === undefined) die(`选规格失败：${JSON.stringify(configured.error ?? configured)}`);
    skuCode = configured.final_sku_code;
    console.log(`　　　sku ${entry.attributes.sku} → ${skuCode}`);
  } else {
    console.log(`规格　（未指定 --set，使用默认）`);
  }

  /* 6. 预览 */
  const productList = [{ productId, skuCode, amount: options.amount }];
  const preview = await api(`${BRIDGE}/preview`, { deptId, productList });
  const summary = preview.order_summary;
  if (summary === undefined) die(`预览失败：${JSON.stringify(preview.error ?? preview)}`);

  /* 7. 确认单 */
  console.log('');
  rule('═');
  console.log('  订单确认单');
  rule('═');
  kv('门店', summary.store.dept_name);
  kv('地址', summary.store.address);
  kv('营业 / 距离', `${summary.store.work_hours} · ${summary.store.distance_km}km`);
  for (const l of summary.lines) {
    kv('商品', `${l.name} ×${l.amount}`);
    kv('规格', l.specs);
    kv('skuCode', l.skuCode);
  }
  if (options.remark !== undefined) kv('备注', options.remark);
  kv('原价', `¥${summary.pricing.total_initial}`);
  kv('优惠', `¥${summary.pricing.privilege}`);
  kv('实付', `¥${summary.pricing.payable}`);
  kv('优惠券', summary.coupon_codes.length > 0 ? summary.coupon_codes.join(', ') : '（无可用券）');
  kv('取餐时间', new Date(summary.pickup.about_time_ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  kv('订单指纹', preview.fingerprint);
  rule('═');

  /* 8. 下单或停止 */
  if (!options.execute) {
    console.log('\nDRY-RUN：未调用 createOrder，未产生任何订单。');
    console.log('要真实下单，需要两步（都必须由人完成）：');
    console.log(`  1) 核对上面的确认单；`);
    console.log(`  2) 设置 LUCKIN_ORDER_CONFIRM=${preview.fingerprint} 并重启桥接层，然后加 --execute 重跑。`);
    console.log(`     例：LUCKIN_ORDER_CONFIRM=${preview.fingerprint} npm start   （另开一个终端）`);
    process.exit(0);
  }

  const request: Record<string, unknown> = {
    deptId,
    productList,
    expected_amount: summary.pricing.payable,
  };
  if (options.coupons.length > 0) request.couponCodeList = options.coupons;
  if (options.remark !== undefined) request.remark = options.remark;

  console.log('\n⚠️  正在请求真实下单（会产生真实订单与实际扣款）…');
  const created = await api(`${BRIDGE}/create`, request);

  if (created.order !== undefined) {
    console.log('');
    rule('═');
    console.log('  下单成功');
    rule('═');
    kv('订单号', created.order.orderId ?? created.order.orderNo ?? JSON.stringify(created.order).slice(0, 120));
    kv('实付', `¥${summary.pricing.payable}`);
    kv('取餐时间', new Date(summary.pickup.about_time_ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    kv('门店', summary.store.dept_name);
    kv('指纹', created.fingerprint);
    rule('═');
    console.log(`\n${created.warning}`);
    console.log(`取消：curl -X POST ${BRIDGE}/order/cancel -H "content-type: application/json" -d "{\\"orderId\\":\\"<订单号>\\"}"`);
    process.exit(0);
  }

  console.log(`\n护栏拒绝了下单：${created.error?.code}`);
  console.log(`  ${created.error?.message}`);
  if (created.how_to_arm !== undefined) {
    kv('解锁 step 1', created.how_to_arm.step_1);
    kv('解锁 step 2', created.how_to_arm.step_2);
    kv('解锁 step 3', created.how_to_arm.step_3);
  }
  console.log(`\n  ${created.note ?? '未发生任何订单，未产生任何扣款。'}`);
  process.exit(2);
}

await main();
