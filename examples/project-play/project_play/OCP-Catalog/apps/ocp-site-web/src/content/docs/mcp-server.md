---
title: OCP MCP Server
description: Run the OCP MCP Server as a local gateway that exposes Catalog discovery, query, and resolve tools to MCP-compatible agents.
---

# OCP MCP Server

> A local Model Context Protocol gateway for OCP Catalog discovery, inspection, query, and resolve.

The OCP MCP Server exposes OCP Catalog workflows as MCP tools for agents that already speak the Model Context Protocol. It does not replace the OCP HTTP protocols. It is an adapter layer that lets an MCP client call Registration and Catalog endpoints through a stable tool surface.

```text
Agent -> MCP client -> ocp-mcp-server -> Registration node -> selected Catalog
```

## What It Provides

- **Catalog discovery.** Search Registration nodes for candidate catalogs before choosing where to query.
- **Manifest inspection.** Read supported object types, query packs, filters, endpoint health, auth requirements, and routing hints.
- **Catalog query.** Search a selected catalog with a declared query pack.
- **Entry resolve.** Resolve one selected result for details, freshness, policies, and provider-owned actions.
- **Skill gateway tools.** When configured, expose skill search and deeplink tools through the same MCP gateway.

## Tools

| Tool | Use it when |
| --- | --- |
| `describe_ocp_catalog` | The agent needs to explain how the gateway and OCP Catalog work. |
| `search_catalogs` | The agent needs available catalogs, domains, services, or data sources. |
| `inspect_catalog` | The agent needs filters, query packs, languages, contracts, or endpoint health. |
| `query_catalog` | The agent already selected a catalog and needs to search inside it. |
| `resolve_catalog_entry` | The agent selected a result and needs final details or action links. |
| `find_and_query_catalog` | The agent has user intent but has not selected a catalog yet. |
| `skill_search` | The agent needs to search OCP-compatible skills through the skill gateway. |
| `skill_deeplink` | The agent needs an install or launch deeplink for a selected skill. |

## Run Locally

Start a Registration node and a demo Catalog in separate terminals:

```bash
bun run registration:api
bun run commerce:catalog:api
bun run commerce:catalog:worker
```

Start the MCP server:

```bash
bun run mcp:gateway
```

The server exposes a Streamable HTTP MCP endpoint at `OCP_MCP_HTTP_PATH`, which defaults to `/mcp`.

## Configuration

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

`OCP_MCP_API_KEY` is sent as `x-api-key` when the gateway calls a selected catalog query endpoint.

## Validate

With the Registration node and demo Catalog running:

```bash
bun run validate:mcp
```

The validator checks the path the MCP tools rely on:

```text
Registration search -> route hint -> manifest -> catalog query -> catalog resolve
```

To validate the MCP to skill-gateway chain:

```bash
bun run smoke:mcp-skill
```

## MCP Server vs WebMCP

The MCP Server and WebMCP Adapter are separate adapter layers.

- **MCP Server** runs as a gateway for MCP-compatible clients and exposes server-side tools over MCP.
- **WebMCP Adapter** exposes page-native browser tools from a website surface.

Use the MCP Server when an agent connects through an MCP client. Use the WebMCP Adapter when a browser page itself is the agent-callable surface.
