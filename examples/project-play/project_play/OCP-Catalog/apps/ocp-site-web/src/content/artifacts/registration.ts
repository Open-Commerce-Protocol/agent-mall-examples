import type { PageArtifactDefinition } from './types';

export const registrationArtifacts: Record<string, PageArtifactDefinition> = {
  '/registration/discovery': {
      schemaSections: [
        {
          title: { en: 'Registration node Discovery Schema', zh: 'RegistrationDiscovery schema' },
          sourcePath: 'ocp.catalog.registration.v1/registration-discovery.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: schema.properties,
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Registration node API discovery endpoint', zh: 'Registration node API discovery 入口' },
          path: 'apps/ocp-registration-api/src/index.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/ocp-registration-api/src/index.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Fetch Registration node discovery document', zh: '获取 Registration node discovery 文档' },
          method: 'GET',
          path: '/.well-known/ocp-registration',
          response: {
            kind: 'RegistrationDiscovery',
            registration_id: 'ocp_registration_local_dev',
            manifest_url: 'http://localhost:4100/ocp/registration/manifest',
            catalog_registration_url: 'http://localhost:4100/ocp/catalogs/register',
            catalog_search_url: 'http://localhost:4100/ocp/catalogs/search',
          },
        },
      ],
    },
  '/registration/catalog-registration': {
      schemaSections: [
        {
          title: { en: 'Catalog Registration Schema', zh: 'Catalog 注册 schema' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-registration.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: {
              catalog_id: schema.properties?.catalog_id,
              registration_version: schema.properties?.registration_version,
              well_known_url: schema.properties?.well_known_url,
              claimed_domains: schema.properties?.claimed_domains,
              intended_visibility: schema.properties?.intended_visibility,
              tags: schema.properties?.tags,
            },
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Catalog registration orchestration', zh: 'Catalog 注册编排' },
          path: 'packages/registration-core/src/catalog-registry-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/catalog-registry-service.ts',
        },
        {
          label: { en: 'Catalog registration API', zh: 'Catalog 注册 API' },
          path: 'apps/ocp-registration-api/src/index.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/ocp-registration-api/src/index.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Register catalog to Registration node', zh: '将 catalog 注册到 Registration node' },
          method: 'POST',
          path: '/ocp/catalogs/register',
          request: {
            kind: 'CatalogRegistration',
            registration_id: 'ocp_registration_local_dev',
            catalog_id: 'commerce_catalog_local_dev',
            registration_version: 3,
            homepage: 'http://localhost:4000',
            well_known_url: 'http://localhost:4000/.well-known/ocp-catalog',
            claimed_domains: ['localhost'],
            intended_visibility: 'public',
            tags: ['commerce', 'products'],
          },
          response: {
            status: 'accepted',
            catalog_id: 'commerce_catalog_local_dev',
            effective_registration_version: 3,
          },
        },
      ],
    },
  '/registration/catalog-search': {
      schemaSections: [
        {
          title: { en: 'Catalog Search Request', zh: 'Catalog 搜索请求' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-search.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: schema.properties,
          }),
        },
        {
          title: { en: 'Catalog Search Result Item', zh: 'Catalog 搜索结果项' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-search-result.schema.json',
          select: (schema) => ({
            item: schema.properties?.items?.items,
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Registration node search query service', zh: 'Registration node 搜索服务' },
          path: 'packages/registration-core/src/catalog-registry-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/catalog-registry-service.ts',
        },
        {
          label: { en: 'User demo agent Registration node search client', zh: '用户 demo agent 的 Registration node 搜索客户端' },
          path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/ocp-user-demo-api/src/agent-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Search Registration node for a catalog', zh: '在 Registration node 中搜索 catalog' },
          method: 'POST',
          path: '/ocp/catalogs/search',
          request: {
            query: 'travel headphones under 150 with image',
            filters: {
              query_pack: 'ocp.query.keyword.v1',
            },
            limit: 5,
            explain: true,
          },
          response: {
            result_count: 1,
            items: [
              {
                catalog_id: 'commerce_catalog_local_dev',
                catalog_name: 'Commerce Product Search Catalog',
                route_hint: {
                  query_url: 'http://localhost:4000/ocp/query',
                },
              },
            ],
          },
        },
      ],
    },
  '/registration/catalog-route-hint': {
      schemaSections: [
        {
          title: { en: 'Catalog Route Hint Schema', zh: 'CatalogRouteHint schema' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-route-hint.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: schema.properties,
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Route hint projection', zh: 'Route hint 投影逻辑' },
          path: 'packages/registration-core/src/projection.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/projection.ts',
        },
        {
          label: { en: 'User demo route-hint consumption', zh: '用户 demo 对 route hint 的消费逻辑' },
          path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/ocp-user-demo-api/src/agent-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Route hint fragment returned by Registration node search', zh: 'Registration node search 返回的 route hint 片段' },
          method: 'POST',
          path: '/ocp/catalogs/search',
          response: {
            route_hint: {
              catalog_id: 'commerce_catalog_local_dev',
              manifest_url: 'http://localhost:4000/ocp/manifest',
              query_url: 'http://localhost:4000/ocp/query',
              resolve_url: 'http://localhost:4000/ocp/resolve',
              supported_query_packs: ['ocp.query.keyword.v1', 'ocp.query.filter.v1', 'ocp.query.semantic.v1'],
              metadata: {
                query_hints: {
                  supported_query_modes: ['keyword', 'filter', 'semantic', 'hybrid'],
                  supported_query_languages: ['en'],
                  content_languages: ['en'],
                },
              },
            },
          },
        },
      ],
    },
  '/registration/verification-refresh': {
      schemaSections: [
        {
          title: { en: 'Verification Request', zh: '验证请求' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-verification.schema.json',
          select: (schema) => schema,
        },
        {
          title: { en: 'Refresh Result', zh: '刷新结果' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-refresh-result.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: schema.properties,
          }),
        },
        {
          title: { en: 'Token Rotation Result', zh: '令牌轮换结果' },
          sourcePath: 'ocp.catalog.registration.v1/catalog-token-rotation-result.schema.json',
          select: (schema) => ({
            required: schema.required,
            properties: schema.properties,
          }),
        },
      ],
      implementationRefs: [
        {
          label: { en: 'Registration node verification and refresh APIs', zh: 'Registration node 验证与刷新 API' },
          path: 'apps/ocp-registration-api/src/index.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/ocp-registration-api/src/index.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Verify catalog control', zh: '验证 catalog 控制权' },
          method: 'POST',
          path: '/ocp/catalogs/:catalogId/verify',
          request: {
            challenge_id: 'challenge_local_dev_001',
          },
          response: {
            status: 'verified',
            catalog_id: 'commerce_catalog_local_dev',
          },
        },
        {
          title: { en: 'Refresh catalog snapshot', zh: '刷新 catalog snapshot' },
          method: 'POST',
          path: '/ocp/catalogs/:catalogId/refresh',
          headers: {
            'x-catalog-token': '<catalog-token>',
          },
          response: {
            status: 'refreshed',
            indexed: true,
            health_status: 'healthy',
          },
        },
        {
          title: { en: 'Rotate catalog access token', zh: '轮换 catalog 访问令牌' },
          method: 'POST',
          path: '/ocp/catalogs/:catalogId/token/rotate',
          headers: {
            'x-catalog-token': '<catalog-token>',
          },
          response: {
            catalog_access_token: '<new-token>',
            token_issued_at: '2026-04-21T00:00:00.000Z',
          },
        },
      ],
    },
};
