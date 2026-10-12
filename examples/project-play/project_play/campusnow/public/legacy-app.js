/* CampusNow 前端:轮询 /api/state 渲染四个区域 */
const PHASES = ['IDLE', 'PARSED', 'PLAN_AWAIT_CONFIRM', 'ORDER_AWAIT_PAY', 'PAID', 'INVOICE_AWAIT_CONFIRM', 'INVOICE_SUBMITTED', 'INVOICE_ISSUED', 'EMAIL_RECEIVED', 'ARCHIVED'];
const PHASE_LABEL = { IDLE: '待命', PARSED: '已理解', PLAN_AWAIT_CONFIRM: '待确认方案', ORDER_AWAIT_PAY: '待支付', PAID: '已支付', INVOICE_AWAIT_CONFIRM: '待确认开票', INVOICE_SUBMITTED: '开票中', INVOICE_ISSUED: '已开票', EMAIL_RECEIVED: '邮件已达', ARCHIVED: '已归档', FAILED: '失败' };

let lastTraceLen = 0;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderPhase(st) {
  const bar = document.getElementById('phasebar');
  const idx = PHASES.indexOf(st.phase);
  bar.innerHTML = PHASES.map((p, i) => `<span class="${i <= idx ? 'on' : ''}">${PHASE_LABEL[p]}</span>`).join('<span style="color:#475569">›</span>') + (st.phase === 'FAILED' ? `<span class="on" style="background:var(--bad)">失败</span>` : '');
}

function renderUnderstand(st) {
  const el = document.getElementById('understand');
  if (!st.need) { el.innerHTML = ''; return; }
  const n = st.need;
  el.innerHTML = `<div class="card"><b>任务理解</b>
    <div class="kv">
      <span class="k">商品</span><span>${esc(n.item_query)} ×${n.quantity}</span>
      <span class="k">预算</span><span>${n.budget ? '¥' + n.budget : '不限'}</span>
      <span class="k">发票</span><span>${n.require_invoice ? `${n.invoice_title_type === 'organization' ? '单位' : '个人'} · ${esc(n.invoice_title)}${n.invoice_tax_id ? ' · ' + esc(n.invoice_tax_id) : ''}` : '不需要'}</span>
      <span class="k">收件邮箱</span><span>${esc(n.email)}</span>
    </div>
    <span class="tagchip mock">规则式 NLU · 演示</span></div>`;
}

function renderPlan(st) {
  const el = document.getElementById('plan');
  if (!st.plan) return;
  const p = st.plan;
  let html = p.recommended.map((r) => `
    <div class="card"><b>${esc(r.item.title)}</b> <span class="price">¥${r.item.amount}</span>
      <div class="meta">${esc(r.catalog_name)} · ${esc(r.reason)}</div>
      <div style="margin-top:4px">
        <span class="tagchip ${r.item.invoice_supported ? 'ok' : 'bad'}">${r.item.invoice_supported ? '✓ 支持在线开票' : '✗ 不支持在线开票'}</span>
        <span class="tagchip ${r.item.availability === 'in_stock' ? 'ok' : 'bad'}">${r.item.availability === 'in_stock' ? '有货' : '缺货'}</span>
      </div></div>`).join('');
  html += `<div class="card" style="border:1px solid var(--accent)"><b>合计 ¥${p.total.toFixed(2)}</b> ${p.within_budget ? '' : '<span class="tagchip bad">超预算!</span>'}
    <div class="meta">${esc(p.rationale)}</div></div>`;
  if (p.invoice_fallback) {
    html += `<div class="card" style="border:1px solid var(--mock)"><b style="color:var(--mock)">⚠️ 商家不提供开票接口</b>
      <div class="meta">将继续购买,发票环节由 <b>CampusNow 本地模拟生成</b>:非商家开具、非正式税务凭证,仅用于演示与个人留存,不能用于正式报销。</div></div>`;
  }
  if (p.excluded.length) {
    html += `<div class="meta" style="margin:6px 0">剔除项:</div>` + p.excluded.map((e) => `<div class="card" style="opacity:.6"><b>${esc(e.title)}</b><div class="meta">${esc(e.catalog_name)} · ${esc(e.reason)}</div></div>`).join('');
  }
  if (st.phase === 'PLAN_AWAIT_CONFIRM') {
    html += `<div class="row"><button id="confirmPlan" ${p.recommended.length ? '' : 'disabled'}>${p.invoice_fallback ? '🛒 继续购买(本地模拟开票)' : '✅ 确认采购方案'}${p.recommended.length ? `(${p.recommended.length}件 ¥${p.total.toFixed(2)})` : '(无可购项)'}</button></div>`;
  }
  el.innerHTML = html;
  const btn = document.getElementById('confirmPlan');
  if (btn) btn.onclick = () => api('/api/confirm-plan').then(render);
}

