# 同步能力（Sync Capabilities）

`SyncCapability` 是 Catalog 和 Provider 之间正式的同步协商面。

## 它定义什么

`SyncCapability` 用来定义 Catalog 与 Provider 之间可协商的同步能力。

它可以表达：

- snapshot / delta / stream
- mutation semantics
- batching limits
- endpoint ownership
- endpoint field requirements
- 未来的 bootstrap 或 auth 细节

## Catalog 侧

Catalog 在这里发布 sync capabilities：

```text
CatalogManifest.provider_contract.sync_capabilities[]
```

每个 capability 都通过 `capability_id` 参与匹配。

## Provider 侧

Provider 在这里声明自己的同步意图：

```text
ProviderRegistration.object_declarations[].sync
```

这个声明面刻意保持很小：

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

如果一个 capability 没出现在这两个 capability 列表里，说明这个 provider declaration 没有声明它参与协商。

## Provider 持续性推导

协议不新增独立的 `provider_lifecycle` 字段。Provider 是否需要被视为持续存在，应从已选择的 sync 和 resolve 表面推导。

满足以下任一条件时，Provider 对该能力应被视为 persistent：

- `direction` 是 `catalog_pull_provider`
- `direction` 是 `provider_stream_to_catalog`
- `sync_model.delta` 是 `true`
- `sync_model.stream` 是 `true`
- `endpoint_contract.hosted_by` 是 `provider`
- 匹配的 object contract 在 `resolve_policy.strategies` 中使用 `provider_api`

如果只是纯 `provider_to_catalog` snapshot push，没有 provider-hosted endpoint、没有 delta/stream，也没有 provider-backed resolve，它就是一次性导入。只要身份和来源声明满足 object contract，它仍然可以被信任；但 Catalog 不应该假设后续还能调用这个 provider。

## 示例同步路径

当前 commerce provider 和 catalog 示例协商的是：

```json
{
  "preferred_capabilities": ["ocp.push.batch"],
  "avoid_capabilities_unless_necessary": [],
  "provider_endpoints": {}
}
```

Catalog 随后返回：

```json
{
  "selected_sync_capability": {
    "capability_id": "ocp.push.batch",
    "reason": "provider_preferred_and_supported_by_catalog"
  }
}
```

示例运行路径如下：

```text
register
-> selected_sync_capability = ocp.push.batch
-> provider 发送 batched ObjectSyncRequest payload
-> 大批量导入时，provider 可以向 object_sync_stream 发送 application/x-ndjson
```

streaming 形态仍然是 catalog-hosted push，不要求 provider 暴露长期公网 endpoint。Provider 通过 query 参数传入 `provider_id`、`registration_version`、`batch_id` 和可选 `chunk_size`，然后每行发送一个 `CommercialObject` JSON。Catalog 会按有界 chunk 提交并记录稳定 request hash，因此传输中断后 provider 必须用同一个 `batch_id` 和相同 chunking 参数重试同一个 stream，不会重复提交已完成 chunk，也不会重复创建 index job。改变 chunk 边界属于新的写入请求，已提交 chunk 会按 hash conflict 拒绝。

对于 stream sync，provider 提供的 `batch_id` 同时也是 `sync_run_id`。生产级 Catalog 应暴露 `object_sync_run` endpoint，让 provider 在重试前可以查看已提交 checkpoint。Provider 必须传入 `provider_id`，因为 run identity 按 provider 作用域唯一。已接受 chunk 还必须在同一事务中写入 search indexing、activity event 等 durable side-effect intent；worker 崩溃后，stale claimed outbox work 必须可以重新 claim。

## 预留能力说明

### `ocp.feed.url`

只有当 Catalog 能主动拉取 provider-hosted feed 时，才应该使用它。

实现要求：

- provider 声明 `provider_endpoints.feed_url.url`
- catalog 具备 fetch scheduler
- catalog 能处理 snapshot replacement、retry 和 checksum/etag 逻辑

### `ocp.pull.api`

只有当 Catalog 能直接调用 Provider API 时，才应该使用它。

实现要求：

- provider 暴露 pull endpoint 与分页/游标契约
- catalog 具备 API client、鉴权处理和增量状态跟踪

### `ocp.streaming`

只有当 Catalog 能消费连续变更流时，才应该使用它。

实现要求：

- provider 暴露稳定的 streaming channel 或 webhook 合约
- catalog 具备 reconnect、checkpoint、replay 和幂等消费逻辑

## `provider_endpoints` 形状

`provider_endpoints` 是 endpoint map，不是 bare string map。

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

把 URL 包装成对象后，可以继续扩展 auth override、content type、refresh hint、checksum URL、webhook callback 或 bootstrap metadata。
