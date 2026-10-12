# CLI 与 Skill

> **状态：已发布。** OCP CLI 与内置的 `ocp-catalog` Agent skill 已经通过 npm 包
> [`@ocp-catalog/ocp-cli`](https://www.npmjs.com/package/@ocp-catalog/ocp-cli) 发布。
> 可以用 `npm install -g @ocp-catalog/ocp-cli` 全局安装，也可以直接用
> `npx @ocp-catalog/ocp-cli@latest` 运行。

OCP CLI 与 `ocp-catalog` Agent skill，为 Agent 提供了一种正确、可复用的方式来驱动协议。
CLI 的 help 和结果都返回结构化 JSON，因此 Agent 不需要解析终端文本，就能查看命令并基于输出行动。

## CLI 有什么用

- **把标准 OCP 工作流变成命令。** 发现 Registration 节点 → 搜索或解析 Catalog 路由 →
  查看 Catalog manifest → 用 manifest 声明的 query pack 查询 → 仅在需要详情或动作时
  resolve 选中的条目。
- **基于 manifest 的请求校验。** 这是让 Agent 传参更规范的关键。在查询离开本机之前，CLI 可以
  加载 Catalog manifest，并拒绝任何 Catalog 没有声明的内容：不支持的 `query_pack`、不存在的
  filter 字段、非法的分页，或缺失的语义查询文本。Agent 得到的不是一次失败的网络往返，而是明确的
  纠正提示——在可以的情况下还会自动选好默认 query pack。
- **公共活动，而非原始审计数据。** `events tail` 读取脱敏后的公共 Activity API 投影，让 Agent
  在不触碰审计载荷的前提下，看到 query / resolve / sync / tooling 事件。
- **Skill 管理。** 为你的 Agent 环境安装、更新、检查或移除本地的 `ocp-catalog` skill。

## 从 npm 安装

需要稳定的 `ocp` 命令时，可以全局安装：

```bash
npm install -g @ocp-catalog/ocp-cli
ocp help
```

也可以不全局安装，直接运行：

```bash
npx @ocp-catalog/ocp-cli@latest help
npx @ocp-catalog/ocp-cli@latest skill doctor --target both
```

## 从 GitHub 运行

如果你在参与仓库开发，仍然可以通过 skill runner 运行源码内置 CLI：

```bash
git clone https://github.com/Open-Commerce-Protocol/OCP-Catalog
cd OCP-Catalog

# 顶层 help 介绍完整的 OCP 工作流
bun scripts/ocp-skill-runner.ts help

# 一个真实的 发现 → 搜索 → 查看 → 查询 流程
bun scripts/ocp-skill-runner.ts registration search --registration-url https://ocp.deeplumen.io/registry --query "commerce"
bun scripts/ocp-skill-runner.ts catalog inspect http://localhost:4000/ocp/manifest
bun scripts/ocp-skill-runner.ts events tail --activity-url https://ocp.deeplumen.io
```

runner 按以下顺序解析 CLI：`OCP_CLI_COMMAND` → `OCP_CLI_BIN` → 内置 CLI →
`PATH` 上的 `ocp` 可执行文件 → `bunx @ocp-catalog/ocp-cli` → `npx @ocp-catalog/ocp-cli`。

## 把 Skill 安装到你的 Agent

如果想在 Agent 中使用 OCP 工作流、又不想保留整个 monorepo，可以直接安装 npm 包内置的
独立 skill：

```bash
# 在本地 Agent skill 目录中 安装 / 更新 / 检查 / 移除 skill
ocp skill install --target both
ocp skill update --target auto
ocp skill doctor --target both
```

`--target` 可取 `auto`、`codex`、`agents`、`both`，或一个明确的 skills 目录。安装之后，
Agent 就会遵循上面所说的 CLI 优先工作流。

仓库贡献者也可以直接从源码导出 skill：

```bash
bun run skill:ocp:export
```

## 请求校验的实际用法

在查询时加上 `--manifest`，CLI 会在发送前，用 Catalog 声明的能力校验请求。用 `validate query`
则可以完全不发网络请求地检查一个待发送的请求：

```bash
# 不发送请求，只用 manifest 校验一个查询
ocp validate query --manifest http://localhost:4000/ocp/manifest --query "running shoes" --filters "{\"category\":\"shoes\"}"

# 在请求时校验（发出调用前拒绝不支持的 pack / filter）
ocp catalog query --manifest http://localhost:4000/ocp/manifest --query-url http://localhost:4000/ocp/query --query-pack ocp.query.keyword.v1 --query "running shoes"

# 校验 Catalog manifest 本身是否符合 schema
ocp validate manifest http://localhost:4000/ocp/manifest
```

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `registration discover <discovery-url>` | 读取 Registration 发现文档并找到其端点。 |
| `registration search --registration-url <url> [--query <text>]` | 按元数据查找 Catalog 路由候选，不搜索商品。 |
| `registration resolve --registration-url <url> --catalog-id <id>` | 把选定的 Catalog id 解析成路由提示。 |
| `catalog inspect <manifest-url>` | 读取 Catalog manifest：对象类型、query pack、filter 字段、鉴权、端点。 |
| `catalog query --query-url <url> [--query-pack <id>] [--query <text>] [--manifest <ref>]` | 用 manifest 声明的 query pack 搜索商业对象。 |
| `catalog resolve --resolve-url <url> --entry-id <id>` | 解析单个选中条目的详情、新鲜度、策略与动作绑定。 |
| `validate manifest <file-or-url>` | 用 OCP schema 校验 Catalog manifest。 |
| `validate query --manifest <ref> [...]` | 在发送前用 manifest 校验一个待发送的查询。 |
| `events tail --activity-url <url> [--limit <n>]` | 读取脱敏后的公共 Activity API 投影。 |
| `skill install / update / doctor / uninstall --target <dest>` | 管理本地 `ocp-catalog` Agent skill。 |

端点需要鉴权时用 `--api-key`，需要把命令与服务端活动事件关联时用 `--correlation-id`。
追踪字段只放在请求头里——绝不要放进严格的 OCP 请求体中。
