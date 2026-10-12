/**
 * 瑞幸真实 MCP 菜单拉取(只读:searchProductForMcp)。
 * token 读自 .env.local;拉取失败自动降级到本地 luckin 目录数据。
 * 只做查询,不创建真实订单 —— 下单/支付/开票全部由模拟层完成。
 */
export type McpDrink = {
  product_id: number;
  sku_code: string;
  title: string;
  /** 预估到手价(当前优惠后) */
  price: number;
  /** 划线原价 */
  list_price: number;
  coffee: boolean;
  hot_capable: boolean;
};

const MCP_URL = 'https://gwmcp.lkcoffee.com/order/user/mcp';
const DEPT_ID = Number(process.env.LUCKIN_DEPT_ID ?? 327143); // 浙江大学紫金港校区店

let tokenCache: string | null | undefined;
async function token(): Promise<string | null> {
  if (tokenCache !== undefined) return tokenCache;
  try {
    const env = await Bun.file(`${import.meta.dir}/../.env.local`).text();
    const m = env.match(/LK_MCP_TOKEN=(.+)/);
    tokenCache = m?.[1]?.trim() ?? null;
  } catch {
    tokenCache = null;
  }
  return tokenCache;
}

/** 规则归一:MCP 返回字段不稳定,数字字段里挑第一个可用的 */
function normalizePrice(p: Record<string, unknown>): { price: number; list_price: number } {
  const est = p.estimatePrice ?? p.discountPrice ?? p.price ?? p.amount;
  const list = p.initialPrice ?? p.listPrice ?? est;
  const price = Number(est);
  const lp = Number(list);
  return {
    price: Number.isFinite(price) && price > 0 ? price : 15,
    list_price: Number.isFinite(lp) && lp > 0 ? lp : 15,
  };
}

function classify(title: string): { coffee: boolean; hot_capable: boolean } {
  const t = title.replace(/\s*/g, '');
  const coffee = /拿铁|美式|摩卡|澳白|卡布|馥芮白|浓缩/.test(t) && !/抹茶/.test(t);
  const hot_capable = coffee || /牛奶|奶茶|红茶/.test(t);
  return { coffee, hot_capable };
}

async function callTool(name: string, args: Record<string, unknown>, id: number): Promise<any> {
  const t = await token();
  if (!t) throw new Error('无 LK_MCP_TOKEN');
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  let raw = await res.text();
  if (raw.startsWith('event:') || raw.startsWith('data:')) {
    raw = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5))
      .join('');
  }
  const d = JSON.parse(raw);
  if (d.error) throw new Error(`MCP error: ${JSON.stringify(d.error).slice(0, 120)}`);
  const text = d.result?.content?.[0]?.text ?? '{}';
  // 瑞幸 orderId 是 19 位整数,超过 JS Number.MAX_SAFE_INTEGER(16位);
  // 先把 16 位以上数字加引号转字符串,防止 JSON.parse 丢精度导致查单 404
  const bigintSafe = text.replace(/(:\s*)(-?\d{16,})(\s*[,}\]])/g, '$1"$2"$3');
  const data = JSON.parse(bigintSafe);
  if (data.code !== 0 && data.code !== undefined) throw new Error(`业务错误:${data.msg}`);
  return data.data ?? data;
}

/** 拉一批 query 的并集饮品池;任一 query 成功即算成功 */
export async function fetchMenu(queries: string[] = ['拿铁', '美式', '茶']): Promise<{ drinks: McpDrink[]; source: 'real-mcp' | 'local-fallback'; note?: string }> {
  const seen = new Map<string, McpDrink>();
  let errs: string[] = [];
  for (let i = 0; i < queries.length; i++) {
    try {
      const list = (await callTool('searchProductForMcp', { deptId: DEPT_ID, query: queries[i] }, 100 + i)) as any[];
      for (const p of list ?? []) {
        const title = String(p.productName ?? '').trim();
        if (!title || seen.has(title)) continue;
        const { price, list_price } = normalizePrice(p);
        seen.set(title, { product_id: Number(p.productId), sku_code: String(p.skuCode ?? ''), title, price, list_price, ...classify(title) });
      }
    } catch (e) {
      errs.push(`${queries[i]}:${String(e).slice(0, 60)}`);
    }
  }
  if (seen.size === 0) {
    return {
      drinks: [],
      source: 'local-fallback',
      note: `真实 MCP 菜单拉取失败(${errs.join(';')});已降级为本地目录数据`,
    };
  }
  return { drinks: [...seen.values()], source: 'real-mcp', note: `瑞幸 MCP searchProductForMcp(门店 ${DEPT_ID})×${queries.length} 次,命中 ${seen.size} 款` };
}

export const FALLBACK_DRINKS: McpDrink[] = [
  { product_id: 1, sku_code: 'LOCAL-1', title: '生椰拿铁', price: 18, list_price: 18, coffee: true, hot_capable: true },
  { product_id: 2, sku_code: 'LOCAL-2', title: '燕麦拿铁', price: 19, list_price: 19, coffee: true, hot_capable: true },
  { product_id: 3, sku_code: 'LOCAL-3', title: '橙C美式', price: 15, list_price: 15, coffee: true, hot_capable: true },
  { product_id: 4, sku_code: 'LOCAL-4', title: '柠檬冰萃茶', price: 12, list_price: 12, coffee: false, hot_capable: false },
  { product_id: 5, sku_code: 'LOCAL-5', title: '标准美式', price: 13, list_price: 13, coffee: true, hot_capable: true },
];

// ------------------------------------------------------- 真实交易工具(下单/查状态/撤单)

const STORE_LNG = 120.085995;
const STORE_LAT = 30.307972;

/** 创建真实待支付订单(微信扫码支付;未支付可撤单,自动过期,不产生费用) */
export async function createRealOrder(lines: Array<{ product_id: number; sku_code: string; qty: number }>, remark: string): Promise<{
  mcp_order_id: string;
  amount: number;
  need_pay: boolean;
  pay_qr_url: string;
  pay_url: string;
}> {
  const data = await callTool('createOrder', {
    deptId: DEPT_ID,
    productList: lines.map((l) => ({ amount: l.qty, productId: l.product_id, skuCode: l.sku_code })),
    longitude: STORE_LNG,
    latitude: STORE_LAT,
    couponCodeList: [],
    remark,
  }, 200);
  return {
    mcp_order_id: String(data.orderId),
    amount: Number(data.discountPrice ?? 0),
    need_pay: data.needPay === true,
    pay_qr_url: String(data.payOrderQrCodeUrl ?? ''),
    pay_url: String(data.payOrderUrl ?? ''),
  };
}

export type RealOrderStatus = { status_code: number; status_name: string; paid: boolean; cancelled: boolean };

/** 查询真实订单状态:10=待付款,100=已取消;进入其他状态即视为已支付 */
export async function queryRealOrderStatus(mcpOrderId: string): Promise<RealOrderStatus> {
  const data = await callTool('queryOrderDetailInfo', { orderId: mcpOrderId }, 201);
  const code = Number(data.orderStatus ?? 0);
  const name = String(data.orderStatusName ?? '');
  return { status_code: code, status_name: name, paid: code > 10 && code !== 100, cancelled: code === 100 };
}

/** 撤销未支付的真实订单 */
export async function cancelRealOrder(mcpOrderId: string): Promise<boolean> {
  const data = await callTool('cancelOrder', { orderId: mcpOrderId }, 202);
  return data === true;
}
