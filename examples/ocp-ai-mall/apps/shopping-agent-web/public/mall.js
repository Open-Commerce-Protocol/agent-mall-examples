import { getElement, getField, getControl } from './dom.js';

/** @typedef {{store_id:string,name:string,address:string,status:string}} Store */
/** @typedef {{value_id:string,label:string,selected:boolean|null,selectable:boolean|null,extra_minor:number|null}} OptionValue */
/** @typedef {{product_id:string,title:string,sku_id:string,reference_minor:number|null,estimate_minor:number|null,image_url?:string,options:{option_id:string,label:string,values:OptionValue[]}[]}} Product */
/** @typedef {{merchants:{id:string,name:string,connected:boolean}[],model:{configured:boolean,name?:string},checkout_enabled:boolean,specification_editing?:boolean}} Bootstrap */
/** @typedef {{text:string,products:Product[],source:'model'|'search',conversation_id:string,store_id:string,checked_at:string}} Reply */
/** @typedef {{product:Product,store_id:string,selection_id:string,checkout_enabled:boolean}} Selection */
/** @typedef {{title:string,specs:string,quantity:number}} OrderLine */
/** @typedef {{quote_id:string,expires_at:string,total_minor:number,original_minor:number,discount_minor:number,store:string,address:string,remark:string,products:OrderLine[]}} Quote */
/** @typedef {{attempt_id:string,state:string,message?:string,store:string,address:string,products:OrderLine[],payment_qr_data?:string,order?:{order_id:string,status:string,total_minor:number|null,need_pay:boolean|null,payment_url?:string,payment_qr_url?:string,pickup_code?:string}}} Attempt */
/** @type {Store[]} */ let stores = [];
/** @type {Product[]} */ let previewProducts = [];
/** @type {Bootstrap|null} */ let configuration = null;
/** @type {string|undefined} */ let conversationId;
let storeId = '', busy = false, booting = true, detailRevision = 0, checkoutBusy = false;
const storeDialog = /** @type {HTMLDialogElement} */ (getElement('store-dialog'));
const productDialog = /** @type {HTMLDialogElement} */ (getElement('product-dialog'));
const composer = /** @type {HTMLTextAreaElement} */ (getField('chat-input'));

