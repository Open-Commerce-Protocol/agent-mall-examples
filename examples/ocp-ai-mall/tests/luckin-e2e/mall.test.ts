import { afterEach, expect, test } from 'bun:test';
import { MallService, FixedMallLocation } from '../../apps/shopping-agent-api/src/mall';
import { LuckinLiveRead, LuckinMcpProbe } from '../../packages/luckin-adapter/src';
import { ShoppingModelClient } from '../../packages/agent-runtime/src';
import { startMcpFixture } from './mcp-fixture';
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(close => close()));
function setup() {
  const mcp = startMcpFixture(); cleanups.push(() => mcp.server.stop(true));
  const reader = new LuckinLiveRead(new LuckinMcpProbe(async () => 'synthetic-token', { endpoint: mcp.endpoint, fixture: true }));
  const mall = new MallService(reader);
  return { mcp, mall };
}
function model(argumentsValue: unknown) {
  let prompt = '';
  const client = new ShoppingModelClient({ apiKey: 'synthetic-model-key', model: 'test-model', baseUrl: 'https://model.example',
    fetch: (async (_url: unknown, init?: RequestInit) => {
      prompt = String(init?.body);
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_test', type: 'function',
        function: { name: 'guide_shopping', arguments: JSON.stringify(argumentsValue) } }] } }] });
    }) as typeof fetch,
  });
  return { client, get prompt() { return prompt; } };
}
test('fixed location is used server-side; browser input cannot override it', async () => {
  const { mall, mcp } = setup(); const configuration = await mall.bootstrap();
  expect(configuration.location).toEqual(await new FixedMallLocation().getLocation());
  expect(configuration.automatic_location_available).toBe(false); expect(configuration.checkout_enabled).toBe(false);
  await mall.stores();
  expect(mcp.calls.find(call => call.params.name === 'queryShopList')!.params.arguments).toEqual({ longitude: 120.15, latitude: 30.25 });
  await expect(mall.chat('user', { merchant_id: 'luckin', store_id: '1', message: '拿铁', latitude: 0 })).rejects.toThrow();
});
test('AI plan uses OCP-backed merchant search, retains verified price semantics and context', async () => {
  const { mall, mcp } = setup(); await mall.stores();
  const firstModel = model({ action: 'search', query: '拿铁', message: '帮你找找' });
  const first = await mall.chat('user', { merchant_id: 'luckin', store_id: '1', message: '想喝拿铁' }, firstModel.client);
  expect(first.source).toBe('model'); expect(first.products[0]!.estimate_minor).toBe(1090);
  expect(firstModel.prompt).not.toContain('synthetic-token'); expect(firstModel.prompt).not.toContain('120.15');
  const secondModel = model({ action: 'reply', query: '', message: '当前候选预估 10.90 元，最终金额需要订单预览核对。' });
  const second = await mall.chat('user', { merchant_id: 'luckin', store_id: '1', message: '刚才那款多少钱？', conversation_id: first.conversation_id }, secondModel.client);
  expect(second.products).toEqual([]); expect(secondModel.prompt).toContain('1090');
  expect(mcp.calls.filter(call => call.method === 'tools/call').map(call => call.params.name)).toEqual(['queryShopList', 'searchProductForMcp']);
});
test('unconfigured model is explicitly direct search; sessions and merchant IDs are checked', async () => {
  const { mall } = setup(); await mall.stores();
  const first = await mall.chat('a', { merchant_id: 'luckin', store_id: '1', message: '拿铁' });
  expect(first.source).toBe('search');
  await expect(mall.chat('b', { merchant_id: 'luckin', store_id: '1', message: '拿铁', conversation_id: first.conversation_id })).rejects.toThrow('对话已过期');
  await expect(mall.chat('a', { merchant_id: 'other', store_id: '1', message: 'test' })).rejects.toThrow();
  await expect(mall.chat('a', { merchant_id: 'luckin', store_id: '999', message: 'test' })).rejects.toThrow('附近门店');
});
test('malformed model actions cannot reach an upstream write tool', async () => {
  const { mall, mcp } = setup(); await mall.stores();
  await expect(mall.chat('a', { merchant_id: 'luckin', store_id: '1', message: '立即购买' }, model({ action: 'createOrder', query: 'coffee', message: 'paid' }).client)).rejects.toThrow('返回格式无效');
  expect(mcp.calls.filter(call => call.method === 'tools/call')).toHaveLength(1);
});
