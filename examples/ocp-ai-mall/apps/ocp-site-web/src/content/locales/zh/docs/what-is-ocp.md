---
title: OCP 是什么
description: OCP 是一组让 AI Agent 与异构商业系统在同一协议语义下发现、查询、解析与触发动作的开放规范。
category: concepts
order: 1
---

# OCP 是什么

> 一篇 5 分钟读完的"OCP 是什么 / 不是什么"。它说明 OCP 想解决的核心问题，列出协议的几条骨干原则，让你能快速判断"OCP 是不是我要找的东西"。

## 一句话解释

OCP（Open Commerce Protocol，开放商业协议）是一组让 AI Agent、应用与异构商业系统之间能够互相**发现商业对象、查询信息、解析详情、并触发动作**的协议规范。它把"商业能力"抽象成一组可声明、可验证、可解释、可约束的协议面，让发现与交互独立于具体的商家、平台或后端实现。

## 解决的问题

商业世界里能"被买、被预约、被申请、被联系"的对象散落在大量异构系统中：商品在 WooCommerce、Shopify、Magento 与自研商城里；服务在本地预约平台里；职位在 ATS 里；采购需求、渠道机会、报价、工作流入口又各属于不同企业的 CRM / ERP。AI Agent 想要代表用户在这些系统之间穿梭，会同时遇到三类困难：

1. **找不到入口**——每家自有 API，没有统一发现机制。
2. **看不懂语义**——字段命名、可见性、新鲜度、来源都不一致。
3. **不敢下手**——没有可验证的权限、信任、审计基础，Agent 容易"发明"字段、越权访问或在用户没确认时下单。

OCP 想做的就是在这些异构系统之上铺一层**协议语义**：让 Agent 用同一种方式发现合适的目录、查询对象、解析结果、并按受控的方式连接到下一步动作。

## 它不是什么

- 不是中心化的商品数据库或主数据系统。
- 不是搜索引擎、支付网络、订单系统、履约系统。
- 不是商家平台的私有 API 标准——商家平台仍是其商品、价格、库存、订单的权威源。
- 不是 MCP、REST、Webhook、A2A 中的某一种——这些是绑定层 / 适配层，OCP 在其之上定义对象与契约。
- 不是 Agentic Commerce 的某个"完整方案"——OCP 只覆盖"发现到动作入口"这一段，不替代支付信任层或商家执行层。

## 核心内容

OCP 的核心是几条彼此咬合的设计原则：

- **对象中立（Object-Neutral Core）**：协议的中心是"通用商业对象（CommercialObject）"，而不是"商品"。商品、服务、人才、职位、采购需求、渠道机会、可预约资源、工作流入口都是它的具体类型，差异通过可版本化的 **Descriptor Pack** 与 **Query Pack** 表达。
- **角色分离（Role Separation）**：发现 Catalog、索引对象、接入数据源、解析详情、执行动作是分给不同角色的，避免一方既当数据源又当检索引擎又当支付网关。详见 [OCP 角色模型](/roles)。
- **契约先行（Contract-First Integration）**：Provider 接入 Catalog 前先完成字段、对象、同步能力的协商——注册建立契约，同步才传输数据。
- **Search / Resolve 分离**：搜索负责候选发现和解释，解析负责权限化详情和动作入口，详见 [Search / Resolve / Action 三步法](/resolve-actions)。
- **权限、信任、来源、新鲜度内建**：可见性、用途、身份、审计、过期、签名是协议的一等公民，而不是接口外层的开关。
- **远程优先的联邦协作**：多个 Catalog 之间默认交换 profile、route hint、contract、summary、trust metadata，**不**默认复制完整对象数据库。

围绕这些原则，OCP 定义了一系列对象（CatalogProfile、CatalogManifest、CatalogRouteHint、ObjectContract、CatalogEntry、Query Pack、ResolvableReference、ActionBinding 等），并把对外接口分为 Registration、Handshake、Query、Resolve、Action Binding、Transport / Adapter 六个协议层。

## 相关页面

- [Catalog 是什么](/what-is-catalog)
- [OCP 角色模型](/roles)
- [Search / Resolve / Action 三步法](/resolve-actions)
- [Catalog 架构](/catalog-architecture)

