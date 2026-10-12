---
title: WebMCP Demo
description: WebMCP Demo 把 OCP Catalog Mall 的浏览、搜索与商品页打开能力暴露为浏览器内 WebMCP 工具，便于端到端验证 Agent 调用。
category: demos
order: 1
---

# WebMCP Demo

> 一个可以被点开、被脚本调用、被 AI Agent 工具发现的演示页面，把 OCP Catalog 的 Search 阶段呈现成浏览器内的 WebMCP 工具集。

## 一句话解释

WebMCP Demo 是 OCP Catalog Mall 的一个**演示页面**——它把"浏览商品、搜索、切换数据源、打开商品页"这些通常藏在前端 JS 里的能力**暴露成 WebMCP 工具**，让支持 WebMCP 的 AI Agent 可以从浏览器侧直接调用，用来端到端验证"Agent 通过 OCP Catalog 能不能做事"。

地址：<https://ocp.deeplumen.io/webmcp/>

## 解决的问题

- OCP 的概念、协议、数据模型即便都对齐了，**Agent 在真实环境里能不能用**仍需要一个可被点开、可被截图、可被脚本调用的验证物。
- WebMCP 把"浏览器内的网页"作为一种新的 Agent 可调用面（tools），但生态里能跑通的端到端样例不多。
- 不同搜索模式（关键词 / 过滤 / 语义）在 Agent 视角下表现差异明显，需要一个统一的演示位让人和 Agent 都能看到结果。

Demo 把这三件事打包到同一页面，作为 OCP Catalog 的"开箱即验"入口。

## 它不是什么

- **不是 OCP 协议本体**——Catalog 协议的核心是 discovery / query / resolve / action binding（参见 [Catalog 架构](/catalog-architecture)）；WebMCP 只是其中一种**绑定层 / 适配层**呈现方式。
- **不是正式商家 checkout / order 系统**——没有真实下单、没有真实支付、没有 Order 状态机；和 [WooCommerce 集成概览](/examples/woocommerce-overview) 中描述的完整 merchant layer 不在一个层级。
- **不是浏览器安装教程**——本页不复述 Chrome flag、Beta 版本号等启用细节。
- **不是 WebMCP 规范**——`navigator.modelContext.registerTool(...)` 等 API 形态由浏览器侧规范定义。
- **不是固定数据快照**——商品列表取决于当前所选的 Registration Node、Catalog 与索引数据，截图仅示意。

## 核心内容

### 当前暴露的 WebMCP 工具

页面通过 `navigator.modelContext.registerTool(...)` 注册了 5 个工具：

| 工具 | 用途 |
| --- | --- |
| `ocp.mall.get_page_state` | 读取页面状态：WebMCP 是否启用、当前 Registration Node 与 Catalog、商品数量等 |
| `ocp.mall.list_products` | 浏览商品（无明确搜索意图） |
| `ocp.mall.search_products` | 在三种搜索模式中执行检索，输出商品卡片 |
| `ocp.mall.set_data_source` | 切换数据源（Registration Node / Catalog） |
| `ocp.mall.open_product_page` | 用 `product_id` / `product_url` / `title` 之一打开商品详情页 |

### 三种搜索模式

`ocp.mall.search_products` 的 `search_mode` 参数支持：

- **Keyword**——精确词、商品名、品牌词；适合 Agent 已经从用户那里拿到清晰关键词的场景。
- **Filter**——结构化过滤；常见字段包括 `category` / `brand` / `currency` / `availability_status` / `provider_id` / `sku` / `min_amount` / `max_amount` / `in_stock_only` / `has_image`。具体支持以当前 Catalog 的 Query Pack 与服务端 schema 为准。
- **Semantic**——自然语言意图，例如 `morning drink` 可被关联到咖啡类商品。适合 Agent 不替用户做关键词归纳的场景。

三者对应到 [Search / Resolve / Action 三步法](/resolve-actions) 中的 Search 阶段；它们不是各自独立的"另一种协议"，而是同一 Search 阶段下不同 Query Pack 的呈现。

### 标准演示流程

1. 打开 `https://ocp.deeplumen.io/webmcp/`。
2. Agent 连入浏览器 WebMCP host，先调 `ocp.mall.get_page_state` 确认 WebMCP 可用、Registration Node 与 Catalog 已就绪。
3. 若用户只是浏览，调 `ocp.mall.list_products`。
4. 用户给关键词时，`ocp.mall.search_products` + `search_mode=keyword`。
5. 用户给自然语言意图时，同一工具 + `search_mode=semantic`。
6. 用户给结构化条件时，同一工具 + `search_mode=filter` + `filters`。
7. 选中商品后，`ocp.mall.open_product_page` 打开详情页。

### 必须强调的边界

- WebMCP 是 Demo 的工具暴露方式，是 OCP 协议的**绑定层 / 适配层**，不是 Catalog 协议本体。
- 页面工具调用**不等同于** OCP 正式 ActionBinding 调用。
- `ocp.mall.open_product_page` **可类比**动作入口，但**不等同于** Action Provider 的执行链——它只是页面跳转，不进入订单、支付、履约的任何状态机。
- Agent 必须接入浏览器侧的 WebMCP host、WebMCP Bridge / Gateway 或支持 WebMCP 的客户端库（例如较新版本 Puppeteer）；**不能假设任意 AI Agent 打开网页就能调用工具**。
- Demo 数据随 Registration Node、Catalog 与索引变化而变化，**截图不是固定快照**，应以页面实际返回为准。

## 相关页面

- [OCP 是什么](/what-is-ocp)
- [Catalog 是什么](/what-is-catalog)
- [OCP 角色模型](/roles)
- [Catalog 架构](/catalog-architecture)
- [Search / Resolve / Action 三步法](/resolve-actions)
- [WooCommerce 集成概览](/examples/woocommerce-overview)

