import { describe, expect, test } from 'bun:test';
import {
  catalogHealthResponseSchema,
  catalogEntrySchema,
  catalogManifestSchema,
  commercialObjectSchema,
} from './index';

const validHealth = {
  ocp_version: '1.0',
  kind: 'CatalogHealth',
  catalog_id: 'cat_commerce_demo',
  status: 'healthy',
  ready: true,
  checked_at: '2026-05-17T00:00:00.000Z',
  manifest_version: 'manifest_cat_commerce_demo',
  details: {
    provider_count: 3,
  },
  dependencies: [
    {
      name: 'postgres',
      status: 'healthy',
    },
  ],
};

describe('catalogHealthResponseSchema', () => {
  test('accepts a valid CatalogHealth response', () => {
    expect(catalogHealthResponseSchema.safeParse(validHealth).success).toBe(true);
  });

  test('rejects payloads with the wrong kind', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      kind: 'CatalogManifest',
    }).success).toBe(false);
  });

  test('rejects invalid health status and timestamps', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      status: 'ok',
    }).success).toBe(false);

    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      checked_at: 'not-a-date',
    }).success).toBe(false);
  });

  test('rejects invalid dependency status', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      dependencies: [
        {
          name: 'postgres',
          status: 'ok',
        },
      ],
    }).success).toBe(false);
  });

  test('rejects fields outside the JSON Schema contract', () => {
    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      extra: true,
    }).success).toBe(false);

    expect(catalogHealthResponseSchema.safeParse({
      ...validHealth,
      dependencies: [
        {
          name: 'postgres',
          status: 'healthy',
          extra: true,
        },
      ],
    }).success).toBe(false);
  });
});

describe('catalogManifestSchema authority and identity policies', () => {
  const validManifest = {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: 'manifest_identity_catalog',
    catalog_id: 'identity_catalog',
    catalog_name: 'Identity Catalog',
    endpoints: {
      query: { url: 'https://catalog.example.test/ocp/query', method: 'POST' },
      resolve: { url: 'https://catalog.example.test/ocp/resolve', method: 'POST' },
    },
    query_capabilities: [
      {
        capability_id: 'ocp.object.search.v1',
        query_packs: [],
        searchable_field_refs: [],
        filterable_field_refs: [],
        sortable_field_refs: [],
        input_fields: [],
        supports_explain: true,
        supports_resolve: true,
        metadata: {},
      },
    ],
    provider_contract: {
      field_rules: [
        {
          field_ref: 'provider#/display_name',
          requirement: 'required',
          usage: ['identity', 'display', 'explain'],
        },
      ],
      sync_capabilities: [
        {
          capability_id: 'ocp.pull.provider_feed.v1',
          direction: 'catalog_pull_provider',
          transport: 'provider_api',
          sync_model: {
            snapshot: true,
            delta: true,
            stream: false,
          },
          mutation_semantics: {
            upsert: true,
            delete: true,
          },
          endpoint_contract: {
            hosted_by: 'provider',
            required_endpoint_fields: ['feed_url'],
          },
          metadata: {},
        },
      ],
    },
    object_contracts: [
      {
        required_fields: ['ocp.object.summary.v1#/title'],
        optional_fields: [],
        additional_fields_policy: 'allow',
        field_usage_policy: [
          {
            field_ref: 'ocp.object.summary.v1#/title',
            requirement: 'required',
            usage: ['index', 'rank', 'display', 'search_visible', 'explain'],
          },
          {
            field_ref: 'ocp.commerce.product.core.v1#/sku',
            requirement: 'optional',
            usage: ['identity', 'filter', 'never_expose'],
          },
        ],
        identity_policy: {
          accepted_identity_keys: ['provider_object_id', 'provider_sku'],
          dedupe_scope: 'provider',
          provider_sku_trust: 'requires_verified_provider',
          requires_authority_verification: true,
        },
        resolve_policy: {
          strategies: ['provider_api', 'catalog_cached'],
          provider_endpoint_required: true,
          minimum_trust_tier: 'verified',
        },
        provenance_requirements: {
          accepted_authority_types: ['provider_authoritative', 'imported_snapshot'],
          requires_verification: true,
          minimum_trust_tier: 'verified',
        },
      },
    ],
  };

  test('accepts identity, provenance, and resolve policies without provider_lifecycle', () => {
    const result = catalogManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider_contract?.sync_capabilities[0]).not.toHaveProperty('provider_lifecycle');
    }
  });

  test('rejects provider_lifecycle as a protocol field', () => {
    expect(catalogManifestSchema.safeParse({
      ...validManifest,
      provider_contract: {
        ...validManifest.provider_contract,
        sync_capabilities: [
          {
            ...validManifest.provider_contract.sync_capabilities[0],
            provider_lifecycle: { persistence: 'persistent' },
          },
        ],
      },
    }).success).toBe(false);
  });
});

