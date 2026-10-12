import type { PageArtifactDefinition } from './types';

export const coreArtifacts: Record<string, PageArtifactDefinition> = {
  '/getting-started': {
      implementationRefs: [
        {
          label: { en: 'Catalog registration orchestration', zh: 'Catalog 注册编排' },
          path: 'packages/registration-core/src/catalog-registry-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/catalog-registry-service.ts',
        },
        {
          label: { en: 'Provider registration builder', zh: 'Provider 注册构造器' },
          path: 'apps/examples/commerce-provider-api/src/provider-mapper.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/commerce-provider-api/src/provider-mapper.ts',
        },
        {
          label: { en: 'Provider publish orchestration', zh: 'Provider 发布编排' },
          path: 'apps/examples/commerce-provider-api/src/provider-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/commerce-provider-api/src/provider-service.ts',
        },
      ],
      endpointExamples: [
        {
          title: { en: 'Minimal catalog registration', zh: '最小 catalog 注册示例' },
          method: 'POST',
          path: '/ocp/catalogs/register',
          request: {
            kind: 'CatalogRegistration',
            registration_id: 'my_registration',
            catalog_id: 'my_catalog',
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
        {
          title: { en: 'Minimal provider registration', zh: '最小 provider 注册示例' },
          method: 'POST',
          path: '/ocp/providers/register',
          request: {
            kind: 'ProviderRegistration',
            catalog_id: 'my_catalog',
            registration_version: 1,
            provider: {
              provider_id: 'my_provider',
              entity_type: 'merchant',
              display_name: 'My Provider',
            },
            object_declarations: [
              {
                guaranteed_fields: [
                  'ocp.commerce.product.core.v1#/title',
                  'ocp.commerce.price.v1#/currency',
                  'ocp.commerce.price.v1#/amount',
                ],
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
          title: { en: 'Minimal object sync', zh: '最小对象同步示例' },
          method: 'POST',
          path: '/ocp/objects/sync',
          headers: {
            'x-api-key': '<catalog-object-sync-key>',
          },
          request: {
            kind: 'ObjectSyncRequest',
            catalog_id: 'my_catalog',
            provider_id: 'my_provider',
            registration_version: 1,
            batch_id: 'batch_001',
            objects: [
              {
                kind: 'CommercialObject',
                object_id: 'sku_001',
                object_type: 'product',
                provider_id: 'my_provider',
                title: 'Example product',
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
  '/faq': {
      implementationRefs: [
        {
          label: { en: 'Registration node verification and refresh logic', zh: 'Registration node 验证与刷新逻辑' },
          path: 'packages/registration-core/src/catalog-registry-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/catalog-registry-service.ts',
        },
        {
          label: { en: 'Provider registration state handling', zh: 'Provider 注册状态处理' },
          path: 'packages/catalog-core/src/registration-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/catalog-core/src/registration-service.ts',
        },
        {
          label: { en: 'Object sync runtime checks', zh: '对象同步运行时检查' },
          path: 'packages/catalog-core/src/object-sync-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/catalog-core/src/object-sync-service.ts',
        },
      ],
    },
  '/protocol-principles': {
      implementationRefs: [
        {
          label: { en: 'Protocol docs content source', zh: '协议文档内容源' },
          path: 'apps/ocp-site-web/src/content/docs/protocol-principles.md',
        },
      ],
    },
  '/query-contract-principles': {
      implementationRefs: [
        {
          label: { en: 'Catalog query capability shape', zh: 'Catalog 查询能力结构' },
          path: 'apps/commerce-catalog-api/src/commerce-scenario.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/commerce-catalog-api/src/commerce-scenario.ts',
        },
        {
          label: { en: 'Runtime query mode inference', zh: '运行时 query mode 推断' },
          path: 'apps/commerce-catalog-api/src/query/query-mode.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/commerce-catalog-api/src/query/query-mode.ts',
        },
      ],
    },
  '/routing-principles': {
      implementationRefs: [
        {
          label: { en: 'Registration node projection and route hint shape', zh: 'Registration node 投影与 route hint 结构' },
          path: 'packages/registration-core/src/projection.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/packages/registration-core/src/projection.ts',
        },
        {
          label: { en: 'User agent route selection', zh: '用户 agent 的路由选择逻辑' },
          path: 'apps/examples/ocp-user-demo-api/src/agent-service.ts',
          href: 'https://github.com/Open-Commerce-Protocol/ocp-catalog-instances/blob/main/apps/examples/ocp-user-demo-api/src/agent-service.ts',
        },
      ],
    },
};
