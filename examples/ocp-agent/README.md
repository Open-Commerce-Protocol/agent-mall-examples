# 寇豆码 · OCP Catalog Agent 演示

基于 **OCP（Open Commerce Protocol）Catalog 协议** 的可运行演示：Agent 根据用户自然语言需求，通过协议三阶段 **query → resolve → action** 自动检索商品、生成订单并完成自助下单。**零第三方依赖**，仅使用 Node.js 内置模块。

## OCP 协议总结

OCP Catalog Node 是对外提供商品「发现 / 查询 / 解析」能力的 HTTP 节点，本演示实现最小读面：

| 端点 | 方法 | 响应 kind | 说明 |
| --- | --- | --- | --- |
| `/.well-known/ocp-catalog` | GET | `WellKnownCatalogDiscovery` | 目录发现：各端点 URL 入口 |
| `/ocp/manifest` | GET | `CatalogManifest` | 能力清单：query pack / 是否支持 explain 与 resolve |
| `/ocp/health` | GET | `CatalogHealth` | 存活探针 |
| `/ocp/contracts` | GET | `ObjectContractList` | 对象契约（只读节点返回空） |
| `/ocp/query` | POST | `CatalogQueryResult` | 关键词检索（`ocp.query.keyword.v1`，keyword 模式，含 explain） |
| `/ocp/resolve` | POST | `ResolvableReference` | 把候选 entry 解析为可执行引用，返回 **action_bindings** |

**三阶段协议纪律**（本演示严格遵守）：

1. **query**：Agent 通过 `POST /ocp/query` 检索候选（`CatalogEntry`）。
2. **resolve**：用户选定候选后，Agent 调 `POST /ocp/resolve` 获取 `ResolvableReference` 及 `action_bindings`（含 `buy_now` API 下单动作与 `view` 页面动作）。
3. **action**：下单必须通过 resolve 返回的 `buy_now` binding 中的 **url** 执行（`POST /ocp/actions/buy_now`），Agent 不自行拼路径、不绕过协议直连数据。

**Action Provider 边界**：Catalog 只暴露动作入口；真正的执行、幂等、库存校验由 Action Provider（`src/catalog/order.js`）完成——同 `idempotency_key` 返回同一订单；缺货 / 未知 entry / 非法数量分别返回 400 / 404 / 400。

## 技术选型

- **运行时**：Node.js ≥ 22（内置 `fetch`、`node:test`、`node:crypto`、`node:http`）
- **零依赖**：无 npm install；CommonJS 模块
- **数据**：内存商品库（17 个中文商品，数码 / 户外 / 服饰 / 家居），金额统一用「元」整数（CNY），总额 = 单价 × 数量（整数乘法，避免浮点误差）
- **NLU**：中文规则解析（品类同义词组、预算表达、品牌白名单、中文数量词）
- **UI**：单文件 HTML + 原生 JS，无 CDN 无构建

## 项目结构

```
ocp-agent/
├── package.json          # scripts: start / test
├── README.md
├── config/
│   └── mcp.json          # 商家 MCP 注册配置（瑞幸 / 麦当劳）
├── _spec/                # 官方规范参考文档（只读，不属于本项目代码）
├── scripts/
│   └── e2e-mcp.js        # mock 商家 e2e 演示脚本（search → confirm → order）
├── src/
│   ├── server.js         # HTTP 入口：路由分发（OCP 端点 + Agent API + MCP API + 静态 UI），默认 8800
│   ├── catalog/
│   │   ├── store.js      # 内存商品库（数据源）
│   │   ├── ocp.js        # OCP 读面处理器（discovery/manifest/health/contracts/query/resolve）
│   │   └── order.js      # Action Provider：buy_now（幂等）/ 订单查询 / 列表
│   ├── agent/
│   │   ├── nlu.js        # 中文规则意图解析（含商家 domain 路由）
│   │   └── agent.js      # Agent 编排 + OcpClient（fetch 走 HTTP 协议）
│   ├── mcp/
│   │   ├── client.js     # 通用 MCP 客户端（streamable HTTP + stdio 双传输）
│   │   └── bridge.js     # MCP↔OCP 桥接（商家检索投影 / 真实下单）
│   └── ui/index.html     # 单文件演示界面
└── test/
    ├── test.js           # node:test 测试套件（OCP 演示目录）
    ├── mcp.test.js       # MCP 接入层测试（含 mock 商家服务端）
    └── fixtures/
        └── mock-merchant-mcp.js  # mock 商家 MCP 服务端（streamable HTTP）
```

## 运行方式

```bash
# 启动（默认端口 8800，可用 PORT 环境变量覆盖）
npm start

# 运行测试
npm test
```

- 演示界面：<http://127.0.0.1:8800/>
- 目录发现：<http://127.0.0.1:8800/.well-known/ocp-catalog>
- 健康检查：<http://127.0.0.1:8800/ocp/health>

