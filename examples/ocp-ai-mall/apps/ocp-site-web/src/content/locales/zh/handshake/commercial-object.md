# 商业对象（CommercialObject）

`CommercialObject` 是同步进 Catalog 的通用对象包络。

## 目标

它为 Catalog 提供一个稳定的外层结构，同时把领域细节交给 descriptor packs。

它不是完整的商品详情 schema。Catalog 可以把 `CommercialObject` 投影成可检索的 `CatalogEntry`，并返回排序、解释、来源、可信度和 resolve 所需的最小上下文。更详细的商品状态仍然可以保留在 provider API 或原始来源处。

## 必需字段

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "object_id",
    "object_type",
    "provider_id",
    "title",
    "descriptors"
  ]
}
```

## 描述符片段

```json
{
  "provenance": {
    "authority_type": "provider_authoritative",
    "provider_id": "commerce_provider_local_dev",
    "verification_status": "verified",
    "trust_tier": "verified"
  },
  "descriptors": [
    {
      "pack_id": "ocp.commerce.product.core.v1",
      "schema_uri": "https://ocp.dev/schema/...",
      "data": {
        "title": "Wireless Noise Cancelling Headphones"
      }
    }
  ]
}
```

## 来源记录

`provenance` 是 OCP core 记录。它回答这个对象的权威方是谁，以及 Catalog 可以如何信任这个声明。

支持的 authority shape 包括：

- `provider_authoritative`
- `external_source`
- `imported_snapshot`
- `source_proxy`

`source_url` 是可选字段。Provider 本身可以是权威来源，不要求对象同时在其它平台上架。如果对象来自 Shopify、淘宝或其它平台，应通过 provenance 里的 `external_source`、`source_site`、`source_uri` 和 source IDs 表达，而不是把这些内容提升为 core 商品字段。

## 为什么需要描述符

`CommercialObject` 没有把所有商品细节做成一个固定 schema，而是允许 pack 承载领域数据。

这样 Catalog 可以：

- 分 pack 校验
- 把关键字段投影到本地索引
- 保持 pack 级别的扩展能力

## Search 与 Resolve 边界

Catalog search 应返回候选对象、摘要、排序/解释信号、新鲜度、可信度和 resolve reference，不需要返回 provider 的完整详情字段。

Resolve 再返回有权限的详情、实时检查、action binding，或 provider/source 引用。这样持久化 catalog、一次性导入 catalog 和实时转发 catalog 可以共享同一个对象包络，而不强迫 Catalog 变成 provider 的完整商品数据库。

## 仓库中的例子

当前 demo commerce catalog 会把 pack 数据投影到 catalog entry 中，用于：

- keyword 搜索
- 结构化 filter
- semantic embedding text
