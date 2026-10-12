# Provider Flow

This example flow describes the real commerce provider implementation that ships in this repository.

For a platform-plugin style onboarding scenario, see [Shopify-Style Provider](/examples/shopify-provider).

## Real Lifecycle

![Commerce data pipeline from raw merchant records to OCP CommercialObject batches, catalog indexing, and search/resolve](images/commerce-data-sync-pipeline.png)

```text
provider admin seeds or edits products
-> provider computes the next registration_version from current catalog state
-> provider builds ProviderRegistration from its local provider mapping
-> catalog returns RegistrationResult with selected_sync_capability = ocp.push.batch
-> provider publishes CommercialObject batches
-> catalog projects product data into searchable entries
-> provider status page shows local_quality, publish_readiness, and catalog_quality
```

This wording matters: the current demo provider does not dynamically derive its declaration by fetching the catalog manifest or contracts first. It constructs the registration locally and then relies on the catalog to accept, limit, or reject that declaration.

## What The Provider Actually Publishes

The current provider implementation is not publishing anonymous objects. It maps local product rows into `CommercialObject` payloads with:

- product core fields such as `title`, `summary`, `brand`, `category`, `sku`, `product_url`, and `image_urls`
- price fields such as `currency`, `amount`, `list_amount`, and `price_type`
- inventory fields such as `availability_status` and `quantity`

The provider currently guarantees at registration time:

- `ocp.commerce.product.core.v1#/title`
- `ocp.commerce.price.v1#/currency`
- `ocp.commerce.price.v1#/amount`
- `ocp.commerce.product.core.v1#/product_url`

## Real Repository Behavior

In the current workspace:

- the provider admin API can seed realistic demo products
- the provider can register itself to the commerce catalog
- the catalog negotiates `ocp.push.batch`
- the provider can publish all products or sync one product at a time
- the provider derives `next_registration_version` from the catalog's current active provider state
- `syncAll` currently sends products in batches of 25
- publish runs are stored in `provider_sync_runs`
- the provider admin UI shows the last runs, local feed quality, publish readiness, and catalog-side quality feedback

## What `publish-to-catalog` Means Right Now

`POST /api/provider-admin/provider/publish-to-catalog` is an orchestration helper in the provider API. It performs:

1. `registerToCatalog`
2. `syncAll`

Its response returns both run records:

- `register_run`
- `sync_run`

This is important because the flow example is not a theoretical handshake. It is an actual provider-side workflow wrapper over the real registration and sync APIs.

## Registration And Sync State

The current implementation keeps registration and sync as two separate runtime states:

- registration writes a versioned `ProviderRegistration` record and may update the provider's active contract state
- object sync is allowed only when the provider already has an active registration version
- each sync request must use the same `registration_version` as the active provider contract state

That means a recorded registration is not automatically enough. A stale or non-activated version cannot drive sync.

## Quality Feedback Loop

The provider now exposes three different quality views:

- `local_quality`
  Counts issues in the provider's own product rows, such as missing price, missing image, missing URL, or missing taxonomy.
- `publish_readiness`
  Computes whether the provider currently has enough active products to perform a meaningful publish.
- `catalog_quality`
  Reads back what the catalog indexed for that provider, including `basic`, `standard`, and `rich` entry counts plus missing-image, missing-URL, and out-of-stock counts.

That makes the provider flow much closer to a real commerce feed lifecycle.

## Important Runtime Rules

- The provider must have an active registration version before object sync succeeds.
- `out_of_stock` does not mean deletion. The product can remain active and searchable, while ranking and filters decide how it is shown.
- The selected sync capability is negotiated at registration time. In the current repository that live path is `ocp.push.batch`.

## Why This Flow Matters

The provider example now demonstrates a realistic split of responsibilities:

- the handshake decides whether the provider can meet the catalog's minimum field baseline
- the provider chooses how rich its declarations and payloads are
- the catalog decides how to rank, filter, and expose those products after sync
- the provider admin surface closes the loop by showing whether the feed is merely accepted or actually high quality

The same provider shape can be packaged as a storefront plugin or marketplace app. In that model, the merchant chooses a target catalog once, and the app handles registration, product mapping, batch sync, and later product-change syncs.

