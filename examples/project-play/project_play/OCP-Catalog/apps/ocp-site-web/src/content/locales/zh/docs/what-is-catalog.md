---
title: Catalog 是什么
description: Catalog 是 OCP 体系中承载商业对象索引、查询、解析与动作入口的节点；对外用统一契约，对内允许自由实现。
category: concepts
order: 2
---

# Catalog 是什么

> Catalog 是 OCP 协议在运行时最常被访问的角色：Agent 在这里检索对象、解析详情；Provider 在这里接入对象。本页解释它**承担什么、不承担什么**，以及围绕它的几个关键对象。

## 一句话解释

Catalog 是 OCP 体系里**承载商业对象索引、查询能力、解析能力与动作入口**的节点。它通过统一的协议契约对外声明自己能做什么，但内部实现完全自由——可以是关键词检索、向量检索、规则匹配、图谱匹配，也可以混合。

## 解决的问题

如果让 Agent 直接对接每个商家系统，会遇到三类反复出现的问题：

1. **能力不可发现**：Agent 不知道某个数据源支持什么查询模式、对象类型、过滤字段。
2. **私有结构外泄**：Agent 被迫了解 `/wp-json/wc/v3/products` 之类的内部 API，一旦平台变化整条链路都断。
3. **没有统一的"候选 → 详情 → 动作"切面**：Provider 直接暴露原始数据，Agent 无法区分公共摘要、受限字段和动作入口。

Catalog 通过把这些抽象到**协议外壳**之中，让 Provider 可以保留内部数据结构，让 Agent 只需要按 manifest 声明的能力写 query，让权限和信任策略可以集中表达。

## 它不是什么

- 不是商家后台或商品主数据库——Provider 仍是真实性、价格、库存、状态的权威。
- 不是必须使用某种特定搜索算法、向量库、排序模型——协议只约束对外契约，不约束内部实现。
- 不是订单 / 支付 / 履约系统——动作执行由 Action Provider 承担。
- 不是"所有商品集中存储的一张大表"——多个 Catalog 可以共存，通过 Federation 协作；远端对象优先以 route hint / summary 形式被引用，而不是被复制。
- 不是只能服务商品——它面向通用商业对象（服务、职位、人才、RFQ、渠道机会、工作流入口等）。

## 核心内容

围绕一个 Catalog 节点，OCP 定义了几个相互关联的概念：

- **CatalogProfile**：稳定的身份、能力摘要、信任与健康状态，面向 Registration Node 和 Agent 的本地缓存。
- **CatalogManifest**：对外发布的完整能力声明，包含协议版本、endpoint、对象类型、Query Pack、Resolve 能力、Provider 接入要求、同步能力、认证要求、限流、信任与新鲜度。它是其他角色理解 Catalog 的主要入口。
- **CatalogRouteHint**：Registration Node 返回给 Agent 的可缓存路由摘要，比 manifest 更小，带 TTL。
- **ObjectContract / Descriptor Contract**：Catalog 对接入对象的字段级要求（必需字段、可替代字段组、附加字段策略、字段用途、敏感性等）。
- **CatalogEntry**：CommercialObject 在 Catalog 内部的索引投影，承担召回、排序、去重、聚合、可见性过滤、新鲜度判断、可选预览 `image_url` 和指向 resolve 的引用。
- **Query Pack / QueryPackBinding**：声明 Catalog 支持哪些查询模式（keyword / filter / semantic / geo / availability / talent_match / rfq_match 等），以及每种模式的输入输出 schema、可过滤字段、可排序字段、是否支持 explain 等。

Catalog 的两条主链路是：

- **Provider 接入链**：Provider 获取 discovery → 检查 manifest → 提交 ProviderRegistration → 按选定的 Sync Capability 同步对象 → 在 Catalog 内形成 CatalogEntry。
- **Agent 调用链**：Agent → 本地 profile cache 或 Registration Node 搜索 → 拿到 RouteHint / Manifest → 在 Catalog Node 上执行 query → 拿到 CatalogEntry 候选 → 对选中条目执行 resolve → 得到 ResolvableReference + ActionBinding → 交给 Action Provider 执行。

Catalog 可以是聚合多商家的"公共 Catalog"，也可以是单店铺自建的"merchant-hosted Catalog"。两种部署形态共用同一套协议契约。

## 相关页面

- [OCP 是什么](/what-is-ocp)
- [OCP 角色模型](/roles)
- [Search / Resolve / Action 三步法](/resolve-actions)
- [Catalog 架构](/catalog-architecture)

