# CampusNow 前端交付

## 运行

在 campusnow 目录运行 `bun run start`，打开 http://localhost:4420 。原生静态前端，无构建步骤。后端保持原样，所有数据通过 API.md 中的接口通信。

## 页面与组成

- index.html：AppShell、Sidebar、Header、Modal、Toast。
- style.css：蓝白主题、#5378D8 品牌色、18–24px 卡片圆角、375px / 800px / 1100px 响应式与 reduced-motion。
- app.js：Home、RequirementSummary、ProductCard、方案确认、模拟支付、开票核对、InvoiceTimeline、ArchiveCard、AgentTrace、辅助页面。
- assets/xixi-transparent.png：内置 image_gen 基于用户参考图生成的透明背景小汐；原图 maid-reference.jpg 保留。
- assets/xixi-prompt.txt：完整图片编辑提示词。
- legacy.html / legacy-app.js：原前端备份，不影响新入口。

## 演示

首页实验室采购入口：填写模板后点击交给小汐，人工确认方案、模拟支付、开票资料，等待测试开票、测试邮件与真实后端本地归档。
首页校园生活入口：瑞幸模板。无在线开票能力时显示红色回退警示和不同确认按钮，生成本地模拟收据，不假称发送邮件。
设置可重启剧本、重置任务、暂停/恢复前端状态显示。暂停不停止后端。所有人工确认都保留。
执行记录按 OCP / Agent / Merchant / Mail / Local / User / System 来源展示，事件可展开查看原始数据。
归档支持测试 HTML 预览、下载及订单 JSON 摘要查看。

## 当前限制与扩展位置

API.md 是冻结契约。当前 API 不支持前端单独切换商品、编辑开票字段、历史任务查询，因此不伪造修改或虚构历史。需求中的邮箱与抬头由后端规则解析，税号仍为后端测试占位值。
所有订单/支付/开票为测试；本地归档仅依据 archive 字段标记后端文件写入成功。
前端接口入口在 app.js 的 api/action/poll；后续真实服务由既有 src/server.ts 的 agent.setHooks 与 src/catalogs.ts、src/invoice.ts 适配，前端不存放密钥。

## 验证

- node --check public/app.js 通过。
- 浏览器：实验室路径三处确认、测试发票预览、归档完成；独立 4421 端口瑞幸回退路径三处确认、无邮件归档完成。
- 1440px 和 375px 下 DOM scrollWidth 等于 viewport width，无横向溢出；角色 PNG 实际加载成功。
- 冻结后端 e2e 未重跑：其脚本固定 4420 且会重置共享任务。本次直接验证浏览器完整旅程，不声称 31 个断言已执行。
