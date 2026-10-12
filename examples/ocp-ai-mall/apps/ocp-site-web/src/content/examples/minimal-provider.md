# Build A Minimal Provider

This page shows the smallest provider that can still participate in the current push-based OCP handshake.

If you want a more realistic merchant-platform example, read [Shopify-Style Provider](/examples/shopify-provider) after this page.

The target is again intentionally narrow:

- choose one target catalog
- build one `ProviderRegistration`
- sync one object
- do not host your own public API

## What This Minimal Provider Assumes

This example assumes the target catalog supports:

- `POST /ocp/providers/register`
- `POST /ocp/objects/sync`
- sync capability `ocp.push.batch`

Under that model, the provider does not need to stay online for agents. It only needs to run when it registers or syncs.

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
    id: 'reg_hello_provider_v1',
    catalog_id: 'hello_catalog',
    registration_version: 1,
    updated_at: new Date().toISOString(),
    provider: {
      provider_id: 'hello_provider',
      entity_type: 'merchant',
      display_name: 'Hello Provider',
    },
    object_declarations: [
      {
        guaranteed_fields: [
          'hello.example.object.v1#/message',
        ],
        optional_fields: [],
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

After registration becomes active, the provider can push one object:

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
    catalog_id: 'hello_catalog',
    provider_id: 'hello_provider',
    registration_version: 1,
    batch_id: 'batch_hello_001',
    objects: [
      {
        ocp_version: '1.0',
        kind: 'CommercialObject',
        id: 'obj_hello_001',
        object_id: 'hello_object',
        object_type: 'example',
        provider_id: 'hello_provider',
        title: 'hello world object',
        status: 'active',
        descriptors: [
          {
            pack_id: 'hello.example.object.v1',
            data: {
              message: 'hello world from provider',
            },
          },
        ],
      },
    ],
  }),
});
```

## Minimal Provider Script

```ts
const catalogBaseUrl = 'https://catalog.example.com';
const objectSyncKey = '<catalog-object-sync-key>';

async function publishHelloProvider() {
  await fetch(`${catalogBaseUrl}/ocp/providers/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'ProviderRegistration',
      id: 'reg_hello_provider_v1',
      catalog_id: 'hello_catalog',
      registration_version: 1,
      updated_at: new Date().toISOString(),
      provider: {
        provider_id: 'hello_provider',
        entity_type: 'merchant',
        display_name: 'Hello Provider',
      },
      object_declarations: [
        {
          guaranteed_fields: ['hello.example.object.v1#/message'],
          optional_fields: [],
          sync: {
            preferred_capabilities: ['ocp.push.batch'],
            avoid_capabilities_unless_necessary: [],
            provider_endpoints: {},
          },
        },
      ],
    }),
  });

  await fetch(`${catalogBaseUrl}/ocp/objects/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': objectSyncKey,
    },
    body: JSON.stringify({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: 'hello_catalog',
      provider_id: 'hello_provider',
      registration_version: 1,
      batch_id: 'batch_hello_001',
      objects: [
        {
          ocp_version: '1.0',
          kind: 'CommercialObject',
          id: 'obj_hello_001',
          object_id: 'hello_object',
          object_type: 'example',
          provider_id: 'hello_provider',
          title: 'hello world object',
          status: 'active',
          descriptors: [
            {
              pack_id: 'hello.example.object.v1',
              data: {
                message: 'hello world from provider',
              },
            },
          ],
        },
      ],
    }),
  });
}
```

## Lifecycle

```text
provider process starts
-> sends ProviderRegistration
-> catalog accepts an active registration version
-> provider sends ObjectSyncRequest
-> catalog indexes the provider object
-> downstream query/resolve can start using it
```

## Practical Notes

- In the current push model, the provider does not need its own public domain.
- The provider also does not need to be always on, unless the chosen sync capability requires provider-hosted endpoints.
- Provider registration does not require the catalog object-sync API key in this example.
- The provider does need to manage `registration_version` deterministically.
- Sync usually must use the currently active `registration_version`.

## Related Pages

- [Getting Started](/getting-started)
- [ProviderRegistration](/handshake/provider-registration)
- [CommercialObject](/handshake/commercial-object)
- [Provider Flow](/examples/provider-flow)
- [Shopify-Style Provider](/examples/shopify-provider)
