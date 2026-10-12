# 点单站与 OCP 实验

三个各自独立的项目，围绕同一个想法：**让 AI 通过标准协议去真实地点一杯咖啡**。

| 目录 | 是什么 | 端口 |
|---|---|---|
| [`order-hub/`](#order-hub) | **主项目**：多品牌点单站。聊天推荐 → 选品牌填 token → 查真实菜单 → 暂存订单 → 人工确认下单。已接通瑞幸咖啡的真实 MCP | 8080 |
| [`luckin-ocp/`](luckin-ocp/README.md) | 瑞幸 MCP ↔ OCP 的桥接：把瑞幸的门店与商品暴露成 OCP Catalog | 4700-4702 |
| [`milk-tea-ocp/`](milk-tea-ocp/README.md) | 纯虚构的 OCP 演示：两家奶茶店 + Registration 节点 + 面板，用来验证 OCP 协议本身 | 4500-4600 |

三者都是**零依赖**：只用 Node 内置模块，没有 `npm install` 这一步。

## 快速开始

要求 **Node ≥ 22.18**（需要它原生执行 `.ts`，靠类型擦除，无需编译）。

```bash
cd order-hub
node src/start.ts            # 打开 http://127.0.0.1:8080
```

跑验收（不需要任何 token 的那些）：

```bash
node scripts/verify-entry.ts     # 入口 + 首页 + 路由挂载
node scripts/verify-onboard.ts   # 站内接入：SSRF/路径穿越防护 + 热重载
```

需要真实瑞幸 token 的验收：

```bash
export LUCKIN_TOKEN=<你的 token>       # 或 LUCKIN_TOKEN_FILE=<含 Authorization: Bearer 的文件>
node scripts/verify-declarative.ts     # 只读，14 项
ORDER_MAX_AMOUNT=1 node scripts/verify-local.ts   # ⚠️ 见下面的警告
```

## ⚠️ 三条安全须知（请先读）

### 1. `verify-local.ts` 必须带 `ORDER_MAX_AMOUNT=1`

这个脚本里有一处 **`acknowledge: true` 且 confirmToken 正确的下单请求**——它故意用来证明"金额门"有效。
上限大于实付金额时，那道门就不再拦它，**请求会真的打到商户并产生扣款**。

脚本已内置联锁：`ORDER_MAX_AMOUNT` 不等于 `1` 时直接拒绝运行（退出码 2）。
但它有顶层 `await`，**被 `import` 时就会执行**——不要把它（或任何 `scripts/verify-*.ts`）当作模块去 import 做"加载检查"。

### 2. token 绝不入库

所有 token 都通过环境变量或本机文件提供，代码里没有任何硬编码凭据。
`.gitignore` 已排除常见凭据文件。**提交前请自己再 `grep` 一遍**。

模型接入是可选的，两种方式：

```bash
# 方式一：任意 OpenAI 兼容接口
export CHAT_LLM_BASE_URL=https://api.example.com/v1
export CHAT_LLM_API_KEY=sk-...
export CHAT_LLM_MODEL=deepseek-chat

# 方式二：复用本机 DSH 桌面端的账户额度（见 order-hub/README.md 的说明）
export CHAT_LLM_PROVIDER=dsh-account
```

**不配置模型也能跑**：对话会退化为"基于真实菜单的关键词推荐"，并在回复里明确声明自己不是模型。

### 3. 下单一律要人点确认

模型和推荐器**都没有 `createOrder`**。它们只能把订单"暂存"成确认单，真实下单要走 `/api/order` 的四道门：
预览 → 显式确认（`acknowledge: true`）→ 令牌与订单指纹匹配 → 金额上限。
另有价格漂移保护：下单前重新预览，金额与确认时不一致就拒绝。

## 许可与来源

- **请自行选择许可证**（本仓库尚未指定）。若要用 MIT/Apache 等，直接在根目录加 `LICENSE` 即可。
- `vendor/` 与 `schemas/derived/` 里的 OCP JSON Schema 取自 OCP（Open Commerce Protocol）规范，
  沿用其原始许可；`schemas/derived/` 下的是官方 schema 未覆盖的类型（`CatalogQueryResult`、
  `ResolvableReference`、`ActionBinding`、`CatalogEntry`）的**派生副本**，文件内以 `x-provenance` 标注了来源。
- 第三方品牌名称、接口地址仅用于互操作说明，**不代表任何背书**；仓库内不含任何品牌方的商标资源。
- 界面里的"大肥鱼"助手形象是**自制内联 SVG**，不依赖任何外部图片资源。

## 架构要点

- **零依赖 / 无构建**：Node 直接跑 `.ts`，没有 bundler、没有编译步骤。
- **一个门店 = 一个 OCP Catalog**：瑞幸的接口是按门店作用域的，这样切分让 OCP 的跨 Catalog 发现真正有意义。
- **加一个品牌 = 加一个 JSON**：`src/brands/declarative.ts` 是"spec → 适配器"引擎；
  只有需要多步状态循环的品牌（比如瑞幸的规格切换）才需要手写适配器。
- **对话分两级能力**：未绑定品牌时是"推荐级"（拿不到菜单，只给品类建议）；
  绑定后升级为"品牌级"（能查真实门店/商品/规格）。这样"先聊天"不需要先有 token。
- **站内自助接入**：网站里贴 MCP 地址 + token 就能探测工具清单、生成 spec 草稿、保存并热重载。
  字段路径（`shapes`）必须按真实响应填写——代码不会替你编。
