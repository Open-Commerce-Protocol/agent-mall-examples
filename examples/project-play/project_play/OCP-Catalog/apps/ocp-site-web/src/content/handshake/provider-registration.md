# ProviderRegistration

`ProviderRegistration` is the provider's versioned declaration of what it can supply to a catalog.

Provider registration is an intake handshake. In the current example runtime it does not require the catalog object-sync API key. A catalog may still require credentials for later object sync, as declared by the selected sync capability.

## When It Is Submitted

A provider submits a registration:

- before object sync starts
- whenever its declared capability changes
- whenever it needs to increase the registration version

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "catalog_id",
    "provider",
    "registration_version",
    "updated_at",
    "object_declarations"
  ]
}
```

## Provider Fragment

```json
{
  "provider": {
    "provider_id": "commerce_provider_local_dev",
    "entity_type": "merchant",
    "display_name": "Commerce Provider Local Dev",
    "homepage": "https://provider.example"
  }
}
```

## Object Declaration Fragment

```json
{
  "object_declarations": [
    {
      "guaranteed_fields": [
        "ocp.commerce.product.core.v1#/title",
        "ocp.commerce.price.v1#/currency",
        "ocp.commerce.price.v1#/amount",
        "ocp.commerce.product.core.v1#/product_url"
      ],
      "optional_fields": [
        "ocp.commerce.product.core.v1#/summary",
        "ocp.commerce.product.core.v1#/brand",
        "ocp.commerce.product.core.v1#/category",
        "ocp.commerce.product.core.v1#/sku",
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

## Matching Against ObjectContract

The provider registration is matched against the catalog's published `ObjectContract` and `sync_capabilities`.

In the commerce catalog example, the registration succeeds only if the declaration can satisfy:

- required field `ocp.commerce.product.core.v1#/title`
- required field `ocp.commerce.price.v1#/currency`
- required field `ocp.commerce.price.v1#/amount`
- at least one mutually supported sync capability

A provider implementation may go beyond that minimum and also guarantee fields such as `product_url`, because many catalogs want results that are not only acceptable for indexing but also directly resolvable or actionable.

At the protocol layer, the catalog matches declarations by contract requirements:

- `guaranteed_fields`
- `required_fields`

## Why Matching Is Field-Level

This is a boundary choice, not a weaker contract model.

The handshake only needs to determine:

- whether the provider can guarantee the fields required by the catalog
- whether both sides can negotiate one usable sync capability

It does not require a shared object taxonomy, and it does not require the catalog to expose its internal query partitions or indexing model during registration.

That keeps the protocol focused on the most stable compatibility surface: verifiable field guarantees plus capability negotiation.

## Example Sync Path

The example sync path is:

- registration with `sync.preferred_capabilities = ["ocp.push.batch"]`
- activation of the registration version
- `RegistrationResult.selected_sync_capability = ocp.push.batch`
- batched object sync over the catalog sync API

Reserved capabilities such as `ocp.feed.url` should be declared only when the provider-hosted endpoint and the catalog pull path are both implemented.

## Repository Example

Repository-specific operator flows belong in the example pages rather than the protocol definition.

See:

- `/examples/provider-flow`
- `/examples/commerce-catalog`

## Version Rule

For one `catalog_id + provider_id` pair:

- the provider sends a complete new registration document
- the new document must increase `registration_version`
- the catalog uses that version to decide which declaration is active
