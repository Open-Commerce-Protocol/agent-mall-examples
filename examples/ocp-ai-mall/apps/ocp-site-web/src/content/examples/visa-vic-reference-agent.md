---
title: Visa VIC reference agent
description: The Visa VIC reference agent demonstrates a clean three-layer split — discovery to OCP, trust to Visa, fulfillment to the merchant — with the agent only orchestrating, never overreaching.
category: agentic-commerce
order: 1
---

# Visa VIC reference agent

> OCP's external demonstration in an Agentic Commerce scenario: protocol, payment trust, and merchant systems each own one layer; the agent only orchestrates; purchases stay auditable, refusable, and layered.

## Overview

The Visa VIC reference agent chains "user intent → product discovery → user confirmation → payment instruction → merchant order" into an **auditable, refusable, layered** path. OCP Catalog handles "find the object and the action entry." Visa VIC / VTS / Visa MCP Server handles "payment trust and constrained credentials." The merchant system continues to own its orders and fulfillment. The agent is the orchestrator between these three layers.

## The problem

- The most dangerous failure mode in Agentic Commerce is "the agent buys with the user's card" — a credential leak and an audit loss at the same time.
- Letting agents speak directly to each merchant's private API compresses "find" and "create order" into a single call, bypassing user confirmation.
- Without a structured purchase intent, "natural-language authorization" cannot be verified, refused, or replayed.

The reference agent's value is to **demonstrate a clean separation**: discovery to OCP, trust to Visa, fulfillment to the merchant — the agent only orchestrates.

## What it is not

- Not a Visa marketing piece — it's a reference implementation showing that OCP × Visa VIC × merchant systems can compose cleanly.
- Not a payment API specification — Visa VIC, VTS, and MCP Server APIs are out of scope here.
- Not part of the OCP protocol — it **consumes** OCP; it does not **define** OCP.
- Not an "automatic buying bot" — discovery shortcuts like `find_and_query_catalog` are **not** automatic-buy tools.
- Not a merchant system proxy — the merchant layer described in [WooCommerce integration overview](/examples/woocommerce-overview) still owns orders, taxes, fulfillment, and refunds.

## Core ideas

### Three layers

```
Agent Layer       Visa VIC Reference Agent
                  User intent / candidate comparison / user confirmation / Payment Instruction orchestration
                          │
Protocol Layer    OCP Catalog
                  Search / Resolve / Checkout / Order / Event contracts
                          │
Merchant Layer    WooCommerce / Shopify / Magento / custom storefronts
                  Product / Offer / Order / Webhook adapter
```

The reference agent **does not depend on WooCommerce.** It depends on OCP's protocol capabilities. Swap the merchant platform or the payment trust layer and the agent's core boundary stays intact.

### What the reference agent does

- Understands the user's purchase intent and constraints (amount, merchant scope, delivery, expiry, …).
- Queries an OCP Registration Node or a local Catalog profile cache.
- Calls the target Catalog's query and resolve.
- Presents candidates, prices, inventory, shipping — **and uncertainties** — to the user.
- Asks the user to **explicitly confirm** the purchase constraints.
- Generates and submits a Payment Instruction request.
- Retrieves a constrained payment context via Visa MCP Server / VIC / VTS.
- Creates the merchant order through OCP checkout.
- Queries and reports order status back to the user.
- Writes key actions into an audit / event ledger.

### What the reference agent does not do

- It does not host the merchant's product database.
- It does not invent prices, inventory, or shipping promises.
- It does not create payment instructions without explicit user confirmation.
- **It does not obtain or store raw user card numbers.**
- It does not modify WooCommerce / Shopify / Magento private order tables.
- It does not bypass OCP resolve / checkout to call merchant internal APIs.

### Main flow

```
User intent
  -> Agent searches OCP Catalog Registration Node or local Catalog cache
  -> Agent selects target Catalog
  -> Agent queries OCP Catalog
  -> Agent resolves candidate products
  -> Agent presents options and uncertainty to User
  -> User confirms product, merchant, amount, delivery, expiry and substitution policy
  -> Agent requests authenticated Payment Instruction
  -> VIC validates agent / user / payment context
  -> Agent retrieves constrained payment credential or authorization context
  -> Agent creates checkout with OCP merchant endpoint
  -> Merchant creates order and returns status
  -> Agent reports result to User
  -> Agent submits commerce signals / audit events
```

This chain strictly respects [Search / Resolve / Action](/resolve-actions): Search yields candidates, Resolve yields ActionBinding plus a constrained context, and Action — in this case, checkout — only happens after the user confirms.

### Payment Instruction: a structured authorization

A Payment Instruction is **not free-form text**. It is a structured object that can be signed, verified, expired, and replayed; at minimum it includes:

| Constraint | Meaning |
| --- | --- |
| `max_total_amount` / `currency` | Total cap including taxes and shipping |
| `merchant_scope` | Allowed merchants; the agent cannot switch merchants |
| `product_scope` | Specific entry ids or broader categories; the two must be distinguished |
| `quantity` | Quantity; exceeding it requires re-confirmation |
| `delivery_constraints` | Shipping region, arrival time, etc. |
| `expires_at` | Expiry; reauthentication required after this |
| `usage` | One-time vs reusable; default one-time |
| `substitution_policy` | Out-of-stock substitution behavior |
| `cancellation_policy` | Behavior on price / inventory / shipping changes |

The correct model is: **the user authenticates a constrained instruction → the agent receives a constrained payment context or token reference → the merchant receives a verifiable payment authorization result** — not "the agent buys with the user's card." Visa's controls validate alignment between merchant, amount, and instruction; every step is auditable.

### Boundaries worth repeating

- **OCP Catalog does not implement Visa tokenization.** Tokenization, user authentication, and Payment Instruction lifecycle belong to Visa VIC / VTS.
- **Visa VIC does not own OCP Catalog's product indexing or ranking.** That belongs to the Catalog Node.
- **`find_and_query_catalog` is not an "automatic buy" tool.** It is a discovery shortcut; it does not replace resolve or user confirmation.
- **Purchase must go through Resolve, user confirmation, and Payment Instruction.** All three are required.
- **Checkout requests must reference an entry / action obtained from OCP resolve** — not URLs hand-assembled by the agent.
- **The merchant system remains the authoritative order and fulfillment state machine.** OCP, Visa, and the agent never take over the merchant's order lifecycle.

## See also

- [What is OCP](/what-is-ocp)
- [What is a Catalog](/what-is-catalog)
- [Role model](/roles)
- [Search / Resolve / Action](/resolve-actions)
- [Catalog architecture](/catalog-architecture)
- [WooCommerce integration overview](/examples/woocommerce-overview)
- [WebMCP demo](/examples/webmcp-demo)

