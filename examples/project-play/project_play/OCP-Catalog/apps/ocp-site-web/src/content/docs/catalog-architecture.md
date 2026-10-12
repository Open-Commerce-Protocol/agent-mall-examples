---
title: Catalog architecture
description: OCP Catalog is layered into Discovery, Catalog, Provider Integration, Object Semantics, and Action, with two main flows running on top — the Agent invocation flow and the Provider integration flow.
category: architecture
order: 1
---

# Catalog architecture

> A system overview of the OCP Catalog. This page maps every object and role you've read about into the layer it lives in, the partner it talks to, and the contract it owns.

## Overview

OCP Catalog is structured into **five protocol layers** — Discovery, Catalog, Provider Integration, Object Semantics, and Action — each of which answers a single class of question. On top of these run two main flows: the **Agent invocation flow** and the **Provider integration flow**.

## The problem

Without layering, three things tangle quickly:

1. **Role boundaries blur.** If catalog discovery, object query, data ingestion, resolution, and action execution all share one surface, permissions, caching, trust, and accountability collapse together.
2. **Industry differences pollute the core.** Products, services, jobs, RFQs, and channel opportunities have private fields; pushed into the core model, the protocol becomes captive to one industry's shape.
3. **Cross-layer overreach.** Agents construct merchant private URLs, skip Resolve, invent fields, or compress "find" and "order" into a single call.

Five-layer separation puts each risk on its own contract surface, so each layer can evolve, be cached, and be audited independently.

## What it is not

- **Not network layering** (OSI). It's protocol responsibility layering, not byte-stream layering.
- **Not a deployment architecture.** One process can host multiple layers; multiple companies can co-own one layer.
- **Not a fixed implementation stack.** OCP does not prescribe databases, indexes, or queues.
- **Not an organizational split.** The constraint is on the protocol surface, not the org chart.

## Core ideas

### The five layers

| Layer | Purpose | Typical objects | How to think about it |
| --- | --- | --- | --- |
| **Discovery Layer** | Discover catalogs, verify them, return cacheable routing summaries | RegistrationDiscovery, RegistrationManifest, CatalogProfileSnapshot, CatalogRouteHint | "Which catalog should I go to?" — note that it does **not** search products. |
| **Catalog Layer** | Declare a Catalog's capabilities, host the object index, execute query / resolve | CatalogManifest, ObjectContract, QueryPackBinding, CatalogEntry | The Catalog's outward-facing surface; defines how it can be queried. |
| **Provider Integration Layer** | Onboard Providers; negotiate object contracts and sync capability | ProviderRegistration, ProviderDeclaration, SyncCapability, RegistrationResult | "How do objects enter the Catalog?" Registration builds the contract; sync moves data. |
| **Object Semantics Layer** | Generic object envelope plus industry-specific extensions | CommercialObject, DescriptorPack, DescriptorInstance, DescriptorContract | The semantic base that lets one Catalog carry products, services, talent, and RFQs. |
| **Action Layer** | Bridge resolved objects to downstream executable actions | ResolvableReference, ActionBinding, ActionInvocationContract | The "object → action" bridge — but **not** the action runtime itself. |

The layers compose: Discovery returns a RouteHint pointing to a Catalog Layer Manifest; the Catalog Layer accepts objects through Provider Integration; objects are organized by Object Semantics; the Action Layer connects resolved objects to external action entry points.

### Typical Agent invocation flow

```
Agent / User
  -> local catalog profile cache
  -> Registration Node search
  -> CatalogRouteHint / CatalogManifest
  -> Catalog Node query
  -> CatalogEntry candidates
  -> Catalog Node resolve
  -> ResolvableReference + ActionBinding
  -> Action Provider / Merchant / Workflow
```

The agent consults its local profile cache first; on a miss, it asks a Registration Node. With a RouteHint or Manifest in hand, it switches to the target Catalog Node to run a query, picks a candidate, and calls resolve. The result is a permissioned ResolvableReference and an ActionBinding. The actual action runs in the Action Provider, the merchant, or a business workflow. This chain enforces the [Search / Resolve / Action](/resolve-actions) discipline: discovery, resolution, and execution are separate.

### Typical Provider integration flow

```
Provider
  -> Catalog discovery document
  -> CatalogManifest
  -> ObjectContract inspection
  -> ProviderRegistration
  -> RegistrationResult
  -> Object sync channel
  -> CatalogEntry projection
```

The Provider reads discovery and manifest first to learn which object types and fields a Catalog accepts; checks the ObjectContract against what it can guarantee; submits a `ProviderRegistration`; receives a `RegistrationResult` that selects a Sync Capability (`feed` / `pull` / `push` / `streaming` / `delta` / `snapshot`). Only then do objects flow into the Catalog and become CatalogEntries. **Registration builds the contract; sync moves data.** Never both in one call.

### Production storage boundary

OCP does not prescribe a database, but a production product-scale Catalog should separate the object fact store, retrieval projection, and vector index.

| Plane | Responsibility |
| --- | --- |
| Fact store, typically RDS / PostgreSQL | Durable `CommercialObject` payloads, structured filters, transactions, import audit, dedupe state, full-text search, resolve references |
| CatalogEntry projection | Searchable summaries, optional preview `image_url`, ranking signals, visibility projection, freshness, provenance summary, `object_ref` |
| Dedicated vector index | Semantic recall at large scale, keyed by `entry_id` / `object_ref`, with version and watermark tracked back in the fact store |

Do not treat one RDS table plus pgvector as the default main path for tens of millions of product embeddings. RDS can remain the source of truth and structured/full-text retrieval plane, while vector recall runs in a specialized index and joins back through stable object references.

### Boundaries to keep in mind

- **A Registration Node discovers catalogs, not products.** Its query target is Catalog metadata.
- **A Catalog Node queries and resolves commercial objects, but does not execute orders.** It exposes entry points and summaries, not an order state machine.
- **A Provider is an object source, not a Catalog.** One Provider can join multiple Catalogs; one Catalog can aggregate multiple Providers.
- **An ActionBinding exposes a constrained action entry, but does not itself execute the action.** User confirmation, parameter validation, idempotency, and — where required — a payment trust layer must follow before the Action Provider runs the action.
- **WebMCP, REST, Webhook, and A2A are adapter / binding layers, not the only shape of OCP Catalog.** They map the core semantics; they do not replace them.

## See also

- [What is OCP](/what-is-ocp)
- [What is a Catalog](/what-is-catalog)
- [Role model](/roles)
- [Search / Resolve / Action](/resolve-actions)

