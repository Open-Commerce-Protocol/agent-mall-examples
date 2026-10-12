# 对象契约（ObjectContract）

`ObjectContract` 定义 catalog 发布的字段级接收边界。

## 它控制什么

一个 object contract 表达：

- 必需字段要求
- 可选字段引用
- additional field policy
- 字段使用策略，说明字段是否用于检索、可见性和解释
- 身份策略，用于去重和 provider 提供的 key
- 来源权威要求，用于声明接受哪些 authority type
- resolve 策略，用于声明搜索后如何解析详情引用

## Schema 片段

```json
{
  "required": ["required_fields"],
  "properties": {
    "required_fields": { "type": "array" },
    "optional_fields": { "type": "array" },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    },
    "field_usage_policy": [
      {
        "field_ref": "ocp.commerce.product.core.v1#/sku",
        "requirement": "optional",
        "usage": ["identity", "filter", "never_expose"]
      }
    ],
    "identity_policy": {
      "accepted_identity_keys": ["provider_object_id", "provider_sku"]
    },
    "provenance_requirements": {
      "accepted_authority_types": ["provider_authoritative", "imported_snapshot"]
    },
    "resolve_policy": {
      "strategies": ["provider_api", "catalog_cached"]
    }
  }
}
```

## 必需字段组

`required_fields` 中的每一项可以是：

- 一个单独的 `FieldRef`
- 一个 `FieldRef[]`，表示“这一组字段至少满足一个”

示例：

```json
[
  "ocp.commerce.product.core.v1#/title",
  [
    "ocp.commerce.price.v1#/amount",
    "provider#/price_text"
  ]
]
```

## 字段引用

字段引用通过 `FieldRef` 指向具体字段。

示例：

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

这样 contract 就能直接按字段表达兼容条件，而不需要额外引入 provider-facing pack 协商。

## 字段使用策略

`field_usage_policy` 告诉 agent 和 provider：Catalog 接受的字段到底会被用于检索、排序、展示、解释还是 resolve。

常见 usage 包括：

- `identity`
- `index`
- `filter`
- `rank`
- `display`
- `explain`
- `search_visible`
- `resolve_visible`
- `never_expose`

一个字段可以只用于去重或过滤，但不出现在搜索结果中。例如 provider SKU 可以作为身份声明被接受，同时标记为 `never_expose`。

预览媒体应建模成 display/search-visible 投影。Commerce catalog 可以接受 `ocp.commerce.product.core.v1#/image_urls`，并把第一张可用图片投影到 `CatalogEntry.image_url` 作为候选卡片预览；完整图片列表仍保留在 descriptor 或 Resolve 详情中。

## 身份、来源与 Resolve

`identity_policy` 是 catalog 对身份锚点和去重规则的声明。`provider_sku` 不会被自动信任；catalog 可以要求 provider 已验证后，才允许把 provider 提供的 SKU 用作身份 key。

`provenance_requirements` 声明 catalog 接受哪些权威来源形态：

- `provider_authoritative`
- `external_source`
- `imported_snapshot`
- `source_proxy`

Provider 本身可以是权威来源。对象不一定需要在外部站点上架，除非 catalog contract 明确要求外部 source key。

`resolve_policy` 声明匹配到的 entry 如何变成 `ResolvableReference`：

- `provider_api`
- `source_url`
- `catalog_cached`
- `unavailable`

这些策略属于 OCP Catalog core。品牌、类目、SKU、价格、库存、商品 URL、平台商品 ID 等 commerce 字段，属于 commerce descriptor pack 或具体 catalog 实现。

## Commerce Contract 示例

当前仓库里的第一个 catalog 暴露的是：

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title",
    "ocp.commerce.price.v1#/currency",
    "ocp.commerce.price.v1#/amount"
  ],
  "optional_fields": [
    "ocp.commerce.product.core.v1#/summary",
    "ocp.commerce.product.core.v1#/brand",
    "ocp.commerce.product.core.v1#/category",
    "ocp.commerce.product.core.v1#/sku",
    "ocp.commerce.product.core.v1#/product_url",
    "ocp.commerce.product.core.v1#/image_urls",
    "ocp.commerce.inventory.v1#/availability_status",
    "ocp.commerce.inventory.v1#/quantity"
  ],
  "additional_fields_policy": "allow"
}
```

因此最小注册条件是：

- 保证 `ocp.commerce.product.core.v1#/title`
- 保证 `ocp.commerce.price.v1#/currency`
- 保证 `ocp.commerce.price.v1#/amount`

当前仓库里的 provider 示例实际上还会额外保证 `ocp.commerce.product.core.v1#/product_url`。

这属于实现选择，而不是协议强制要求。catalog 发布的是自己做 commerce 索引所需的最低条件，而 provider 可以承诺更丰富的 payload。

同步传输路径通过 `sync_capabilities` 单独协商。
