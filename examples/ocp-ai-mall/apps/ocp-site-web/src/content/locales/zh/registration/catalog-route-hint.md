# 目录路由提示（CatalogRouteHint）

`CatalogRouteHint` 是 Registration node 返回给调用方的最小路由摘要。

## 必需字段

```json
{
  "required": [
    "catalog_id",
    "catalog_name",
    "manifest_url",
    "query_url",
    "verification_status",
    "trust_tier",
    "health_status",
    "cache_ttl_seconds",
    "snapshot_id",
    "snapshot_fetched_at"
  ]
}
```

## 示例片段

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "catalog_name": "Commerce Product Search Catalog",
  "description": "English-language commerce product catalog",
  "manifest_url": "http://localhost:4000/ocp/manifest",
  "query_url": "http://localhost:4000/ocp/query",
  "resolve_url": "http://localhost:4000/ocp/resolve",
  "supported_query_packs": ["ocp.query.keyword.v1", "ocp.query.filter.v1", "ocp.query.semantic.v1"],
  "metadata": {
    "query_hints": {
      "supported_query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "supported_query_languages": ["en"],
      "content_languages": ["en"]
    }
  }
}
```

## 为什么要有 Metadata

mode 提示和语言提示很有价值，但它们不是 route hint 的主轴。

因此这些内容被放进 `metadata`，而不是被抬成硬性必填的协议字段。

## Agent 的使用原则

先用 route hint 判断是否应该路由到该 catalog。

如果需要完整搜索能力，再去读取 `manifest_url`。
