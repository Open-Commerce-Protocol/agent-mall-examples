# CampusNow 前端 API 契约(给设计/Codex 用)

后端已完成且冻结,**前端只需重绘,不要改后端**。前端是纯静态文件,放在 `public/` 目录(入口 `public/index.html`),由后端直接伺服(任意文件结构都支持:`css/js/svg/png` 均可)。无需构建步骤,原生 HTML/CSS/JS 即可,改完刷新浏览器生效。

- 服务地址:`http://localhost:4420`(启动:`bun run start`)
- 前端与后端**只通过本文档中的 fetch 接口通信**
- 渲染模式:**状态驱动** —— 轮询 `GET /api/state`(建议 900ms),根据 `phase` 决定显示什么、哪个按钮可点;用户动作都是一次 POST,后端推进状态机

---

## 1. 状态机(核心)

```
IDLE → PARSED → PLAN_AWAIT_CONFIRM → ORDER_AWAIT_PAY → PAID
      → INVOICE_AWAIT_CONFIRM → INVOICE_SUBMITTED → INVOICE_ISSUED
      → EMAIL_RECEIVED → ARCHIVED(完成)
                                   ↘(回退模式跳过邮件两态)
任意态 → FAILED
```

`phase` 与 UI 的关系:

| phase | 界面要点 | 可用动作 |
|---|---|---|
| `IDLE` | 输入框可编辑 | POST `/api/need` |
| `PARSED` | 解析中(短暂) | 无 |
| `PLAN_AWAIT_CONFIRM` | 商品决策区出方案+剔除项 | POST `/api/confirm-plan` |
| `ORDER_AWAIT_PAY` | 订单区出支付按钮 | POST `/api/pay` |
| `PAID` | 短暂 | 无 |
| `INVOICE_AWAIT_CONFIRM` | 开票资料核对卡 | POST `/api/confirm-invoice` |
| `INVOICE_SUBMITTED`→`EMAIL_RECEIVED` | 开票状态轮次推进 | 无(等状态自己走) |
| `ARCHIVED` | 完成态:归档路径 | POST `/api/reset` |
| `FAILED` | 红色错误卡(有 `error` 字段) | POST `/api/reset` |

> 注意两条剧本:**商家开票**(全状态)与**本地模拟开票回退**(`plan.invoice_fallback=true` 时,`INVOICE_ISSUED` 后直接归档,无邮件环节)。

---

## 2. 接口列表

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| GET | `/api/state` | — | **唯一数据源**,返回 TaskState(见 §3),前端轮询 |
| POST | `/api/need` | `{"raw":"自然语言需求"}` | 发起任务,返回最新 state |
| POST | `/api/choose-plan` | `{"option_id":"B"}` | **团购模式**:在多套方案中选择一套 |
| POST | `/api/confirm-plan` | `{}` | 确认采购方案 → 创建订单 |
| POST | `/api/pay` | `{}` | 模拟支付 |
| POST | `/api/confirm-invoice` | `{}` | 提交开票申请 |
| POST | `/api/reset` | `{}` | 重置任务回 IDLE |
| GET | `/api/mailbox` | — | 测试邮箱(演示用,一般不必需) |
| GET | `/api/invoices` | — | 全部开票记录 |
| GET | `/api/invoice/{id}/file` | — | 发票/模拟收据 HTML 文件(可直接 iframe/新窗口打开) |

---

## 2.5 团购模式(新增,增量字段,不影响旧流程)

话术含「N个人 + 咖啡/瑞幸」即触发(如:`我今天有6个人,100预算,课题组报销,点瑞幸,两个人不喝咖啡,另外有一个人不喝冰的`)。

**新增 need 字段**:`people_total`(总人数)、`non_coffee`(不喝咖啡人数)、`no_ice`(不喝冰人数)、`purpose`(用途,如「课题组报销」)。

**新增 plan 字段**:

```jsonc
"plan": {
  "group_options": [              // 非 null 即团购模式:渲染「方案选择卡」
    { "id": "A", "label": "经济款",
      "lines": [
        { "title": "小黄油拿铁(原创)", "qty": 3, "unit_price": 9.9, "list_price": 19,
          "hot": false, "noncoffee": false, "note": null },
        { "title": "小黄油拿铁(原创)", "qty": 1, "unit_price": 9.9, "list_price": 19,
          "hot": true,  "noncoffee": false, "note": "选热(不喝冰的成员)" },
        { "title": "橙C冰茶", "qty": 2, "unit_price": 9.9, "list_price": 15,
          "hot": false, "noncoffee": true,  "note": "不含咖啡(不喝咖啡的成员)" }
      ],
      "total": 59.4, "remaining": 40.6,      // remaining = 预算 - total
      "rationale": "最实惠组合:…" },
    { "id": "B", "label": "人气款", "...": "..." },
    { "id": "C", "label": "满配款", "...": "..." }
  ],
  "menu_source": "real-mcp",               // real-mcp | local-fallback(降级,需提示)
  "group_chosen": { "...": "选中方案的原始数据" }
}
```

