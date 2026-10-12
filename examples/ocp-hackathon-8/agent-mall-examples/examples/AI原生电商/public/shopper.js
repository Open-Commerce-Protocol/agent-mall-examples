const productGrid = document.querySelector('#product-grid');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chat-form');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const intentPanel = document.querySelector('#intent-panel');
const resultTitle = document.querySelector('#result-title');
const resultCount = document.querySelector('#result-count');
const dialog = document.querySelector('#order-dialog');
const toast = document.querySelector('#toast');
let currentNeed = '';
let selectedProduct = null;

/** 请求 JSON API，并将非成功响应转换为异常。 */
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

/** 初次加载商品列表。 */
async function loadProducts() {
  productGrid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const products = await api('/api/products');
  renderProducts(products);
  resultCount.textContent = `${products.length} 款在售`;
}

/** 将商品列表渲染为卡片。 */
function renderProducts(products) {
  productGrid.innerHTML = products.map((product, index) => {
    const match = product.match;
    const score = match ? Math.round(match.total * 100) : null;
    return `<article class="product-card">
      <div class="product-visual"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)} 商品图">${score !== null ? `<span class="match-badge">${index === 0 ? '首选 · ' : ''}${score}% 匹配</span>` : ''}</div>
      <div class="product-body">
        <span class="product-brand">${escapeHtml(product.brand)}</span>
        <div class="product-title-row"><h3>${escapeHtml(product.title)}</h3><span class="price">¥${formatNumber(product.price)}</span></div>
        <p class="product-desc">${escapeHtml(product.description)}</p>
        <div class="tag-row">${product.aiProfile.searchTags.slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
        ${match ? `<p class="reason-line">${escapeHtml(match.reasons.slice(0, 2).join('；'))}</p><div class="score-details"><div>关键词 ${Math.round(match.keyword * 100)}%<div class="score-track"><span style="width:${match.keyword * 100}%"></span></div></div><div>向量语义 ${Math.round(match.vector * 100)}%<div class="score-track"><span style="width:${match.vector * 100}%"></span></div></div></div>` : ''}
        <div class="card-footer"><span class="stock">库存 ${product.inventory} 台</span><button class="card-button" data-order-id="${product.id}">生成演示订单</button></div>
      </div>
    </article>`;
  }).join('');
  productGrid.querySelectorAll('[data-order-id]').forEach((button) => button.addEventListener('click', () => openOrder(products.find((product) => product.id === Number(button.dataset.orderId)))));
}

/** 提交用户需求并刷新 Agent 回复与推荐。 */
async function submitNeed(message) {
  currentNeed = message;
  appendMessage('user', message);
  messageInput.value = '';
  sendButton.disabled = true;
  sendButton.textContent = '检索中…';
  try {
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
    appendMessage('agent', result.answer);
    renderIntent(result.intent);
    renderProducts(result.products);
    resultTitle.textContent = 'AI 为你组合的推荐结果';
    resultCount.textContent = `${result.products.length} 款匹配`;
  } catch (error) {
    appendMessage('agent', error.message);
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = '发送需求 <span aria-hidden="true">↑</span>';
  }
}

/** 展示需求理解 Agent 提取的约束。 */
function renderIntent(intent) {
  const items = [...intent.concepts, intent.maxPrice ? `预算 ≤ ¥${formatNumber(intent.maxPrice)}` : '', intent.minMemory ? `内存 ≥ ${intent.minMemory}GB` : '', intent.maxWeight ? `重量 ≤ ${intent.maxWeight}kg` : ''].filter(Boolean);
  intentPanel.classList.remove('hidden');
  intentPanel.innerHTML = `<strong>Agent 已理解</strong>${items.length ? items.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>开放语义检索</span>'}`;
}

/** 向对话区追加一条消息。 */
function appendMessage(role, text) {
  const article = document.createElement('article');
  article.className = `message ${role === 'user' ? 'user-message' : 'agent-message'}`;
  article.innerHTML = role === 'user' ? `<div><p>${escapeHtml(text)}</p></div>` : `<div class="avatar">AI</div><div><strong>Nexa 选购助手</strong><p>${escapeHtml(text)}</p></div>`;
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

/** 打开演示订单确认窗口。 */
function openOrder(product) {
  selectedProduct = product;
  document.querySelector('#order-product').innerHTML = `<img src="${escapeHtml(product.image)}" alt=""><div><strong>${escapeHtml(product.title)}</strong><span>¥${formatNumber(product.price)}</span></div>`;
  document.querySelector('#order-quantity').max = product.inventory;
  dialog.showModal();
}

/** 在页面右下角显示短提示。 */
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

/** 转义插入 HTML 的动态文本。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

/** 格式化金额或数量。 */
function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

chatForm.addEventListener('submit', (event) => { event.preventDefault(); const message = messageInput.value.trim(); if (message) submitNeed(message); });
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { messageInput.value = button.dataset.prompt; submitNeed(button.dataset.prompt); }));
document.querySelector('#order-form').addEventListener('submit', async (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  try {
    const quantity = Number(document.querySelector('#order-quantity').value);
    const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({ productId: selectedProduct.id, quantity, customerNeed: currentNeed || '浏览热门商品' }) });
    dialog.close();
    showToast(`订单 ${order.order_no} 已创建，可到商家端查看`);
    await loadProducts();
  } catch (error) { showToast(error.message); }
});

loadProducts().catch((error) => { productGrid.innerHTML = `<p>${escapeHtml(error.message)}</p>`; });
