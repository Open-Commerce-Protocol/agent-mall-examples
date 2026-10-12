/**
 * CampusNow e2e 验收 —— 对应 PRD 第 7 节验收清单。
 * 起服务 → 全流程驱动 → 异常测试 → 停服务。
 * 跑法:bun run e2e
 */
const ROOT = import.meta.dir.replace('/scripts', '');
const PORT = 4420;
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` —— ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

async function http(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function waitPhase(target: string[], timeoutMs = 20000): Promise<any> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = (await http('GET', '/api/state')).data;
    if (target.includes(st.phase)) return st;
    if (st.phase === 'FAILED') return st;
    await Bun.sleep(500);
  }
  return (await http('GET', '/api/state')).data;
}

async function main() {
  console.log('🧪 CampusNow e2e 验收(PRD §7)\n');
  // 清场:确保 4420 上没有残留服务(否则断言会打到真实模式服务器,造成真实下单!)
  Bun.spawnSync(['bash', '-c', 'lsof -ti:4420 | xargs kill -9 2>/dev/null'], { stdout: 'ignore', stderr: 'ignore' });
  await Bun.sleep(800);
  const server = Bun.spawn(['bun', 'run', 'src/server.ts'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CAMPUSNOW_ARCHIVE_ROOT: `${ROOT}/archive-test` },
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      try { up = (await fetch(`${BASE}/elec/ocp/health`)).ok; } catch { await Bun.sleep(200); }
    }
    if (!up) throw new Error('服务未就绪');

    // 0. 协议面独立校验(不经 Agent)
    console.log('—— 协议面 ——');
    const manifest = (await http('GET', '/elec/ocp/manifest')).data;
    ok('manifest 声明了两个 query pack', manifest.query_capabilities?.[0]?.query_packs?.length === 2);
    const ocpQ = await http('POST', '/elec/ocp/query', { query: '电子配件', query_pack: 'ocp.query.keyword.v1' });
    ok(`真实 OCP query 命中 ${ocpQ.data.result_count} 条(≥4)`, ocpQ.data.result_count >= 4);
    const ocpInv = await http('POST', '/elec/ocp/query', { query: '', query_pack: 'campus.query.filter.v1', filters: { invoice_supported: true, max_amount: 100, in_stock_only: true } });
    ok(`filter pack(含开票筛选)命中 ${ocpInv.data.result_count} 条,全部支持开票`, ocpInv.data.result_count >= 3 && ocpInv.data.entries.every((e: any) => e.entry.attributes.invoice_supported === true));
    const viewRes = await http('POST', '/elec/ocp/resolve', { entry_id: ocpQ.data.entries[0].entry.entry_id, purpose: 'view' });
    ok('resolve(view) → url 动作', viewRes.data.action_bindings?.[0]?.action_type === 'url');

    // 1. NL → task
    console.log('—— 阶段 A:采购 ——');
    await http('POST', '/api/need', { raw: '帮我购买一套 200 元以内的实验室电子配件,优先选择支持单位电子发票的商家。下单后我来付款,随后帮我申请浙江大学抬头的电子发票,发送到 lab-zjg@test.edu.cn' });
    let st = await waitPhase(['PLAN_AWAIT_CONFIRM']);
    ok('自然语言发起任务并理解(预算200/单位抬头/邮箱)', st.need?.budget === 200 && st.need?.invoice_title === '浙江大学' && st.need?.email === 'lab-zjg@test.edu.cn');
    ok(`方案 ${st.plan?.recommended?.length} 件,合计 ¥${st.plan?.total},全部支持开票`, (st.plan?.recommended ?? []).every((r: any) => r.item.invoice_supported));
    ok('方案在预算内', st.plan?.within_budget === true && st.plan!.total <= 200);
    const excluded = st.plan?.excluded ?? [];
    ok(`剔除项正确:${excluded.map((e: any) => e.title).join('/')}`, excluded.some((e: any) => e.reason.includes('缺货')) && excluded.some((e: any) => e.reason.includes('开票')) && excluded.some((e: any) => e.reason.includes('超预算')));

    // 2. confirm → order
    console.log('—— 阶段 B:交易 ——');
    await http('POST', '/api/confirm-plan');
    st = await waitPhase(['ORDER_AWAIT_PAY']);
    ok(`订单 ${st.order?.order_id} 已创建(待支付,模拟)`, !!st.order?.order_id && st.order.paid === false);
    const paid = await http('POST', '/api/pay');
    ok('模拟支付后订单 → 已支付(测试)', paid.data.order?.paid === true);

    // 3. invoice
    console.log('—— 阶段 C:开票 ——');
    await http('POST', '/api/confirm-invoice');
    st = await waitPhase(['ARCHIVED', 'FAILED'], 25000);
    ok(`开票申请提交并走完状态机(最终 ${st.phase})`, st.phase === 'ARCHIVED', st.error ?? '');
    ok('发票状态到达 emailed', st.invoice?.status === 'emailed');

    // 4. mail + archive
    console.log('—— 阶段 D:邮件与归档 ——');
    const mail = (await http('GET', '/api/mailbox')).data;
    ok(`测试邮箱收到发票邮件(附件:${mail[0]?.attachment?.filename ?? '无'})`, mail.length >= 1 && !!mail[0]?.attachment);
    const invId = st.invoice.invoice_id;
    const file = await fetch(`${BASE}/api/invoice/${invId}/file`);
    const html = await file.text();
    ok('发票文件可下载且显著标注为测试', html.includes('测试发票') && html.includes('非正式税务凭证') && html.includes(st.need.invoice_title));
    const arc = st.archive;
    ok(`本地归档存在 ${arc?.files?.length} 个文件`, !!arc && arc.files.length === 2, arc ? '' : 'archive 为空');
    if (arc) {
      for (const f of arc.files) {
        const disk = Bun.file(f);
        ok(`磁盘文件存在:${f.split('/').pop()}`, await disk.exists());
      }
      const summary = JSON.parse(await Bun.file(arc.files.find((f: string) => f.endsWith('order-summary.json'))!).text());
      ok('订单摘要关联发票与订单', summary.order_id === st.order.order_id && summary.invoice.id === invId);
    }

    // 5. 瑞幸场景:商家不提供开票接口 → 本地模拟开票回退
    console.log('—— 瑞幸场景:商家无开票接口 → 本地模拟开票回退 ——');
    await http('POST', '/api/need', { raw: '帮我买杯瑞幸咖啡,开浙江大学抬头的电子发票,发送到 luckin@test.edu.cn' });
    st = await waitPhase(['PLAN_AWAIT_CONFIRM']);
    ok('瑞幸任务理解(咖啡+单位抬头)', st.need?.item_query === '咖啡' && st.need?.invoice_title === '浙江大学');
    ok('检测到商家无开票接口,启用回退方案(invoice_fallback=true)', st.plan?.invoice_fallback === true && (st.plan?.recommended?.length ?? 0) >= 1);
    ok('回退方案选择瑞幸在售商品', (st.plan?.recommended ?? []).every((r: any) => r.catalog_id === 'cat_luckin_demo'));
    await http('POST', '/api/confirm-plan');
    st = await waitPhase(['ORDER_AWAIT_PAY']);
    ok(`瑞幸订单 ${st.order?.order_id} 创建`, !!st.order?.order_id && st.order.catalog_id === 'cat_luckin_demo');
    await http('POST', '/api/pay');
    await http('POST', '/api/confirm-invoice');
    st = await waitPhase(['ARCHIVED', 'FAILED'], 20000);
    ok(`本地模拟开票走完并归档(最终 ${st.phase})`, st.phase === 'ARCHIVED', st.error ?? '');
    const simId = st.invoice?.invoice_id ?? '';
    const simFile = await fetch(`${BASE}/api/invoice/${simId}/file`);
    const simHtml = await simFile.text();
    ok('模拟收据显著标注:本地模拟 / 非商家开具 / 非正式税务凭证', simHtml.includes('本地模拟收据') && simHtml.includes('非商家开具') && simHtml.includes('非正式税务凭证'));
    ok('模拟收据未伪装成商家发票(不含「商家开票服务」)', !simHtml.includes('商家开票服务(测试)'));
    const simArc = st.archive;
    ok(`模拟收据已归档 ${simArc?.files?.length} 个文件`, !!simArc && simArc.files.length === 2);

    // 6. 团购场景:6人/100预算/课题组报销/2人不喝咖啡/1人不喝冰 → 多方案 → CSV + 报销TODO
    console.log('—— 团购场景:瑞幸真实菜单 + 多方案 + CSV/报销TODO ——');
    await http('POST', '/api/need', { raw: '我今天有6个人,100预算,课题组报销,点瑞幸,两个人不喝咖啡,另外有一个人不喝冰的' });
    st = await waitPhase(['PLAN_AWAIT_CONFIRM', 'FAILED'], 30000);
    ok('团购 NLU:6人/预算100/2人不喝咖啡/1人不喝冰/用途课题组报销', st.need?.people_total === 6 && st.need?.budget === 100 && st.need?.non_coffee === 2 && st.need?.no_ice === 1 && st.need?.purpose === '课题组报销');
    const opts = st.plan?.group_options ?? [];
    ok(`生成 ${opts.length} 套方案(≥3),全部在预算内`, opts.length >= 3 && opts.every((o: any) => o.total <= 100));
    ok('每套方案满足约束:4杯咖啡+2杯非咖啡替代', opts.every((o: any) => {
      const coffees = o.lines.filter((l: any) => !l.noncoffee).reduce((s: number, l: any) => s + l.qty, 0);
      const noncf = o.lines.filter((l: any) => l.noncoffee).reduce((s: number, l: any) => s + l.qty, 0);
      return coffees === 4 && noncf === 2;
    }));
    ok('每套方案恰有 1 杯标记热饮(不喝冰的成员)', opts.every((o: any) => o.lines.filter((l: any) => l.hot).reduce((s: number, l: any) => s + l.qty, 0) === 1));
    const optB = opts.find((o: any) => o.id === 'B');
    await http('POST', '/api/choose-plan', { option_id: 'B' });
    st = (await http('GET', '/api/state')).data;
    ok(`选择方案 B(人气款 ¥${optB?.total})后 plan 同步`, Math.abs((st.plan?.total ?? 0) - (optB?.total ?? 0)) < 0.01 && st.plan?.group_options === null);
    await http('POST', '/api/confirm-plan');
    st = await waitPhase(['ORDER_AWAIT_PAY']);
    const cups = (st.order?.lines ?? []).reduce((s: number, l: any) => s + (l.qty ?? 1), 0);
    ok(`团购模拟订单 ${st.order?.order_id}:共 ${cups} 杯,¥${st.order?.total} ≤ 100`, cups === 6 && st.order.total <= 100);
    await http('POST', '/api/pay');
    await http('POST', '/api/confirm-invoice');
    st = await waitPhase(['ARCHIVED', 'FAILED'], 25000);
    ok(`本地模拟开票(SIMINV)并归档(最终 ${st.phase})`, st.phase === 'ARCHIVED' && /^SIMINV-/.test(st.invoice?.invoice_id ?? ''), st.error ?? '');
    const gInv = await fetch(`${BASE}/api/invoice/${st.invoice.invoice_id}/file`);
    const gHtml = await gInv.text();
    ok('模拟收据含用途「课题组报销」与人数信息', gHtml.includes('课题组报销'));
    const gArc = st.archive;
    ok(`归档 ${gArc?.files?.length} 个文件(发票+摘要+CSV+报销TODO)`, (gArc?.files?.length ?? 0) === 4);
    if (gArc?.files?.length === 4) {
      const csvPath = gArc.files.find((f: string) => f.endsWith('order.csv'))!;
      const csvBytes = await Bun.file(csvPath).bytes();
      const csv = new TextDecoder('utf-8').decode(csvBytes);
      const totalRow = csv.split('\r\n').find((r: string) => r.includes('合计')) ?? '';
      ok('CSV 带 BOM、含用途与合计行、合计杯数为 6', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csv.includes('课题组报销') && totalRow.includes('"6"'));
      const todoPath = gArc.files.find((f: string) => f.includes('报销TODO'))!;
      const todoTxt = await Bun.file(todoPath).text();
      ok('报销TODO 含勾选框、用途、文件清单', todoTxt.includes('- [ ]') && todoTxt.includes('课题组报销') && todoTxt.includes('order.csv'));
    }

    // 7. 异常测试
    console.log('—— 异常测试 ——');
    const dup = await http('POST', '/elec/shop/invoice', { order_id: st.order.order_id, title_type: 'organization', title: '浙江大学', tax_id: 'TEST', email: 'a@b.c' });
    ok(`重复开票被拒(HTTP ${dup.status})`, dup.status === 409);
    const noTax = await http('POST', '/elec/shop/invoice', { order_id: 'CN00000000', title_type: 'organization', title: '浙江大学', email: 'a@b.c' });
    ok(`未知订单开票被拒(HTTP ${noTax.status})`, noTax.status === 404);
    const oos = await http('POST', '/elec/shop/order', { confirmation: true, lines: [{ object_id: 'e-006', title: '蓝牙模块 HC-05', amount: 18 }] });
    ok(`缺货商品下单被拒(HTTP ${oos.status}:${oos.data.error?.message ?? ''})`, oos.status === 409);
    const badPack = await http('POST', '/elec/ocp/query', { query: 'x', query_pack: 'no.such.pack' });
    ok(`未声明 pack → 400(HTTP ${badPack.status})`, badPack.status === 400);
    const unconfirm = await http('POST', '/elec/shop/order', { lines: [{ object_id: 'e-001', title: 'x', amount: 1 }] });
    ok(`无用户确认下单 → 400(HTTP ${unconfirm.status})`, unconfirm.status === 400);
  } finally {
    server.kill();
    await Bun.sleep(200);
  }
  console.log('\n────────────────────────');
  console.log(`断言:${pass} 通过,${fail} 失败`);
  if (fail === 0) console.log('✅ PRD 验收清单全部通过(含异常测试)');
  else failures.forEach((f) => console.log(`   ${f}`));
  process.exit(fail === 0 ? 0 : 1);
}

main();
