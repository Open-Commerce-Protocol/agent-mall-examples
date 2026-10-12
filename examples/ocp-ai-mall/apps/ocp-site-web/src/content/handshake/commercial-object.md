# CommercialObject

`CommercialObject` is the shared object envelope synchronized into the catalog.

## Goal

It gives the catalog a stable outer structure while leaving the domain-specific payload inside descriptor packs.

It is not a complete product-detail schema. A catalog can project a
`CommercialObject` into searchable `CatalogEntry` records and return enough
context for ranking, explanation, provenance, and resolve. Detailed product
state can still live behind the provider API or the original source.

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "object_id",
    "object_type",
    "provider_id",
    "title",
    "descriptors"
  ]
}
```

## Descriptor Fragment

```json
{
  "provenance": {
    "authority_type": "provider_authoritative",
    "provider_id": "commerce_provider_local_dev",
    "verification_status": "verified",
    "trust_tier": "verified"
  },
  "descriptors": [
    {
      "pack_id": "ocp.commerce.product.core.v1",
      "schema_uri": "https://ocp.dev/schema/...",
      "data": {
        "title": "Wireless Noise Cancelling Headphones"
      }
    }
  ]
}
```

## Provenance

`provenance` is an OCP core record. It answers who is authoritative for this
object and how much the catalog can trust that claim.

Supported authority shapes include:

- `provider_authoritative`
- `external_source`
- `imported_snapshot`
- `source_proxy`

`source_url` is optional. A provider can be authoritative without also listing
the object somewhere else. If the object is copied from Shopify, Taobao, or
another platform, use `external_source`, `source_site`, `source_uri`, and source
IDs in provenance instead of inventing core commerce fields.

## Why Descriptors Exist

Instead of making one fixed product schema, `CommercialObject` lets packs carry domain detail.

That means the catalog can:

- validate packs individually
- project useful fields into an index
- preserve pack-level extensibility

## Search And Resolve Boundary

Catalog search should return candidates, summaries, ranking/explanation signals,
freshness, trust, and a resolve reference. It does not need to return every
provider detail field.

Resolve can then return permissioned details, live checks, action bindings, or a
provider/source reference. This lets persistent catalogs, one-shot import
catalogs, and live forwarding catalogs share one object envelope without forcing
the catalog to become the provider's complete product database.

## Repository Example

The demo commerce catalog projects pack data into catalog entries for:

- keyword search
- filter columns
- semantic embedding text
