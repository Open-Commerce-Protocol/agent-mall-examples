import { afterEach, expect, test } from 'bun:test';
import { LuckinMcpProbe, type LuckinReadTool } from '../../packages/luckin-adapter/src/probe';
import { LuckinLiveRead } from '../../packages/luckin-adapter/src/live-read';
import { startMcpFixture } from './mcp-fixture';
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(close => close()); });
function setup(timeoutMs = 1000) {
  const mock = startMcpFixture(); cleanups.push(() => mock.server.stop(true));
  const probe = new LuckinMcpProbe(async () => 'synthetic-token', { endpoint: mock.endpoint, fixture: true, timeoutMs });
  return { ...mock, probe };
}
test('initialize, initialized notification and authenticated paged tools/list; inspect never calls a tool', async () => {
  const env = setup(); const result = await env.probe.inspect();
  expect(result.tools).toHaveLength(8);
  expect(env.calls.map(call => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
  expect(env.calls[2]!.headers.get('mcp-session-id')).toBe('fixture-session');
  expect(env.calls[2]!.headers.get('mcp-protocol-version')).toBe('2025-06-18');
  expect(env.calls.every(call => call.headers.get('authorization') === 'Bearer synthetic-token')).toBe(true);
});
test('SSE supported; read data normalized without private tags or invented availability', async () => {
  const env = setup(); env.behavior.sse = true; const reader = new LuckinLiveRead(env.probe);
  const stores = await reader.stores(0, 0); expect(stores[0]!.store_id).toBe('1'); expect(JSON.stringify(stores)).not.toContain('private-personal-tag');
  const products = await reader.search('1', '拿铁'); expect(products[0]!.estimate_minor).toBe(1090); expect(products[0]!.reference_minor).toBe(2500);
  expect(products[0]!.price_semantics).toBe('estimate');
  expect((await reader.detail('1', '101')).options[0]!.values[0]!.selected).toBe(true);
});
test.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'session_expired'], [429, 'rate_limited'], [500, 'transport']] as const)('HTTP %i is sanitized and classified', async (status, code) => {
  const env = setup(); env.behavior.status = status;
  await expect(env.probe.inspect()).rejects.toThrow(`MCP probe: ${code}`);
});
test('schema drift, write tools, invalid coordinates and text errors fail closed', async () => {
  const env = setup(); env.behavior.drift = true;
  await expect(env.probe.read('queryShopList', { longitude: 0, latitude: 0 })).rejects.toThrow('protocol');
  expect(env.calls.some(call => call.method === 'tools/call')).toBe(false);
  await expect(env.probe.read('createOrder' as LuckinReadTool, {})).rejects.toThrow('protocol');
  await expect(env.probe.read('queryShopList', { longitude: 200, latitude: 0 })).rejects.toThrow();
  env.behavior.drift = false; env.behavior.textError = true;
  await expect(env.probe.read('queryShopList', { longitude: 0, latitude: 0 })).rejects.toThrow('protocol');
});
test('business error envelopes are not treated as successful data', async () => {
  const env = setup(); env.behavior.businessError = true;
  await expect(new LuckinLiveRead(env.probe).stores(0, 0)).rejects.toThrow('failed validation');
});
test('wrong response ID and repeated cursor are rejected', async () => {
  const env = setup(); env.behavior.wrongId = true; await expect(env.probe.inspect()).rejects.toThrow('protocol');
  env.behavior.wrongId = false; env.behavior.cyclicCursor = true; await expect(env.probe.inspect()).rejects.toThrow('protocol');
});
test('timeout does not retry and redirects cannot receive authorization', async () => {
  const env = setup(10); env.behavior.delay = 100;
  await expect(env.probe.inspect()).rejects.toThrow('transport'); expect(env.calls).toHaveLength(1);
  let targetCalls = 0;
  const target = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { targetCalls++; return Response.json({}); } }); cleanups.push(() => target.stop(true));
  const redirect = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.redirect(`http://127.0.0.1:${target.port}`); } }); cleanups.push(() => redirect.stop(true));
  const probe = new LuckinMcpProbe(async () => 'synthetic-token', { endpoint: `http://127.0.0.1:${redirect.port}`, fixture: true });
  await expect(probe.inspect()).rejects.toThrow('transport'); expect(targetCalls).toBe(0);
});
test('arbitrary remote MCP endpoint is not trusted', () => {
  expect(() => new LuckinMcpProbe(async () => 'token', { endpoint: 'https://example.com/mcp' })).toThrow('untrusted');
});
