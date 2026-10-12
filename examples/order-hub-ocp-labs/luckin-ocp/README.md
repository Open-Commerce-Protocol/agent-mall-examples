# luckin-ocp —— 用 OCP 协议接入瑞幸官方 MCP

把瑞幸咖啡的官方 MCP 服务**包成一个 OCP 目录**，让"点一杯咖啡"这件事走协议而不是走私有接口。

核心分层主张：

> **OCP 管发现与协商，MCP 管执行。**
> 这不是硬凑的——OCP 仓库自己的 README 就把 MCP 归为 *adapter/tooling layer*，并且带了 `packages/webmcp-adapter`。

对应的实现边界也很清楚：`OCP resolve` 只能给出**入口**（`action_binding`），
它不定义凭据传递、不代客成交；真正的下单与支付留在桥接层与瑞幸侧。

---

## 一分钟跑起来

要求：**Node ≥ 22.18**（原生跑 TypeScript，无编译步骤、无 `npm install`）。`dependencies` 为空。

```bash
npm start          # 起三个服务（4700 / 4701 / 4702）
npm run demo       # 端到端五步演示（不会真实下单）
npm run selfcheck  # 一致性自检：44 个响应逐条过 JSON Schema
npm run probe:mcp  # 只读探测 MCP 客户端与 8 个工具
npm run probe:core # 核心链路 + 护栏双向验证（不会真实下单）
```

token 读取顺序：环境变量 `LUCKIN_MCP_TOKEN` → DSH 配置 `cordis.patch.yml` 里的 `Authorization` 头
（可用 `LUCKIN_DSH_CONFIG` 覆盖路径）。**token 不会被打印，也不会写入任何文件。**

---

## 架构

```
             Agent / 面板
                  │  OCP 协议
                  ▼
   ┌──────────────────────────────────────────┐
   │ OCP Catalog 节点  :4700                   │  一家门店 = 一个 Catalog
   │   /stores/:deptId/ocp/manifest            │  query → searchProductForMcp
   │   /stores/:deptId/ocp/query               │  resolve → 实时详情 + action bindings
   │   /stores/:deptId/ocp/resolve             │
   └──────────────────────────────────────────┘
                  │  action_binding 指向 ↓
                  ▼
   ┌──────────────────────────────────────────┐
   │ 桥接执行层  :4701                         │  ★ token 只存在于这里
   │   /product /configure /preview            │  只读
   │   /create                                 │  ⚠ 受护栏保护
   │   /order/query /order/cancel              │
   └──────────────────────────────────────────┘
                  │  MCP JSON-RPC (Streamable HTTP)
                  ▼
        https://gwmcp.lkcoffee.com/order/user/mcp

   ┌──────────────────────────────────────────┐
   │ Registration 节点  :4702                  │  8 家门店 = 8 个独立 Catalog
   │   /ocp/catalogs/search                    │  空查询按距离排序
   │   /ocp/catalogs/resolve                   │
   └──────────────────────────────────────────┘
```

### 为什么"一家门店 = 一个 Catalog"

瑞幸的检索接口本身就是门店维度的（`searchProductForMcp` 必填 `deptId`），
所以门店就是最自然的目录边界。这样做的好处是 OCP 的发现层能真的提供**跨独立目录聚合**：

```
npm run demo 的第 3.5 步
  · 滨绿大厦A座负一楼店   0.3371km  命中 2 款  生椰拿铁（原创） ¥20
  · 密渡桥路店            0.3607km  命中 2 款  生椰拿铁（原创） ¥20
  · 武林门地铁站E口店      0.4039km  命中 2 款  生椰拿铁（原创） ¥20
```

如果只有一个 Catalog，发现层就是多余的。

---

## 瑞幸 MCP 的 8 个工具（实测）

| 工具 | 作用 | 副作用 |
|---|---|---|
| `queryShopList` | 查门店（必填经纬度） | 读 |
| `searchProductForMcp` | 按自然语言匹配门店商品 | 读 |
| `queryProductDetailInfo` | 商品详情（含全部可选规格） | 读 |
| `switchProduct` | 按"当前 sku + 要改的属性"推导新 skuCode | 读（纯函数，无副作用） |
| `previewOrder` | 订单预览：原价/优惠/实付/取餐时间/券 | 读 |
| `createOrder` | 创建订单 | ⚠️ **真实扣款** |
| `queryOrderDetailInfo` | 查订单详情 | 读 |
| `cancelOrder` | 取消订单 | 写 |

