import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { FixtureLuckinPort, type LuckinLiveRead } from '@ocp-catalog/luckin-adapter';
import { LuckinCatalog, LuckinLiveCatalog, LuckinFlowError, LuckinWorkflow, LUCKIN_CONTRACT, trustedLuckinWorkflow } from '@ocp-catalog/luckin-integration';
import type { LuckinScope } from '@ocp-catalog/shopping-contracts';

const fixtureScope: LuckinScope = { owner_id: 'local-user', account_id: 'fixture-account', environment: 'fixture' };
export function createLuckinHandler(options: {
  origin: string; session: string; csrf: string; page: string; script: string;
  fixture?: { workflow: LuckinWorkflow; port: FixtureLuckinPort }; live?: LuckinLiveRead;
}) {
  if (Boolean(options.fixture) === Boolean(options.live)) throw new Error('choose exactly one mode');
  const catalog = options.fixture ? new LuckinCatalog(options.fixture.port, options.origin) : undefined;
  const live = options.live ? new LuckinLiveCatalog(options.live, options.origin) : undefined;
  const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  const readBody = async (request: Request) => {
    const raw = await request.text();
    if (raw.length > 32_000) throw new LuckinFlowError('request_too_large', 413);
    try { return JSON.parse(raw) as unknown; } catch { throw new LuckinFlowError('invalid_json', 400); }
  };
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.origin !== options.origin || (request.headers.get('host') && request.headers.get('host') !== url.host)) return json({ error: 'untrusted_host' }, 403);
      if (request.headers.get('origin') && request.headers.get('origin') !== options.origin) return json({ error: 'untrusted_origin' }, 403);
      if (request.method === 'GET' && url.pathname === '/') return new Response(options.page, { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'set-cookie': `luckin_session=${options.session}; HttpOnly; SameSite=Strict; Path=/`,
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      } });
      if (request.method === 'GET' && url.pathname === '/app.js') return new Response(options.script, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
      const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith('luckin_session='))?.slice('luckin_session='.length) ?? '';
      if (!same(cookie, options.session)) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'POST' && (request.headers.get('origin') !== options.origin || !same(request.headers.get('x-luckin-csrf') ?? '', options.csrf))) return json({ error: 'csrf_rejected' }, 403);
      if (request.method === 'GET' && url.pathname === '/luckin/v1/bootstrap') return json({ mode: live ? 'readonly' : 'fixture', csrf: options.csrf, real_orders_enabled: false });
      if (request.method === 'GET' && url.pathname === '/luckin/v1/stores' && options.fixture) return json(await options.fixture.port.stores(fixtureScope));
      if (request.method === 'POST' && url.pathname === '/luckin/v1/locations' && live) {
        const input = z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) }).strict().parse(await readBody(request));
        return json(await live.locations(input.longitude, input.latitude));
      }
      const storeRoute = url.pathname.match(/^\/(live\/)?stores\/([^/]+)\/ocp\/(manifest|query|resolve|health|contracts)$/);
      if (storeRoute) {
        const storeId = decodeURIComponent(storeRoute[2]!); const action = storeRoute[3];
        if (storeRoute[1] && live) {
          if (request.method === 'GET' && action === 'manifest') return json(live.manifest(storeId));
          if (request.method === 'GET' && action === 'health') return json(live.health(storeId));
          if (request.method === 'GET' && action === 'contracts') return json(live.manifest(storeId).object_contracts);
          if (request.method === 'POST' && action === 'query') return json(await live.query(storeId, await readBody(request)));
          if (request.method === 'POST' && action === 'resolve') return json(await live.resolve(storeId, await readBody(request)));
        } else if (!storeRoute[1] && catalog) {
          await catalog.products(fixtureScope, storeId);
          if (request.method === 'GET' && action === 'manifest') return json(catalog.manifest(storeId));
          if (request.method === 'GET' && action === 'health') return json(catalog.health(storeId));
          if (request.method === 'GET' && action === 'contracts') return json([LUCKIN_CONTRACT]);
          if (request.method === 'POST' && action === 'query') return json(await catalog.query(fixtureScope, storeId, await readBody(request)));
          if (request.method === 'POST' && action === 'resolve') return json(await catalog.resolve(fixtureScope, storeId, await readBody(request)));
        }
      }
      const discovery = url.pathname.match(/^\/stores\/([^/]+)\/\.well-known\/ocp-catalog$/);
      if (request.method === 'GET' && discovery && catalog) { const id = decodeURIComponent(discovery[1]!); await catalog.products(fixtureScope, id); return json(catalog.discovery(id)); }
      const liveDiscovery = url.pathname.match(/^\/live\/stores\/([^/]+)\/\.well-known\/ocp-catalog$/);
      if (request.method === 'GET' && liveDiscovery && live) return json(live.discovery(decodeURIComponent(liveDiscovery[1]!)));
      if (request.method === 'GET' && url.pathname === '/luckin/v1/attempts' && options.fixture) return json(options.fixture.workflow.list(fixtureScope));
      if (request.method === 'POST' && url.pathname === '/luckin/v1/quotes' && options.fixture && catalog) {
        const result = await options.fixture.workflow.quote(fixtureScope, await readBody(request));
        const reference = await catalog.resolve(fixtureScope, result.terms.store_id, { entry_id: result.terms.items[0]!.product_id, purpose: 'checkout' });
        const binding = reference.action_bindings[0]!;
        trustedLuckinWorkflow(binding, options.origin);
        return json({ ...result, workflow: binding });
      }
      if (request.method === 'POST' && url.pathname === '/luckin/v1/confirm' && options.fixture) return json(await options.fixture.workflow.confirm(fixtureScope, await readBody(request)));
      const attempt = url.pathname.match(/^\/luckin\/v1\/attempts\/([^/]+)(\/refresh|\/fixture-advance)?$/);
      if (attempt && options.fixture) {
        const id = decodeURIComponent(attempt[1]!);
        if (request.method === 'GET' && !attempt[2]) return json(options.fixture.workflow.get(fixtureScope, id));
        if (request.method === 'POST' && attempt[2] === '/refresh') return json(await options.fixture.workflow.reconcile(fixtureScope, id));
        if (request.method === 'POST' && attempt[2] === '/fixture-advance') {
          const { action } = z.object({ action: z.enum(['pay', 'ready', 'collect']) }).strict().parse(await readBody(request));
          const current = options.fixture.workflow.get(fixtureScope, id);
          if (!current.order) throw new LuckinFlowError('order_not_created');
          await options.fixture.port.advance(fixtureScope, current.order.order_id, action);
          return json(await options.fixture.workflow.reconcile(fixtureScope, id));
        }
      }
      return json({ error: live && url.pathname.startsWith('/luckin/v1/') ? 'live_write_disabled' : 'not_found' }, live ? 409 : 404);
    } catch (error) {
      if (error instanceof LuckinFlowError) return json({ error: error.code }, error.status);
      if (error instanceof z.ZodError) return json({ error: 'invalid_contract_or_budget' }, 400);
      // Upstream raw bodies, account details and credentials never enter HTTP errors.
      return json({ error: 'upstream_unavailable_or_invalid' }, 502);
    }
  };
}