describe('commercialObjectSchema provenance', () => {
  test('accepts provider-authoritative objects without an external source URL', () => {
    expect(commercialObjectSchema.safeParse({
      ocp_version: '1.0',
      kind: 'CommercialObject',
      id: 'obj_1',
      object_id: 'provider_product_1',
      object_type: 'product',
      provider_id: 'provider_acme',
      title: 'Provider-owned product',
      provenance: {
        authority_type: 'provider_authoritative',
        provider_id: 'provider_acme',
        verification_status: 'verified',
        trust_tier: 'verified',
      },
      descriptors: [
        {
          pack_id: 'ocp.object.summary.v1',
          data: { title: 'Provider-owned product' },
        },
      ],
    }).success).toBe(true);
  });
});

describe('catalogEntrySchema preview image', () => {
  test('accepts optional image_url for result previews', () => {
    expect(catalogEntrySchema.safeParse({
      kind: 'CatalogEntry',
      catalog_id: 'commerce_catalog',
      entry_id: 'entry_1',
      provider_id: 'provider_acme',
      object_id: 'product_1',
      object_type: 'product',
      title: 'Previewable product',
      image_url: 'https://provider.example/images/product_1.jpg',
      attributes: {},
    }).success).toBe(true);
  });
});

describe('catalogManifestSchema data_profile', () => {
  const validManifest = {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: 'manifest_cat_commerce_demo',
    catalog_id: 'cat_commerce_demo',
    catalog_name: 'Commerce Demo',
    endpoints: {
      query: { url: 'https://catalog.example.test/ocp/query', method: 'POST' },
      resolve: { url: 'https://catalog.example.test/ocp/resolve', method: 'POST' },
    },
    query_capabilities: [
      {
        capability_id: 'ocp.commerce.product.search.v1',
        query_packs: [],
        searchable_field_refs: [],
        filterable_field_refs: [],
        sortable_field_refs: [],
        input_fields: [],
        supports_explain: true,
        supports_resolve: true,
        metadata: {},
      },
    ],
    object_contracts: [
      {
        required_fields: ['ocp.commerce.product.core.v1#/title'],
        optional_fields: [],
        additional_fields_policy: 'allow',
      },
    ],
  };

  test('accepts optional catalog entry counts for data-owning catalogs', () => {
    expect(catalogManifestSchema.safeParse({
      ...validManifest,
      data_profile: {
        catalog_entry_count: 10_000_000,
        object_counts: [{ object_type: 'product', count: 10_000_000 }],
        counted_at: '2026-06-06T00:00:00.000Z',
      },
    }).success).toBe(true);
  });

  test('does not require data_profile for live forwarding catalogs', () => {
    expect(catalogManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  test('rejects invalid catalog entry counts', () => {
    expect(catalogManifestSchema.safeParse({
      ...validManifest,
      data_profile: {
        catalog_entry_count: -1,
      },
    }).success).toBe(false);
  });

  test('rejects empty object type counts', () => {
    expect(catalogManifestSchema.safeParse({
      ...validManifest,
      data_profile: {
        catalog_entry_count: 1,
        object_counts: [{ object_type: '', count: 1 }],
      },
    }).success).toBe(false);
  });
});