/** @template T @param {string} path @param {unknown} [body] @returns {Promise<T>} */
async function api(path, body) {
  const response = await fetch(path, { signal: AbortSignal.timeout(75000), ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const value = await response.json();
  if (!response.ok) throw new Error(response.status === 404 && value?.error?.code === 'not_found'
    ? '当前服务尚未加载新版功能，请重启商场服务并刷新页面。' : value?.error?.message || '连接暂时不可用，请稍后重试。');
  return value;
}
/** @param {string} tag @param {string} [content] @param {string} [className] */
function node(tag, content = '', className = '') { const element = document.createElement(tag); element.textContent = content; element.className = className; return element; }
/** @param {number|null} value */
function money(value) { return value === null ? '价格待核验' : `¥${(value / 100).toFixed(2)}`; }
/** @param {string} [message] */
function notice(message = '') { getElement('notice').textContent = message; getElement('notice').hidden = !message; }
function controls() {
  getControl('send').disabled = busy || booting || !storeId || !composer.value.trim();
  getControl('direct-search').disabled = busy || booting || !storeId || !composer.value.trim();
  getControl('new-chat').disabled = busy;
  getControl('store-trigger').disabled = busy || booting;
  document.querySelectorAll('[data-prompt]').forEach(element => { if (element instanceof HTMLButtonElement) element.disabled = busy || booting || !storeId; });
  getElement('thinking').hidden = !busy;
  composer.disabled = busy;
}
function scrollEnd() { const scroll = getElement('chat-scroll'); scroll.scrollTop = scroll.scrollHeight; }
function resetConversation() {
  conversationId = undefined; detailRevision++; getElement('messages').replaceChildren(); getElement('welcome').hidden = false; notice();
  composer.value = ''; controls(); composer.focus();
}
/** @param {Product} product @param {boolean} [compact] @param {string} [sourceStore] */
function productCard(product, compact = false, sourceStore = storeId) {
  const button = document.createElement('button'); button.className = `product-card${compact ? ' product-card-compact' : ''}`;
  button.type = 'button'; button.setAttribute('aria-label', `查看${product.title}规格`);
  if (product.image_url && /^https:\/\/[^/]+\.luckincoffeecdn\.com\//.test(product.image_url)) {
    const image = document.createElement('img'); image.src = product.image_url; image.alt = product.title; image.loading = 'lazy'; image.className = 'product-image';
    image.onerror = () => { image.replaceWith(node('div', '✦', 'product-image product-placeholder')); }; button.append(image);
  } else button.append(node('div', '✦', 'product-image product-placeholder'));
  const content = node('div', '', 'product-copy'); content.append(node('h3', product.title), node('span', '瑞幸咖啡 · 门店商品', 'product-tag'));
  const price = node('div', '', 'product-price'); price.append(node('strong', money(product.estimate_minor)), node('small', '预估'));
  if (product.reference_minor !== null && product.reference_minor !== product.estimate_minor) price.append(node('del', money(product.reference_minor)));
  content.append(price); button.append(content); button.onclick = () => { void showDetail(product, sourceStore); }; return button;
}
function renderPreview() {
  getElement('preview-products').replaceChildren(...previewProducts.slice(0, 5).map((product, index) => productCard(product, index > 0)));
  getElement('catalog-state').textContent = previewProducts.length ? `来自${stores.find(store => store.store_id === storeId)?.name ?? '当前门店'} · ${previewProducts.length} 款候选` : '没有返回商品，可以换个关键词或门店。';
}
async function loadPreview() {
  getElement('catalog-state').textContent = '正在读取当前门店的真实商品…'; getElement('preview-products').replaceChildren();
  getElement('retry-products').hidden = true;
  try {
    const reply = /** @type {Reply} */ (await api('/api/mall/chat', { merchant_id: 'luckin', store_id: storeId, message: '咖啡', direct_search: true }));
    previewProducts = reply.products; renderPreview();
  } catch (error) {
    getElement('catalog-state').textContent = error instanceof Error ? error.message : '商品读取失败。'; getElement('retry-products').hidden = false;
  }
}
function renderStores() {
  getElement('store-list').replaceChildren(...stores.map(store => {
    const button = document.createElement('button'); button.className = `store-option${store.store_id === storeId ? ' selected' : ''}`;
    button.append(node('strong', store.name), node('span', store.status, 'store-status'), node('small', store.address));
    button.onclick = async () => {
      if (busy || booting) return;
      storeDialog.close(); if (storeId === store.store_id) return;
      storeId = store.store_id; getElement('store-label').textContent = store.name; resetConversation();
      booting = true; controls(); await loadPreview(); booting = false; controls();
    }; return button;
  }));
}
/** @param {Product} product @param {string} sourceStore */
async function showDetail(product, sourceStore) {
  if (busy || booting || checkoutBusy) return;
  if (sourceStore !== storeId) { notice('门店已切换，请从当前门店重新选择商品。'); return; }
  const revision = ++detailRevision; getElement('product-title').textContent = product.title;
  getElement('product-detail').replaceChildren(node('p', '正在向门店核验规格…', 'catalog-state')); productDialog.showModal();
  try {
    const result = /** @type {Selection} */ (await api('/api/mall/detail', { store_id: sourceStore, product_id: product.product_id }));
    if (revision !== detailRevision || sourceStore !== storeId) return;
    renderSelection(result);
  } catch (error) { if (revision === detailRevision) getElement('product-detail').replaceChildren(node('p', error instanceof Error ? error.message : '详情暂不可用，请重试。', 'detail-note')); }
}
/** @param {() => Promise<void>} task */
async function checkoutAction(task) {
  if (checkoutBusy) return;
  productDialog.querySelectorAll('.checkout-error').forEach(element => element.remove());
  checkoutBusy = true; getControl('product-close').disabled = true;
  productDialog.querySelectorAll('button,input').forEach(element => { if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) element.disabled = true; });
  try { await task(); }
  catch (error) { getElement('product-detail').append(node('p', error instanceof Error ? error.message : '请求暂未完成，请查看我的订单。', 'checkout-error')); }
  finally {
    checkoutBusy = false; getControl('product-close').disabled = false;
    productDialog.querySelectorAll('button,input').forEach(element => { if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && !element.hasAttribute('data-unavailable')) element.disabled = false; });
  }
}
/** @param {Selection} result @param {number} [quantity] @param {string} [remark] */
function renderSelection(result, quantity = 1, remark = '') {
    const item = result.product, content = getElement('product-detail'); content.replaceChildren();
    getElement('product-title').textContent = item.title;
    if (item.image_url && /^https:\/\/[^/]+\.luckincoffeecdn\.com\//.test(item.image_url)) { const image = document.createElement('img'); image.src = item.image_url; image.alt = item.title; image.className = 'detail-image'; content.append(image); }
    const price = node('div', '', 'product-price'); price.append(node('strong', money(item.estimate_minor)), node('small', '当前预估价')); content.append(price);
    const options = node('div', '', 'detail-options');
    for (const option of item.options) { options.append(node('h3', option.label)); const values = node('div');
      for (const value of option.values) {
        const button = document.createElement('button'); button.className = `option-value${value.selected ? ' selected' : ''}`;
        button.textContent = `${value.label}${value.selected ? ' · 当前' : ''}${value.selectable === false ? ' · 暂不可选' : ''}${value.extra_minor ? ` +${money(value.extra_minor)}` : ''}`;
        if (value.selectable !== true || value.selected || !configuration?.specification_editing) { button.disabled = true; button.setAttribute('data-unavailable', ''); }
        button.onclick = () => { void checkoutAction(async () => {
          const updated = /** @type {Selection} */ (await api('/api/mall/switch', { selection_id: result.selection_id, option_id: option.option_id, value_id: value.value_id }));
          renderSelection(updated, Number(count.value), note.value);
        }); }; values.append(button);
      }
      options.append(values);
    } content.append(options);
    if (!configuration?.specification_editing) content.append(node('p', '当前服务尚未加载规格编辑功能，请重启商场服务并刷新页面。', 'checkout-error'));
    const fields = node('div', '', 'checkout-fields');
    const countLabel = document.createElement('label'); countLabel.textContent = '数量';
    const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.max = '20'; count.step = '1'; count.value = String(quantity); count.id = 'purchase-quantity'; countLabel.append(count);
    const noteLabel = document.createElement('label'); noteLabel.textContent = '备注（选填）';
    const note = document.createElement('input'); note.maxLength = 100; note.value = remark; note.id = 'purchase-remark'; noteLabel.append(note); fields.append(countLabel, noteLabel); content.append(fields);
    content.append(node('p', '选择规格后先核对门店、数量和优惠后金额，再确认提交真实订单。', 'detail-note'));
    if (result.checkout_enabled) {
      const preview = document.createElement('button'); preview.className = 'detail-ask'; preview.id = 'preview-order'; preview.textContent = '核对金额并下单';
      preview.onclick = () => { void checkoutAction(async () => {
        if (!count.reportValidity()) return;
        const quote = /** @type {Quote} */ (await api('/api/mall/preview', { selection_id: result.selection_id, quantity: Number(count.value), remark: note.value }));
        renderQuote(quote, result, Number(count.value), note.value);
      }); }; content.append(preview);
    } else content.append(node('p', '当前暂未开放新订单。', 'detail-note'));
    const ask = document.createElement('button'); ask.className = 'detail-ask'; ask.textContent = '让 AI 帮我找找相似的';
    ask.onclick = () => { productDialog.close(); composer.value = `我在看${item.title}，帮我找找相似的商品`; void send(false); }; content.append(ask);
}
/** @param {HTMLElement} content @param {{store:string,address:string,products:OrderLine[]}} value */
function orderSummary(content, value) {
  content.append(node('h3', `${value.store} · 到店自取`), node('p', value.address, 'detail-note'));
  for (const line of value.products) content.append(node('p', `${line.title} × ${line.quantity}`), node('p', line.specs, 'detail-note'));
}
/** @param {Quote} quote @param {Selection} selection @param {number} quantity @param {string} remark */
function renderQuote(quote, selection, quantity, remark) {
  const content = getElement('product-detail'); content.replaceChildren(); getElement('product-title').textContent = '确认真实订单';
  orderSummary(content, quote);
  content.append(node('p', `原价 ${money(quote.original_minor)} · 优惠 ${money(quote.discount_minor)}`, 'detail-note'), node('h2', `本次预览 ${money(quote.total_minor)}`));
  if (quote.remark) content.append(node('p', `备注：${quote.remark}`));
  content.append(node('p', `请在 ${new Date(quote.expires_at).toLocaleTimeString()} 前确认。确认后提交到瑞幸；如需付款，将显示支付二维码，请核对支付页面金额。`, 'detail-note'));
  const confirm = document.createElement('button'); confirm.className = 'detail-ask'; confirm.id = 'confirm-order'; confirm.textContent = `确认下单 · ${money(quote.total_minor)}`;
  confirm.onclick = () => { void checkoutAction(async () => {
    // Disable permanently for this preview, including network errors. Recovery uses the order ledger.
    confirm.setAttribute('data-unavailable', ''); confirm.disabled = true;
    try { const attempt = /** @type {Attempt} */ (await api('/api/mall/confirm', { quote_id: quote.quote_id, confirmed: true })); renderAttempt(attempt); }
    catch (error) {
      content.replaceChildren(node('p', error instanceof Error ? error.message : '提交结果未确认。', 'checkout-error'));
      content.append(node('p', '请先查看「我的订单」及瑞幸订单记录，核对后再操作。', 'detail-note'));
      const recover = document.createElement('button'); recover.className = 'detail-ask'; recover.textContent = '查看我的订单'; recover.onclick = () => { void showOrders(); }; content.append(recover);
    }
  }); };
  const back = document.createElement('button'); back.className = 'retry-products'; back.textContent = '返回修改'; back.onclick = () => renderSelection(selection, quantity, remark);
  content.append(confirm, back);
}
/** @param {string} orderId */
function orderNumber(orderId) {
  const row = node('div', '', 'order-id-row');
  row.append(node('span', `订单编号：${orderId}`, 'order-number'));
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-order-number'; copy.textContent = '复制编号';
  copy.setAttribute('aria-label', `复制订单编号 ${orderId}`);
  const status = node('span', '', 'copy-order-status'); status.setAttribute('role', 'status');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(orderId); status.textContent = '已复制'; }
    catch { status.textContent = '请选中编号手动复制'; }
  };
  row.append(copy, status); return row;
}
/** @param {Attempt} attempt */
function renderAttempt(attempt) {
  const content = getElement('product-detail'); content.replaceChildren(); getElement('product-title').textContent = attempt.order?.status ?? '订单结果待确认';
  orderSummary(content, attempt);
  const order = attempt.order;
  if (order) {
    content.append(orderNumber(order.order_id), node('h3', `订单金额 ${money(order.total_minor)}`));
    if (order.need_pay !== false) {
      const qr = attempt.payment_qr_data || order.payment_qr_url;
      if (qr) {
        content.append(node('p', '微信扫一扫，完成支付', 'payment-caption'));
        const image = document.createElement('img'); image.className = 'payment-qr'; image.alt = '瑞幸订单支付二维码'; image.src = qr; image.referrerPolicy = 'no-referrer';
        image.onerror = () => { image.replaceWith(node('p', '二维码暂时无法加载，请刷新订单或打开商家支付链接。', 'checkout-error')); }; content.append(image);
      }
      if (order.payment_url) { const link = document.createElement('a'); link.href = order.payment_url; link.textContent = '打开商家支付'; link.className = 'detail-ask'; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link); }
      if (!qr && !order.payment_url) content.append(node('p', '商家未返回可用支付信息，请到瑞幸查看这笔订单。', 'detail-note'));
    }
    if (order.pickup_code) content.append(node('h2', `取餐码：${order.pickup_code}`));
  } else content.append(node('p', attempt.message || '请先到瑞幸核对订单，勿重复提交。', 'checkout-error'));
  const refresh = document.createElement('button'); refresh.className = 'detail-ask'; refresh.id = 'refresh-order'; refresh.textContent = '我已支付 / 刷新订单状态';
  refresh.onclick = () => { void checkoutAction(async () => renderAttempt(/** @type {Attempt} */ (await api('/api/mall/order', { attempt_id: attempt.attempt_id })))); }; content.append(refresh);
}
async function showOrders() {
  if (checkoutBusy) return;
  detailRevision++; getElement('product-title').textContent = '我的订单'; if (!productDialog.open) productDialog.showModal();
  await checkoutAction(async () => {
    const content = getElement('product-detail'); content.replaceChildren(node('p', '正在读取订单…'));
    const result = /** @type {{orders:Attempt[]}} */ (await api('/api/mall/orders'));
    content.replaceChildren();
    if (!result.orders.length) content.append(node('p', '还没有提交订单。', 'detail-note'));
    for (const row of result.orders) {
      const card = node('article', '', 'order-list-card');
      card.append(row.order?.order_id ? orderNumber(row.order.order_id) : node('p', '订单编号待商家确认', 'detail-note'));
      const button = document.createElement('button'); button.className = 'store-option';
      button.textContent = `${row.store} · ${row.products.map(line => `${line.title} × ${line.quantity}`).join('、')} · ${row.order?.status || '结果待确认'} · 查看详情`;
      button.onclick = () => renderAttempt(row); card.append(button); content.append(card);
    }
  });
}
productDialog.addEventListener('cancel', event => { if (checkoutBusy) event.preventDefault(); });
const ordersButton = document.createElement('button'); ordersButton.id = 'my-orders'; ordersButton.className = 'location-trigger'; ordersButton.textContent = '我的订单'; ordersButton.onclick = () => { void showOrders(); }; document.querySelector('.mall-header')?.append(ordersButton);
/** @param {'user'|'assistant'} role @param {string} content @param {Reply} [reply] */
function addMessage(role, content, reply) {
  getElement('welcome').hidden = true; const message = node('article', '', `message message-${role}`), body = node('div', '', 'message-body');
  if (role === 'assistant') { message.append(node('span', '✦', 'ai-avatar')); body.append(node('div', reply?.source === 'search' ? '商家商品检索' : '我的 AI 向导', 'message-label')); body.append(node('p', content, 'message-text')); }
  else body.textContent = content;
  if (reply?.products.length) {
    const shelf = node('div', '', 'message-products'); shelf.append(...reply.products.slice(0, 6).map(product => productCard(product, false, reply.store_id))); body.append(shelf);
    body.append(node('div', `瑞幸 MCP · 当前门店 · ${new Date(reply.checked_at).toLocaleTimeString()} 更新 · 预估价格`, 'message-source'));
  }
  message.append(body); getElement('messages').append(message); scrollEnd();
}
/** @param {boolean} direct */
async function send(direct) {
  const message = composer.value.trim(); if (!message || busy || booting || !storeId) return;
  notice(); busy = true; composer.value = ''; addMessage('user', message); controls(); scrollEnd();
  getElement('thinking-label').textContent = direct || !configuration?.model.configured ? '正在查询门店商品' : 'AI 正在理解需求、查询商品';
  try {
    const reply = /** @type {Reply} */ (await api('/api/mall/chat', { merchant_id: 'luckin', store_id: storeId, message,
      ...(conversationId ? { conversation_id: conversationId } : {}), direct_search: direct }));
    conversationId = reply.conversation_id; addMessage('assistant', reply.text, reply);
    if (reply.products.length) { previewProducts = reply.products; renderPreview(); }
  } catch (error) { notice(`${error instanceof Error ? error.message : '请求未完成。'} 你可以重试或使用「直接搜索」。`); composer.value = message; }
  finally { busy = false; controls(); scrollEnd(); composer.focus(); }
}
getElement('chat-form').addEventListener('submit', event => { event.preventDefault(); void send(false); });
composer.addEventListener('input', controls);
composer.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(false); } });
getControl('direct-search').onclick = () => { void send(true); };
getControl('new-chat').onclick = resetConversation;
getControl('nav-chat').onclick = () => { document.querySelector('.discovery')?.classList.remove('mobile-open'); composer.focus(); };
getControl('nav-products').onclick = () => { document.querySelector('.discovery')?.classList.toggle('mobile-open'); };
getControl('merchant-luckin').onclick = () => { composer.value = '瑞幸有什么咖啡？'; void send(false); };
getControl('store-trigger').onclick = () => { renderStores(); storeDialog.showModal(); };
getControl('store-close').onclick = () => storeDialog.close();
getControl('product-close').onclick = () => { detailRevision++; productDialog.close(); };
getControl('retry-products').onclick = async () => { if (busy || booting) return; booting = true; controls(); try { if (!storeId) await connectStores(); else await loadPreview(); } finally { booting = false; controls(); } };
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { composer.value = button.getAttribute('data-prompt') || ''; void send(false); }));
const mobileReset = document.createElement('button'); mobileReset.className = 'mobile-reset'; mobileReset.hidden = true; mobileReset.textContent = '＋'; mobileReset.setAttribute('aria-label', '开启新对话'); mobileReset.onclick = () => { if (!busy) resetConversation(); }; document.querySelector('.sidebar')?.append(mobileReset);
const mobileBrowse = document.createElement('button'); mobileBrowse.className = 'mobile-browse'; mobileBrowse.textContent = '▦'; mobileBrowse.setAttribute('aria-label', '切换商品预览'); mobileBrowse.onclick = () => document.querySelector('.discovery')?.classList.toggle('mobile-open'); document.querySelector('.sidebar')?.append(mobileBrowse);
const mobileSettings = document.createElement('a'); mobileSettings.className = 'mobile-settings'; mobileSettings.href = '/settings#api-configuration'; mobileSettings.textContent = '⚙'; mobileSettings.setAttribute('aria-label', '设置我的模型'); document.querySelector('.sidebar')?.append(mobileSettings);
async function connectStores() {
  try {
    const result = /** @type {{stores:Store[]}} */ (await api('/api/mall/stores')); stores = result.stores;
    storeId = stores.find(store => store.status === '营业中')?.store_id ?? stores[0]?.store_id ?? '';
    getElement('store-label').textContent = stores.find(store => store.store_id === storeId)?.name ?? '未找到附近门店';
    getElement('merchant-dot').classList.add('connected');
    if (storeId) await loadPreview(); else getElement('catalog-state').textContent = '附近没有返回门店，请稍后重试。';
  } catch (error) {
    const message = error instanceof Error ? error.message : '门店连接失败。'; notice(message); getElement('store-label').textContent = '门店暂不可用';
    getElement('catalog-state').textContent = message; getElement('retry-products').hidden = false;
  }
}
async function initialize() {
  controls();
  try {
    const current = /** @type {Bootstrap} */ (await api('/api/mall/bootstrap')); configuration = current;
    const modelName = current.model.configured ? current.model.name || '已连接' : '尚未连接模型';
    getElement('sidebar-model').textContent = modelName; getElement('composer-model').textContent = current.model.configured ? `✦ ${modelName}` : '✦ 检索模式 · 可连接自己的模型';
    await connectStores();
  } catch (error) { notice(error instanceof Error ? error.message : '初始化失败，请刷新重试。'); }
  finally { booting = false; controls(); }
}
void initialize();
