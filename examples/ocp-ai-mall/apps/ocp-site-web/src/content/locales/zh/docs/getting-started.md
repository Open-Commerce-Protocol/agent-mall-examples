# 快速接入

这一页是写给想快速参与 OCP 网络建设的人看的。

最常见的参与方式有两种：

- 运行一个 **catalog**，并把它注册到 OCP Catalog Registration node
- 运行一个 **provider**，并把它注册到某个 catalog

## 如果你想把 Catalog 提供给 Registration node

最小情况下，你的 catalog 至少应该提供：

- 一个稳定的 `catalog_id`
- `/.well-known/ocp-catalog` discovery 文档
- `/ocp/manifest` 接口
- `/ocp/query` 接口

如果你的 catalog 还支持 provider 接入，那么通常还要提供：

- `/ocp/providers/register`
- `/ocp/objects/sync`

如果你的 catalog 支持 resolve，则还应提供：

- `/ocp/resolve`

相关协议页建议一起看：

- [CatalogManifest](/handshake/catalog-manifest)
- [CatalogRegistration](/registration/catalog-registration)
- [查询契约原则](/query-contract-principles)

## 最小 Catalog Discovery

```json
{
  "ocp_version": "1.0",
  "kind": "WellKnownCatalogDiscovery",
  "catalog_id": "my_catalog",
  "catalog_name": "My Catalog",
  "manifest_url": "https://catalog.example.com/ocp/manifest",
  "query_url": "https://catalog.example.com/ocp/query",
  "resolve_url": "https://catalog.example.com/ocp/resolve"
}
```

## 最小 Catalog 注册到 Registration node 示例

你的 catalog 可以像普通 HTTP 请求一样把自己注册到 Registration node：

```ts
await fetch('https://registration.example.com/ocp/catalogs/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'catreg_my_catalog_v1',
    registration_id: 'my_registration',
    catalog_id: 'my_catalog',
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

## 最小实现指南

真正的最小实现现在已经拆成独立的 example 页面：

- [构建一个最小 Catalog](/examples/minimal-catalog)
- [构建一个最小 Provider](/examples/minimal-provider)

这两页会直接给出：

- 最小可运行代码
- 最小生命周期
- 具体的 registration 或 sync 请求形状

## 如果你想作为 Provider 接入 Catalog

在当前以 push 为主的 handshake 模型里，一个最小 provider 至少应当能做到：

- 选择目标 `catalog_id`
- 构造一份版本化 `ProviderRegistration`
- 把这份 registration 发到 `/ocp/providers/register`
- 把具体对象发到 `/ocp/objects/sync`

在当前仓库的主示例里，provider **不需要**为了注册和同步而额外暴露自己的公网 API，因为当前协商出来的 sync capability 是 `ocp.push.batch`，同步入口由 catalog 自己托管。

## 最小 Provider Registration

```ts
await fetch('https://catalog.example.com/ocp/providers/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: 'reg_my_provider_v1',
    catalog_id: 'my_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: 'my_provider',
      entity_type: 'merchant',
      display_name: 'My Provider',
      homepage: 'https://provider.example.com',
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
        ],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/product_url',
        ],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  }),
});
```

## 最小 Object Sync

```ts
await fetch('https://catalog.example.com/ocp/objects/sync', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': '<catalog-object-sync-key>',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: 'my_catalog',
    provider_id: 'my_provider',
    registration_version: 1,
    batch_id: 'batch_001',
    objects: [
      {
        ocp_version: '1.0',
        kind: 'CommercialObject',
        id: 'obj_001',
        object_id: 'sku_001',
        object_type: 'product',
        provider_id: 'my_provider',
        title: 'Example product',
        status: 'active',
        descriptors: [
          {
            pack_id: 'ocp.commerce.product.core.v1',
            data: {
              title: 'Example product',
              product_url: 'https://provider.example.com/products/sku_001',
            },
          },
          {
            pack_id: 'ocp.commerce.price.v1',
            data: {
              currency: 'USD',
              amount: 19.99,
            },
          },
        ],
      },
    ],
  }),
});
```

## 实际准备清单

### 对 Catalog Builder 来说

- 先确定你的 `catalog_id`
- 暴露 discovery、manifest 和 query 接口
- 决定是否支持 provider 接入
- 选择要注册到哪个或哪些 Registration node
- 决定你只是本地开发接入，还是要做公开可验证接入

### 对 Provider Builder 来说

- 先确定你要接入哪个 catalog
- 了解该 catalog 的 required fields 和 supported sync capabilities
- 选择一个稳定的 `provider_id`
- 对 registration 做版本管理
- 建立一条稳定、可重复的数据映射链路，把你的源数据映射成 `CommercialObject`

## 生命周期速览

### Catalog 生命周期

```text
catalog 进程启动
-> catalog 对外提供 discovery + manifest + query
-> catalog 注册到 Registration node
-> Registration node 拉取并校验 catalog metadata
-> Registration node 建立可路由索引
-> agent 通过 route hint 发现这个 catalog
```

### Provider 生命周期

```text
provider 准备源数据
-> provider 提交 ProviderRegistration
-> catalog 接受或拒绝 registration
-> provider 同步对象
-> catalog 把这些对象投影成可搜索 entry
```

## 下一步推荐阅读

- [角色](/roles)
- [ProviderRegistration](/handshake/provider-registration)
- [CatalogRegistration](/registration/catalog-registration)
- [最小 Catalog](/examples/minimal-catalog)
- [最小 Provider](/examples/minimal-provider)
- [提供方流程](/examples/provider-flow)
- [注册流程](/examples/registration-flow)
- [FAQ](/faq)
