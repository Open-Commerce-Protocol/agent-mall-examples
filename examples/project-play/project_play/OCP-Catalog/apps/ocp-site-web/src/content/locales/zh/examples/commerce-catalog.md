# 电商目录示例（Commerce Catalog Example）

这个仓库现在实现的，不再只是一个协议层 MVP，而是一个更贴近真实商品目录流程的 commerce catalog。

![电商商品数据同步进入 OCP Catalog query 和 resolve 能力面的管线](images/commerce-data-sync-pipeline.png)

## 当前真实示例到底做了什么

现在这套 live example 对应的是下面这些模块的真实行为：

- `apps/commerce-catalog-api`
- `apps/examples/commerce-provider-api`
- `apps/examples/commerce-provider-admin-web`
- `packages/catalog-core`

这个 catalog 会接收电商商品对象，把它们投影成可搜索 entry，计算质量层级，在启用 embedding 时写入向量索引，并返回可 resolve 的商品候选。

## 当前对象契约

当前 catalog 要求 provider 声明至少能保证这些字段：

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

这意味着当前 catalog 已经不再把“只有 title”的对象视为足够真实的商品基线。一个商品至少要有 title 和可用价格字段，才能满足 catalog 的最低 commerce contract。

## 真实 provider registration

当前 provider 实现实际上会声明：

- 保证 `title`
- 保证 `price.currency`
- 保证 `price.amount`
- 保证 `product_url`
- 首选同步能力 `ocp.push.batch`

也就是说，provider 的声明刻意比 catalog 最低门槛更强。这更接近真实 merchant feed：provider 会承诺那些能让搜索结果真正可消费的字段。

在当前仓库里，这份声明是由 provider 本地 mapper 直接构造出来的；demo provider 目前不会先去拉取 catalog manifest / contracts，再动态合成 registration。

## 当前 demo products

provider 自带的 demo 数据包括：

- `electronics-headphones-001`
- `flower-orchid-001`
- `grocery-coffee-001`
- `gift-card-digital-001`
- `service-bike-tuneup-001`

这些对象会被映射成带有三类 descriptor pack 的 `CommercialObject`：

- `ocp.commerce.product.core.v1`
- `ocp.commerce.price.v1`
- `ocp.commerce.inventory.v1`

其中价格 pack 现在已经包含更真实的 commerce 语义，比如 `list_amount` 和 `price_type`；库存 pack 则保留 `out_of_stock` 作为真实商品状态，而不是把它当成删除。

## Catalog 如何为商品建索引

对每个 sync 进来的对象，catalog 现在会生成一份更偏 commerce 的 projection，包含例如：

- `title`
- `summary`
- `brand`
- `category`
- `sku`
- `amount`
- `list_amount`
- `price_type`
- `availability_status`
- `quantity`
- `product_url`
- `primary_image_url`
- `has_image`
- `has_product_url`
- `discount_present`
- `quality_tier`

这份 projection 会被同时用于四个方向：

1. keyword search text
2. structured filtering
3. resolve 时的可见属性
4. 可选的 semantic embedding text

## 当前 query 能力

当前 live commerce query capability 支持：

- `keyword`
- `filter`
- `hybrid`
- 启用 embedding 时支持 `semantic`

当前对外声明的 structured filters 包括：

- `category`
- `brand`
- `currency`
- `availability_status`
- `provider_id`
- `sku`
- `min_amount`
- `max_amount`
- `in_stock_only`
- `has_image`

这就是当前 catalog API 和 user-demo agent 实际使用的字段集合。

## 质量层级

当前 catalog 会为每个商品 entry 计算质量层级：

- `basic`
- `standard`
- `rich`

这个 tier 由真实索引字段推导。例如：

- 有价格 + product URL + inventory + brand/category，可以达到标准商品基线
- 再加上 image + summary + sku，就会升级到 `rich`

这个质量层级会进一步影响排序、provider 质量反馈，以及 resolve 返回内容。

## 真实语义检索链路

当启用 embedding 时，catalog 会把向量写入 `catalog_search_embeddings`，并支持：

- semantic-only retrieval
- hybrid keyword + semantic rerank

仓库里现在还有一条真实 integration test，使用本地 hash embedding provider 锁住这条链路，所以 semantic path 已经是经过验证的实现，不只是 manifest 里的占位字段。

## 当前仓库里的端到端流程

当前已经验证过的真实流程是：

```text
seed provider demo products
-> provider 先读取 catalog 当前 active provider state
-> provider 提交下一版 ProviderRegistration
-> catalog 接受注册并选择 ocp.push.batch
-> provider 发布 CommercialObject batch
-> catalog 生成 projection，并在启用时写入 embedding
-> query 返回带 commerce attributes 的排序结果
-> resolve 返回带可见商品字段和 view_product action 的 ResolvableReference
-> provider status 暴露 local_quality、publish_readiness 和 catalog_quality
```

`view_product` 是当前 commerce example 已经实现的动作。它应该被理解成一种 action binding，而不是 resolve 的能力边界。更完整的电商 catalog 可以暴露 `add_to_cart`、`buy_now` 或 `request_quote`；非电商 catalog 也可以用同样的 resolve 形状暴露预约、投递、邀约或采购动作。

这里还有两个当前实现层面的细节：

- provider runtime 会先根据 catalog 当前 active provider state 计算 `next_registration_version`
- `publish-to-catalog` 是 `registerToCatalog` 再 `syncAll` 的编排 helper，而 `syncAll` 当前按每批 25 条商品切分发送

## 为什么这个示例重要

这套示例现在展示的已经不只是协议 shape，而是一个真实 catalog 实例会做出的 commerce 决策：

- 最低接入 contract 已经强于只有 title 的对象
- provider registration 可以承诺比 catalog 最低要求更丰富的字段
- query 排序同时看文本相关性和商品质量信号
- provider 与 catalog 两侧都暴露 feed quality feedback
- semantic retrieval 已经进入可验证的真实实现路径

