---
title: What is OCP
description: Open Commerce Protocol (OCP) is an open spec that lets AI agents and heterogeneous commerce systems discover, query, resolve, and act on commercial objects through one shared semantic.
category: concepts
order: 1
---

# What is OCP

> A 5-minute read that answers "what OCP is — and is not." It outlines the problem OCP addresses, the principles it stands on, and helps you decide whether OCP is the right thing for your project.

## Overview

OCP — Open Commerce Protocol — is a set of protocols that lets AI agents, applications, and heterogeneous commerce systems **discover commercial objects, query them, resolve their details, and trigger downstream actions**. It models commerce capability as a layer of declarable, verifiable, explainable, and constrainable protocol surfaces, decoupled from any specific merchant platform or backend.

## The problem

Things you can "buy, book, apply to, or contact" are scattered across many heterogeneous systems: products in WooCommerce / Shopify / Magento / custom storefronts; services in booking platforms; jobs in ATSes; RFQs, opportunities, quotes, and workflow entry points across CRMs and ERPs. An AI agent acting on behalf of a user faces three recurring problems:

1. **No discovery layer** — every platform has its own API.
2. **No shared semantics** — field names, visibility, freshness, and provenance vary widely.
3. **No trust foundation** — without verifiable permissions, provenance, and audit, agents tend to invent fields, exceed authorization, or place orders without explicit user confirmation.

OCP places a protocol layer over these systems so an agent can use one consistent approach to find catalogs, query objects, resolve results, and connect to actions in a controlled way.

## What OCP is not

- **Not a centralized product database** or master data system.
- **Not a search engine, payment network, order system, or fulfillment system.**
- **Not a merchant platform's private API standard** — merchant systems remain the authoritative source for their products, prices, inventory, and orders.
- **Not MCP, REST, Webhook, or A2A** — these are binding / transport layers; OCP defines the objects and contracts above them.
- **Not a turn-key Agentic Commerce solution** — OCP covers the "discovery to action entry" segment, not the payment trust layer or the merchant execution layer.

## Core ideas

OCP rests on a few principles that interlock:

- **Object-neutral core.** The protocol centers on a generic `CommercialObject`, not "products." Products, services, talent, jobs, RFQs, channel opportunities, bookable resources, and workflow entry points are all concrete types; industry differences are expressed via versioned **Descriptor Packs** and **Query Packs**.
- **Role separation.** Catalog discovery, object indexing, data sourcing, resolve, and action execution are split across distinct roles, so no single party is data source, search engine, and payment gateway at once. See [Role model](/roles).
- **Contract-first integration.** A Provider negotiates field, object, and sync contracts before joining a Catalog. Registration establishes the contract; sync carries the data.
- **Search / Resolve separation.** Search returns candidates with explanations and freshness hints; Resolve returns permissioned details and action entry points. See [Search / Resolve / Action](/resolve-actions).
- **Permissions, trust, provenance, and freshness as first-class.** Visibility, purpose, identity, audit, expiry, and signatures are part of the protocol, not endpoint-level switches.
- **Remote-first federation.** Catalogs federate by exchanging profiles, route hints, contracts, summaries, and trust metadata — they do **not** replicate complete object databases by default.

These principles drive OCP's data model (CatalogProfile, CatalogManifest, CatalogRouteHint, ObjectContract, CatalogEntry, Query Pack, ResolvableReference, ActionBinding, …) and its six protocol layers: Registration, Handshake, Query, Resolve, Action Binding, and Transport / Adapter.

## See also

- [What is a Catalog](/what-is-catalog)
- [Role model](/roles)
- [Search / Resolve / Action](/resolve-actions)
- [Catalog architecture](/catalog-architecture)

