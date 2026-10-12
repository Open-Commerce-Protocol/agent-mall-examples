---
title: WooCommerce 集成概览
description: 把已运行的 WooCommerce 店铺翻译成 OCP 协议面，让 Agent 通过统一接口与商家协作，而不直接对接私有 REST API。
category: integrations
order: 1
---

# WooCommerce 集成概览

> 本页给出 WooCommerce 接入 OCP 的三层边界、推荐部署模式与关键数据映射。它**不是**插件开发手册——是一份让产品 / 架构 / 商家技术对齐的设计概览。

## 一句话解释

WooCommerce OCP Integration 不是替代 WooCommerce，而是把一家已经在运行的 WooCommerce 店铺**翻译**成 OCP 协议面——让 Agent 通过统一的 discovery / query / resolve / checkout / order 接口与商家协作，而不再直接对接 WooCommerce 的私有 REST API。

## 解决的问题

- 不同商家平台（WooCommerce、Shopify、Magento、自研商城）的私有 API 形状各异，Agent 逐家对接成本不可控；
- 商家自己的商品、价格、库存、配送、订单仍是权威，不该被 Agent 拷贝出去再"伪商业"地下单；
- 商家也需要清晰的 agent 流量边界、可审计性、PII 控制，而不是裸暴露 admin API。

让 WooCommerce 作为 OCP **Provider**（或在更轻量的部署里直接担任 merchant-hosted **Catalog Node**），商家可以保留原有数据模型，对外只暴露一致的 OCP 协议面。

## 它不是什么

- 不是 WooCommerce 的替代品——WooCommerce 仍是商品、订单、税费、履约、退款的权威状态机。
- 不是 agent runtime——插件不识别用户意图、不规划 checkout、不发起对话。
- 不是支付信任层——不验证 Visa agent 身份、不实现 Payment Instruction、不持有用户 card credential。
- 不是 Registration Node 的商品索引——Registration Node 只发现 Catalog。
- 不是必须暴露完整字段集——Provider 按 Descriptor Contract 声明自己能保证什么。

## 核心内容

### 三层边界

```
Agent Layer       AI Agent / Visa VIC Reference Agent
                  用户意图、确认、Payment Instruction
                          │
Protocol Layer    OCP Catalog
                  Discovery / Query / Resolve / Checkout / Order / Event
                          │
Merchant Layer    WooCommerce OCP Plugin
                  Product / Offer / Order / Webhook 适配
```

三层独立演进。日后接入 Shopify、Magento，或换掉 Visa 改用其他支付信任层时，不需要重写商家适配层与 agent 核心边界。

### 插件负责什么

- 读取并映射 WooCommerce 的商品、分类、标签、属性、变体、库存；
- 在 Provider Adapter 模式下，把对象同步到目标 OCP Catalog；
- 在 merchant-hosted 模式下，直接对外暴露 CatalogManifest 与 query / resolve；
- 暴露 OCP-facing endpoint：discovery（如 `/.well-known/ocp-catalog`）、search / query、resolve、checkout、order status；
- 监听 WooCommerce webhooks，把商品、库存、订单变化写入同步队列或 Event Ledger；
- 维护 API key、webhook secret、同步游标、重试状态、审计日志。

### 插件不负责什么

- 不充当 agent runtime；
- 不直接验证 Visa agent 身份；
- 不实现 Visa VIC 的用户认证、Payment Instruction 或 agent-specific token 生命周期；
- 不存储用户原始 card credential；
- 不替代 WooCommerce 的订单、税费、履约、退款、邮件通知与售后工作流；
- 不把 Registration Node 当成商品数据库。

### 两种部署模式

**Provider Adapter 模式（推荐默认）**
插件把店铺变成 OCP Provider，向一个或多个公共 Commerce Catalog 注册并同步对象；Catalog 负责索引、排序、查询、resolve，并向 Registration Node 注册。适合多商家聚合、风控集中、搜索质量统一的场景。

**Merchant-hosted Catalog 模式（可选）**
插件同时担任 Provider 与 Catalog Node，单店铺直接暴露 manifest / query / resolve。适合独立商家快速接入，但多商家聚合、搜索质量、风控和缓存治理会显著比 Provider Adapter 模式难。

### 关键数据映射

| WooCommerce 概念 | OCP 映射 | 说明 |
| --- | --- | --- |
| Store | Provider / Merchant Profile | `provider_id` 应稳定，不随域名短期变化 |
| Product | CommercialObject / Catalog item | 标题、描述、品牌、图片、URL、状态进入 product descriptor |
| Variation | Offer / purchasable SKU | 颜色、尺码、价格、库存等可购买选项落到此处 |
| Category / Tag | Taxonomy descriptor | 用于搜索过滤与商品理解 |
| Regular / Sale Price | Price descriptor | 保留币种、当前价、原价、促销有效期 |
| Stock Status / Quantity | Inventory descriptor | 供 Agent 判断可购买性与替代策略 |
| Cart | Checkout session | **执行态**，不是 CatalogEntry |
| Order | OCP order resource | 订单号、状态、金额、履约状态、可执行动作 |
| WooCommerce webhook | EventLedger event | 商品 / 库存 / 订单变化进入同步与审计流 |

### 必须强调的纪律

- **Cart 是执行态，不是 CatalogEntry**——Catalog 暴露的是可发现、可解析的对象，不是会话快照；
- **Checkout 前必须重新校验价格、库存、税费、配送约束**——Search 结果只是候选，能真正下单的价格只在 checkout 时确定；
- **WooCommerce 仍是订单和履约的权威状态机**——OCP 不接管订单生命周期、退款流程、邮件通知；
- **不要把 WooCommerce 插件写成"直接集成 Visa"**——Visa VIC / Payment Instruction 属于 Agent Layer 之上的支付信任层，插件只接受经外部认证的 `payment_context`，不参与 token 生命周期。

## 相关页面

- [OCP 是什么](/what-is-ocp)
- [Catalog 是什么](/what-is-catalog)
- [OCP 角色模型](/roles)
- [Catalog 架构](/catalog-architecture)
- [Search / Resolve / Action 三步法](/resolve-actions)

