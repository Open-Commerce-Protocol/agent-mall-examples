/**
 * 测试开票服务 + 测试邮箱(商家侧 mock)。
 *
 * 状态机:submitted(已提交)→ processing(处理中)→ issued(已开票)→ emailed(邮件已发送)
 * 所有发票文件显著标注「测试发票,非正式税务凭证」。
 */
export type InvoiceStatus = 'submitted' | 'processing' | 'issued' | 'emailed' | 'failed';

export type InvoiceRequest = {
  invoice_id: string;
  catalog_id: string;
  catalog_name: string;
  order_id: string;
  object_title: string;
  amount: number;
  title_type: 'personal' | 'organization';
  title: string;
  tax_id?: string;
  email: string;
  purpose?: string;
  status: InvoiceStatus;
  submitted_at: string;
  /** true = 商家未提供开票接口,由 CampusNow 本地模拟生成(非商家开具) */
  local?: boolean;
  history: Array<{ at: string; from: InvoiceStatus | null; to: InvoiceStatus; note: string }>;
};

export type MailMessage = {
  mail_id: string;
  from: string;
  to: string;
  subject: string;
  received_at: string;
  attachment: { filename: string; url: string } | null;
};

const invoices = new Map<string, InvoiceRequest>();
const mailbox: MailMessage[] = [];

/** 已支付订单才有开票资格(商家侧校验)——对应 PRD「区分声明支持与确认可开」 */
const paidOrders = new Set<string>();

export function markOrderPaid(orderId: string) {
  paidOrders.add(orderId);
}
export function isOrderPaid(orderId: string) {
  return paidOrders.has(orderId);
}
export function hasInvoiceForOrder(orderId: string) {
  return [...invoices.values()].some((i) => i.order_id === orderId);
}

export function submitInvoice(args: {
  catalog_id: string;
  catalog_name: string;
  order_id: string;
  object_title: string;
  amount: number;
  title_type: 'personal' | 'organization';
  title: string;
  tax_id?: string;
  email: string;
  purpose?: string;
}): { ok: true; invoice: InvoiceRequest } | { ok: false; status: number; error: string } {
  if (!paidOrders.has(args.order_id)) {
    return { ok: false, status: 409, error: `订单 ${args.order_id} 未支付,不具备开票资格` };
  }
  if (hasInvoiceForOrder(args.order_id)) {
    return { ok: false, status: 409, error: `订单 ${args.order_id} 已存在开票申请,防止重复提交` };
  }
  if (args.title_type === 'organization' && !args.tax_id) {
    return { ok: false, status: 400, error: '单位抬头必须提供纳税人识别号' };
  }
  const now = new Date().toISOString();
  const inv: InvoiceRequest = {
    invoice_id: `TESTINV-${Date.now().toString().slice(-8)}`,
    ...args,
    status: 'submitted',
    submitted_at: now,
    history: [{ at: now, from: null, to: 'submitted', note: '开票申请已接收(测试服务)' }],
  };
  invoices.set(inv.invoice_id, inv);
  schedule(inv.invoice_id);
  return { ok: true, invoice: inv };
}

function transition(id: string, to: InvoiceStatus, note: string) {
  const inv = invoices.get(id);
  if (!inv || inv.status === 'failed') return;
  const from = inv.status;
  inv.status = to;
  inv.history.push({ at: new Date().toISOString(), from, to, note });
}

/** 状态推进:2s 处理中 → 4s 已开票 → 6s 邮件已送达 */
function schedule(id: string) {
  setTimeout(() => transition(id, 'processing', '商家开票引擎处理中(测试)'), 2000);
  setTimeout(() => transition(id, 'issued', '测试电子发票已生成,非正式税务凭证'), 4000);
  setTimeout(() => {
    transition(id, 'emailed', `测试发票已发送至 ${invoices.get(id)?.email}`);
    const inv = invoices.get(id);
    if (inv) {
      mailbox.unshift({
        mail_id: `mail-${Date.now().toString().slice(-6)}`,
        from: 'invoice@campus-elec.test',
        to: inv.email,
        subject: `【测试】电子发票 — ${inv.object_title}(订单 ${inv.order_id})`,
        received_at: new Date().toISOString(),
        attachment: { filename: `invoice-${inv.invoice_id}.html`, url: `/api/invoice/${inv.invoice_id}/file` },
      });
    }
  }, 6000);
}

/**
 * 本地模拟开票:商家未提供开票接口时的回退。
 * 不走商家状态机、不发邮件;直接本地生成显著标注的模拟收据。
 */
export function submitInvoiceLocal(args: {
  catalog_id: string;
  catalog_name: string;
  order_id: string;
  object_title: string;
  amount: number;
  title_type: 'personal' | 'organization';
  title: string;
  tax_id?: string;
  email: string;
  purpose?: string;
}): InvoiceRequest {
  const now = new Date().toISOString();
  const inv: InvoiceRequest = {
    invoice_id: `SIMINV-${Date.now().toString().slice(-8)}`,
    ...args,
    status: 'submitted',
    submitted_at: now,
    local: true,
    history: [
      { at: now, from: null, to: 'submitted', note: '商家未提供开票接口,启用 CampusNow 本地模拟开票回退' },
    ],
  };
  invoices.set(inv.invoice_id, inv);
  setTimeout(() => transition(inv.invoice_id, 'processing', '本地生成模拟收据中'), 1500);
  setTimeout(() => transition(inv.invoice_id, 'issued', '本地模拟收据已生成(非商家开具、非正式税务凭证)'), 3000);
  return inv;
}

export function getInvoice(id: string) {
  return invoices.get(id);
}
export function listInvoices() {
  return [...invoices.values()];
}
export function listMail() {
  return mailbox;
}

/** 生成显著标注为测试的发票 HTML 文件 */
export function invoiceFile(inv: InvoiceRequest): string {
  const rows = [['项目', inv.object_title], ['金额', `¥${inv.amount.toFixed(2)}(模拟)`], ['订单号', inv.order_id], ['发票类型', inv.local ? '本地模拟收据(回退)' : '电子发票(测试)'], ['开票方式', inv.local ? 'CampusNow 本地模拟生成 —— 商家未提供开票接口' : '商家开票服务(测试)'], ['抬头', `${inv.title_type === 'organization' ? '单位' : '个人'} · ${inv.title}`], ...(inv.tax_id ? [['税号', inv.tax_id]] : []), ...(inv.purpose ? [['用途', inv.purpose]] : []), ['接收邮箱', inv.email], ['申请编号', inv.invoice_id]] as const;
  const banner = inv.local
    ? '本地模拟收据 · 商家未提供开票接口 · 非商家开具 · 非正式税务凭证'
    : '测试发票 · 非正式税务凭证 · 仅供演示';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${inv.local ? '本地模拟收据' : '测试发票'} ${inv.invoice_id}</title>
<style>body{font-family:system-ui;max-width:560px;margin:40px auto;padding:0 20px;color:#111}
.banner{background:#b91c1c;color:#fff;padding:14px 18px;border-radius:8px;font-weight:700;text-align:center;font-size:18px;letter-spacing:2px}
table{width:100%;border-collapse:collapse;margin-top:18px}td{border-bottom:1px solid #ddd;padding:10px 6px}
td:first-child{color:#666;width:110px}.meta{color:#999;font-size:12px;margin-top:24px}</style></head>
<body><div class="banner">${banner}</div>
<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
<p class="meta">CampusNow 黑客松演示生成 · ${new Date().toISOString()} · 本文件不具备任何税务效力</p></body></html>`;
}
