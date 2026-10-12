# OCP Catalog Protocol

This site documents the protocol surface implemented in the current repository for OCP Catalog.

![OCP Catalog protocol layer connecting merchant systems, provider apps, catalogs, and agent query side](images/ocp-catalog-protocol-layer.png)

It focuses on two protocol layers:

- `ocp.catalog.handshake.v1`
- `ocp.catalog.registration.v1`

## What This Protocol Solves

The protocol separates the catalog supply side from the catalog discovery side.

At a high level:

1. Providers tell a catalog what objects they can supply.
2. Catalogs expose query and resolve capability over those objects.
3. Catalogs register themselves to an OCP Catalog Registration node.
4. User-side agents ask the Registration node which catalog to use.
5. Agents route to the selected catalog and perform query and resolve there.

The important conceptual split is:

- query finds candidate objects
- resolve turns a chosen candidate into the next executable reference

That next step can be more than a page view. Depending on the catalog and caller permissions, resolve may expose actions such as buying a product, booking a local service, applying to a job, submitting a resume, sending an interview invite, requesting a quote, or entering a domain workflow.

OCP Catalog is therefore not only a product catalog protocol. It is a protocol layer for discovering commercial objects and resolving them into safe, contextual next steps.

## Protocol Boundaries

The protocol is intentionally split.

### Handshake

`ocp.catalog.handshake.v1` handles:

- `Provider -> Catalog`
- catalog manifest discovery
- object contracts
- provider registration
- shared commercial object envelope

It does **not** own Registration node registration or catalog federation.

### Registration node

`ocp.catalog.registration.v1` handles:

- `Catalog -> Registration node`
- Registration node discovery
- catalog registration
- catalog search
- route hint delivery

It does **not** index products directly.

## Current Repository Status

This workspace already runs the end-to-end path below:

```text
Catalog startup
-> Catalog registers to Registration node
-> Provider registers to Catalog
-> Provider syncs commercial objects
-> Agent asks Registration node for a Catalog
-> Agent queries Catalog
-> Agent resolves a chosen result
```

The current live example behind that path is specifically a commerce product catalog:

- the catalog's minimum object contract requires `title + price.currency + price.amount`
- the provider's default registration also guarantees `product_url`
- synced products are projected into commerce search entries with price, image, availability, and quality signals
- the provider admin flow surfaces `local_quality`, `publish_readiness`, and `catalog_quality`
- semantic and hybrid retrieval are part of the verified implementation path when embeddings are enabled

## Design Notes

The current implementation follows two important conventions.

### Query Packs Are the Main Search Contract

Catalogs tell agents how to search primarily through `query_packs`, not through a flat list of modes.

Example:

```json
{
  "query_packs": [
    {
      "pack_id": "ocp.query.keyword.v1",
      "query_modes": ["keyword", "hybrid"],
      "metadata": {
        "query_hints": {
          "supported_query_languages": ["en"],
          "filter_fields": ["category", "brand", "currency", "availability_status", "provider_id", "sku", "min_amount", "max_amount", "in_stock_only", "has_image"]
        }
      }
    }
  ]
}
```

The real commerce manifest in this repository actually publishes multiple query packs under the same capability:

- `ocp.query.keyword.v1`
- `ocp.query.filter.v1`
- `ocp.query.semantic.v1` when embeddings are enabled

### Optional Hints Live in Metadata

Extra hints such as language support, semantic search guidance, or filter hints are treated as optional metadata rather than top-level required protocol axes.

This keeps the protocol stable while still giving agents useful planning hints.

## How To Read This Site

- Start with [Roles](/roles)
- If you want to build quickly, read [Getting Started](/getting-started)
- If you have practical onboarding questions, read [FAQ](/faq)
- If you want the smallest concrete implementation, read [Minimal Catalog](/examples/minimal-catalog) and [Minimal Provider](/examples/minimal-provider)
- If you want the core `resolve` idea, read [Resolve & Actions](/resolve-actions)
- Then read the Handshake overview
- Then read the Registration node overview
- Finally inspect the example flows