### Agent API（供 UI / 客户端调用）

| 端点 | 方法 | 请求体 | 响应 |
| --- | --- | --- | --- |
| `/api/agent` | POST | `{ "text": "1000元以内的无线降噪耳机" }` | `{ intent, candidates, recommended_entry_id }` |
| `/api/agent/confirm` | POST | `{ "entry_id": "...", "quantity": 1 }` | `{ reference, order }` |
| `/api/agent/resolve` | POST | `{ "entry_id": "..." }` | `ResolvableReference`（UI 展示 action binding 摘要） |
| `/api/orders` | GET | - | `{ count, orders }` |
| `/api/mcp/status` | GET | - | `{ merchants: [{ id, name, token_present, connected, tool_count }] }`（connected 为缓存的真实连接状态） |
| `/api/mcp/token` | POST | `{ "merchant_id": "...", "token": "..." }` | `{ ok, connected, tool_count, merchant }`（**设置即验证**：保存后立即用该 token 真连一次商家 MCP；失败返回错误详情，401 提示「Token 无效或已过期」；token 仅存内存，重启失效） |

### 商家 MCP 相关

| 端点 | 方法 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `/ocp/actions/mcp/buy_now` | POST | `{ merchant_id, entry_id\|mcpRef, quantity, confirm, remark? }` | **真实下单**：必须携带 `confirm:true`，否则 400 |
| `/schemas/mcp-buy-now-request.json` | GET | - | 上述动作的入参 Schema（binding.input_schema 指向） |

## 示例问题清单（UI 顶部按钮可直接点）

1. `1000元以内的无线降噪耳机`
2. `300-800元的蓝牙音箱`
3. `预算500买个机械键盘`

更多可用表达：`低于300的保温杯`、`两副耳机`、`索尼降噪耳机`、`Salomon 登山鞋`、`露营用的帐篷`、`300-800元的蓝牙音箱 买2个` 等。

## NLU 支持的表达

- **品类**：耳机 / 键盘 / 音箱 / 帐篷 / 水壶（保温壶·保温杯）/ 鞋（登山鞋·徒步鞋）/ 服饰（冲锋衣·外套）/ 家居（枕头·四件套）
- **预算**：`1000元以内`、`预算500`、`低于300`、`300-800`、`不超过800`
- **品牌**：小米、索尼、罗技、华为、ikbc、骆驼、牧高笛、乐扣乐扣、Stanley、迪卡侬、Salomon、优衣库、凯乐石、网易严选、水星家纺
- **数量**：`买2个`、`两副`、`三台` 等

## 真实下单（商家 MCP）

除了内存演示目录，本应用还能接入**商家提供的 MCP（Model Context Protocol）服务端**，把真实商家的商品检索与下单接入 agent 流程。已注册两个真实商家（均为 Streamable HTTP 传输）：

| 商家 | id | MCP 端点 | Token 环境变量 |
| --- | --- | --- | --- |
| 瑞幸咖啡 | `my-coffee` | `https://gwmcp.lkcoffee.com/order/user/mcp` | `MY_COFFEE_TOKEN` |
| 麦当劳 | `mcd-mcp` | `https://mcp.mcd.cn` | `MCD_TOKEN` |

### 架构（文字版）

```
用户输入「来杯瑞幸生椰拿铁」
        │
        ▼
NLU domain 路由（src/agent/nlu.js）
  命中商家词表（咖啡/拿铁/生椰…→ my-coffee；麦当劳/汉堡…→ mcd-mcp）
        │
        ▼
Agent（src/agent/agent.js）
  ├─ 未配置 token → 返回 merchant_unconfigured 提示（UI 引导设置）
  └─ 已配置 → MCP Bridge（src/mcp/bridge.js）
        ├─ queryShopList(默认杭州坐标)        → 取门店 deptId
        ├─ searchProductForMcp(deptId, query) → 商品候选
        └─ 投影为 CatalogEntry 兼容形状（+ mcpRef + action_binding）
        │
        ▼
用户点「真实下单」→ /api/agent/confirm（agent 层）
  协议纪律：通过 binding.url POST /ocp/actions/mcp/buy_now（confirm:true）
        │
        ▼
Bridge：previewOrder（真实价 + 优惠券）→ createOrder → 返回真实 orderId
```

### 配置方法

1. **获取 Token**：打开商家 App / 小程序（瑞幸 / 麦当劳）登录后，复制用户 Token（Bearer 后面的内容）。
2. **设置 Token**（三选一，优先级从高到低）：
   - 环境变量：`MY_COFFEE_TOKEN=xxx` / `MCD_TOKEN=xxx`；
   - 配置文件 `config/mcp.json` 的商家节点加 `"token": "xxx"` 字段；
   - UI 页面顶部「商家 MCP」状态条：点击商家徽标 → 输入 Token → 保存（调 `POST /api/mcp/token`，仅存内存，重启失效）。
