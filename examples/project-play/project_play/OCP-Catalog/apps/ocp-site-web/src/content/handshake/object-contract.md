# ObjectContract

`ObjectContract` defines the field-level acceptance boundary published by a catalog.

## What It Controls

An object contract expresses:

- required field requirements
- optional field references
- additional field policy
- field usage policy for retrieval, visibility, and explainability
- identity policy for dedupe and provider-supplied keys
- provenance requirements for accepted authority types
- resolve policy for post-search references

## Schema Fragment

```json
{
  "required": ["required_fields"],
  "properties": {
    "required_fields": { "type": "array" },
    "optional_fields": { "type": "array" },
    "additional_fields_policy": {
      "enum": ["allow", "ignore", "reject"]
    },
    "field_usage_policy": [
      {
        "field_ref": "ocp.commerce.product.core.v1#/sku",
        "requirement": "optional",
        "usage": ["identity", "filter", "never_expose"]
      }
    ],
    "identity_policy": {
      "accepted_identity_keys": ["provider_object_id", "provider_sku"]
    },
    "provenance_requirements": {
      "accepted_authority_types": ["provider_authoritative", "imported_snapshot"]
    },
    "resolve_policy": {
      "strategies": ["provider_api", "catalog_cached"]
    }
  }
}
```

## Required Field Groups

Each entry in `required_fields` is either:

- a single `FieldRef`
- an array of `FieldRef` values meaning "at least one of these fields must be guaranteed"

Example:

```json
[
  "ocp.commerce.product.core.v1#/title",
  [
    "ocp.commerce.price.v1#/amount",
    "provider#/price_text"
  ]
]
```

## Field References

Field references point at concrete fields using `FieldRef`.

Examples:

```text
provider#/display_name
ocp.commerce.product.core.v1#/title
ocp.commerce.price.v1#/amount
```

This keeps compatibility checks directly on fields instead of requiring provider-facing pack negotiation.

## Field Usage Policy

`field_usage_policy` tells agents and providers which accepted fields the catalog
actually uses for retrieval, ranking, display, explanation, and resolve.

Common usages include:

- `identity`
- `index`
- `filter`
- `rank`
- `display`
- `explain`
- `search_visible`
- `resolve_visible`
- `never_expose`

A field can be accepted for dedupe or filtering without being exposed in search
results. For example, a provider SKU can be accepted as an identity claim while
remaining `never_expose`.

Preview media should be modeled as a display/search-visible projection. A
commerce catalog can accept `ocp.commerce.product.core.v1#/image_urls` and
project the first usable image into `CatalogEntry.image_url` for result cards,
while keeping the full image list in descriptors or Resolve details.

## Identity, Provenance, And Resolve

`identity_policy` is a catalog-level statement about which keys can identify or
deduplicate incoming objects. `provider_sku` is not automatically trusted; a
catalog can require a verified provider before using provider-supplied SKU as an
identity key.

`provenance_requirements` declares accepted authority shapes:

- `provider_authoritative`
- `external_source`
- `imported_snapshot`
- `source_proxy`

A provider can be the authority. Objects do not need to be listed on an external
site unless the catalog contract asks for an external source key.

`resolve_policy` declares how a matched entry can become a `ResolvableReference`:

- `provider_api`
- `source_url`
- `catalog_cached`
- `unavailable`

These policies are OCP Catalog core semantics. Commerce-specific fields such as
brand, category, SKU, price, inventory, product URL, and platform product IDs
belong in commerce descriptor packs or concrete catalog implementations.

## Current Commerce Contract In This Repository

The first catalog in this repository currently exposes this contract:

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

The minimum registration condition is therefore:

- guarantee `ocp.commerce.product.core.v1#/title`
- guarantee `ocp.commerce.price.v1#/currency`
- guarantee `ocp.commerce.price.v1#/amount`

The current provider example in this repository declares an even stronger baseline by also guaranteeing `ocp.commerce.product.core.v1#/product_url`.

That is an implementation choice, not a protocol requirement. The catalog publishes the minimum it needs for commerce indexing, while the provider can still promise a richer payload.

Sync transport is negotiated separately through `sync_capabilities`, not through `ObjectContract`.
