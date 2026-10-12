# CatalogManifest

`CatalogManifest` is the catalog's public handshake document.

## What It Declares

It tells a provider or agent:

- who the catalog is
- which endpoints are public
- which object contracts it accepts
- which query capabilities it exposes
- optionally, how many active catalog entries it physically stores
- optionally, which provider fields it requires
- optionally, which sync capabilities it is willing to negotiate with providers

A Catalog Node is not required to accept Provider ingestion. Source catalogs such
as affiliate networks, federated routing nodes, or live API directories may only
expose query and resolve surfaces.

## Data Profile Shape

`data_profile` is optional. It is for catalogs that physically store entries and
can declare the size of that active stored data plane.

```json
{
  "data_profile": {
    "catalog_entry_count": 10000000,
    "object_counts": [
      { "object_type": "product", "count": 10000000 }
    ],
    "counted_at": "2026-06-06T00:00:00.000Z"
  }
}
```

`catalog_entry_count` is the number of active catalog entries physically stored
by the catalog. For a commerce catalog this can be read as actual ingested
products. It is not a claim that the search index is fully caught up, nor a claim
about how many products a remote platform could theoretically expose.

Live forwarding catalogs, such as affiliate-network or Shopify bridge catalogs,
should omit `data_profile` when they do not persist product entries locally.

## Endpoint Shape

```json
{
  "endpoints": {
    "health": { "url": "https://catalog.example/ocp/health", "method": "GET" },
    "query": { "url": "https://catalog.example/ocp/query", "method": "POST" },
    "resolve": { "url": "https://catalog.example/ocp/resolve", "method": "POST" },
    "provider_registration": { "url": "https://catalog.example/ocp/providers/register", "method": "POST" },
    "contracts": { "url": "https://catalog.example/ocp/contracts", "method": "GET" },
    "object_sync": { "url": "https://catalog.example/ocp/objects/sync", "method": "POST" },
    "object_sync_stream": { "url": "https://catalog.example/ocp/objects/sync/stream", "method": "POST" },
    "object_sync_run": { "url": "https://catalog.example/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}", "method": "GET" },
    "object_sync_run_complete": { "url": "https://catalog.example/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}", "method": "POST" }
  }
}
```

`endpoints.health` is optional for schema compatibility, but production catalogs should expose it. Registration nodes call it during registration and refresh before falling back to a query probe for older manifests.

Only `endpoints.query` and `endpoints.resolve` are required. `provider_registration`,
`object_sync`, `object_sync_stream`, `object_sync_run`,
`object_sync_run_complete`, `contracts`, and `provider_contract` are present
only when the Catalog implements those surfaces. A live affiliate Catalog can
omit Provider ingestion endpoints entirely.

The health endpoint returns `CatalogHealth`:

```json
{
  "ocp_version": "1.0",
  "kind": "CatalogHealth",
  "catalog_id": "hello_catalog",
  "status": "healthy",
  "ready": true,
  "checked_at": "2026-05-17T00:00:00.000Z",
  "details": {},
  "dependencies": []
}
```

Only `status: "healthy"` with `ready: true` is treated as a successful Registration health check. `degraded` is a diagnostic state and is counted as unhealthy for search visibility.

## Provider Contract Shape

`provider_contract` is optional. It is needed when the Catalog accepts Provider
registration or object sync, and should be omitted when the Catalog only acts as
a queryable/resolvable source node.

`provider_contract` includes two formal surfaces:

- `field_rules`
- `sync_capabilities`

Example:

```json
{
  "provider_contract": {
    "field_rules": [
      {
        "field_ref": "provider#/display_name",
        "requirement": "required"
      }
    ],
    "sync_capabilities": [
      {
        "capability_id": "ocp.push.batch",
        "direction": "provider_to_catalog",
        "transport": "http_push",
        "sync_model": {
          "snapshot": true,
          "delta": false,
          "stream": true
        },
        "mutation_semantics": {
          "upsert": true,
          "delete": true
        },
        "batching": {
          "enabled": true,
          "max_items": 1000
        },
        "streaming": {
          "enabled": true
        },
        "metadata": {
          "stream_endpoint_path": "/ocp/objects/sync/stream",
          "run_status_endpoint_path": "/ocp/object-sync-runs/{sync_run_id}?provider_id={provider_id}",
          "run_complete_endpoint_path": "/ocp/object-sync-runs/{sync_run_id}/complete?provider_id={provider_id}",
          "stream_content_type": "application/x-ndjson"
        }
      }
    ]
  }
}
```

For NDJSON streaming, each non-empty line is one `CommercialObject`. The Catalog
commits the stream in bounded chunks. Each committed chunk is recorded as a
sync chunk receipt using the provider supplied `batch_id` plus a chunk ordinal.
If the transport fails halfway through, the provider can retry the same stream
with the same `batch_id` and chunking parameters. Previously committed chunks
replay by `request_hash` and do not create duplicate index jobs. Changing chunk
boundaries is a different write request and the already committed chunk fails as
a hash conflict.

The stream `batch_id` is also the `sync_run_id`. Providers must pass
`provider_id` when calling `object_sync_run`, because `sync_run_id` is scoped by
provider. They can inspect committed checkpoint state before retrying. A normal
end-of-stream completes the run. Catalogs persist index and activity side
effects through a durable outbox before returning sync success, so recovery can
repair missing downstream work without duplicating object facts.

## Search Contract Shape

The search contract is expressed through `query_capabilities[*].query_packs`.

```json
{
  "query_capabilities": [
    {
      "capability_id": "ocp.commerce.product.search.v1",
      "query_packs": [
        {
          "pack_id": "ocp.query.keyword.v1",
          "query_modes": ["keyword", "hybrid"]
        },
        {
          "pack_id": "ocp.query.filter.v1",
          "query_modes": ["filter", "hybrid"]
        }
      ]
    }
  ]
}
```

The protocol only requires the catalog to declare:

- which query endpoints exist
- which query capabilities exist
- which input fields are accepted
- which fields are searchable, filterable, or sortable
- where the request schema lives

## Runtime Example

The commerce catalog example publishes one provider-facing sync capability:

- `ocp.push.batch`

Reserved capabilities such as `ocp.feed.url` belong in the runtime manifest only when the corresponding transport path is implemented.

Provider persistence is not declared through a separate `provider_lifecycle`
field. It is inferred from `sync_capabilities`, provider-hosted endpoints, and
object-level `resolve_policy`. Snapshot-only provider push is an import path;
pull, stream, delta, provider-hosted endpoints, or provider-backed resolve imply
a persistent provider relationship for that capability.
