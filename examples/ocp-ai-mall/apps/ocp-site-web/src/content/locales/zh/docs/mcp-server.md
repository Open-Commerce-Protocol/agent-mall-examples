---
title: OCP MCP Server
description: 将 OCP MCP Server 作为本地网关运行，把 Catalog 发现、查询和 resolve 工具暴露给兼容 MCP 的 Agent。
---

# OCP MCP Server

> 面向 OCP Catalog 发现、检查、查询和 resolve 的本地 Model Context Protocol 网关。

OCP MCP Server 把 OCP Catalog 工作流暴露成 MCP 工具，供已经支持 Model Context Protocol 的 Agent 使用。它不替代 OCP HTTP 协议，而是一个适配层：让 MCP client 通过稳定的工具界面调用 Registration 与 Catalog 端点。

```text
Agent -> MCP client -> ocp-mcp-server -> Registration node -> selected Catalog
```

## 提供的能力

- **Catalog 发现。** 在选择查询目标之前，通过 Registration node 搜索候选 Catalog。
- **Manifest 检查。** 读取对象类型、query pack、过滤字段、端点健康状态、鉴权要求和路由提示。
- **Catalog 查询。** 用 Catalog 声明过的 query pack 查询选定 Catalog。
- **Entry resolve。** 对选中的结果获取详情、新鲜度、策略和 provider 拥有的动作入口。
- **Skill gateway 工具。** 配置后，可通过同一个 MCP gateway 暴露 skill 搜索和 deeplink 工具。

## 工具

| Tool | 适用场景 |
| --- | --- |
| `describe_ocp_catalog` | Agent 需要解释 gateway 和 OCP Catalog 如何工作。 |
| `search_catalogs` | Agent 需要了解可用 Catalog、领域、服务或数据源。 |
| `inspect_catalog` | Agent 需要了解过滤字段、query pack、语言、契约或端点健康状态。 |
| `query_catalog` | Agent 已经选定 Catalog，需要在其中查询。 |
| `resolve_catalog_entry` | Agent 已经选定结果，需要最终详情或动作链接。 |
| `find_and_query_catalog` | Agent 有用户意图，但还没有选定 Catalog。 |
| `skill_search` | Agent 需要通过 skill gateway 搜索 OCP 兼容 skill。 |
| `skill_deeplink` | Agent 需要为选定 skill 获取安装或启动 deeplink。 |

## 本地运行

分别启动 Registration node 和 demo Catalog：

```bash
bun run registration:api
bun run commerce:catalog:api
bun run commerce:catalog:worker
```

启动 MCP server：

```bash
bun run mcp:gateway
```

服务会在 `OCP_MCP_HTTP_PATH` 暴露 Streamable HTTP MCP 端点，默认路径是 `/mcp`。

## 配置

```text
OCP_MCP_DEFAULT_REGISTRATION_URL=http://localhost:4100
OCP_MCP_REQUEST_TIMEOUT_MS=10000
OCP_MCP_USER_AGENT=ocp-mcp-server/0.1.0
OCP_MCP_API_KEY=
OCP_MCP_HTTP_PORT=4300
OCP_MCP_HTTP_PATH=/mcp
OCP_MCP_SKILL_GATEWAY_URL=http://localhost:4330
OCP_MCP_SKILL_GATEWAY_KEY=
```

当 gateway 调用选定 Catalog 的 query endpoint 时，`OCP_MCP_API_KEY` 会作为 `x-api-key` 发送。

## 验证

在 Registration node 和 demo Catalog 已运行时执行：

```bash
bun run validate:mcp
```

验证器会检查 MCP 工具依赖的 HTTP 路径：

```text
Registration search -> route hint -> manifest -> catalog query -> catalog resolve
```

如果要验证 MCP 到 skill-gateway 的链路：

```bash
bun run smoke:mcp-skill
```

## MCP Server 与 WebMCP

MCP Server 和 WebMCP Adapter 是两个不同的适配层。

- **MCP Server** 作为 MCP 兼容 client 的网关运行，并通过 MCP 暴露服务端工具。
- **WebMCP Adapter** 从网站页面暴露浏览器内的页面原生工具。

Agent 通过 MCP client 连接时使用 MCP Server；浏览器页面本身要成为 Agent 可调用面时使用 WebMCP Adapter。
