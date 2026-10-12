# ocp.catalog.handshake.v1

`ocp.catalog.handshake.v1` 定义 `Provider -> Catalog Node` 的最小握手层。

它负责冻结三类内容：

1. Catalog 如何暴露自己的 manifest、query 能力和可选的 provider 接入面
2. Catalog 如何声明对象契约
3. Provider 如何提交版本化注册声明并协商 sync capability

它不负责冻结完整的 sync/query/resolve payload，也不负责 Registration node 注册、联邦路由或交易流程。

## Scope

这个包当前冻结的对象包括：

- `CatalogManifest`
- `CatalogHealth`
- `ObjectContract`
- `ProviderRegistration`
- `CommercialObject`
- `RegistrationResult`
- `FieldRef`
- `FieldRule`
- `SyncCapability`
- commerce product descriptor packs

文件结构：

```text
ocp.catalog.handshake.v1/
├── package.json
├── common.schema.json
├── catalog-manifest.schema.json
├── catalog-health.schema.json
├── object-contract.schema.json
├── provider-registration.schema.json
├── commercial-object.schema.json
├── registration-result.schema.json
├── pack.ocp.commerce.product.core.v1.schema.json
├── pack.ocp.commerce.price.v1.schema.json
└── pack.ocp.commerce.inventory.v1.schema.json
```

## Boundary

这个包**不**冻结：

- `ObjectSyncRequest` / `ObjectSyncResult`
- `CatalogQueryRequest` / `CatalogQueryResult`
- `ResolveRequest` / `ResolvableReference`
- auth / payment / fulfillment / federation

当前仓库里的这些运行时对象仍由 `packages/ocp-schema` 维护，后续可以拆成：

- `ocp.catalog.sync.v1`
- `ocp.catalog.query.v1`
- `ocp.catalog.resolve.v1`

## CatalogManifest

`CatalogManifest` 的职责是让 Provider 和 Agent 知道：

- Catalog 的 identity
- 公开 endpoint
- 接受哪些对象契约
- 暴露哪些查询能力
- 可选声明实际入库的 catalog entry 数量
- 可选暴露哪些 provider-facing sync capabilities

`CatalogManifest` 只强制要求 query 和 resolve endpoints。`provider_registration`、
`object_sync` 和 `provider_contract` 是可选能力，用于接受 Provider 写入的
Catalog；实时 source catalog（例如联盟分佣目录）可以只提供 query/resolve。

### Data Profile Structure

Catalog 可以通过顶层 `data_profile` 可选声明本节点实际持久化的 active entry 数据规模：

```json
{
  "data_profile": {
    "catalog_entry_count": 10000000,
    "object_counts": [
      { "object_type": "product", "count": 10000000 }
    ],
    "counted_at": "2026-06-06T00:00:00.000Z"
  }
}
```

`catalog_entry_count` 表示实际入库且处于 active 状态的 catalog entry 数量，不表示 search index 已完全追平，也不表示远端平台理论可访问商品数。
Shopify catalog、淘宝推广等只转发实时请求、不持久化商品数据的 source catalog 应直接省略
`data_profile`，不要填 `0` 来模拟未知规模。

### Query Capability Structure

当前结构里，查询能力的主表达方式是：

- `query_packs`

而不是顶层 `query_modes`。

也就是说，Catalog 告诉调用方“怎么搜”的主信息是：

```text
query_capabilities[*].query_packs[*]
```

每个 query pack 可以声明：

- `pack_id`
- `description`
- `query_modes`
- `request_schema_uri`
- `metadata`

这里的 query capability 只负责声明 Catalog 提供什么查询方法和 schema，不负责约束 Catalog 内部必须按什么协议级对象分类来执行 query。

### Provider Sync Capability Structure

当前结构里，Provider 与 Catalog 的同步协商主表达方式是：

- `provider_contract.sync_capabilities[*].capability_id`

能力协商的关键约束是：

- `capability_id` 是主协商键
- `direction` 是数据流向类别
- `transport` 只是实现形态标签，不参与主协商

当前官方基线能力命名建议包括：