function renderOrder(st) {
  const el = document.getElementById('order');
  const o = st.order;
  if (!o) { if (!st.plan) el.innerHTML = '<div class="card meta">等待方案确认…</div>'; return; }
  let html = `<div class="card"><b>订单 ${esc(o.order_id)}</b> <span class="tagchip mock">模拟订单</span>
    <div class="kv"><span class="k">商家</span><span>${esc(o.catalog_name)}</span><span class="k">商品</span><span>${o.lines.map((l) => esc(l.title)).join(' + ')}</span>
    <span class="k">合计</span><span class="price">¥${o.total.toFixed(2)}</span>
    <span class="k">支付状态</span><span>${o.paid ? '<span style="color:var(--ok)">已支付(模拟)</span>' : '待支付'}</span></div></div>`;

  if (st.phase === 'ORDER_AWAIT_PAY') {
    html += `<div class="row"><button class="mock" id="pay">💳 确认模拟支付 ¥${o.total.toFixed(2)}</button></div>
    <div class="meta" style="margin-top:6px;color:var(--dim)">Agent 不持有支付密码;真实场景中此处跳转商家收银台,由用户完成支付。</div>`;
  }

  const n = st.need;
  if (st.phase === 'INVOICE_AWAIT_CONFIRM' && n) {
    html += `<div class="card" style="border:1px solid var(--warn)"><b>开票资料(请核对)</b>
      <div class="kv"><span class="k">开票方式</span><span>${st.plan?.invoice_fallback ? '<span style="color:var(--mock);font-weight:700">本地模拟生成</span>(商家无开票接口,非商家开具、非正式税务凭证)' : '商家开票服务(测试,非正式税务凭证)'}</span>
      <span class="k">抬头</span><span>${n.invoice_title_type === 'organization' ? '单位' : '个人'} · ${esc(n.invoice_title)}</span>
      <span class="k">抬头</span><span>${n.invoice_title_type === 'organization' ? '单位' : '个人'} · ${esc(n.invoice_title)}</span>
      <span class="k">税号</span><span>${esc(n.invoice_tax_id ?? '—')}</span>
      <span class="k">接收邮箱</span><span>${esc(n.email)}</span></div></div>
      <div class="row"><button id="inv">🧾 提交开票申请(测试)</button></div>`;
  }

  const inv = st.invoice;
  if (inv) {
    const color = inv.status === 'emailed' || st.archive ? 'var(--ok)' : 'var(--warn)';
    html += `<div class="card"><b>开票申请 ${esc(inv.invoice_id)}</b> <span class="tagchip mock">${st.plan?.invoice_fallback ? '本地模拟开票(回退)' : '测试开票'}</span>
      <div class="kv"><span class="k">状态</span><span style="color:${color};font-weight:700">${esc(inv.status)}</span>
      <span class="k">抬头</span><span>${esc(inv.title)}</span><span class="k">邮箱</span><span>${esc(inv.email)}</span></div>
      ${inv.history.map((h) => `<div class="meta">${esc(h.at.slice(11, 19))} · ${esc(h.note)}</div>`).join('')}</div>`;
  }

  if (st.phase === 'FAILED' && st.error) html += `<div class="fail">❌ ${esc(st.error)}</div>`;
  if (st.phase === 'ARCHIVED' && st.archive) {
    html += `<div class="done">✅ 任务完成:测试发票与订单摘要已归档<br><span style="font-family:ui-monospace;font-size:11px">${esc(st.archive.dir)}</span><br>${st.archive.files.map((f) => `· ${esc(f.split('/').pop())}`).join(' ')}</div>`;
  }
  el.innerHTML = html;
  const pay = document.getElementById('pay');
  if (pay) pay.onclick = () => api('/api/pay').then(render);
  const invBtn = document.getElementById('inv');
  if (invBtn) invBtn.onclick = () => api('/api/confirm-invoice').then(render);
}

function renderTrace(st) {
  const el = document.getElementById('trace');
  el.innerHTML = st.trace.map((t) => `<div><span class="at">${t.at.slice(11, 19)}</span><span class="src ${t.source}">[${t.source}]</span>${esc(t.text)}</div>`).join('');
  const arc = document.getElementById('archive');
  arc.innerHTML = st.archive ? `<div class="done" style="margin-top:8px">📁 ${esc(st.archive.dir)}<br>${st.archive.files.map((f) => esc(f)).join('<br>')}</div>` : '';
  if (st.trace.length !== lastTraceLen) {
    lastTraceLen = st.trace.length;
    el.parentElement.scrollTop = el.parentElement.scrollHeight;
  }
}

let rendering = false;
async function render() {
  if (rendering) return;
  rendering = true;
  try {
    const st = await api('/api/state');
    renderPhase(st);
    renderUnderstand(st);
    renderPlan(st);
    renderOrder(st);
    renderTrace(st);
  } finally {
    rendering = false;
  }
}

document.getElementById('go').onclick = async () => {
  const raw = document.getElementById('need').value.trim();
  if (!raw) return;
  lastTraceLen = 0;
  await api('/api/need', { raw });
  render();
};
document.getElementById('reset').onclick = async () => {
  await api('/api/reset');
  lastTraceLen = 0;
  document.getElementById('plan').innerHTML = '<div class="card meta">等待任务…</div>';
  render();
};
document.getElementById('need').value = '帮我购买一套 200 元以内的实验室电子配件,优先选择支持单位电子发票的商家。下单后我来付款,随后帮我申请浙江大学抬头的电子发票,发送到指定邮箱,并保存到电脑的报销文件夹。';
render();
setInterval(render, 900);
