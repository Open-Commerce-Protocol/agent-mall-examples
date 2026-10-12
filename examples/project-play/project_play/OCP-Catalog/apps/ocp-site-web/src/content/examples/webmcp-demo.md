---
title: WebMCP demo
description: The WebMCP demo exposes OCP Catalog Mall's browse, search, and product-page-open capabilities as in-browser WebMCP tools, enabling end-to-end verification of agent calls.
category: demos
order: 1
---

# WebMCP demo

> A clickable, scriptable, AI-agent-discoverable demonstration that turns the OCP Catalog Mall's Search phase into a set of in-browser WebMCP tools.

## Overview

WebMCP Demo is a **demonstration page** of OCP Catalog Mall. It exposes the page's browse / search / data-source-select / open-product capabilities as **WebMCP tools**, so a WebMCP-capable AI agent can call them directly from the browser side and verify end-to-end that "an agent can actually do something through OCP Catalog."

URL: <https://ocp.deeplumen.io/webmcp/>

## The problem

- Even when OCP's concepts, protocols, and data models align on paper, **whether an agent can really use them** still needs something clickable, screenshottable, and scriptable.
- WebMCP treats a web page as a new agent-callable surface (tools), but end-to-end runnable examples are scarce.
- Different search modes (keyword, filter, semantic) behave very differently from an agent's perspective; a single place to compare them, for both humans and agents, is useful.

The Demo packages all three into one page — a "try it now" entry into OCP Catalog.

## What it is not

- **Not the OCP protocol core.** The Catalog protocol's core is discovery / query / resolve / action binding (see [Catalog architecture](/catalog-architecture)). WebMCP is one **binding / adapter** shape among several.
- **Not a real merchant checkout / order system.** No real purchase, no real payment, no order state machine; this is a different layer from the full merchant layer described in [WooCommerce integration overview](/examples/woocommerce-overview).
- **Not a browser setup guide.** Chrome flags, Beta version numbers, and similar enablement details are out of scope here.
- **Not a WebMCP specification.** API shapes like `navigator.modelContext.registerTool(...)` are defined by browser-side specs.
- **Not a fixed data snapshot.** The product list depends on the chosen Registration Node, Catalog, and index data; screenshots are illustrative only.

## Core ideas

### WebMCP tools currently exposed

The page registers five tools via `navigator.modelContext.registerTool(...)`:

| Tool | Purpose |
| --- | --- |
| `ocp.mall.get_page_state` | Read page state: is WebMCP enabled, which Registration Node and Catalog are selected, how many products are loaded, etc. |
| `ocp.mall.list_products` | Browse products (no specific search intent) |
| `ocp.mall.search_products` | Run a search in one of three modes; returns product cards |
| `ocp.mall.set_data_source` | Switch the active Registration Node / Catalog |
| `ocp.mall.open_product_page` | Open a product detail page by `product_id`, `product_url`, or `title` |

### Three search modes

`ocp.mall.search_products` supports three `search_mode` values:

- **Keyword** — exact terms, product names, brand names. Use when the agent already has clean keywords from the user.
- **Filter** — structured filters. Common fields include `category`, `brand`, `currency`, `availability_status`, `provider_id`, `sku`, `min_amount`, `max_amount`, `in_stock_only`, `has_image`. Supported fields ultimately depend on the current Catalog's Query Pack and server schema.
- **Semantic** — natural-language intent. For example, `morning drink` can be associated with coffee products. Use when the agent does not want to reduce the user's intent into keywords.

These map to the Search phase in [Search / Resolve / Action](/resolve-actions); they are not separate protocols, just different Query Packs surfaced through the same phase.

### Standard demo flow

1. Open `https://ocp.deeplumen.io/webmcp/`.
2. The agent connects to the browser's WebMCP host and calls `ocp.mall.get_page_state` first to confirm WebMCP availability and Registration Node / Catalog readiness.
3. If the user only wants to browse, call `ocp.mall.list_products`.
4. With clean keywords, call `ocp.mall.search_products` with `search_mode=keyword`.
5. With natural-language intent, same tool with `search_mode=semantic`.
6. With structured filters, same tool with `search_mode=filter` plus a `filters` object.
7. After the user picks a product, call `ocp.mall.open_product_page`.

### Boundaries worth repeating

- WebMCP is a **binding / adapter layer** for the Demo, not the Catalog protocol core.
- Tool invocations on the page are **not** OCP ActionBinding invocations.
- `ocp.mall.open_product_page` is **comparable to** an action entry point, but is **not** an Action Provider execution chain — it's a page navigation, not an order / payment / fulfillment state machine.
- The agent must connect through a browser WebMCP host, a WebMCP Bridge / Gateway, or a WebMCP-capable client library (for example, a recent Puppeteer release). **No agent automatically gains tool access just by opening a web page.**
- Demo data varies with the Registration Node, Catalog, and index; **screenshots are not fixed snapshots**. Trust the page's actual responses.

## See also

- [What is OCP](/what-is-ocp)
- [What is a Catalog](/what-is-catalog)
- [Role model](/roles)
- [Catalog architecture](/catalog-architecture)
- [Search / Resolve / Action](/resolve-actions)
- [WooCommerce integration overview](/examples/woocommerce-overview)