**交互**:group_options 存在且 phase=PLAN_AWAIT_CONFIRM 时,每张方案卡放一个「选这套」按钮 → `POST /api/choose-plan {option_id}`;选择后 group_options 变 null,plan.recommended/total 切换为所选方案,再走 confirm-plan。不选直接 confirm-plan = 默认推荐 A。

### 2.5.1 真实订单模式(重要:标签不能再一律写「模拟」)

`bun run start` 默认开启 `CAMPUSNOW_REAL_ORDER=1`(e2e 与 `start:mock` 为关闭)。开启后,团购流程中**只有开票是模拟的**,其余全部真实:

- 菜单:真实(searchProductForMcp,紫金港店,实时价格)
- 下单:真实(MCP createOrder,微信支付体系)
- 支付:**前端弹出 `order.pay_qr_url` 二维码图片**(`<img src=…>`,它是可直接加载的 PNG),用户微信扫码付款
- 支付检测:后端每 3 秒轮询;`pay_status_name` 变化会体现在 state 与 trace,**支付到账后自动从 ORDER_AWAIT_PAY 推进到 INVOICE_AWAIT_CONFIRM**(前端轮询自然刷新)
- 撤单:`POST /api/cancel-order`(未支付订单撤销,零费用);已支付订单不可撤

**order 新增字段**:

```jsonc
"order": {
  "real": true,                       // ★ true=真实订单;false/缺省=模拟订单(标签随之变化)
  "mcp_order_id": "7695313…",          // 瑞幸真实订单号
  "pay_qr_url": "https://open.lkcoffee.com/transfer/qrcode?token=…",  // 二维码 PNG,直接 <img>
  "pay_url": "weixin://wxpay/bizpayurl?pr=…",                          // 微信拉起链接(桌面端无效,备用)
  "pay_status_name": "待付款"          // 待付款 →(支付后)已支付/制作中…;实时更新
}
```

**UI 要求(Codex)**:

1. `order.real === true` 时:订单标签由「模拟订单」改为「**真实订单 · 微信扫码支付**」;支付按钮区域换成**二维码大图 + 金额 + 「微信扫码支付」提示**,外加两个次按钮:「我已支付,立即检测」(`POST /api/check-payment`)和「撤单(未支付零费用)」(`POST /api/cancel-order`,需确认弹窗)
2. `pay_status_name` 实时显示(轮询 state 即可,支付成功后页面自动进入开票环节,可加 toast「支付已确认」)
3. 顶部全局徽标按 `order.real` 区分:「真实瑞幸 MCP · 开票为本地模拟」vs「测试环境 · 全流程模拟」;归档区说明同样区分
4. 开票环节文案(真实订单):「瑞幸未开放 Agent 开票接口,正式发票可在瑞幸 App 内人工申请;此处生成**本地模拟收据**仅作归档演示」

**商品数据来自瑞幸真实 MCP**(searchProductForMcp,紫金港店 327143,实时价格);失败自动降级本地数据并在 trace 标注(降级时订单自动回落为模拟)。团购归档输出 4 个文件:发票 HTML、order-summary.json、**order.csv**(Excel 直开,BOM+用途+合计)、**报销TODO.md**(勾选清单)。发票为本地模拟收据(SIMINV- 前缀,含「用途」行)。

POST 均返回最新 TaskState(同 `/api/state`)。

---

## 3. TaskState 数据结构(`/api/state` 返回)

