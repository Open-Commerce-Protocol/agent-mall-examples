import { afterEach, expect, test } from 'bun:test';
import { FixtureLuckinPort, LuckinLiveRead, LuckinMcpProbe } from '../../packages/luckin-adapter/src';
import { LuckinWorkflow, trustedLuckinWorkflow } from '../../packages/luckin-integration/src';
import { catalogManifestSchema, catalogQueryResultSchema, catalogHealthResponseSchema, resolvableReferenceSchema } from '../../packages/ocp-schema/src';
import { createLuckinHandler } from '../../apps/luckin-merchant-api/src/service';
import { startMcpFixture } from './mcp-fixture';

const origin = 'http://127.0.0.1:8790';
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(close => close()));
function setup(live = false) {
  const port = new FixtureLuckinPort(); const workflow = new LuckinWorkflow(':memory:', port);
  const mcp = startMcpFixture(); cleanups.push(() => { workflow.close(); port.close(); mcp.server.stop(true); });
  const reader = new LuckinLiveRead(new LuckinMcpProbe(async () => 'test-token', { endpoint: mcp.endpoint, fixture: true }));
  const handle = createLuckinHandler({ origin, session: 'test-session', csrf: 'test-csrf', page: '<html>test</html>', script: '',
    ...(live ? { live: reader } : { fixture: { port, workflow } }) });
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => handle(new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie: 'luckin_session=test-session', origin, 'x-luckin-csrf': 'test-csrf', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { request, handle, port, mcp };
}
test('fixture OCP manifest/query/resolve/contracts and discovery match schemas', async () => {
  const { request } = setup(); const base = '/stores/fixture-east';
  const discovery = await (await request(`${base}/.well-known/ocp-catalog`)).json(); expect(discovery.catalog_id).toBe('luckin:fixture-east');
  expect(catalogManifestSchema.parse(await (await request(`${base}/ocp/manifest`)).json()).registry_visibility).toBe('private');
  expect(catalogHealthResponseSchema.parse(await (await request(`${base}/ocp/health`)).json()).ready).toBe(true);
  expect(await (await request(`${base}/ocp/contracts`)).json()).toHaveLength(1);
  const result = catalogQueryResultSchema.parse(await (await request(`${base}/ocp/query`, { query: '' })).json());
  expect(result.entries).toHaveLength(3); expect(result.entries.find(entry => entry.entry.entry_id === 'fixture-unknown-price')!.entry.attributes.price).toBeUndefined();
  const reference = resolvableReferenceSchema.parse(await (await request(`${base}/ocp/resolve`, { entry_id: 'fixture-latte', purpose: 'checkout' })).json());
  const binding = reference.action_bindings[0]!; expect(trustedLuckinWorkflow(binding, origin)).toBe(`${origin}/luckin/v1/confirm`);
  for (const change of [{ action_id: 'arbitrary' }, { action_type: 'api' as const }, { requires_user_confirmation: false }, { expires_at: new Date(0).toISOString() }, { entrypoint: { url: 'https://evil.invalid', method: 'POST' as const } }]) {
    expect(() => trustedLuckinWorkflow({ ...binding, ...change }, origin)).toThrow('untrusted_workflow');
  }
  expect((await request(`${base}/ocp/query`, { filters: { max_amount: 12 } })).status).toBe(400);
  expect((await request(`${base}/ocp/query`, { filters: { store_id: 'wrong' } })).status).toBe(400);
  expect((await request(`${base}/ocp/resolve`, { catalog_id: 'wrong', entry_id: 'fixture-latte' })).status).toBe(400);
});
test('HTTP requires backend session and CSRF, ignoring forged demo identity', async () => {
  const { request, port } = setup();
  expect((await request('/luckin/v1/stores', undefined, { cookie: '', 'x-dev-caller-id': 'admin' })).status).toBe(401);
  expect((await request('/luckin/v1/confirm', {}, { origin: 'https://evil.invalid' })).status).toBe(403);
  expect((await request('/luckin/v1/confirm', {}, { 'x-luckin-csrf': '' })).status).toBe(403);
  expect((await request('/luckin/v1/confirm', { confirmed: false })).status).toBe(400); expect(port.createCalls).toBe(0);
});
test('live routes project authenticated read data and never offer write bindings', async () => {
  const { request, mcp } = setup(true);
  expect((await request('/live/stores/1/ocp/query', { query: '拿铁' })).status).toBe(400);
  await request('/luckin/v1/locations', { longitude: 0, latitude: 0 });
  expect(catalogManifestSchema.parse(await (await request('/live/stores/1/ocp/manifest')).json()).query_capabilities[0]!.filterable_field_refs).toEqual([]);
  const result = catalogQueryResultSchema.parse(await (await request('/live/stores/1/ocp/query', { query: '拿铁' })).json());
  expect(result.page.has_more).toBe(false); expect(result.entries[0]!.entry.attributes.price_semantics).toBe('estimate');
  expect(result.entries[0]!.entry.attributes.inventory).toEqual({ availability_status: 'unknown' });
  const reference = resolvableReferenceSchema.parse(await (await request('/live/stores/1/ocp/resolve', { entry_id: '101', purpose: 'view' })).json());
  expect(reference.action_bindings).toEqual([]);
  expect((await request('/live/stores/1/ocp/resolve', { entry_id: '101', purpose: 'checkout' })).status).toBe(409);
  for (const path of ['quotes', 'confirm', 'attempts/test/fixture-advance']) expect((await request(`/luckin/v1/${path}`, {})).status).toBe(409);
  expect(mcp.calls.filter(call => call.method === 'tools/call').map(call => call.params.name)).toEqual(['queryShopList', 'searchProductForMcp', 'queryProductDetailInfo']);
});
