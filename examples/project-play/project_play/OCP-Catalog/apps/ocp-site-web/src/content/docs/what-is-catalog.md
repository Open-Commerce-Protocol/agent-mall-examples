---
title: What is a Catalog
description: A Catalog in OCP is the node that hosts commercial-object indexing, query, resolve, and action entry points behind a unified protocol contract.
category: concepts
order: 2
---

# What is a Catalog

> The Catalog is OCP's most-touched runtime role — agents query and resolve here; Providers register and sync here. This page explains what it owns, what it doesn't, and the key objects that surround it.

## Overview

A Catalog is the OCP role that **hosts commercial-object indexing, query capability, resolve capability, and action entry points**. It declares its capabilities through a shared protocol contract, but its internal implementation is unconstrained — it can use keyword search, vector retrieval, rule-based matching, graph search, or any hybrid.

## The problem

Without a Catalog layer, agents talking directly to every merchant face three recurring problems:

1. **Capabilities are not discoverable.** An agent doesn't know which query modes, object types, or filterable fields a data source actually supports.
2. **Private structures leak.** An agent ends up hard-coding internal endpoints like `/wp-json/wc/v3/products`, and any platform change breaks the chain.
3. **No standard "candidate → detail → action" surface.** Providers exposing raw data force agents to guess which fields are public, which are restricted, and which lead to actions.

A Catalog abstracts these concerns into a protocol shell: Providers keep their internal data structures; agents only write queries against declared capabilities; permission and trust policies become first-class and central.

## What a Catalog is not

- **Not the merchant backend or master product database.** The Provider remains authoritative for truth, price, inventory, and state.
- **Not a fixed search algorithm.** The protocol constrains the external contract, not the internal retrieval strategy.
- **Not an order, payment, or fulfillment system.** Action execution belongs to Action Providers.
- **Not a single global registry.** Multiple Catalogs coexist and federate; remote objects are referenced through route hints and summaries rather than copied.
- **Not product-only.** It covers generic commercial objects — services, jobs, talent, RFQs, opportunities, workflow entry points, and more.

## Core ideas

A Catalog is described by several interlocking objects:

- **CatalogProfile** — stable identity, capability summary, trust and health state. Consumed by Registration Nodes and agent profile caches.
- **CatalogManifest** — the full capability declaration: protocol version, endpoints, Query Packs, resolve capability, Provider integration requirements, sync capabilities, auth, rate limits, trust, freshness, and optional metadata hints. This is the primary entry point for other roles to understand a Catalog.
- **CatalogRouteHint** — a cacheable, TTL-bounded routing summary returned by Registration Nodes.
- **ObjectContract / Descriptor Contract** — field-level requirements for objects entering the Catalog (required fields, substitutable field groups, additional-fields policy, field usage, sensitivity).
- **CatalogEntry** — the index projection of a `CommercialObject` inside a Catalog. It carries retrieval, ranking, deduplication, aggregation, visibility filtering, freshness, optional preview `image_url`, and resolve references.
- **Query Pack / QueryPackBinding** — declared query modes (`keyword` / `filter` / `semantic` / `geo` / `availability` / `talent_match` / `rfq_match` / …) with their input / output schemas, filterable / sortable fields, explain support, and so on.

A Catalog has two main flows:

- **Provider integration flow.** Provider fetches discovery → checks manifest → submits `ProviderRegistration` → syncs objects through the selected Sync Capability → objects become CatalogEntries.
- **Agent invocation flow.** Agent → local profile cache or Registration Node lookup → route hint / manifest → Catalog Node query → CatalogEntry candidates → resolve on chosen entries → ResolvableReference + ActionBinding → handed off to an Action Provider.

A Catalog can be a **public catalog aggregating multiple merchants**, or a **merchant-hosted catalog** for a single store. Both deployment shapes share the same protocol contract.

## See also

- [What is OCP](/what-is-ocp)
- [Role model](/roles)
- [Search / Resolve / Action](/resolve-actions)
- [Catalog architecture](/catalog-architecture)

