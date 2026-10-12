# Commerce Catalog Example

This repository now implements a concrete commerce product catalog that is closer to a real provider and product-search workflow than the original protocol-only MVP.

![Commerce product data synchronization pipeline into OCP Catalog query and resolve surfaces](images/commerce-data-sync-pipeline.png)

## What The Live Example Actually Does

The current example is not a generic placeholder. It is the running behavior of:

- `apps/commerce-catalog-api`
- `apps/examples/commerce-provider-api`
- `apps/examples/commerce-provider-admin-web`
- `packages/catalog-core`

The live catalog accepts commerce product objects, projects them into searchable entries, computes quality tiers, optionally writes embeddings, and returns resolvable product candidates.

Its manifest also publishes a `data_profile` with the current
`catalog_entry_count`. That count is the number of active entries actually
stored in this catalog database; it is not a search-index freshness claim or a
claim about products available from remote live-forwarding catalogs.

## Current Object Contract

The current catalog requires a provider declaration that can guarantee:

```json
{
  "required_fields": [
    "ocp.commerce.product.core.v1#/title",
    "ocp.commerce.price.v1#/currency",
    "ocp.commerce.price.v1#/amount"
  ],
  "optional_fields": [
    "ocp.commerce.product.core.v1#/summary",
    "ocp.commerce.product.core.v1#/brand",
    "ocp.commerce.product.core.v1#/category",
    "ocp.commerce.product.core.v1#/sku",
    "ocp.commerce.product.core.v1#/product_url",
    "ocp.commerce.product.core.v1#/image_urls",
    "ocp.commerce.inventory.v1#/availability_status",
    "ocp.commerce.inventory.v1#/quantity"
  ],
  "additional_fields_policy": "allow"
}
```

This is important because the catalog no longer treats a bare `title` as enough for a realistic commerce baseline. A product must at least carry title and usable price fields to satisfy the catalog's minimum commerce contract.

## Provider Registration In The Real Example

The current provider implementation declares:

- guaranteed `title`
- guaranteed `price.currency`
- guaranteed `price.amount`
- guaranteed `product_url`
- preferred sync capability `ocp.push.batch`

So the provider is intentionally stronger than the catalog minimum. That mirrors a more realistic merchant feed: the provider promises the fields that make a catalog result actually actionable.

In this repository, that declaration is currently built from the provider's local mapping layer. The demo provider does not fetch the catalog manifest or contracts first and then synthesize a registration dynamically.

## Real Demo Products

The seeded provider demo data includes examples such as:

- `electronics-headphones-001`
- `flower-orchid-001`
- `grocery-coffee-001`
- `gift-card-digital-001`
- `service-bike-tuneup-001`

Those objects are mapped into `CommercialObject` envelopes with three descriptor packs:

- `ocp.commerce.product.core.v1`
- `ocp.commerce.price.v1`
- `ocp.commerce.inventory.v1`

The price pack now includes richer commerce semantics like `list_amount` and `price_type`, and inventory keeps `out_of_stock` as a real product state instead of treating it as deletion.

## How The Catalog Indexes Products

For each synced object, the catalog builds a commerce-oriented projection that includes fields such as:

- `title`
- `summary`
- `brand`
- `category`
- `sku`
- `amount`
- `list_amount`
- `price_type`
- `availability_status`
- `quantity`
- `product_url`
- `primary_image_url`
- `has_image`
- `has_product_url`
- `discount_present`
- `quality_tier`

The catalog then uses that projection in four ways:

1. keyword search text
2. structured filtering
3. resolve-visible attributes
4. optional semantic embedding text

## Query Capabilities In The Current Implementation

The live commerce query capability supports:

- `keyword`
- `filter`
- `hybrid`
- `semantic` when an embedding provider is enabled

The currently advertised structured filters are:

- `category`
- `brand`
- `currency`
- `availability_status`
- `provider_id`
- `sku`
- `min_amount`
- `max_amount`
- `in_stock_only`
- `has_image`

This is the real shape already used by the catalog API and the user-demo agent.

## Quality Tiers

The current catalog computes a quality tier for each product entry:

- `basic`
- `standard`
- `rich`

The tier is derived from the actual indexed fields. For example:

- price + product URL + inventory + brand/category gives the entry a standard commerce baseline
- adding image + summary + sku upgrades it to `rich`

That tier then affects ranking, provider quality reporting, and resolve output.

## Semantic Search In The Real Example

When embeddings are enabled, the catalog writes vectors into `catalog_search_embeddings` and supports:

- semantic-only retrieval
- hybrid keyword + semantic reranking

The repository now also contains a real integration test that locks this behavior using a local hash embedding provider, so the semantic path is verified without relying on an external model service.

## End-To-End Flow In This Repository

The current verified flow is:

```text
seed provider demo products
-> provider reads current active provider state from the catalog
-> provider submits the next version of ProviderRegistration
-> catalog accepts and selects ocp.push.batch
-> provider publishes CommercialObject batches
-> catalog builds projections and optional embeddings
-> query returns ranked entries with commerce attributes
-> resolve returns a ResolvableReference with visible commerce fields and view_product action
-> provider status surfaces local_quality, publish_readiness, and catalog_quality
```

`view_product` is the action implemented by this commerce example. It should be read as one action binding, not as the limit of resolve. A richer commerce catalog could expose `add_to_cart`, `buy_now`, or `request_quote`; a non-commerce catalog could expose appointment, application, invitation, or procurement actions through the same resolve shape.

Two concrete implementation details matter here:

- the current provider runtime computes `next_registration_version` from the catalog's active provider state
- `publish-to-catalog` is an orchestration helper over `registerToCatalog` followed by `syncAll`, and `syncAll` currently chunks products into batches of 25

## Why This Example Matters

This example now demonstrates more than protocol shape. It shows a real catalog instance making concrete commerce decisions:

- minimum commerce-ready contract is stronger than a title-only object
- provider registration can promise richer fields than the catalog minimum
- query ranking mixes text relevance with commerce quality signals
- provider and catalog both expose feed-quality feedback
- semantic retrieval is part of the verified implementation path, not just a placeholder in the manifest

