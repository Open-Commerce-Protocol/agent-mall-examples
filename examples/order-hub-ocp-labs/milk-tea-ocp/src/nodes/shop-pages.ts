/**
 * 商户侧的人工可见页面：首页 / 菜单 / 门店 / 下单页。
 *
 * 这些页面刻意不属于 OCP 协议面——它们代表"商户自己的网站"。OCP 的 role 是
 * 在 resolve 时给出指向这里的 action binding，仅此而已。
 *
 * 下单入口 `/order` 用同一路径提供两种表示：
 *   - 浏览器表单提交（application/x-www-form-urlencoded）→ 返回 HTML 小票
 *   - JSON 提交（application/json）→ 返回 JSON 订单
 * 对应 resolve 里 `checkout_page`(url) 与 `checkout_api`(api) 两个绑定。
 */
import { html, json, fail, type Ctx, type OcpReply, type Route } from '../lib/http.ts';
import { entryIdFor } from '../lib/ids.ts';
import { createOrder, validateAndPrice, STORE_NOTE, type Order } from '../lib/orders.ts';
import type { MilkTea, Shop } from '../shops/types.ts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 15px/1.65 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #fbf7f2; color: #2a2320; }
  .wrap { max-width: 880px; margin: 0 auto; }
  header { border-bottom: 2px solid #e3d5c6; padding-bottom: 14px; margin-bottom: 22px; }
  h1 { margin: 0 0 6px; font-size: 26px; }
  .muted { color: #8a7a6d; font-size: 13px; }
  .nav a { margin-right: 14px; color: #b5651d; text-decoration: none; font-weight: 600; }
  .nav a:hover { text-decoration: underline; }
  .card { background: #fff; border: 1px solid #e8ded3; border-radius: 10px; padding: 16px 18px; margin-bottom: 12px; }
  .row { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
  .price { font-weight: 700; color: #b5651d; white-space: nowrap; }
  .strike { color: #a99; text-decoration: line-through; font-weight: 400; font-size: 13px; margin-right: 6px; }
  .tags span { display: inline-block; background: #f3ece4; border-radius: 999px; padding: 1px 9px;
               font-size: 12px; color: #7a6a5d; margin: 6px 6px 0 0; }
  .badge { font-size: 12px; border-radius: 5px; padding: 1px 7px; margin-left: 8px; }
  .in_stock { background: #e3f4e6; color: #256b35; }
  .low_stock { background: #fdf0d8; color: #8a5b12; }
  .out_of_stock { background: #f6e0e0; color: #8f2f2f; }
  .order { display: inline-block; margin-top: 10px; background: #b5651d; color: #fff; padding: 6px 14px;
           border-radius: 6px; text-decoration: none; font-size: 14px; }
  .order.disabled { background: #ccc; pointer-events: none; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; font-size: 14px; }
  select, input[type=number] { padding: 7px 10px; border: 1px solid #d8cabb; border-radius: 6px;
                               font-size: 14px; background: #fff; color: inherit; min-width: 180px; }
  .checks { display: flex; flex-wrap: wrap; gap: 12px; }
  .checks label { font-weight: 400; margin: 0; display: flex; align-items: center; gap: 5px; }
  button { margin-top: 22px; background: #b5651d; color: #fff; border: 0; padding: 11px 26px;
           border-radius: 7px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .note { background: #fff8e8; border-left: 4px solid #e0a33e; padding: 10px 14px; margin: 18px 0;
          border-radius: 0 6px 6px 0; font-size: 13.5px; }
  .errors { background: #fdeaea; border-left: 4px solid #c0392b; padding: 10px 14px; margin: 16px 0;
            border-radius: 0 6px 6px 0; }
  .errors li { margin: 3px 0; }
  code { background: #f3ece4; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
  .receipt { font-family: ui-monospace, Consolas, monospace; }
`;

function page(shop: Shop, title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(shop.catalog_name)}</title><style>${STYLE}</style></head>
<body><div class="wrap">
<header>
  <h1>${esc(shop.catalog_name)}</h1>
  <div class="muted">${esc(shop.store.address)} · ${esc(shop.store.open_hours)} · ${esc(shop.store.phone)}</div>
  <nav class="nav" style="margin-top:10px">
    <a href="/">首页</a><a href="/menu">菜单</a><a href="/store">门店</a>
    <a href="/ocp/manifest">manifest</a><a href="/ocp/health">health</a>
  </nav>
  <div class="muted" style="margin-top:8px">catalog_id: <code>${esc(shop.catalog_id)}</code></div>
</header>
${body}
</div></body></html>`;
}

const availabilityBadge = (item: MilkTea): string => {
  const labels: Record<string, string> = {
    in_stock: '有货',
    low_stock: '仅剩少量',
    out_of_stock: '已售罄',
    preorder: '可预订',
    unknown: '库存未知',
  };
  return `<span class="badge ${item.availability}">${labels[item.availability] ?? item.availability}</span>`;
};

function priceHtml(item: MilkTea): string {
  const list = item.list_amount > item.amount ? `<span class="strike">¥${item.list_amount}</span>` : '';
  return `${list}¥${item.amount}`;
}

function menuCard(shop: Shop, item: MilkTea): string {
  const sellable = item.availability !== 'out_of_stock';
  const link = `/order?entry_id=${encodeURIComponent(entryIdFor(shop.provider_id, item.sku))}`;
  return `<div class="card">
  <div class="row">
    <div>
      <strong>${esc(item.title)}</strong>${availabilityBadge(item)}
      <div class="muted">${esc(item.summary)}</div>
      <div class="tags">${item.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="muted" style="margin-top:6px">茶底 ${esc(item.base)} · ${esc(item.category)}
        ${item.toppings.length > 0 ? ` · 加料 ${esc(item.toppings.join('、'))}` : ''}</div>
    </div>
    <div class="price">${priceHtml(item)}</div>
  </div>
  <a class="order${sellable ? '' : ' disabled'}" href="${sellable ? link : '#'}">
    ${sellable ? '去下单' : '已售罄，无法下单'}</a>
  <div class="muted" style="margin-top:6px"><code>${esc(item.sku)}</code> ·
    ${esc(entryIdFor(shop.provider_id, item.sku))}</div>
</div>`;
}

function findItem(shop: Shop, entryId: string | null, sku: string | null): MilkTea | undefined {
  if (entryId) return shop.menu.find((m) => entryIdFor(shop.provider_id, m.sku) === entryId);
  if (sku) return shop.menu.find((m) => m.sku === sku);
  return undefined;
}

function orderForm(shop: Shop, item: MilkTea, errors: string[] = []): string {
  const options = (name: string, values: string[]): string =>
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const errorBlock =
    errors.length > 0
      ? `<div class="errors"><strong>下单失败：</strong><ul>${errors
          .map((e) => `<li>${esc(e)}</li>`)
          .join('')}</ul></div>`
      : '';
  const toppingChecks =
    item.toppings.length > 0
      ? `<label>加料</label><div class="checks">${item.toppings
          .map(
            (t) =>
              `<label><input type="checkbox" name="toppings" value="${esc(t)}"> ${esc(t)}</label>`,
          )
          .join('')}</div>`
      : '<div class="muted">本款无可选加料</div>';

  return page(
    shop,
    `下单 · ${item.title}`,
    `<div class="card">
  <div class="row">
    <div><strong style="font-size:18px">${esc(item.title)}</strong>${availabilityBadge(item)}
      <div class="muted">${esc(item.summary)}</div></div>
    <div class="price">${priceHtml(item)}</div>
  </div>
  <div class="note">${esc(STORE_NOTE)}</div>
  ${errorBlock}
  <form method="POST" action="/order">
    <input type="hidden" name="sku" value="${esc(item.sku)}">
    <label>规格</label>
    <select name="size">${item.sizes
      .map(
        (s) =>
          `<option value="${esc(s.id)}">${esc(s.label)}${s.price_delta > 0 ? ` (+¥${s.price_delta})` : ''}</option>`,
      )
      .join('')}</select>
    <label>糖度</label><select name="sugar">${options('sugar', item.sugar_levels)}</select>
    <label>温度</label><select name="temperature">${options('temperature', item.temperatures)}</select>
    ${toppingChecks}
    <label>数量</label><input type="number" name="quantity" value="1" min="1" max="10">
    <div><button type="submit">提交订单（模拟）</button></div>
  </form>
</div>
<div class="muted">此表单提交到本店 <code>POST /order</code>；同一个 URL 用 JSON 提交会返回 JSON 订单，
与 resolve 里 <code>checkout_api</code> 绑定一致。</div>`,
  );
}

function receiptPage(shop: Shop, order: Order): string {
  const line = order.lines[0] as Order['lines'][number];
  return page(
    shop,
    `订单 ${order.order_id}`,
    `<div class="card">
  <h2 style="margin-top:0">已下单（模拟）</h2>
  <div class="receipt">
    <div>订单号：<strong>${esc(order.order_id)}</strong></div>
    <div>门店：${esc(order.store)} · ${esc(order.store_address)}</div>
    <div>时间：${esc(order.created_at)}</div>
    <hr style="border:0;border-top:1px dashed #ddd;margin:12px 0">
    <div>${esc(line.title)} × ${line.quantity}（${esc(line.size_label)} / ${esc(line.sugar)} / ${esc(line.temperature)}${
      line.toppings.length > 0 ? ` / 加料 ${esc(line.toppings.join('、'))}` : ''
    }）</div>
    <div>单价 ¥${line.unit_amount} → 合计 <strong>¥${order.total.amount}</strong></div>
    <hr style="border:0;border-top:1px dashed #ddd;margin:12px 0">
    <div>payment: ${esc(order.payment)}</div>
  </div>
  <div class="note">${esc(order.note)}</div>
  <div class="nav"><a href="/menu">返回菜单</a><a href="/">返回首页</a></div>
</div>`,
  );
}

function orderJson(shop: Shop, order: Order): OcpReply {
  return json(order, 201);
}

/** 组装本商户的全部 HTML/表单路由。 */
export function shopPageRoutes(shop: Shop): Route[] {
  return [
    {
      method: 'GET',
      path: '/',
      handler: () => {
        const inStock = shop.menu.filter((m) => m.availability !== 'out_of_stock').length;
        return html(
          page(
            shop,
            '首页',
            `<div class="card">
  <p>这是 <strong>${esc(shop.catalog_name)}</strong> 自己的网站，不属于 OCP 协议面。</p>
  <p>本店的 OCP Catalog 节点暴露：<code>/.well-known/ocp-catalog</code>、
     <code>/ocp/manifest</code>、<code>/ocp/health</code>、<code>/ocp/query</code>、
     <code>/ocp/resolve</code>、<code>/ocp/contracts</code>。</p>
  <p>当前 ${shop.menu.length} 款饮品，其中 ${inStock} 款可下单。</p>
  <div class="nav"><a href="/menu">看菜单</a><a href="/ocp/manifest">读 manifest</a></div>
</div>`,
          ),
        );
      },
    },
    {
      method: 'GET',
      path: '/menu',
      handler: () =>
        html(
          page(
            shop,
            '菜单',
            shop.menu.map((item) => menuCard(shop, item)).join('') +
              `<div class="muted">共 ${shop.menu.length} 款。每张卡片下方是它的
               <code>entry_id</code>，resolve 时用的就是它。</div>`,
          ),
        ),
    },
    {
      method: 'GET',
      path: '/store',
      handler: () =>
        html(
          page(
            shop,
            '门店',
            `<div class="card">
  <div class="row"><div><strong>${esc(shop.catalog_name)}</strong>
    <div class="muted">${esc(shop.description)}</div></div></div>
  <label>地址</label><div>${esc(shop.store.address)}</div>
  <label>营业时间</label><div>${esc(shop.store.open_hours)}</div>
  <label>电话</label><div>${esc(shop.store.phone)}</div>
  <label>城市</label><div>${esc(shop.store.city)}</div>
  <label>provider_id</label><div><code>${esc(shop.provider_id)}</code></div>
</div>`,
          ),
        ),
    },
    {
      method: 'GET',
      path: '/order',
      handler: (ctx: Ctx) => {
        const item = findItem(shop, ctx.url.searchParams.get('entry_id'), ctx.url.searchParams.get('sku'));
        if (!item) {
          return html(
            page(
              shop,
              '下单',
              `<div class="card"><p>缺少或无法识别 <code>entry_id</code>。</p>
               <p>下单入口应当由 OCP 的 <code>POST /ocp/resolve</code>（<code>purpose: "checkout"</code>）
               返回的 action binding 给出，而不是手工拼 URL。</p>
               <div class="nav"><a href="/menu">从菜单选一杯</a></div></div>`,
            ),
            400,
          );
        }
        return html(orderForm(shop, item));
      },
    },
    {
      method: 'POST',
      path: '/order',
      handler: (ctx: Ctx): OcpReply => {
        const isJson = String(ctx.raw.headers['content-type'] ?? '').includes('application/json');
        const source = isJson
          ? ctx.body
          : {
              sku: ctx.form.get('sku') ?? undefined,
              size: ctx.form.get('size') ?? undefined,
              sugar: ctx.form.get('sugar') ?? undefined,
              temperature: ctx.form.get('temperature') ?? undefined,
              toppings: ctx.form.getAll('toppings'),
              quantity: ctx.form.get('quantity') ?? undefined,
            };

        const item = findItem(shop, null, typeof source.sku === 'string' ? source.sku : null);
        if (!item) {
          return isJson
            ? fail('unknown_sku', `本店没有 sku "${String(source.sku)}"`, 404)
            : html(
                page(shop, '下单失败', `<div class="errors">本店没有 sku "${esc(String(source.sku))}"。</div>`),
                404,
              );
        }

        const result = validateAndPrice(shop, item, source);
        if (!result.ok) {
          return isJson
            ? fail('invalid_order', result.errors.join('; '), 400)
            : html(orderForm(shop, item, result.errors), 400);
        }

        const order = createOrder(shop, result.line);
        return isJson ? orderJson(shop, order) : html(receiptPage(shop, order));
      },
    },
  ];
}
