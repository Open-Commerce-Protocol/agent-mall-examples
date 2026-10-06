# 贡献指南

## 应用作品投稿

每个作品放在独立的 `examples/<作品名>/` 目录中，目录名使用小写英文和连字符。不要修改其他作品或为单个作品引入仓库级依赖。

README 应至少包含：

- 功能说明、作者或团队成员的 GitHub 用户名。
- 实际使用的 OCP 能力、依赖的仓库版本或提交号，以及服务地址的配置方式。
- 环境要求、安装、配置、启动步骤和一个可复现的演示流程。
- 截图或视频链接。
- 模拟数据、未完成能力、外部服务与费用依赖。

依赖清单和适用的锁文件应随作品提交。需要环境变量时提供 `.env.example`，只放占位值。禁止提交真实密钥、个人数据、构建产物、依赖目录或未经授权的资源。

## Git 操作示例

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

## 最小验收标准

1. 能按 README 完成安装并跑通一条核心功能路径。
2. 能清楚说明 OCP 在作品中的作用，区分真实调用与模拟行为。
3. 提供可查看的演示材料，并说明外部依赖。
4. 无真实密钥、个人数据或未授权素材，保留第三方许可。

审核可要求补充说明；未合并不影响已经提交 PR 的事实。不要为了演示默认执行真实付费、下单或其他有外部影响的操作，相关步骤应提供明确的用户确认。

协议实现、SDK 或主项目 Bug 修复请直接提交到 [OCP-Catalog](https://github.com/Open-Commerce-Protocol/OCP-Catalog)。
