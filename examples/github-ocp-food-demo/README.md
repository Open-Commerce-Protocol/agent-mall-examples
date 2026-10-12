# 今天吃什么 · OCP 联邦点单

一个**合规的 OCP Catalog Node**：让 Agent 替你逛完整条街、读完全部菜单、替你做一次有约束的推荐 —— 但点不点，由你说了算。

> OCP 全称 **Open Commerce Protocol（开放商业协议）**。
> 它把「商品信息」从网页内容，提升为 **Agent 可调用的协议对象**。
> 类比：**商业世界的 USB 接口** —— 只要对方按同一套约定提供接口，任何 Agent 都能插上去用。

---

## 快速开始

前置：**bun >= 1.3**

```bash
bun install                 # 其实没有依赖，这步是幂等的
cp .env.example .env        # 填瑞幸 token（可选，不填会优雅降级）

bun run selfcheck           # 自证合规：43 项协议断言
bun run demo                # 一键走查：起服务 → 19 项断言 → 停服务
bun run start               # 手动起服务，然后打开 http://localhost:4400
```

**跑通的标准**：`selfcheck` 43 项全绿、`demo` 打印「全流程通过」且**退出码 0**。

---

## 三层职责，各管一段

| 层 | 负责什么 | 不管什么 | 本项目 |
|---|---|---|---|
| **Registration Node** | 只负责「发现有哪些 Catalog 存在」 | 不存具体数据 | `/ocp/index`（只索引 metadata） |
| **Catalog Node** | 检索商业对象 + 解析成可执行动作 | 不真正成交 | 四家店各自一个，六个端点 |
| **Provider** | 提供原始数据 | 不管协议怎么对外 | 本地菜单 / 瑞幸 MCP |

本项目主体做的是中间的 **Catalog Node** —— 最能体现协议价值的一层。

---

## 一个合规的 Catalog Node 只需六个端点

```
GET  /{shop}/.well-known/ocp-catalog   发现入口：告诉别人「我在这」
GET  /{shop}/ocp/manifest              能力声明：支持哪些检索、有哪些契约
GET  /{shop}/ocp/health                存活探测（含真实上游依赖状态）
GET  /{shop}/ocp/contracts             数据契约（ObjectContract）
POST /{shop}/ocp/query                 检索：返回数据投影
POST /{shop}/ocp/resolve               解析：把结果变成「可执行的动作入口」
```

外加一个**边界之外**的端点：

```
POST /{shop}/ocp/execute               商家自己的执行入口 —— 不属于 OCP 协议
```

> **记住这个区别**：`query` 给「投影」（能看不能动），`resolve` 才给「动作」（可点、可下单）。
> 这是官方规范盖章的核心设计点，也是本演示的高潮。

---

## 四家店 = 四份配置，一份 handler

| 店铺 | 角色 | 说明 |
|---|---|---|
| 楼下川面馆 | 快的 mock 店 | `verified` / `authority` |
| 山谷便当屋 | 慢的 mock 店 | `pending` / `verified_domain`，用于演示逐一亮起 |
| 炭火烤肉食堂 | **故意不健康** | `status: degraded`，用于演示联邦网络的可观测性 |
| 瑞幸咖啡 | **真实 Provider** | 透过官方 MCP 接入，适配器层 |

三家 mock 店共用同一份 handler，只是配置不同 —— 这既是省时间的手段，也是演示论点的一部分：**同一个协议，三个实现**。

---

## B 层方案：推荐权在商家

「今天吃什么」的关键不是随机抽一个（那跟 `Math.random()` 没区别），而是 **跨多个 Catalog 做约束查询**，随机性只存在于「在符合条件的候选里挑一个」。

而且 **挑哪一个由商家侧的 Catalog 决定**，不是 Agent 端：

```ts
// 川面馆：优先清今天的备料      pick: 找 today_special
// 便当屋：利润导向              pick: 找价格最接近预算上界的
// 烤肉店：引流导向              pick: 找最便宜的
// 瑞幸：  推当季主推            pick: 找 today_special
```

路演时这一句就够了：

> **每家店自己决定推什么，因为执行权在商家手里 —— 协议不替商家做这个决定。**

---

