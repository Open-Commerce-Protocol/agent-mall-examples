# 贡献指南

本仓库承接应用赛道作品。协议贡献赛道（开源赛道）请向 OCP-Catalog 提交 Issue 或 PR，具体要求见下方说明。

## 应用作品投稿

每个作品放在独立的 `examples/<作品名>/` 目录中，目录名使用小写英文和连字符。不要修改其他作品或为单个作品引入仓库级依赖。

README 应至少包含：

- 功能说明、作者或团队成员的 GitHub 用户名。
- 实际使用的 OCP 能力、依赖的仓库版本或提交号，以及服务地址的配置方式。
- 环境要求、安装、配置、启动步骤和一个可复现的演示流程。
- 截图或视频链接。
- 模拟数据、未完成能力、外部服务与费用依赖。

依赖清单和适用的锁文件应随作品提交。需要环境变量时提供 `.env.example`，只放占位值。禁止提交真实密钥、个人数据、构建产物、依赖目录或未经授权的资源。

## 应用赛道 Git 操作示例

先在 GitHub Fork 仓库，再执行（替换 YOUR_USERNAME 和 my-demo）：

```sh
git clone https://github.com/YOUR_USERNAME/agent-mall-examples.git
cd agent-mall-examples
git switch -c feat/my-demo
# 将 template 复制到 examples/my-demo，加入实现并补全文档
git add examples/my-demo README.md
git commit -m "feat: add my-demo"
git push -u origin feat/my-demo
```

打开 GitHub，向 `Open-Commerce-Protocol/agent-mall-examples` 的 `main` 分支提交 PR，标题建议为 `feat: add <作品名>`。提交前请更新根 README 的作品目录。

## 应用赛道最小验收标准

1. 能按 README 完成安装并跑通一条核心功能路径。
2. 能清楚说明 OCP 在作品中的作用，区分真实调用与模拟行为。
3. 提供可查看的演示材料，并说明外部依赖。
4. 无真实密钥、个人数据或未授权素材，保留第三方许可。

审核可要求补充说明；未合并不影响已经提交 PR 的事实。不要为了演示默认执行真实付费、下单或其他有外部影响的操作，相关步骤应提供明确的用户确认。

## 协议贡献赛道（开源赛道）

欢迎发现协议定义、实现、SDK 或主项目文档的问题，提交有依据的分析和改进建议，也欢迎进一步修复。**有效 Issue 也可投稿，不要求必须提交修复 PR。**

1. 先阅读 [OCP-Catalog 贡献指南](https://github.com/Open-Commerce-Protocol/OCP-Catalog/blob/main/CONTRIBUTING.md)，并搜索 [已有 Issue](https://github.com/Open-Commerce-Protocol/OCP-Catalog/issues) 和 [已有 PR](https://github.com/Open-Commerce-Protocol/OCP-Catalog/pulls)，避免重复。
2. 使用主仓库的 [Issue 入口](https://github.com/Open-Commerce-Protocol/OCP-Catalog/issues/new/choose)，按实际问题选择模板。
3. 若愿意修复，在 OCP-Catalog 提交 PR，关联对应 Issue 并写明验证结果。
4. 向活动主办方登记贡献链接即可，不必在实例仓库复制问题报告或提交额外 PR。

### 问题报告最小要求

- **版本与位置**：仓库版本或提交号，以及涉及的模块、接口或协议文档位置。
- **问题与影响**：清晰说明问题，区分预期行为与实际行为。
- **依据**：实现问题提供环境、最小复现步骤及必要日志；协议设计或文档问题提供具体条款、矛盾点或缺失场景。
- **改进建议**：如有，说明建议及理由；尚未验证的推测请明确标注。

不以 Issue 数量衡量贡献。已有相同问题时优先补充新的复现或分析，登记原 Issue 与自己补充内容的直接链接，勿重复创建。日志和截图请移除密钥及个人数据。

### 投稿与评审

按主办方指定渠道登记赛道、作者 / 团队及 Issue / PR 链接。贡献是否有效依据问题的真实性、证据与价值评审，不要求 Issue 已关闭或 PR 已合并。具体报名及评奖以主办方公布的规则为准。
