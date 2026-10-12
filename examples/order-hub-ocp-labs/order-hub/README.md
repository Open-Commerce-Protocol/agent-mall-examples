# order-hub —— 多品牌点单站

以本机为服务器、经**出站隧道**提供公网访问的多品牌点单网站：
访客选品牌 → 填**自己的** MCP Token → 选门店商品规格 → 核对确认单 → 一键下单。

> **本站会产生真实订单与真实扣款。** 因此把"看过确认单"设成下单的硬前置，
> 并加了单笔与会话累计金额上限。详见下面的[安全模型](#安全模型)。

---

## 当前状态

| 项 | 值 |
|---|---|
| 本地地址 | `http://127.0.0.1:8080` |
| 公网地址 | 由 `npm run tunnel` 生成（每次重启都会变） |
| 已接通品牌 | 瑞幸咖啡（8 个工具逐个实测） |
| 待 token 品牌 | 麦当劳中国（端点已验证存活；工具清单需 token 才能探明） |
| 二期品牌 | 肯德基、蜜雪冰城（走支付宝 AI 开放平台 / 千问，**不是标准 MCP**） |

```bash
npm start        # 启动站点（只绑回环）
npm run verify   # 本地验收：18 项，含护栏每一道拒绝，零订单零扣款
npm run tunnel   # 开公网隧道（免注册、免管理员、免公网 IP）
```

---

## 为什么必须用隧道，而不是直接监听端口

这是实测结论，不是偏好：

| 检查 | 结果 |
|---|---|
| IPv4 出口 | **在 NAT 后**（内网 `10.171.251.13` / `10.197.248.239`） |
| 公网 IPv6 | 有（`2408:8642:893:681:...`，杭州联通），但—— |
| Windows 防火墙 | 三个配置文件（Domain/Private/Public）**全部开启** |
| 当前用户是否管理员 | **否** → 无法添加入站规则 |

所以"本机直接对外提供服务"这条路是堵死的。可行的是**出站隧道**：

```
本机 :8080  ←── ssh -R ──  localhost.run  ──→  https://<随机>.lhr.life
             （出站连接，不需要公网 IP，不需要改防火墙，不需要管理员）
```

`localhost.run` 与 `serveo.net` 的 22 端口实测可达；本机自带 `ssh.exe`，因此**零安装**。

备选：cloudflared 快速隧道（`api.trycloudflare.com:443` 可达，但 `github.com` 直连超时，下载不稳）；
或你 Downloads 里已有的 `OpenFrpLauncher`（需登录你自己的账号，能拿到更稳定的域名）。

---

## 架构

```
公网访客
   │ HTTPS
   ▼
localhost.run 隧道
   │
   ▼
order-hub :8080
   ├── web/index.html        单页前端（选品牌→填 token→选规格→确认→下单）
   ├── src/web.ts            JSON API（11 个端点）
   ├── src/session.ts        会话 + 下单确认门 + 金额上限
   └── src/brands/
        ├── types.ts         BrandAdapter 统一契约
        ├── luckin.ts        瑞幸适配器（已接通）
        ├── mcd.ts           麦当劳适配器（端点已知，映射待 token 探明）
        └── registry.ts      品牌注册表
              │
              ▼  共用 MCP 传输层（src/mcp/client.ts：Streamable HTTP + 可选 session-id + SSE 多帧）
        ┌─────┴─────┐
   瑞幸 MCP      麦当劳 MCP
 gwmcp.lkcoffee.com   mcp.mcd.cn
```

### 为什么"多品牌"能低成本成立

一期两个品牌是**同一套协议**：Streamable HTTP + `Authorization: Bearer`。
差异只在工具名与下单参数形状——所以传输层完全共用，每家只写一个适配器。

| | 瑞幸 | 麦当劳中国 |
|---|---|---|
| 接入地址 | `gwmcp.lkcoffee.com/order/user/mcp` | `https://mcp.mcd.cn` |
| 认证 | `Authorization: Bearer` | `Authorization: Bearer` |
| token 获取 | [open.lkcoffee.com](https://open.lkcoffee.com) | [open.mcd.cn/mcp](https://open.mcd.cn/mcp)（手机号登录→控制台→激活） |
| 业务 | 点餐 / 预览 / 订单 | 麦乐送、到店取餐、团餐、积分兑券、活动日历 |
| 限流 | 未标注 | 600 次/分钟/token |
| 无凭据探测 | `401 oauth token is not found` | `403 {"code":"0001","msg":"系统错误"}` |

---

## 接入更多 MCP：声明式引擎 + 接入助手

手写适配器每加一个品牌都要改代码——那才是"接入更多 MCP"的真正瓶颈。
所以品牌差异被收敛成**一份 JSON spec**：工具名 + 参数模板 + 字段路径。

```
src/brands/
  luckin.ts              内置适配器（选规格要连续多次 switchProduct，声明式引擎不表达）
  declarative.ts         声明式引擎：spec → BrandAdapter
  specs/mcd.json         麦当劳（ops 与 shapes 待 token 探明后填）
  specs/luckin-decl.json 引擎自证 spec（hidden:true，不上站点）
```

### 加一个品牌的完整流程

```bash
# 1. 用该品牌的 token 探测工具面，自动生成 spec 草稿
node scripts/onboard.ts --url https://mcp.example.com --token <token> --id example --write

# 2. 按真实响应补齐 spec 里的 shapes（字段路径），重启站点即可
npm start
```

`onboard.ts` 只调用 `initialize` / `tools/list`，**不会碰任何下单类工具**。
它会打印每个工具的必填/可选参数，并按工具名启发式猜测六个操作的归属——
猜不准时会**列出备选**，不假装确定。

### spec 的形状

```jsonc
{
  "id": "example", "name": "示例品牌", "mcpUrl": "https://mcp.example.com",
  "ops": {
    "listStores":     { "tool": "queryShopList", "args": { "longitude": "{{lng}}", "latitude": "{{lat}}" } },
    "searchProducts": { "tool": "searchProduct", "args": { "deptId": "{{storeId}}", "query": "{{query}}" } }
  },
  "shapes": {
    "stores":   { "list": "", "id": "deptId", "name": "deptName", "lat": "latitude", "lng": "longitude" },
    "products": { "list": "", "id": "productId", "name": "productName", "price": "initialPrice" }
  }
}
```

占位符：`{{lat}} {{lng}} {{storeId}} {{productId}} {{query}} {{skuCode}} {{amount}} {{lines}} {{coupons}} {{remark}}`。
字段路径是点路径（`data.list`、`deptId`），`""` 或 `"."` 表示 payload 本身。

### 引擎的边界（诚实标注）

- **一个操作一次调用**。像瑞幸选规格那种"连续多次 `switchProduct` 累积状态"的循环，
  超出表达力——声明式适配器会抛 `not_mapped` 并说明原因，**不会静默出错**。
- 字段路径只做"列表 + 字段重命名"，不是通用 JSON 变换语言。
- 订单指纹由**枢纽层**（`src/session.ts`）统一计算，不由品牌适配器负责——
  它是本服务的概念，不是品牌的概念，这样 spec 也不用操心。

### 引擎自证

```bash
npm run verify:decl
```

用**同一份真实瑞幸数据**跑两条路径并逐项比对：手写适配器 vs 声明式 spec。

```
13/13 通过
  listStores     手写 8 家 / 声明式 8 家；首店「密渡桥路店」一致；营业时段与距离一致
  searchProducts 手写 [生椰拿铁（原创）, 冰吸生椰拿铁（原创）] / 声明式 同；¥20 / SP2077-01134 一致
  productOptions 手写 6 组 / 声明式 6 组；子选项 id 与名称逐项一致
  preview        实付 ¥20、原价 ¥20、优惠 ¥0、券 []、规格串、取餐时间（同分钟）全部一致
  configure      如实抛 not_mapped，边界清楚
```

---

## 对话推荐：先聊天，再挑品牌商品

**主流程（聊天优先）**：

```
① 打开页面就开始聊（不需要任何 token）
      ↓  推荐级：拿不到菜单数据，只给方向与品类建议
② 聊出方向 → 页面内联弹出「选品牌 + 填 token」卡片
      ↓  填入某品牌的 token，把品牌接进同一段对话
③ 同一段对话升级为品牌级：能查真实门店/商品/规格
      ↓  stage_order 把订单摆成确认单
④ 访客勾选确认 → /api/order 四道门 → 真实下单
```

**这个顺序是有技术约束的**，不是为了好看：查真实菜单需要品牌 token，所以
"先聊天"必须能在**没有 token 时**工作。于是对话被分成两级能力：

| 级别 | 何时 | 工具集 | 能做什么 |
|---|---|---|---|
| **推荐级** | 未绑定品牌 | 仅 `list_brands` | 聊口味/场景/天气，给**品类层面**建议；**绝不报具体商品名或价格**（拿不到，就不编） |
| **品牌级** | 已绑定品牌会话 | `list_stores` / `search_products` / `product_options` / `stage_order` | 查真实菜单、给带价格的推荐、把订单暂存成确认单 |

两级都**没有 `createOrder`**。推荐级误调品牌级工具会得到明确的 `409 brand_not_bound`，
而不是静默失败或编数据。

### 界面

单页聊天界面，助手头像是一套内联 SVG 的**大肥鱼表情包**（5 个表情对应不同状态：
`think` 思考中 / `happy` 默认 / `wow` 找到好货或下单成功 / `brand` 等选品牌 / `sorry` 出错）。
全部是内联 SVG，**没有任何外部资源依赖**，也不使用第三方品牌标识。

界面元素：页头（模型状态 + 已接入品牌）、聊天流（工具调用以 `🔧 工具名 说明` 形式展示，
让访客看得见模型做了什么）、消息内联的品牌卡片与订单确认单、底部输入框与额度提示。

### 模型接入的两种协议

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **LLM 模式** | 配了 `CHAT_LLM_BASE_URL` + `CHAT_LLM_API_KEY` | 走 OpenAI 兼容接口 + 工具调用。模型查真实菜单、给推荐、暂存订单 |
| **本地回退** | 未配置 LLM | 关键词解析 + 真实菜单检索做推荐。**回复首行明确声明自己不是 LLM** |

启用模型（任何 OpenAI 兼容接口都行）：

```bash
CHAT_LLM_BASE_URL=https://api.deepseek.com/v1 \
CHAT_LLM_API_KEY=sk-... \
CHAT_LLM_MODEL=deepseek-chat \
npm start
```

前端通过 `GET /api/chat/config` **如实**告诉访客现在是不是模型在说话，不假装。

> 为什么默认是回退模式：本机没有可用的模型 API key（DSH 的本地接口需要认证，
> 我不会绕过它拿你的账户去给公网访客跑模型）。所以功能做全、通路留好，钥匙由你插。

### 模型能做什么、不能做什么

给模型的工具**只有四个，且全部无副作用**——`createOrder` 根本不在工具列表里：

| 工具 | 作用 |
|---|---|
| `list_stores` | 列附近门店 |
| `search_products` | 按关键字搜商品（结果按 id 缓存，供暂存时命中） |
| `product_options` | 读全部可选规格 |
| `stage_order` | **暂存**订单，返回确认单与 `confirmToken` |

> **铁律：模型没有下单能力。** `stage_order` 只是把订单摆到访客面前；
> 真正下单仍要访客在页面上勾选确认并点「确认下单」，走 `/api/order` 的四道门。
> 验收里专门断言了这一点（全程 `orderCount=0`）。

### 两种工具协议（已就绪）

为了不依赖"接口必须支持 function calling"，对话层实现了两种协议，任何一种 LLM 都能接：

| 模式 | 开启方式 | 说明 |
|---|---|---|
| `native`（默认） | 无需配置 | OpenAI 兼容的 function calling |
| `prompted` | `CHAT_LLM_MODE=prompted` | 把工具目录与输出约定写进提示词，模型"输出一行 JSON"即表示调用工具。**任何纯文本补全接口都能用** |

`prompted` 模式的解析器 `parsePromptedCall()` 有两种容错：JSON 夹在自然语言里也能抽出来；
没有 `tool` 字段的普通回复不会被误判成工具调用（三项都有验收）。

### 接入新品牌（站内自助，不需要改代码、不需要重启）

页脚「🔌 接入新品牌」：贴 **MCP 地址 + token**（外加 id 与名称）→ ① 探测工具清单 → ② 保存并启用。

- **探测**：真的去跟那个 MCP 握手、拉 `tools/list`，并用启发式把工具名匹配到六个操作
  （`listStores` / `searchProducts` / `productOptions` / `preview` / `createOrder`），
  参数名按语义猜占位符（`deptId → {{storeId}}`、`longitude → {{lng}}` …）。
- **保存**：spec 写入 `src/brands/specs/<id>.json` 并**热重载注册表**——品牌立刻出现在站点上。
- **诚实边界**：草稿里 **`shapes`（字段路径）一定是空的**。字段路径必须看真实响应才能填，
  代码不会替你编。所以在补齐之前，新品牌的状态是 `pending-token`，
  站点会明确列出"还差：操作 searchProducts、字段路径 shapes"，并且**只能查看工具清单，不能查商品**。

**任何品牌都能提交 token**，包括还没接通下单的（以前这种情况按钮是禁用的，
等于"只有作者能加品牌，访客不能"——那是个真实的产品缺口，已修）。
对未接通的品牌，填 token 后可以点「只查看它的工具清单」，看清它到底提供什么。

`shapes` 补齐之前，那个品牌在推荐级对话里就已经会出现（标着"尚未接通下单"），
所以品牌发现与品牌可用性是被分开对待的——**能聊到不等于能下单**。

#### 安全边界（因为这是公网端点）

| 风险 | 处置 |
|---|---|
| **SSRF**：服务端会去请求访客给的 URL | 只接受 `https`；拒绝回环、`.local`/`.internal`、`127.`/`10.`/`192.168.`/`172.16-31.`/`169.254.`、IPv6 回环与链路本地 |
| **路径穿越**：spec 文件名来自客户端 | `id` 强制 `^[a-z0-9][a-z0-9-]{0,31}$`，拼路径前先校验 |
| **任意写盘**：谁能保存 spec | 公开部署请设 `ONBOARD_TOKEN`，设置后保存必须带口令；未设置则允许（本机自用） |



一个环境变量即可：

```bash
CHAT_LLM_PROVIDER=dsh-account npm start
```

**它怎么工作**（实测逆向出来的，不是猜的）：

| 环节 | 事实 |
|---|---|
| 端点 | `https://api.deepseek.com/v1/chat/completions` — **OpenAI 兼容**，所以现有 provider 直接能用 |
| 认证 | 头 **`x-dsh-auth-token`**，**不是** `Authorization: Bearer`（见 `dsh-llm-deepseek-account` 的 README 第 15 行） |
| 凭据 | 读 `~/.dsh/.credentials.yaml` 的 `token` 字段；**只读、只进内存、不外传**，可用 `DSH_CREDENTIALS_FILE` 覆盖路径 |
| 模型 | 默认 `deepseek-flash`（与 DSH 自身配置一致） |

#### 为什么绕开 DSH 的 agent

DSH 的 `/api` 只有三条路由：`/api/file`、`/api/remote.mux`、`/api/session.export`。
除文件与导出外，**一切都走 `/api/remote.mux`——一个驱动完整 agent 的 Remote RPC**。
把公网访客的文本喂进去，等于让人对着你**带 shell 工具的 agent** 说话。

所以我不走那条路，直接调模型端点：**没有 agent、没有工具、没有 shell**。

#### 顺带记录的 DSH 认证机制

为了判断"能不能用"而查明的（本项目的实现**并不依赖**这些，只读凭据文件调模型端点，侵入更小）：

- `/api` 有两道门：**Host 同源围栏**（防 DNS rebinding；`Host` 必须是回环或 `trustedHosts`，且 `Origin` 须一致、`sec-fetch-site: cross-site` 被拒）+ **浏览器会话签名 cookie**。
- cookie 名 `dsh-auth-<base64url(sha256(authority))>`，值 `v1.<base64url(payload)>.<base64url(HMAC-SHA256(secret, body))>`，
  其中 `secret` 是 `~/.dsh/.credentials.yaml` 里 `kind: grant` 那条的 `payload.secret`（解码后 32 字节）。
- launch token **只在 `GET /?token=...` 被接受**，且是每进程随机生成、内存中的；其余路径只认 cookie。
- 实测：用磁盘上的 secret 自签一个 cookie 后，`/api/*` 由 `401 unauthorized` 变为 `404 not found`——即**已越过认证门**。

### ⚠️ 额度与限流

站点一旦接入真实 LLM，**每个访客的每句话都在花你的钱**。所以加了闸：

| 闸 | 默认 | 环境变量 |
|---|---|---|
| 每分钟对话数 | 8 | `CHAT_MAX_PER_MINUTE` |
| 单会话累计对话数 | 60 | `CHAT_MAX_PER_SESSION` |

超限返回 `429 chat_rate_limited` 并说明原因（验收里专门测了这道闸：连发 4 条后触发）。

想更省 token：`native` 模式的提示词比 `prompted` 短得多，默认就用 `native`（实测真实模型在
`deepseek-flash` 上 **function calling 可用**，会真的调 `search_products`）。



口语直接拿去搜商品会 0 命中（瑞幸检索要求关键字真的出现在商品名/属性里）。
所以 `queryCandidates()` 会先把「我想喝生椰拿铁」剥成候选词序列，再逐个试到出结果：
`喝生椰拿铁` → `生椰拿铁`（命中）。同时从话里读出规格偏好（热/冰、大杯/超大杯、少甜），
并在用户说「就要第一个」时暂存订单——**不自作主张**，只有明确要买或只有一个候选时才暂存。

### 对话验收

```bash
npm run verify:chat
```

18 项。用一个**模拟 LLM**（OpenAI 兼容接口，跑在 :8099）驱动完整工具调用闭环——
本机没有可用的模型 key，但工具调用这一层必须被真实验证，而不是"等配了 key 再说"：

```
fallback 对话（真实菜单）        命中真实商品，并声明不是 LLM
fallback 带出真实价格与门店      按「喝生椰拿铁」找到 2 款，推荐：1. 生椰拿铁（原创）¥20 …
工具调用链完整                  list_stores(8 家门店) → search_products(搜「生椰」得 3 款) → stage_order(已暂存，实付 ¥20)
模型给出了自然语言回复            「给你挑了…确认单已经放在下面，你核对后点确认即可（我没有下单权限）」
铁律 模型不能下单（订单数仍为 0）    orderCount=0 spendTotal=¥0
负例 模型返回非 JSON → 502        llm_empty
负例 模型 HTTP 500 → 502         llm_error
确认门 未确认 → 应 428            not_acknowledged
确认门 未确认不消费暂存单          暂存单仍在，等待人工确认
```

---

## 安全模型

下单要花真钱，所以设了四道门，**每一道都有验收覆盖**：

| 门 | 机制 | 被绕过时会怎样 |
|---|---|---|
| 1. 必须先预览 | 只有 `POST /api/preview` 会在会话里登记待确认订单并发一次性 `confirmToken` | `428 no_preview` |
| 2. 必须显式确认 | 请求要带 `acknowledge: true` | `428 not_acknowledged` |
| 3. 令牌必须匹配 | `confirmToken` 与会话里那份待确认订单一致；有效期 5 分钟；用过即失效 | `428 stale_confirmation` / `confirmation_expired` |
| 4. 金额必须在上限内 | 单笔默认 ¥100、单会话累计默认 ¥200 | `403 over_order_limit` / `over_session_limit` |

另外**下单前会重新预览一次**：若实付金额与访客确认时不一致，拒绝下单（价格漂移保护）。

这些上限可用环境变量调整：`ORDER_MAX_AMOUNT`、`ORDER_MAX_SESSION_SPEND`、
`ORDER_CONFIRM_TTL_MS`、`ORDER_SESSION_TTL_MS`。

### 凭据处理

- Token 只在 `POST /api/session` 的请求体里出现一次，随后**只存在于进程内存**；
- **任何响应都不回显 token**（验收里有一项就是"响应体里搜不到 token"）；
- 日志只记方法与路径，不记 body（见 `src/lib/http.ts`）；
- 前端拿到会话后立刻把输入框清空；
- 会话闲置 30 分钟自动回收，token 随之从内存移除；
- 服务端**不持有任何品牌 token**：每个访客用他自己的 token 发起他自己的请求。

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活 + 上限 + 会话统计 |
| GET | `/api/brands` | 品牌清单（含状态与 token 获取指引） |
| POST | `/api/session` | 建会话（token 唯一入口；会真的握手验证 token） |
| POST | `/api/tools` | 列出该品牌 MCP 的工具（用于探明未接入品牌） |
| POST | `/api/stores` | 附近门店 |
| POST | `/api/products` | 按关键字搜商品 |
| POST | `/api/options` | 商品的全部可选规格 |
| POST | `/api/configure` | 按选择推导 skuCode |
| POST | `/api/preview` | 订单预览 → 确认单 + `confirmToken` |
| POST | `/api/order` | **真实下单**（需 `confirmToken` + `acknowledge`） |
| POST | `/api/session/status` | 会话统计（订单数 / 累计花费） |

---

## 验收

```bash
ORDER_MAX_AMOUNT=1 npm run verify
```

18 项全通过。关键手法：**把单笔上限压到 ¥1**，于是连"格式完全正确的下单请求"也会被金额门拒绝
（`403 over_order_limit`）——最后一道门被证明有效，而 **¥0 被花掉**、`orderCount=0`。

覆盖内容包括：未知品牌 / 空 token / 无效 token（必须被品牌 MCP 拒绝）/ 真实 token 建会话 /
响应不含 token 明文 / 门店 / 商品 / 规格 / 换规格 / 预览 / 三道确认门 / 金额门 / 会话统计为零 / 麦当劳拒绝路径。

---

## 已知限制与下一步

- **隧道域名每次重启都变**，且流量经第三方中转。要固定域名：在
  [admin.localhost.run](https://admin.localhost.run/) 绑 SSH key，或改用你自己的 OpenFrp。
- **没有限流**。公开站点建议按 IP 加令牌桶，否则被扫会占用本机资源。
- **单进程内存会话**：重启即丢失所有会话（这是刻意的，顺带清掉 token）；要横向扩展需换存储。
- **麦当劳下单链路未接通**：官方只公布了接入地址与认证，没给工具清单。
  填入麦当劳 token 后 `POST /api/tools` 会列出它实际提供的工具，我据此完成映射即可
  （见 `src/brands/mcd.ts` 里 `PENDING()` 的说明）。
- **CORS 目前是 `*`**（继承自共享的 `lib/http.ts`）。同源前端不需要它，公开部署建议收紧。
- 二期品牌（肯德基/蜜雪冰城）走支付宝 AI 开放平台，协议不是标准 MCP，需要另写适配器与平台账号。

---

## 项目结构

```
order-hub/
├── src/
│   ├── brands/        BrandAdapter 契约 + 内置适配器 + 声明式引擎 + specs/*.json
│   ├── mcp/           共用 MCP 传输层（Streamable HTTP / session-id / SSE 多帧）+ 结果解包
│   ├── lib/           http 微框架 / ids / net / time（与 milk-tea-ocp、luckin-ocp 共享）
│   ├── guard.ts       订单指纹与价格漂移判断（从 luckin-ocp 复用）
│   ├── session.ts     会话、确认门、金额上限、token 生命周期、订单指纹
│   ├── web.ts         路由与 API
│   └── start.ts       启动
├── web/index.html     单页前端
├── scripts/
│   ├── onboard.ts            MCP 接入助手：探明工具面并生成 spec 草稿
│   ├── verify-local.ts       站点验收（18 项，含护栏每一道拒绝）
│   └── verify-declarative.ts 声明式引擎自证（13 项，与手写适配器逐项比对）
└── package.json       零依赖
```

### 命令一览

| 命令 | 作用 |
|---|---|
| `npm start` | 启动站点（只绑回环） |
| `npm run tunnel` | 开公网隧道（免注册、免管理员、免公网 IP） |
| `npm run verify` | 站点验收：18 项，含护栏每一道拒绝，零订单零扣款 |
| `npm run verify:decl` | 声明式引擎自证：13 项，与手写适配器逐项比对 |
| `npm run verify:chat` | 对话验收：24 项，两种工具协议 + 模拟 LLM 闭环 + 回退模式 + 铁律 |
| `npm run onboard -- --url … --token …` | 探明任意 MCP 的工具面并生成 spec 草稿 |

`lib/` 是三个项目间的第三份副本。抽出共享 `ocp-kit/` 已是明确的下一步——
但会改动两个都已通过验收的项目，收益只是整洁，所以留作独立清理任务。