服务端标识：`luckyordermcpmaster v1.0.0`，协议 `2025-06-18`，无状态（不下发 `mcp-session-id`）。

---

## 映射决策：MCP 工具 → OCP `action_type`

OCP 的 `action_type` 只有四种：`url` / `api` / `workflow` / `contact`。

| MCP 工具 | 映射为 | 理由 |
|---|---|---|
| `queryProductDetailInfo` | `api` | 无副作用读 |
| `previewOrder` | `api` | 只算价，不产生订单 |
| `switchProduct` | `workflow` | 多步状态机：按顺序应用多个属性切换 |
| `createOrder` | `workflow` + **`requires_user_confirmation: true`** | 有副作用的多步流程 |
| `queryOrderDetailInfo` | `api` | 读 |
| `cancelOrder` | `workflow` | 写，且 `requires_user_confirmation: true` |
| （联系方式） | **不给绑定** | MCP 未暴露门店电话，所以如实返回空数组 + `policy_note`，而不是编一个 |

`requires_user_confirmation` 是 OCP 自带的字段，正好用来表达"这一步要真人点头"——不是本项目发明的约束。

---

## 下单护栏（本项目最重要的部分）

`createOrder` 会产生**真实订单与真实扣款**。所以桥接层**默认拒绝执行**：

```
POST /create  →  428 Precondition Required
{
  "error": { "code": "confirmation_required", "message": "桥接层未武装，拒绝执行真实下单。…" },
  "order_summary": { 门店 / 商品 / 规格 / 数量 / 原价 / 优惠 / 实付 / 取餐时间 / 券 },
  "fingerprint": "3c7489ebcde603ee",
  "armed_fingerprint": null,
  "how_to_arm": { step_1, step_2, step_3 },
  "note": "未发生任何订单，未产生任何扣款。"
}
```

解锁的唯一方式：环境变量 **`LUCKIN_ORDER_CONFIRM=<订单指纹>`** + 重启桥接层。

三层保护：

1. **默认拒绝**：未武装时任何人都下不了单，包括模型和脚本。
2. **指纹绑定具体订单**：指纹 = `sha256(deptId + 排序后的商品行 + 券 + 备注)`。
   改任何一项（换门店、换规格、加数量）指纹就变，**旧确认自动作废**。
3. **价格漂移保护**：请求可带 `expected_amount`。若下单前重新预览得到的实付金额
   与确认时不一致，返回 428 `price_changed` 并拒绝——防止"你确认的是 ¥20，实际扣了 ¥23"。

这也就是 OCP `requires_user_confirmation: true` 落到实处的样子：
让"确认"成为**必须由人做出的、针对具体订单的**动作，而不是一个可以被默认满足的开关。

---

## 凭据边界（为什么必须分层）

OCP 的 `auth_requirements` 是自由对象，**协议不定义凭据如何传递**。因此：

- token 只存在于桥接层（`:4701`）；
- **永远不会出现在 Catalog 节点的任何响应里**（`:4700` 的 manifest/query/resolve 都不含 token）；
- 也不会写进 skill 文件——`ocp-catalog` 技能正文的 Core Rule 明令禁止存密钥。

---

## 实测响应形状（照实记录，不是照文档猜的）

`previewOrder` 的金额字段是 `totalInitialPrice`（原价）/ `privilegeMoney`（优惠）/ `discountPrice`（实付），
`couponCodeList` 是券码数组（本项目实测为空，即**无可用券**，所以实付就是原价 ¥20）。

**发现一处上游接口的命名不一致**：`queryProductDetailInfo` 对杯型返回 `594:超大杯`（无价格），
而 `switchProduct` 的返回树里同一档叫 `650:特大杯`（+¥3）——**名称不同，但 id 都能用**。

实测确认：把 `594` 作为 `switchProduct` 的 `subAttr.attributeId` 传进去，返回
`HTTP 200` 且 sku 从 `SP2077-01134` 变为 `SP2077-01033`。所以 `queryProductDetailInfo`
给出的 id **是可以直接用于选规格的**；差异只在展示名称，不构成功能阻塞。
（最初我据名称不同推断"必须以 switchProduct 的返回树为准"，实测后已修正该结论。）

---

## 验收

```bash
npm run probe:mcp   # 5/5    MCP 客户端、8 个工具、门店/商品/预览（只读）
npm run probe:core  # 19/19  核心链路 + 护栏双向验证（只读，零订单）
npm run selfcheck   # 44/44  44 个响应过 JSON Schema（官方 23 + 派生/自定义 21）
npm run demo        # 端到端五步演示（只读，零订单）
```

