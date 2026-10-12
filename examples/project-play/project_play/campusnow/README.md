# 🎓 CampusNow — 校园智能采购与电子发票 Agent

Agent Mall 黑客松 · OCP 应用赛道。**让校园采购不止于下单**:用户表达一次需求,Agent 跨商家完成 采购 → 下单 → 开票 → 邮件 → 本地归档 的完整工作流。

## 跑法

```bash
bun install
bun run start    # 打开 http://localhost:4420/
bun run e2e      # PRD §7 验收清单自动化(23 断言)
```

输入框已预填演示话术,点「发起采购任务」后按界面提示:确认方案 → 模拟支付 → 核对开票资料 → 自动开票/收件/归档。

## 架构(单进程)

```
Web UI(四区) ──轮询── Agent API ── 状态机(NLU→计划→订单→开票→归档)
                                 │ 真实 HTTP OCP 调用
                 ┌───────────────┴────────────────┐
           elec OCP Catalog                luckin OCP Catalog
           电子配件·支持开票                  咖啡·不支持Agent开票
           (六协议端点+下单/开票)             (六协议端点+下单)
                 └──── 测试开票服务 + 测试邮箱 + 本地归档 ────┘
```

## 协议设计点

| 设计 | 实现 |
|---|---|
| 三种 resolve 用途 | `purpose=view`→url 动作 / `checkout`→api 下单 / **`workflow`→开票工作流**(全在 schema 枚举内,零私有扩展) |
| 开票能力发现 | 商品 `attributes.invoice_supported` + filter pack 扩展字段 `invoice_supported` |
| 声明 vs 确认 | manifest/条目只是「声明支持」;**已支付订单**才通过商家侧资格校验,重复开票被拒(409) |
| 动作治理 | 下单/开票均 `requires_user_confirmation=true` + 10 分钟时效 |
| 跨商家统一 | 同一 OCP 接口查两家目录;不支持开票的商家(瑞幸)被透明过滤并说明原因 |

## 安全与诚实边界

- 所有订单/支付/发票均为**测试模拟**,文件显著标注「测试发票 · 非正式税务凭证」
- Agent 不持有支付密码;支付、方案、开票资料三处需用户确认
- 任何一步失败都不伪装成功(PRD 铁律),独立状态可追溯(执行轨迹区)

## 异常演示(路演可现场触发)

缺货下单→409 / 重复开票→409 / 未支付开票→409 / 未声明 pack→400 / 无确认下单→400 / 未知订单→404

## 文件

```
src/catalogs.ts   两个 OCP Catalog(六协议端点,含 resolve(workflow) 开票动作)
src/invoice.ts    测试开票服务(状态机 submitted→processing→issued→emailed)+ 测试邮箱
src/agent.ts      规则 NLU + 任务状态机 + 执行轨迹
src/server.ts     单进程入口:目录×2 + 门店端点 + Agent API + 静态 UI
public/           四区 Web UI(对话/商品决策/订单开票/轨迹归档)
scripts/e2e.ts    PRD §7 验收自动化
archive/          本地归档输出(日期/商家/订单)
```
