# Agent Mall Examples

让你的 Agent 学会“逛商场”。这里是 Agent Mall 活动的双赛道导航入口，同时收录基于 [Open Commerce Protocol（OCP）](https://github.com/Open-Commerce-Protocol/OCP-Catalog) 构建的应用、演示和活动作品。

欢迎个人和团队通过 Pull Request 提交可运行的实例，例如咖啡导购、服务预约、商品搜索、采购询价等。技术栈不限，请在作品目录内独立管理依赖与配置。

## 选择你的赛道

| 赛道 | 做什么 | 提交位置 |
| --- | --- | --- |
| 🚀 应用赛道 | 基于 OCP 开发可运行的应用或实例 | 本仓库 `examples/<作品名>/`，提交作品 PR |
| 🔍 协议贡献赛道（开源赛道） | 发现协议或实现问题，提供复现、分析或改进建议；也可提交修复 | OCP-Catalog 提交 Issue 或 PR |

**应用赛道：做一个应用。** 从 [作品模板](template/README.md) 开始，按下方步骤提交作品。

**协议贡献赛道：发现并解决问题。** 先 [查看已有 Issue](https://github.com/Open-Commerce-Protocol/OCP-Catalog/issues)，再 [提交问题报告](https://github.com/Open-Commerce-Protocol/OCP-Catalog/issues/new/choose) 或 [修复 PR](https://github.com/Open-Commerce-Protocol/OCP-Catalog/compare)。有效 Issue 也可投稿，不要求必须完成修复；详见 [协议贡献要求](CONTRIBUTING.md#协议贡献赛道开源赛道)。

本仓库用于展示和交流；收录作品不代表官方生产认证。优秀作品可在后续整理为主仓库的教学示例。

## 应用赛道：快速投稿

1. Fork 本仓库，创建自己的分支。
2. 将 `template/` 复制为 `examples/<作品名>/`，目录使用小写英文和连字符。
3. 加入源代码、依赖声明和必要配置示例，按模板补全 README。
4. 自行按 README 跑通核心功能，添加演示截图或视频链接。
5. 向本仓库 `main` 分支提交 PR，填写 PR 模板。

每个作品一个目录、一个 PR；团队作品请列明所有贡献者。

详见 [贡献指南](CONTRIBUTING.md) 和 [作品模板](template/README.md)。

## 投稿与成果登记

- **应用赛道**：提交作品 PR 即完成仓库投稿，无需等待合并。
- **协议贡献赛道**：向 OCP-Catalog 提交符合贡献要求的 Issue 或 PR 即可投稿，无需再向本仓库提交重复 PR。
- 在主办方指定的报名或成果登记渠道填写赛道、作者 / 团队及对应 Issue / PR 链接。仓库投稿不代替活动报名。
- 评审关注贡献质量，不以 PR 是否合并或 Issue 是否关闭作为投稿前提；具体报名及评奖安排以主办方公布的规则为准。

## 作品目录

目前等待首批作品。投稿时请在下表添加一行，链接指向自己的目录。

| 作品 | 简介 | 作者 / 团队 |
| --- | --- | --- |

## OCP 能力边界

OCP-Catalog 提供目录发现、商业对象查询、上下文解析和行动入口等协议能力。作品应说明自己实际使用的能力与版本；支付、订单、预约等最终执行由对应商家或业务系统承担。请明确标注模拟数据、沙盒模式与尚未实现的能力。

## 许可

本仓库自有内容采用 [MIT License](LICENSE)。贡献自有代码即表示同意按该许可提供；第三方代码和资源须遵守其原始许可，并在作品内保留声明。
