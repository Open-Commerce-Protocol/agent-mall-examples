# CatalogRegistration

`CatalogRegistration` is the catalog's versioned declaration to the Registration node.

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "id",
    "registration_id",
    "catalog_id",
    "registration_version",
    "updated_at",
    "homepage",
    "well_known_url",
    "claimed_domains"
  ]
}
```

## Example Fragment

```json
{
  "catalog_id": "commerce_catalog_local_dev",
  "registration_version": 3,
  "homepage": "http://localhost:4000",
  "well_known_url": "http://localhost:4000/.well-known/ocp-catalog",
  "claimed_domains": ["localhost"],
  "intended_visibility": "public",
  "tags": ["commerce", "products"]
}
```

## Optional Metadata

`operator` can still be supplied as optional metadata, but it is not required for registration.

## Version Rule

Like provider registration, this object is versioned.

For one `catalog_id`:

- a higher `registration_version` supersedes the previous one
- `updated_at` is an audit timestamp, not the primary ordering key

## What The Registration node Does Next

After accepting a registration, the Registration node can:

- verify catalog control
- fetch the catalog manifest
- create a snapshot
- index routable metadata
