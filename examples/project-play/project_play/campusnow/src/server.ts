/**
 * CampusNow 主服务(单进程,Bun.serve):
 *  - 两个 OCP Catalog Node(六协议端点 ×2 + 门店下单/开票端点)
 *  - 测试开票服务 + 测试邮箱(invoice.ts)
 *  - Agent API(状态机驱动)+ 静态 Web UI
 * 端口 4420。
 */
import { CATALOGS, wellKnown, manifest, health, contracts, query, resolve } from './catalogs';
import * as inv from './invoice';
import * as agent from './agent';
import { fetchMenu, createRealOrder, queryRealOrderStatus, cancelRealOrder as mcpCancelOrder } from './luckin_mcp';

const PORT = Number(process.env.PORT ?? 4420);
const BASE = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
// 发票归档根目录:默认放在用户的「发票管理」文件夹(e2e 用环境变量指到测试目录,避免污染)
const ARCHIVE_ROOT = process.env.CAMPUSNOW_ARCHIVE_ROOT ?? '/Users/laylin/日常/project_play/发票管理';

const orders = new Map<string, { order: agent.Order; paid: boolean }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const p = await req.json();
    return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------- Agent hooks(真实 HTTP OCP 调用)

agent.setHooks({
  ocpQuery: async (mount, body) => {
    const res = await fetch(`${BASE}${mount}/ocp/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  },
  resolveCheckout: async (mount, entryId) => {
    const res = await fetch(`${BASE}${mount}/ocp/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry_id: entryId, purpose: 'checkout' }) });
    return res.json();
  },
  resolveWorkflow: async (order) => {
    const cat = CATALOGS.find((c) => c.catalog_id === order.catalog_id)!;
    const first = order.lines[0];
    const entryId = `entry_${cat.provider_id}_${first.object_id}`;
    const res = await fetch(`${BASE}${cat.mount}/ocp/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry_id: entryId, purpose: 'workflow' }) });
    const data = await res.json();
    const denied = data.access?.permission_state === 'denied' || !data.action_bindings?.length;
    return { denied, url: data.action_bindings?.[0]?.entrypoint?.url, note: data.access?.policy_notes?.[0] };
  },
  luckinMenu: () => fetchMenu(),
  realOrderEnabled: () => process.env.CAMPUSNOW_REAL_ORDER === '1',
  createGroupOrder: async (lines, catalog, opts) => {
    // 真实模式:经瑞幸 MCP createOrder 创建真实待支付订单(微信扫码;未支付可撤)
    if (opts.real && lines.every((l) => l.product_id && l.sku_code && !String(l.sku_code).startsWith('LOCAL-'))) {
      const r = await createRealOrder(
        lines.map((l) => ({ product_id: l.product_id!, sku_code: l.sku_code!, qty: l.qty ?? 1 })),
        opts.remark,
      );
      const order: agent.Order = {
        order_id: `REAL-${r.mcp_order_id}`,
        catalog_id: catalog.catalog_id,
        catalog_name: catalog.catalog_name,
        mount: catalog.mount,
        lines,
        total: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
        paid: false,
        real: true,
        mcp_order_id: r.mcp_order_id,
        pay_qr_url: r.pay_qr_url,
        pay_url: r.pay_url,
        pay_status_name: '待付款',
      };
      orders.set(order.order_id, { order, paid: false });
      return { order_id: order.order_id, real: true, mcp_order_id: r.mcp_order_id, pay_qr_url: r.pay_qr_url, pay_url: r.pay_url };
    }
    const order: agent.Order = {
      order_id: `CN${Date.now().toString().slice(-8)}`,
      catalog_id: catalog.catalog_id,
      catalog_name: catalog.catalog_name,
      mount: catalog.mount,
      lines,
      total: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
      paid: false,
    };
    orders.set(order.order_id, { order, paid: false });
    return { order_id: order.order_id };
  },
  checkPayment: (mcpOrderId) => queryRealOrderStatus(mcpOrderId),
  cancelRealOrder: (mcpOrderId) => mcpCancelOrder(mcpOrderId),
  createOrder: async (mount, lines) => {
    const res = await fetch(`${BASE}${mount}/shop/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, confirmation: true }) });
    return res.json();
  },
  payOrder: (orderId) => inv.markOrderPaid(orderId),
  submitInvoiceLocal: async (order, need) => {
    const r = inv.submitInvoiceLocal({
      catalog_id: order.catalog_id,
      catalog_name: order.catalog_name,
      order_id: order.order_id,
      object_title: order.lines.map((l) => l.title).join('+'),
      amount: order.total,
      title_type: need.invoice_title_type,
      title: need.invoice_title,
      tax_id: need.invoice_tax_id,
      email: need.email,
      purpose: need.purpose,
    });
    return { invoice_id: r.invoice_id };
  },
  submitInvoice: async (order, need) => {
    const res = await fetch(`${BASE}${order.mount}/shop/invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: order.order_id, title_type: need.invoice_title_type, title: need.invoice_title, tax_id: need.invoice_tax_id, email: need.email, purpose: need.purpose }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    return data;
  },
  getInvoice: (id) => inv.getInvoice(id),
  fetchInvoiceFile: async (id) => {
    const res = await fetch(`${BASE}/api/invoice/${id}/file`);
    return res.text();
  },
  archiveFiles: async (order, invoiceHtml, invoiceId, need) => {
    const date = new Date().toISOString().slice(0, 10);
    const safeName = order.catalog_name.replace(/[^\w一-龥-]+/g, '_');
    const dir = `${ARCHIVE_ROOT}/${date}/${safeName}/${order.order_id}`;
    const files: string[] = [`${dir}/invoice-${invoiceId}.html`, `${dir}/order-summary.json`];
    const group = (need.people_total ?? 0) >= 2;
    const invoiceStatus = invoiceId.startsWith('SIMINV') ? '本地模拟收据(回退)' : '电子发票(测试)';

    const summary = {
      order_id: order.order_id,
      catalog: order.catalog_name,
      lines: order.lines,
      total: order.total,
      purpose: need.purpose ?? null,
      people_total: need.people_total ?? null,
      invoice: { id: invoiceId, title: need.invoice_title, email: need.email, status: invoiceStatus },
      archived_at: new Date().toISOString(),
      note: 'CampusNow 演示数据;发票文件为测试文件,非正式税务凭证。',
    };
    await Bun.write(`${dir}/invoice-${invoiceId}.html`, invoiceHtml);
    await Bun.write(`${dir}/order-summary.json`, JSON.stringify(summary, null, 2));

    // 团购:订单明细 CSV(带 BOM,Excel 双击即开)+ 报销 TODO 清单
    if (group) {
      const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [['序号', '商品', '数量', '单价(¥)', '小计(¥)', '备注', '用途', '订单号', '商家', '支付', '发票编号', '发票类型'].map(q).join(',')];
      order.lines.forEach((l, i) => {
        const qty = l.qty ?? 1;
        const unit = Number((l.amount / qty).toFixed(2));
        rows.push([i + 1, l.title.replace(/\s*×\d+$/, ''), qty, unit, l.amount, '按方案', need.purpose ?? '', order.order_id, order.catalog_name, '模拟支付', invoiceId, invoiceStatus].map(q).join(','));
      });
      rows.push(['', '合计', order.lines.reduce((s, l) => s + (l.qty ?? 1), 0), '', order.total, '', need.purpose ?? '', order.order_id, order.catalog_name, '模拟支付', invoiceId, invoiceStatus].map(q).join(','));
      await Bun.write(`${dir}/order.csv`, '\uFEFF' + rows.join('\r\n') + '\r\n');

      const todo = `# 报销 TODO · ${order.order_id}

> 用途:**${need.purpose ?? '报销用'}** · ${need.people_total} 人团餐 · 商家:${order.catalog_name} · 合计 ¥${order.total.toFixed(2)}
> 发票:**${invoiceStatus}**(编号 ${invoiceId})· 抬头:${need.invoice_title}${need.invoice_tax_id ? ` · 税号:${need.invoice_tax_id}` : ''}

## 待办清单

- [ ] 核对发票/收据信息(抬头、税号、金额、用途)
- [ ] 打开并检查 \`invoice-${invoiceId}.html\`(本地模拟收据,非正式税务凭证,正式报销需商家补开)
- [ ] 将 \`order.csv\`(Excel 可直接打开)作为消费明细附上
- [ ] 按课题组/学校财务要求提交报销申请
- [ ] 确认收款人及账户信息无误
- [ ] 纸质凭证(如有)拍照存档,与本文件夹一并归档

## 文件清单

- \`invoice-${invoiceId}.html\` — 发票/模拟收据
- \`order.csv\` — 消费明细统计(含用途)
- \`order-summary.json\` — 机器可读订单摘要

---
*CampusNow 生成于 ${new Date().toISOString()} · 测试环境数据,订单与支付均为模拟*
`;
      await Bun.write(`${dir}/报销TODO.md`, todo);
      files.push(`${dir}/order.csv`, `${dir}/报销TODO.md`);
    }
    return { dir, files };
  },
});

