# Sync Capabilities

`SyncCapability` is the formal negotiation surface between Catalog and Provider.

## Why It Exists

`SyncCapability` defines the negotiable sync surface between Catalog and Provider.

It can express:

- snapshot vs delta vs stream
- mutation semantics
- batching limits
- endpoint ownership
- endpoint field requirements
- future bootstrap or auth details

## Catalog Side

The catalog publishes sync capabilities in:

```text
CatalogManifest.provider_contract.sync_capabilities[]
```

Each capability is matched by `capability_id`.

## Provider Side

The provider declares sync intent in:

```text
ProviderRegistration.object_declarations[].sync
```

The declaration surface is intentionally small:

- `preferred_capabilities`
- `avoid_capabilities_unless_necessary`
- `provider_endpoints`

If a capability is absent from both capability lists, it is not declared usable by that provider declaration.

## Provider Continuity

The protocol does not add a separate `provider_lifecycle` field. A provider's
continuity is inferred from the selected sync and resolve surfaces.

A provider should be treated as persistent for a capability when any of these are
true:

- `direction` is `catalog_pull_provider`
- `direction` is `provider_stream_to_catalog`
- `sync_model.delta` is `true`
- `sync_model.stream` is `true`
- `endpoint_contract.hosted_by` is `provider`
- the matching object contract uses `resolve_policy.strategies` with `provider_api`

A pure `provider_to_catalog` snapshot push with no provider-hosted endpoint, no
delta/stream model, and no provider-backed resolve is a one-shot import. It can
still be trusted if its identity and provenance claims satisfy the object
contract, but the catalog should not assume a live provider remains callable.

## Example Sync Path

The current commerce provider and catalog examples negotiate:

```json
{
  "preferred_capabilities": ["ocp.push.batch"],
  "avoid_capabilities_unless_necessary": [],
  "provider_endpoints": {}
}
```

The catalog then returns:

```json
{
  "selected_sync_capability": {
    "capability_id": "ocp.push.batch",
    "reason": "provider_preferred_and_supported_by_catalog"
  }
}
```

The example runtime path is:

```text
register
-> selected_sync_capability = ocp.push.batch
-> provider sends batched ObjectSyncRequest payloads
-> for large imports, provider may send application/x-ndjson to object_sync_stream
```

The streaming form is still catalog-hosted push. It does not require the
provider to expose a long-lived public endpoint. The provider supplies
`provider_id`, `registration_version`, `batch_id`, and optional `chunk_size` as
query parameters, then streams one `CommercialObject` JSON object per line. The
Catalog commits bounded chunks with stable request hashes, so a provider can
retry the same stream with the same `batch_id` and chunking parameters after a
transport failure without duplicating committed chunks or index jobs. Changing
chunk boundaries makes the retry a different write request and should be
expected to fail with a hash conflict for already committed chunks.

For stream sync, the provider supplied `batch_id` is the `sync_run_id`.
Production catalogs should expose an `object_sync_run` endpoint so providers can
inspect committed checkpoint state before retrying. Providers must pass
`provider_id` because run identity is provider-scoped. Accepted chunks must also
write durable side-effect intents, such as search indexing and activity events,
inside the same commit as object facts; stale claimed outbox work must be
reclaimable after worker crashes.

## Reserved Capability Guidance

### `ocp.feed.url`

Use this only when the catalog can actively pull provider-hosted feeds.

Implementation requirements:

- provider declares `provider_endpoints.feed_url.url`
- catalog has a fetch scheduler
- catalog can handle snapshot replacement, retries, and checksum/etag logic

### `ocp.pull.api`

Use this only when the catalog can call a provider API directly.

Implementation requirements:

- provider exposes pull endpoints and pagination/cursor contracts
- catalog has API clients, auth handling, and incremental state tracking

### `ocp.streaming`

Use this only when the catalog can consume a continuous stream.

Implementation requirements:

- provider exposes a stable streaming channel or webhook contract
- catalog has reconnect, checkpoint, replay, and idempotent consumption logic

## `provider_endpoints` Shape

`provider_endpoints` is an endpoint map, not a bare string map.

```json
{
  "provider_endpoints": {
    "feed_url": {
      "url": "https://provider.example/catalog-feed.json"
    }
  }
}
```

Wrapping the URL in an object keeps the shape extensible for auth override, content type, refresh hints, checksum URLs, webhook callbacks, or bootstrap metadata.
