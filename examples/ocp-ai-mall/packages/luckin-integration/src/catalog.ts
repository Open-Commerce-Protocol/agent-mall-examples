import { randomUUID } from 'node:crypto';
import {
  catalogManifestSchema, catalogHealthResponseSchema, catalogQueryRequestSchema, catalogQueryResultSchema, resolveRequestSchema,
  resolvableReferenceSchema, type ActionBinding,
} from '@ocp-catalog/ocp-schema';
import { LUCKIN_WORKFLOW_ID, type LuckinScope } from '@ocp-catalog/shopping-contracts';
import { productSchema, storeSchema, type LuckinPort, type LuckinProduct } from '@ocp-catalog/luckin-adapter';
import { catalogId, LuckinFlowError } from './workflow';

export const LUCKIN_CONTRACT = {
  required_fields: ['product.core#/title', 'luckin.selection.v1#/store_id', 'luckin.selection.v1#/product_id'],
  optional_fields: ['price#/amount'], additional_fields_policy: 'allow' as const,
};
/** A scope is supplied by the backend, never read from a caller-controlled identity header. */
export class LuckinCatalog {
  constructor(readonly port: LuckinPort, readonly origin: string, private readonly now: () => number = Date.now) {
    if (port.environment !== 'fixture') throw new Error('live catalog mapping has not been verified');
  }
  base(storeId: string) { return `${this.origin}/stores/${encodeURIComponent(storeId)}`; }
  async products(scope: LuckinScope, storeId: string) {
    if (scope.environment !== this.port.environment) throw new LuckinFlowError('environment_mismatch');
    const stores = (await this.port.stores(scope)).map(value => storeSchema.parse(value));
    const store = stores.find(value => value.store_id === storeId);
    if (!store) throw new LuckinFlowError('not_found', 404);
    if (!store.open) throw new LuckinFlowError('store_closed');
    return (await this.port.products(scope, storeId)).map(value => productSchema.parse(value));
  }
  discovery(storeId: string) {
    const base = this.base(storeId);
    return { ocp_version: '1.0', kind: 'WellKnownCatalogDiscovery', catalog_id: catalogId(storeId), catalog_name: '瑞幸离线适配试点',
      manifest_url: `${base}/ocp/manifest`, health_url: `${base}/ocp/health`, query_url: `${base}/ocp/query`, resolve_url: `${base}/ocp/resolve` };
  }
  manifest(storeId: string) {
    const base = this.base(storeId);
    return catalogManifestSchema.parse({ ocp_version: '1.0', kind: 'CatalogManifest', id: `manifest:${storeId}`,
      catalog_id: catalogId(storeId), catalog_name: '瑞幸适配试点（合成数据）', registry_visibility: 'private',
      description: '仅用于离线契约测试，非瑞幸实时菜单。金额为参考价，最终报价包含优惠和费用。',
      endpoints: { query: { url: `${base}/ocp/query`, method: 'POST' }, resolve: { url: `${base}/ocp/resolve`, method: 'POST' },
        health: { url: `${base}/ocp/health`, method: 'GET' } },
      object_contracts: [LUCKIN_CONTRACT],
      query_capabilities: [{ capability_id: 'luckin.fixture.keyword.v1', name: '合成菜单关键词查询',
        query_packs: [{ pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'] }],
        searchable_field_refs: ['product.core#/title'], filterable_field_refs: [], sortable_field_refs: [], input_fields: [],
        supports_resolve: true, supports_explain: true, metadata: { price_semantics: 'reference', scope: 'fixture_menu' } }],
    });
  }
  health(storeId: string) {
    return catalogHealthResponseSchema.parse({ ocp_version: '1.0', kind: 'CatalogHealth', catalog_id: catalogId(storeId),
      status: 'healthy', ready: true, checked_at: new Date(this.now()).toISOString(), details: { environment: this.port.environment, live_verified: false } });
  }
  private attributes(product: LuckinProduct, storeId: string) {
    return { 'product.core': { title: product.title }, 'luckin.selection.v1': { store_id: storeId, product_id: product.product_id,
      skus: product.skus, options: product.options }, price_semantics: 'reference',
      ...(product.reference_minor === null ? {} : { price: { amount: product.reference_minor / 100, currency: 'CNY' } }),
      inventory: { availability_status: product.available ? 'in_stock' : 'out_of_stock' }, fulfillment: { methods: ['pickup'], location_id: storeId } };
  }
  async query(scope: LuckinScope, storeId: string, input: unknown) {
    const request = catalogQueryRequestSchema.parse(input);
    if ((request.catalog_id && request.catalog_id !== catalogId(storeId)) || (request.query_pack && request.query_pack !== 'ocp.query.keyword.v1')
      || (request.query_mode && request.query_mode !== 'keyword') || Object.keys(request.filters).length || request.cursor) throw new LuckinFlowError('unsupported_query', 400);
    const products = (await this.products(scope, storeId)).filter(product => product.title.toLowerCase().includes(request.query.trim().toLowerCase()));
    const selected = products.slice(0, request.limit);
    return catalogQueryResultSchema.parse({ ocp_version: '1.0', kind: 'CatalogQueryResult', id: randomUUID(), catalog_id: catalogId(storeId),
      query_pack: 'ocp.query.keyword.v1', query_mode: 'keyword', query: request.query, result_count: selected.length,
      page: { limit: request.limit, offset: 0, has_more: false },
      entries: selected.map(product => ({ score: 1, explain: ['合成菜单匹配；参考价不用于排除券后可能符合预算的商品。'],
        entry: { kind: 'CatalogEntry', catalog_id: catalogId(storeId), entry_id: product.product_id, object_id: product.product_id,
          object_type: 'ocp.commerce.product', provider_id: 'luckin-fixture', title: product.title, attributes: this.attributes(product, storeId) } })),
      policy_summary: { query_mode: 'keyword', selected_capability_id: 'luckin.fixture.keyword.v1', selected_query_pack: 'ocp.query.keyword.v1',
        supports_explain: true, warnings: products.length > selected.length ? ['Limited fixture candidates; this is not the full menu.'] : ['Synthetic fixture data only.'] },
    });
  }
  async resolve(scope: LuckinScope, storeId: string, input: unknown) {
    const request = resolveRequestSchema.parse(input);
    if ((request.catalog_id && request.catalog_id !== catalogId(storeId)) || !['view', 'checkout', 'workflow'].includes(request.purpose)) throw new LuckinFlowError('unsupported_resolve', 400);
    const product = (await this.products(scope, storeId)).find(value => value.product_id === request.entry_id);
    if (!product) throw new LuckinFlowError('not_found', 404);
    const at = new Date(this.now()).toISOString(); const expires = new Date(this.now() + 60_000).toISOString();
    return resolvableReferenceSchema.parse({ ocp_version: '1.0', kind: 'ResolvableReference', id: randomUUID(), catalog_id: catalogId(storeId),
      entry_id: product.product_id, commercial_object_id: `${storeId}:${product.product_id}`, object_id: product.product_id,
      object_type: 'ocp.commerce.product', provider_id: 'luckin-fixture', title: product.title, visible_attributes: this.attributes(product, storeId),
      access: { visibility: 'private', permission_state: 'granted' },
      live_checks: [{ check_id: 'availability', status: product.available ? 'passed' : 'failed', checked_at: at, summary: 'Checked against synthetic upstream.' }],
      action_bindings: [{ action_id: LUCKIN_WORKFLOW_ID, action_type: 'workflow', label: '确认报价后模拟下单',
        entrypoint: { url: `${this.origin}/luckin/v1/confirm`, method: 'POST' },
        input_schema: { type: 'object', required: ['quote_id', 'terms_hash', 'confirmed'], properties: {
          quote_id: { type: 'string' }, terms_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, confirmed: { const: true },
        }, additionalProperties: false }, auth_requirements: { scheme: 'local-fixture-session', version: 1 },
        requires_user_confirmation: true, expires_at: expires }], freshness: { object_updated_at: at, resolved_at: at }, expires_at: expires });
  }
}

/** A small explicit registry: remote instructions/steps never become executable code. */
export function trustedLuckinWorkflow(binding: ActionBinding, origin: string, now = Date.now()): string {
  const expected = `${new URL(origin).origin}/luckin/v1/confirm`;
  if (binding.action_id !== LUCKIN_WORKFLOW_ID || binding.action_type !== 'workflow' || binding.entrypoint.method !== 'POST'
    || binding.entrypoint.url !== expected || !binding.requires_user_confirmation || !binding.expires_at || Date.parse(binding.expires_at) <= now
    || binding.auth_requirements.scheme !== 'local-fixture-session' || binding.auth_requirements.version !== 1) throw new LuckinFlowError('untrusted_workflow');
  return expected;
}
