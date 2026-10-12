# Registration Flow

This example page describes the real `Catalog -> Registration node` runtime that ships in this repository.

## Real Lifecycle

```text
catalog admin submits CatalogRegistration
-> Registration node validates registration_id and registration_version
-> Registration node fetches /.well-known/ocp-catalog and the catalog manifest
-> Registration node validates fetched identity and endpoint/domain consistency
-> Registration node checks endpoints.health, or falls back to a query probe
-> Registration node stores registration record and manifest snapshot
-> Registration node indexes the active snapshot
-> Registration node issues catalog_access_token
-> later refresh re-fetches discovery/manifest/health and updates the active snapshot
```

In the current implementation, `operator` metadata is optional. A catalog needs to identify itself and expose discovery, manifest, query, and preferably health endpoints that the Registration node can fetch.

## What The Current Implementation Actually Persists

The current Registration node runtime stores several layers of state, not just one registration row:

- `catalog_registration_records`
- `registered_catalogs`
- `catalog_manifest_snapshots`
- `catalog_index_entries`
- `catalog_verification_records`
- `catalog_health_checks`
- `catalog_search_audit_records`

That separation matters because the runtime treats registration history, active catalog state, snapshots, search index, optional verification records, and health as related but different lifecycle concerns.

## Registration State In The Current Repository

For one `catalog_id`, the current implementation distinguishes several runtime outcomes:

- `stale_ignored`
  The registration was recorded, but its `registration_version` did not supersede the active one.
- `accepted_indexed`
  The catalog has an active indexed snapshot.

The demo Registration node keeps registration simple:

- extra domain verification is not required
- accepted registrations are indexed immediately after fetch + health evaluation

## Verification, Token, And Refresh Behavior

The current implementation also has a concrete control-plane workflow:

- `verify` confirms the catalog verification state; the demo Registration node does not require an extra challenge
- `catalog_access_token` is issued when registration succeeds if no token exists yet
- `refresh` and `token/rotate` require that catalog token
- the refresh scheduler scans catalogs that are already `accepted_indexed`

So in this repository, registration no longer waits on a domain-verification gate before the catalog becomes searchable through Registration node.

## Health And Indexing

The current Registration node does not treat health as a passive metadata field. It actively checks the catalog by calling `manifest.endpoints.health` when present, or by sending a minimal query probe for older manifests.

That health status then feeds into:

- whether a newly registered catalog is marked healthy
- whether a refreshed snapshot stays healthy
- whether consecutive failures eventually mark the index entry stale
- the trust and health information returned in route hints

## Current Repository Example

The current verified path in this workspace looks like:

```text
catalog admin posts CatalogRegistration
-> Registration node fetches the catalog discovery document
-> Registration node fetches the manifest
-> Registration node calls GET /ocp/health from manifest.endpoints.health
-> Registration node stores registration + snapshot
-> Registration node writes catalog_index_entries
-> Registration node issues catalog_access_token
-> user-side agent can now find the catalog through Registration node search
-> later refresh re-fetches manifest and updates the active snapshot
```

## Why This Example Matters

This repository's Registration node flow is more than a schema demo:

- registration is versioned and stateful
- snapshots are first-class runtime objects
- token issuance, health checks, and indexing are connected
- repeated health failures hide the catalog from default search by marking the index entry stale
- Registration node search runs over an internal catalog metadata index, not raw remote catalogs
- route hints are derived from active indexed snapshots, not from raw registration input alone
