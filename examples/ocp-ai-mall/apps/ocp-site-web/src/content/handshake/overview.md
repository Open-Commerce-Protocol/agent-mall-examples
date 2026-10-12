# Handshake Overview

`ocp.catalog.handshake.v1` is the minimal handshake layer between a Provider and a Catalog node.

## What It Covers

The handshake package defines:

- catalog manifest discovery
- object contracts
- provider registration
- provider-facing sync capability negotiation
- shared commercial object envelope
- registration feedback

## What It Does Not Cover

This package does **not** freeze:

- object sync request envelopes
- catalog query request envelopes
- resolve request envelopes
- Registration node registration

Those concerns live outside this handshake package.

## Core Questions

The handshake layer answers four questions:

1. What kind of catalog is this?
2. Which object contracts can it accept?
3. Which sync capabilities is the catalog willing to negotiate?
4. How does a provider declare its supply capability and sync preference?

## Package Surface

```text
CatalogManifest
ObjectContract
ProviderRegistration
CommercialObject
RegistrationResult
FieldRef
FieldRule
SyncCapability
```

## Example Handshake Flow

```text
GET /.well-known/ocp-catalog
-> fetch manifest
-> inspect contracts
-> inspect provider_contract.sync_capabilities
-> POST provider registration
-> receive registration result with selected_sync_capability
-> start object sync if the selected capability is catalog-hosted push
```

In the current repository, that flow resolves to a concrete commerce path:

```text
provider guarantees title + price.currency + price.amount + product_url
-> catalog matches the commerce ObjectContract
-> catalog selects ocp.push.batch
-> provider pushes CommercialObject batches with product core, price, and inventory descriptor packs
```

## Sync Capability Negotiation

The handshake protocol negotiates sync through named capabilities.

The key rules are:

- `capability_id` is the negotiation key
- `direction` is the formal data-flow category
- `transport` is only a descriptive implementation label

The baseline protocol-reserved namespace is `ocp.*`.

Examples:

- `ocp.push.all`
- `ocp.push.batch`
- `ocp.feed.url`
- `ocp.pull.api`
- `ocp.streaming`

The repository example runtime implements and publishes:

- `ocp.push.batch`

Reserved capabilities such as `ocp.feed.url`, `ocp.pull.api`, and `ocp.streaming` should only appear in a live manifest after the corresponding runtime path is implemented.

## Search Capability Shape

Inside `CatalogManifest`, the main search contract is expressed through `query_packs`.

```json
{
  "capability_id": "ocp.commerce.product.search.v1",
  "query_packs": [
    {
      "pack_id": "ocp.query.keyword.v1",
      "query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"]
        }
      }
    }
  ]
}
```

That structure remains intentional:

- `query_packs` define how an agent should search
- `query_modes` stay attached to a pack
- extra hints live in `metadata`

The handshake package does not require every catalog to share one protocol-level query classification axis. Query semantics should follow the catalog's own declared contract.

In the current commerce catalog implementation, the full query capability is richer than the minimal fragment above:

- keyword, filter, and hybrid are always exposed
- semantic is exposed only when an embedding provider is enabled
- the advertised commerce filters include `category`, `brand`, `currency`, `availability_status`, `provider_id`, `sku`, `min_amount`, `max_amount`, `in_stock_only`, and `has_image`
