import type { PageArtifactDefinition } from './types';

export const examplesArtifacts: Record<string, PageArtifactDefinition> = {
  '/examples/commerce-catalog': {
      implementationRefs: [
        {
          label: { en: 'Commerce scenario definition', zh: '电商场景定义' },
          path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/commerce-catalog-api/src/commerce-scenario.ts',
        },
        {
          label: { en: 'Catalog query service', zh: 'Catalog 查询服务' },
          path: 'apps/commerce-catalog-api/src/query/commerce-query-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/commerce-catalog-api/src/query/commerce-query-service.ts',
        },
        {
          label: { en: 'Embedding ANN shortlist and rerank', zh: 'Embedding ANN 候选召回与重排' },
          path: 'apps/commerce-catalog-api/src/search/indexing/search-embedding-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/commerce-catalog-api/src/search/indexing/search-embedding-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Query commerce catalog', zh: '查询电商 catalog' },
          method: 'POST',
          path: '/ocp/query',
          request: {
            kind: 'CatalogQueryRequest',
            query: 'travel headphones',
            query_pack: 'ocp.query.keyword.v1',
            filters: {
              category: 'electronics',
              in_stock_only: true,
              has_image: true,
              min_amount: 100,
              max_amount: 150,
            },
            explain: true,
          },
          response: {
            kind: 'CatalogQueryResult',
            result_count: 3,
            items: [
              {
                entry_id: 'centry_01_example',
                provider_id: 'commerce_provider_local_dev',
                object_id: 'electronics-headphones-001',
                title: 'Noise Cancelling Headphones',
                score: 0.97,
                attributes: {
                  category: 'electronics',
                  brand: 'North Audio',
                  sku: 'electronics-headphones-001',
                  amount: 129,
                  list_amount: 159,
                  availability_status: 'low_stock',
                  primary_image_url: 'https://commerce-provider.example.test/images/electronics-headphones-001.jpg',
                  quality_tier: 'rich',
                  has_image: true,
                  discount_present: true,
                },
                explain: [
                  'Inferred query strategy: hybrid.',
                  'Matched category filter: electronics.',
                  'Applied semantic ANN shortlist with exact cosine rerank.',
                ],
              },
            ],
            explain: [
              'Returned commerce product entries ranked with keyword, filter, and quality signals.',
            ],
          },
        },
        {
          title: { en: 'Resolve catalog result', zh: 'Resolve catalog 结果' },
          method: 'POST',
          path: '/ocp/resolve',
          request: {
            kind: 'ResolveRequest',
            entry_id: 'centry_01_example',
          },
          response: {
            kind: 'ResolvableReference',
            entry_id: 'centry_01_example',
            object_id: 'electronics-headphones-001',
            title: 'Noise Cancelling Headphones',
            visible_attributes: {
              category: 'electronics',
              brand: 'North Audio',
              amount: 129,
              list_amount: 159,
              availability_status: 'low_stock',
              primary_image_url: 'https://commerce-provider.example.test/images/electronics-headphones-001.jpg',
              quality_tier: 'rich',
              discount_present: true,
            },
            action_bindings: [
              {
                action_id: 'view_product',
                action_type: 'url',
                label: 'View product',
                url: 'http://localhost:4200/products/electronics-headphones-001',
                method: 'GET',
              },
            ],
          },
        },
      ],
    },
  '/examples/minimal-catalog': {
      implementationRefs: [
        {
          label: { en: 'Catalog manifest schema', zh: 'Catalog manifest schema' },
          path: 'ocp.catalog.handshake.v1/catalog-manifest.schema.json',
        },
        {
          label: { en: 'Catalog registration schema', zh: 'Catalog 注册 schema' },
          path: 'ocp.catalog.registration.v1/catalog-registration.schema.json',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Serve minimal discovery', zh: '提供最小 discovery' },
          method: 'GET',
          path: '/.well-known/ocp-catalog',
          response: {
            kind: 'WellKnownCatalogDiscovery',
            catalog_id: 'hello_catalog',
            manifest_url: 'https://catalog.example.com/ocp/manifest',
            query_url: 'https://catalog.example.com/ocp/query',
          },
        },
        {
          title: { en: 'Serve minimal query', zh: '提供最小 query' },
          method: 'POST',
          path: '/ocp/query',
          request: {
            example_filed: true,
          },
          response: {
            kind: 'CatalogQueryResult',
            catalog_id: 'hello_catalog',
            result_count: 1,
            items: [
              {
                entry_id: 'hello_entry',
                title: 'hello world! true example filed',
              },
            ],
          },
        },
        {
          title: { en: 'Register minimal catalog to Registration node', zh: '把最小 catalog 注册到 Registration node' },
          method: 'POST',
          path: '/ocp/catalogs/register',
          request: {
            kind: 'CatalogRegistration',
            registration_id: 'my_registration',
            catalog_id: 'hello_catalog',
            registration_version: 1,
            homepage: 'https://catalog.example.com',
            well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
            claimed_domains: ['catalog.example.com'],
            intended_visibility: 'public',
            tags: ['example'],
          },
          response: {
            kind: 'CatalogRegistrationResult',
            status: 'accepted_indexed',
            effective_registration_version: 1,
          },
        },
      ],
    },
  '/examples/minimal-provider': {
      implementationRefs: [
        {
          label: { en: 'Provider registration schema', zh: 'Provider 注册 schema' },
          path: 'ocp.catalog.handshake.v1/provider-registration.schema.json',
        },
        {
          label: { en: 'Commercial object schema', zh: 'CommercialObject schema' },
          path: 'ocp.catalog.handshake.v1/commercial-object.schema.json',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Register minimal provider', zh: '注册最小 provider' },
          method: 'POST',
          path: '/ocp/providers/register',
          request: {
            kind: 'ProviderRegistration',
            catalog_id: 'hello_catalog',
            registration_version: 1,
            provider: {
              provider_id: 'hello_provider',
              entity_type: 'merchant',
              display_name: 'Hello Provider',
            },
            object_declarations: [
              {
                guaranteed_fields: ['hello.example.object.v1#/message'],
                optional_fields: [],
                sync: {
                  preferred_capabilities: ['ocp.push.batch'],
                  avoid_capabilities_unless_necessary: [],
                  provider_endpoints: {},
                },
              },
            ],
          },
          response: {
            kind: 'RegistrationResult',
            status: 'accepted_full',
            effective_registration_version: 1,
          },
        },
        {
          title: { en: 'Sync one provider object', zh: '同步一个 provider 对象' },
          method: 'POST',
          path: '/ocp/objects/sync',
          headers: {
            'x-api-key': '<catalog-object-sync-key>',
          },
          request: {
            kind: 'ObjectSyncRequest',
            catalog_id: 'hello_catalog',
            provider_id: 'hello_provider',
            registration_version: 1,
            batch_id: 'batch_hello_001',
            objects: [
              {
                kind: 'CommercialObject',
                object_id: 'hello_object',
                object_type: 'example',
                provider_id: 'hello_provider',
                title: 'hello world object',
              },
            ],
          },
          response: {
            kind: 'ObjectSyncResult',
            status: 'accepted',
            accepted_count: 1,
            rejected_count: 0,
          },
        },
      ],
    },
  '/examples/registration-flow': {
      implementationRefs: [
        {
          label: { en: 'Registration node API', zh: 'Registration node API' },
          path: 'apps/ocp-registration-api/src/index.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/ocp-registration-api/src/index.ts',
        },
        {
          label: { en: 'Catalog registry service', zh: 'Catalog 注册服务' },
          path: 'packages/registration-core/src/catalog-registry-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/catalog-registry-service.ts',
        },
        {
          label: { en: 'Registration node state persistence schema', zh: 'Registration node 状态持久化 schema' },
          path: 'packages/db/src/schema/registration.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/db/src/schema/registration.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Register catalog into Registration node', zh: '向 Registration node 注册 catalog' },
          method: 'POST',
          path: '/ocp/catalogs/register',
          request: {
            kind: 'CatalogRegistration',
            registration_id: 'ocp_registration_local_dev',
            catalog_id: 'commerce_catalog_local_dev',
            registration_version: 1,
            homepage: 'http://localhost:4000',
            well_known_url: 'http://localhost:4000/.well-known/ocp-catalog',
            claimed_domains: ['localhost'],
            intended_visibility: 'public',
            tags: ['commerce', 'demo'],
          },
          response: {
            kind: 'CatalogRegistrationResult',
            status: 'accepted_indexed',
            effective_registration_version: 1,
            manifest_fetch_status: 'fetched',
            verification_status: 'not_required',
            health_status: 'healthy',
            indexed: true,
            catalog_access_token: '<catalog-token>',
          },
        },
        {
          title: { en: 'Refresh active snapshot', zh: '刷新 active snapshot' },
          method: 'POST',
          path: '/ocp/catalogs/:catalogId/refresh',
          headers: {
            'x-catalog-token': '<catalog-token>',
          },
          request: {},
          response: {
            kind: 'CatalogRefreshResult',
            status: 'refreshed',
            catalog_id: 'commerce_catalog_local_dev',
            snapshot_id: 'catsnap_example_01',
            health_status: 'healthy',
            indexed: true,
            warnings: [],
          },
        },
        {
          title: { en: 'Search the Registration node index', zh: '搜索 Registration node 索引' },
          method: 'POST',
          path: '/ocp/catalogs/search',
          request: {
            query: 'commerce products',
            filters: {
              verification_status: 'not_required',
              health_status: 'healthy',
            },
            limit: 5,
          },
          response: {
            kind: 'CatalogSearchResult',
            result_count: 1,
            items: [
              {
                catalog_id: 'commerce_catalog_local_dev',
                catalog_name: 'Commerce Product Search Catalog',
                verification_status: 'not_required',
                trust_tier: 'declared',
                health_status: 'healthy',
                route_hint: {
                  manifest_url: 'http://localhost:4000/ocp/manifest',
                  query_url: 'http://localhost:4000/ocp/query',
                  resolve_url: 'http://localhost:4000/ocp/resolve',
                },
              },
            ],
          },
        },
      ],
    },
  '/examples/provider-flow': {
      implementationRefs: [
        {
          label: { en: 'Provider API', zh: 'Provider API' },
          path: 'apps/examples/commerce-provider-api/src/index.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/commerce-provider-api/src/index.ts',
        },
        {
          label: { en: 'Provider publishing orchestration', zh: 'Provider 发布编排逻辑' },
          path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/commerce-provider-api/src/provider-service.ts',
        },
        {
          label: { en: 'Provider admin web', zh: 'Provider 管理后台前端' },
          path: 'apps/examples/commerce-provider-admin-web/src/App.tsx',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/commerce-provider-admin-web/src/App.tsx',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Publish provider to catalog in one step', zh: '一步完成 provider 发布到 catalog' },
          method: 'POST',
          path: '/api/provider-admin/provider/publish-to-catalog',
          headers: {
            'x-admin-key': '<provider-admin-key>',
          },
          request: {
            registration_version: 3,
          },
          response: {
            provider_id: 'commerce_provider_local_dev',
            registration_version: 3,
            status: 'succeeded',
            register_run: {
              runType: 'register',
              status: 'succeeded',
              registrationVersion: 3,
              resultPayload: {
                status: 'accepted_full',
                selected_sync_capability: {
                  capability_id: 'ocp.push.batch',
                  reason: 'provider_preferred_and_supported_by_catalog',
                },
              },
            },
            sync_run: {
              runType: 'sync_all',
              status: 'succeeded',
              registrationVersion: 3,
              resultPayload: {
                accepted_count: 5,
                rejected_count: 0,
                status: 'accepted',
              },
            },
          },
        },
        {
          title: { en: 'Inspect provider status and quality feedback', zh: '查看 provider 状态与质量反馈' },
          method: 'GET',
          path: '/api/provider-admin/provider/status',
          headers: {
            'x-admin-key': '<provider-admin-key>',
          },
          response: {
            provider_id: 'commerce_provider_local_dev',
            catalog_id: 'commerce_catalog_local_dev',
            status: 'active',
            active_registration_version: 3,
            next_registration_version: 4,
            local_quality: {
              product_count: 5,
              ready_for_publish_count: 5,
              missing_price_count: 0,
              missing_list_price_count: 1,
              missing_product_url_count: 0,
              missing_image_count: 0,
              missing_brand_or_category_count: 0,
              out_of_stock_count: 0,
              active_count: 5,
            },
            publish_readiness: {
              ready: true,
              blocking_issues: [],
              warnings: ['1 product(s) have no useful list price.'],
            },
            catalog_quality: {
              object_count: 5,
              active_entry_count: 5,
              rich_entry_count: 4,
              standard_entry_count: 1,
              basic_entry_count: 0,
              missing_image_count: 0,
              missing_product_url_count: 0,
              out_of_stock_count: 0,
            },
          },
        },
      ],
    },
  '/examples/user-agent-flow': {
      implementationRefs: [
        {
          label: { en: 'User demo agent backend', zh: '用户 demo agent 后端' },
          path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/ocp-user-demo-api/src/agent-service.ts',
        },
        {
          label: { en: 'User demo web', zh: '用户 demo 前端' },
          path: 'apps/examples/ocp-user-demo-web/src/App.tsx',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/ocp-user-demo-web/src/App.tsx',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Agent-centered OCP turn', zh: '以 agent 为中心的一次 OCP 交互' },
          method: 'POST',
          path: '/api/user-demo/agent/turn',
          request: {
            message: 'I want travel headphones under 150 with images',
            localCatalogProfiles: [],
          },
          response: {
            reply: 'I found a commerce catalog that can search products with price and availability filters. Do you want to register it locally?',
            state: {
              pendingCatalogRegistration: {
                catalog_id: 'commerce_catalog_local_dev',
              },
            },
          },
          note: {
            en: 'The user demo agent digests tool output before replying, rather than exposing raw Registration node or Catalog payloads directly.',
            zh: '用户 demo 中的 agent 会先消化工具调用结果，再向用户转述，而不是直接暴露原始 Registration node 或 Catalog payload。',
          },
        },
      ],
    },
};
