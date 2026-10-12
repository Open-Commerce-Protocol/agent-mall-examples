# Registration Discovery

Registration discovery is the well-known document that bootstraps access to an OCP Catalog Registration node.

The wire schema uses the `RegistrationDiscovery` kind and `registration_*` field names. This discovery document is the baseline entry point for an OCP Catalog Registration node.

## Required Fields

```json
{
  "required": [
    "ocp_version",
    "kind",
    "registration_id",
    "registration_name",
    "registration_protocol",
    "registration_protocol_version",
    "manifest_url",
    "catalog_registration_url",
    "catalog_search_url"
  ]
}
```

## Example Fragment

```json
{
  "kind": "RegistrationDiscovery",
  "registration_id": "ocp_registry_public",
  "registration_name": "Open Commerce Protocol Registry",
  "registration_protocol": "ocp.catalog.registration.v1",
  "manifest_url": "http://localhost:4100/ocp/registration/manifest",
  "catalog_registration_url": "http://localhost:4100/ocp/catalogs/register",
  "catalog_search_url": "http://localhost:4100/ocp/catalogs/search"
}
```

## Why It Exists

Without a discovery document, every client would need out-of-band endpoint knowledge.

This document makes the registration node self-describing at the entry point.
