# 构建一个最小 Catalog

这一页演示的是，怎样实现一个最小但仍然真正可参与 OCP 协议的 catalog。

目标被故意收得很窄：

- 一个稳定的 `catalog_id`
- 一个 discovery 文档
- 一个 manifest
- 一个 health 接口
- 一个 query 接口
- 一次向 Registration node 发起的 registration 请求

## 这个最小 Catalog 支持什么

这里的 query contract 被故意做得很小：

- 只有一个请求字段：`example_filed`
- 类型：`boolean`
- 只返回一个确定性的固定对象

当 `example_filed = true` 时，catalog 返回：

```text
hello world! true example filed
```

当 `example_filed = false` 时，返回：

```text
hello world! false example filed
```

## 最小运行时

```ts
import { Elysia } from 'elysia';

const baseUrl = 'https://catalog.example.com';

new Elysia()
  .get('/.well-known/ocp-catalog', () => ({
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: 'hello_catalog',
    catalog_name: 'Hello Catalog',
    manifest_url: `${baseUrl}/ocp/manifest`,
    health_url: `${baseUrl}/ocp/health`,
    query_url: `${baseUrl}/ocp/query`,
  }))
  .get('/ocp/manifest', () => ({
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    catalog_id: 'hello_catalog',
    catalog_name: 'Hello Catalog',
    description: '一个只包含单个布尔查询字段的最小示例 catalog。',
    endpoints: {
      health: {
        url: `${baseUrl}/ocp/health`,
        method: 'GET',
      },
      query: {
        url: `${baseUrl}/ocp/query`,
        method: 'POST',
      },
    },
    query_capabilities: [
      {
        capability_id: 'hello.example.query.v1',
        query_packs: [
          {
            pack_id: 'hello.example.query.v1',
            query_modes: ['filter'],
          },
        ],
        supports_explain: true,
        supports_resolve: false,
        metadata: {
          query_contract: {
            type: 'object',
            properties: {
              example_filed: {
                type: 'boolean',
              },
            },
          },
        },
      },
    ],
    object_contracts: [],
  }))
  .get('/ocp/health', () => ({
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: 'hello_catalog',
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
    details: {},
    dependencies: [],
  }))
  .post('/ocp/query', async ({ body }) => {
    const request = typeof body === 'object' && body ? body as Record<string, unknown> : {};
    const exampleFiled = request.example_filed === true;

    return {
      ocp_version: '1.0',
      kind: 'CatalogQueryResult',
      catalog_id: 'hello_catalog',
      result_count: 1,
      entries: [
        {
          entry: {
            kind: 'CatalogEntry',
            catalog_id: 'hello_catalog',
            entry_id: 'hello_entry',
            object_id: 'hello_object',
            object_type: 'example',
            provider_id: 'hello_catalog',
            title: `hello world! ${exampleFiled} example filed`,
            attributes: {
              message: `hello world! ${exampleFiled} example filed`,
            },
          },
          score: 1,
          explain: [],
        },
      ],
      explain: [
        `example_filed = ${exampleFiled}`,
      ],
    };
  })
  .listen(4000);
```

## 为什么这已经足够

这个很小的服务其实已经满足了 catalog 的核心责任：

- Registration node 可以从 `/.well-known/ocp-catalog` 拉 discovery
- Registration node 可以从 `/ocp/manifest` 拉 manifest
- Registration node 可以通过 `/ocp/health` 检查 ready 状态
- agent 可以从 manifest metadata 读到 query contract
- agent 可以实际调用 `/ocp/query`

它并不丰富，但它已经是一个真正参与协议的 catalog。

## 把 Catalog 注册到 Registration node

当 catalog 在线后，注册只是一条普通的 HTTP 请求：

```ts
await fetch('https://registration.example.com/ocp/catalogs/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'catreg_hello_catalog_v1',
    registration_id: 'my_registration',
    catalog_id: 'hello_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: 'https://catalog.example.com',
    well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
    claimed_domains: ['catalog.example.com'],
    intended_visibility: 'public',
    tags: ['example'],
  }),
});
```

## 生命周期

```text
catalog 进程启动
-> 对外提供 discovery + manifest + health + query
-> 向 Registration node 提交 CatalogRegistration
-> Registration node 拉取 discovery 和 manifest
-> Registration node 调用 manifest 声明的 health endpoint
-> agent 开始把 query 路由到 /ocp/query
```

## 实践说明

- 本地开发时，这个实例可以直接跑在 `localhost`。
- 如果要参与公开 Registration node，通常还是要准备稳定域名和 HTTPS。
- catalog 通常需要常驻，因为 agent 会直接查询它。
- `operator` 只是可选元数据，不是注册前提。

## 相关页面

- [快速接入](/getting-started)
- [CatalogManifest](/handshake/catalog-manifest)
- [CatalogRegistration](/registration/catalog-registration)
- [注册流程](/examples/registration-flow)