- `ocp.push.all`
- `ocp.push.batch`
- `ocp.feed.url`
- `ocp.pull.api`
- `ocp.streaming`

当前仓库真实实现并验证的是：

- `ocp.push.batch`

Provider 的持续存在性不作为独立 `provider_lifecycle` 字段声明，而是从 sync/resolve
能力推导：

- `direction: "catalog_pull_provider"`、`direction: "provider_stream_to_catalog"`、
  `sync_model.delta: true`、`sync_model.stream: true` 或
  `endpoint_contract.hosted_by: "provider"` 表示 Catalog 后续依赖 Provider 继续可访问，
  因此该 Provider 对该能力是 persistent。
- 只有 `provider_to_catalog` + snapshot push，且没有 provider-hosted endpoint、delta、
  stream 或 provider-backed resolve 依赖时，可以作为 one-shot import 处理。
- 不要新增长期 `provider_lifecycle` 字段；如果某个实现需要补充说明，应放入
  capability `metadata`，不参与核心协商。

## ObjectContract

`ObjectContract` 定义 Catalog 对某类输入契约的接入要求。

它回答：

- 必需哪些 `required_fields`
- 哪些 `optional_fields` 可选
- 哪些字段必须满足
- 对额外字段的处理策略
- 接受哪些 identity key，以及如何信任 Provider 提供的 SKU
- 接受哪些 authority/provenance 类型
- 支持或要求哪些 resolve strategy

`ObjectContract` 不再承载 sync mode / registration mode。

ProviderRegistration 的匹配基于 `guaranteed_fields` 与 `required_fields` 的直接比对。

当前仓库里的 commerce catalog 已经把最小接入基线提升到：

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`

而当前 provider 默认 registration 还会额外保证：

- `ocp.commerce.product.core.v1#/product_url`

这说明当前示例的目标已经不是“任意对象先接进来”，而是更接近一个真实商品目录最小基线。

### Identity / Provenance / Resolve Policy

`ObjectContract.field_usage_policy` 是 Catalog 对字段用途的声明。Catalog 应明确哪些字段
用于：

- `identity`
- `index`
- `filter`
- `rank`
- `display`
- `explain`
- `search_visible`
- `resolve_visible`
- `never_expose`

这使 Catalog 可以只索引检索需要的投影字段，同时把完整详情保留在 Provider 或来源处。
例如 provider SKU 可以用于身份或过滤，但标记为 `never_expose`，避免直接出现在 search
response 中。

`ObjectContract.identity_policy` 是 Catalog 对去重和身份锚点的声明。它可以接受：

- `provider_object_id`
- `provider_sku`
- `external_source_key`
- `canonical_url`
- `content_hash`

`provider_sku` 不是默认可信身份。Catalog 应通过 `provider_sku_trust` 声明它是：

- `not_accepted`
- `accepted_as_claim`
- `requires_verified_provider`

`ObjectContract.provenance_requirements` 声明 Catalog 接受哪些权威来源形态：

- `provider_authoritative`：Provider 自身就是权威来源，不要求外部上架或 source URL。
- `external_source`：对象来自外部站点、平台或 URL。
- `imported_snapshot`：一次性导入的快照。
- `source_proxy`：Catalog 实时代理上游来源。

`ObjectContract.resolve_policy` 声明 Resolve 可以走哪些策略：

- `provider_api`
- `source_url`
- `catalog_cached`
- `unavailable`

这些是 OCP Catalog core 能力；commerce 的 SKU、source_product_id、source_variant_id、
价格、库存和图片字段属于 commerce descriptor pack 或具体 Catalog 实现。

## ProviderRegistration

`ProviderRegistration` 是 Provider 的版本化声明。

更新规则：

- key 为 `catalog_id + provider.provider_id`
- Provider 通过提交完整的新 `ProviderRegistration` 更新声明
- 新版本必须提高 `registration_version`
- `updated_at` 用于审计，不用于版本优先级判断

### Provider Sync Declaration

`ProviderRegistration.object_declarations[].sync` 当前收敛成三部分：

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

这里没有单独的 `supported_capabilities`。

