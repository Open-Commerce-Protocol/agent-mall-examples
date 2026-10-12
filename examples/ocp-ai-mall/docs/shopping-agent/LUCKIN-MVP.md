# 逛逛 AI 商场 · 瑞幸下单

更新日期：2026-10-11。目前接入瑞幸真实商品、规格切换、订单预览、确认下单及订单查询。下单返回支付二维码，由用户扫码支付；不代用户支付或自动取消订单。

## 启动与使用

使用仓库固定的 Bun 1.3.13：

```powershell
bun install --frozen-lockfile
bun run shopping:demo
```

打开终端给出的 `/demo` 或 `/`。若已有演示占用端口，可运行 `bun run shopping:preview` 使用空闲端口。模型设置位于 `/settings#api-configuration`，支持 OpenAI 兼容、Anthropic、Gemini；未配置模型时仍可直接检索与手动下单。

瑞幸授权从服务器环境变量 `LUCKIN_MCP_TOKEN` 或本项目忽略的 `.codex/config.toml` 中 `mcp_servers.my-coffee` 读取。后者必须指向官方 MCP 地址，支持 `http_headers.Authorization` 或 `bearer_token_env_var`。令牌不进入网页、命令行、模型提示或提交文件。

位置由后端 `FixedMallLocation` 提供，固定为经度 **120.15**、纬度 **30.25**。页面可选择实际返回的附近门店，不调用浏览器或 IP 定位。目前真实下单采用到店自取，一次选择一种规格、1–20 杯。

## 真实下单与扫码支付

打开商品卡片 → 选择规格、数量和备注 →「核对金额并下单」→ 核对自取门店、地址、规格及优惠后金额 →「确认下单」。此按钮调用真实 `createOrder`，成功后显示订单号和支付二维码。后端根据商家返回的支付链接生成 PNG，同时保留商家二维码与支付链接。点击「我已支付 / 刷新订单状态」核对支付和取餐状态；「我的订单」可在刷新或重启后重新打开二维码。

真实订单独立持久化于忽略的 `.codex-tmp/luckin-live/orders.sqlite`，所有本机展示端口共用该目录，避免新开演示目录绕过未决提交。浏览器身份与后端授权均参与访问校验。本版仅面向本机单用户；保留浏览器 Cookie 才能查看自己的历史订单。

订单预览本地有效期为 2 分钟，不代表商家锁价。确认前重新查询预览，价格、优惠或商品改变时要求重新核对。SKU、优惠券和坐标均使用后端保存的数据，不接受前端覆盖。提交先写入 SQLite，再调用商家；同一预览不会重复发送。超时、格式异常和重启中断保留未决状态，暂停新订单。上游没有按请求号查单能力，需到瑞幸核对，不自动重试或假定失败。

`LUCKIN_NEW_ORDERS=disabled` 可停用新下单，保留已有订单查询。`orderIdStr` 优先于可能超出 JavaScript 精度的数字订单 ID；支付目标仅接受瑞幸/微信地址。支付二维码不传给模型，不存入浏览器存储。取消与退款尚未接入。

## 接口核验与验证边界

工具契约与指纹见 [工具契约](../../fixtures/luckin/tools-list.2026-10-11.json)。运行时校验输入 schema 指纹与响应字段。输出映射依据[瑞幸官方接口文档](https://open.lkcoffee.com/mcp)及只读实测；[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)支持 JSON/SSE、会话、分页、超时与授权失效，不自动重放业务调用。

| 工具 | 当前处理 |
|---|---|
| `queryShopList` | 已实测固定坐标门店查询，只投影门店展示字段 |
| `searchProductForMcp` | 已实测，展示预估价与有限候选 |
| `queryProductDetailInfo` | 已实测，核验商家可选属性 |
| `switchProduct` | 已实测冷热切换，使用返回的新 SKU |
| `previewOrder` | 已实测，核对门店/商品/数量，优惠券仅留后端 |
| `createOrder` | 明确确认后真实调用；按官方文档解析订单与支付信息 |
| `queryOrderDetailInfo` | 查询后端保存的订单号，展示真实状态及取餐码 |
| `cancelOrder` | 尚未开放 |

本次真实只读验收包含门店、商品、规格切换和订单预览。创建、二维码和支付后查询由合成 MCP 的 HTTP/浏览器测试验证；未代用户提交真实购买，也未完成真实支付验收。不要把合成测试二维码当成真实付款码。

```powershell
bun run luckin:test
bun run luckin:check
bun run luckin:browser
bun run shopping:check
```

测试覆盖重复点击、前端篡改、价格变化、预览过期、订单持久化、未决提交、账户与浏览器隔离、长订单 ID、支付链接校验及桌面/手机二维码显示。自动化不使用真实授权或真实订单。

## 模块与离线环境

- `packages/luckin-adapter`：显式 MCP 工具白名单、查询与交易响应映射、持久替身。
- `packages/luckin-integration/src/live-workflow.ts`：真实订单登记、重新核价、重复提交保护与查询。
- `packages/agent-runtime/src/mall-guide.ts`：模型导购，不授予模型订单写权限。
- `apps/shopping-agent-api/src/mall.ts`：门店和选择绑定、真实下单 API、支付二维码生成。
- `apps/shopping-agent-web/public/mall.*`：商场、确认页、订单记录与二维码。

原独立合成环境 `bun run luckin:fixture` 保留在 `http://127.0.0.1:8790`，使用 `.codex-tmp/luckin-fixture/{workflow,upstream}.sqlite`。原咖啡演示通过 `bun run shopping:demo --legacy` 保留。这些模拟数据不显示为瑞幸订单事实。

本版不宣称公网登录、多账户运营、自动定位、自动支付或自动退款能力。原阶段规划记录见 [适配规划](LUCKIN-ADAPTATION-PLAN.md)。
