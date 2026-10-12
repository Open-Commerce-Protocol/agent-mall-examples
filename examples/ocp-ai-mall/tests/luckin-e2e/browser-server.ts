import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMockRuntime, ShoppingModelClient } from '../../packages/agent-runtime/src';
import { createHandler } from '../../apps/shopping-agent-api/src/server';
import { MallService } from '../../apps/shopping-agent-api/src/mall';
import { FixtureLuckinPort, LuckinLiveRead, LuckinMcpProbe, LuckinLiveCheckout } from '../../packages/luckin-adapter/src';
import { LuckinWorkflow, LuckinLiveWorkflow } from '../../packages/luckin-integration/src';
import { createLuckinHandler } from '../../apps/luckin-merchant-api/src/service';
import { startMcpFixture } from './mcp-fixture';

const root = resolve(import.meta.dir, '../..'); const directory = await mkdtemp(join(tmpdir(), 'ocp-mall-browser-'));
const mcp = startMcpFixture();
const reader = new LuckinLiveRead(new LuckinMcpProbe(async () => 'fixture-token', { endpoint: mcp.endpoint, fixture: true }));
const coordinator = await createMockRuntime(join(directory, 'agent'));
const model = new ShoppingModelClient({ apiKey: 'fixture-model-key', model: 'fixture-guide', baseUrl: 'https://model.invalid',
  fetch: (async (_url: unknown, _init?: RequestInit) => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'call_browser', type: 'function', function: { name: 'guide_shopping', arguments: JSON.stringify({ action: 'search', query: '拿铁', message: '我来找找' }) } }] } }] })) as typeof fetch });
let handler: (request: Request) => Promise<Response> = async () => new Response('starting', { status: 503 });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => handler(request) });
const origin = `http://127.0.0.1:${server.port}`;
const live = new LuckinLiveWorkflow(join(directory, 'live.sqlite'), new LuckinLiveCheckout(new LuckinMcpProbe(async () => 'fixture-token', { endpoint: mcp.endpoint, fixture: true })), 'synthetic-account');
handler = createHandler(coordinator, { allowedHost: new URL(origin).host, mall: new MallService(reader, undefined, live), model });
const upstream = new FixtureLuckinPort(join(directory, 'upstream.sqlite')); const workflow = new LuckinWorkflow(join(directory, 'workflow.sqlite'), upstream);
let fixtureHandler: (request: Request) => Promise<Response> = async () => new Response('starting');
const fixtureServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => fixtureHandler(request) });
const fixtureOrigin = `http://127.0.0.1:${fixtureServer.port}`;
fixtureHandler = createLuckinHandler({ origin: fixtureOrigin, session: 'browser-session', csrf: 'browser-csrf', fixture: { workflow, port: upstream },
  page: await readFile(join(root, 'apps/luckin-merchant-api/public/index.html'), 'utf8'), script: await readFile(join(root, 'apps/luckin-merchant-api/public/app.js'), 'utf8') });
console.log(JSON.stringify({ mall: origin, fixture: fixtureOrigin }));
const stop = async () => { server.stop(true); fixtureServer.stop(true); mcp.server.stop(true); await coordinator.waitForIdle(); live.close(); workflow.close(); upstream.close(); await rm(directory, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
// stdin EOF is portable graceful teardown from the parent browser runner.
void new Response(Bun.stdin.stream()).text().then(stop);