这里也没有单独的 `disallowed_capabilities`。

如果一个 capability 没出现在这两个 capability 列表中，它就不参与协商。

`ProviderRegistration.object_declarations[*]` 的协议级匹配由 Catalog 根据 declaration 提供的字段保证去匹配自己的 `ObjectContract`。

之所以只做字段级匹配，是因为握手层的职责是判断 Provider 是否满足 Catalog 的最低接入条件，而不是要求双方先共享同一套对象分类命名。

这意味着协议层只回答两件事：

- Provider 能否保证 Catalog 所要求的字段
- Provider 与 Catalog 是否能协商出一条共同可用的 sync capability

它不要求 Provider 先声明某个协议级对象类型，也不要求 Catalog 在握手阶段暴露自己的内部索引分桶方式。对象分类、索引模型、query 分区和运行时 projection 仍然属于 Catalog 自己的实现边界。

因此，字段级握手不是契约不完整，而是刻意把协议主轴收敛到最稳定、最可验证、最不依赖命名体系的一层。

在当前仓库里，这种字段级握手对应的真实 commerce 示例是：

- catalog 只要求商品最小接入字段
- provider 可以声明比 catalog 最低要求更强的 guaranteed fields
- query、projection、ranking、resolve 这些更具体的商品行为都留在 catalog 实现边界内

`provider_endpoints` 采用 endpoint map 结构，值必须是对象，而不是裸字符串。例如：

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

## RegistrationResult

`RegistrationResult` 是 Provider registration 的结构化反馈。

它至少会表达：

- `status`
- `effective_registration_version`
- `matched_object_contract_count`
- `selected_sync_capability`
- `warnings`
- `missing_required_fields`

其中 `selected_sync_capability` 明确告诉 Provider：

- Catalog 最终选择了哪条 sync capability
- 为什么选中它

当前仓库里的默认 commerce provider/catalog 组合，真实成功路径通常是：

- `status = accepted_full`
- `matched_object_contract_count = 1`
- `selected_sync_capability.capability_id = ocp.push.batch`
- `warnings = []`

## Current Repository Mapping

当前仓库里的 provider/catalog 示例链路应理解为：

```text
ProviderRegistration.guaranteed_fields
  includes title + price.currency + price.amount + product_url
  -> registration accepted_full
  -> RegistrationResult.selected_sync_capability = ocp.push.batch
  -> provider sends batched ObjectSyncRequest payloads to /ocp/objects/sync
  -> catalog projects them into commerce search entries with price, image, inventory, and quality signals
```

也就是说，当前样例实现已经切到 capability negotiation，但真实跑通的交互形态仍然是 catalog-hosted push batch sync。

## Reserved Capability Implementation Guidance

下列能力应在文档中明确视为“协议预留能力”，只有在实现完成后才应出现在运行时 manifest 中：

- `ocp.feed.url`
  - Catalog 需要有定时拉取器
  - Provider 需要在 `provider_endpoints.feed_url.url` 暴露快照源
  - Catalog 需要处理 checksum / refresh / full snapshot replacement
- `ocp.pull.api`
  - Catalog 需要 API client、鉴权能力和分页/游标拉取逻辑
  - Provider 需要暴露 bootstrap endpoint 与增量游标约定
- `ocp.streaming`
  - Catalog 需要持续连接、重连、游标恢复和幂等消费
  - Provider 需要暴露 stream endpoint / webhook / event checkpoint 机制

这些能力的协商主键仍然是 `capability_id`，不是 `transport`。

## Discovery

Catalog 应公开：

```http
GET /.well-known/ocp-catalog
```

well-known 至少应指向：

- manifest
- contracts
- provider registration
- object sync
- query
- resolve

## Relationship To Registration

这个包只处理：

```text
Provider -> Catalog Node
```

Catalog 注册到 Registration node 使用的是：

- `ocp.catalog.registration.v1`

详见：

- [../ocp.catalog.registration.v1/README.md](../ocp.catalog.registration.v1/README.md)
- [../docs/specs/handshake/v1.md](../docs/specs/handshake/v1.md)