三个脚本在 `npm start` 已运行时也能直接跑——端口被占用会**复用**现有实例。

`selfcheck` 里 `/create` 的用例**故意传一个不可能匹配的 `expected_amount`**：
护栏的判断顺序是 未武装 → 指纹 → 金额，所以该用例在两种状态下都落在拒绝分支，
**结构上不可能走到真正下单**。即使护栏被误武装，它只会得到 `price_changed`。

### 一致性自检的 schema 来源

| 来源 | 数量 | 覆盖 |
|---|---|---|
| `vendor/`（上游原样复制） | 22 | manifest、health、object-contract、三个 pack、registration 全套 |
| `schemas/derived/`（派生 + 本项目自定义） | 1 文件 | 查询/解析响应（上游**没有** JSON Schema，只在需要 `zod` 的 TS 包里）；桥接层契约（不是 OCP 协议面，属本项目自定义，文件内用 `x-provenance` 标注） |

---

## 演示过程中发现并修掉的两个真实缺陷

记在这里，因为它们比"功能跑通"更有参考价值：

1. **发现层的 `route_hint.metadata` 缺 `work_hours`**。演示据此选门店时拿不到营业时间，
   回退到最近的一家——而那是 08:00–16:00 的店，当时 15:58，预览给出的取餐时间是 **16:02，已经打烊**。
   修法：把 `work_hours` 放进 route hint，演示侧按"距打烊 ≥30 分钟"筛选，
   并打印**为什么跳过某家店**。
2. `live_check` 一行因为键名超过 20 字符而丢了分隔空格。

第 1 条说明：**发现层该携带的信息如果缺失，调用方就会做出错误决策**——
这正是 OCP 强调 route hint 字段完整性的原因。

---

## 边界：明确不做什么

- 不在未经用户逐项确认的情况下调用 `createOrder`（护栏在代码层面保证这一点）；
- 不把 token 写进 OCP 响应、日志或 skill 文件；
- 不修改 DSH 配置；三个服务只监听 `127.0.0.1`；
- 不假装有优惠券（预览给空数组就如实说"无可用券"）。

---

## 项目结构

```
luckin-ocp/
├── src/
│   ├── mcp/
│   │   ├── client.ts          MCP JSON-RPC 客户端（session-id / SSE 多帧 / notification）
│   │   └── tools.ts           8 个工具的类型化封装 + {code,msg,data} 解包
│   ├── catalog/
│   │   ├── luckin-catalog.ts  OCP Catalog 节点（门店维度 query/resolve）
│   │   ├── registration-node.ts  门店索引成独立 Catalog
│   │   └── store-directory.ts    门店缓存（deptId ↔ 门店信息）
│   ├── bridge/
│   │   ├── bridge-node.ts     执行层 7 个端点
│   │   └── guard.ts           ★ 下单护栏（指纹 + 价格漂移保护 + 显式武装）
│   ├── lib/                   http / schema-check / net / ids（与 milk-tea-ocp 共享）
│   ├── bootstrap.ts           统一启动（端口占用则复用）
│   └── start-all.ts
├── demo/agent-demo.ts         端到端五步演示
├── scripts/
│   ├── mcp-probe.ts           只读探测 MCP 层
│   ├── probe-core.ts          核心链路 + 护栏验证
│   └── selfcheck.ts           JSON Schema 一致性自检
├── schemas/derived/           派生 + 自定义契约（含 x-provenance）
└── vendor/                    上游原样复制的 22 个官方 JSON Schema
```

---

## 已知问题（不在本项目范围内）

- **DSH 自带的 MCP 客户端显示 `server is disconnected`**。已排除网络与 token：
  端点可达、严格 TLS 校验通过、token 有效（直接 HTTP 调用返回 200 + 真实数据）。
  `dsh-mcp-client` 文档写明它优先协商 `2026-07-28` 协议，而该服务端回 `2025-06-18`；
  且配置里 `failOnStartupError: false`，所以启动失败是**静默的**。系统里没找到 DSH 日志。
  **这不影响本项目**——桥接层直接走 HTTP。
- `lib/` 三个文件与 `milk-tea-ocp` 重复。抽成共享 `ocp-kit/` 是更干净的长期结构，
  但那会改动一个已通过 73 项验证的交付物，收益为零，所以推迟到出现第三个应用时再做。

---

## 安全提醒

token 明文存放在 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `Authorization` 头里，
**等同于点单权限**。请勿外发或提交到 git；若该文件会进入云同步/备份，建议轮换。
