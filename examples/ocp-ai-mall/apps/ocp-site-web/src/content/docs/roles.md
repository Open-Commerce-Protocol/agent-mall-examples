# Roles

This protocol has four practical roles in the current repository.

## Registration node

The Registration node helps answer:

> Which catalog should the agent ask next?

The Registration node is best understood as a catalog of catalogs.

It does not serve products directly. It indexes catalog metadata, trust state, route hints, and manifest snapshots so that agents can decide which catalog to use.

Just as importantly, OCP Catalog Registration node is not a mandatory central authority. The protocol is explicitly decentralized:

- anyone can run an OCP Catalog Registration node
- different operators can run different registration nodes with different intake, trust, and governance policies
- a catalog can choose which registration node or nodes to register with
- an agent or application can choose which registration node or nodes to trust

That means the existence of one public or official Registration node does not make the protocol itself centralized.

## Catalog

The Catalog is the query-serving node.

It is responsible for:

- publishing a manifest
- defining object contracts
- accepting provider registrations
- ingesting synchronized objects
- exposing query and resolve endpoints
- exposing action entrances through resolve results

## Provider

The Provider is the object supplier.

It is responsible for:

- declaring what object types and packs it can provide
- sending versioned registration updates
- synchronizing concrete objects into the catalog

## Agent

The Agent is the consuming side.

It is responsible for:

- selecting a catalog through the Registration node
- reading catalog capability information
- issuing query requests against the selected catalog
- resolving selected entries into final actions

Those final actions are intentionally open-ended. In one catalog they may be `view_product` or `buy_now`; in another they may be `book_slot`, `apply_job`, `submit_resume`, `send_interview_invite`, or `request_quote`.

## Role Graph

```text
Provider -> Catalog -> Registration node
                 ^
                 |
               Agent
```

## Why This Split Matters

This split keeps four different concerns separate:

- object supply
- catalog serving
- network-level discovery
- contextual resolution into next actions

That separation is what makes the current demo chain workable with more than one provider and more than one catalog.

It also keeps protocol power distributed:

- providers do not depend on a single discovery authority
- catalogs do not need permission from one global operator to exist
- registration nodes can compete or specialize without changing the handshake protocol

## Practical Combinations

One organization can still operate multiple roles. The boundary is protocol-level authority, not company structure or process topology.

- A WooCommerce store can be both **Provider** and **Action Provider**: it supplies product objects and still owns checkout, orders, taxes, fulfillment, and refunds.
- A reference commerce agent plays **Agent** while combining separate payment trust and confirmation rules outside the Catalog protocol.
- A public commerce catalog plays **Catalog**, aggregates multiple Providers, and registers with one or more Registration nodes.

The important rule is that each surface keeps its responsibility clear. A Registration node does not become product search, a Catalog does not become the order system, and an Agent does not bypass resolve or user confirmation.
