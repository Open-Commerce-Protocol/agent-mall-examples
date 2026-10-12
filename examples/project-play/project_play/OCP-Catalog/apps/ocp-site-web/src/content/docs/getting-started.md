# Getting Started

This page is for builders who want to participate in the OCP network quickly.

There are two common ways to join:

- run a **catalog** and register it to an OCP Catalog Registration node
- run a **provider** and register it to a catalog

## If You Want To Offer A Catalog To A Registration node

At minimum, your catalog should provide:

- a stable `catalog_id`
- a `/.well-known/ocp-catalog` discovery document
- an `/ocp/manifest` endpoint
- an `/ocp/query` endpoint

If your catalog supports provider onboarding, it should also provide:

- `/ocp/providers/register`
- `/ocp/objects/sync`

If your catalog supports object resolution, it should also provide:

- `/ocp/resolve`

The relevant protocol pages are:

- [CatalogManifest](/handshake/catalog-manifest)
- [CatalogRegistration](/registration/catalog-registration)
- [Query Contract Principles](/query-contract-principles)

## Minimal Catalog Discovery

```json
{
  "ocp_version": "1.0",
  "kind": "WellKnownCatalogDiscovery",
  "catalog_id": "my_catalog",
  "catalog_name": "My Catalog",
  "manifest_url": "https://catalog.example.com/ocp/manifest",
  "query_url": "https://catalog.example.com/ocp/query",
  "resolve_url": "https://catalog.example.com/ocp/resolve"
}
```

## Minimal Catalog Registration To Registration node

Your catalog can register itself to a Registration node with a normal HTTP call:

```ts
await fetch('https://registration.example.com/ocp/catalogs/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogRegistration',
    id: 'catreg_my_catalog_v1',
    registration_id: 'my_registration',
    catalog_id: 'my_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    homepage: 'https://catalog.example.com',
    well_known_url: 'https://catalog.example.com/.well-known/ocp-catalog',
    claimed_domains: ['catalog.example.com'],
    intended_visibility: 'public',
    tags: ['example'],
  }),
});
```

## Minimal Build Guides

The actual minimal implementations now live on dedicated example pages:

- [Build A Minimal Catalog](/examples/minimal-catalog)
- [Build A Minimal Provider](/examples/minimal-provider)

Those pages contain:

- the smallest runnable code example
- the minimal lifecycle
- the exact registration or sync request shape

## If You Want To Join As A Provider

At minimum, a provider that targets the current push-based handshake model should be able to:

- choose a target `catalog_id`
- build a versioned `ProviderRegistration`
- send that registration to `/ocp/providers/register`
- send concrete objects to `/ocp/objects/sync`

In the current repository's main example, the provider does **not** need to expose its own public API just to register and sync, because the selected sync capability is `ocp.push.batch` and the catalog hosts the sync endpoint.

## Minimal Provider Registration

```ts
await fetch('https://catalog.example.com/ocp/providers/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ProviderRegistration',
    id: 'reg_my_provider_v1',
    catalog_id: 'my_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: 'my_provider',
      entity_type: 'merchant',
      display_name: 'My Provider',
      homepage: 'https://provider.example.com',
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'ocp.commerce.product.core.v1#/title',
          'ocp.commerce.price.v1#/currency',
          'ocp.commerce.price.v1#/amount',
        ],
        optional_fields: [
          'ocp.commerce.product.core.v1#/summary',
          'ocp.commerce.product.core.v1#/product_url',
        ],
        sync: {
          preferred_capabilities: ['ocp.push.batch'],
          avoid_capabilities_unless_necessary: [],
          provider_endpoints: {},
        },
      },
    ],
  }),
});
```

## Minimal Object Sync

```ts
await fetch('https://catalog.example.com/ocp/objects/sync', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': '<catalog-object-sync-key>',
  },
  body: JSON.stringify({
    ocp_version: '1.0',
    kind: 'ObjectSyncRequest',
    catalog_id: 'my_catalog',
    provider_id: 'my_provider',
    registration_version: 1,
    batch_id: 'batch_001',
    objects: [
      {
        ocp_version: '1.0',
        kind: 'CommercialObject',
        id: 'obj_001',
        object_id: 'sku_001',
        object_type: 'product',
        provider_id: 'my_provider',
        title: 'Example product',
        status: 'active',
        descriptors: [
          {
            pack_id: 'ocp.commerce.product.core.v1',
            data: {
              title: 'Example product',
              product_url: 'https://provider.example.com/products/sku_001',
            },
          },
          {
            pack_id: 'ocp.commerce.price.v1',
            data: {
              currency: 'USD',
              amount: 19.99,
            },
          },
        ],
      },
    ],
  }),
});
```

## Practical Preparation Checklist

### For Catalog Builders

- decide your `catalog_id`
- expose discovery, manifest, and query endpoints
- decide whether you want provider onboarding
- choose which registration node or nodes to register with
- decide whether you want local-dev-only registration or public verified registration

### For Provider Builders

- decide which catalog you want to target
- understand that catalog's required fields and supported sync capabilities
- choose a stable `provider_id`
- version your registration updates
- keep a reproducible mapping from your source data into `CommercialObject`

## Lifecycle At A Glance

### Catalog Lifecycle

```text
catalog process starts
-> catalog serves discovery + manifest + query
-> catalog registers to Registration node
-> Registration node fetches and verifies catalog metadata
-> Registration node indexes routable catalog information
-> agents discover the catalog through route hints
```

### Provider Lifecycle

```text
provider prepares source data
-> provider sends ProviderRegistration
-> catalog accepts or rejects registration
-> provider syncs objects
-> catalog projects those objects into searchable entries
```

## What To Read Next

- [Roles](/roles)
- [ProviderRegistration](/handshake/provider-registration)
- [CatalogRegistration](/registration/catalog-registration)
- [Minimal Catalog](/examples/minimal-catalog)
- [Minimal Provider](/examples/minimal-provider)
- [Provider Flow](/examples/provider-flow)
- [Registration Flow](/examples/registration-flow)
- [FAQ](/faq)
