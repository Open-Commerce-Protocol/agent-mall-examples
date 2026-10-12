# 提供方流程（Provider Flow）

这个示例流程描述的是当前仓库里真实存在的 commerce provider 实现。

如果想看平台插件式接入场景，可以看 [Shopify Provider 示例](/examples/shopify-provider)。

## 真实生命周期

![Commerce data 从商家原始记录到 OCP CommercialObject batch、catalog indexing 和 search/resolve 的管线](images/commerce-data-sync-pipeline.png)

```text
provider admin seed 或编辑商品
-> provider 先从 catalog 当前 provider state 推导 next registration_version
-> provider 基于本地 provider mapper 构造 ProviderRegistration
-> catalog 返回 RegistrationResult，并选中 selected_sync_capability = ocp.push.batch
-> provider 发布 CommercialObject batch
-> catalog 把商品数据投影成可搜索 entry
-> provider status 页面显示 local_quality、publish_readiness 和 catalog_quality
```

这里要注意：当前 demo provider 并不会先去拉取 manifest / contracts 再动态生成 declaration。它是在本地构造 registration，然后由 catalog 来决定接受、限缩接受还是拒绝。

## Provider 现在实际发布什么

当前 provider 实现不是在发布匿名对象，而是把本地商品行映射成 `CommercialObject`，其中包含：

- 商品基础字段：`title`、`summary`、`brand`、`category`、`sku`、`product_url`、`image_urls`
- 价格字段：`currency`、`amount`、`list_amount`、`price_type`
- 库存字段：`availability_status`、`quantity`

当前 provider 在 registration 阶段会明确保证：

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`
- `ocp.commerce.product.core.v1#/product_url`

## 当前仓库中的真实行为

在当前 workspace 里：

- provider admin API 可以 seed 更真实的 demo 商品
- provider 可以向 commerce catalog 发起注册
- catalog 会协商出 `ocp.push.batch`
- provider 可以一次发布全部商品，也可以单条同步某个商品
- provider 会先根据 catalog 当前 active provider state 推导 `next_registration_version`
- `syncAll` 当前按每批 25 条商品发送
- publish run 会被记录到 `provider_sync_runs`
- provider admin UI 会展示最近 run、本地 feed 质量、发布前 readiness，以及 catalog 侧的质量反馈

## 当前 `publish-to-catalog` 的真实含义

`POST /api/provider-admin/provider/publish-to-catalog` 是 provider API 上的一层 orchestration helper。它当前会顺序执行：

1. `registerToCatalog`
2. `syncAll`

它返回的响应里会同时带上两条 run record：

- `register_run`
- `sync_run`

所以这个流程示例不是理论上的“握手演示”，而是对真实 provider-side workflow wrapper 的描述。

## Registration 与 Sync 的状态关系

当前实现里，registration 和 sync 是两层不同的运行时状态：

- registration 会写入版本化 `ProviderRegistration` 记录，并且可能更新 provider 的 active contract state
- object sync 只有在 provider 已经拥有 active registration version 时才允许执行
- 每次 sync 请求里的 `registration_version` 必须和当前 active provider contract state 完全一致

也就是说，“记录过 registration” 还不够；如果版本是旧的，或者没有成为 active version，就不能驱动 sync。

## 质量反馈闭环

当前 provider 会暴露三种不同层面的质量视图：

- `local_quality`
  统计 provider 本地商品数据的问题，比如缺价格、缺图片、缺 URL、缺 brand/category。
- `publish_readiness`
  判断 provider 当前是否已经具备可发布的有效商品集合。
- `catalog_quality`
  从 catalog 读回这个 provider 的真实索引结果，包括 `basic`、`standard`、`rich` entry 数量，以及缺图、缺 URL、缺货等统计。

这让 provider flow 更接近真实电商 feed lifecycle，而不是“发成功就算完成”。

## 重要运行规则

- provider 必须先拥有 active registration version，object sync 才能成功。
- `out_of_stock` 不等于删除。商品可以继续保持 active，只是由排序和 filter 决定如何展示。
- 选中的 sync capability 在 registration 阶段协商得出。当前仓库里的 live path 是 `ocp.push.batch`。

## 为什么这个流程重要

当前 provider example 展示的是一种更真实的职责拆分：

- handshake 决定 provider 是否满足 catalog 的最低字段基线
- provider 决定自己的声明和 payload 可以有多丰富
- catalog 决定 sync 之后如何排序、过滤和暴露这些商品
- provider admin 界面再把结果反馈回来，告诉你这个 feed 是“只是被接收”，还是“已经达到高质量目录标准”

同样的 provider 形状也可以被包装成 storefront plugin 或 marketplace app。在这种模型里，商家只需要选择一次目标 catalog，后续由 app 负责 registration、商品映射、batch sync，以及商品变化后的增量同步。

