# 握手概览（Handshake Overview）

`ocp.catalog.handshake.v1` 是 Provider 和 Catalog 节点之间的最小握手层。

## 它负责什么

这个 handshake package 定义：

- catalog manifest 发现
- object contract
- provider registration
- provider-facing sync capability negotiation
- 共享的 commercial object 包络
- registration feedback

## 它不负责什么

这个 package **不**冻结：

- object sync request envelope
- catalog query request envelope
- resolve request envelope
- Registration node registration

这些关注点不属于 handshake package 本身。

## 核心问题

握手层回答四个问题：

1. 这个 catalog 是什么类型？
2. 它接受哪些 object contract？
3. 它愿意协商哪些同步能力？
4. Provider 如何声明自己的供给能力和同步偏好？

## Package 范围

```text
CatalogManifest
ObjectContract
ProviderRegistration
CommercialObject
RegistrationResult
FieldRef
FieldRule
SyncCapability
```

## 示例握手流程

```text
GET /.well-known/ocp-catalog
-> 获取 manifest
-> 查看 contracts
-> 查看 provider_contract.sync_capabilities
-> POST provider registration
-> 收到带 selected_sync_capability 的 registration result
-> 如果选中的是 catalog-hosted push，则开始 object sync
```

在当前仓库里，这条流程会收敛成一个更具体的 commerce path：

```text
provider 保证 title + price.currency + price.amount + product_url
-> catalog 匹配 commerce ObjectContract
-> catalog 选择 ocp.push.batch
-> provider 推送带有 product core、price、inventory descriptor pack 的 CommercialObject batch
```

## 同步能力协商

握手协议通过命名 capability 协商同步路径。

关键规则是：

- `capability_id` 是协商主键
- `direction` 是正式的数据流向类别
- `transport` 只是描述性的实现形态标签

协议保留的基线命名空间是 `ocp.*`。

示例：

- `ocp.push.all`
- `ocp.push.batch`
- `ocp.feed.url`
- `ocp.pull.api`
- `ocp.streaming`

仓库示例运行时实现并发布的是：

- `ocp.push.batch`

像 `ocp.feed.url`、`ocp.pull.api`、`ocp.streaming` 这样的保留能力，只有在对应运行时路径真正实现后，才应该出现在 live manifest 中。

## 搜索能力形状

在 `CatalogManifest` 中，搜索契约通过 `query_packs` 表达。

```json
{
  "capability_id": "ocp.commerce.product.search.v1",
  "query_packs": [
    {
      "pack_id": "ocp.query.keyword.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"]
        }
      }
    }
  ]
}
```

这个结构的含义是：

- `query_packs` 定义 agent 应该如何搜索
- `query_modes` 绑定在 pack 上
- 扩展提示放在 `metadata` 中

handshake package 不要求所有 catalog 共享一个协议级 query 分类轴。query 语义应以 catalog 自己声明的 contract 为准。

在当前 commerce catalog 实现里，真实 query capability 比上面的最小片段更丰富：

- keyword、filter、hybrid 会始终暴露
- semantic 只会在启用 embedding provider 时暴露
- 当前声明的 commerce filters 包括 `category`、`brand`、`currency`、`availability_status`、`provider_id`、`sku`、`min_amount`、`max_amount`、`in_stock_only`、`has_image`
