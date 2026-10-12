/**
 * 入口验收：直接加载 src/start.ts。
 *
 * 为什么需要它：其它验收脚本都直接调 startWeb()，所以**真正的入口文件坏了也测不出来**——
 * 曾经就把 registry 的导出改了却没同步 start.ts，直到启动时才炸。
 * 这个脚本专门堵这个盲区。
 *
 * 用独立端口，避免和正在跑的站点抢 8080。
 */
process.env.ORDER_HUB_PORT = '8099';
process.env.ORDER_HUB_HOST = '127.0.0.1';
/* 刻意不设置 CHAT_LLM_PROVIDER：入口验收必须对"有没有配模型"都成立，
   也避免默认用上任何人的账户额度。 */

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44, ' ')} ${detail}`);
};

console.log('\n入口验收（src/start.ts，端口 8099）');
console.log('-'.repeat(96));

/* 1. 入口能加载——导入期的任何错误（漏改导出名、坏导入）都会在这里现形。 */
try {
  await import('../src/start.ts');
  record('src/start.ts 加载成功', true, '导入期无错误');
} catch (error) {
  record('src/start.ts 加载成功', false, String((error as Error).message).slice(0, 90));
  console.log('-'.repeat(96));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} 通过`);
  process.exit(1);
}

/* 2. 端口真的绑上了，且 API 可用。 */
try {
  const health = await (await fetch('http://127.0.0.1:8099/api/health', { signal: AbortSignal.timeout(15_000) })).json();
  record('入口进程对外服务正常', health.status === 'healthy', `status=${health.status} 品牌=${health.brands}`);
} catch (error) {
  record('入口进程对外服务正常', false, String((error as Error).message).slice(0, 90));
}

/* 3. 首页与新增的接入路由都在。 */
const home = await fetch('http://127.0.0.1:8099/');
const html = await home.text();
record('首页可访问且含大肥鱼界面', home.status === 200 && html.includes('大肥鱼'), `${home.status} ${html.length} 字节`);
const onboard = await fetch('http://127.0.0.1:8099/api/onboard/save', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ spec: { id: 'BAD ID', mcpUrl: 'https://x.com' } }),
});
record('接入路由已挂载并做校验', onboard.status === 400, `${onboard.status}`);

const failed = results.filter((r) => !r.ok);
console.log('-'.repeat(96));
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
setTimeout(() => process.exit(failed.length === 0 ? 0 : 1), 120);