```jsonc
{
  "phase": "PLAN_AWAIT_CONFIRM",          // 见 §1 状态机,另有 FAILED
  "error": null,                           // FAILED 时的错误文案,其余为 null

  "need": {                                // NLU 解析结果(任务理解卡)
    "raw": "帮我购买一套 200 元以内的实验室电子配件…",
    "item_query": "电子配件",
    "budget": 200,                          // 可能为 null(不限)
    "quantity": 1,
    "require_invoice": true,
    "invoice_title_type": "organization",   // organization | personal
    "invoice_title": "浙江大学",
    "invoice_tax_id": "12100000470095XXX(测试税号)",
    "email": "lab-zjg@test.edu.cn"
  },

  "plan": {                                // 采购方案(商品决策区)
    "recommended": [{                       // 推荐项
      "item": {
        "id": "e-001", "title": "面包板套装(830孔×3)",
        "summary": "高中密度面包板三连包…",
        "category": "prototyping", "amount": 12, "currency": "CNY",
        "availability": "in_stock",         // in_stock | low_stock | out_of_stock
        "tags": ["电子配件","基础"],
        "invoice_supported": true,          // ★ 开票能力
        "invoice_note": null                // 不支持时的原因说明
      },
      "catalog_id": "cat_campus_electronics",
      "catalog_name": "校园电子配件铺(紫金港)",
      "mount": "/elec",
      "reason": "命中「电子配件」"
    }],
    "excluded": [                           // 被剔除的候选(透明性,建议展示)
      { "title": "便携示波器(入门款)", "catalog_name": "…", "reason": "超预算(¥399 > ¥200)" },
      { "title": "生椰拿铁", "catalog_name": "瑞幸咖啡铺(浙大紫金港店)", "reason": "不支持在线开票(App 内人工申请开票…)" }
    ],
    "total": 46.9,
    "within_budget": true,
    "invoice_fallback": false,              // ★ true=商家均无开票接口,走本地模拟开票
    "rationale": "推荐 3 件,合计 ¥46.90;全部支持在线开票。"
  },

  "order": {                               // 订单(开票工作区)
    "order_id": "CN02731337",
    "catalog_id": "cat_campus_electronics",
    "catalog_name": "校园电子配件铺(紫金港)",
    "lines": [{ "object_id": "e-001", "title": "面包板套装(830孔×3)", "amount": 12 }],
    "total": 46.9,
    "paid": false                           // true=已支付(模拟)
  },

  "invoice": {                             // 开票申请(开票工作区)
    "invoice_id": "TESTINV-02731338",       // SIMINV- 前缀=本地模拟回退
    "status": "emailed",                    // submitted→processing→issued→emailed
    "title": "浙江大学",
    "email": "lab-zjg@test.edu.cn",
    "history": [{ "at": "2026-10-11T07:15:00.000Z", "note": "测试发票已发送至 …" }]
  },

  "archive": {                             // 归档结果(完成态)
    "dir": "/abs/path/campusnow/archive/2026-10-11/校园电子配件铺_紫金港_/CN02731337",
    "files": ["/abs/…/invoice-TESTINV-02731338.html", "/abs/…/order-summary.json"],
    "archived_at": "2026-10-11T07:15:10.000Z"
  },                                       // null=未归档

  "trace": [                               // ★ Agent 执行轨迹(强烈建议保留展示)
    { "at": "2026-10-11T07:14:52.000Z",
      "source": "ocp",                     // user|agent|ocp|merchant|mail|fs|system
      "text": "POST /elec/ocp/query(query=\"电子配件\") → 200,7 条" }
  ]
}
```

`need`/`plan`/`order`/`invoice`/`archive` 各字段在对应阶段前为 `null`。

---

## 4. 设计红线(评委看得见的原则,不可弱化)

1. **所有模拟必须显著标注**:订单/支付是模拟(`payment: mock`)、发票是测试(`TESTINV-`/`SIMINV-`),界面需有醒目的「测试环境」标识。
2. **回退场景必须醒目**:`plan.invoice_fallback === true` 时,商品决策区要有警示——「商家不提供开票接口,将生成**本地模拟收据**(非商家开具、非正式税务凭证)」,确认按钮文案也要变(如「继续购买(本地模拟开票)」)。
3. **三处人工确认**:采购方案 → 模拟支付 → 开票资料,对应三个 phase 的按钮,不得自动跳过。
4. **剔除项透明展示**:`excluded` 列表(含原因)是产品亮点,建议默认可见。
5. Agent 不持有支付密码——支付区文案请保留这层安全边界的说明。

## 5. 三个演示话术(测试用)

- **商家开票全流程**:`帮我购买一套 200 元以内的实验室电子配件,优先选择支持单位电子发票的商家。下单后我来付款,随后帮我申请浙江大学抬头的电子发票,发送到指定邮箱。`
- **瑞幸无接口回退**:`帮我买杯瑞幸咖啡,开浙江大学抬头的电子发票,发送到 test@example.com`
- **团购多方案(真实菜单)**:`我今天有6个人,100预算,课题组报销,点瑞幸,两个人不喝咖啡,另外有一个人不喝冰的`

## 6. 现有实现(仅作参考,可整体替换)

- `public/index.html` — 四区布局(对话/商品决策/订单开票/轨迹归档)
- `public/app.js` — 轮询渲染逻辑(状态驱动的参考实现)
- 后端在 `src/`,`bun run e2e` 可随时回归验证(31 断言,不依赖前端)
