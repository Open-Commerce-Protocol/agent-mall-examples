import { randomUUID } from 'node:crypto';
import { catalogHealthResponseSchema, catalogManifestSchema, catalogQueryRequestSchema, catalogQueryResultSchema, resolveRequestSchema, resolvableReferenceSchema } from '@ocp-catalog/ocp-schema';
import type { LuckinLiveRead } from '@ocp-catalog/luckin-adapter';
import { LuckinFlowError } from './workflow';

/** Limited, account-scoped live search. No checkout bindings until P3/P4 verified. */
export class LuckinLiveCatalog {
  private readonly stores = new Set<string>();
  constructor(readonly reader: LuckinLiveRead, readonly origin: string) {}
  id(store: string) { return `luckin-live:${store}`; }
  base(store: string) { return `${this.origin}/live/stores/${encodeURIComponent(store)}`; }
  async locations(longitude: number, latitude: number) {
    const stores = await this.reader.stores(longitude, latitude);
    for (const store of stores) this.stores.add(store.store_id);
    return stores;
  }
  private requireStore(store: string) { if (!this.stores.has(store)) throw new LuckinFlowError('select_store_first', 400); }
  discovery(store: string) {
    this.requireStore(store); const base = this.base(store);
    return { ocp_version: '1.0', kind: 'WellKnownCatalogDiscovery', catalog_id: this.id(store), catalog_name: '瑞幸 MCP 只读目录',
      manifest_url: `${base}/ocp/manifest`, health_url: `${base}/ocp/health`, query_url: `${base}/ocp/query`, resolve_url: `${base}/ocp/resolve` };
  }
  health(store: string) {
    this.requireStore(store);
    return catalogHealthResponseSchema.parse({ ocp_version: '1.0', kind: 'CatalogHealth', catalog_id: this.id(store),
      status: 'degraded', ready: true, checked_at: new Date().toISOString(), details: { environment: 'live', read_only: true,
        upstream_health: 'not_probed', transaction_mapping: 'not_verified' } });
  }
  manifest(store: string) {
    this.requireStore(store);
    return catalogManifestSchema.parse({ ocp_version: '1.0', kind: 'CatalogManifest', id: `manifest:${this.id(store)}`,
      catalog_id: this.id(store), catalog_name: '瑞幸 MCP 只读目录', registry_visibility: 'private',
      description: '账户授权的有限候选搜索；预估金额不构成报价，真实交易未开放。',
      endpoints: { query: { url: `${this.base(store)}/ocp/query`, method: 'POST' }, resolve: { url: `${this.base(store)}/ocp/resolve`, method: 'POST' }, health: { url: `${this.base(store)}/ocp/health`, method: 'GET' } },
      object_contracts: [{ required_fields: ['product.core#/title', 'luckin.selection.v1#/store_id', 'luckin.selection.v1#/product_id'], optional_fields: [], additional_fields_policy: 'allow' }],
      query_capabilities: [{ capability_id: 'luckin.live.search.v1', query_packs: [{ pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword'] }],
        searchable_field_refs: ['product.core#/title'], filterable_field_refs: [], sortable_field_refs: [], input_fields: [], supports_resolve: true,
        supports_explain: false, metadata: { result_scope: 'upstream_candidates', price_semantics: 'estimate', checkout_enabled: false } }],
    });
  }
  private attributes(product: Awaited<ReturnType<LuckinLiveRead['detail']>>, store: string) {
    return { 'product.core': { title: product.title }, 'luckin.selection.v1': { store_id: store, ...product },
      price_semantics: 'estimate', ...(product.estimate_minor === null ? {} : { price: { currency: 'CNY', amount: product.estimate_minor / 100 } }),
      inventory: { availability_status: 'unknown' } };
  }
  async query(store: string, input: unknown) {
    this.requireStore(store);
    const request = catalogQueryRequestSchema.parse(input);
    if ((request.catalog_id && request.catalog_id !== this.id(store)) || (request.query_pack && request.query_pack !== 'ocp.query.keyword.v1')
      || (request.query_mode && request.query_mode !== 'keyword') || request.cursor || Object.keys(request.filters).length || !request.query.trim()) throw new LuckinFlowError('unsupported_query', 400);
    const rows = await this.reader.search(store, request.query);
    const entries = rows.slice(0, request.limit).map(product => ({ score: 1, explain: [], entry: {
      kind: 'CatalogEntry', catalog_id: this.id(store), entry_id: product.product_id, object_id: product.product_id, provider_id: 'luckin-mcp',
      object_type: 'ocp.commerce.product', title: product.title, attributes: this.attributes(product, store),
    } }));
    return catalogQueryResultSchema.parse({ ocp_version: '1.0', kind: 'CatalogQueryResult', id: randomUUID(), catalog_id: this.id(store),
      query_pack: 'ocp.query.keyword.v1', query_mode: 'keyword', query: request.query, result_count: entries.length,
      entries, page: { limit: request.limit, offset: 0, has_more: false }, policy_summary: { query_mode: 'keyword', supports_explain: false,
        selected_capability_id: 'luckin.live.search.v1', selected_query_pack: 'ocp.query.keyword.v1', warnings: ['仅为上游有限候选，不代表完整菜单；未以预估价进行预算过滤。',
          ...(rows.length > entries.length ? ['当前页面按 limit 截断；上游没有提供分页能力。'] : [])] } });
  }
  async resolve(store: string, input: unknown) {
    this.requireStore(store);
    const request = resolveRequestSchema.parse(input);
    if ((request.catalog_id && request.catalog_id !== this.id(store)) || request.purpose !== 'view') throw new LuckinFlowError('live_checkout_disabled');
    const product = await this.reader.detail(store, request.entry_id);
    const at = new Date().toISOString();
    return resolvableReferenceSchema.parse({ ocp_version: '1.0', kind: 'ResolvableReference', id: randomUUID(), catalog_id: this.id(store), entry_id: product.product_id,
      commercial_object_id: `${store}:${product.product_id}`, object_id: product.product_id, object_type: 'ocp.commerce.product', provider_id: 'luckin-mcp', title: product.title,
      visible_attributes: this.attributes(product, store), access: { visibility: 'private', permission_state: 'granted' },
      live_checks: [{ check_id: 'detail', status: 'passed', checked_at: at, summary: '商品详情已读取；没有核验最终成交价或库存。' }], action_bindings: [],
      freshness: { object_updated_at: at, resolved_at: at }, expires_at: new Date(Date.now() + 60_000).toISOString() });
  }
}
