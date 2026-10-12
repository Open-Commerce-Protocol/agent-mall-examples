# Shopify-Style Provider

This page describes a Shopify-style store integration as a provider scenario.

It is an example architecture, not a claim that this repository already ships a Shopify app.

## Scenario

A merchant owns a Shopify store and wants its products to become searchable and resolvable through a specific OCP commerce catalog.

The merchant installs an OCP provider app in the store, chooses a target catalog, grants product read access, and the app publishes the store's products into that catalog.

![Provider app onboarding flow from install through catalog selection, manifest fetch, registration, initial sync, and scheduled sync](images/provider-onboarding-flow.png)

```text
merchant installs OCP provider app
-> app asks merchant to choose a target catalog
-> app reads catalog manifest and object contract
-> app builds ProviderRegistration for the Shopify store
-> catalog accepts selected_sync_capability = ocp.push.batch
-> app maps Shopify products into CommercialObject batches
-> app pushes objects to the catalog object sync endpoint
-> catalog indexes products for query and resolve
```

## Roles

In this setup:

- Shopify store is the merchant's source system.
- OCP provider app is the Provider.
- Target commerce catalog is the Catalog.
- Shopify product records become `CommercialObject` payloads.
- Product URLs, checkout URLs, or app-owned deep links can become resolve action bindings.

The merchant does not need to run a custom server. The provider app can run as a hosted service, a scheduled worker, or a private app backend.

## Merchant Setup

A practical onboarding flow can be:

1. Merchant installs the OCP provider app.
2. Merchant enters or selects a target catalog URL.
3. App fetches the target catalog manifest.
4. App checks whether the catalog accepts commerce product descriptors.
5. Merchant approves the fields to sync.
6. App sends `ProviderRegistration`.
7. App performs an initial product sync.
8. App schedules future syncs for product changes.

## ProviderRegistration

The app registers the Shopify store as a merchant provider.

```json
{
  "ocp_version": "1.0",
  "kind": "ProviderRegistration",
  "id": "reg_shopify_store_001_v1",
  "catalog_id": "commerce_catalog_public",
  "registration_version": 1,
  "updated_at": "2026-04-24T00:00:00.000Z",
  "provider": {
    "provider_id": "shopify_store_acme",
    "entity_type": "merchant",
    "display_name": "Acme Shopify Store",
    "homepage_url": "https://acme.example"
  },
  "object_declarations": [
    {
      "object_type": "product",
      "guaranteed_fields": [
        "ocp.commerce.product.core.v1#/title",
        "ocp.commerce.product.core.v1#/product_url",
        "ocp.commerce.price.v1#/currency",
        "ocp.commerce.price.v1#/amount"
      ],
      "optional_fields": [
        "ocp.commerce.product.core.v1#/brand",
        "ocp.commerce.product.core.v1#/category",
        "ocp.commerce.product.core.v1#/image_urls",
        "ocp.commerce.inventory.v1#/availability_status",
        "ocp.commerce.inventory.v1#/quantity"
      ],
      "sync": {
        "preferred_capabilities": ["ocp.push.batch"],
        "avoid_capabilities_unless_necessary": [],
        "provider_endpoints": {}
      }
    }
  ]
}
```

## Product Mapping

The provider app maps each Shopify product or variant into an OCP `CommercialObject`.

![Commerce data pipeline from merchant product data through mapping, CommercialObject creation, batch push, catalog index, and search/resolve API](images/commerce-data-sync-pipeline.png)

```json
{
  "ocp_version": "1.0",
  "kind": "CommercialObject",
  "id": "obj_shopify_acme_headphones_black",
  "object_id": "shopify://acme/products/834934/variants/112233",
  "object_type": "product",
  "provider_id": "shopify_store_acme",
  "title": "Noise Cancelling Headphones - Black",
  "status": "active",
  "descriptors": [
    {
      "pack_id": "ocp.commerce.product.core.v1",
      "data": {
        "title": "Noise Cancelling Headphones - Black",
        "summary": "Wireless over-ear headphones with active noise cancellation.",
        "brand": "North Audio",
        "category": "electronics",
        "sku": "NA-HP-BLK",
        "product_url": "https://acme.example/products/noise-cancelling-headphones?variant=112233",
        "image_urls": [
          "https://cdn.example.com/products/noise-cancelling-headphones-black.jpg"
        ]
      }
    },
    {
      "pack_id": "ocp.commerce.price.v1",
      "data": {
        "currency": "USD",
        "amount": 129,
        "list_amount": 159,
        "price_type": "current"
      }
    },
    {
      "pack_id": "ocp.commerce.inventory.v1",
      "data": {
        "availability_status": "in_stock",
        "quantity": 42
      }
    }
  ]
}
```

The mapping does not require the catalog to understand Shopify's internal schema. The provider app translates store-specific fields into descriptor packs the catalog has declared it can accept.

## Object Sync

After registration is active, the app pushes product batches:

```json
{
  "ocp_version": "1.0",
  "kind": "ObjectSyncRequest",
  "catalog_id": "commerce_catalog_public",
  "provider_id": "shopify_store_acme",
  "registration_version": 1,
  "batch_id": "shopify_acme_initial_001",
  "objects": [
    "<CommercialObject product 1>",
    "<CommercialObject product 2>"
  ]
}
```

A production app can perform:

- initial full sync after installation
- scheduled sync for catalog freshness
- webhook-triggered sync when products, variants, prices, images, or inventory change
- deletion or deactivation sync when a product is unpublished

## Resolve Behavior

When an agent later queries the catalog and resolves a Shopify-backed entry, the catalog can return action bindings such as:

```json
{
  "kind": "ResolvableReference",
  "entry_id": "centry_shopify_acme_headphones_black",
  "object_id": "shopify://acme/products/834934/variants/112233",
  "title": "Noise Cancelling Headphones - Black",
  "visible_attributes": {
    "brand": "North Audio",
    "amount": 129,
    "currency": "USD",
    "availability_status": "in_stock"
  },
  "action_bindings": [
    {
      "action_id": "view_product",
      "action_type": "url",
      "label": "View product",
      "url": "https://acme.example/products/noise-cancelling-headphones?variant=112233",
      "method": "GET"
    },
    {
      "action_id": "buy_now",
      "action_type": "url",
      "label": "Buy now",
      "url": "https://acme.example/cart/112233:1",
      "method": "GET"
    }
  ]
}
```

The catalog exposes the next action. Shopify or the merchant's storefront still owns checkout, payment, order state, fulfillment, refunds, and customer service.

## Why This Example Matters

This is the provider-side mirror of the catalog story:

- the merchant keeps products in the system it already uses
- the provider app turns that store into an OCP Provider
- the target catalog receives normalized commercial objects
- agents can query the catalog without learning Shopify-specific APIs
- resolve can still send the user back to the authoritative storefront or checkout flow

