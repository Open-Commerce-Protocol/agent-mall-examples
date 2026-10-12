/**
 * 证据 1 · 自证合规:不起服务,直接把 6 个端点的响应逐个塞进官方
 * @ocp-catalog/ocp-schema 的 Zod schema 校验,外加内部字段泄漏扫描。
 *
 * 这不是「我说自己合规」,而是官方发布的 schema 包给出的结论。
 * 跑法:bun run selfcheck   —— 11 项全绿即通过。
 */
import {
  catalogManifestSchema,
  catalogHealthResponseSchema,
  catalogQueryResultSchema,
  resolvableReferenceSchema,
  actionBindingSchema,
} from '@ocp-catalog/ocp-schema';
import { handle } from './server';

const BASE = 'http://selfcheck.local';

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await handle(new Request(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
  if (res.status !== 200) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const INTERNAL_KEYS = ['internal_cost', 'internal_supplier'];

function scanLeak(obj: unknown, path = '$'): string[] {
  const found: string[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => found.push(...scanLeak(v, `${path}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (INTERNAL_KEYS.includes(k)) found.push(`${path}.${k}`);
      found.push(...scanLeak(v, `${path}.${k}`));
    }
  }
  return found;
}

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  ✅ ${name}`);
    })
    .catch((err: unknown) => {
      fail++;
      console.log(`  ❌ ${name}\n     ${String(err).split('\n')[0].slice(0, 160)}`);
    });
}

async function main() {
  console.log('🔍 selfcheck:官方 schema 逐项校验(共 11 项)\n');

  const wellKnown = (await call('GET', '/.well-known/ocp-catalog')) as Record<string, string>;
  const manifest = await call('GET', '/ocp/manifest');
  const health = await call('GET', '/ocp/health');
  const contracts = (await call('GET', '/ocp/contracts')) as { object_contracts: unknown[] };
  const queryKeyword = await call('POST', '/ocp/query', { query: '不太甜的咖啡', query_pack: 'ocp.query.keyword.v1' });
  const queryFilter = await call('POST', '/ocp/query', {
    query: '',
    query_pack: 'luckin.query.filter.v1',
    filters: { category: 'fruit_tea', max_amount: 20 },
  });
  const firstEntry = (queryKeyword as any).entries[0].entry.entry_id as string;
  const resolveView = await call('POST', '/ocp/resolve', { entry_id: firstEntry, purpose: 'view' });
  const resolveCheckout = await call('POST', '/ocp/resolve', { entry_id: firstEntry, purpose: 'checkout' });
  const checkoutBinding = (resolveCheckout as { action_bindings: Array<Record<string, unknown>> }).action_bindings[0];

  await check('1. well-known discovery 结构完整', () => {
    for (const k of ['catalog_id', 'manifest_url', 'health_url', 'query_url', 'resolve_url', 'contracts_url']) {
      if (!wellKnown[k]) throw new Error(`missing ${k}`);
    }
  });
  await check('2. manifest 通过 catalogManifestSchema', () => void catalogManifestSchema.parse(manifest));
  await check('3. health 通过 catalogHealthResponseSchema', () => void catalogHealthResponseSchema.parse(health));
  await check('4. contracts 返回契约列表', () => {
    if (!Array.isArray(contracts.object_contracts)) throw new Error('object_contracts 不是数组');
  });
  await check('5. keyword query 结果通过 catalogQueryResultSchema', () => void catalogQueryResultSchema.parse(queryKeyword));
  await check('6. filter query 结果通过 catalogQueryResultSchema', () => void catalogQueryResultSchema.parse(queryFilter));
  await check('7. resolve(view) 通过 resolvableReferenceSchema', () => void resolvableReferenceSchema.parse(resolveView));
  await check('8. resolve(checkout) 通过 resolvableReferenceSchema', () => void resolvableReferenceSchema.parse(resolveCheckout));
  await check('9. checkout 动作绑定本身通过 actionBindingSchema', () => void actionBindingSchema.parse(checkoutBinding));
  await check('10. checkout 动作:api 类型 + 强制用户确认 + 未来时效', () => {
    if (checkoutBinding.action_type !== 'api') throw new Error(`action_type=${checkoutBinding.action_type},应为 api`);
    if (checkoutBinding.requires_user_confirmation !== true) throw new Error('requires_user_confirmation 应为 true');
    if (new Date(String(checkoutBinding.expires_at)).getTime() <= Date.now()) throw new Error('expires_at 不在未来');
  });
  await check('11. 无内部字段泄漏(internal_cost / internal_supplier)', () => {
    const leaks = scanLeak([wellKnown, manifest, health, contracts, queryKeyword, queryFilter, resolveView, resolveCheckout]);
    if (leaks.length) throw new Error(`泄漏:${leaks.join(', ')}`);
  });

  console.log(`\n结果:${pass}/11 通过${fail === 0 ? ' ✅ 全绿' : `,${fail} 项失败 ❌`}`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