## 看 vs 买：同一条数据，两个动作

同一个 `entry_id`，只差一个 `purpose`：

| 按钮 | purpose | 返回 | 界面 |
|---|---|---|---|
| 「看看这家」 | `view` | `action_type: url` + 普通详情链接 | 直接开链接，**无需确认** |
| 「就要这个」 | `checkout` | `action_type: api` + `requires_user_confirmation: true` + `expires_at` | 弹确认层 + **90 秒倒计时** |

倒计时走完动作作废、按钮变灰 —— 把协议字段变成观众能用眼睛看见的东西。
官方 Demo 只**返回**了这些字段，本演示把它**演**了出来。

---

## 适配器层：MCP 叠上去，不是换掉

瑞幸 2026 年 6 月上线 AI 开放平台，提供官方 MCP Server：

```
https://gwmcp.lkcoffee.com/order/user/mcp   （streamable HTTP，Bearer token）
```

8 个上游工具：`queryShopList` / `searchProductForMcp` / `switchProduct` /
`queryProductDetailInfo` / `previewOrder` / `createOrder` / `queryOrderDetailInfo` / `cancelOrder`

**关键分层**：

> MCP 在 OCP 规范里属于 **适配器层（adapter layer）**，和 CLI、Skill、插件并列，**不是协议层**。
> 所以正确姿势是**写一个 OCP Catalog 把它包起来**，而不是用 MCP 去替换 OCP。

`src/luckin-mcp.ts` 就是那个「包起来」的动作。对外，瑞幸商品和其它三家店**形状完全一致** —— Agent 看不出区别。

两个上游限制要知道（官方明说的）：
- `queryShopList` **必须传经纬度**，没有按城市/菜单查询的接口
- `searchProductForMcp` **每次最多返回 3 款**

---

## 两条硬证据

| 证据 | 命令 | 结果 |
|---|---|---|
| 1 · 每个响应体都符合规范 | `bun run selfcheck` | **43 项通过**，含泄漏扫描（内部字段不得外泄） |
| 2 · 全流程可复现 | `bun run demo` | **19 项断言**，退出码 **0** |

校验器在 `src/ocp-schema.ts`，字段严格对齐官方 `@ocp-catalog/ocp-schema`（Zod）。
**手写而不装包**是刻意的：现场网络抖动不可接受，且目的是证明「我们的响应合规」，不是「我们调了个库」。

---

## 目录结构

```
src/
  ocp-schema.ts    符合规范的自校验器（字段对齐官方 Zod）
  shops.ts         四家店的数据 + 各自的 B 层 pick 策略
  luckin-mcp.ts    瑞幸 MCP 客户端 ← 「适配器层」就长这样
  server.ts        六个协议端点 + execute + 路由 + 瑞幸桥
scripts/
  selfcheck.ts     硬证据 1：43 项协议断言
  demo.ts          硬证据 2：19 项全流程断言
  probe-luckin.ts  探测瑞幸上游真实结构（只读，不下单）
public/
  index.html       单文件前端（内联 CSS + JS，零构建）
```

---

## 现场排错

| 症状 | 原因 | 处理 |
|---|---|---|
| 端口被占 | 另一个服务占着 4400 | 服务端会自动顺延到 4401/4402/4403，看控制台打印的实际端口 |
| 终端不在项目目录 | `cd` 没生效 | 先 `cd` 到 `ocp-food-demo` |
| 瑞幸返回 0 款 | token 过期 / 关键词不匹配 | 上游每次最多 3 款且只做匹配；换关键词。**页面其余部分不受影响** |
| 中文乱码 | Git Bash 的 curl 会把命令行参数编成非 UTF-8 | 浏览器不受影响；用 curl 测试时请 `--data-binary @file` |

---

## 安全

- **token 只从环境变量读**，不进源码、不进 git（`.gitignore` 已排除 `.env`）
- 所有下单都要先过 `purpose=checkout` 的 **一次性 nonce**（90 秒、用后即焚）
- `selfcheck` 会扫描内部字段（`cost` / `margin` / `supplier_id` …）是否泄漏到对外响应

> ⚠️ 演示结束后请到瑞幸开放平台**吊销本次使用的 token 并重新签发**。
