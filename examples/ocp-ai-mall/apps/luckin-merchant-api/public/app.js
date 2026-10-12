const $ = id => document.getElementById(id);
let mode, csrf, stores = [], products = [], basket = [], quote, attempts = [], busy = false;
const money = value => value == null ? '未知' : `¥${(value / 100).toFixed(2)}`;
const text = (id, value) => { $(id).textContent = value; };
const node = (tag, value) => { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; return el; };
const selected = () => products.find(value => value.product_id === $('product').value);
const prefix = () => `${mode === 'readonly' ? '/live' : ''}/stores/${encodeURIComponent($('store').value)}/ocp`;
function selectOptions(id, values) { $(id).replaceChildren(...values.map(value => { const option = node('option', value.label); option.value = value.id; option.disabled = Boolean(value.disabled); return option; })); }
async function api(path, body) {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-luckin-csrf': csrf }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(({ invalid_contract_or_budget: '报价不符合契约或超过预算，请调整后重试。', requote_required: '报价已失效，请重新获取报价。', unresolved_purchase: '有未决购买，请先核对原订单。', upstream_unavailable_or_invalid: '上游暂不可用或返回格式变化，请稍后重试。' })[result.error] ?? result.error);
  return result;
}
function invalidate() { quote = undefined; $('quote-panel').hidden = true; }
function controls() {
  document.querySelectorAll('button,input,select').forEach(el => { el.disabled = busy; });
  $('confirm').disabled = busy || !quote || Date.parse(quote.terms.expires_at) <= Date.now();
  $('quote').disabled = busy || !basket.length;
  $('add').disabled = busy || !selected() || selected().available === false;
  $('read-detail').disabled = busy || !selected();
  $('search').disabled = busy || !$('store').value;
}
async function run(action) {
  if (busy) return; busy = true; text('message', '正在处理…'); controls();
  try { await action(); text('message', ''); } catch (error) { text('message', error.message || '操作未完成，请重试。'); }
  finally { busy = false; controls(); }
}
function renderBasket() {
  $('basket').replaceChildren();
  if (!basket.length) $('basket').append(node('p', '购物篮还是空的。'));
  basket.forEach((line, index) => { const el = node('div'); el.className = 'line'; el.append(node('div', `${line.title} · ${line.labels.join(' / ')} × ${line.quantity}`));
    const remove = node('button', '移除'); remove.className = 'secondary'; remove.onclick = () => { basket.splice(index, 1); invalidate(); renderBasket(); controls(); }; el.append(remove); $('basket').append(el); });
}
function productChanged() {
  text('detail', ''); const product = selected();
  $('options').replaceChildren(); $('sku').replaceChildren();
  if (!product) { text('price', '没有匹配的商品。'); return; }
  text('price', mode === 'readonly' ? `原价 ${money(product.reference_minor)} · 预估 ${money(product.estimate_minor)}（非最终报价）` : `合成参考价 ${money(product.reference_minor)}，以含费报价为准。`);
  if (mode === 'fixture') {
    selectOptions('sku', product.skus.map(sku => ({ id: sku.sku_id, label: sku.label })));
    for (const option of product.options) { const label = node('label', option.label), select = node('select'); select.dataset.option = option.option_id;
      select.append(...option.values.map(value => { const el = node('option', value.label); el.value = value.value_id; return el; })); label.append(select); $('options').append(label); }
  }
}
async function search() {
  products = []; selectOptions('product', []); productChanged();
  const result = await api(`${prefix()}/query`, { query: $('query').value, limit: 20 });
  products = result.entries.map(({ entry }) => mode === 'readonly' ? entry.attributes['luckin.selection.v1'] : ({ ...entry.attributes['luckin.selection.v1'], title: entry.title,
    reference_minor: entry.attributes.price ? Math.round(entry.attributes.price.amount * 100) : null, available: entry.attributes.inventory.availability_status === 'in_stock' }));
  selectOptions('product', products.map(product => ({ id: product.product_id, label: `${product.title}${product.available === false ? '（售罄）' : ''}` })));
  productChanged();
}
async function storeChanged() {
  basket = []; invalidate(); renderBasket();
  text('address', stores.find(store => store.store_id === $('store').value)?.address ?? '');
  if ($('store').value) await search();
}
function setStores() { selectOptions('store', stores.map(store => ({ id: store.store_id, label: `${store.name}${store.status ? ` · ${store.status}` : ''}`, disabled: store.open === false }))); }
function renderQuote() {
  const terms = quote.terms; $('quote-lines').replaceChildren();
  terms.items.forEach(line => $('quote-lines').append(node('p', `${line.product_id} / ${line.sku_id} / ${Object.values(line.options).join(' / ')} × ${line.quantity}：${money(line.unit_minor * line.quantity)}`)));
  terms.adjustments.forEach(fee => $('quote-lines').append(node('p', `${fee.label}：${money(fee.amount_minor)}`)));
  text('total', `含费实付 ${money(terms.total_minor)}`); text('expiry', `有效至 ${new Date(terms.expires_at).toLocaleTimeString()} · 自取 · ${stores.find(store => store.store_id === terms.store_id)?.name ?? terms.store_id}`);
  $('quote-panel').hidden = false;
}
const paymentLabels = { pending: '待支付', paid: '已支付', failed: '支付失败', unknown: '支付状态未知' };
const fulfillmentLabels = { pending: '待付款', preparing: '制作中', ready: '可取餐', completed: '已取餐', cancelled: '已取消' };
function renderOrders() {
  $('orders').replaceChildren();
  for (const attempt of attempts) {
    const el = node('div'); el.className = 'line'; const order = attempt.order;
    el.append(node('p', order ? `${order.order_id} · ${paymentLabels[order.payment]} · ${fulfillmentLabels[order.fulfillment]} · ${money(order.total_minor)}` : `${attempt.attempt_id} · ${{ sending: '发送中', unknown: '结果未知，请核对原账户订单；不会自动重发', rejected: '已明确拒绝' }[attempt.state] ?? attempt.state}`));
    if (order?.pickup_code) el.append(node('strong', `取餐码：${order.pickup_code}（合成）`));
    const refresh = node('button', '核对上游状态'); refresh.className = 'secondary'; refresh.onclick = () => run(async () => { await api(`/luckin/v1/attempts/${attempt.attempt_id}/refresh`, {}); await loadOrders(); }); el.append(refresh);
    const action = order?.payment === 'pending' ? 'pay' : order?.fulfillment === 'preparing' ? 'ready' : order?.fulfillment === 'ready' ? 'collect' : undefined;
    if (action) { const button = node('button', { pay: '模拟支付，不会扣款', ready: '模拟制作完成', collect: '模拟取餐' }[action]); button.onclick = () => run(async () => { await api(`/luckin/v1/attempts/${attempt.attempt_id}/fixture-advance`, { action }); await loadOrders(); }); el.append(button); }
    $('orders').append(el);
  }
}
async function loadOrders() { attempts = await api('/luckin/v1/attempts'); renderOrders(); }
$('store').onchange = () => run(storeChanged);
$('search').onclick = () => run(search);
$('product').onchange = () => { productChanged(); controls(); };
$('budget').oninput = () => { invalidate(); controls(); };
$('add').onclick = () => {
  const product = selected(), quantity = Number($('quantity').value);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) { text('message', '数量必须为 1–20 的整数。'); return; }
  const options = {}, labels = [$('sku').selectedOptions[0].textContent];
  document.querySelectorAll('[data-option]').forEach(select => { options[select.dataset.option] = select.value; labels.push(select.selectedOptions[0].textContent); });
  basket.push({ store_id: $('store').value, product_id: product.product_id, sku_id: $('sku').value, options, quantity, title: product.title, labels });
  invalidate(); renderBasket(); controls();
};
$('quote').onclick = () => run(async () => {
  invalidate(); const budget = Number($('budget').value) * 100;
  if (!Number.isFinite(budget) || Math.abs(budget - Math.round(budget)) > .000001) throw new Error('预算最多保留两位小数。');
  quote = await api('/luckin/v1/quotes', { store_id: $('store').value, budget_minor: Math.round(budget), selections: basket.map(({ title, labels, ...line }) => line) });
  renderQuote();
});
$('confirm').onclick = () => run(async () => {
  if (!quote || Date.parse(quote.terms.expires_at) <= Date.now()) throw new Error('报价已失效，请重新获取。');
  await api('/luckin/v1/confirm', { quote_id: quote.terms.quote_id, terms_hash: quote.terms_hash, confirmed: true }); invalidate(); await loadOrders();
});
$('refresh').onclick = () => run(loadOrders);
$('find-stores').onclick = () => run(async () => {
  if (!$('longitude').value || !$('latitude').value) throw new Error('请填写经纬度。');
  stores = await api('/luckin/v1/locations', { longitude: Number($('longitude').value), latitude: Number($('latitude').value) }); setStores(); await storeChanged();
});
$('read-detail').onclick = () => run(async () => {
  const reference = await api(`${prefix()}/resolve`, { entry_id: $('product').value, purpose: 'view' });
  const product = reference.visible_attributes['luckin.selection.v1'];
  text('detail', product.options.map(option => `${option.label}：${option.values.map(value => `${value.label}${value.selected ? '（当前）' : ''}${value.selectable === false ? '（不可选）' : ''}`).join('、')}`).join('\n'));
});
setInterval(() => { if (quote && Date.parse(quote.terms.expires_at) <= Date.now()) { text('expiry', '报价已过期，请重新获取。'); controls(); } }, 1000);
run(async () => {
  const bootstrap = await api('/luckin/v1/bootstrap'); mode = bootstrap.mode; csrf = bootstrap.csrf;
  text('mode', mode === 'readonly' ? '真实只读联调 · 已连接瑞幸 MCP，创建订单、支付和取消均未开放。' : '离线适配 · 所有门店、商品和价格均为合成数据，模拟操作不会下单或扣款。');
  ['location', 'live-options', 'read-note'].forEach(id => { $(id).hidden = mode !== 'readonly'; });
  ['fixture-options', 'basket-card', 'orders-card'].forEach(id => { $(id).hidden = mode !== 'fixture'; });
  if (mode === 'fixture') { stores = await api('/luckin/v1/stores'); setStores(); await storeChanged(); await loadOrders(); }
});
