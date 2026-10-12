# CatalogRouteHint

`CatalogRouteHint` is the Registration node's minimal routing summary for one catalog.

## Required Fields

```json
{
  "required": [
    "catalog_id",
    "catalog_name",
    "manifest_url",
    "query_url",
    "verification_status",
    "trust_tier",
    "health_status",
    "cache_ttl_seconds",
    "snapshot_id",
    "snapshot_fetched_at"
  ]
}
```

## Example Fragment

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "catalog_name": "Commerce Product Search Catalog",
  "description": "English-language commerce product catalog",
  "manifest_url": "http://localhost:4000/ocp/manifest",
  "query_url": "http://localhost:4000/ocp/query",
  "resolve_url": "http://localhost:4000/ocp/resolve",
  "supported_query_packs": ["ocp.query.keyword.v1", "ocp.query.filter.v1", "ocp.query.semantic.v1"],
  "metadata": {
    "query_hints": {
      "supported_query_modes": ["keyword", "filter", "semantic", "hybrid"],
      "supported_query_languages": ["en"],
      "content_languages": ["en"]
    }
  }
}
```

## Why Metadata Exists

Mode hints and language hints are useful, but they are not the route hint's core purpose.

That is why they sit in `metadata` rather than being promoted to hard protocol axes.

## Agent Rule

Use the route hint to decide whether to route.

Use the manifest to understand the full search contract.
