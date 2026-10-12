# CatalogSearch

`CatalogSearchRequest` and `CatalogSearchResult` define how an agent asks the Registration node for candidate catalogs.

## Search Request

The request is intentionally lightweight.

```json
{
  "required": ["query"],
  "properties": {
    "filters": {
      "properties": {
        "query_pack": { "type": "string" },
        "supports_resolve": { "type": "boolean" },
        "verification_status": { "type": "string" },
        "trust_tier": { "type": "string" },
        "health_status": { "type": "string" },
        "domain": { "type": "string" },
        "tag": { "type": "string" }
      }
    }
  }
}
```

## Search Result Item

Each result item includes both ranking and route information.

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "catalog_name": "Commerce Product Search Catalog",
  "score": 0.96,
  "matched_query_packs": ["ocp.query.keyword.v1"],
  "route_hint": {
    "catalog_id": "commerce_catalog_local_dev",
    "query_url": "http://localhost:4000/ocp/query",
    "manifest_url": "http://localhost:4000/ocp/manifest",
    "supported_query_packs": ["ocp.query.keyword.v1", "ocp.query.filter.v1", "ocp.query.semantic.v1"]
  },
  "explain": [
    "Matched supported query pack ocp.query.keyword.v1"
  ]
}
```

## Design Intent

The Registration node performs catalog selection, not product retrieval.

So the search result should help the agent choose a catalog and then leave product search to that catalog.
