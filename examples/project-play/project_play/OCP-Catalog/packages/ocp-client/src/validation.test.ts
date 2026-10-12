import { describe, expect, test } from 'bun:test';
import type { CatalogManifest, CatalogQueryRequest } from '@ocp-catalog/ocp-schema';
import { OcpClientValidationError, validateCatalogQueryRequest } from './index';

const manifest: CatalogManifest = {
  ocp_version: '1.0',
  kind: 'CatalogManifest',
  id: 'manifest_1',
  catalog_id: 'cat_test',
  catalog_name: 'Test Catalog',
  registry_visibility: 'public',
  endpoints: {
    query: { url: 'https://catalog.example.test/ocp/query', method: 'POST' },
    resolve: { url: 'https://catalog.example.test/ocp/resolve', method: 'POST' },
  },
  query_capabilities: [
    {
      capability_id: 'commerce.search',
      query_packs: [
        {
          pack_id: 'ocp.query.keyword.v1',
          query_modes: ['keyword', 'hybrid'],
          metadata: {},
        },
        {
          pack_id: 'ocp.query.filter.v1',
          query_modes: ['filter', 'hybrid'],
          metadata: {},
        },
      ],
      searchable_field_refs: [],
      filterable_field_refs: [],
      sortable_field_refs: [],
      input_fields: [
        { name: 'filters.category', type: 'string' },
        { name: 'filters.in_stock_only', type: 'boolean' },
      ],
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

describe('manifest-aware query validation', () => {
  test('selects a declared query pack before sending a valid query', () => {
    const request: CatalogQueryRequest = {
      query: 'running shoes',
      filters: { category: 'shoes' },
      limit: 10,
      offset: 0,
      explain: true,
    };

    const result = validateCatalogQueryRequest(manifest, request);

    expect(result.request).toMatchObject({
      query_pack: 'ocp.query.keyword.v1',
      query: 'running shoes',
    });
    expect(result.policy_summary).toMatchObject({
      selected_query_pack: 'ocp.query.keyword.v1',
      query_mode: 'hybrid',
      accepted_filters: ['category'],
      rejected_filters: [],
    });
  });

  test('rejects a requested pack when the inferred query mode is unsupported', () => {
    const request: CatalogQueryRequest = {
      query_pack: 'ocp.query.filter.v1',
      query: 'running shoes',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    };

    expect(() => validateCatalogQueryRequest(manifest, request)).toThrow(OcpClientValidationError);

    try {
      validateCatalogQueryRequest(manifest, request);
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_query_mode',
        query_pack: 'ocp.query.filter.v1',
        query_mode: 'keyword',
        supported_query_modes: ['filter', 'hybrid'],
      });
    }
  });

  test('rejects an explicit query mode unsupported by the requested pack', () => {
    const request = {
      query_pack: 'ocp.query.keyword.v1',
      query_mode: 'semantic',
      query: 'running shoes',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    } as CatalogQueryRequest;

    expect(() => validateCatalogQueryRequest(manifest, request)).toThrow(OcpClientValidationError);

    try {
      validateCatalogQueryRequest(manifest, request);
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_query_mode',
        query_pack: 'ocp.query.keyword.v1',
        query_mode: 'semantic',
        supported_query_modes: ['keyword', 'hybrid'],
      });
    }
  });

  test('rejects an inferred mode unsupported by every manifest query pack', () => {
    const keywordOnlyManifest: CatalogManifest = {
      ...manifest,
      query_capabilities: [
        {
          ...manifest.query_capabilities[0],
          query_packs: [
            {
              pack_id: 'ocp.query.keyword.v1',
              query_modes: ['keyword'],
              metadata: {},
            },
          ],
        },
      ],
    };
    const request: CatalogQueryRequest = {
      query: '',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    };

    expect(() => validateCatalogQueryRequest(keywordOnlyManifest, request)).toThrow(OcpClientValidationError);

    try {
      validateCatalogQueryRequest(keywordOnlyManifest, request);
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_query_mode',
        query_mode: 'filter',
        supported_query_modes: ['keyword'],
        supported_query_packs: ['ocp.query.keyword.v1'],
      });
    }
  });

  test('rejects unsupported query packs and filter fields with repair details', () => {
    const request: CatalogQueryRequest = {
      query_pack: 'ocp.query.unknown.v1',
      query: 'running shoes',
      filters: { brand: 'Acme' },
      limit: 10,
      offset: 0,
      explain: true,
    };

    expect(() => validateCatalogQueryRequest(manifest, request)).toThrow(OcpClientValidationError);

    try {
      validateCatalogQueryRequest(manifest, request);
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_query_pack',
        query_pack: 'ocp.query.unknown.v1',
        supported_query_packs: ['ocp.query.keyword.v1', 'ocp.query.filter.v1'],
      });
    }
  });

  test('rejects schema-valid filters that the manifest does not declare', () => {
    const request: CatalogQueryRequest = {
      query_pack: 'ocp.query.keyword.v1',
      query: 'running shoes',
      filters: { brand: 'Acme' },
      limit: 10,
      offset: 0,
      explain: true,
    };

    try {
      validateCatalogQueryRequest(manifest, request);
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_filter_field',
        rejected_filter_fields: ['brand'],
        supported_filter_fields: ['category', 'in_stock_only'],
      });
    }
  });

  test('rejects query endpoint drift from the manifest', () => {
    const request: CatalogQueryRequest = {
      query: 'running shoes',
      filters: { category: 'shoes' },
      limit: 10,
      offset: 0,
      explain: true,
    };

    try {
      validateCatalogQueryRequest(manifest, request, {
        queryUrl: 'https://other.example.test/ocp/query',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(OcpClientValidationError);
      expect((error as OcpClientValidationError).details).toMatchObject({
        code: 'invalid_query_endpoint',
        received_query_url: 'https://other.example.test/ocp/query',
        manifest_query_url: 'https://catalog.example.test/ocp/query',
      });
    }
  });
});