// ------------------------------------------------------- 路由

async function handle(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const { method } = req;

  // ---- OCP Catalog Nodes ----
  for (const cat of CATALOGS) {
    if (!pathname.startsWith(cat.mount)) continue;
    const p = pathname.slice(cat.mount.length);
    if (method === 'GET' && p === '/.well-known/ocp-catalog') return json(wellKnown(cat, BASE));
    if (method === 'GET' && p === '/ocp/manifest') return json(manifest(cat, BASE));
    if (method === 'GET' && p === '/ocp/health') return json(health(cat));
    if (method === 'GET' && p === '/ocp/contracts') return json(contracts(cat));
    if (method === 'POST' && p === '/ocp/query') {
      const r = query(cat, await readJson(req));
      return json(r.body, r.status);
    }
    if (method === 'POST' && p === '/ocp/resolve') {
      const r = resolve(cat, BASE, await readJson(req));
      return json(r.body, r.status);
    }
    // 门店自有端点(非协议)
    if (method === 'POST' && p === '/shop/order') {
      const body = await readJson(req);
      if (body.confirmation !== true) return json({ error: { code: 'invalid_request', message: 'requires_user_confirmation:用户未确认' } }, 400);
      const lines = (body.lines as Array<{ object_id: string; title: string; amount: number }>) ?? [];
      if (!lines.length) return json({ error: { code: 'invalid_request', message: 'lines 为空' } }, 400);
      const outOfStock = lines.filter((l) => cat.items.find((i) => i.id === l.object_id)?.availability === 'out_of_stock');
      if (outOfStock.length) return json({ error: { code: 'conflict', message: `缺货:${outOfStock.map((l) => l.title).join('、')}` } }, 409);
      const order: agent.Order = {
        order_id: `CN${Date.now().toString().slice(-8)}`,
        catalog_id: cat.catalog_id,
        catalog_name: cat.catalog_name,
        mount: cat.mount,
        lines,
        total: Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2)),
        paid: false,
      };
      orders.set(order.order_id, { order, paid: false });
      return json({ order_id: order.order_id, total: order.total, status: 'awaiting_payment', payment: 'mock(演示)' }, 201);
    }
    if (method === 'POST' && p === '/shop/invoice') {
      const b = await readJson(req);
      const order = orders.get(String(b.order_id));
      if (!order) return json({ error: { code: 'not_found', message: `未知订单 ${String(b.order_id)}` } }, 404);
      const r = inv.submitInvoice({
        catalog_id: cat.catalog_id,
        catalog_name: cat.catalog_name,
        order_id: String(b.order_id),
        object_title: order.order.lines.map((l) => l.title).join('+'),
        amount: order.order.total,
        title_type: (b.title_type as 'personal' | 'organization') ?? 'personal',
        title: String(b.title ?? ''),
        tax_id: b.tax_id ? String(b.tax_id) : undefined,
        email: String(b.email ?? ''),
        purpose: b.purpose ? String(b.purpose) : undefined,
      });
      if (!r.ok) return json({ error: { code: 'conflict', message: r.error } }, r.status);
      return json({ invoice_id: r.invoice.invoice_id, status: r.invoice.status }, 201);
    }
  }

  // ---- Agent API ----
  if (method === 'POST' && pathname === '/api/need') {
    const b = await readJson(req);
    return json(await agent.startTask(String(b.raw ?? '')));
  }
  if (method === 'POST' && pathname === '/api/confirm-plan') {
    try {
      return json(await agent.confirmPlan());
    } catch (e) {
      return json(agent.failTask(String((e as Error).message ?? e).slice(0, 200)));
    }
  }
  if (method === 'POST' && pathname === '/api/choose-plan') {
    const b = await readJson(req);
    return json(await agent.choosePlan(String(b.option_id ?? b.plan_id ?? 'A')));
  }
  if (method === 'POST' && pathname === '/api/pay') return json(agent.payOrder());
  if (method === 'POST' && pathname === '/api/check-payment') return json(await agent.checkPayment());
  if (method === 'POST' && pathname === '/api/cancel-order') return json(await agent.cancelRealOrder());
  if (method === 'POST' && pathname === '/api/confirm-invoice') return json(await agent.confirmInvoice());
  if (method === 'POST' && pathname === '/api/reset') {
    agent.reset();
    return json(agent.getState());
  }
  if (method === 'GET' && pathname === '/api/state') return json(agent.getState());

  // ---- 开票服务 / 邮箱 ----
  if (method === 'GET' && pathname === '/api/invoices') return json(inv.listInvoices());
  if (method === 'GET' && pathname === '/api/mailbox') return json(inv.listMail());
  if (method === 'GET' && pathname.startsWith('/api/invoice/') && pathname.endsWith('/file')) {
    const id = pathname.split('/')[3];
    const i = inv.getInvoice(id);
    if (!i) return json({ error: { code: 'not_found', message: 'unknown invoice' } }, 404);
    return new Response(inv.invoiceFile(i), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // 静态 UI(所有 API/协议路由之后):public/ 下任意文件,未知 GET 回退 index.html
  if (method === 'GET') {
    const PUBLIC = `${import.meta.dir}/../public`;
    const rel = pathname.replace(/^\/+/, '');
    const target = rel && !rel.includes('..') ? `${PUBLIC}/${rel}` : `${PUBLIC}/index.html`;
    const file = Bun.file(target);
    if (await file.exists()) {
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
      };
      const ext = target.slice(target.lastIndexOf('.'));
      return new Response(file, { headers: { 'content-type': types[ext] ?? 'application/octet-stream' } });
    }
    return new Response(Bun.file(`${PUBLIC}/index.html`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  return json({ error: { code: 'not_found', message: `No route for ${method} ${pathname}` } }, 404);
}

Bun.serve({ port: PORT, fetch: handle });
console.log(`🎓 CampusNow 已启动:${BASE}`);
console.log(`   Web UI:${BASE}/`);
console.log(`   目录:elec → ${BASE}/elec/ocp/manifest | luckin → ${BASE}/luckin/ocp/manifest`);
