import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LuckinLiveCheckout, LuckinLiveRead, LuckinMcpProbe, paymentUrl } from '../../packages/luckin-adapter/src';
import { LuckinLiveWorkflow } from '../../packages/luckin-integration/src';
import { MallService } from '../../apps/shopping-agent-api/src/mall';
import { createHandler } from '../../apps/shopping-agent-api/src/server';
import { createMockRuntime } from '../../packages/agent-runtime/src';
import { startMcpFixture } from './mcp-fixture';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));
function setup() {
  const mcp = startMcpFixture(); cleanup.push(() => mcp.server.stop(true));
  const probe = new LuckinMcpProbe(async () => 'synthetic-token', { fixture: true, endpoint: mcp.endpoint });
  const adapter = new LuckinLiveCheckout(probe);
  const directory = mkdtempSync(join(tmpdir(), 'luckin-live-tests-'));
  let clock = Date.now();
  const workflow = new LuckinLiveWorkflow(join(directory, 'live.sqlite'), adapter, 'account-a', () => clock); cleanup.push(() => workflow.close());
  const mall = new MallService(new LuckinLiveRead(probe), undefined, workflow);
  const writes = () => mcp.calls.filter(call => call.params.name === 'createOrder');
  const prepare = async () => { await mall.stores(); const selection = await mall.detail({ store_id: '1', product_id: '101' }, 'owner');
    return mall.preview('owner', { selection_id: selection.selection_id, quantity: 1 }); };
  return { mcp, mall, adapter, workflow, directory, writes, prepare, advance: () => { clock += 121_000; } };
}
test('real transport selection → preview → confirm → QR → status, with server-owned SKU/coupons/location', async () => {
  const env = setup(); await env.mall.stores();
  expect((await env.mall.bootstrap()).checkout_enabled).toBe(true);
  const selection = await env.mall.detail({ store_id: '1', product_id: '101' }, 'owner');
  const switched = await env.mall.switch('owner', { selection_id: selection.selection_id, option_id: '17', value_id: '57' });
  expect(switched.product.sku_id).toBe('TEST-ICE');
  const quote = await env.mall.preview('owner', { selection_id: switched.selection_id, quantity: 2, remark: '谢谢' });
  expect(quote.total_minor).toBe(2180); expect(JSON.stringify(quote)).not.toContain('private-coupon'); expect(env.writes()).toHaveLength(0);
  const result = await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true });
  expect(result.state).toBe('created'); expect(result.order!.order_id).toBe('7639308439653908490'); expect(result.payment_qr_data).toStartWith('data:image/png;base64,');
  expect(env.writes()[0]!.params.arguments).toEqual({ deptId: 1, productList: [{ productId: 101, skuCode: 'TEST-ICE', amount: 2 }],
    longitude: 120.15, latitude: 30.25, couponCodeList: ['private-coupon'], remark: '谢谢' });
  env.mcp.behavior.orderStatus = 60;
  const updated = await env.mall.refresh('owner', { attempt_id: result.attempt_id });
  expect(updated.order!.pickup_code).toBe('TEST-001'); expect(updated.payment_qr_data).toBeUndefined();
});
test('confirmation is explicit and request cannot inject prices, SKU or coupon codes', async () => {
  const env = setup(); const quote = await env.prepare();
  await expect(env.mall.confirm('owner', { quote_id: quote.quote_id })).rejects.toThrow();
  await expect(env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true, total_minor: 0 })).rejects.toThrow();
  await expect(env.mall.confirm('other', { quote_id: quote.quote_id, confirmed: true })).rejects.toThrow();
  await expect(env.mall.preview('other', { selection_id: crypto.randomUUID(), quantity: 1, skuCode: 'evil' })).rejects.toThrow();
  expect(env.writes()).toHaveLength(0);
});
test('changed price and expired preview never dispatch create', async () => {
  const env = setup(); const quote = await env.prepare(); env.mcp.behavior.price = 11.9;
  await expect(env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true })).rejects.toThrow('变化');
  const next = await env.prepare(); env.advance();
  await expect(env.mall.confirm('owner', { quote_id: next.quote_id, confirmed: true })).rejects.toThrow('失效');
  expect(env.writes()).toHaveLength(0);
});
test('repeated or concurrent confirmation dispatches at most once, and order survives restart', async () => {
  const env = setup(); const quote = await env.prepare(); env.mcp.behavior.createDelay = 30;
  const responses = await Promise.allSettled([env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true }), env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true })]);
  expect(responses.some(row => row.status === 'fulfilled')).toBe(true);
  const again = await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true });
  expect(again.order!.order_id).toBe('7639308439653908490'); expect(env.writes()).toHaveLength(1);
  const restarted = new LuckinLiveWorkflow(join(env.directory, 'live.sqlite'), env.adapter, 'account-a'); cleanup.push(() => restarted.close());
  expect(restarted.list('owner')[0]!.order!.order_id).toBe(again.order!.order_id);
  await restarted.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, true); expect(env.writes()).toHaveLength(1);
  expect(restarted.list('other')).toEqual([]);
});
test('ambiguous send blocks further attempts even from a new browser identity or after restart', async () => {
  const env = setup(); const quote = await env.prepare(); env.mcp.behavior.createError = true;
  expect((await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true })).state).toBe('unknown');
  await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true }); expect(env.writes()).toHaveLength(1);
  const restarted = new LuckinLiveWorkflow(join(env.directory, 'live.sqlite'), env.adapter, 'account-a'); cleanup.push(() => restarted.close());
  await expect(restarted.quote('new-cookie', { deptId: 1, productList: [{ productId: 101, skuCode: 'TEST-SKU', amount: 1 }] }, '')).rejects.toThrow('暂停新订单');
});
test('numeric order ID without a safe representation remains unknown, never truncates an ID', async () => {
  const env = setup(); const quote = await env.prepare(); env.mcp.behavior.unsafeOrderId = true;
  expect((await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true })).state).toBe('unknown');
});
test('new selection invalidates old preview and mismatched upstream store is rejected', async () => {
  const env = setup(); const quote = await env.prepare(); await env.mall.detail({ store_id: '1', product_id: '101' }, 'owner');
  await expect(env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true })).rejects.toThrow('失效');
  env.mcp.behavior.previewMismatch = true; await expect(env.prepare()).rejects.toThrow('mismatch'); expect(env.writes()).toHaveLength(0);
});
test('credential changes cannot query or repeat prior account orders', async () => {
  const env = setup(); const quote = await env.prepare(); const created = await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true });
  const other = new LuckinLiveWorkflow(join(env.directory, 'live.sqlite'), env.adapter, 'account-b'); cleanup.push(() => other.close());
  expect(other.list('owner')).toEqual([]);
  await expect(other.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, true)).rejects.toThrow('授权');
  await expect(other.refresh('owner', created.attempt_id)).rejects.toThrow('不存在');
});
test('invalid payment destinations cannot become QR codes or links', () => {
  for (const value of ['javascript:alert(1)', 'https://lkcoffee.com.evil.example/pay', 'https://evil.example/pay', 'https://user@open.lkcoffee.com/pay', 'http://open.lkcoffee.com/pay']) expect(paymentUrl(value)).toBeUndefined();
  expect(paymentUrl('weixin://wxpay/bizpayurl?pr=ok')).toBeDefined();
  expect(paymentUrl('https://open.lkcoffee.com/transfer/qrcode?token=ok', true)).toBeDefined();
});
test('sweetness changes retain temperature and preview includes both selections', async () => {
  const env = setup(); await env.mall.stores();
  const original = await env.mall.detail({ store_id: '1', product_id: '101' }, 'owner');
  const ice = await env.mall.switch('owner', { selection_id: original.selection_id, option_id: '17', value_id: '57' });
  const less = await env.mall.switch('owner', { selection_id: ice.selection_id, option_id: '18', value_id: '112' });
  const quote = await env.mall.preview('owner', { selection_id: less.selection_id, quantity: 1 });
  expect(less.product.sku_id).toBe('TEST-ICE-LESS'); expect(quote.products[0]!.specs).toBe('大杯/冰/少甜');
  await expect(env.mall.switch('owner', { selection_id: less.selection_id, option_id: '18', value_id: '999' })).rejects.toThrow();
  await expect(env.mall.switch('another-owner', { selection_id: less.selection_id, option_id: '18', value_id: '69' })).rejects.toThrow();
  expect(env.writes()).toHaveLength(0);
});
test('two server instances sharing a ledger dispatch the same quote only once', async () => {
  const env = setup(); const quote = await env.prepare(); env.mcp.behavior.createDelay = 30;
  const second = new LuckinLiveWorkflow(join(env.directory, 'live.sqlite'), env.adapter, 'account-a'); cleanup.push(() => second.close());
  await Promise.allSettled([env.workflow.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, true), second.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, true)]);
  expect(env.writes()).toHaveLength(1);
});
test('disabled new orders preserve existing order retrieval and mismatched query cannot overwrite an order', async () => {
  const env = setup(); const quote = await env.prepare();
  await expect(env.workflow.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, false)).rejects.toThrow('暂停');
  expect(env.writes()).toHaveLength(0);
  const result = await env.mall.confirm('owner', { quote_id: quote.quote_id, confirmed: true });
  env.mcp.behavior.orderMismatch = true;
  await expect(env.mall.refresh('owner', { attempt_id: result.attempt_id })).rejects.toThrow('mismatch');
  expect((await env.mall.orders('owner')).orders[0]!.order!.order_id).toBe(result.order!.order_id);
  await env.workflow.confirm('owner', quote.quote_id, { longitude: 0, latitude: 0 }, false); expect(env.writes()).toHaveLength(1);
});
test('HTTP routes enforce origin/owner/explicit confirmation and return a scan-ready PNG', async () => {
  const env = setup(); const runtime = await createMockRuntime(join(env.directory, 'mock'));
  const handler = createHandler(runtime, { mall: env.mall, allowedHost: '127.0.0.1:4310' });
  const base = 'http://127.0.0.1:4310';
  const boot = await handler(new Request(base + '/api/mall/bootstrap')); const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
  const request = (path: string, body?: unknown, origin = base) => handler(new Request(base + path, { method: body ? 'POST' : 'GET', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  await request('/api/mall/stores');
  const selection = await (await request('/api/mall/detail', { store_id: '1', product_id: '101' })).json();
  const quote = await (await request('/api/mall/preview', { selection_id: selection.selection_id, quantity: 1 })).json();
  expect((await request('/api/mall/confirm', { quote_id: quote.quote_id, confirmed: true }, 'https://evil.example')).status).toBe(403);
  expect(env.writes()).toHaveLength(0);
  const result = await (await request('/api/mall/confirm', { quote_id: quote.quote_id, confirmed: true })).json();
  expect(result.payment_qr_data).toStartWith('data:image/png;base64,');
  const orders = await (await request('/api/mall/orders')).json(); expect(orders.orders).toHaveLength(1);
  expect(JSON.stringify(orders)).not.toContain('private-coupon'); expect(JSON.stringify(orders)).not.toContain('synthetic-token');
});
