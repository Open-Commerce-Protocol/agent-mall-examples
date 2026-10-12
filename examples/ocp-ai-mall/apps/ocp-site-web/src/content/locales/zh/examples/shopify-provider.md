# Shopify Provider 示例

这一页描述的是一个 Shopify 店铺作为 provider 接入 OCP Catalog 的场景。

这是一个架构示例，不表示当前仓库已经内置了 Shopify app。

## 场景

一个商家已经有自己的 Shopify 店铺，并希望店铺里的商品可以进入某个指定的 OCP commerce catalog，被 agent 搜索和 resolve。

商家在店铺里安装一个 OCP provider app，选择目标 catalog，授权读取商品数据，然后这个 app 自动把店铺商品发布到该 catalog。

![Provider app 从安装、选择 catalog、拉取 manifest、注册、首次同步到定时同步的 onboarding 流程](images/provider-onboarding-flow.png)

```text
商家安装 OCP provider app
-> app 让商家选择目标 catalog
-> app 读取 catalog manifest 和 object contract
-> app 为这个 Shopify 店铺构造 ProviderRegistration
-> catalog 接受并选择 selected_sync_capability = ocp.push.batch
-> app 把 Shopify 商品映射成 CommercialObject batch
-> app 推送对象到 catalog 的 object sync endpoint
-> catalog 索引商品，用于后续 query 和 resolve
```

## 角色

在这个设置里：

- Shopify 店铺是商家的源系统。
- OCP provider app 是 Provider。
- 目标 commerce catalog 是 Catalog。
- Shopify product record 会变成 `CommercialObject` payload。
- 商品 URL、checkout URL 或 app 自己管理的 deep link 可以变成 resolve action binding。

商家不需要自己运行一套服务器。Provider app 可以是托管服务、定时 worker，或者私有 app backend。

## 商家接入流程

一个实际 onboarding 流程可以是：

1. 商家安装 OCP provider app。
2. 商家输入或选择目标 catalog URL。
3. App 拉取目标 catalog manifest。
4. App 检查 catalog 是否接受 commerce product descriptor。
5. 商家确认允许同步哪些字段。
6. App 提交 `ProviderRegistration`。
7. App 执行首次商品同步。
8. App 后续按商品变化继续同步。

## ProviderRegistration

App 会把 Shopify 店铺注册成一个 merchant provider。

```json
{
  "ocp_version": "1.0",
  "kind": "ProviderRegistration",
  "id": "reg_shopify_store_001_v1",
  "catalog_id": "commerce_catalog_public",
  "registration_version": 1,
  "updated_at": "2026-04-24T00:00:00.000Z",
  "provider": {
    "provider_id": "shopify_store_acme",
    "entity_type": "merchant",
    "display_name": "Acme Shopify Store",
    "homepage_url": "https://acme.example"
  },
  "object_declarations": [
    {
      "object_type": "product",
      "guaranteed_fields": [
        "ocp.commerce.product.core.v1#/title",
        "ocp.commerce.product.core.v1#/product_url",
        "ocp.commerce.price.v1#/currency",
        "ocp.commerce.price.v1#/amount"
      ],
      "optional_fields": [
        "ocp.commerce.product.core.v1#/brand",
        "ocp.commerce.product.core.v1#/category",
        "ocp.commerce.product.core.v1#/image_urls",
        "ocp.commerce.inventory.v1#/availability_status",
        "ocp.commerce.inventory.v1#/quantity"
      ],
      "sync": {
        "preferred_capabilities": ["ocp.push.batch"],
        "avoid_capabilities_unless_necessary": [],
        "provider_endpoints": {}
      }
    }
  ]
}
```

## 商品映射

Provider app 会把每个 Shopify product 或 variant 映射成 OCP `CommercialObject`。

![Commerce data 从商家商品数据经过映射、CommercialObject、batch push、catalog index 到 search/resolve API 的同步管线](images/commerce-data-sync-pipeline.png)

```json
{
  "ocp_version": "1.0",
  "kind": "CommercialObject",
  "id": "obj_shopify_acme_headphones_black",
  "object_id": "shopify://acme/products/834934/variants/112233",
  "object_type": "product",
  "provider_id": "shopify_store_acme",
  "title": "Noise Cancelling Headphones - Black",
  "status": "active",
  "descriptors": [
    {
      "pack_id": "ocp.commerce.product.core.v1",
      "data": {
        "title": "Noise Cancelling Headphones - Black",
        "summary": "Wireless over-ear headphones with active noise cancellation.",
        "brand": "North Audio",
        "category": "electronics",
        "sku": "NA-HP-BLK",
        "product_url": "https://acme.example/products/noise-cancelling-headphones?variant=112233",
        "image_urls": [
          "https://cdn.example.com/products/noise-cancelling-headphones-black.jpg"
        ]
      }
    },
    {
      "pack_id": "ocp.commerce.price.v1",
      "data": {
        "currency": "USD",
        "amount": 129,
        "list_amount": 159,
        "price_type": "current"
      }
    },
    {
      "pack_id": "ocp.commerce.inventory.v1",
      "data": {
        "availability_status": "in_stock",
        "quantity": 42
      }
    }
  ]
}
```

这个映射不要求 catalog 理解 Shopify 的内部 schema。Provider app 负责把店铺字段翻译成 catalog 声明可接收的 descriptor packs。

## Object Sync

Registration 激活之后，app 就可以推送商品 batch：

```json
{
  "ocp_version": "1.0",
  "kind": "ObjectSyncRequest",
  "catalog_id": "commerce_catalog_public",
  "provider_id": "shopify_store_acme",
  "registration_version": 1,
  "batch_id": "shopify_acme_initial_001",
  "objects": [
    "<CommercialObject product 1>",
    "<CommercialObject product 2>"
  ]
}
```

生产级 app 可以支持：

- 安装后的首次全量同步
- 定时同步，保证 catalog 新鲜度
- 在商品、variant、价格、图片或库存变化时由 webhook 触发同步
- 商品下架时同步删除或停用状态

## Resolve 行为

当 agent 后续查询 catalog 并 resolve 一个 Shopify-backed entry 时，catalog 可以返回这些 action binding：

```json
{
  "kind": "ResolvableReference",
  "entry_id": "centry_shopify_acme_headphones_black",
  "object_id": "shopify://acme/products/834934/variants/112233",
  "title": "Noise Cancelling Headphones - Black",
  "visible_attributes": {
    "brand": "North Audio",
    "amount": 129,
    "currency": "USD",
    "availability_status": "in_stock"
  },
  "action_bindings": [
    {
      "action_id": "view_product",
      "action_type": "url",
      "label": "View product",
      "url": "https://acme.example/products/noise-cancelling-headphones?variant=112233",
      "method": "GET"
    },
    {
      "action_id": "buy_now",
      "action_type": "url",
      "label": "Buy now",
      "url": "https://acme.example/cart/112233:1",
      "method": "GET"
    }
  ]
}
```

Catalog 暴露的是下一步动作入口。Shopify 或商家的 storefront 仍然负责 checkout、支付、订单状态、履约、退款和客服。

## 为什么这个示例重要

这是 provider 侧对 catalog 想象力的对应说明：

- 商家继续在自己熟悉的系统里维护商品
- provider app 把这个店铺变成 OCP Provider
- 目标 catalog 接收标准化后的商业对象
- agent 查询 catalog 时不需要理解 Shopify 专有 API
- resolve 仍然可以把用户送回权威 storefront 或 checkout flow

