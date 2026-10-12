const toast = document.querySelector('#toast');
let products = [];
let orders = [];

/** 请求 JSON API，并将非成功响应转换为异常。 */
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

/** 加载经营数据并刷新所有面板。 */
async function refresh() {
  const [stats, productData, orderData] = await Promise.all([api('/api/stats'), api('/api/products'), api('/api/orders')]);
  products = productData;
  orders = orderData;
  renderStats(stats);
  renderStock();
  renderRecentOrders();
  renderProducts(products);
  renderOrders();
}

/** 切换商家控制台主标签。 */
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${name}`));
  document.querySelectorAll('.side-link').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 渲染经营统计指标。 */
function renderStats(stats) {
  const entries = [['在售商品', `${stats.products} 款`, '全部已完成 AI 入库'], ['总库存', `${stats.inventory} 台`, '实时同步用户端'], ['演示订单', `${stats.orders} 笔`, '本地沙盒数据'], ['库存货值', `¥${formatNumber(stats.stock_value)}`, '按当前售价估算']];
  document.querySelector('#stats-grid').innerHTML = entries.map(([label, value, note]) => `<article class="stat-item"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
}

/** 渲染库存条形概览。 */
function renderStock() {
  const max = Math.max(...products.map((product) => product.inventory), 1);
  document.querySelector('#stock-bars').innerHTML = products.slice(0, 6).map((product) => `<div class="stock-row"><span title="${escapeHtml(product.title)}">${escapeHtml(product.title)}</span><div class="stock-bar"><i style="width:${product.inventory / max * 100}%"></i></div><strong>${product.inventory}</strong></div>`).join('');
}

/** 渲染概览中的最新订单。 */
function renderRecentOrders() {
  document.querySelector('#recent-orders').innerHTML = orders.slice(0, 5).map((order) => `<div class="recent-order"><strong>${escapeHtml(order.product_title)}</strong><em>${escapeHtml(order.status)}</em><span>${escapeHtml(order.order_no)}</span><span>¥${formatNumber(order.total)}</span></div>`).join('') || '<p>暂无订单</p>';
}

/** 渲染商品管理表格。 */
function renderProducts(items) {
  document.querySelector('#product-total').textContent = `共 ${items.length} 款商品`;
  document.querySelector('#product-table-body').innerHTML = items.map((product) => `<tr>
    <td><div class="table-product"><img src="${escapeHtml(product.image)}" alt=""><div><strong>${escapeHtml(product.title)}</strong><small>${escapeHtml(product.sku)} · ${escapeHtml(product.brand)}</small></div></div></td>
    <td><div class="table-tags">${product.aiProfile.searchTags.slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div></td>
    <td>¥${formatNumber(product.price)}</td>
    <td><div class="inventory-control"><button data-stock="${product.id}" data-delta="-1">−</button><input value="${product.inventory}" aria-label="${escapeHtml(product.title)}库存" readonly><button data-stock="${product.id}" data-delta="1">＋</button></div></td>
    <td>${formatDate(product.updated_at)}</td>
  </tr>`).join('');
  document.querySelectorAll('[data-stock]').forEach((button) => button.addEventListener('click', () => changeStock(Number(button.dataset.stock), Number(button.dataset.delta))));
}

/** 渲染订单管理表格。 */
function renderOrders() {
  const statuses = ['待确认', '待发货', '已发货', '已完成', '已取消'];
  document.querySelector('#order-table-body').innerHTML = orders.map((order) => `<tr><td><strong>${escapeHtml(order.order_no)}</strong></td><td>${escapeHtml(order.product_title)} × ${order.quantity}</td><td>${escapeHtml(order.customer_need || '—')}</td><td>¥${formatNumber(order.total)}</td><td><select class="status-select" data-order-status="${order.id}">${statuses.map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td><td>${formatDate(order.created_at)}</td></tr>`).join('');
  document.querySelectorAll('[data-order-status]').forEach((select) => select.addEventListener('change', () => changeOrderStatus(Number(select.dataset.orderStatus), select.value)));
}

/** 修改单个商品库存。 */
async function changeStock(id, delta) {
  const product = products.find((item) => item.id === id);
  const inventory = Math.max(0, product.inventory + delta);
  await api(`/api/products/${id}/inventory`, { method: 'PATCH', body: JSON.stringify({ inventory }) });
  showToast(`库存已更新为 ${inventory}`);
  await refresh();
}

/** 修改演示订单状态。 */
async function changeOrderStatus(id, status) {
  await api(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  showToast(`订单已更新为“${status}”`);
  await refresh();
}

/** 展示商品理解 Agent 的最新输出。 */
function renderAgentOutput(product) {
  const output = document.querySelector('#agent-output');
  output.innerHTML = `<span>处理完成 · 商品已发布</span><dl><dt>场景标签</dt><dd>${product.aiProfile.searchTags.join('、') || '通用笔记本'}</dd><dt>语义文本</dt><dd>${escapeHtml(product.ai_text)}</dd><dt>向量预览</dt><dd>[${product.embedding.slice(0, 8).join(', ')} …]</dd></dl>`;
  document.querySelectorAll('.pipeline-steps li').forEach((item) => item.classList.add('active'));
}

/** 在页面右下角显示短提示。 */
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

/** 转义插入 HTML 的动态文本。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

/** 格式化数值。 */
function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value); }

/** 格式化 SQLite 时间。 */
function formatDate(value) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(`${value.replace(' ', 'T')}Z`)); }

document.querySelectorAll('.side-link').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-open-create]').forEach((button) => button.addEventListener('click', () => switchTab('create')));
document.querySelectorAll('[data-open-products]').forEach((button) => button.addEventListener('click', () => switchTab('products')));
document.querySelectorAll('[data-open-orders]').forEach((button) => button.addEventListener('click', () => switchTab('orders')));
document.querySelector('#product-filter').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); renderProducts(products.filter((product) => `${product.title} ${product.sku} ${product.brand}`.toLowerCase().includes(query))); });
document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = document.querySelector('#create-product-button');
  button.disabled = true;
  button.textContent = 'Agent 正在理解商品…';
  try {
    const product = await api('/api/products', { method: 'POST', body: JSON.stringify({ sku: form.get('sku'), title: form.get('title'), brand: form.get('brand'), category: form.get('category'), price: Number(form.get('price')), inventory: Number(form.get('inventory')), description: form.get('description'), image: '/assets/default-laptop.png', specs: { 处理器: form.get('cpu'), 内存: form.get('memory'), 硬盘: form.get('storage'), 屏幕: form.get('display'), 重量: form.get('weight'), 续航: form.get('battery') } }) });
    renderAgentOutput(product);
    showToast('商品已完成 AI 入库并发布');
    event.currentTarget.reset();
    event.currentTarget.elements.category.value = '笔记本电脑';
    await refresh();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.textContent = '交给 Agent 处理并发布'; }
});

refresh().catch((error) => showToast(error.message));
