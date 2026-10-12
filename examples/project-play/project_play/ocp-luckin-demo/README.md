# ☕ 用 OCP 做一个瑞幸咖啡铺

Agent Mall 黑客松 · 应用赛道作品。一个**第三方按 OCP 规范实现**的 Catalog Node(瑞幸咖啡铺·浙大紫金港店),可以被**未修改的官方工具链**直接驱动,完整复现《用 OCP 做一个奶茶铺:从零复现指引》的十步流程。

## 核心演示点

> **query 给「投影」,resolve 才给「动作」。**

同一个 `entry_id`,只换一个字段:

| resolve 参数 | 返回的动作 | 用户确认 | 时效 |
|---|---|---|---|
| `purpose: "view"` | `url` — 查看商品详情页 | 不需要 | 1 小时 |
| `purpose: "checkout"` | `api` — POST 门店下单接口 | **强制 true** | **10 分钟** |

Catalog 层同时做到**数据过滤**(internal_cost / internal_supplier 永不外泄)和**动作约束**(必须确认、会过期)——这不是转发接口能替代的。

## 跑法(前置:Bun 1.3+)

```bash
bun install
bun run selfcheck   # 证据 1:11 项官方 @ocp-catalog/ocp-schema 校验,全绿
bun run demo        # 证据 2:起服务 → 十步走查(官方 CLI 驱动)→ 18 断言 → 停服务
bun run start       # 手动把服务跑在 http://localhost:4410
```

跑通标准:`selfcheck` 11 项全绿;`demo` 打印「全流程通过」且退出码为 0。

## 十步走查(对应指引 PDF 第 3 节)

| 步 | 内容 | 驱动方 |
|---|---|---|
| 1 | `GET /.well-known/ocp-catalog` 发现入口 | HTTP |
| 2 | `ocp catalog inspect` 读取能力声明 | 官方 CLI |
| 3 | `ocp validate manifest` → `ok:true`(硬证据) | 官方 CLI |
| 4 | 一句人话检索「不太甜的咖啡」→ 命中燕麦拿铁 | 官方 CLI |
| 5 | `ocp validate query` 不联网校验自定义 pack 请求体 | 官方 CLI |
| 6 | 自定义 filter pack:「果茶 且 ≤20 元」(前向扩展示范) | HTTP |
| 7 | `resolve(purpose=view)` → url 动作 | HTTP |
| 8 | `resolve(purpose=checkout)` → api 动作 + 确认 + 时效(高潮) | HTTP |
| 9 | `POST /shop/order` 真正下单(**非协议端点**,mock 支付) | HTTP |
| 10 | 边界:未知 ID→404、未声明 pack→400、offset 翻页→400 | HTTP |

## 结构

```
src/menu.ts        瑞幸菜单(含 internal_* 内部字段,演示数据过滤)
src/server.ts      六个协议端点 + 门店下单端点
src/selfcheck.ts   证据 1:官方 schema 11 项校验(不起服务)
scripts/demo.ts    证据 2:十步一键走查,18 断言
```

## 协议边界

- 下单端点 `/shop/order` **不属于** OCP 协议——协议负责把 Agent 送到门口,交易本身归门店。
- 现实中瑞幸若有 MCP 点单接口,正确姿势是写一个 OCP Catalog 把它**包起来**(MCP 是适配器层,OCP 是协议层),而非用 MCP 替换 OCP。
