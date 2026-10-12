# 奶茶 OCP 演示

用 [Open Commerce Protocol](https://github.com/Open-Commerce-Protocol/OCP-Catalog) 搭的最小完整应用：
**两家独立奶茶铺 + 一个发现节点 + 一块可视化面板**，把"AI 帮你点一杯"这条链路真正跑通。

它回答的是一个具体问题：OCP 说自己是"让 AI 跨独立目录发现和查询商业对象"的协议——
那到底怎么落地？落地之后，**"点单"这件事在协议里的边界又在哪里？**

> 结论先说：协议能给的是**下单入口**，不是成交。付款永远发生在商户侧。
> 本演示不接任何支付通道，所有订单都带 `payment: "simulated_not_charged"`。

---

## 一分钟跑起来

要求：**Node ≥ 22.18**（用它原生跑 TypeScript，因此**没有编译步骤、没有 `npm install`**）。

```bash
npm start            # 起 4 个服务（4500 / 4501 / 4502 / 4600）
# 浏览器打开 http://127.0.0.1:4600  ← 五步可视化面板

npm run demo         # 命令行把五步走一遍（会复用已在运行的节点）
npm run selfcheck    # 一致性自检：34 个真实响应逐条过 JSON Schema
```

`dependencies` 是空的，这不是偷懒：本机 npm registry 不可达（自签名证书），
所以全部代码只用 Node 内置模块。任何一步都不需要联网。

---

## 架构

| 角色 | 端口 | 职责 | 它**不**做什么 |
|---|---|---|---|
| Registration 节点「奶茶导航」 | 4500 | 回答"谁在卖奶茶"，维护已注册 Catalog 的索引与路由提示 | 不查商品、不碰价格 |
| 奶茶铺 A ·「山海茶铺」 | 4501 | 独立 Catalog 节点，自有菜单/价格/库存 | 不参与发现层 |
| 奶茶铺 B ·「拾光茶铺」 | 4502 | 另一家独立 Catalog，菜单与价格都不同 | 同上 |
| 演示面板 | 4600 | 把五步流程画出来 | 只硬编码发现层地址，其余全从协议获得 |

**为什么是两家店**：只有一家时发现层完全是多余的。两家独立目录才能体现 OCP 真正解决的问题——
**跨独立目录发现**。品牌的虚构是为了避开真实商标。

面板的硬编码只有一处：发现层 `http://127.0.0.1:4500`。
有哪些店、它们的查询地址、声明了哪些 query pack，全部由协议本身告诉它。

---

## 五步流程

这套步骤与已安装的 `ocp-catalog` 技能正文里的 Workflow **一一对应**：

| 步 | 做什么 | 端点 |
|---|---|---|
| 1 | 发现：谁在卖奶茶 | `GET /.well-known/ocp-registration` → `GET /ocp/registration/manifest` → `POST /ocp/catalogs/search` |
| 2 | 选定一家，先读它的能力声明 | `POST /ocp/catalogs/resolve` → `GET <manifest_url>` |
| 3 | 只用 manifest 声明的 pack 查询 | `POST /ocp/query` |
| 4 | 对选中条目解析出可执行入口 | `POST /ocp/resolve`（`purpose: "checkout"`） |
| 5 | 走商户侧入口下单（**已离开 OCP 协议面**） | `POST <checkout_api 绑定的 url>` |

### 各节点暴露的端点

Catalog 节点（每家奶茶铺）：

```
GET  /.well-known/ocp-catalog    发现文档
GET  /ocp/manifest               能力声明（query packs / 端点 / 可见性）
GET  /ocp/health                 存活
GET  /ocp/contracts              对象契约（只读节点为空数组）
POST /ocp/query                  查询
POST /ocp/resolve                解析成 action bindings
GET  /menu /store /order         商户自己的网站（不属于协议面）
```

Registration 节点：

```
GET  /health
GET  /.well-known/ocp-registration
GET  /ocp/registration/manifest
POST /ocp/catalogs/register      注册（会真的去拉目标的 discovery/manifest/health）
POST /ocp/catalogs/search        按元数据检索 Catalog
POST /ocp/catalogs/resolve       catalog_id → 路由提示
POST /ocp/catalogs/:id/refresh   重新拉取并刷新快照
GET  /ocp/catalogs/:id           目录档案快照
POST /ocp/catalogs/verify        501（本演示不做域名校验）
POST /ocp/catalogs/token/rotate  501（本演示不签发令牌）
```

最后两个返回 **501 而不是假装成功**：规范要求 manifest 里必须声明它们，
但本演示跑在 `http://127.0.0.1`，不做域名所有权校验，也不签发 `catalog_access_token`。

---

## 契约来源：官方 schema 与派生副本

"符合规范"这件事不靠嘴说。`vendor/` 下的 22 个 JSON Schema 是**从上游仓库原样复制的**，未改一行：

| 来源 | 数量 | 覆盖 |
|---|---|---|
| `vendor/handshake/` | 10 | manifest、health、commercial-object、object-contract、三个 pack、provider-registration … |
| `vendor/registration/` | 12 | registration-discovery、registration-manifest、catalog-search(-result)、catalog-route-hint、catalog-registration(-result)、catalog-refresh-result … |
| `schemas/derived/` | 1 个文件 | **上游没有 JSON Schema 的那些响应类型** |

第三行是这次开发最重要的发现：`CatalogQueryResult`、`ResolvableReference`、`ActionBinding`、
`CatalogEntry` 这些**只有 TS 类型定义、没有 JSON Schema**，它们住在需要 `zod` 的
`packages/ocp-schema` 里。本机装不了 zod，所以我把它们逐字段转写成 JSON Schema 放进
`schemas/derived/ocp.derived.v1.schema.json`，并在文件里用 `x-provenance` 标注每一条的出处。

自检结果：**34 个真实响应，12 条用官方 schema 校验，22 条用派生副本校验，全部通过。**

---

## 读规范时发现的几处不一致

这些是实际写代码时会踩到的坑，列出来比藏起来有用。**官方 schema 优先**是我的取舍：

| # | 位置 | 冲突 | 本项目的处理 |
|---|---|---|---|
| 1 | query / resolve / entry 响应 | 上游无 JSON Schema，只在 Zod 里 | 派生副本，标注来源，不当规范 |
| 2 | `CatalogSearchRequest.query` | JSON Schema 列为**必填**；Zod 是 `optional().default('')` | 按 Zod 放宽（省略即全量），自有请求始终显式传 |
| 3 | `CatalogSearch.filters` | JSON Schema **有** `query_mode`；Zod 的 `.strict()` 版本**没有** | 按 JSON Schema 支持 `query_mode` |
| 4 | `CatalogRouteHint` | Zod 有 `health_url`；JSON Schema 是 `additionalProperties: false` 且**未列**该字段 | 输出时**省略** `health_url`，以通过更严格的 JSON Schema |

---

## 演示里刻意体现的协议语义

这些点让"符合规范"变得可观察，而不只是字段齐全：

- **售罄就不给下单入口**：`purpose: "checkout"` 对售罄商品返回 **0 条** `action_bindings`，
  `permission_state: "limited"`，`live_checks[0].status: "failed"`，并在 `policy_notes` 里说明原因。
  这是节点**主动不给**，不是缺省。
- **`requires_user_confirmation: true`**：每个下单绑定都带这一位。协议自己在说"这步要人确认"。
- **strict 请求体拒绝未知字段**：`POST /ocp/query` 传 `sort_by` 会得到 `400 unexpected_field`
  （因为 `catalogQueryRequestSchema` 是 `.strict()`）。静默丢弃会让调用方误判成功。
- **只用声明的 pack**：传 `ocp.query.semantic.v9` 得到 `400 unsupported_query_pack`。
- **`policy_summary`**：每次查询都回报接受了哪些过滤字段、拒绝了哪些、有什么警告。
- **`stale_ignored`**：用旧 `registration_version` 重复注册会被忽略，而不是覆盖新数据。
- **身份不匹配要拒绝**：声明的 `catalog_id` 与目标 manifest 自报的不一致时，注册被拒。

---

## 验收清单

三条命令，期望输出写在后面：

```bash
node scripts/probe.ts shanhai            # 19/19  奶茶铺行为（含 6 个负例）
node scripts/probe.ts shiguang           # 19/19
node scripts/probe-registration.ts       # 20/20  发现层行为（含 8 个负例）
node scripts/selfcheck.ts                # 34/34  34 个响应过 JSON Schema
```

这些脚本在 `npm start` 已运行时也能直接跑——端口被占用时它们会**复用**现有实例而不是报错。

面板上手动走一遍：

1. 第 1 步输入「珍珠」→ 应命中 1 家（山海茶铺）；输入「奶茶」→ 命中 2 家；
2. 第 3 步点「负例：未声明的 pack」→ 应看到 400 与 `unsupported_query_pack`；
3. 第 4 步点「解析售罄款」→ 应看到 0 条绑定 + `live_check failed`；
4. 第 5 步下单 → 应拿到订单号，且 `payment` 为 `simulated_not_charged`。

---

## 边界：明确不做什么

- **不接任何支付通道**，不发生真实扣款，订单上带 `payment: "simulated_not_charged"`；
- 不接瑞幸或任何真实商户 API，不存任何密钥（技能正文的 Core Rule 也禁止在技能文件里存密钥）；
- 不动 DSH 配置，不碰现有 GUI；四个服务**只监听 `127.0.0.1`**。

---

## 与 `ocp-catalog` 技能的关系（一处已知偏差）

本演示的五步就是 `ocp-catalog` 技能正文 Workflow 的五步。但技能要求 **CLI First**：

> Prefer the OCP CLI instead of hand-written HTTP calls.

**本演示没有遵守这一条**，原因是 `@ocp-catalog/ocp-cli` 依赖 Bun（本机未安装），
它的 runner 在无 Bun 时回退到 `npx`，而本机 npm registry 不可达。
所以演示脚本 `demo/agent-demo.ts` 是手写 HTTP 调用。

等 Bun 和网络就绪后，同一套流程可以换成真实 CLI 再跑一遍：

```bash
ocp registration search --registration-url http://127.0.0.1:4500 --query "珍珠"
ocp catalog inspect http://127.0.0.1:4501/ocp/manifest
ocp catalog query --query-url http://127.0.0.1:4501/ocp/query --query-pack ocp.query.milktea.keyword.v1 --query "珍珠"
ocp catalog resolve --resolve-url http://127.0.0.1:4501/ocp/resolve --entry-id entry_provider_shanhai_sh-001
```

---

## 项目结构

```
milk-tea-ocp/
├── src/
│   ├── lib/
│   │   ├── http.ts            极简 HTTP 微框架（零依赖，node:http）
│   │   ├── schema-check.ts    JSON Schema 2020-12 子集校验器（支持跨文档 $ref）
│   │   ├── net.ts             端口占用时复用已有实例
│   │   ├── orders.ts          订单存储 + 按 input_schema 校价
│   │   └── ids.ts
│   ├── nodes/
│   │   ├── catalog-node.ts    Catalog 协议面（六端点 + 查询/解析语义）
│   │   ├── registration-node.ts  发现层（真的去拉目标 discovery/manifest/health）
│   │   ├── shop-pages.ts      商户网站：菜单 / 门店 / 下单页
│   │   └── panel-node.ts      演示面板静态服务
│   ├── shops/                 两家店的菜单数据与类型
│   └── start-all.ts
├── demo/
│   ├── index.html             五步可视化面板
│   └── agent-demo.ts          命令行演示
├── scripts/
│   ├── probe.ts               单店行为探针
│   ├── probe-registration.ts  发现层行为探针
│   └── selfcheck.ts           JSON Schema 一致性自检
├── schemas/derived/           上游缺失响应类型的派生副本（含 x-provenance）
└── vendor/                    从上游原样复制的 22 个官方 JSON Schema
```

---

## 许可

`vendor/` 下的 schema 与派生副本所依据的类型定义来自
[Open-Commerce-Protocol/OCP-Catalog](https://github.com/Open-Commerce-Protocol/OCP-Catalog)（MIT）。
本项目自身的代码同样以 MIT 使用。
