---
title: WooCommerce integration overview
description: Translate an existing WooCommerce store into an OCP protocol surface so agents talk to one unified contract instead of WooCommerce's private REST API.
category: integrations
order: 1
---

# WooCommerce integration overview

> This page describes the three-layer boundaries, recommended deployment shapes, and key data mappings. It is **not** a plugin development manual — it's the alignment document for product, architecture, and merchant engineering teams.

## Overview

The WooCommerce OCP integration is not a WooCommerce replacement. It **translates** a running WooCommerce store into an OCP protocol surface, so agents talk to it through unified discovery / query / resolve / checkout / order endpoints instead of WooCommerce's private REST API.

## The problem

- Each merchant platform (WooCommerce, Shopify, Magento, custom storefronts) has its own private API shape; per-merchant agent integration is unsustainable.
- A merchant's products, prices, inventory, shipping, and orders must remain authoritative; they should not be copied off and "pretend-shopped" elsewhere.
- Merchants also need a clear agent traffic boundary, auditability, and PII control — not raw admin API exposure.

By making WooCommerce an **OCP Provider** (or in lighter deployments, a merchant-hosted **Catalog Node**), the store keeps its data model and exposes a consistent OCP surface.

## What it is not

- **Not a WooCommerce replacement.** WooCommerce remains the authoritative state machine for products, orders, taxes, fulfillment, and refunds.
- **Not an agent runtime.** The plugin does not recognize user intent, plan checkout, or hold conversations.
- **Not a payment trust layer.** It does not verify Visa agent identity, implement Payment Instructions, or hold user card credentials.
- **Not a Registration Node product index.** Registration Nodes discover catalogs, not commercial objects.
- **Not required to expose a full field set.** A Provider declares what it can guarantee through its Descriptor Contract.

## Core ideas

### Three layers

```
Agent Layer       AI Agent / Visa VIC Reference Agent
                  User intent, confirmation, Payment Instruction
                          │
Protocol Layer    OCP Catalog
                  Discovery / Query / Resolve / Checkout / Order / Event
                          │
Merchant Layer    WooCommerce OCP Plugin
                  Product / Offer / Order / Webhook adapter
```

The three layers evolve independently. Switching to Shopify or Magento, or swapping Visa for another payment trust layer, does not require rewriting the merchant adapter or the core agent boundary.

### What the plugin does

- Reads and maps WooCommerce products, categories, tags, attributes, variations, and stock.
- In Provider Adapter mode, syncs objects to a target OCP Catalog.
- In merchant-hosted mode, exposes `CatalogManifest`, query, and resolve directly.
- Exposes OCP-facing endpoints: discovery (e.g. `/.well-known/ocp-catalog`), search / query, resolve, checkout, and order status.
- Listens to WooCommerce webhooks and writes product / inventory / order events into a sync queue or event ledger.
- Maintains API keys, webhook secrets, sync cursors, retry state, and audit logs.

### What the plugin does not do

- It is not an agent runtime.
- It does not verify Visa agent identity directly.
- It does not implement Visa VIC user authentication, Payment Instruction, or agent-specific token lifecycle.
- It does not store raw user card credentials.
- It does not replace WooCommerce's order, tax, fulfillment, refund, email, or post-sale workflows.
- It does not treat the Registration Node as a product database.

### Two deployment modes

**Provider Adapter mode (recommended default)**
The plugin makes the store an OCP Provider that registers with one or more public commerce catalogs and syncs objects. The Catalog handles indexing, ranking, query, and resolve, and registers with the Registration Node. Best for multi-merchant aggregation, centralized risk controls, and unified search quality.

**Merchant-hosted Catalog mode (optional)**
The plugin acts as both Provider and Catalog Node — a single store exposes manifest / query / resolve on its own. Easier for an independent merchant to ship, harder to govern for multi-merchant aggregation, search quality, risk control, and caching.

### Key data mappings

| WooCommerce concept | OCP mapping | Notes |
| --- | --- | --- |
| Store | Provider / Merchant Profile | `provider_id` should be stable, not tied to short-lived domain changes |
| Product | CommercialObject / Catalog item | Title, description, brand, images, URL, status enter the product descriptor |
| Variation | Offer / purchasable SKU | Color, size, price, inventory, and other purchasable options live here |
| Category / Tag | Taxonomy descriptor | Used for search filtering and product understanding |
| Regular / Sale Price | Price descriptor | Keep currency, current price, list price, and promotion validity |
| Stock Status / Quantity | Inventory descriptor | Used by agents to judge availability and substitution policy |
| Cart | Checkout session | An **execution-time** object, not a CatalogEntry |
| Order | OCP order resource | Order id, status, amount, fulfillment state, available actions |
| WooCommerce webhook | EventLedger event | Product / inventory / order changes feed sync and audit |

### Disciplines worth repeating

- **Cart is execution-time, not a CatalogEntry.** A Catalog exposes discoverable, resolvable objects, not session snapshots.
- **Revalidate price, inventory, taxes, and shipping at checkout.** Search results are candidates; the price you can actually transact on is only known at checkout.
- **WooCommerce remains the authoritative order and fulfillment system.** OCP does not take over the order lifecycle, refund flow, or notification pipeline.
- **Do not "integrate Visa directly" inside the plugin.** Visa VIC / Payment Instruction sit above the Agent Layer as a separate trust layer. The plugin only accepts an externally authenticated `payment_context`; it does not participate in the token lifecycle.

## See also

- [What is OCP](/what-is-ocp)
- [What is a Catalog](/what-is-catalog)
- [Role model](/roles)
- [Catalog architecture](/catalog-architecture)
- [Search / Resolve / Action](/resolve-actions)

