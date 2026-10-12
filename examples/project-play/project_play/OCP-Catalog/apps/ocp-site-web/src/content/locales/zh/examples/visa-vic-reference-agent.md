---
title: Visa VIC 参考 Agent
description: Visa VIC 参考 Agent 示范了一种清晰的分层：发现归 OCP、信任归 Visa、履约归商家，Agent 只编排不越权。
category: agentic-commerce
order: 1
---

# Visa VIC 参考 Agent

> 这是 OCP 在 Agentic Commerce 场景里的"对外示范"：协议、支付信任、商家系统三方各管一段，Agent 只编排不越权，购买行为可审计、可拒绝、可分层。

## 一句话解释

Visa VIC Reference Agent 把"用户意图 → 商品发现 → 用户确认 → 支付指令 → 商家下单"串成一条**可审计、可拒绝、可分层**的链路：OCP Catalog 管"找到对象与动作入口"，Visa VIC / VTS / Visa MCP Server 管"支付信任与受限凭证"，商家系统继续负责自己的订单与履约——Agent 只是这三层之间的编排者。

## 解决的问题

- Agentic commerce 最危险的失败模式是 "Agent 拿用户的卡去买"——既泄露凭证，也丢失审计。
- 让 Agent 直接对接每家商家私有 API，会让"找到对象"和"创建订单"被挤进一次调用，绕过用户确认。
- 没有结构化的购买约束，"自然语言授权"无法被验证、无法被拒绝、也无法被回放。

Reference Agent 的价值是**示范一种清晰的分层**：发现归 OCP，信任归 Visa，履约归商家，自己只编排不越权。

## 它不是什么

- 不是 Visa 产品宣传——它是参考实现，目的在于证明 OCP × Visa VIC × 商家系统的边界能跑通。
- 不是支付接口规范——Visa VIC、VTS、MCP Server 的具体 API 不在本页范围。
- 不是 OCP 协议的一部分——它**消费** OCP，不**定义** OCP。
- 不是"自动购买机器人"——`find_and_query_catalog` 这种发现快捷组合**不能**被当成自动购买工具。
- 不是商家系统的代理人——商家的订单、税费、履约、退款仍由 [WooCommerce 集成概览](/examples/woocommerce-overview) 中描述的 Merchant Layer 承担。

## 核心内容

### 三层边界

```
Agent Layer       Visa VIC Reference Agent
                  用户意图 / 候选比较 / 用户确认 / Payment Instruction 编排
                          │
Protocol Layer    OCP Catalog
                  Search / Resolve / Checkout / Order / Event contracts
                          │
Merchant Layer    WooCommerce / Shopify / Magento / 自研商城
                  Product / Offer / Order / Webhook adapter
```

Reference Agent **不依赖** WooCommerce——它依赖 OCP 的协议能力。换商家平台或换支付信任层时，Agent 核心边界不变。

### Reference Agent 负责什么

- 理解用户购买意图与约束（金额、商家范围、配送、过期等）；
- 查询 OCP Registration Node 或本地 Catalog profile cache；
- 调用目标 Catalog 的 query 与 resolve；
- 向用户展示候选商品、价格、库存、配送以及**不确定点**；
- 请求用户**明确确认**购买约束；
- 生成并提交 Payment Instruction 请求；
- 通过 Visa MCP Server / VIC / VTS 获取受限支付上下文；
- 用 OCP checkout 创建商家订单；
- 查询并回传订单状态给用户；
- 把关键动作写入 audit / event ledger。

### Reference Agent 不负责什么

- 不托管商家的商品数据库；
- 不伪造商品价格、库存或配送承诺；
- 不在没有用户确认时创建支付指令；
- **不获取或保存用户原始卡号**；
- 不直接修改 WooCommerce / Shopify / Magento 私有订单表；
- 不绕过 OCP resolve / checkout，直接构造商家内部 API 请求。

### 主流程

```
User intent
  -> Agent searches OCP Catalog Registration Node or local Catalog cache
  -> Agent selects target Catalog
  -> Agent queries OCP Catalog
  -> Agent resolves candidate products
  -> Agent presents options and uncertainty to User
  -> User confirms product, merchant, amount, delivery, expiry and substitution policy
  -> Agent requests authenticated Payment Instruction
  -> VIC validates agent / user / payment context
  -> Agent retrieves constrained payment credential or authorization context
  -> Agent creates checkout with OCP merchant endpoint
  -> Merchant creates order and returns status
  -> Agent reports result to User
  -> Agent submits commerce signals / audit events
```

这条链路严格遵守 [Search / Resolve / Action 三步法](/resolve-actions)：Search 给候选；Resolve 给 ActionBinding 与受限上下文；Action（这里是 checkout）只在用户确认之后才会发生。

### Payment Instruction：结构化授权约束

Payment Instruction **不是自由文本**——而是一份能被签名、验证、过期、回放的结构化对象，至少包含：

| 约束 | 含义 |
| --- | --- |
| `max_total_amount` / `currency` | 含税与配送的总价上限 |
| `merchant_scope` | 允许的商家集合，不允许 Agent 换商家 |
| `product_scope` | 精确商品 entry 或宽泛类别，需明确区分 |
| `quantity` | 数量；超出必须重新确认 |
| `delivery_constraints` | 配送地区、到货时间等 |
| `expires_at` | 过期时间；过期必须重新认证 |
| `usage` | 一次性 vs 可复用，默认一次性 |
| `substitution_policy` | 缺货是否允许替代 |
| `cancellation_policy` | 价格 / 库存 / 配送变化下的行为 |

正确模型是：**用户认证一条受限指令 → Agent 拿到受限支付上下文或 token reference → 商家收到可验证的支付授权结果**——而不是"Agent 拿用户卡去买"。Visa 的 controls 同时校验商家、金额与指令对齐，任何环节都可审计。

### 必须强调的边界

- **OCP Catalog 不实现 Visa tokenization**——tokenization、用户认证、Payment Instruction 生命周期归 Visa VIC / VTS。
- **Visa VIC 不负责 OCP Catalog 的商品索引或 query ranking**——这些是 Catalog Node 的职责。
- **`find_and_query_catalog` 不能被当成"自动购买"工具**——它是发现的快捷组合，不替代 resolve 与用户确认。
- **购买必须经过 Resolve、用户确认与 Payment Instruction**——三者缺一不可。
- **Checkout 请求应引用 OCP resolve 得到的 entry / action**——不是让 Agent 自己拼商家 URL。
- **商家系统仍是订单和履约的权威状态机**——OCP / Visa / Agent 都不接管商家的订单生命周期。

## 相关页面

- [OCP 是什么](/what-is-ocp)
- [Catalog 是什么](/what-is-catalog)
- [OCP 角色模型](/roles)
- [Search / Resolve / Action 三步法](/resolve-actions)
- [Catalog 架构](/catalog-architecture)
- [WooCommerce 集成概览](/examples/woocommerce-overview)
- [WebMCP Demo](/examples/webmcp-demo)