3. **位置覆盖**（可选）：默认使用杭州坐标（120.026221, 30.279212），可通过 env `OCP_AGENT_LON` / `OCP_AGENT_LAT` 覆盖。

### 完整下单流程

1. 在输入框说「来杯瑞幸生椰拿铁 买2杯」→ Agent 识别商家 → 实时检索门店与商品 → 返回候选卡片（红色「真实下单」标识 + 实时价格）。
2. 点击「真实下单（N 件）」→ 浏览器二次确认「将向商家真实下单并可能产生费用」。
3. Bridge 先 `previewOrder` 拿真实价格与优惠券，再 `createOrder` 创建真实订单。
4. 回执显示「真实下单成功」：商家名、门店、订单号、预估总额（区分 demo / real 订单）。

### 安全提示

- ⚠️ **真实下单会产生实际费用**：`/ocp/actions/mcp/buy_now` 会向商家创建真实订单，请求必须显式携带 `confirm:true`，否则返回 400（`confirm_required`）。
- Token 等同于商家账户凭证，请勿泄露；通过 UI 设置的 Token 仅保存在服务端内存，重启失效。
- 演示 / 测试建议先用 mock：`node scripts/e2e-mcp.js`（内置 mock 商家服务端，全链路不花钱）。

### 常见问题（BugFix 记录 · 2026-10-11）

- **401 = Token 无效或已过期**：商家服务器返回 401 时，agent 会返回 `merchant_error` 且错误消息带原始响应详情（前 300 字符），UI 以红色错误卡醒目展示（绝不回退本地演示商品）。
- **响应乱码已修**：真实商家服务器会对响应做 gzip/deflate/br 压缩，且 HTTP chunk 边界可能截断 UTF-8 多字节字符。`src/mcp/client.js` 现按 `content-encoding` 用 `node:zlib` 解压（`decodeHttpBody`，误标时回退原文），并把响应体收集为完整 Buffer 后**一次性** UTF-8 解码，中文不再乱码。
- **Token 设置即验证**：`POST /api/mcp/token` 保存后会立即用该 token 真连一次商家 MCP（initialize + tools/list）。成功返回 `connected:true` + `tool_count` 并弹窗确认；失败（如 401）直接返回「Token 无效或已过期」等错误详情，避免「存了个坏 token 却浑然不知」。
- **价格字段对齐真实接口**：商品价取 `estimatePrice`（折后价，CNY），规格取 `productAttrs` 压缩简述（如「大杯/冰」），图片取 `pictureUrl`；门店优选 `workStatus=营业中` 且 `distance` 最小者；订单总额取 `previewOrder` 的 `data.discountPrice`（或 `productInfoList[].estimateTotalPrice` 求和），优惠券 `couponCodeList` 原样透传给 `createOrder`；业务码 `code!==0 / success!==true` 时抛错并带 `msg` 内容。

## 测试覆盖（`npm test`）

- 五个 OCP 端点 kind 形状 + 统一错误形状（404）
- query 命中与预算过滤（Agent 编排层）
- resolve 含 `buy_now` API binding 与 `view` URL binding，未知 entry 返回 404
- 下单幂等：同 `idempotency_key` 两次请求返回同一 `order_id`
- buy_now 校验：缺参 400 / 未知 entry 404 / 非法数量 400
- 库存不足（out_of_stock）拒绝下单
- e2e：「1000元以内的无线降噪耳机」→ query → resolve → order 全链路
- NLU 单测：预算 / 品牌 / 数量 / 品类与关键词拆分

新增（`test/mcp.test.js`，共 14 个 test 用例）：

- MCP client（streamable HTTP）：initialize / tools list / tools call / session id 回传
- SSE（text/event-stream）响应解析；401（token 无效）错误
- stdio 传输（node -e 起 echo JSON-RPC 子进程）
- bridge search → preview → createOrder 全链路（走 mock 商家）；token 缺失报错与运行时 setToken
- server 路由：/api/mcp/status、/api/mcp/token、/ocp/actions/mcp/buy_now（无 confirm 400 / confirm 成功）、agent confirm 协议纪律路径
- NLU 商家 domain 路由（词表命中 / 长词优先「麦咖啡」/ 未命中回落演示目录）

BugFix 回归（2026-10-11 新增 5 用例）：

- gzip 压缩响应正确解压且中文无乱码（`content-encoding: gzip`）
- `decodeHttpBody`：Buffer 聚合一次性解码（chunk 边界多字节截断回归）+ gzip/deflate/br + 误标回退
- 真实商家返回形状映射（estimatePrice→price / 门店优选营业中 / spec / image_url / couponCodeList 透传 / 业务码校验）
- `/api/mcp/token` 设置即验证（401 返回「Token 无效或已过期」；成功返回 connected+tool_count）
- NLU 新增词表命中（浓缩 / Dirty / 丝绒拿铁 / 橙C / 柚C + 麦麦 / 板烧鸡腿 / 1+1）
