# 目录清单（CatalogManifest）

`CatalogManifest` 是 catalog 对外公开的握手文档。

## 它声明什么

它会告诉 provider 或 agent：

- catalog 是谁
- 哪些 endpoint 是公开的
- 它接受哪些 object contract
- 它暴露哪些 query capability
- 可选：它实际入库了多少 active catalog entry
- 可选：它要求 provider 具备哪些字段
- 可选：它愿意和 provider 协商哪些 sync capability

Catalog Node 不一定要接受 Provider 写入。联盟分佣网络、联邦路由节点、实时 API 目录这类 source catalog，可以只暴露 query 和 resolve 表面。

## Data Profile 形状

`data_profile` 是可选字段，只用于实际持久化 entries 的 Catalog 声明 active 入库数据面规模。

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

`catalog_entry_count` 表示实际入库且处于 active 状态的 catalog entry 数量。对 commerce catalog 来说，可以理解为实际入库商品数；它不代表 search index 已完全追平，也不代表远端平台理论可访问商品数。

Shopify bridge、淘宝推广等实时转发型 Catalog 如果不在本地持久化商品 entry，应直接省略 `data_profile`。

## Endpoint 形状

```json
{
  "endpoints": {
    "health": { "url": "https://catalog.example/ocp/health", "method": "GET" },
    "query": { "url": "https://catalog.example/ocp/query", "method": "POST" },
    "resolve": { "url": "https://catalog.example/ocp/resolve", "method": "POST" },
    "provider_registration": { "url": "https://catalog.example/ocp/providers/register", "method": "POST" },
    "contracts": { "url": "https://catalog.example/ocp/contracts", "method": "GET" },
    "object_sync": { "url": "https://catalog.example/ocp/objects/sync", "method": "POST" },
    "object_sync_stream": { "url": "https://catalog.example/ocp/objects/sync/stream", "method": "POST" },
    "object_sync_run": { "url": "https://catalog.example/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}", "method": "GET" },
    "object_sync_run_complete": { "url": "https://catalog.example/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}", "method": "POST" }
  }
}
```

`endpoints.health` 为了 schema 兼容仍是可选字段，但生产级 catalog 应该暴露它。Registration node 在注册和 refresh 时会优先调用这个 endpoint；旧 manifest 没声明时才降级为 query probe。

协议只强制要求 `endpoints.query` 和 `endpoints.resolve`。`provider_registration`、`object_sync`、`object_sync_stream`、`object_sync_run`、`object_sync_run_complete`、`contracts`、`provider_contract` 只有在 Catalog 实现这些表面时才出现。实时分佣 Catalog 可以完全省略 Provider ingestion endpoints。

health endpoint 返回 `CatalogHealth`：

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogHealth",
  "catalog_id": "hello_catalog",
  "status": "healthy",
  "ready": true,
  "checked_at": "2026-05-17T00:00:00.000Z",
  "details": {},
  "dependencies": []
}
```

Registration 只把 `status: "healthy"` 且 `ready: true` 视为健康检查成功。`degraded` 是诊断状态，在搜索可见性里会按 unhealthy 计数。

## Provider Contract 形状

`provider_contract` 是可选字段。只有当 Catalog 接受 Provider registration 或 object sync 时才需要声明；如果 Catalog 只是可查询、可解析的 source node，应直接省略。

`provider_contract` 包含两个正式部分：

- `field_rules`
- `sync_capabilities`

示例：

```json
{
  "provider_contract": {
    "field_rules": [
      {
        "field_ref": "provider#/display_name",
        "requirement": "required"
      }
    ],
    "sync_capabilities": [
      {
        "capability_id": "ocp.push.batch",
        "direction": "provider_to_catalog",
        "transport": "http_push",
        "sync_model": {
          "snapshot": true,
          "delta": false,
          "stream": true
        },
        "mutation_semantics": {
          "upsert": true,
          "delete": true
        },
        "batching": {
          "enabled": true,
          "max_items": 1000
        },
        "streaming": {
          "enabled": true
        },
        "metadata": {
          "stream_endpoint_path": "/ocp/objects/sync/stream",
          "run_status_endpoint_path": "/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}",
          "run_complete_endpoint_path": "/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}",
          "stream_content_type": "application/x-ndjson"
        }
      }
    ]
  }
}
```

NDJSON streaming 模式下，每个非空行都是一个 `CommercialObject`。Catalog 会把流拆成有界 chunk 提交，每个 chunk 都用 provider 提供的 `batch_id` 加 chunk 序号记录为 sync chunk receipt。传输中断后，provider 必须用同一个 `batch_id` 和相同 chunking 参数重试同一个 stream；已提交 chunk 会按 `request_hash` replay，并通过 index job `dedupe_key` 避免重复建索引任务。改变 chunk 边界属于新的写入请求，已提交 chunk 会按 hash conflict 拒绝。

stream 的 `batch_id` 同时也是 `sync_run_id`。Provider 调用 `object_sync_run` 时必须传入 `provider_id`，因为 `sync_run_id` 按 provider 作用域唯一。Provider 可以查看已提交 checkpoint 后再决定重试。正常读完 stream 后 Catalog 会 complete run。Catalog 在返回 sync 成功前会把 index/activity 副作用写入 durable outbox，因此恢复流程可以修复缺失的下游工作，同时不会重复写商品事实。

## 搜索契约形状

搜索契约通过 `query_capabilities[*].query_packs` 表达。

```json
{
  "query_capabilities": [
    {
      "capability_id": "ocp.commerce.product.search.v1",
      "query_packs": [
        {
          "pack_id": "ocp.query.keyword.v1",
          "query_modes": ["keyword", "hybrid"]
        },
        {
          "pack_id": "ocp.query.filter.v1",
          "query_modes": ["filter", "hybrid"]
        }
      ]
    }
  ]
}
```

协议层真正要求 catalog 声明的是：

- 有哪些 query endpoint
- 有哪些 query capability
- 接受哪些输入字段
- 哪些字段可搜索、可过滤、可排序
- request schema 在哪里

## 运行时示例

commerce catalog 示例的 live manifest 发布一个 provider-facing sync capability：

- `ocp.push.batch`

像 `ocp.feed.url` 这样的保留能力，应在对应传输路径实现后再出现在运行时 manifest 中。

Provider 持续性不通过单独的 `provider_lifecycle` 字段声明，而是从 `sync_capabilities`、provider-hosted endpoint 和 object-level `resolve_policy` 推导。纯 snapshot push 是一次性导入路径；pull、stream、delta、provider-hosted endpoint 或 provider-backed resolve 才表示该能力下存在持续 provider 关系。
